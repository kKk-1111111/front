import { JobState } from "../types";
import { estimateRemainingSeconds, fmtDuration, progressPct } from "../utils";

export function ProgressPanel({ s }: { s: JobState }) {
  const pct = progressPct(s);
  const eta = estimateRemainingSeconds(s);
  const fails = (s.page_index || []).filter((p) => p.status === "failed");

  return (
    <div className="card">
      <h2>
        進度 · job_id: <code>{s.job_id}</code>
      </h2>
      <div className="row">
        <span className={`badge ${s.status}`}>{s.status}</span>
        <span>
          stage: <b>{s.stage || "-"}</b>
        </span>
        {s.partial_text_available && (
          <span style={{ color: "var(--green)" }}>● 已識別文本可預覽</span>
        )}
      </div>

      <div className="barwrap">
        <div className="bar" style={{ width: `${pct}%` }} />
      </div>

      <div className="grid">
        <Stat k="已處理 / 總頁" v={`${s.processed_pages} / ${s.total_pages ?? "?"}`} />
        <Stat
          k="當前頁 (耗時)"
          v={
            s.current_page == null
              ? "-"
              : `${s.current_page} (${fmtDuration(s.current_page_elapsed_seconds)})`
          }
        />
        <Stat k="總耗時" v={fmtDuration(s.elapsed_seconds)} />
        <Stat k="預計剩餘" v={eta == null ? "-" : fmtDuration(eta)} />
        <Stat k="已提取頁" v={String(s.extracted_pages)} />
        <Stat k="失敗頁" v={String(s.failed_pages)} />
        <Stat k="已識別字數" v={String(s.partial_text_chars)} />
        <Stat k="進度" v={`${pct}%`} />
      </div>

      {fails.length > 0 && (
        <div className="fail">
          <b>失敗頁 ({fails.length})：</b>{" "}
          {fails
            .map((p) => `第${p.page_number}頁 (${p.error || "未知錯誤"})`)
            .join("；")}
          <div className="hint">失敗頁不會阻止 AI 分析已提取的文本。</div>
        </div>
      )}

      {s.status === "failed" && s.error && (
        <div className="err" style={{ marginTop: 8 }}>
          任務失敗：{s.error}
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
