// DeskRail — the right pane for desk/review routes (plan, scanner, journal,
// track record, strategies). Those routes used to fall back to a per-ticker
// Notebook or bare chat: route-blind filler. The rail answers "what needs me
// NOW" with three compact, linked blocks — armed level alerts with live
// distance, today's open risk, and the per-strategy pulse — then keeps the
// Mira chat docked underneath. Facts render as summaries + links (the IA
// law): each block links to its canonical surface, never re-renders it.
import { useLive, getJson } from "./live.js";
import { cls } from "./util.jsx";

const { useEffect, useState } = React;

const backend = () => (JSON.parse(localStorage.getItem("vantage-settings") || "{}").backendUrl
  || "http://127.0.0.1:8641").replace(/\/+$/, "");
const money = (v) => (v == null ? "—"
  : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const todayISO = () => new Intl.DateTimeFormat("en-CA",
  { timeZone: "America/New_York" }).format(new Date());

// ── armed level alerts, with live distance to spot ──────────────────────────
export function AlertsBlock({ refreshNonce }) {
  const [nonce, setNonce] = useState(0);
  const alertsQ = useLive(() => getJson(`${backend()}/api/alerts`), null, [refreshNonce, nonce]);
  const spotQ = useLive(() => getJson(`${backend()}/api/spx/playbook?symbol=SPX`), null, [refreshNonce]);
  const alerts = (alertsQ.data && alertsQ.data.alerts) || [];
  const spot = (((spotQ.data || {}).scaffold || {}).regime || {}).spot;
  const armed = alerts.filter((a) => !a.fired_at);
  const fired = alerts.filter((a) => a.fired_at).slice(-2);
  const drop = async (id) => {
    await fetch(`${backend()}/api/alerts/${id}`, { method: "DELETE" }).catch(() => {});
    setNonce((n) => n + 1);
  };
  return (
    <div className="vg-card" style={{ marginTop: 10 }}>
      <div className="vg-spread">
        <span className="vg-kicker" style={{ marginBottom: 0 }}>Alerts</span>
        <a className="vg-note" href="#/cockpit" style={{ fontSize: 12 }}>arm on the ladder →</a>
      </div>
      {armed.length === 0 && (
        <p className="vg-note" style={{ margin: "8px 0 0", fontSize: 13 }}>
          None armed. 🔔 a ladder level and Telegram pings you on the cross.
        </p>
      )}
      {armed.map((a) => {
        const dist = (spot != null && a.symbol === "SPX") ? (a.price - spot) : null;
        return (
          <div key={a.id} className="vg-row" style={{ gap: 8, marginTop: 8, alignItems: "baseline" }}>
            <span className="vg-badge warn">🔔 {a.symbol} {a.price}</span>
            {dist != null && (
              <span className="vg-note" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                {dist >= 0 ? "+" : ""}{dist.toFixed(1)}pt away
              </span>
            )}
            {a.note && <span className="vg-note" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{a.note}</span>}
            <button className="vg-linkbtn" style={{ fontSize: 12, marginLeft: "auto" }}
              title="disarm" onClick={() => drop(a.id)}>✕</button>
          </div>
        );
      })}
      {fired.map((a) => (
        <div key={a.id} className="vg-note" style={{ marginTop: 6, fontSize: 12 }}>
          fired · {a.symbol} {a.price} @ {String(a.fired_at).slice(11, 16)}Z
        </div>
      ))}
    </div>
  );
}

// ── today's open risk: real open trades + realized so far ───────────────────
function OpenRiskBlock({ refreshNonce }) {
  const q = useLive(() => getJson(`${backend()}/api/journal/activity?day=${todayISO()}`),
    null, [refreshNonce]);
  const d = q.data && q.data.available !== false ? q.data : null;
  const trades = (d && d.trades) || [];
  const open = trades.filter((t) => t.status === "open");
  const realized = trades.reduce((s, t) => s + (t.realized || 0), 0);
  const closedN = trades.length - open.length;
  return (
    <div className="vg-card" style={{ marginTop: 10 }}>
      <div className="vg-spread">
        <span className="vg-kicker" style={{ marginBottom: 0 }}>Today — open risk</span>
        <a className="vg-note" href="#/journal" style={{ fontSize: 12 }}>journal →</a>
      </div>
      {!d && <p className="vg-note" style={{ margin: "8px 0 0", fontSize: 13 }}>{q.loading ? "…" : "No trades yet today."}</p>}
      {d && (
        <p className="vg-note" style={{ margin: "8px 0 0", fontSize: 13 }}>
          realized <b className={realized >= 0 ? "vg-up" : "vg-down"}>{money(realized)}</b>
          {" "}· {closedN} closed · {open.length} open
        </p>
      )}
      {open.map((t, i) => (
        <div key={i} className="vg-row" style={{ gap: 8, marginTop: 6, alignItems: "baseline" }}>
          <span className="vg-badge plain" style={{ fontSize: 12 }}>{t.ticker || "SPX"}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
          <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>{money(t.cost)} in</span>
        </div>
      ))}
    </div>
  );
}

// ── the strategy pulse: by-strategy paper record + taken-live bridge ─────────
function StrategyPulseBlock({ refreshNonce }) {
  const q = useLive(() => getJson(`${backend()}/api/paper/spreads`), null, [refreshNonce]);
  const bs = (q.data && q.data.by_strategy) || null;
  if (!bs || !Object.keys(bs).length) return null;
  return (
    <div className="vg-card" style={{ marginTop: 10 }}>
      <div className="vg-spread">
        <span className="vg-kicker" style={{ marginBottom: 0 }}>Strategy pulse</span>
        <a className="vg-note" href="#/scanner/performance" style={{ fontSize: 12 }}>book →</a>
      </div>
      <table className="vg-mini" style={{ marginTop: 6, width: "100%" }}><tbody>
        {Object.entries(bs).map(([name, s]) => (
          <tr key={name}>
            <td style={{ fontSize: 12 }}>{name}</td>
            <td className="vg-note" style={{ fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {s.open || 0} open{s.n ? ` · ${Math.round((s.win_rate || 0) * 100)}%` : ""}
            </td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {s.n
                ? <b className={s.total_pnl >= 0 ? "vg-up" : "vg-down"} style={{ fontSize: 12 }}>{money(s.total_pnl)}</b>
                : <span className="vg-note" style={{ fontSize: 12 }}>—</span>}
              {s.live_taken ? <span className="vg-badge warn" style={{ fontSize: 10, marginLeft: 4 }}>{s.live_taken} live</span> : null}
            </td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

// route → which blocks lead (all three are cheap; order = relevance).
// scanner (the merged Strategies page) gets NO StrategyPulseBlock — the page's
// own by-strategy table is the canonical render of the same /api/paper/spreads
// data (IA law: the rail summarizes what's elsewhere, never what's on screen).
const ORDER = {
  scanner: [AlertsBlock, OpenRiskBlock],
  journal: [OpenRiskBlock, AlertsBlock, StrategyPulseBlock],
  trades: [OpenRiskBlock, StrategyPulseBlock, AlertsBlock],
};

export function DeskRail({ route, refreshNonce }) {
  const blocks = ORDER[route] || ORDER.scanner;
  return (
    <div className="vg-pane-body" style={{ paddingTop: 0 }}>
      {blocks.map((B, i) => <B key={i} refreshNonce={refreshNonce} />)}
    </div>
  );
}
