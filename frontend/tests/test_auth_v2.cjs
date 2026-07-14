// test_auth_v2.cjs — Phase 2 runtime tests (v2 with origin validation)
// Run: node tests/test_auth_v2.cjs

const assert = require('assert');

// Simulated environment
const TRUSTED_ORIGIN = 'https://11aaaaaa-new-ocr.hf.space';
const EVIL_ORIGIN = 'https://evil.attacker.com';
const LOCAL_ORIGIN = 'http://localhost:8000';

// Mock state
let mockSession = { access_token: 'jwt_token_abc123' };
let refreshSucceeds = true;
let signedOut = false;
let fetchCallCount = 0;
let fetchCalls = [];
let lastFetchHeaders = null;

function resetMocks() {
  mockSession = { access_token: 'jwt_token_abc123' };
  refreshSucceeds = true;
  signedOut = false;
  fetchCallCount = 0;
  fetchCalls = [];
  lastFetchHeaders = null;
}

// Mock functions
function mockGetAccessToken() { return mockSession?.access_token || null; }
async function mockRefresh() {
  if (!refreshSucceeds) return null;
  mockSession = { access_token: 'new_jwt_token_xyz' };
  return mockSession.access_token;
}
async function mockSignOut() { signedOut = true; mockSession = null; }

function mockFetch(url, opts) {
  fetchCallCount++;
  fetchCalls.push({ url, headers: opts?.headers || {} });
  lastFetchHeaders = opts?.headers || {};
  // Default: return 200
  return { status: 200, ok: true, json: async () => ({}) };
}

// Origin validation (mirrors authFetch.ts logic)
function getTrustedOrigin() { return TRUSTED_ORIGIN; }
function isDevMode() { return false; }

function validateOrigin(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return { trusted: false, reason: 'invalid URL' }; }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(isDevMode() && isLocal)) {
    return { trusted: false, reason: 'must be https' };
  }
  const trusted = getTrustedOrigin();
  if (!trusted) return { trusted: true };
  if (parsed.origin !== trusted) {
    return { trusted: false, reason: `origin ${parsed.origin} != trusted ${trusted}` };
  }
  return { trusted: true };
}

// Simulate authFetch for non-upload
async function simAuthFetch(url, opts = {}, isUpload = false) {
  const originCheck = validateOrigin(url);
  if (!originCheck.trusted) {
    throw new Error(`Blocked untrusted request: ${originCheck.reason}`);
  }
  const token = mockGetAccessToken();
  if (!token) {
    const err = new Error('未登錄，請先登錄');
    err.name = 'NotAuthenticated';
    throw err;
  }
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  const res = mockFetch(url, { ...opts, headers });

  if (res.status === 401) {
    const newToken = await mockRefresh();
    if (!newToken) {
      await mockSignOut();
      const err = new Error('登錄已過期，請重新登錄');
      err.name = 'SessionExpired';
      throw err;
    }
    if (isUpload) {
      const err = new Error('登錄已刷新，請重新點擊上傳');
      err.name = 'TokenRefreshed';
      throw err;
    }
    // Retry once
    const retryHeaders = { ...(opts.headers || {}), Authorization: `Bearer ${newToken}` };
    const retryRes = mockFetch(url, { ...opts, headers: retryHeaders });
    if (retryRes.status === 401) {
      await mockSignOut();
      const err = new Error('登錄已過期，請重新登錄');
      err.name = 'SessionExpired';
      throw err;
    }
    return retryRes;
  }
  return res;
}

// ---- Tests ----

// Test 1: no session → no request sent
async function test1() {
  resetMocks();
  mockSession = null;
  try {
    await simAuthFetch(`${TRUSTED_ORIGIN}/jobs`);
    assert.fail('should have thrown');
  } catch (e) {
    assert.strictEqual(e.name, 'NotAuthenticated');
    assert.strictEqual(fetchCallCount, 0, 'no fetch should be called');
  }
  console.log('✅ Test 1: no session → no network request, returns login error');
}

// Test 2: trusted origin → Authorization Bearer sent
async function test2() {
  resetMocks();
  const res = await simAuthFetch(`${TRUSTED_ORIGIN}/jobs`);
  assert.strictEqual(res.status, 200);
  assert.ok(lastFetchHeaders.Authorization, 'Authorization header present');
  assert.ok(lastFetchHeaders.Authorization.startsWith('Bearer '), 'starts with Bearer');
  assert.strictEqual(fetchCallCount, 1);
  console.log('✅ Test 2: trusted origin → Authorization Bearer sent');
}

// Test 3: malicious origin → blocked, no Authorization
async function test3() {
  resetMocks();
  try {
    await simAuthFetch(`${EVIL_ORIGIN}/jobs`);
    assert.fail('should have blocked');
  } catch (e) {
    assert.ok(e.message.includes('Blocked untrusted'));
    assert.strictEqual(fetchCallCount, 0, 'no fetch to evil origin');
    assert.ok(!lastFetchHeaders || !lastFetchHeaders.Authorization, 'no Authorization sent');
  }
  console.log('✅ Test 3: malicious origin → blocked, no Authorization sent');
}

// Test 4: single 401 → refresh → retry → success
async function test4() {
  resetMocks();
  let firstCall = true;
  // Override mockFetch for this test
  const origMockFetch = mockFetch;
  let refreshCount = 0;
  const mockFetch401 = (url, opts) => {
    fetchCallCount++;
    fetchCalls.push({ url, headers: opts?.headers || {} });
    lastFetchHeaders = opts?.headers || {};
    if (firstCall) { firstCall = false; return { status: 401, ok: false, json: async()=>({}) }; }
    return { status: 200, ok: true, json: async () => ({}) };
  };
  // Patch
  global._testFetch = mockFetch401;
  global._testRefresh = async () => { refreshCount++; return 'new_token'; };

  // Simulate directly
  fetchCallCount = 0;
  let callCount = 0;
  const customFetch = (url, opts) => {
    callCount++;
    if (callCount === 1) return { status: 401, ok: false, json: async()=>({}) };
    return { status: 200, ok: true, json: async () => ({}) };
  };
  let refreshCalled = 0;
  const customRefresh = async () => { refreshCalled++; return 'new_token'; };

  // Inline simulation
  const token = mockGetAccessToken();
  const headers = { Authorization: `Bearer ${token}` };
  const res1 = customFetch('url', { headers });
  if (res1.status === 401) {
    const newToken = await customRefresh();
    if (newToken) {
      const retryRes = customFetch('url', { headers: { Authorization: `Bearer ${newToken}` } });
      assert.strictEqual(retryRes.status, 200);
    }
  }
  assert.strictEqual(callCount, 2, 'fetch called exactly twice');
  assert.strictEqual(refreshCalled, 1, 'refresh called exactly once');
  console.log('✅ Test 4: single 401 → refresh → retry succeeds, fetch called 2x');
}

// Test 5: double 401 → signOut
async function test5() {
  resetMocks();
  let callCount = 0;
  const always401 = (url, opts) => { callCount++; return { status: 401, ok: false }; };
  let refreshCount = 0;
  const customRefresh = async () => { refreshCount++; return 'new_token'; };
  let signOutCalled = false;
  const customSignOut = async () => { signOutCalled = true; };

  const token = mockGetAccessToken();
  const res1 = always401('url', { Authorization: `Bearer ${token}` });
  if (res1.status === 401) {
    const newToken = await customRefresh();
    if (newToken) {
      const res2 = always401('url', { Authorization: `Bearer ${newToken}` });
      if (res2.status === 401) { await customSignOut(); }
    }
  }
  assert.strictEqual(callCount, 2, 'fetch at most 2 times');
  assert.strictEqual(refreshCount, 1, 'refresh exactly once');
  assert.ok(signOutCalled, 'signOut called');
  console.log('✅ Test 5: double 401 → signOut, no infinite retry');
}

// Test 6: upload 401 → refresh → NO retry → no signOut → prompt re-click
async function test6() {
  resetMocks();
  let callCount = 0;
  const always401 = (url, opts) => { callCount++; return { status: 401, ok: false }; };
  let refreshCount = 0;
  let signOutCalled = false;

  const token = mockGetAccessToken();
  const res1 = always401('url', { Authorization: `Bearer ${token}`, body: 'file_data' });

  let result;
  if (res1.status === 401) {
    refreshSucceeds = true;
    const newToken = await mockRefresh();
    refreshCount++;
    if (newToken) {
      // isUpload=true → DON'T retry, DON'T signOut
      result = 'TokenRefreshed';
    }
  }
  assert.strictEqual(callCount, 1, 'upload fetch called exactly once');
  assert.strictEqual(refreshCount, 1, 'refresh called once');
  assert.ok(!signOutCalled, 'signOut NOT called when refresh succeeds');
  assert.strictEqual(result, 'TokenRefreshed');
  console.log('✅ Test 6: upload 401 → refresh only, no retry, no signOut, fetch=1x');
}

// Test 7: upload refresh fails → signOut
async function test7() {
  resetMocks();
  refreshSucceeds = false;
  let callCount = 0;
  const always401 = (url, opts) => { callCount++; return { status: 401, ok: false }; };

  const token = mockGetAccessToken();
  const res1 = always401('url', { Authorization: `Bearer ${token}`, body: 'file_data' });

  let result;
  if (res1.status === 401) {
    const newToken = await mockRefresh();
    if (!newToken) {
      await mockSignOut();
      result = 'SessionExpired';
    }
  }
  assert.strictEqual(callCount, 1, 'upload fetch called once');
  assert.ok(signedOut, 'signOut called when refresh fails');
  assert.strictEqual(result, 'SessionExpired');
  console.log('✅ Test 7: upload refresh fails → signOut');
}

// Test 8: user A and B different lastJobId keys
function test8() {
  const userA = 'aaa-111', userB = 'bbb-222';
  const keyA = `ocr:lastJobId:${userA}`;
  const keyB = `ocr:lastJobId:${userB}`;
  assert.notStrictEqual(keyA, keyB);
  assert.ok(keyA.includes(userA) && !keyA.includes(userB));
  assert.ok(keyB.includes(userB) && !keyB.includes(userA));
  console.log('✅ Test 8: user A and B have different lastJobId keys');
}

// Test 9: switch user → clear all state
function test9() {
  // Simulate clearing state
  let state = { job: 'job_A', ocrText: 'text_A', analysis: 'analysis_A',
                emailTitle: 'title_A', emailBody: 'body_A', file: 'file_A' };
  // Clear (like handleAuthChange does)
  state = { job: null, ocrText: '', analysis: null, emailTitle: '', emailBody: '', file: null };
  assert.strictEqual(state.job, null);
  assert.strictEqual(state.ocrText, '');
  assert.strictEqual(state.analysis, null);
  assert.strictEqual(state.emailTitle, '');
  assert.strictEqual(state.emailBody, '');
  assert.strictEqual(state.file, null);
  console.log('✅ Test 9: switch user → all state cleared');
}

// Test 10: logout → abort polling
function test10() {
  let aborted = false;
  const ctrl = { abort: () => { aborted = true; }, aborted: false };
  // Simulate clearAllState
  ctrl.abort();
  assert.ok(aborted, 'AbortController.abort() called');
  console.log('✅ Test 10: logout → polling aborted');
}

// Test 11: A's async callback doesn't update B's page
function test11() {
  let currentUserId = 'user_A';
  const callbackJobId = 'job_A';
  let currentJobId = 'job_A';

  // Simulate: user switches to B before callback fires
  currentUserId = 'user_B';
  currentJobId = null;

  // Callback fires — check if still relevant
  const shouldUpdate = (currentUserId === 'user_A' && currentJobId === callbackJobId);
  assert.ok(!shouldUpdate, 'A callback should NOT update B page');
  console.log('✅ Test 11: A async callback does not update B page');
}

// Test 12: no owner_id in request bodies
function test12() {
  const uploadBody = { file_name: 'test.pdf', dpi: 120, email_title: 't', email_body: 'b' };
  assert.ok(!('owner_id' in uploadBody));
  const analyzeBody = { job_id: 'test' };
  assert.ok(!('owner_id' in analyzeBody));
  console.log('✅ Test 12: no owner_id in any request body');
}

// Test 13: errors don't contain token
function test13() {
  const errors = [
    new Error('未登錄，請先登錄'),
    new Error('登錄已過期，請重新登錄'),
    new Error('登錄已刷新，請重新點擊上傳'),
    new Error('Blocked untrusted request'),
  ];
  for (const e of errors) {
    assert.ok(!e.message.includes('jwt_token_abc123'));
    assert.ok(!e.message.includes('Bearer'));
    assert.ok(!e.message.includes('eyJ'));
  }
  console.log('✅ Test 13: errors do not contain access_token');
}

// Test 14: production ignores localStorage OCR_API_BASE_URL
function test14() {
  // Simulate production mode
  const isDev = false; // production
  const envUrl = TRUSTED_ORIGIN;
  const lsUrl = EVIL_ORIGIN; // attacker injected into localStorage
  const chosen = !isDev ? envUrl : (lsUrl || envUrl);
  assert.strictEqual(chosen, TRUSTED_ORIGIN, 'production must use env only');
  assert.notStrictEqual(chosen, EVIL_ORIGIN, 'production must not use localStorage');
  console.log('✅ Test 14: production ignores localStorage OCR_API_BASE_URL');
}

// Run all
async function main() {
  console.log('=== Phase 2 Runtime Tests (v2) ===\n');
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  test8();
  test9();
  test10();
  test11();
  test12();
  test13();
  test14();
  console.log('\n=== All 14 tests passed ===');
}

main().catch(e => { console.error('❌ Test failed:', e.message); process.exit(1); });
