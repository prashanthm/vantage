// CockpitView — the 15-minute playbook ledger.
//
// Not a summary: the session as a sequence of 15-minute FRAMES, newest first.
// Each frame: the standing analyst CALL (bias/target/invalidation + whether it
// was made in this frame), what the MARKET did, how the call RESOLVED (the
// deterministic score, applied by the auto-loop once the frame elapsed), and
// what YOU did (fills + alignment + frame P&L). A date picker recalls any
// stored day — the ledger is fully derived from persisted forecasts, bars and
// fills, so history replays exactly.
//
// Signals/health stay on #/today; the tone strips + discipline commentary ride
// on top via ToneCompareCard. Deterministic renders only (ADR-008).
import { cls } from "./util.jsx";
import { useLive, getJson } from "./live.js";
import { ToneCompareCard } from "./today.jsx";

const { useState, useEffect } = React;

const backend = () => (JSON.parse(localStorage.getItem("vantage-settings") || "{}").backendUrl
  || "http://127.0.0.1:8641").replace(/\/+$/, "");
const getFrames = (day) =>
  getJson(`${backend()}/api/cockpit/frames${day ? `?day=${encodeURIComponent(day)}` : ""}`,
          { timeoutMs: 60000 });

const todayET = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

function biasTone(b) {
  const s = String(b || "").toLowerCase();
  if (s.includes("up") || s.includes("bull") || s.includes("long")) return "good";
  if (s.includes("down") || s.includes("bear") || s.includes("short")) return "bad";
  return "plain";
}
function verdictTone(v) {
  const s = String(v || "").toLowerCase();
  if (s.includes("hit") || s.includes("correct")) return "good";
  if (s.includes("invalid") || s.includes("wrong")) return "bad";
  return "plain";
}

function FrameRow({ f }) {
  const [open, setOpen] = useState(false);
  const c = f.call, m = f.market;
  return (
    <div className={cls("vg-fr", open && "open")}>
      <div className="vg-fr-head" onClick={() => setOpen(!open)}>
        <span className="vg-fr-t">{f.t}</span>
        <span className="vg-fr-mkt">
          {m ? (
            <>
              <span className={cls("vg-tone-cellmini", m.tone)} />
              <span className="vg-note" style={{ fontVariantNumeric: "tabular-nums" }}>
                {m.ret_pct > 0 ? "+" : ""}{m.ret_pct}% · {m.close}
              </span>
            </>
          ) : <span className="vg-note">—</span>}
        </span>
        <span className="vg-fr-call">
          {c ? (
            <>
              <span className={cls("vg-badge", biasTone(c.bias))} style={{ fontWeight: 700 }}>
                {String(c.bias || "?").toUpperCase()}{c.fresh ? "" : " ·"}
              </span>
              {c.fresh && <span className="vg-fr-fresh" title={`new call this frame @ ${c.minute}`} />}
              {c.target != null && <span className="vg-note">T {c.target}</span>}
              {c.invalidation != null && <span className="vg-note">✕ {c.invalidation}</span>}
              {c.born_invalid && <span className="vg-badge bad" style={{ fontSize: "var(--vg-text-xs)" }}>BORN-INVALID</span>}
            </>
          ) : <span className="vg-note">no call yet</span>}
        </span>
        <span className="vg-fr-res">
          {c && c.score
            ? <span className={cls("vg-badge", verdictTone(c.score.verdict))} style={{ fontSize: "var(--vg-text-xs)" }}>
                {c.score.verdict}{c.score.moved_pt != null ? ` ${c.score.moved_pt > 0 ? "+" : ""}${c.score.moved_pt}pt` : ""}
              </span>
            : c && c.fresh ? <span className="vg-note" style={{ fontSize: "var(--vg-text-xs)" }}>resolving…</span> : null}
        </span>
        <span className="vg-fr-you">
          {(f.trades || []).map((t, i) => (
            <span key={i} className="vg-tone-dot" title={`${t.time} ${t.label} · ${t.dir}${t.with_trend === false ? " · AGAINST" : t.with_trend ? " · with" : ""}${t.realized != null ? ` · ${money(t.realized)}` : ""}`}
              style={{ background: t.dir === "bullish" ? "var(--vg-up)" : "var(--vg-down)",
                       boxShadow: t.with_trend === false ? "0 0 0 2px var(--vg-warn)" : "none" }} />
          ))}
          {f.frame_pnl != null && f.frame_pnl !== 0 && (
            <b className={f.frame_pnl >= 0 ? "vg-up" : "vg-down"} style={{ fontSize: "var(--vg-text-sm)" }}>
              {money(f.frame_pnl)}</b>
          )}
        </span>
        <span className="vg-note">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="vg-fr-body">
          {c && (c.path || []).length > 0 && (
            <div className="vg-note" style={{ fontVariantNumeric: "tabular-nums" }}>
              call path: {c.path.map((s, i) => `${i + 1}·${s.price}${s.note ? ` ${String(s.note).slice(0, 24)}` : ""}`).join("  →  ")}
              {c.minute ? `  (made ${c.minute} @ ${c.price_at})` : ""}
            </div>
          )}
          {(f.trades || []).map((t, i) => (
            <div key={i} className="vg-note" style={{ marginTop: 3 }}>
              {t.time} — {t.label} · {t.dir}
              {t.with_trend === false ? " · AGAINST the tape" : t.with_trend ? " · with the tape" : ""}
              {t.realized != null ? ` · ${money(t.realized)}` : " · open"}
            </div>
          ))}
          {!c && !(f.trades || []).length && <span className="vg-note">quiet frame</span>}
        </div>
      )}
    </div>
  );
}

export function CockpitView({ refreshNonce }) {
  const [day, setDay] = useState(todayET());
  const isToday = day === todayET();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isToday) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 120000);
    return () => clearInterval(t);
  }, [isToday]);
  const q = useLive(() => getFrames(day), null, [day, tick, refreshNonce]);
  const d = q.data && q.data.available ? q.data : null;
  return (
    <div className="vg-pane-body">
      <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Cockpit</h2>
          <p className="vg-sub">The session, 15 minutes at a time — call · market · resolution · you</p>
        </div>
        <div className="vg-row" style={{ gap: 10, alignItems: "baseline" }}>
          {d && d.day_pnl != null && (
            <span className="vg-note">day <b className={d.day_pnl >= 0 ? "vg-up" : "vg-down"}>{money(d.day_pnl)}</b></span>
          )}
          <input type="date" className="vg-scan-filter" value={day} max={todayET()}
            onChange={(e) => setDay(e.target.value || todayET())} aria-label="Cockpit day" />
        </div>
      </div>

      <ToneCompareCard marketOpen={isToday} day={isToday ? undefined : day} />

      <div className="vg-card" style={{ marginTop: 14, padding: "10px 14px" }}>
        <div className="vg-kicker" style={{ marginBottom: 6 }}>
          Playbook ledger{d ? ` · ${d.frames.length} frames` : ""}
          <span className="vg-note" style={{ fontWeight: 400 }}> — newest first · ▸ for the call path + fills</span>
        </div>
        <div className="vg-fr-cols vg-note">
          <span>time</span><span>market</span><span>call (next 15)</span><span>resolved</span><span>you</span><span />
        </div>
        {(d ? d.frames : []).map((f) => <FrameRow key={f.t} f={f} />)}
        {d && !d.frames.length && <p className="vg-note">No frames for {day} — no stored bars or fills.</p>}
        {!d && <p className="vg-note">{q.loading ? "Building the ledger…" : "Cockpit needs the SQLite backend."}</p>}
      </div>
    </div>
  );
}
