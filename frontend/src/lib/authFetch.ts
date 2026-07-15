// authFetch.ts — Unified authenticated request layer
// Validates target origin against config.baseUrl before adding Authorization.

import { supabase } from "./supabase";
import { config } from "../config";

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

function getTrustedOrigin(): string {
  try {
    const u = new URL(config.baseUrl);
    return u.origin;
  } catch {
    return "";
  }
}

function isDevMode(): boolean {
  return import.meta.env.DEV === true || import.meta.env.MODE === "development";
}

export function validateOrigin(url: string): { trusted: boolean; reason?: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { trusted: false, reason: "invalid URL" };
  }

  const isLocal = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
  if (parsedUrl.protocol !== "https:" && !(isDevMode() && isLocal)) {
    return { trusted: false, reason: "must be https (or localhost in dev)" };
  }

  const trusted = getTrustedOrigin();
  if (!trusted) {
    if (isDevMode()) return { trusted: true };
    return { trusted: false, reason: "no trusted API origin configured" };
  }

  if (parsedUrl.origin !== trusted) {
    return { trusted: false, reason: `origin ${parsedUrl.origin} does not match trusted ${trusted}` };
  }

  return { trusted: true };
}

export async function authFetch(
  url: string,
  opts: RequestInit = {},
  isUpload = false
): Promise<Response> {
  const originCheck = validateOrigin(url);
  if (!originCheck.trusted) {
    throw new Error(`Blocked untrusted request to ${new URL(url).origin}: ${originCheck.reason}`);
  }

  const token = await getAccessToken();
  if (!token) {
    const err = new Error("未登錄，請先登錄");
    err.name = "NotAuthenticated";
    throw err;
  }

  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();

    if (!newToken) {
      await signOutAndClear();
      const err = new Error("登錄已過期，請重新登錄");
      err.name = "SessionExpired";
      throw err;
    }

    if (isUpload) {
      const err = new Error("登錄已刷新，請重新點擊上傳");
      err.name = "TokenRefreshed";
      throw err;
    }

    const retryHeaders: Record<string, string> = {
      ...(opts.headers as Record<string, string> || {}),
      Authorization: `Bearer ${newToken}`,
    };
    const retryRes = await fetch(url, { ...opts, headers: retryHeaders });

    if (retryRes.status === 401) {
      await signOutAndClear();
      const err = new Error("登錄已過期，請重新登錄");
      err.name = "SessionExpired";
      throw err;
    }

    return retryRes;
  }

  return res;
}

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
