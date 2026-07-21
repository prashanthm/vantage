// CockpitView — the 15-minute briefing.
//
// Two questions, answered deterministically from stored data (ADR-008):
//   NEXT 15 MINUTES — the standing analyst call: sentiment, the forecast
//     levels to watch, and a proposed action. Position-aware: with an open
//     trade the action becomes HOLD / SELL / ADD against the call.
//   EVERY 15 MINUTES (history) — per frame: what the sentiment was, the key
//     levels, the action the call implied, what the market actually did, the
//     trades logged in the window, and whether each aligned with the
//     narrative. A date picker recalls any stored day.
//
// Tone strips + discipline commentary ride on top via ToneCompareCard.
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
const etMinNow = () => {
  const [h, m] = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date()).split(":");
  return Number(h) * 60 + Number(m);
};
const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

// call bias → "bullish" | "bearish" | null
function callSide(bias) {
  const s = String(bias || "").toLowerCase();
  if (s.includes("up") || s.includes("bull") || s.includes("long")) return "bullish";
  if (s.includes("down") || s.includes("bear") || s.includes("short")) return "bearish";
  return null;
}
const sideTone = (side) => (side === "bullish" ? "good" : side === "bearish" ? "bad" : "plain");
function verdictTone(v) {
  const s = String(v || "").toLowerCase();
  if (s.includes("hit") || s.includes("correct")) return "good";
  if (s.includes("invalid") || s.includes("wrong")) return "bad";
  return "plain";
}
const ageMin = (iso) => {
  try { return Math.round((Date.now() - new Date(iso).getTime()) / 60000); }
  catch { return null; }
};

// Where does price stand vs the call's levels?  → "target" | "invalidated" | null
function levelState(call, price) {
  const side = callSide(call && call.bias);
  if (!side || price == null) return null;
  if (call.target != null
      && (side === "bullish" ? price >= call.target : price <= call.target)) return "target";
  if (call.invalidation != null
      && (side === "bullish" ? price <= call.invalidation : price >= call.invalidation)) return "invalidated";
  return null;
}

// The proposed action for a frame WITHOUT a position — sentiment + levels → verb.
function flatAction(call, price) {
  const side = callSide(call && call.bias);
  if (!call) return { verb: "WAIT", tone: "plain", detail: "no analyst call yet" };
  if (call.born_invalid) return { verb: "WAIT", tone: "warn", detail: "call was invalid at birth — stand down" };
  if (!side) return { verb: "WAIT", tone: "plain", detail: "no directional edge in the call" };
  const st = levelState(call, price);
  if (st === "invalidated") return { verb: "WAIT", tone: "warn", detail: `call broken — ${call.invalidation} gave way` };
  if (st === "target") return { verb: "WAIT", tone: "warn", detail: `target ${call.target} already met — chasing is late` };
  return {
    verb: side === "bullish" ? "LOOK LONG" : "LOOK SHORT", tone: sideTone(side),
    detail: `toward ${call.target ?? "?"} · wrong beyond ${call.invalidation ?? "?"}`,
  };
}

// Position-aware action for ONE open trade vs the standing call.
function positionAction(call, trade, price) {
  const side = callSide(call && call.bias);
  const aligned = side != null && trade.dir === side;
  if (!call || !side) return { verb: "HOLD", tone: "plain", detail: "no standing call to judge against" };
  if (!aligned) return { verb: "SELL", tone: "bad", detail: `call is ${side.toUpperCase()} — against your ${trade.dir} position` };
  const st = levelState(call, price);
  if (st === "invalidated") return { verb: "SELL", tone: "bad", detail: `invalidation ${call.invalidation} broke — thesis dead` };
  if (st === "target") return { verb: "SELL", tone: "good", detail: `target ${call.target} met — take the win` };
  if (call.fresh) return { verb: "HOLD / ADD", tone: "good", detail: `fresh call reaffirms ${side} — room to ${call.target ?? "?"}` };
  return { verb: "HOLD", tone: "good", detail: `aligned with the call — room to ${call.target ?? "?"}, out beyond ${call.invalidation ?? "?"}` };
}

const actionBadge = (a, big) => (
  <span className={cls("vg-badge", a.tone)}
    style={{ fontWeight: 700, ...(big ? { fontSize: "var(--vg-text-md)", padding: "4px 10px" } : {}) }}>
    {a.verb}
  </span>
);

function LevelChips({ call, price }) {
  if (!call) return null;
  const dist = (v) => (price != null && v != null ? ` (${(v - price) >= 0 ? "+" : ""}${(v - price).toFixed(1)}pt)` : "");
  return (
    <span className="vg-row" style={{ gap: 6, flexWrap: "wrap" }}>
      {call.target != null && (
        <span className="vg-badge good" style={{ fontVariantNumeric: "tabular-nums" }}>
          target {call.target}{dist(call.target)}</span>)}
      {call.invalidation != null && (
        <span className="vg-badge bad" style={{ fontVariantNumeric: "tabular-nums" }}>
          wrong {call.invalidation}{dist(call.invalidation)}</span>)}
      {(call.path || []).map((s, i) => (
        <span key={i} className="vg-badge plain" style={{ fontVariantNumeric: "tabular-nums" }}
          title={s.note || ""}>{i + 1}· {s.price}</span>))}
    </span>
  );
}

// ── PRE-MARKET: the daily plan is the first read (from ~09:00 ET) ───────────
function PlanCard() {
  const q = useLive(() => getJson(`${backend()}/api/spx/playbook?symbol=SPX`, { timeoutMs: 30000 }), null, []);
  const sc = q.data && q.data.available ? (q.data.scaffold || {}) : null;
  if (!sc) return null;
  const r = sc.regime || {};
  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="vg-kicker">Pre-market — today&apos;s plan</div>
        <a className="vg-note" href="#/playbook">full read →</a>
      </div>
      <div className="vg-row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {r.gamma_text && <span className={cls("vg-badge", r.gamma === "negative" ? "warn" : "plain")}>{r.gamma_text}</span>}
        {r.vwap_regime && <span className="vg-badge plain">{r.vwap_regime}</span>}
        {r.vix != null && <span className="vg-badge plain" style={{ fontVariantNumeric: "tabular-nums" }}>VIX {r.vix} · {r.vix_band}</span>}
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {(sc.setups || []).map((s, i) => (
          <div key={i}>
            <div className="vg-row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <b style={{ fontSize: "var(--vg-text-sm)" }}>{s.trigger}</b>
              <span className="vg-note">{s.bias}</span>
            </div>
            {(s.targets || []).length > 0 && (
              <div className="vg-row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                {s.targets.slice(0, 3).map((t, j) => (
                  <span key={j} className="vg-badge good" style={{ fontVariantNumeric: "tabular-nums" }}
                    title={t.kind}>{t.price} ({t.pts_from_trigger}pt)</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NEXT 15 MINUTES ─────────────────────────────────────────────────────────
function NowCard({ d, isToday }) {
  const frames = d.frames || [];
  const latest = frames.find((f) => f.call);          // newest-first
  const call = latest && latest.call;
  const buckets = d.buckets || [];
  const price = buckets.length ? buckets[buckets.length - 1].close : null;
  const openTrades = (d.trades || []).filter((t) => t.realized == null);
  const side = callSide(call && call.bias);
  const age = call ? ageMin(call.as_of) : null;
  const etMin = etMinNow();
  const closed = !isToday || etMin >= 960 || etMin < 570;   // outside 09:30–16:00 ET
  const stale = isToday && !closed && age != null && age > 20;
  const flat = flatAction(call, price);
  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="vg-kicker">{closed ? "Session closed — final call" : "Next 15 minutes"}</div>
        <span className="vg-note">
          {call ? `call @ ${call.minute} from ${call.price_at ?? "?"}` : "no call yet"}
          {!closed && age != null ? ` · ${age}m ago` : ""}
          {stale && <b className="vg-down"> · STALE — refresh due</b>}
        </span>
      </div>
      {call ? (
        <>
          <div className="vg-row" style={{ gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={cls("vg-badge", sideTone(side))}
              style={{ fontSize: "var(--vg-text-lg)", fontWeight: 800, padding: "5px 12px" }}>
              {side ? side.toUpperCase() : "NEUTRAL"}
            </span>
            {call.born_invalid && <span className="vg-badge bad">BORN-INVALID</span>}
            {price != null && <span className="vg-note" style={{ fontVariantNumeric: "tabular-nums" }}>last {price}</span>}
          </div>
          <div style={{ marginTop: 8 }}><LevelChips call={call} price={price} /></div>
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {closed ? (
              <span className="vg-note">Market closed — nothing to act on. The frame-by-frame review is below.</span>
            ) : openTrades.length === 0 ? (
              <div className="vg-row" style={{ gap: 8, alignItems: "baseline" }}>
                {actionBadge(flat, true)}
                <span className="vg-note">{flat.detail}</span>
              </div>
            ) : openTrades.map((t, i) => {
              const a = positionAction(call, t, price);
              return (
                <div key={i} className="vg-row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  {actionBadge(a, true)}
                  <b style={{ fontSize: "var(--vg-text-sm)" }}>{t.label}</b>
                  <span className={cls("vg-badge", t.dir === "bullish" ? "good" : "bad")}>{t.dir}</span>
                  <span className="vg-note">{a.detail}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : <p className="vg-note" style={{ marginTop: 6 }}>Waiting for the first analyst call of the session.</p>}
    </div>
  );
}

// ── EVERY 15 MINUTES (history) ──────────────────────────────────────────────
function FrameCard({ f }) {
  const [open, setOpen] = useState(false);
  const c = f.call, m = f.market;
  const side = callSide(c && c.bias);
  const act = flatAction(c, m ? m.close : null);
  const trades = f.trades || [];
  return (
    <div className={cls("vg-fr", open && "open")}>
      <div className="vg-fr-head" onClick={() => setOpen(!open)}
        style={{ display: "grid", gridTemplateColumns: "46px 96px 1fr 170px 16px", gap: 10, alignItems: "start" }}>
        <span className="vg-fr-t">{f.t}</span>
        {/* sentiment */}
        <span>
          {c ? (
            <span className={cls("vg-badge", sideTone(side))} style={{ fontWeight: 700 }}>
              {side ? side.toUpperCase() : "NEUTRAL"}{c.fresh ? "" : " ·"}
            </span>
          ) : <span className="vg-note">no call</span>}
        </span>
        {/* levels + proposed action + trades w/ narrative alignment */}
        <span style={{ display: "grid", gap: 4 }}>
          <span className="vg-row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            {c && actionBadge(act)}
            {c && <span className="vg-note" style={{ fontVariantNumeric: "tabular-nums" }}>{act.detail}</span>}
          </span>
          {trades.length > 0 && (
            <span className="vg-row" style={{ gap: 6, flexWrap: "wrap" }}>
              {trades.map((t, i) => {
                const aligned = side != null ? t.dir === side : null;
                return (
                  <span key={i} className={cls("vg-badge", aligned === false ? "bad" : aligned ? "good" : "plain")}
                    title={`${t.time} · ${t.dir}${t.realized != null ? ` · ${money(t.realized)}` : " · open"}`}>
                    {aligned === false ? "✗" : aligned ? "✓" : "·"} {t.label}
                    {t.realized != null ? ` ${money(t.realized)}` : ""}
                  </span>
                );
              })}
              {f.frame_pnl != null && f.frame_pnl !== 0 && (
                <b className={f.frame_pnl >= 0 ? "vg-up" : "vg-down"} style={{ fontSize: "var(--vg-text-sm)" }}>
                  {money(f.frame_pnl)}</b>)}
            </span>
          )}
        </span>
        {/* what the market did + how the call resolved */}
        <span style={{ display: "grid", gap: 3, justifyItems: "end" }}>
          {m ? (
            <span className="vg-row" style={{ gap: 5, alignItems: "center" }}>
              <span className={cls("vg-tone-cellmini", m.tone)} />
              <span className="vg-note" style={{ fontVariantNumeric: "tabular-nums" }}>
                {m.ret_pct > 0 ? "+" : ""}{m.ret_pct}% · {m.close}</span>
            </span>
          ) : <span className="vg-note">—</span>}
          {c && c.score
            ? <span className={cls("vg-badge", verdictTone(c.score.verdict))} style={{ fontSize: "var(--vg-text-xs)" }}>
                {c.score.verdict}{c.score.moved_pt != null ? ` ${c.score.moved_pt > 0 ? "+" : ""}${c.score.moved_pt}pt` : ""}
              </span>
            : c && c.fresh ? <span className="vg-note" style={{ fontSize: "var(--vg-text-xs)" }}>resolving…</span> : null}
        </span>
        <span className="vg-note">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="vg-fr-body">
          {c && <div style={{ marginBottom: 4 }}><LevelChips call={c} price={m ? m.close : null} /></div>}
          {c && c.minute && (
            <div className="vg-note">call made {c.minute} @ {c.price_at}{c.born_invalid ? " — BORN-INVALID" : ""}</div>
          )}
          {trades.map((t, i) => (
            <div key={i} className="vg-note" style={{ marginTop: 3 }}>
              {t.time} — {t.label} · {t.dir}
              {side != null ? (t.dir === side ? " · WITH the call" : " · AGAINST the call") : ""}
              {t.with_trend === false ? " · against the session tape" : ""}
              {t.realized != null ? ` · ${money(t.realized)}` : " · open"}
            </div>
          ))}
          {!c && !trades.length && <span className="vg-note">quiet frame</span>}
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
    // poll only 09:00–16:05 ET — after hours nothing changes, and the
    // refetch flicker is just noise
    const t = setInterval(() => {
      const m = etMinNow();
      if (m >= 540 && m <= 965) setTick((n) => n + 1);
    }, 120000);
    return () => clearInterval(t);
  }, [isToday]);
  const q = useLive(() => getFrames(day), null, [day, tick, refreshNonce]);
  const d = q.data && q.data.available ? q.data : null;
  return (
    <div className="vg-pane-body">
      <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Cockpit</h2>
          <p className="vg-sub">Every 15 minutes: sentiment · levels · action · your trades vs the narrative</p>
        </div>
        <div className="vg-row" style={{ gap: 10, alignItems: "baseline" }}>
          {d && d.day_pnl != null && (
            <span className="vg-note">day <b className={d.day_pnl >= 0 ? "vg-up" : "vg-down"}>{money(d.day_pnl)}</b></span>
          )}
          <input type="date" className="vg-scan-filter" value={day} max={todayET()}
            onChange={(e) => setDay(e.target.value || todayET())} aria-label="Cockpit day" />
        </div>
      </div>

      {isToday && etMinNow() < 570 ? <PlanCard /> : d && <NowCard d={d} isToday={isToday} />}

      <ToneCompareCard marketOpen={isToday} day={isToday ? undefined : day} />

      <div className="vg-card" style={{ marginTop: 14, padding: "10px 14px" }}>
        <div className="vg-kicker" style={{ marginBottom: 6 }}>
          Every 15 minutes{d ? ` · ${d.frames.length} frames` : ""}
          <span className="vg-note" style={{ fontWeight: 400 }}> — newest first · sentiment → action → market → your trades (✓ with / ✗ against the call)</span>
        </div>
        {(d ? d.frames : []).map((f) => <FrameCard key={f.t} f={f} />)}
        {d && !d.frames.length && <p className="vg-note">No frames for {day} — no stored bars or fills.</p>}
        {!d && <p className="vg-note">{q.loading ? "Building the briefing…" : "Cockpit needs the SQLite backend."}</p>}
      </div>
    </div>
  );
}
