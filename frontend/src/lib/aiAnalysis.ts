// aiAnalysis.ts — calls backend POST /analyze via authFetch (JWT, no key in frontend)

import { config } from "../config";
import { authFetch } from "./authFetch";

export interface AnalysisResult {
  provider: string;
  content: string;
  cached: boolean;
}

export async function analyze(jobId: string): Promise<AnalysisResult> {
  if (!jobId) throw new Error("沒有 job_id");

  const fd = new FormData();
  fd.append("job_id", jobId);

  const res = await authFetch(`${config.baseUrl}/analyze`, { method: "POST", body: fd });
  if (!res.ok) {
    let body: any = null; try { body = await res.json(); } catch {}
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    provider: data.provider || "unknown",
    content: data.content || "",
    cached: data.cached || false,
  };
}
