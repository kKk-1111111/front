import { JobState } from "./types";

// Estimate remaining seconds from average time-per-processed-page.
export function estimateRemainingSeconds(s: JobState): number | null {
  if (!s.total_pages || s.processed_pages <= 0) return null;
  if (s.processed_pages >= s.total_pages) return 0;
  const avg = s.elapsed_seconds / s.processed_pages;
  const remainingPages = s.total_pages - s.processed_pages;
  return Math.round(avg * remainingPages);
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return "-";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s}s`;
}

export function progressPct(s: JobState): number {
  if (!s.total_pages) return 0;
  return Math.min(100, Math.round((100 * s.processed_pages) / s.total_pages));
}
