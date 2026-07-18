// ReplayPanel — the right-pane companion to the chart's Replay layer.
//
// A replay run is a rich object (a day of forecasts, each with a written read and a
// graded score), so it lives in the right pane, not a chip dropdown. This panel owns
// run SELECTION and DETAIL: pick a saved run, see its hit-rate, and read each call
// with its verdict badge + a deterministic "score it" for any unscored call. The
// chart draws the same run's calls as markers (driven by the shared selected run id).
//
// Read-only w.r.t. Mira: listing/loading/scoring are the deterministic code paths
// (getReplayRuns / getReplayRun / scoreSpxForecast). Generating a NEW run (which
// calls Mira per step) is intentionally NOT here.
import { cls, LoadBar } from "./util.jsx";
import { useLive, getReplayRuns, getReplayRun, scoreSpxForecast,
  planReplay, getSpxSnapshot, saveSpxForecast, scoreReplay, calibrateReplay,
  streamTurn } from "./live.js";
import { parseMira, MiraRender } from "./mira-render.jsx";

const { useState, useEffect, useRef, useCallback } = React;

// symbols the replay generator can forecast (needs a coach snapshot / GEX chain).
const REPLAY_SYMBOLS = ["SPX", "QQQ", "IWM"];

function verdictTone(sc) {
  if (!sc) return "plain";
  if (sc.verdict === "hit target" || sc.verdict === "direction correct") return "good";
  if (sc.verdict === "invalidated" || sc.verdict === "direction wrong") return "bad";
  return "plain";
}

// one call in the run: time · price · verdict badge (or a score button) + expandable read.
function CallRow({ f, onScore, scoring, active, onActivate }) {
  const [open, setOpen] = useState(false);
  const sc = f.score;
  const tone = verdictTone(sc);
  return (
    <div className={cls("vg-rp-call", active && "on")}>
      <div className="vg-rp-callhead" onClick={() => onActivate(active ? null : f.id)}
        title={active ? "stop highlighting on chart" : "highlight this call on the chart"}>
        <span className="vg-rp-time">{String(f.as_of || "").slice(11, 16)}</span>
        <span className="vg-rp-px">@ {f.price_at}</span>
        {sc
          ? <span className={cls("vg-badge", tone)} style={{ fontSize: 11 }}>
              {sc.verdict}{sc.moved_pt != null ? ` · ${sc.moved_pt >= 0 ? "+" : ""}${sc.moved_pt}pt` : ""}
            </span>
          : <button className="vg-btn-sm" disabled={scoring === f.id}
              onClick={(e) => { e.stopPropagation(); onScore(f.id); }}>
              {scoring === f.id ? "…" : "score it"}
            </button>}
        <span className="vg-rp-caret" title="show the written read"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && <div className="vg-rp-callbody"><MiraRender data={f.forecast} text={f.forecast_text} /></div>}
    </div>
  );
}

export function ReplayPanel({ symbol, runId, setRunId, activeCallId, setActiveCallId }) {
  const [scoring, setScoring] = useState(null);
  const [nonce, setNonce] = useState(0);
  // declared up here so the auto-select effect can avoid fighting an in-flight
  // generate (a just-minted run isn't in the runs list yet).
  const runningRef = useRef(false);
  const genRunRef = useRef(null);   // the run_id currently being generated (if any)

  const runsQ = useLive(() => getReplayRuns(40), null, [nonce]);
  const runs = ((runsQ.data && runsQ.data.runs) || [])
    .filter((r) => String(r.symbol || "").toUpperCase() === String(symbol || "").toUpperCase());
  // default to the LATEST session (runs are newest-first by created_at) when nothing
  // is selected — so the panel opens on the most recent replay, no manual pick. Do
  // NOT override a run that's actively generating (not yet in the list) or an
  // explicit selection; only fill the initial blank.
  useEffect(() => {
    if (!runs.length || runId || runningRef.current || genRunRef.current) return;
    setRunId(runs[0].run_id);
  }, [runs, runId]);

  const runQ = useLive(() => (runId ? getReplayRun(runId) : Promise.resolve(null)), null, [runId, nonce]);
  const detail = runQ.data && runQ.data.available ? runQ.data : null;
  const forecasts = (detail && detail.forecasts) || [];
  const cal = detail && detail.calibration;

  // deterministic per-call scoring (no Mira). Re-pull the run when it completes.
  const score = (fid) => {
    setScoring(fid);
    scoreSpxForecast(fid).then(() => setNonce((n) => n + 1)).finally(() => setScoring(null));
  };

  // hit-rate straight from the scored calls (fallback when there's no calibration).
  const scored = forecasts.filter((f) => f.score);
  const hits = scored.filter((f) => verdictTone(f.score) === "good").length;
  const hitRate = scored.length ? Math.round((hits / scored.length) * 100) : null;

  // ── GENERATE a new run (calls Mira per step) ────────────────────────────────
  // Serial: plan → for each interval, stream one Mira forecast, save it, bump the
  // run refetch so the new call streams into the list + its marker onto the chart
  // (no page reload — React re-renders the panel). Then score with code. A Stop +
  // resume (skips already-saved steps). Grade is a separate Mira turn (narrative).
  const [gen, setGen] = useState(null);   // {status, total, done, day} | null
  const [showGen, setShowGen] = useState(false);
  const [genDay, setGenDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [stepMin, setStepMin] = useState(60);
  const [note, setNote] = useState(null);
  const [grade, setGrade] = useState(null);   // {loading, text, error}
  const [gradeOpen, setGradeOpen] = useState(true);
  const stopRef = useRef(false);
  const abortRef = useRef(null);
  useEffect(() => () => { stopRef.current = true; if (abortRef.current) abortRef.current(); }, []);

  const forecastStep = useCallback((asOf, rid, day) => new Promise((resolve) => {
    getSpxSnapshot(day, asOf, symbol).then((snapEnv) => {
      const snapshot = snapEnv && snapEnv.available ? snapEnv : null;
      if (!snapshot) { resolve(false); return; }
      let text = "";
      const ref = `SPX_SNAPSHOT_REF day=${day} as_of=${asOf} underlying=${symbol}`;
      const prompt = `What will ${symbol} price do from here? Reason over the snapshot and give a structured, scoreable forecast (bias, expected path, level targets, invalidation, confidence).\n${ref}`;
      abortRef.current = streamTurn(prompt, `replay-${symbol}-${day}-${asOf}`, (evt) => {
        if (evt.kind === "error") { resolve(false); return; }
        if ((evt.kind === "token" || evt.kind === "delta" || evt.kind === "message") && evt.text) { text += evt.text; return; }
        if (evt.kind === "done") {
          abortRef.current = null;
          if (evt.text && !text) text = evt.text;
          const data = parseMira(text);
          saveSpxForecast({ day, as_of: asOf, symbol, snapshot, forecast: data || null,
            forecast_text: text, run_id: rid })
            .then(() => resolve(true)).catch(() => resolve(false));
        }
      });
    }).catch(() => resolve(false));
  }), [symbol]);

  const generate = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setNote(null); setGrade(null); stopRef.current = false;
    setGen({ status: "planning", total: 0, done: 0, day: genDay });
    planReplay(genDay, symbol, false, stepMin).then(async (plan) => {
      if (!plan || !plan.available) {
        setGen(null); setNote((plan && plan.note) || "Couldn't plan a run for that day.");
        runningRef.current = false; return;
      }
      const rid = plan.run_id;
      genRunRef.current = rid;
      setRunId(rid); setActiveCallId(null); setShowGen(false);
      const steps = plan.steps || [];
      let existing = [];
      try { const g = await getReplayRun(rid); existing = (g && g.forecasts) || []; } catch (e) { /* */ }
      const done0 = new Set(existing.map((f) => f.as_of));
      setGen({ status: "running", total: steps.length, done: done0.size, day: genDay });
      let stopped = false;
      for (let k = 0; k < steps.length; k++) {
        if (stopRef.current) { stopped = true; break; }
        const asOf = steps[k].as_of;
        if (!done0.has(asOf)) {
          setGen((g) => ({ ...g, at: String(asOf).slice(11, 16) }));
          await forecastStep(asOf, rid, genDay);
          setNonce((x) => x + 1);   // the new call streams into the list + onto the chart
        }
        setGen((g) => ({ ...g, done: k + 1 }));
      }
      if (!stopped) {
        try { await scoreReplay(rid); } catch (e) { /* score-later is fine */ }
        setGen((g) => ({ ...(g || {}), status: "done", done: steps.length, total: steps.length }));
        setNonce((x) => x + 1);
      } else {
        setGen((g) => ({ ...(g || {}), status: "stopped" }));
      }
    }).catch((e) => { setGen(null); setNote(String((e && e.message) || e)); })
      .finally(() => { runningRef.current = false; genRunRef.current = null; setNonce((x) => x + 1); });
  }, [genDay, stepMin, symbol, forecastStep, setRunId, setActiveCallId]);

  const stopGen = useCallback(() => {
    stopRef.current = true; runningRef.current = false;
    if (abortRef.current) abortRef.current();
    setGen((g) => (g ? { ...g, status: "stopped" } : g));
  }, []);

  // GRADE: code calibration first, then stream Mira's run-level narrative and
  // persist it. This is the "analysis of the replay" — the day's story.
  const gradeRun = useCallback(() => {
    if (!runId) return;
    setGrade({ loading: true, text: "" }); setGradeOpen(true);
    calibrateReplay(runId).then(() => {
      let text = "";
      const ref = `FORECAST_GRADE_REF run_id=${runId}`;
      const prompt = `Grade this replay forecast run — how did the analyst's read evolve through the day? Read the code-computed scores and narrate them.\n${ref}`;
      abortRef.current = streamTurn(prompt, `grade-${runId}`, (evt) => {
        if (evt.kind === "error") { setGrade({ error: evt.message || "Mira error" }); return; }
        if ((evt.kind === "token" || evt.kind === "delta" || evt.kind === "message") && evt.text) {
          text += evt.text; setGrade({ loading: true, text }); return;
        }
        if (evt.kind === "done") {
          abortRef.current = null;
          if (evt.text && !text) text = evt.text;
          const data = parseMira(text);
          setGrade({ text, data });
          const narrative = (data && data.headline) || (text || "").replace(/\s+/g, " ").slice(0, 800) || null;
          calibrateReplay(runId, { narrative }).then(() => setNonce((x) => x + 1)).catch(() => setNonce((x) => x + 1));
        }
      });
    }).catch((e) => setGrade({ error: String((e && e.message) || e) }));
  }, [runId]);

  const genBusy = gen && (gen.status === "planning" || gen.status === "running");
  // the run-level grade narrative: live stream, or the persisted calibration prose.
  const gradeText = (grade && grade.text) || (cal && cal.narrative) || null;

  // the "new replay" controls + generate progress — shown whether or not runs exist.
  const genControls = (
    <div className="vg-rp-gen">
      {!showGen && !genBusy && (
        <button className="vg-btn-sm" onClick={() => setShowGen(true)}>＋ New replay</button>)}
      {showGen && !genBusy && (
        <div className="vg-rp-genform">
          <input type="date" className="vg-rp-date" value={genDay}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setGenDay(e.target.value)} />
          <select className="vg-rp-step" value={stepMin} onChange={(e) => setStepMin(Number(e.target.value))}>
            <option value={30}>30m</option>
            <option value={60}>1h</option>
          </select>
          <button className="vg-btn-sm on" onClick={generate}
            title={`Forecast ${symbol} across ${genDay} — calls Mira per step`}>Generate</button>
          <button className="vg-btn-sm" onClick={() => setShowGen(false)}>cancel</button>
        </div>)}
      {genBusy && (
        <div className="vg-rp-genprog">
          <span className="vg-note">
            {gen.status === "planning" ? "planning…"
              : `forecasting ${gen.done}/${gen.total}${gen.at ? ` · ${gen.at}` : ""}`}
          </span>
          <button className="vg-btn-sm" onClick={stopGen}>Stop</button>
        </div>)}
      {note && <p className="vg-note vg-rp-gennote">{note}</p>}
    </div>);

  if (!runs.length) {
    return (
      <div className="vg-rp">
        <div className="vg-rp-head"><span className="vg-rp-title">Replay · {symbol}</span></div>
        {genControls}
        {!REPLAY_SYMBOLS.includes(String(symbol || "").toUpperCase()) && (
          <p className="vg-note" style={{ padding: "4px 14px" }}>
            Replay needs a coach snapshot — SPX / QQQ / IWM.
          </p>)}
        {REPLAY_SYMBOLS.includes(String(symbol || "").toUpperCase()) && !genBusy && (
          <p className="vg-note" style={{ padding: "4px 14px" }}>
            No saved runs for {symbol}. Generate one — it steps the day and forecasts at each interval.
          </p>)}
      </div>);
  }

  return (
    <div className="vg-rp">
      <div className="vg-rp-head">
        <span className="vg-rp-title">Replay · {symbol}</span>
        <select className="vg-rp-runpick" value={runId || ""}
          onChange={(e) => { setRunId(e.target.value || null); setActiveCallId(null); }}>
          {runs.map((r, i) => (
            <option key={r.run_id} value={r.run_id}>
              {r.day}{i === 0 ? " (latest)" : ""} · {r.n} calls{r.n_scored ? ` · ${r.n_scored} scored` : ""}
            </option>))}
        </select>
      </div>

      {genControls}
      {runsQ.loading && <LoadBar />}

      {runId && runQ.loading && !genBusy && <LoadBar />}
      {detail && (
        <>
          <div className="vg-rp-summary">
            <span className="vg-rp-day">{detail.forecasts[0] && detail.forecasts[0].day}</span>
            <span className="vg-rp-stat">{forecasts.length} calls · {scored.length} scored</span>
            {hitRate != null && (
              <span className={cls("vg-badge", hitRate >= 50 ? "good" : "bad")}>
                {hitRate}% hit
              </span>)}
          </div>

          {/* run-level analysis (Mira's grade) — a collapsible block ATOP the calls.
              Show the streamed/persisted narrative if present; else a Grade button. */}
          <div className="vg-rp-gradeblock">
            <div className="vg-rp-gradehead">
              <span className="vg-rp-gradelabel"
                onClick={() => gradeText && setGradeOpen((v) => !v)}
                style={{ cursor: gradeText ? "pointer" : "default" }}>
                {gradeText && <span className="vg-rp-caret">{gradeOpen ? "▾" : "▸"}</span>}
                Run analysis
              </span>
              {(grade && grade.loading)
                ? <span className="vg-note" style={{ marginLeft: "auto" }}>grading…</span>
                : <button className="vg-btn-sm" style={{ marginLeft: "auto" }}
                    onClick={gradeRun} disabled={!!genBusy}>
                    {gradeText ? "re-grade" : "grade run"}
                  </button>}
            </div>
            {grade && grade.error && <p className="vg-note vg-rp-gennote">{grade.error}</p>}
            {gradeText && gradeOpen && (
              <div className="vg-rp-grade">
                {grade && grade.data
                  ? <MiraRender data={grade.data} text={grade.text} />
                  : <MiraRender text={gradeText} />}
              </div>)}
            {!gradeText && !(grade && grade.loading) && (
              <p className="vg-note vg-rp-gradehint">How did the read evolve across the day? Grade it for Mira's narrative.</p>)}
          </div>

          <div className="vg-rp-calls">
            {forecasts.map((f) => (
              <CallRow key={f.id} f={f} onScore={score} scoring={scoring}
                active={activeCallId === f.id} onActivate={setActiveCallId} />
            ))}
          </div>
        </>)}
    </div>
  );
}
