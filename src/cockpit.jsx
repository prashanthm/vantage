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


// The session map — the ledger drawn instead of written. One SVG:
//   · 15-min candles (from bucket closes), toned bull/bear/flat
//   · each standing call's TARGET (green dash) and INVALIDATION (red dash)
//     drawn across the frames it governed — price vs the call, visibly
//   · a bias arrow where each fresh call was made
//   · your entries as dots on the price path (amber ring = against the tape)
//   · a ✓/✗ lane underneath: how the frame's call resolved
function SessionMap({ d }) {
  const frames = [...(d.frames || [])].reverse();          // chronological
  const buckets = d.buckets || [];
  if (!buckets.length) return null;
  const W = 980, H = 300, PAD_L = 54, PAD_R = 12, PAD_T = 10, LANE = 26;
  const plotH = H - PAD_T - LANE - 24;
  const n = 26;
  const x = (i) => PAD_L + (i + 0.5) * ((W - PAD_L - PAD_R) / n);
  const slotOf = (sm) => Math.max(0, Math.min(n - 1, Math.floor((sm - 570) / 15)));

  // y-scale from closes + near-range call levels (far walls clamp to edge)
  const closes = buckets.map((b) => b.close);
  let lo = Math.min(...closes), hi = Math.max(...closes);
  for (const f of frames) {
    const c = f.call || {};
    for (const v of [c.target, c.invalidation]) {
      if (v != null && v > lo - 40 && v < hi + 40) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  const span = Math.max(hi - lo, 1);
  lo -= span * 0.06; hi += span * 0.06;
  const y = (p) => PAD_T + (hi - p) / (hi - lo) * plotH;
  const yc = (p) => Math.max(PAD_T, Math.min(PAD_T + plotH, y(p)));   // clamped

  const toneCol = (t) => (t === "bull" ? "var(--vg-up)" : t === "bear" ? "var(--vg-down)" : "var(--vg-faint)");
  const biasCol = (b) => {
    const t = String(b || "").toLowerCase();
    return t.includes("up") || t.includes("bull") ? "var(--vg-up)"
      : t.includes("down") || t.includes("bear") ? "var(--vg-down)" : "var(--vg-faint)";
  };

  // candles: open = previous close (first = its own close)
  const candles = buckets.map((b, i) => ({
    i: slotOf(b.start_min), o: i > 0 ? buckets[i - 1].close : b.close,
    c: b.close, tone: b.tone,
  }));

  // call spans: consecutive frames governed by the same call id
  const spans = [];
  for (const f of frames) {
    const c = f.call;
    if (!c) continue;
    const slot = slotOf(f.start_min);
    const last = spans[spans.length - 1];
    if (last && last.id === c.id) last.to = slot;
    else spans.push({ id: c.id, from: slot, to: slot, call: c });
  }

  // resolution ticks: placed at the frame where the call was MADE
  const ticks = frames.filter((f) => f.call && f.call.fresh && f.call.score)
    .map((f) => ({ slot: slotOf(f.start_min), v: String(f.call.score.verdict || "") }));

  // trades: dot at (entry frame, bucket close)
  const byStart = Object.fromEntries(buckets.map((b) => [slotOf(b.start_min), b]));
  const dots = [];
  for (const f of frames) for (const t of f.trades || []) {
    const slot = slotOf(t.start_min);
    const b = byStart[slot];
    if (b) dots.push({ slot, price: b.close, t });
  }

  const half = (W - PAD_L - PAD_R) / n / 2 - 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
      role="img" aria-label="Session map — price, calls and your trades per 15-minute frame">
      {/* y grid + labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const p = hi - f * (hi - lo);
        return (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(p)} y2={y(p)} stroke="var(--vg-hairline)" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(p) + 3} textAnchor="end" fontSize="10"
              fill="var(--vg-faint)" fontFamily="var(--vg-font-data)">{p.toFixed(0)}</text>
          </g>
        );
      })}
      {/* call target / invalidation bands */}
      {spans.map((sp, k) => {
        const c = sp.call;
        const x1 = x(sp.from) - half, x2 = x(sp.to) + half;
        return (
          <g key={k}>
            {c.target != null && (
              <line x1={x1} x2={x2} y1={yc(c.target)} y2={yc(c.target)}
                stroke="var(--vg-up)" strokeWidth="1.6" strokeDasharray="5 3" opacity="0.8">
                <title>{`call @ ${c.minute}: target ${c.target}`}</title>
              </line>)}
            {c.invalidation != null && (
              <line x1={x1} x2={x2} y1={yc(c.invalidation)} y2={yc(c.invalidation)}
                stroke="var(--vg-down)" strokeWidth="1.6" strokeDasharray="5 3" opacity="0.8">
                <title>{`call @ ${c.minute}: wrong beyond ${c.invalidation}`}</title>
              </line>)}
          </g>
        );
      })}
      {/* candles */}
      {candles.map((c, k) => (
        <g key={k}>
          <line x1={x(c.i)} x2={x(c.i)} y1={y(Math.max(c.o, c.c))} y2={y(Math.min(c.o, c.c))}
            stroke={toneCol(c.tone)} strokeWidth={Math.max(4, half)} strokeLinecap="butt" opacity="0.85">
            <title>{`${buckets[k].t} · ${c.o.toFixed(1)}→${c.c.toFixed(1)} (${buckets[k].ret_pct > 0 ? "+" : ""}${buckets[k].ret_pct}%)`}</title>
          </line>
        </g>
      ))}
      {/* fresh-call bias arrows above the price */}
      {frames.filter((f) => f.call && f.call.fresh).map((f, k) => {
        const slot = slotOf(f.start_min);
        const b = byStart[slot];
        const py = b ? y(b.close) - 14 : PAD_T + 12;
        const col = biasCol(f.call.bias);
        const up = String(f.call.bias || "").toLowerCase().match(/up|bull/);
        const dn = String(f.call.bias || "").toLowerCase().match(/down|bear/);
        return (
          <g key={k}>
            <path d={up ? `M ${x(slot) - 5} ${py + 5} L ${x(slot)} ${py - 3} L ${x(slot) + 5} ${py + 5} Z`
              : dn ? `M ${x(slot) - 5} ${py - 3} L ${x(slot)} ${py + 5} L ${x(slot) + 5} ${py - 3} Z`
                : `M ${x(slot) - 4} ${py} L ${x(slot)} ${py - 4} L ${x(slot) + 4} ${py} L ${x(slot)} ${py + 4} Z`}
              fill={col}>
              <title>{`${f.call.minute} call: ${String(f.call.bias || "?").toUpperCase()}${f.call.target != null ? ` · T ${f.call.target}` : ""}${f.call.invalidation != null ? ` · ✕ ${f.call.invalidation}` : ""}`}</title>
            </path>
          </g>
        );
      })}
      {/* your entries */}
      {dots.map((dd, k) => (
        <circle key={k} cx={x(dd.slot)} cy={y(dd.price)} r="5"
          fill={dd.t.dir === "bullish" ? "var(--vg-up)" : "var(--vg-down)"}
          stroke={dd.t.with_trend === false ? "var(--vg-warn)" : "var(--vg-card)"} strokeWidth="2.5">
          <title>{`${dd.t.time} ${dd.t.label} · ${dd.t.dir}${dd.t.with_trend === false ? " · AGAINST" : ""}${dd.t.realized != null ? ` · ${dd.t.realized >= 0 ? "+" : "−"}$${Math.abs(dd.t.realized)}` : ""}`}</title>
        </circle>
      ))}
      {/* resolution lane */}
      <text x={PAD_L - 6} y={H - LANE + 8} textAnchor="end" fontSize="9" fill="var(--vg-faint)"
        style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>calls</text>
      {ticks.map((tk, k) => {
        const good = /hit|correct/.test(tk.v);
        const bad = /invalid|wrong/.test(tk.v);
        return (
          <text key={k} x={x(tk.slot)} y={H - LANE + 10} textAnchor="middle" fontSize="12"
            fill={good ? "var(--vg-up)" : bad ? "var(--vg-down)" : "var(--vg-faint)"}>
            {good ? "✓" : bad ? "✗" : "·"}<title>{tk.v}</title>
          </text>
        );
      })}
      {/* x labels */}
      {[0, 4, 8, 12, 16, 20, 25].map((i) => (
        <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize="10"
          fill="var(--vg-faint)" fontFamily="var(--vg-font-data)">
          {`${Math.floor((570 + i * 15) / 60)}:${String((570 + i * 15) % 60).padStart(2, "0")}`}
        </text>
      ))}
    </svg>
  );
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

      {d && (
        <div className="vg-card" style={{ marginTop: 14 }}>
          <div className="vg-kicker" style={{ marginBottom: 8 }}>
            Session map
            <span className="vg-note" style={{ fontWeight: 400 }}>
              {" "}— candles per 15m · dashed = the standing call's target (green) / invalidation (red) ·
              arrows = fresh calls · dots = your entries · ✓✗ = how each call resolved
            </span>
          </div>
          <SessionMap d={d} />
        </div>
      )}

      <details className="vg-card" style={{ marginTop: 14, padding: "10px 14px" }}>
        <summary className="vg-kicker" style={{ cursor: "pointer", marginBottom: 6 }}>
          Frame details{d ? ` · ${d.frames.length} frames` : ""}
          <span className="vg-note" style={{ fontWeight: 400 }}> — newest first · ▸ for the call path + fills</span>
        </summary>
        <div className="vg-fr-cols vg-note">
          <span>time</span><span>market</span><span>call (next 15)</span><span>resolved</span><span>you</span><span />
        </div>
        {(d ? d.frames : []).map((f) => <FrameRow key={f.t} f={f} />)}
        {d && !d.frames.length && <p className="vg-note">No frames for {day} — no stored bars or fills.</p>}
        {!d && <p className="vg-note">{q.loading ? "Building the ledger…" : "Cockpit needs the SQLite backend."}</p>}
      </details>
    </div>
  );
}
