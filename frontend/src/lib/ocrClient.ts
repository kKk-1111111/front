// ocrClient.ts — all OCR backend calls via authFetch (Bearer JWT, no URL token)

import { config } from "../config";
import { authFetch, authFetchJSON, authFetchText } from "./authFetch";
import { JobState, ResultResponse, UploadOptions, UploadResponse } from "../types";

const TERMINAL: JobState["status"][] = ["completed", "completed_with_errors", "failed"];

function base(): string { return config.baseUrl; }

export const ocrClient = {
  isTerminal: (s: JobState["status"]) => TERMINAL.includes(s),

  // POST /jobs/upload — multipart file upload
  // On 401: authFetch refreshes token and retries automatically
  // BUT: file upload can't be safely retried (body is consumed).
  // So we use isRetry=true to prevent auto-retry for upload.
  // If 401, authFetch will signOut and throw — user re-clicks upload.
  async upload(file: File, opts: UploadOptions = {}): Promise<UploadResponse> {
    const d = config.uploadDefaults;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("file_name", opts.file_name ?? file.name ?? "upload.pdf");
    fd.append("dpi", String(opts.dpi ?? d.dpi));
    fd.append("ocr_engine", opts.ocr_engine ?? d.ocr_engine);
    fd.append("page_timeout", String(opts.page_timeout ?? d.page_timeout));
    fd.append("max_pages", String(opts.max_pages ?? d.max_pages));
    if (opts.page_start != null) fd.append("page_start", String(opts.page_start));
    if (opts.page_end != null) fd.append("page_end", String(opts.page_end));
    if (opts.langs) fd.append("langs", opts.langs);
    if (opts.email_title) fd.append("email_title", opts.email_title);
    if (opts.email_body) fd.append("email_body", opts.email_body);
    // NOTE: no owner_id in body — backend gets it from JWT sub
    // NOTE: isUpload=true → 401 refreshes token but doesn't retry (file consumed)
    const res = await authFetch(`${base()}/jobs/upload`, { method: "POST", body: fd }, true);
    if (!res.ok) {
      let body: any = null; try { body = await res.json(); } catch {}
      const err = new Error(body?.error || `HTTP ${res.status}`);
      (err as any).httpStatus = res.status;
      throw err;
    }
    const data = (await res.json()) as UploadResponse;
    return data;
  },

  // POST /jobs — URL upload (small JSON, safe to retry)
  async uploadFromUrl(url: string, opts: UploadOptions = {}): Promise<UploadResponse> {
    const d = config.uploadDefaults;
    const body = {
      file_url: url,
      file_name: opts.file_name || url.split("/").pop() || "remote.pdf",
      dpi: opts.dpi ?? d.dpi,
      ocr_engine: opts.ocr_engine ?? d.ocr_engine,
      page_timeout: opts.page_timeout ?? d.page_timeout,
      max_pages: opts.max_pages ?? d.max_pages,
      page_start: opts.page_start,
      page_end: opts.page_end,
      langs: opts.langs,
      email_title: opts.email_title || "",
      email_body: opts.email_body || "",
      // NOTE: no owner_id — backend reads from JWT
    };
    return await authFetchJSON<UploadResponse>(`${base()}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  // GET /jobs — list user's own jobs only
  async listJobs(limit = 50): Promise<{ jobs: JobState[] }> {
    return await authFetchJSON(`${base()}/jobs?limit=${limit}`);
  },

  // GET /jobs/{id}
  async status(jobId: string, _signal?: AbortSignal): Promise<JobState> {
    const res = await authFetch(`${base()}/jobs/${encodeURIComponent(jobId)}`, {}, false);
    if (!res.ok) {
      let body: any = null; try { body = await res.json(); } catch {}
      const err = new Error(body?.error || `HTTP ${res.status}`);
      (err as any).httpStatus = res.status;
      throw err;
    }
    return await res.json();
  },

  // GET /jobs/{id}/text
  async text(jobId: string, sep = true): Promise<string> {
    const q = sep ? "" : "?sep=false";
    return await authFetchText(`${base()}/jobs/${encodeURIComponent(jobId)}/text${q}`);
  },

  // GET /jobs/{id}/result
  async result(jobId: string): Promise<ResultResponse> {
    return await authFetchJSON(`${base()}/jobs/${encodeURIComponent(jobId)}/result`);
  },

  // POST /jobs/{id}/resume
  async resume(jobId: string, body: Record<string, unknown> = {}): Promise<any> {
    return await authFetchJSON(`${base()}/jobs/${encodeURIComponent(jobId)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  // DELETE /jobs/{id}
  async deleteJob(jobId: string): Promise<any> {
    return await authFetchJSON(`${base()}/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    });
  },

  // GET /dependencies (public, no auth needed)
  async dependencies(): Promise<any> {
    const res = await fetch(`${base()}/dependencies`);
    return await res.json();
  },

  // Poll with auth — stops on 401/404, uses AbortController
  async poll(jobId: string, onTick: (s: JobState) => void, signal?: AbortSignal): Promise<JobState> {
    let consecutiveErrors = 0;
    while (true) {
      if (signal?.aborted) throw new Error("polling aborted");
      try {
        const s = await this.status(jobId, signal);
        onTick(s);
        consecutiveErrors = 0;
        if (this.isTerminal(s.status)) return s;
      } catch (e: any) {
        // Stop polling on 401 or 404
        if (e.httpStatus === 401 || e.httpStatus === 404) throw e;
        consecutiveErrors++;
        if (consecutiveErrors >= 10) throw e;
      }
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }
  },
};

// lastJobId is now per-user: ocr:lastJobId:<user_id>
export function getLastJobId(userId: string): string | null {
  try { return localStorage.getItem(`ocr:lastJobId:${userId}`); } catch { return null; }
}
export function saveLastJobId(userId: string, jobId: string) {
  try { localStorage.setItem(`ocr:lastJobId:${userId}`, jobId); } catch {}
}
export function clearLastJobId(userId: string) {
  try { localStorage.removeItem(`ocr:lastJobId:${userId}`); } catch {}
}
