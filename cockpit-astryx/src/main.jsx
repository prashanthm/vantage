// The cockpit, re-rendered in the Astryx idiom (facebook/astryx) — a standalone
// greenfield surface per the astryx-eval verdict. Same backend, same data, zero
// coupling to the buildless SPA: decision surfaces only (now-card, checklist,
// levels watch, the 15-minute log). Chart + Mira briefings stay in /#/cockpit.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { Spinner } from "@astryxdesign/core/Spinner";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";

// ── same backend as the SPA (shared origin -> shared localStorage settings) ──
const backend = () => (JSON.parse(localStorage.getItem("vantage-settings") || "{}").backendUrl
  || "http://127.0.0.1:8641").replace(/\/+$/, "");
async function getJson(url, timeoutMs = 60000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const todayET = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const etMinNow = () => {
  const [h, m] = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date()).split(":");
  return Number(h) * 60 + Number(m);
};
const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const ageMin = (iso) => {
  try { return Math.round((Date.now() - new Date(iso).getTime()) / 60000); }
  catch { return null; }
};

// ── decision logic ported verbatim from src/cockpit.jsx (code, never Mira) ──
function callSide(bias) {
  const s = String(bias || "").toLowerCase();
  if (s.includes("up") || s.includes("bull") || s.includes("long")) return "bullish";
  if (s.includes("down") || s.includes("bear") || s.includes("short")) return "bearish";
  return null;
}
// tone -> Astryx Badge/StatusDot variant
const V = { good: "success", bad: "error", warn: "warning", plain: "neutral" };
// StatusDot's `label` is aria-only — pair it with visible Text.
const DotLine = ({ tone, text }) => (
  <HStack gap={2} align="center">
    <StatusDot variant={V[tone]} label={text} />
    <Text type="supporting" color={tone === "bad" ? "error" : "primary"}>{text}</Text>
  </HStack>
);
const sideTone = (side) => (side === "bullish" ? "good" : side === "bearish" ? "bad" : "plain");
function verdictTone(v) {
  const s = String(v || "").toLowerCase();
  if (s.includes("hit") || s.includes("correct")) return "good";
  if (s.includes("invalid") || s.includes("wrong")) return "bad";
  return "plain";
}
function levelState(call, price) {
  const side = callSide(call && call.bias);
  if (!side || price == null) return null;
  if (call.target != null
      && (side === "bullish" ? price >= call.target : price <= call.target)) return "target";
  if (call.invalidation != null
      && (side === "bullish" ? price <= call.invalidation : price >= call.invalidation)) return "invalidated";
  return null;
}
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
// the pre-trade checklist rules (Jul-21 disaster review + backtested gap odds)
function checklistItems(d, planRows) {
  const buckets = d.buckets || [];
  const last = buckets[buckets.length - 1];
  const price = last ? last.close : null;
  const etMin = etMinNow();
  const call = ((d.frames || []).find((f) => f.call) || {}).call;
  const side = callSide(call && call.bias);
  const age = call ? ageMin(call.as_of) : null;
  const trades = d.trades || [];
  const lastTrade = trades.length ? trades[trades.length - 1] : null;
  const lastEntryMin = lastTrade ? lastTrade.start_min : null;
  const items = [];
  const add = (tone, text) => items.push({ tone, text });
  if (last) {
    const st = last.session_tone;
    add(st === "flat" ? "plain" : "good",
      st === "bull" ? `Tape is UP ${last.session_ret_pct > 0 ? "+" : ""}${last.session_ret_pct}% on the day — longs swim with it, shorts fight it.`
      : st === "bear" ? `Tape is DOWN ${last.session_ret_pct}% on the day — shorts swim with it, longs fight it.`
      : "Tape is flat — no side has the ball; smaller size, quicker exits.");
  }
  const g = gapRead(d.gap_pct);
  if (g) add(g.tone, g.text);
  if (call) {
    if (call.born_invalid) add("bad", "The standing call was broken at birth — there is no analyst thesis right now. Stand down or wait for the next one.");
    else if (age != null && age > 20) add("warn", `The analyst call is ${age} minutes old — stale. Wait for the refresh before leaning on it.`);
    else add("good", `Analyst says ${side ? side.toUpperCase() : "NEUTRAL"}${call.target != null ? ` toward ${call.target}` : ""} (${age} min ago). Trading against it has cost real money this month.`);
  } else add("plain", "No analyst call yet this session.");
  const testing = (planRows || []).filter((r) =>
    (r.role === "support" || r.role === "resistance") && price != null
    && price >= (r.lo != null ? r.lo : r.price) && price <= (r.hi != null ? r.hi : r.price));
  if (testing.length) {
    const z = testing[0];
    add("warn", `Price is INSIDE the ${z.lo != null ? `${z.lo}–${z.hi}` : z.price} zone right now — it hasn't picked a side. Entering mid-zone is a coin flip; let it resolve.`);
  }
  if (etMin < 600) add("warn", "Opening window (before 10:00): 1 contract max, and never against the gap. The 09:39 five-lot cost $4,430.");
  else if (etMin >= 930) add("bad", "Past 15:30 — no new trades. Whatever this is, it can wait for tomorrow's plan.");
  if (d.day_pnl != null && d.day_pnl <= -2000)
    add("bad", `Down ${money(d.day_pnl)} — the $2,000 daily stop is HIT. The day is over; anything else is revenge trading.`);
  else if ((d.streak || 0) >= 3)
    add("bad", `${d.streak} losses in a row — step away from the screen for 15 minutes before the next entry.`);
  else if (d.day_pnl != null && d.day_pnl < 0)
    add("plain", `Down ${money(d.day_pnl)} on the day — ${money(-2000 - d.day_pnl)} of room left before the hard stop.`);
  if (lastEntryMin != null && etMin - lastEntryMin >= 0 && etMin - lastEntryMin < 5)
    add("warn", `You entered ${etMin - lastEntryMin} min ago — no adding, no size-up for 5 minutes. Averaging into losers is how -$4,430 happens.`);
  return items;
}

// ── views ────────────────────────────────────────────────────────────────────
function NowCard({ d, isToday }) {
  const call = ((d.frames || []).find((f) => f.call) || {}).call;
  const buckets = d.buckets || [];
  const price = buckets.length ? buckets[buckets.length - 1].close : null;
  const openTrades = (d.trades || []).filter((t) => t.realized == null);
  const side = callSide(call && call.bias);
  const age = call ? ageMin(call.as_of) : null;
  const etMin = etMinNow();
  const closed = !isToday || etMin >= 960 || etMin < 570;
  const stale = isToday && !closed && age != null && age > 20;
  const flat = flatAction(call, price);
  return (
    <Section>
      <VStack gap={2} padding={3}>
        <HStack gap={2} align="center" justify="between" wrap="wrap">
          <Text type="label" color="secondary">{closed ? "Session closed — final call" : "Next 15 minutes"}</Text>
          <Text type="supporting" color="secondary">
            {call ? `@ ${call.minute} from ${call.price_at ?? "?"}` : "no call yet"}
            {!closed && age != null ? ` · ${age}m ago` : ""}{stale ? " · STALE" : ""}
          </Text>
        </HStack>
        {call ? (
          <>
            <HStack gap={2} align="center" wrap="wrap">
              <Badge variant={V[sideTone(side)]} label={side ? side.toUpperCase() : "NEUTRAL"} />
              {call.born_invalid && <Badge variant="error" label="BORN-INVALID" />}
              {price != null && <Text type="supporting" color="secondary">last {price}</Text>}
            </HStack>
            <HStack gap={1} wrap="wrap">
              {call.target != null && <Badge variant="success" label={`target ${call.target}${price != null ? ` (${call.target - price >= 0 ? "+" : ""}${(call.target - price).toFixed(1)}pt)` : ""}`} />}
              {call.invalidation != null && <Badge variant="error" label={`wrong ${call.invalidation}${price != null ? ` (${call.invalidation - price >= 0 ? "+" : ""}${(call.invalidation - price).toFixed(1)}pt)` : ""}`} />}
              {(call.path || []).map((s, i) => <Badge key={i} variant="neutral" label={`${i + 1}· ${s.price}`} />)}
            </HStack>
            {closed ? (
              <Text type="supporting" color="secondary">Market closed — nothing to act on.</Text>
            ) : openTrades.length === 0 ? (
              <HStack gap={2} align="center">
                <Badge variant={V[flat.tone]} label={flat.verb} />
                <Text type="supporting" color="secondary">{flat.detail}</Text>
              </HStack>
            ) : openTrades.map((t, i) => {
              const a = positionAction(call, t, price);
              return (
                <HStack key={i} gap={2} align="center" wrap="wrap">
                  <Badge variant={V[a.tone]} label={a.verb} />
                  <Text type="label">{t.label}</Text>
                  <Badge variant={t.dir === "bullish" ? "success" : "error"} label={t.dir} />
                  <Text type="supporting" color="secondary">{a.detail}</Text>
                </HStack>
              );
            })}
          </>
        ) : <Text type="supporting" color="secondary">Waiting for the first analyst call of the session.</Text>}
      </VStack>
    </Section>
  );
}

function Checklist({ d, planRows }) {
  const items = checklistItems(d, planRows);
  if (!items.length) return null;
  return (
    <Section>
      <VStack gap={2} padding={3}>
        <Text type="label" color="secondary">Before you trade — prefilled · code, never Mira</Text>
        {items.map((it, i) => <DotLine key={i} tone={it.tone} text={it.text} />)}
      </VStack>
    </Section>
  );
}

function LevelsWatch({ d, rows }) {
  const buckets = d.buckets || [];
  const price = buckets.length ? buckets[buckets.length - 1].close : null;
  const sr = (rows || []).filter((r) => r.role === "support" || r.role === "resistance");
  if (!sr.length || price == null) return null;
  const data = sr.map((r, i) => {
    const lo = r.lo != null ? r.lo : r.price;
    const hi = r.hi != null ? r.hi : r.price;
    const now = price > hi ? "support" : price < lo ? "resistance" : "testing";
    return { id: i, r, now, flip: now !== "testing" && now !== r.role };
  });
  return (
    <Section>
      <VStack gap={2} padding={3}>
        <Text type="label" color="secondary">Levels watch — plan vs now (last {price})</Text>
        <Table data={data} idKey="id" density="compact" columns={[
          { key: "level", header: "Level", width: proportional(2), renderCell: ({ r }) => (
            <VStack gap={0}>
              <Text type="body" weight="semibold">{r.hi != null && r.hi > r.lo ? `${r.lo}–${r.hi}` : r.price}</Text>
              <Text type="supporting" color="secondary">{String(r.label || "").replace(/\s*[★✦☆✦].*$/, "")}</Text>
            </VStack>
          )},
          { key: "plan", header: "Plan", width: proportional(1), renderCell: ({ r }) => (
            <Badge variant={r.role === "support" ? "success" : "error"} label={r.role.slice(0, 3)} />
          )},
          { key: "now", header: "Now", width: proportional(1), renderCell: ({ now }) => (
            <Badge variant={now === "support" ? "success" : now === "resistance" ? "error" : "warning"}
              label={now === "testing" ? "testing" : now.slice(0, 3)} />
          )},
          { key: "flip", header: "", width: pixel(70), renderCell: ({ flip }) => (
            flip ? <Badge variant="warning" label="FLIP" /> : null
          )},
        ]} />
      </VStack>
    </Section>
  );
}

function Discipline({ d }) {
  if (!d.verdict && !(d.commentary || []).length) return null;
  return (
    <Section>
      <VStack gap={2} padding={3}>
        <Text type="label" color="secondary">Discipline · code, never Mira</Text>
        {d.verdict && <Banner status="warning" title={d.verdict} />}
        {(d.commentary || []).map((c, i) => <DotLine key={i} tone={c.tone} text={c.text} />)}
      </VStack>
    </Section>
  );
}

function FramesTable({ d }) {
  const frames = d.frames || [];
  if (!frames.length) return <Text type="supporting" color="secondary">No frames — no stored bars or fills.</Text>;
  return (
    <Section>
      <VStack gap={2} padding={3}>
        <Text type="label" color="secondary">
          Every 15 minutes · {frames.length} frames — newest first · ✓ with / ✗ against the call
        </Text>
        <Table data={frames} idKey="t" density="compact" hasHover columns={[
          { key: "t", header: "Time", width: pixel(64) },
          { key: "call", header: "Call", width: pixel(110), renderCell: (f) => {
            const side = callSide(f.call && f.call.bias);
            return f.call
              ? <HStack gap={1} align="center">
                  <Badge variant={V[sideTone(side)]} label={side ? side.toUpperCase() : "NEUTRAL"} />
                  {f.call.fresh && <StatusDot variant="accent" label={`new call @ ${f.call.minute}`} tooltip={`new call @ ${f.call.minute}`} />}
                </HStack>
              : <Text type="supporting" color="secondary">—</Text>;
          }},
          { key: "action", header: "Action", width: pixel(110), renderCell: (f) => {
            if (!f.call) return null;
            const a = flatAction(f.call, f.market ? f.market.close : null);
            return <Badge variant={V[a.tone]} label={a.verb} />;
          }},
          { key: "target", header: "Target", width: pixel(80), renderCell: (f) =>
            <Text type="body">{f.call && f.call.target != null ? f.call.target : "—"}</Text> },
          { key: "wrong", header: "Wrong if", width: pixel(80), renderCell: (f) =>
            <Text type="body">{f.call && f.call.invalidation != null ? f.call.invalidation : "—"}</Text> },
          { key: "market", header: "Market", width: pixel(90), renderCell: (f) => f.market
            ? <HStack gap={1} align="center">
                <StatusDot variant={f.market.tone === "bull" ? "success" : f.market.tone === "bear" ? "error" : "neutral"}
                  label={f.market.tone} />
                <Text type="body">{`${f.market.ret_pct > 0 ? "+" : ""}${f.market.ret_pct}%`}</Text>
              </HStack>
            : <Text type="supporting" color="secondary">—</Text> },
          { key: "resolved", header: "Resolved", width: pixel(130), renderCell: (f) => {
            const c = f.call;
            if (c && c.score) return <Badge variant={V[verdictTone(c.score.verdict)]}
              label={`${c.score.verdict}${c.score.moved_pt != null ? ` ${c.score.moved_pt > 0 ? "+" : ""}${c.score.moved_pt}pt` : ""}`} />;
            return c && c.fresh ? <Text type="supporting" color="secondary">resolving…</Text> : null;
          }},
          { key: "you", header: "You", width: proportional(2), renderCell: (f) => {
            const side = callSide(f.call && f.call.bias);
            return (
              <HStack gap={1} wrap="wrap">
                {(f.trades || []).map((t, i) => {
                  const aligned = side != null ? t.dir === side : null;
                  return <Badge key={i}
                    variant={aligned === false ? "error" : aligned ? "success" : "neutral"}
                    label={`${aligned === false ? "✗" : aligned ? "✓" : "·"} ${t.label}`} />;
                })}
              </HStack>
            );
          }},
          { key: "pnl", header: "P&L", width: pixel(90), renderCell: (f) =>
            f.frame_pnl != null && f.frame_pnl !== 0
              ? <Text type="body" weight="semibold" color={f.frame_pnl >= 0 ? "success" : "error"}>{money(f.frame_pnl)}</Text>
              : null },
        ]} />
      </VStack>
    </Section>
  );
}

function App() {
  const [day, setDay] = useState(todayET());
  const isToday = day === todayET();
  const [tick, setTick] = useState(0);
  const [d, setD] = useState(null);
  const [planRows, setPlanRows] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isToday) return undefined;
    const t = setInterval(() => {   // poll 09:00–16:05 ET only
      const m = etMinNow();
      if (m >= 540 && m <= 965) setTick((n) => n + 1);
    }, 120000);
    return () => clearInterval(t);
  }, [isToday]);
  useEffect(() => {
    let dead = false;
    setLoading(true);
    getJson(`${backend()}/api/cockpit/frames${day ? `?day=${encodeURIComponent(day)}` : ""}`)
      .then((r) => { if (!dead) { setD(r && r.available ? r : null); setErr(null); } })
      .catch((e) => { if (!dead) { setD(null); setErr(String(e)); } })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [day, tick]);
  useEffect(() => {
    let dead = false;
    getJson(`${backend()}/api/spx/playbook?symbol=SPX`, 30000)
      .then((r) => { if (!dead && r && r.available) setPlanRows((((r.scaffold || {}).table || {}).rows) || []); })
      .catch(() => {});
    return () => { dead = true; };
  }, [tick]);
  return (
    <VStack gap={3} padding={4} xstyle={undefined}>
      <HStack gap={3} align="center" justify="between" wrap="wrap">
        <VStack gap={0}>
          <Heading level={1}>Cockpit</Heading>
          <Text type="supporting" color="secondary">
            the market · the analyst&apos;s calls · you — rendered in Astryx · <Link href="/#/cockpit">full cockpit (chart + briefings) →</Link>
          </Text>
        </VStack>
        <HStack gap={3} align="center">
          {d && d.day_pnl != null && (
            <Text type="large" weight="semibold" color={d.day_pnl >= 0 ? "success" : "error"}>{money(d.day_pnl)}</Text>
          )}
          <input type="date" value={day} max={todayET()} aria-label="Cockpit day"
            onChange={(e) => setDay(e.target.value || todayET())}
            style={{ font: "inherit", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", color: "var(--color-text-primary)" }} />
        </HStack>
      </HStack>
      {loading && !d && <HStack gap={2} align="center"><Spinner size="sm" /><Text type="supporting" color="secondary">Reading the day…</Text></HStack>}
      {!loading && !d && (
        <Banner status="error" title="Cockpit needs the SQLite backend"
          description={err ? `(${err}) — is the API up on ${backend()}?` : `No data for ${day}.`} />
      )}
      {d && (
        <>
          <NowCard d={d} isToday={isToday} />
          <Checklist d={d} planRows={planRows} />
          <LevelsWatch d={d} rows={planRows} />
          <Discipline d={d} />
          <FramesTable d={d} />
        </>
      )}
    </VStack>
  );
}

createRoot(document.getElementById("root")).render(
  <Theme theme={neutralTheme}><App /></Theme>
);
