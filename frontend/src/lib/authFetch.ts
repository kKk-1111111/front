// authFetch.ts — Unified authenticated request layer
// All OCR backend requests go through this. No URL token, no manual localStorage.
// Origin validation: JWT only sent to trusted API origin.
// 401 handling:
//   - GET/JSON requests: refreshSession once → retry once → signOut if still 401
//   - File upload (POST /jobs/upload): refreshSession once → DON'T retry → prompt user to re-click
//     Only signOut if refresh fails.

import { supabase } from "./supabase";

let _isRefreshing = false;

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

async function refreshAccessToken(): Promise<string | null> {
  if (_isRefreshing) return null;
  _isRefreshing = true;
  try {
    const { data } = await supabase.auth.refreshSession();
    _isRefreshing = false;
    return data.session?.access_token || null;
  } catch {
    _isRefreshing = false;
    return null;
  }
}

export async function signOutAndClear(): Promise<void> {
  await supabase.auth.signOut();
}

// ---- Origin validation ----

function getTrustedOrigin(): string {
  // In production: only from VITE_OCR_API_BASE_URL
  // In dev: can be overridden by localStorage, but must validate origin
  const envUrl = import.meta.env.VITE_OCR_API_BASE_URL || "";
  if (!envUrl) return "";
  try {
    const u = new URL(envUrl);
    return u.origin;
  } catch {
    return "";
  }
}

function isDevMode(): boolean {
  return import.meta.env.DEV === true || import.meta.env.MODE === "development";
}

/**
 * Validate that a URL's origin matches the trusted API origin.
 * - In production: trusted origin = VITE_OCR_API_BASE_URL origin (from build-time env)
 * - In dev: trusted origin = VITE_OCR_API_BASE_URL origin (can be overridden, but still validated)
 * - Must be https (except localhost/127.0.0.1 in dev)
 * If not trusted: throw error, DO NOT add Authorization header.
 */
export function validateOrigin(url: string): { trusted: boolean; reason?: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { trusted: false, reason: "invalid URL" };
  }

  // Must be https, except localhost/127.0.0.1 in dev
  const isLocal = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
  if (parsedUrl.protocol !== "https:" && !(isDevMode() && isLocal)) {
    return { trusted: false, reason: "must be https (or localhost in dev)" };
  }

  const trusted = getTrustedOrigin();
  if (!trusted) {
    // No trusted origin configured — in dev allow, in prod block
    if (isDevMode()) return { trusted: true };
    return { trusted: false, reason: "no trusted API origin configured" };
  }

  if (parsedUrl.origin !== trusted) {
    return { trusted: false, reason: `origin ${parsedUrl.origin} does not match trusted ${trusted}` };
  }

  return { trusted: true };
}

/**
 * Unified fetch wrapper that:
 * 1. Validates target origin before adding Authorization
 * 2. Gets access_token from Supabase session
 * 3. Adds Authorization: Bearer header only for trusted origins
 * 4. On 401: refreshSession once, retry once (for non-upload), then signOut
 * 5. Upload: refresh once, don't retry, prompt user to re-click
 *
 * @param url Full URL to fetch
 * @param opts RequestInit (without Authorization header)
 * @param options { isUpload?: boolean } — if true, 401 won't auto-retry
 * @returns Response or throws
 */
export async function authFetch(
  url: string,
  opts: RequestInit = {},
  isUpload = false
): Promise<Response> {
  // 1. Validate origin BEFORE anything else
  const originCheck = validateOrigin(url);
  if (!originCheck.trusted) {
    throw new Error(`Blocked untrusted request to ${new URL(url).origin}: ${originCheck.reason}`);
  }

  // 2. Get token
  const token = await getAccessToken();
  if (!token) {
    const err = new Error("未登錄，請先登錄");
    err.name = "NotAuthenticated";
    throw err;
  }

  // 3. Build headers — never log these
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...opts, headers });

  // 4. 401 handling
  if (res.status === 401) {
    const newToken = await refreshAccessToken();

    if (!newToken) {
      // Refresh failed → signOut
      await signOutAndClear();
      const err = new Error("登錄已過期，請重新登錄");
      err.name = "SessionExpired";
      throw err;
    }

    if (isUpload) {
      // Upload: refresh succeeded, but DON'T retry (file body consumed)
      // DON'T signOut — prompt user to re-click
      const err = new Error("登錄已刷新，請重新點擊上傳");
      err.name = "TokenRefreshed";
      throw err;
    }

    // Non-upload: retry once with new token
    const retryHeaders: Record<string, string> = {
      ...(opts.headers as Record<string, string> || {}),
      Authorization: `Bearer ${newToken}`,
    };
    const retryRes = await fetch(url, { ...opts, headers: retryHeaders });

    if (retryRes.status === 401) {
      // Still 401 → signOut
      await signOutAndClear();
      const err = new Error("登錄已過期，請重新登錄");
      err.name = "SessionExpired";
      throw err;
    }

    return retryRes;
  }

  return res;
}

/**
 * authFetchJSON — authFetch + JSON parsing
 */
export async function authFetchJSON<T>(
  url: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await authFetch(url, opts);
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch {}
    const err = new Error(body?.error || `HTTP ${res.status}`);
    (err as any).httpStatus = res.status;
    (err as any).body = body;
    throw err;
  }
  return await res.json();
}

/**
 * authFetchText — authFetch + text response
 */
export async function authFetchText(
  url: string,
  opts: RequestInit = {}
): Promise<string> {
  const res = await authFetch(url, opts);
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch {}
    const err = new Error(body?.error || `HTTP ${res.status}`);
    (err as any).httpStatus = res.status;
    throw err;
  }
  return await res.text();
}
