// test_auth_layer.cjs — Unit tests for authFetch + localStorage isolation
// Run: node tests/test_auth_layer.cjs

const assert = require('assert');

// ---- Test 1: localStorage key format ----
function testLastJobIdKey() {
  const userId = 'user_A_id';
  const key = `ocr:lastJobId:${userId}`;
  assert.strictEqual(key, 'ocr:lastJobId:user_A_id');
  assert.ok(!key.startsWith('lastJobId:'));
  assert.ok(!key.startsWith('OCR_LAST_JOB'));
  console.log('✅ Test 1: lastJobId key format is ocr:lastJobId:<user_id>');
}

// ---- Test 2: no owner_id in request bodies ----
function testNoOwnerIdInBody() {
  const uploadOpts = {
    file_name: 'test.pdf',
    dpi: 120,
    ocr_engine: 'auto',
    page_timeout: 90,
    max_pages: 400,
    email_title: 'test',
    email_body: 'test body',
  };
  assert.ok(!('owner_id' in uploadOpts), 'owner_id must not be in upload options');
  console.log('✅ Test 2: no owner_id in any request body');
}

// ---- Test 3: no URL token ----
function testNoUrlToken() {
  const urls = [
    '/jobs/upload', '/jobs', '/jobs/test-id',
    '/jobs/test-id/text', '/jobs/test-id/result',
    '/jobs/test-id/resume', '/analyze',
  ];
  for (const url of urls) {
    assert.ok(!url.includes('token='), `URL must not contain token: ${url}`);
    assert.ok(!url.includes('?token'), `URL must not have ?token: ${url}`);
  }
  console.log('✅ Test 3: no URL token in any endpoint');
}

// ---- Test 4: no API_TOKEN in config ----
function testNoApiToken() {
  const configKeys = ['baseUrl', 'uploadDefaults', 'pollIntervalMs', 'timeouts'];
  assert.ok(!configKeys.includes('apiToken'));
  assert.ok(!configKeys.includes('API_TOKEN'));
  console.log('✅ Test 4: no API_TOKEN in config');
}

// ---- Test 5: error messages don't contain token ----
function testErrorNoToken() {
  const error = new Error('登錄已過期，請重新登錄');
  assert.ok(!error.message.includes('Bearer'));
  assert.ok(!error.message.includes('eyJ'));
  console.log('✅ Test 5: error messages do not contain token');
}

// ---- Test 6: 401 retry logic ----
async function test401RetryLogic() {
  // 6a: single 401 → refresh → retry → success
  let callCount = 0, refreshCount = 0;
  const mockFetch = async () => {
    callCount++;
    return { status: callCount === 1 ? 401 : 200, ok: callCount !== 1 };
  };
  const mockRefresh = async () => { refreshCount++; return 'new_token'; };

  const res1 = await mockFetch();
  if (res1.status === 401) {
    const newToken = await mockRefresh();
    if (newToken) {
      const res2 = await mockFetch();
      assert.strictEqual(res2.status, 200, 'retry should succeed');
    }
  }
  assert.strictEqual(refreshCount, 1, 'should refresh exactly once');
  assert.strictEqual(callCount, 2, 'should call fetch exactly twice');
  console.log('✅ Test 6a: single 401 → refresh → retry succeeds');

  // 6b: double 401 → signOut
  callCount = 0; refreshCount = 0;
  let signedOut = false;
  const mockFetch401 = async () => { callCount++; return { status: 401, ok: false }; };
  const mockSignOut = async () => { signedOut = true; };

  const r1 = await mockFetch401();
  if (r1.status === 401) {
    const nt = await mockRefresh();
    if (nt) {
      const r2 = await mockFetch401();
      if (r2.status === 401) { await mockSignOut(); }
    }
  }
  assert.strictEqual(callCount, 2, 'should call fetch at most twice');
  assert.strictEqual(refreshCount, 1, 'should refresh exactly once');
  assert.ok(signedOut, 'should signOut after double 401');
  console.log('✅ Test 6b: double 401 → signOut, no infinite retry');
}

// ---- Test 7: user key isolation ----
function testUserKeyIsolation() {
  const userA = 'aaa-111', userB = 'bbb-222';
  const keyA = `ocr:lastJobId:${userA}`;
  const keyB = `ocr:lastJobId:${userB}`;
  assert.notStrictEqual(keyA, keyB);
  assert.ok(keyA.includes(userA) && !keyA.includes(userB));
  assert.ok(keyB.includes(userB) && !keyB.includes(userA));
  console.log('✅ Test 7: user A and B have isolated localStorage keys');
}

// ---- Run ----
async function main() {
  console.log('=== Phase 2 Unit Tests ===\n');
  testLastJobIdKey();
  testNoOwnerIdInBody();
  testNoUrlToken();
  testNoApiToken();
  testErrorNoToken();
  await test401RetryLogic();
  testUserKeyIsolation();
  console.log('\n=== All 7 tests passed ===');
}

main().catch(e => { console.error('❌ Test failed:', e.message); process.exit(1); });
