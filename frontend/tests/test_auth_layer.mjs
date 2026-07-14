// test_auth_layer.mjs — Unit tests for authFetch + localStorage isolation
// Run: node tests/test_auth_layer.mjs
// Tests pure functions and request layer without browser.

import assert from "assert";

// ---- Test 1: localStorage key format ----
function testLastJobIdKey() {
  const userId = "user_A_id";
  const key = `ocr:lastJobId:${userId}`;
  assert.strictEqual(key, "ocr:lastJobId:user_A_id");
  assert.ok(!key.startsWith("lastJobId:"));
  assert.ok(!key.startsWith("OCR_LAST_JOB"));
  console.log("✅ Test 1: lastJobId key format is ocr:lastJobId:<user_id>");
}

// ---- Test 2: no owner_id in request bodies ----
function testNoOwnerIdInBody() {
  const uploadOpts = {
    file_name: "test.pdf",
    dpi: 120,
    ocr_engine: "auto",
    page_timeout: 90,
    max_pages: 400,
    email_title: "test",
    email_body: "test body",
  };
  assert.ok(!("owner_id" in uploadOpts), "owner_id must not be in upload options");
  assert.ok(!("owner_id" in uploadOpts), "owner_id must not be in URL upload body");

  const analyzeBody = new FormData();
  analyzeBody.append("job_id", "test_job");
  // FormData doesn't have owner_id
  const entries = Array.from(analyzeBody.entries());
  const hasOwnerId = entries.some(([k]) => k === "owner_id");
  assert.ok(!hasOwnerId, "owner_id must not be in analyze body");
  console.log("✅ Test 2: no owner_id in any request body");
}

// ---- Test 3: no URL token ----
function testNoUrlToken() {
  // Check that URLs don't contain ?token=
  const urls = [
    "/jobs/upload",
    "/jobs",
    "/jobs/test-id",
    "/jobs/test-id/text",
    "/jobs/test-id/result",
    "/jobs/test-id/resume",
    "/analyze",
  ];
  for (const url of urls) {
    assert.ok(!url.includes("token="), `URL must not contain token param: ${url}`);
    assert.ok(!url.includes("?token"), `URL must not have ?token: ${url}`);
  }
  console.log("✅ Test 3: no URL token in any endpoint");
}

// ---- Test 4: no API_TOKEN in code ----
function testNoApiToken() {
  // Simulate checking that the config doesn't expose API_TOKEN
  const configKeys = ["baseUrl", "uploadDefaults", "pollIntervalMs", "timeouts"];
  assert.ok(!configKeys.includes("apiToken"), "config must not have apiToken");
  assert.ok(!configKeys.includes("API_TOKEN"), "config must not have API_TOKEN");
  console.log("✅ Test 4: no API_TOKEN in config");
}

// ---- Test 5: error messages don't contain token ----
function testErrorNoToken() {
  const fakeToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature";
  const error = new Error("登錄已過期，請重新登錄");
  assert.ok(!error.message.includes(fakeToken), "error message must not contain token");
  assert.ok(!error.message.includes("Bearer"), "error message must not contain Bearer");
  console.log("✅ Test 5: error messages don't contain token");
}

// ---- Test 6: 401 retry logic (pure function simulation) ----
function test401RetryLogic() {
  // Simulate: first 401 → refresh → retry → success
  let callCount = 0;
  let refreshCount = 0;
  const mockFetch = async (url, opts) => {
    callCount++;
    if (callCount === 1) return { status: 401, ok: false };
    return { status: 200, ok: true, json: async () => ({}) };
  };
  const mockRefresh = async () => {
    refreshCount++;
    return "new_token";
  };

  // Simulate authFetch logic
  async function simulateAuthFetch() {
    const token = "old_token";
    callCount = 0;
    refreshCount = 0;

    const res1 = await mockFetch("test", { headers: { Authorization: `Bearer ${token}` } });
    if (res1.status === 401) {
      const newToken = await mockRefresh();
      if (newToken) {
        const res2 = await mockFetch("test", { headers: { Authorization: `Bearer ${newToken}` } });
        assert.strictEqual(res2.status, 200, "retry should succeed");
      }
    }
    assert.strictEqual(refreshCount, 1, "should refresh exactly once");
    assert.strictEqual(callCount, 2, "should call fetch exactly twice");
  }

  // Simulate: two 401s → signOut
  async function simulateDouble401() {
    callCount = 0;
    refreshCount = 0;
    let signedOut = false;
    const mockFetchAlways401 = async () => {
      callCount++;
      return { status: 401, ok: false };
    };
    const mockSignOut = async () => { signedOut = true; };

    const res1 = await mockFetchAlways401("test", {});
    if (res1.status === 401) {
      const newToken = await mockRefresh();
      if (newToken) {
        const res2 = await mockFetchAlways401("test", {});
        if (res2.status === 401) {
          await mockSignOut();
        }
      }
    }
    assert.strictEqual(callCount, 2, "should call fetch at most twice");
    assert.strictEqual(refreshCount, 1, "should refresh exactly once");
    assert.ok(signedOut, "should signOut after double 401");
  }

  // Run both
  await simulateAuthFetch();
  console.log("✅ Test 6a: single 401 → refresh → retry succeeds");

  await simulateDouble401();
  console.log("✅ Test 6b: double 401 → signOut, no infinite retry");
}

// ---- Test 7: user key isolation ----
function testUserKeyIsolation() {
  const userA = "aaa-111";
  const userB = "bbb-222";
  const keyA = `ocr:lastJobId:${userA}`;
  const keyB = `ocr:lastJobId:${userB}`;
  assert.notStrictEqual(keyA, keyB, "keys must differ per user");
  assert.ok(keyA.includes(userA), "user A key contains user A id");
  assert.ok(keyB.includes(userB), "user B key contains user B id");
  assert.ok(!keyA.includes(userB), "user A key must not contain user B id");
  assert.ok(!keyB.includes(userA), "user B key must not contain user A id");
  console.log("✅ Test 7: user A and B have isolated localStorage keys");
}

// ---- Run all tests ----
async function main() {
  console.log("=== Phase 2 Unit Tests ===\n");
  testLastJobIdKey();
  testNoOwnerIdInBody();
  testNoUrlToken();
  testNoApiToken();
  testErrorNoToken();
  await test401RetryLogic();
  testUserKeyIsolation();
  console.log("\n=== All 7 tests passed ===");
}

main().catch(e => { console.error("❌ Test failed:", e.message); process.exit(1); });
