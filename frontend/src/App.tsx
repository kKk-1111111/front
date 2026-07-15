import { useRef, useState, useCallback } from "react";
import { Login } from "./components/Login";
import { AuthUser } from "./lib/supabase";
import { ocrClient, getLastJobId, saveLastJobId, clearLastJobId } from "./lib/ocrClient";
import { analyze } from "./lib/aiAnalysis";
import { exportDocx } from "./lib/wordExport";
import { ProgressPanel } from "./components/ProgressPanel";
import { JobState, OcrApiError } from "./types";

type LogLine = { t: string; msg: string; err?: boolean };

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dpi, setDpi] = useState(120);
  const [engine, setEngine] = useState("auto");
  const [emailTitle, setEmailTitle] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const [job, setJob] = useState<JobState | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [analysis, setAnalysis] = useState<{ provider: string; content: string; cached: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const log = useCallback((msg: string, err = false) => {
    setLogs((prev) => [{ t: new Date().toLocaleTimeString(), msg, err }, ...prev].slice(0, 200));
  }, []);

  const showError = useCallback((e: unknown) => {
    if (e instanceof OcrApiError) {
      log(`錯誤(${e.httpStatus}): ${e.message}`, true);
    } else {
      log(`錯誤: ${(e as Error).message}`, true);
    }
  }, [log]);

  // Clear all state — called on user change / logout
  const clearAllState = useCallback(() => {
    // Stop polling
    abortRef.current?.abort();
    abortRef.current = null;
    // Clear all data
    setJob(null);
    setJobId(null);
    setOcrText("");
    setAnalysis(null);
    setEmailTitle("");
    setEmailBody("");
    setLogs([]);
    setFile(null);
    setBusy(false);
  }, []);

  // Handle auth change
  const handleAuthChange = useCallback((u: AuthUser | null) => {
    // Clear previous user's state BEFORE setting new user
    clearAllState();
    setAuthUser(u);
    if (u) {
      log(`已登錄: ${u.email}`);
      // Load this user's lastJobId
      const last = getLastJobId(u.id);
      if (last) {
        log(`發現上次任務: ${last}`);
        // Continue querying: GET /jobs/{id} → if completed → GET /text
        resumeLastJob(last, u.id);
      }
    } else {
      log("已退出登錄，清除所有數據");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, clearAllState]);

  const onFinished = useCallback(async (s: JobState) => {
    // Verify the callback's user is still current
    if (!authUser || s.job_id !== jobId) return;
    try {
      const text = await ocrClient.text(s.job_id);
      if (text.length > 0) {
        setOcrText(text);
        log(`已取得完整文本，長度 ${text.length}`);
      } else {
        log(`警告：GET /text 返回空文本（status=${s.status}）`, true);
      }
    } catch (e) {
      if (e instanceof OcrApiError && e.message === "polling aborted") return;
      // Log HTTP status and error/stage without exposing JWT or OCR content
      if (e instanceof OcrApiError) {
        log(`GET /text 失敗 HTTP ${e.httpStatus}: ${e.message}`, true);
      } else {
        log(`GET /text 失敗: ${(e as Error).message}`, true);
      }
    }
  }, [authUser, jobId, log, showError]);

  // Resume last job after login refresh — GET /jobs/{id} then if completed GET /text
  const resumeLastJob = useCallback(async (jid: string, userId: string) => {
    setJobId(jid);
    try {
      const s = await ocrClient.status(jid);
      setJob(s);
      log(`上次任務狀態: ${s.status}`);

      if (ocrClient.isTerminal(s.status)) {
        log(`任務已完成，正在取得文本...`);
        // Must call GET /text — don't use partial_text_chars as content
        try {
          const text = await ocrClient.text(jid);
          if (text.length > 0) {
            setOcrText(text);
            log(`已取得完整文本，長度 ${text.length}`);
          } else {
            log(`警告：GET /text 返回空文本（status=${s.status}）`, true);
          }
        } catch (e) {
          if (e instanceof OcrApiError) {
            log(`GET /text 失敗 HTTP ${e.httpStatus}: ${e.message}`, true);
          } else {
            log(`GET /text 失敗: ${(e as Error).message}`, true);
          }
        }
      } else {
        startPolling(jid);
      }
    } catch (e) {
      if (e instanceof OcrApiError && e.httpStatus === 404) {
        log(`上次任務不存在或已被清理（404）`, true);
        clearLastJobId(userId);
      } else if (e instanceof OcrApiError && e.httpStatus === 401) {
        log(`登錄已過期，請重新登錄`, true);
        handleAuthChange(null);
      } else {
        showError(e);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, showError, handleAuthChange]);

  const startPolling = useCallback(async (id: string) => {
    // Stop previous polling
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJobId(id);
    try {
      const final = await ocrClient.poll(id, (s) => {
        // Verify user hasn't changed before updating UI
        if (authUser) setJob(s);
      }, ctrl.signal);
      log(`輪詢結束：status=${final.status}`);
      if (final.status !== "failed") await onFinished(final);
    } catch (e) {
      if (e instanceof OcrApiError && e.message === "polling aborted") return;
      if (e instanceof Error && e.message.includes("登錄已過期")) {
        log("登錄已過期，請重新登錄", true);
        handleAuthChange(null);
        return;
      }
      showError(e);
    }
  }, [authUser, log, onFinished, showError, handleAuthChange]);

  const onUpload = useCallback(async () => {
    if (!file || !authUser) return;
    setBusy(true); setOcrText(""); setAnalysis(null);
    log(`上傳中：${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
    try {
      const res = await ocrClient.upload(file, { dpi, ocr_engine: engine, email_title: emailTitle, email_body: emailBody });
      log(`已建立任務 job_id=${res.job_id}`);
      saveLastJobId(authUser.id, res.job_id);
      startPolling(res.job_id);
    } catch (e) {
      if (e instanceof Error && e.message.includes("登錄已過期")) {
        log("登錄已過期，請重新登錄", true);
        handleAuthChange(null);
        return;
      }
      showError(e);
    } finally { setBusy(false); }
  }, [file, authUser, dpi, engine, emailTitle, emailBody, log, showError, startPolling, handleAuthChange]);

  const onAnalyze = useCallback(async () => {
    if (!jobId || !authUser) return;
    setBusy(true);
    log(`AI 分析中...`);
    try {
      const out = await analyze(jobId);
      setAnalysis(out);
      log(`AI 分析完成（provider=${out.provider}）`);
    } catch (e) {
      if (e instanceof Error && e.message.includes("登錄已過期")) {
        handleAuthChange(null);
        return;
      }
      showError(e);
    } finally { setBusy(false); }
  }, [jobId, authUser, log, showError, handleAuthChange]);

  const onExport = useCallback(async () => {
    const name = job?.file_name || "ocr-result";
    await exportDocx(name, ocrText, analysis?.content);
    log("已匯出 Word");
  }, [job, ocrText, analysis, log]);

  const onSignOut = useCallback(() => {
    if (authUser) clearLastJobId(authUser.id);
    clearAllState();
    handleAuthChange(null);
  }, [authUser, clearAllState, clearLastJobId, handleAuthChange]);

  // If not logged in, show only login
  if (!authUser) {
    return (
      <>
        <header><h1>PDF OCR + AI 分析</h1></header>
        <div className="wrap"><Login onAuthChange={handleAuthChange} /></div>
      </>
    );
  }

  return (
    <>
      <header>
        <h1>PDF OCR + AI 分析</h1>
        <div className="sub">用戶: {authUser.email} <button className="sec" onClick={onSignOut} style={{marginLeft:10,padding:"2px 8px"}}>退出</button></div>
      </header>
      <div className="wrap">
        <Login onAuthChange={handleAuthChange} />

        <div className="card">
          <h2>1. 上傳 PDF</h2>
          <div className="row">
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <label>dpi</label>
            <input type="number" value={dpi} style={{ width: 70 }} onChange={(e) => setDpi(parseInt(e.target.value, 10) || 120)} />
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              <option value="auto">auto</option>
              <option value="tesseract">tesseract</option>
              <option value="rapidocr">rapidocr</option>
            </select>
            <button onClick={onUpload} disabled={busy || !file}>上傳並開始 OCR</button>
          </div>
          <div className="row">
            <label>郵件標題</label>
            <input type="text" value={emailTitle} onChange={(e) => setEmailTitle(e.target.value)} placeholder="Email Title（可選）" style={{ minWidth: 300 }} />
          </div>
          <div className="row">
            <label>郵件正文</label>
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder="Email Body（可選）" style={{ minHeight: 60, width: "100%" }} />
          </div>
        </div>

        {job && <ProgressPanel s={job} />}

        <div className="card">
          <h2>2. OCR 文本 <span className="pill">{ocrText.length}</span></h2>
          <textarea value={ocrText} readOnly placeholder="OCR 文本" />
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={onAnalyze} disabled={ocrText.length === 0 || busy}>AI 分析</button>
            <button className="sec" onClick={onExport} disabled={ocrText.length === 0}>匯出 Word</button>
          </div>
          <h2 style={{ marginTop: 14 }}>AI 分析結果</h2>
          <textarea value={analysis?.content ?? ""} readOnly placeholder="AI 分析結果" />
        </div>

        <div className="card">
          <h2>日誌</h2>
          <div className="log">
            {logs.map((l, i) => (
              <div key={i} className={l.err ? "l-err" : ""}>[{l.t}] {l.msg}</div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
