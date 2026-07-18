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
import { useLive, getReplayRuns, getReplayRun, scoreSpxForecast } from "./live.js";
import { parseMira, MiraRender } from "./mira-render.jsx";

const { useState } = React;

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

  const runsQ = useLive(() => getReplayRuns(40), null, [nonce]);
  const runs = ((runsQ.data && runsQ.data.runs) || [])
    .filter((r) => String(r.symbol || "").toUpperCase() === String(symbol || "").toUpperCase());
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

  if (!runs.length) {
    return (
      <div className="vg-rp">
        <p className="vg-note" style={{ padding: 14 }}>
          No saved replay runs for {symbol}. A replay steps a past day and forecasts at
          each interval — run one from the 0DTE Playbook, then it shows here.
        </p>
      </div>);
  }

  return (
    <div className="vg-rp">
      <div className="vg-rp-head">
        <span className="vg-rp-title">Replay · {symbol}</span>
        <select className="vg-rp-runpick" value={runId || ""}
          onChange={(e) => { setRunId(e.target.value || null); setActiveCallId(null); }}>
          <option value="">Pick a run…</option>
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {r.day} · {r.n} calls{r.n_scored ? ` · ${r.n_scored} scored` : ""}
            </option>))}
        </select>
      </div>

      {runsQ.loading && <LoadBar />}
      {!runId && <p className="vg-note" style={{ padding: "4px 14px" }}>Pick a run to see its calls on the chart.</p>}

      {runId && runQ.loading && <LoadBar />}
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
          {cal && cal.narrative && (
            <div className="vg-rp-grade"><MiraRender text={cal.narrative} /></div>)}
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
