// Market-tone vs trade-tone strip — extracted from the retired TodayView
// (W2 of the Astryx migration): cockpit + journal both render it.
import { getCoachTone, useLive } from "./live.js";
import { cls } from "./util.jsx";

const { useState, useEffect } = React;

const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Number(v)).toFixed(0)}`);

// ------------------------------------------------- 0. market tone vs trade tone
//
// Two strips on one 15-min timeline (09:30→16:00): what the MARKET is doing
// (bull/bear/flat per bucket, session tone anchored to the prior close so gaps
// count) vs what YOU keep doing (each entry placed at its time, with-trend or
// against). Pure arithmetic from /api/coach/tone; refreshes every 3 min while
// the market is open. Born from 2026-07-21: 0/11, −$9,035, nine puts into a
// rising tape — the mismatch was never on one screen.
export function ToneCompareCard({ marketOpen, day, slim }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!marketOpen) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 180000);
    return () => clearInterval(t);
  }, [marketOpen]);
  const q = useLive(() => getCoachTone(day), null, [tick, day]);
  const d = q.data && q.data.available ? q.data : null;
  if (!d || !(d.buckets || []).length) return null;
  const SLOTS = 26;                                   // 09:30..16:00 / 15m
  const slotOf = (startMin) => Math.max(0, Math.min(SLOTS - 1, Math.floor((startMin - 570) / 15)));
  const market = new Array(SLOTS).fill(null);
  for (const b of d.buckets) market[slotOf(b.start_min)] = b;
  const tradeSlots = new Array(SLOTS).fill(null).map(() => []);
  for (const t of d.trades || []) {
    if (t.start_min >= 570 && t.start_min < 960) tradeSlots[slotOf(t.start_min)].push(t);
  }
  const toneColor = (tn) => (tn === "bull" ? "var(--vg-up)" : tn === "bear" ? "var(--vg-down)" : "var(--vg-hairline)");
  const al = d.alignment || {};
  const last = d.buckets[d.buckets.length - 1];
  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="vg-kicker" style={{ marginBottom: 0 }}>
          Market tone vs your trades
          <span className="vg-note" style={{ fontWeight: 400 }}>
            {" "}— 15-min snapshots{d.gap_pct != null ? ` · gap ${d.gap_pct > 0 ? "+" : ""}${d.gap_pct}%` : ""}
            {last ? ` · session ${last.session_tone.toUpperCase()} (${last.session_ret_pct > 0 ? "+" : ""}${last.session_ret_pct}%)` : ""}
          </span>
        </div>
        {(al.with || al.against) && (
          <span className="vg-note" style={{ fontVariantNumeric: "tabular-nums" }}>
            with-trend <b className={al.with.pnl >= 0 ? "vg-up" : "vg-down"}>{al.with.n} · {money(al.with.pnl)}</b>
            {"  ·  "}against <b className={al.against.pnl >= 0 ? "vg-up" : "vg-down"}>{al.against.n} · {money(al.against.pnl)}</b>
          </span>
        )}
      </div>
      <div className="vg-tone-grid" style={{ marginTop: 10 }}>
        <span className="vg-note vg-tone-lbl">market</span>
        {market.map((b, i) => (
          <span key={i} className="vg-tone-cell"
            title={b ? `${b.t} · ${b.tone} (${b.ret_pct > 0 ? "+" : ""}${b.ret_pct}%) · session ${b.session_tone}` : ""}
            style={{ background: b ? toneColor(b.tone) : "transparent",
                     opacity: b ? (b.tone === "flat" ? 0.5 : 0.9) : 0.15,
                     border: b ? "none" : "1px dashed var(--vg-hairline)" }} />
        ))}
        <span className="vg-note vg-tone-lbl">you</span>
        {tradeSlots.map((ts, i) => (
          <span key={i} className="vg-tone-cell vg-tone-tradecell">
            {ts.map((t, j) => (
              <span key={j} className="vg-tone-dot"
                title={`${t.time} ${t.label} · ${t.dir}${t.with_trend == null ? "" : t.with_trend ? " · WITH trend" : " · AGAINST trend"}${t.realized != null ? ` · ${money(t.realized)}` : " · open"}`}
                style={{ background: t.dir === "bullish" ? "var(--vg-up)" : "var(--vg-down)",
                         boxShadow: t.with_trend === false ? "0 0 0 2px var(--vg-warn)" : "none" }} />
            ))}
          </span>
        ))}
      </div>
      <div className="vg-note" style={{ marginTop: 6, fontSize: "var(--vg-text-xs)" }}>
        dot = your entry (green long · red short) · amber ring = against the session tone at entry
      </div>
      {d.verdict && !slim && (
        <div className="vg-tone-verdict">⚠ {d.verdict}</div>
      )}
      {(d.commentary || []).length > 0 && !slim && (
        <div style={{ marginTop: 8 }}>
          {d.commentary.map((c, i) => (
            <div key={i} className="vg-tone-note">
              <span className={cls("vg-tone-notedot", c.tone)} />
              <span className="vg-note" style={{ fontSize: "var(--vg-text-sm)",
                color: c.tone === "bad" ? "var(--vg-down)" : undefined }}>{c.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

