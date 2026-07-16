// SpxForecastPanel — "what will price do?" on demand.
//
// Pulls the chart-centric snapshot (price + coach levels + technicals + ICT),
// asks Mira's spx_analyst (via a SPX_SNAPSHOT_REF line so Mira fetches the
// snapshot itself), renders the structured forecast with the shared MiraRender,
// persists it, and lists prior forecasts with their accuracy score. The score is
// computed against elapsed price action — so you can see whether the read held.
import { cls, LoadBar } from "./util.jsx";
import { parseMira, MiraRender } from "./mira-render.jsx";
import {
  useLive, streamTurn, getSpxSnapshot, saveSpxForecast,
  getSpxForecasts, scoreSpxForecast,
} from "./live.js";

const { useState, useRef, useEffect } = React;

// A compact read of the snapshot's ICT context (so you see what Mira reasoned on).
function SnapshotHead({ s }) {
  if (!s) return null;
  const t = s.technicals || {};
  const ic = s.ict || {};
  const draw = ic.draw || {};
  return (
    <div className="vg-fc-head">
      <div className="vg-fc-price">
        <b>{s.price}</b>
        <span className="vg-note">{s.day} · {String(s.as_of || "").slice(11, 16)} ET</span>
      </div>
      <div className="vg-fc-tape">
        VWAP {t.vwap} ({t.vs_vwap_pt >= 0 ? "+" : ""}{t.vs_vwap_pt}) · RSI {t.rsi} · vol {t.rel_volume}×
        {draw.dir ? <> · draw {draw.dir} → <b>{draw.level}</b> ({draw.dist}pt)</> : null}
      </div>
    </div>
  );
}

// One stored forecast row (collapsible), with its score badge.
function ForecastRow({ f, onScore, scoring }) {
  const [open, setOpen] = useState(false);
  const sc = f.score;
  const tone = !sc ? "plain"
    : sc.verdict === "hit target" || sc.verdict === "direction correct" ? "good"
    : sc.verdict === "invalidated" || sc.verdict === "direction wrong" ? "bad" : "plain";
  return (
    <div className="vg-fc-row">
      <div className="vg-fc-rowhead" onClick={() => setOpen((v) => !v)}>
        <span className="vg-note">{f.day} · {String(f.as_of || "").slice(11, 16)}</span>
        <span className="vg-fc-price-sm">@ {f.price_at}</span>
        {sc
          ? <span className={cls("vg-badge", tone)} style={{ fontSize: 11 }}>{sc.verdict}{sc.moved_pt != null ? ` · ${sc.moved_pt >= 0 ? "+" : ""}${sc.moved_pt}pt` : ""}</span>
          : <button className="vg-btn-sm" disabled={scoring === f.id}
              onClick={(e) => { e.stopPropagation(); onScore(f.id); }}>
              {scoring === f.id ? "…" : "score it"}
            </button>}
        <span className="vg-fc-caret">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="vg-fc-rowbody">
          <MiraRender data={f.forecast} text={f.forecast_text} />
        </div>
      )}
    </div>
  );
}

export function SpxForecastPanel({ symbol = "SPX" }) {
  const [nonce, setNonce] = useState(0);
  const snap = useLive(() => getSpxSnapshot(), null, [nonce]);
  const priors = useLive(() => getSpxForecasts(undefined, symbol, 30), null, [nonce]);
  const [read, setRead] = useState(null);     // {loading|text|data|error}
  const [scoring, setScoring] = useState(null);
  const abortRef = useRef(null);
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);

  const s = snap.data && snap.data.available ? snap.data : null;
  const busy = read && read.loading;

  const forecast = () => {
    if (!s) return;
    setRead({ loading: true });
    let text = "";
    // the ref line lets spx_analyst fetch the snapshot itself; the plain-English
    // ask routes it to that specialist.
    const ref = `SPX_SNAPSHOT_REF day=${s.day} as_of=${s.as_of} underlying=${symbol}`;
    const prompt = `What will ${symbol} price do from here? Reason over the snapshot and give a structured, scoreable forecast (bias, expected path, level targets, invalidation, confidence).\n${ref}`;
    abortRef.current = streamTurn(prompt, `spx-forecast-${s.day}-${s.as_of}`, (evt) => {
      if (evt.kind === "error") { setRead({ error: evt.message || "Mira error" }); return; }
      if (evt.kind === "delta") { text += evt.text || ""; setRead({ loading: true, text }); return; }
      if (evt.kind === "done") {
        abortRef.current = null;
        const data = parseMira(text);
        setRead({ text, data });
        // persist it so it compounds + can be scored later
        saveSpxForecast({
          day: s.day, as_of: s.as_of, symbol,
          snapshot: s, forecast: data || null, forecast_text: text,
        }).then(() => setNonce((n) => n + 1)).catch(() => {});
      }
    });
  };

  const score = (fid) => {
    setScoring(fid);
    scoreSpxForecast(fid).then(() => setNonce((n) => n + 1)).finally(() => setScoring(null));
  };

  return (
    <div className="vg-card vg-fc vg-loadhost" style={{ marginTop: 14 }}>
      {(snap.loading || busy) && <LoadBar />}
      <div className="vg-spread">
        <div className="vg-kicker" style={{ margin: 0 }}>What will price do? · SPX analyst</div>
        <button className="vg-btn-sm" disabled={busy || !s} onClick={forecast}>
          {busy ? <><span className="vg-spin" aria-hidden="true">⟳</span> Reading the tape…</> : "🔮 Forecast now"}
        </button>
      </div>

      {!s && !snap.loading && (
        <p className="vg-note" style={{ marginTop: 8 }}>
          {snap.data && snap.data.note ? snap.data.note : "No snapshot yet — needs the day's 1m bars."}
        </p>)}
      {s && <SnapshotHead s={s} />}

      {read && (read.error
        ? <p className="vg-note" style={{ marginTop: 8, color: "var(--vg-down)" }}>{read.error}</p>
        : (read.data || read.text)
          ? <div style={{ marginTop: 10 }}><MiraRender data={read.data} text={read.text} /></div>
          : read.loading ? <p className="vg-note" style={{ marginTop: 8 }}>Reasoning over the liquidity, draw, and structure…</p> : null)}

      {priors.data && priors.data.forecasts && priors.data.forecasts.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="vg-kicker">Prior forecasts</div>
          {priors.data.forecasts.map((f) => (
            <ForecastRow key={f.id} f={f} onScore={score} scoring={scoring} />
          ))}
        </div>
      )}
      <p className="vg-note" style={{ marginTop: 10, fontSize: 11, color: "var(--vg-dim)" }}>
        Levels are the nightly EOD estimate · 0DTE-blind · not advice.
      </p>
    </div>
  );
}
