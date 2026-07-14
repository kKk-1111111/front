// config.ts — frontend configuration
// NO API_TOKEN, NO DEEPSEEK_KEY. Auth via Supabase JWT only.
// Backend URL: production uses ONLY VITE_OCR_API_BASE_URL (build-time).
// Dev mode: can be overridden via localStorage, but origin is validated at request time.

const DEFAULT_BASE = "https://11aaaaaa-new-ocr.hf.space";

function readLS(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function isDevMode(): boolean {
  return import.meta.env.DEV === true || import.meta.env.MODE === "development";
}

export const config = {
  get baseUrl(): string {
    // Production: ONLY from build-time env, ignore localStorage
    const envVal = import.meta.env.VITE_OCR_API_BASE_URL;
    if (!isDevMode()) {
      return (envVal || DEFAULT_BASE).replace(/\/+$/, "");
    }
    // Dev: allow localStorage override for testing
    const ls = readLS("OCR_API_BASE_URL");
    const chosen = (ls && ls.trim()) || (envVal && envVal.trim()) || DEFAULT_BASE;
    return chosen.replace(/\/+$/, "");
  },

  // Only available in dev mode
  setBaseUrl(url: string) {
    if (!isDevMode()) return; // production: no-op
    try { localStorage.setItem("OCR_API_BASE_URL", url.trim()); } catch {}
  },

  get isDev(): boolean { return isDevMode(); },

  uploadDefaults: { dpi: 120, ocr_engine: "auto", page_timeout: 90, max_pages: 400 },
  pollIntervalMs: 3000,

  timeouts: {
    upload: 300_000,
    status: 30_000,
    text: 60_000,
    result: 60_000,
    resume: 30_000,
    deps: 15_000,
    analyze: 120_000,
  },
};
