// FuturesView — AMP futures win-rate analysis (Intelligence nav).
// Reads imported order executions (a separate broker export, not a Vantage
// holding), pairs them into round-trips, and shows: a reconciliation banner
// (loud when the export is a partial window), overall win-rate/PF/P&L tiles,
// win-rate-by-condition tables (exit type, hold time, entry hour ET, playbook
// alignment) with credible intervals, order behavior (cancel rate), and plain
// recommendations. Decision-support (ADR-008) — reads the user's CSVs, no orders.
import { cls } from "./util.jsx";
import { useLive, getFuturesAnalysis, importFutures } from "./live.js";

const { useState } = React;

const pct = (v) => (v == null ? "—" : `${Math.round(100 * v)}%`);
const usd = (v) => (v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`);

// a bucket dimension → a friendly heading + value relabeler (plain language).
const DIM_LABEL = {
  exit_type: "How you exited",
  hold_bucket: "How long you held",
  entry_hour_et: "Entry hour (ET)",
  playbook_align: "Vs the playbook",
  direction: "Direction",
  contract: "Contract",
};
const VALUE_LABEL = {
  Market: "Discretionary (market)", Stop: "Stop", StopLoss: "Stop-loss", Limit: "Limit (target)",
  with: "With the playbook", against: "Against the playbook", neutral: "Neutral",
  "<1m": "under 1 min", "1-5m": "1–5 min", "5-30m": "5–30 min", "30m+": "over 30 min",
  long: "Long", short: "Short",
};
const relabel = (v) => VALUE_LABEL[v] || v;

export function FuturesView({ refreshNonce }) {
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  // playbook-alignment fetches NQ bars (slower); default on but let the user skip.
  const [alignment] = useState(true);

  const fa = useLive(() => getFuturesAnalysis({ alignment }), null, [refreshNonce, nonce, alignment]);
  const a = fa.data;

  const reimport = async () => {
    if (busy) return;
    setBusy(true);
    await importFutures();
    setBusy(false);
    setNonce((n) => n + 1);
  };

  if (a && a.available === false) {
    return (
      <div className="vg-pane-body">
        <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Futures</h2>
        <p className="vg-note">
          {a.note || "No AMP futures fills imported yet."} Put the AMP CSV export in{" "}
          <code>data/ampfutures/</code> and run{" "}
          <code>python -m vantage_server.futures --import ampfutures</code>{" "}
          (or click Import below).
        </p>
        <button className="vg-btn-sm" disabled={busy} onClick={reimport}>
          {busy ? "Importing…" : "Import from data/ampfutures"}
        </button>
      </div>
    );
  }

  const ov = (a && a.overall) || {};
  const rec = (a && a.reconciliation) || {};
  const ob = (a && a.orderBehavior) || {};
  const notable = (a && a.notable) || [];
  const buckets = (a && a.buckets) || [];
  const baseline = a && a.baselineWinRate;

  // group the full buckets by dimension for the per-lens tables (skip baseline row)
  const byDim = {};
  for (const b of buckets) {
    if (b.dimension === "__baseline__") continue;
    (byDim[b.dimension] = byDim[b.dimension] || []).push(b);
  }
  const DIM_ORDER = ["exit_type", "hold_bucket", "entry_hour_et", "playbook_align", "direction", "contract"];

  return (
    <div className="vg-pane-body vg-playbook">
      {/* pinned header + tiles */}
      <div className="vg-pb-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Futures win-rate analysis</h2>
          <div className="vg-note">
            {a ? `${ov.n || 0} round-trips paired in-window` : "loading…"}
            {a && a.tzNote ? ` · ${a.tzNote}` : ""}
          </div>
          <div className="vg-row" style={{ gap: 6, marginTop: 8 }}>
            <button className="vg-btn-sm" disabled={busy} onClick={reimport}>
              {busy ? "Re-importing…" : "Re-import CSVs"}
            </button>
          </div>
        </div>
        <div className="vg-pb-levels">
          <SummaryTile label="Win rate" value={pct(ov.win_rate)} tone={ov.win_rate >= 0.5 ? "good" : "bad"} />
          <SummaryTile label="Profit factor" value={ov.profit_factor ?? "—"} tone={ov.profit_factor >= 1 ? "good" : "bad"} />
          <SummaryTile label="Net P&L*" value={usd(ov.total_pnl_dollars)} tone={ov.total_pnl_dollars >= 0 ? "good" : "bad"} />
          <SummaryTile label="Trades" value={ov.n ?? "—"} />
        </div>
      </div>

      {/* reconciliation banner — loud when the data is a partial window */}
      {a && rec.reconciled === false && (
        <div className="vg-pb-catalyst">
          ⚠️ <b>Partial data:</b> {rec.caveat}
          {rec.broker_realized_pnl != null && (
            <div className="vg-note" style={{ marginTop: 4 }}>
              Computed {usd(rec.computed_realized_pnl)} vs broker realized {usd(rec.broker_realized_pnl)}.
              *Win-rate/P&L below are the fully-paired in-window trades only.
            </div>
          )}
        </div>
      )}
      {a && rec.reconciled === true && (
        <div className="vg-note" style={{ margin: "4px 0" }}>
          ✓ Reconciled to the broker's realized P&L.
        </div>
      )}

      {/* the headline takeaways */}
      {notable.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">What's moving your win rate (vs your {pct(baseline)} average)</div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {notable.slice(0, 10).map((b, i) => (
              <div key={i} className="vg-row" style={{ gap: 8, alignItems: "baseline" }}>
                <span className={cls("vg-badge", b.kind === "edge" ? "good" : "bad")} style={{ minWidth: 48, textAlign: "center" }}>
                  {b.kind === "edge" ? "EDGE" : "LEAK"}
                </span>
                <span style={{ fontSize: 13, flex: 1 }}>
                  <b>{DIM_LABEL[b.dimension] || b.dimension}: {relabel(b.value)}</b>
                  {" — "}{pct(b.win_rate)} win over {b.n} trades, net {usd(b.total_pnl)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* per-lens win-rate tables */}
      {DIM_ORDER.filter((d) => byDim[d] && byDim[d].length).map((d) => (
        <details key={d} className="vg-card" open={d === "exit_type" || d === "hold_bucket"}>
          <summary className="vg-kicker" style={{ cursor: "pointer" }}>
            {DIM_LABEL[d] || d}
          </summary>
          <div className="vg-pb-ladder" style={{ marginTop: 6 }}>
            {byDim[d].sort((x, y) => y.n - x.n).map((b, i) => (
              <div key={i} className="vg-pb-lvl">
                <span className={cls("vg-badge", b.win_rate >= (baseline || 0.5) ? "good" : "bad")}
                  style={{ minWidth: 46, textAlign: "center" }}>
                  {pct(b.win_rate)}
                </span>
                <span style={{ fontSize: 13 }}>{relabel(b.value)}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 11 }}>
                  n={b.n} · net {usd(b.total_pnl)} · CI {pct(b.ci_low)}–{pct(b.ci_high)}
                </span>
              </div>
            ))}
          </div>
        </details>
      ))}

      {/* order behavior */}
      {ob.available && (
        <div className="vg-card">
          <div className="vg-kicker">Order behavior</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>
            <div><b>Cancel rate:</b> {pct(ob.cancel_rate)} ({ob.cancelled} of {ob.total_orders} orders cancelled)</div>
            <div><b>Filled:</b> {ob.filled} · <b>Stop orders placed:</b> {ob.stop_orders}</div>
            <div className="vg-note" style={{ marginTop: 4 }}>
              A high cancel rate often signals hesitation or over-managing orders — worth reviewing.
            </div>
          </div>
        </div>
      )}

      <div className="vg-pb-caveats">
        <div>*P&L is gross of commissions (not in the AMP export). Entry-hour buckets are ET wall-clock.</div>
        <div>Context for reviewing your trading, not a signal (ADR-008). Reads your own CSV export; places no orders.</div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  return (
    <div className="vg-pb-tile">
      <div className="vg-note" style={{ fontSize: 11 }}>{label}</div>
      <div className={cls("vg-pb-tileval", tone)}>{value}</div>
    </div>
  );
}
