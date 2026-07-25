// Cockpit — the day as a conversation between three actors: the MARKET (tape),
// the ANALYST (15-minute calls) and YOU (trades).
//
//   CENTER (CockpitView): the chart is the one surface where all three coexist —
//     SPX with the day's calls plotted and graded on price — then the tone
//     strips, then the every-15-minutes table (the log).
//   RIGHT PANE (CockpitPanel, mounted by App): the lens. Default = NOW (the
//     standing call, position-aware action, levels watch, discipline). Click a
//     table row = that frame's briefing (call path, fills, the Mira desk
//     review for each trade in the window).
//
// Everything renders deterministically from stored data (ADR-008); Mira text
// appears only where Mira already spoke (the stored trade analyses).
import { cls } from "./util.jsx";
import { useLive, getJson, getTradeAnalyses, getSpxForecasts, getDayReviews, getBotStatus, getBotPerformance, getNightlyStatus, getPlaybook } from "./live.js";
import { ToneCompareCard } from "./tone_card.jsx";
import { SignalsCard, StrategyCard, MachineCard } from "./ops_cards.jsx";
import { TicketModal, PlanHalf } from "./playbook.jsx";
import { AlertsBlock } from "./desk_rail.jsx";
import { InstrumentChartCard } from "./chart_core.jsx";
import { MiraRender, parseMira } from "./mira-render.jsx";

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

// ── gap odds (backtested, level-folklore H6: 730 SPX sessions, frozen data) ──
// same-day gap-fill and first-hour continuation rates by gap size. Speak in
// "X times in 10" — the trader reads odds, not z-scores.
function gapRead(gapPct) {
  if (gapPct == null) return null;
  const a = Math.abs(gapPct);
  if (a < 0.02) return null;
  const dir = gapPct > 0 ? "up" : "down";
  const fade = gapPct > 0 ? "shorting it" : "buying the dip";
  if (a < 0.2) return { tone: "good", text:
    `Opened ${gapPct > 0 ? "+" : ""}${gapPct}% — a small gap. These close the gap 8 times in 10, no strong lean either way.` };
  if (a < 0.5) return { tone: "plain", text:
    `Opened ${gapPct > 0 ? "+" : ""}${gapPct}% — a medium gap. Closes the gap about half the time; no edge fading it early.` };
  return { tone: "bad", text:
    `Opened ${gapPct > 0 ? "+" : ""}${gapPct}% — a BIG gap ${dir}. These keep going ${a >= 1 ? "7–8" : "6"} times in 10 in the first hour and close the gap only ${a >= 1 ? "2" : "3"} in 10. ${fade[0].toUpperCase() + fade.slice(1)} before 10:00 is fighting the odds.` };
}

// ── the pre-trade checklist: the ritual, prefilled ───────────────────────────
// Every line is computed from live data (code, never Mira). Rules = the six
// from the Jul-21 disaster review + the backtested gap odds. Read top to
// bottom before every entry; a red line means don't.
function ChecklistCard({ d, planRows }) {
  const buckets = d.buckets || [];
  const last = buckets[buckets.length - 1];
  const price = last ? last.close : null;
  const etMin = etMinNow();
  const frames = d.frames || [];
  const call = (frames.find((f) => f.call) || {}).call;
  const side = callSide(call && call.bias);
  const age = call ? ageMin(call.as_of) : null;
  const trades = d.trades || [];
  const lastTrade = trades.length ? trades[trades.length - 1] : null;
  const lastEntryMin = lastTrade ? lastTrade.start_min : null;

  const items = [];
  const add = (tone, text) => items.push({ tone, text });

  // 1 · the tape
  if (last) {
    const st = last.session_tone;
    add(st === "flat" ? "plain" : "good",
      st === "bull" ? `Tape is UP ${last.session_ret_pct > 0 ? "+" : ""}${last.session_ret_pct}% on the day — longs swim with it, shorts fight it.`
      : st === "bear" ? `Tape is DOWN ${last.session_ret_pct}% on the day — shorts swim with it, longs fight it.`
      : "Tape is flat — no side has the ball; smaller size, quicker exits.");
  }
  // 2 · the gap (backtested odds)
  const g = gapRead(d.gap_pct);
  if (g) add(g.tone, g.text);
  // 3 · the analyst
  if (call) {
    if (call.born_invalid) add("bad", "The standing call was broken at birth — there is no analyst thesis right now. Stand down or wait for the next one.");
    else if (age != null && age > 20) add("warn", `The analyst call is ${age} minutes old — stale. Wait for the refresh before leaning on it.`);
    else add("good", `Analyst says ${side ? side.toUpperCase() : "NEUTRAL"}${call.target != null ? ` toward ${call.target}` : ""} (${age} min ago). Trading against it has cost real money this month.`);
  } else add("plain", "No analyst call yet this session.");
  // 4 · zones being tested
  const testing = (planRows || []).filter((r) =>
    (r.role === "support" || r.role === "resistance") && price != null
    && price >= (r.lo != null ? r.lo : r.price) && price <= (r.hi != null ? r.hi : r.price));
  if (testing.length) {
    const z = testing[0];
    add("warn", `Price is INSIDE the ${z.lo != null ? `${z.lo}–${z.hi}` : z.price} zone right now — it hasn't picked a side. Entering mid-zone is a coin flip; let it resolve.`);
  }
  // 5 · the clock
  if (etMin < 600) add("warn", "Opening window (before 10:00): 1 contract max, and never against the gap. The 09:39 five-lot cost $4,430.");
  else if (etMin >= 930) add("bad", "Past 15:30 — no new trades. Whatever this is, it can wait for tomorrow's plan.");
  // 6 · the damage
  if (d.day_pnl != null && d.day_pnl <= -2000)
    add("bad", `Down ${money(d.day_pnl)} — the $2,000 daily stop is HIT. The day is over; anything else is revenge trading.`);
  else if ((d.streak || 0) >= 3)
    add("bad", `${d.streak} losses in a row — step away from the screen for 15 minutes before the next entry.`);
  else if (d.day_pnl != null && d.day_pnl < 0)
    add("plain", `Down ${money(d.day_pnl)} on the day — ${money(-2000 - d.day_pnl)} of room left before the hard stop.`);
  // 7 · the cooldown
  if (lastEntryMin != null && etMin - lastEntryMin >= 0 && etMin - lastEntryMin < 5)
    add("warn", `You entered ${etMin - lastEntryMin} min ago — no adding, no size-up for 5 minutes. Averaging into losers is how -$4,430 happens.`);

  const glyph = (t) => (t === "good" ? "✓" : t === "bad" ? "✕" : "⚠");
  const col = (t) => (t === "good" ? "var(--vg-up)" : t === "bad" ? "var(--vg-down)" : t === "warn" ? "var(--vg-warn)" : "var(--vg-faint)");
  return (
    <div className="vg-card" style={{ marginTop: 12 }}>
      <div className="vg-kicker">Before you trade
        <span className="vg-note" style={{ fontWeight: 400 }}> — prefilled · code, never Mira</span></div>
      <div style={{ display: "grid", gap: 7 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 8, alignItems: "start" }}>
            <b style={{ color: col(it.tone), lineHeight: "1.4" }}>{glyph(it.tone)}</b>
            <span style={{ fontSize: "var(--vg-text-sm)",
              color: it.tone === "bad" ? "var(--vg-down)" : undefined }}>{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── panel sections ──────────────────────────────────────────────────────────

// Pane, pre-open: yesterday's debrief homework — the day-review's "do next"
// items, carried into the morning where they can actually change behavior.
function CarriedRulesCard() {
  const y = (() => {  // last trading day (skip weekends; holidays degrade to empty)
    const d = new Date(); let n = 1;
    const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
    if (dow === "Mon") n = 3; if (dow === "Sun") n = 2;
    d.setDate(d.getDate() - n);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  })();
  const q = useLive(() => getDayReviews(y), null, [y]);
  const rows = (q.data && q.data.available && (q.data.reviews || q.data.rows)) || [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  const parsed = latest ? parseMira(latest.analysis || latest.review || "") : null;
  const donext = ((parsed && parsed.sections) || []).find((x) => x.kind === "donext");
  if (!donext || !(donext.items || []).length) return null;
  return (
    <div className="vg-card" style={{ marginTop: 12 }}>
      <div className="vg-kicker">Carried from yesterday
        <span className="vg-note" style={{ fontWeight: 400 }}> · {y} debrief</span></div>
      <ol style={{ margin: "2px 0 0", paddingLeft: 16, fontSize: "var(--vg-text-sm)" }}>
        {donext.items.slice(0, 3).map((it, i) => (
          <li key={i} style={{ marginTop: 4 }}>
            <b>{it.title || it.point}</b>
            {it.detail && <span className="vg-note"> — {String(it.detail).slice(0, 140)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Mira's forecast, verbatim — the full synthesis behind a call, not a summary.
// `row` is a stored forecast row (forecast_text is Mira's own JSON sections).
function MiraCallBlock({ row, title }) {
  if (!row || !row.forecast_text) return null;
  const parsed = parseMira(row.forecast_text);
  return (
    <div style={{ borderLeft: "3px solid #7c5cff", paddingLeft: 10, marginTop: 8 }}>
      <div className="vg-kicker" style={{ color: "#7c5cff", marginBottom: 2 }}>
        {title || "The call, in Mira's words"}
        <span className="vg-note" style={{ fontWeight: 400 }}> · verbatim</span></div>
      <details>
        <summary className="vg-note" style={{ cursor: "pointer", fontWeight: 600 }}>
          {(parsed && parsed.headline) || String(row.forecast_text).slice(0, 110)}
        </summary>
        <div style={{ marginTop: 6 }}>
          <MiraRender data={parsed} text={row.forecast_text} />
        </div>
      </details>
    </div>
  );
}

// Pre-market plan vs how price treats each level NOW; FLIP = role inverted.
function LevelsWatch({ d, rows }) {
  const buckets = d.buckets || [];
  const price = buckets.length ? buckets[buckets.length - 1].close : null;
  const sr = (rows || []).filter((r) => r.role === "support" || r.role === "resistance");
  if (!sr.length || price == null) return null;
  return (
    <div className="vg-card vg-tablewrap" style={{ marginTop: 12, padding: "10px 12px" }}>
      <div className="vg-kicker" style={{ marginBottom: 6 }}>
        Levels watch
        <span className="vg-note" style={{ fontWeight: 400 }}> — plan vs now (last {price})</span>
      </div>
      <table className="vg-table">
        <thead><tr><th>Level</th><th>Plan</th><th>Now</th><th /></tr></thead>
        <tbody>
          {sr.map((r, i) => {
            // three states via the zone band: above hi = support, below lo =
            // resistance, INSIDE = testing. FLIP only fires on a full traversal
            // of the band — no more label flapping while price straddles a line.
            const lo = r.lo != null ? r.lo : r.price;
            const hi = r.hi != null ? r.hi : r.price;
            const now = price > hi ? "support" : price < lo ? "resistance" : "testing";
            const flip = now !== "testing" && now !== r.role;
            return (
              <tr key={i} style={flip ? { background: "var(--vg-raised)" } : undefined}>
                <td className="num" style={{ textAlign: "left" }}
                  title={r.hi != null && r.hi > r.lo ? `zone ${r.lo}–${r.hi}` : undefined}>
                  {r.hi != null && r.hi > r.lo ? `${r.lo}–${r.hi}` : r.price}
                  <div className="vg-note" style={{ fontFamily: "var(--vg-font-ui)", fontSize: "var(--vg-text-xs)", whiteSpace: "normal" }}>
                    {String(r.label || "").replace(/\s*[★✦].*$/, "")}</div></td>
                <td><span className={cls("vg-badge", r.role === "support" ? "good" : "bad")}>{r.role.slice(0, 3)}</span></td>
                <td><span className={cls("vg-badge",
                  now === "support" ? "good" : now === "resistance" ? "bad" : "warn")}>
                  {now === "testing" ? "testing" : now.slice(0, 3)}</span></td>
                <td>{flip && <span className="vg-badge warn" style={{ fontWeight: 700 }}
                  title="price traded through the whole zone — the plan's role has inverted">FLIP</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// The standing call as a decision card (position-aware).
function NowCard({ d, isToday }) {
  const frames = d.frames || [];
  const latest = frames.find((f) => f.call);          // newest-first
  const call = latest && latest.call;
  // Mira's full synthesis for the standing call — fetched with its text
  const fq = useLive(() => getSpxForecasts(undefined, "SPX", 1), null, [call && call.id]);
  const fRow = (fq.data && fq.data.available && (fq.data.forecasts || [])[0]) || null;
  const fMatch = fRow && call && fRow.id === call.id ? fRow : null;
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
    <div className="vg-card" style={{ marginTop: 12 }}>
      <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="vg-kicker">{closed ? "Session closed — final call" : "Next 15 minutes"}</div>
        <span className="vg-note">
          {call ? `@ ${call.minute} from ${call.price_at ?? "?"}` : "no call yet"}
          {!closed && age != null ? ` · ${age}m ago` : ""}
          {stale && <b className="vg-down"> · STALE</b>}
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
          <MiraCallBlock row={fMatch} />
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {closed ? (
              <span className="vg-note">Market closed — nothing to act on.</span>
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

// Discipline — the day's guardrails and the blunt commentary, relocated from
// the center so the record stays clean.
function DisciplineCard({ d }) {
  const hasAny = d.verdict || (d.commentary || []).length || d.day_pnl != null;
  if (!hasAny) return null;
  return (
    <div className="vg-card" style={{ marginTop: 12 }}>
      <div className="vg-spread" style={{ alignItems: "baseline", gap: 8 }}>
        <div className="vg-kicker">Discipline
          <span className="vg-note" style={{ fontWeight: 400 }}
            title="deterministic rules over your fills + 1m bars: daily stop, loss streak, with/against alignment"> · code, never Mira</span></div>
        {d.day_pnl != null && (
          <b className={d.day_pnl >= 0 ? "vg-up" : "vg-down"}
            style={{ fontVariantNumeric: "tabular-nums" }}>{money(d.day_pnl)}</b>)}
      </div>
      {d.verdict && <div className="vg-tone-verdict" style={{ marginTop: 8 }}>⚠ {d.verdict}</div>}
      {(d.commentary || []).map((c, i) => (
        <div key={i} className="vg-tone-note" style={{ marginTop: 6 }}>
          <span className={cls("vg-tone-notedot", c.tone)} />
          <span className="vg-note" style={{ fontSize: "var(--vg-text-sm)",
            color: c.tone === "bad" ? "var(--vg-down)" : undefined }}>{c.text}</span>
        </div>
      ))}
    </div>
  );
}

// A clicked frame's briefing: the call, the fills, and each trade's stored
// Mira desk review (matched by trade_key = "{opened_at}|{label}").
function FrameBriefing({ sel, onClear }) {
  const day = sel.day;
  const trades = sel.trades || [];
  const aq = useLive(
    () => (trades.length ? getTradeAnalyses(day) : Promise.resolve(null)),
    null, [day, trades.length]);
  const analyses = (aq.data && aq.data.available && aq.data.analyses) || [];
  // the frame call's FULL Mira synthesis (frames carry only the plot fields)
  const fq = useLive(
    () => (sel.call ? getSpxForecasts(day, "SPX", 60) : Promise.resolve(null)),
    null, [day, sel.call && sel.call.id]);
  const fRow = sel.call
    ? ((fq.data && fq.data.available && fq.data.forecasts) || []).find((r) => r.id === sel.call.id)
    : null;
  // trade_key = "{opened_at}|{label}", but tone's label omits the strike the
  // journal label carries — the opened_at timestamp alone is the stable match.
  const forTrade = (t) =>
    (t.opened_at && analyses.find((r) => String(r.trade_key || "").startsWith(`${t.opened_at}|`)))
      || analyses.find((r) => r.label === t.label) || null;
  const c = sel.call, m = sel.market;
  const side = callSide(c && c.bias);
  const act = flatAction(c, m ? m.close : null);
  return (
    <div>
      <div className="vg-spread" style={{ alignItems: "baseline", gap: 8 }}>
        <div className="vg-kicker">Frame {sel.t}{day ? ` · ${day}` : ""}</div>
        <button className="vg-linkbtn" onClick={onClear} title="Collapse this briefing">✕ close</button>
      </div>
      <div className="vg-card" style={{ marginTop: 8 }}>
        {c ? (
          <>
            <div className="vg-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className={cls("vg-badge", sideTone(side))} style={{ fontWeight: 700 }}>
                {side ? side.toUpperCase() : "NEUTRAL"}</span>
              {actionBadge(act)}
              {c.born_invalid && <span className="vg-badge bad">BORN-INVALID</span>}
              {c.score && (
                <span className={cls("vg-badge", verdictTone(c.score.verdict))}>
                  {c.score.verdict}{c.score.moved_pt != null ? ` ${c.score.moved_pt > 0 ? "+" : ""}${c.score.moved_pt}pt` : ""}
                </span>)}
            </div>
            <div style={{ marginTop: 8 }}><LevelChips call={c} price={m ? m.close : null} /></div>
            <div className="vg-note" style={{ marginTop: 6 }}>
              call made {c.minute} @ {c.price_at}
              {m ? ` · frame closed ${m.close} (${m.ret_pct > 0 ? "+" : ""}${m.ret_pct}%)` : ""}
            </div>
            <MiraCallBlock row={fRow} />
          </>
        ) : <p className="vg-note">No analyst call stood in this frame.</p>}
      </div>
      {trades.map((t, i) => {
        const aligned = side != null ? t.dir === side : null;
        const r = forTrade(t);
        const parsed = r ? parseMira(r.analysis) : null;
        return (
          <div key={i} className="vg-card" style={{ marginTop: 10 }}>
            <div className="vg-row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <b style={{ fontSize: "var(--vg-text-sm)" }}>{t.time} — {t.label}</b>
              <span className={cls("vg-badge", t.dir === "bullish" ? "good" : "bad")}>{t.dir}</span>
              {aligned != null && (
                <span className={cls("vg-badge", aligned ? "good" : "bad")}>
                  {aligned ? "✓ with the call" : "✗ against the call"}</span>)}
              {t.realized != null
                ? <b className={t.realized >= 0 ? "vg-up" : "vg-down"}>{money(t.realized)}</b>
                : <span className="vg-badge plain">open</span>}
            </div>
            {r ? (
              <details style={{ marginTop: 8 }}>
                <summary className="vg-note" style={{ cursor: "pointer" }}>
                  {(parsed && parsed.headline) || String(r.analysis || "").slice(0, 100)}
                </summary>
                <div style={{ marginTop: 6 }}>
                  <MiraRender data={parsed} text={r.analysis} />
                </div>
              </details>
            ) : (
              <p className="vg-note" style={{ marginTop: 6 }}>
                {t.realized == null ? "Desk review lands after the trade closes."
                  : "Desk review pending — the auto-loop drains 2 per tick."}
              </p>
            )}
          </div>
        );
      })}
      {!trades.length && <p className="vg-note" style={{ marginTop: 10 }}>No trades in this frame.</p>}
    </div>
  );
}

// The cockpit's right pane (mounted by App in place of the Notebook) — always
// the NOW lens; frame briefings render inline next to the log (CockpitView).
export function CockpitPanel({ refreshNonce }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const m = etMinNow();
      if (m >= 540 && m <= 965) setTick((n) => n + 1);
    }, 120000);
    return () => clearInterval(t);
  }, []);
  const q = useLive(() => getFrames(undefined), null, [tick, refreshNonce]);
  const d = q.data && q.data.available ? q.data : null;
  // the playbook table rows feed both the checklist's zone test and the watch
  const pq = useLive(() => getJson(`${backend()}/api/spx/playbook?symbol=SPX`, { timeoutMs: 30000 }), null, [refreshNonce]);
  const planRows = (((pq.data && pq.data.available && pq.data.scaffold) || {}).table || {}).rows || [];
  const preOpen = etMinNow() < 570;
  return (
    <div className="vg-pane-body">
      {preOpen && <CarriedRulesCard />}
      {d && !preOpen && <NowCard d={d} isToday />}
      {d && !preOpen && <ChecklistCard d={d} planRows={planRows} />}
      <AlertsBlock refreshNonce={refreshNonce} />
      {d && <LevelsWatch d={d} rows={planRows} />}
      {d && <DisciplineCard d={d} />}
      {!d && <p className="vg-note" style={{ marginTop: 12 }}>
        {q.loading ? "Reading the day…" : "Cockpit needs the SQLite backend."}</p>}
    </div>
  );
}

// ── the record: one table row per 15-minute frame ───────────────────────────
function FrameTr({ f, selected, onSelect }) {
  const c = f.call, m = f.market;
  const side = callSide(c && c.bias);
  const act = flatAction(c, m ? m.close : null);
  const trades = f.trades || [];
  // inherited (non-fresh) calls fade so the CHANGES stand out down the column
  const faded = c && !c.fresh ? { opacity: 0.45 } : undefined;
  const bg = selected ? { background: "var(--vg-raised)", boxShadow: "inset 2px 0 0 var(--vg-accent, currentColor)" }
    : trades.length ? { background: "var(--vg-raised)" } : undefined;
  return (
    <tr className="click" onClick={() => onSelect(f)} style={bg}
      title="open this frame's briefing in the right panel">
      <td className="num" style={{ textAlign: "left" }}>{f.t}</td>
      <td style={faded}>
        {c ? (
          <span className="vg-row" style={{ gap: 5, alignItems: "center" }}>
            <span className={cls("vg-badge", sideTone(side))} style={{ fontWeight: 700 }}>
              {side ? side.toUpperCase() : "NEUTRAL"}</span>
            {c.fresh && <span className="vg-fr-fresh" title={`new call this frame @ ${c.minute}`} />}
          </span>
        ) : <span className="vg-note">—</span>}
      </td>
      <td>{c ? (
        <span className={cls("vg-badge", act.tone)} style={{ fontWeight: 700 }} title={act.detail}>
          {act.verb}</span>
      ) : null}</td>
      <td className="num" style={faded}>{c && c.target != null ? c.target : "—"}</td>
      <td className="num" style={faded}>{c && c.invalidation != null ? c.invalidation : "—"}</td>
      <td className="num" title={m ? `close ${m.close}` : ""}>
        {m ? (
          <span className="vg-row" style={{ gap: 5, alignItems: "center", justifyContent: "flex-end" }}>
            <span className={cls("vg-tone-cellmini", m.tone)} />
            <span>{m.ret_pct > 0 ? "+" : ""}{m.ret_pct}%</span>
          </span>
        ) : "—"}
      </td>
      <td>{c && c.score
        ? <span className={cls("vg-badge", verdictTone(c.score.verdict))} style={{ fontSize: "var(--vg-text-xs)" }}>
            {c.score.verdict}{c.score.moved_pt != null ? ` ${c.score.moved_pt > 0 ? "+" : ""}${c.score.moved_pt}pt` : ""}
          </span>
        : c && c.fresh ? <span className="vg-note" style={{ fontSize: "var(--vg-text-xs)" }}>resolving…</span> : null}
      </td>
      <td>
        <span className="vg-row" style={{ gap: 5, flexWrap: "wrap" }}>
          {trades.map((t, i) => {
            const aligned = side != null ? t.dir === side : null;
            return (
              <span key={i} className={cls("vg-badge", aligned === false ? "bad" : aligned ? "good" : "plain")}
                title={`${t.time} · ${t.dir}${t.realized != null ? ` · ${money(t.realized)}` : " · open"}`}>
                {aligned === false ? "✗" : aligned ? "✓" : "·"} {t.label}
              </span>
            );
          })}
        </span>
      </td>
      <td className="num">
        {f.frame_pnl != null && f.frame_pnl !== 0
          ? <b className={f.frame_pnl >= 0 ? "vg-up" : "vg-down"}>{money(f.frame_pnl)}</b> : ""}
      </td>
    </tr>
  );
}

export function CockpitView({ refreshNonce }) {
  const [day, setDay] = useState(todayET());
  const isToday = day === todayET();
  const preOpen = isToday && etMinNow() < 570;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isToday) return undefined;
    // poll only 09:00–16:05 ET — after hours nothing changes
    const t = setInterval(() => {
      const m = etMinNow();
      if (m >= 540 && m <= 965) setTick((n) => n + 1);
    }, 120000);
    return () => clearInterval(t);
  }, [isToday]);
  const q = useLive(() => getFrames(day), null, [day, tick, refreshNonce]);
  const d = q.data && q.data.available ? q.data : null;
  // the chart is the centerpiece: tall by default, full-height when expanded,
  // collapsible to a strip when the trader wants the log. Expanded = candles
  // (reading the tape); default = line-on-levels (orientation).
  const [chartMode, setChartMode] = useState("fit");   // fit | big | hidden
  const chartBig = chartMode === "big";
  // a clicked frame's briefing renders inline, right of the log (the right pane
  // stays on the NOW lens). Clicking the same row again collapses it.
  const [sel, setSel] = useState(null);
  const select = (f) =>
    setSel((prev) => (prev && prev.t === f.t && prev.day === day ? null : { ...f, day }));
  return (
    <div className="vg-pane-body">
      <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <div className="vg-row" style={{ gap: 8, alignItems: "baseline" }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Cockpit</h2>
          <span className="vg-note">the market · the analyst&apos;s calls · you</span>
        </div>
        <div className="vg-row" style={{ gap: 10, alignItems: "baseline" }}>
          {isToday && etMinNow() >= 570 && (
            <>
              <button className="vg-linkbtn" onClick={() => setChartMode(chartBig ? "fit" : "big")}
                title={chartBig ? "Back to the fitted line chart" : "Expand: full height, candles, full toolbar"}>
                {chartBig ? "⛶ fit" : "⛶ expand"}</button>
              <button className="vg-linkbtn" onClick={() => setChartMode(chartMode === "hidden" ? "fit" : "hidden")}
                title="Collapse/show the chart — the log and the right pane carry the same story">
                {chartMode === "hidden" ? "show chart" : "hide chart"}</button>
            </>
          )}
          {d && d.day_pnl != null && (
            <span className="vg-note">day <b className={d.day_pnl >= 0 ? "vg-up" : "vg-down"}>{money(d.day_pnl)}</b></span>
          )}
          <input type="date" className="vg-scan-filter" value={day} max={todayET()}
            onChange={(e) => { setDay(e.target.value || todayET()); setSel(null); }}
            aria-label="Cockpit day" />
        </div>
      </div>

      {/* pre-open the plan leads (the full playbook, not a reprise); during
          RTH the live tape leads and the plan waits below the log */}
      {preOpen && <PlanHalf refreshNonce={refreshNonce} />}

      {isToday && !preOpen && chartMode !== "hidden" && (
        <div className="vg-card" style={{ marginTop: 8, padding: 8 }}>
          <InstrumentChartCard symbol="SPX" defaultTf="5m" compact={!chartBig}
            seriesType={chartBig ? "candles" : "line"}
            height={chartBig ? Math.max(480, window.innerHeight - 220)
              : Math.max(460, Math.round(window.innerHeight * 0.55))}
            initialLayers={["levels", "forecast", "calls"]} />
        </div>
      )}

      {/* the log (tone strip + frames) on the left; the clicked frame's briefing
          expands beside it and collapses on ✕ / re-click. Flex-wrap folds the
          briefing under the log on narrow screens. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: "3 1 640px", minWidth: 0 }}>
          <ToneCompareCard marketOpen={isToday} day={isToday ? undefined : day} slim />

          <div className="vg-card vg-tablewrap" style={{ marginTop: 14, padding: "10px 14px" }}>
            <div className="vg-kicker" style={{ marginBottom: 6 }}>
              Every 15 minutes{d ? ` · ${d.frames.length} frames` : ""}
              <span className="vg-note" style={{ fontWeight: 400 }}> — newest first · click a row for its briefing · ✓ with / ✗ against the call</span>
            </div>
            {d && d.frames.length > 0 && (
              <table className="vg-table">
                <thead>
                  <tr>
                    <th>Time</th><th>Call</th><th>Action</th>
                    <th className="num">Target</th><th className="num">Wrong if</th>
                    <th className="num">Market</th><th>Resolved</th><th>You</th>
                    <th className="num">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {d.frames.map((f) => (
                    <FrameTr key={f.t} f={f} onSelect={select}
                      selected={!!sel && sel.t === f.t && sel.day === day} />
                  ))}
                </tbody>
              </table>
            )}
            {d && !d.frames.length && <p className="vg-note">No frames for {day} — no stored bars or fills.</p>}
            {!d && <p className="vg-note">{q.loading ? "Building the briefing…" : "Cockpit needs the SQLite backend."}</p>}
          </div>
        </div>
        {sel && (
          <div style={{ flex: "2 1 400px", minWidth: 0, marginTop: 14, position: "sticky", top: 8 }}>
            <FrameBriefing sel={sel} onClear={() => setSel(null)} />
          </div>
        )}
      </div>

      {/* ops block (from the retired TodayView, W2): the live signal → execute
          path, the bot's own record, and nightly-run health — surfaces that
          existed nowhere else. Today-only; historical days show the day's story
          above, not the machine room. */}
      {isToday && <OpsBlock />}

      {/* the plan half after the live half once the session is underway */}
      {isToday && !preOpen && <PlanHalf refreshNonce={refreshNonce} />}
    </div>
  );
}

function OpsBlock() {
  const [status, setStatus] = useState(null);
  const [perf, setPerf] = useState(null);
  const [nightly, setNightly] = useState(null);
  const [spot, setSpot] = useState(null);
  const [ticket, setTicket] = useState(null);
  const load = async () => {
    const [s, p, n, b] = await Promise.all([
      getBotStatus(), getBotPerformance(), getNightlyStatus(1), getPlaybook(null),
    ]);
    setStatus(s && s.available !== false ? s : null);
    setPerf(p && p.available !== false ? p : null);
    setNightly(n && n.available && n.runs && n.runs.length ? n.runs[0] : null);
    setSpot((b && b.available && b.scaffold && b.scaffold.regime && b.scaffold.regime.spot) || null);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!status || !status.market_open) return undefined;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [status && status.market_open]);
  if (!status) return null;
  return (
    <>
      <SignalsCard live={status.live_signals || []} armed={status.armed || []} spot={spot}
        onExecute={(t) => setTicket({
          sym: t.symbol, spot,
          seed: { level: t.spy_level, entry: t.spy_entry,
                  role: t.side === "long" ? "support" : "resistance" },
          signalId: t.id,
        })} />
      <div className="vg-stats" style={{ marginTop: 14, gridTemplateColumns: "1fr 1fr" }}>
        <StrategyCard perf={perf} />
        <MachineCard run={nightly} />
      </div>
      {ticket && (
        <TicketModal sym={ticket.sym} spot={ticket.spot} seed={ticket.seed}
          signalPaperId={ticket.signalId} onClose={() => setTicket(null)} />
      )}
    </>
  );
}
