// Shared types mirroring the backend API responses.

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed";

export interface PageInfo {
  page_number: number;
  page_type: "text_page" | "scanned_page" | "failed_page" | null;
  method: "text" | "tesseract" | "rapidocr" | "paddleocr" | null;
  status: "success" | "failed" | null;
  text_length: number;
  elapsed_seconds: number | null;
  error: string | null;
}

export interface JobState {
  job_id: string;
  status: JobStatus;
  stage: string | null;
  file_name: string | null;
  source: string | null;
  total_pages: number | null;
  processed_pages: number;
  extracted_pages: number;
  failed_pages: number;
  current_page: number | null;
  current_page_started_at: string | null;
  current_page_elapsed_seconds: number | null;
  elapsed_seconds: number;
  partial_text_available: boolean;
  partial_text_chars: number;
  params: Record<string, unknown>;
  page_index: PageInfo[];
  error: string | null;
}

export interface UploadResponse {
  job_id: string;
  status: JobStatus;
  status_url: string;
  result_url: string;
  text_url: string;
}

export interface ResultResponse extends JobState {
  text: string;
  text_chars: number;
  result_ready: boolean;
}

export interface UploadOptions {
  file_name?: string;
  dpi?: number;
  ocr_engine?: string;
  page_timeout?: number;
  max_pages?: number;
  page_start?: number;
  page_end?: number;
  langs?: string;
  email_title?: string;
  email_body?: string;
}

// Typed API error the UI can branch on.
export class OcrApiError extends Error {
  httpStatus: number;
  stage?: string;
  suggestion?: string;
  timeout?: boolean;
  path?: string;
  constructor(message: string, opts: Partial<OcrApiError> = {}) {
    super(message);
    this.name = "OcrApiError";
    this.httpStatus = opts.httpStatus ?? 0;
    this.stage = opts.stage;
    this.suggestion = opts.suggestion;
    this.timeout = opts.timeout;
    this.path = opts.path;
  }
}
