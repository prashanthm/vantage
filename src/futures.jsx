// FuturesView — a futures trader's performance dashboard (Intelligence nav).
// Reads imported AMP executions, pairs round-trips, and shows what a trader
// actually wants: an equity curve, expectancy / reward:risk / drawdown, a
// risk-and-discipline read (biggest loss, losing streaks, letting losers run),
// the statistically-meaningful edges/leaks (in points, not conflated $), and
// evidence-based recommendations (rules from your history + coaching + a forward
// level watch). Decision-support (ADR-010) — reads your CSVs, places no orders.
import { cls, StatTile } from "./util.jsx";
import { Term, GlossaryCard } from "./glossary.jsx";
import { useLive, getFuturesAnalysis, importFutures } from "./live.js";

const { useState } = React;

const pct = (v) => (v == null ? "—" : `${Math.round(100 * v)}%`);
const usd = (v) => (v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`);
const pts = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}pt`);

const DIM_LABEL = {
  exit_type: "How you exited", hold_bucket: "How long you held",
  entry_hour_et: "Entry hour (ET)", playbook_align: "Vs the playbook",
  direction: "Direction", contract: "Contract",
};
const VALUE_LABEL = {
  Market: "Discretionary (market)", Stop: "Stop", StopLoss: "Stop-loss", Limit: "Limit (target)",
  with: "With the playbook", against: "Against the playbook", neutral: "Neutral",
  "<1m": "under 1 min", "1-5m": "1–5 min", "5-30m": "5–30 min", "30m+": "over 30 min",
  long: "Long", short: "Short",
};
const relabel = (v) => VALUE_LABEL[v] || v;

// Inline SVG equity curve — cumulative $ with a peak line so drawdown is visible.
function EquityCurve({ curve }) {
  if (!curve || curve.length < 2) return null;
  const W = 640, H = 130, pad = 6;
  const xs = curve.map((p) => p.cum);
  const peaks = curve.map((p) => p.peak);
  const lo = Math.min(0, ...xs), hi = Math.max(...peaks, ...xs);
  const range = hi - lo || 1;
  const x = (i) => pad + (i / (curve.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - lo) / range) * (H - 2 * pad);
  const line = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const final = xs[xs.length - 1];
  const up = final >= 0;
  const areaCol = up ? "var(--vg-up)" : "var(--vg-down)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
      style={{ display: "block" }}>
      {/* zero line */}
      <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
      {/* running peak (drawdown reference) */}
      <path d={line(peaks)} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 3" />
      {/* equity */}
      <path d={line(xs)} fill="none" stroke={areaCol} strokeWidth="1.75" />
    </svg>
  );
}

export function FuturesView({ refreshNonce }) {
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const fa = useLive(() => getFuturesAnalysis({ alignment: true }), null, [refreshNonce, nonce]);
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
          <code>data/ampfutures/</code> and click Import.
        </p>
        <button className="vg-btn-sm" disabled={busy} onClick={reimport}>
          {busy ? "Importing…" : "Import from data/ampfutures"}
        </button>
      </div>
    );
  }

  const ov = (a && a.overall) || {};
  const rec = (a && a.reconciliation) || {};
  const dd = (a && a.drawdown) || {};
  const risk = (a && a.risk) || {};
  const recs = (a && a.recommendations) || { rules: [], coaching: [], watch: [] };
  const ob = (a && a.orderBehavior) || {};
  const baseline = a && a.baselineWinRate;
  const proj = (a && a.projection) || { available: false };

  const byDim = {};
  for (const b of (a && a.buckets) || []) {
    if (b.dimension === "__baseline__") continue;
    (byDim[b.dimension] = byDim[b.dimension] || []).push(b);
  }
  const DIM_ORDER = ["exit_type", "hold_bucket", "entry_hour_et", "playbook_align", "direction", "contract"];

  return (
    <div className="vg-pane-body vg-playbook">
      {/* header + the metrics that matter */}
      <div className="vg-pb-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Futures performance</h2>
          <div className="vg-note">
            {a ? `${ov.n || 0} round-trips` : "loading…"}
            {a && a.tzNote ? " · times ET" : ""}
          </div>
          <div className="vg-row" style={{ gap: 6, marginTop: 8 }}>
            <button className="vg-btn-sm" disabled={busy} onClick={reimport}>
              {busy ? "Re-importing…" : "Re-import CSVs"}
            </button>
          </div>
        </div>
      </div>

      {/* the metrics that matter — full-width canonical StatTile row */}
      <div className="vg-stats" style={{ margin: "12px 0" }}>
        <SummaryTile termKey="expectancy" label="Expectancy / trade" value={usd(ov.expectancy_usd)}
          sub={pts(ov.expectancy_pts)} tone={ov.expectancy_pts >= 0 ? "good" : "bad"} />
        <SummaryTile termKey="reward_risk" label="Reward : Risk" value={ov.reward_risk ?? "—"}
          sub={`${ov.avg_win_pts ?? "—"} / ${Math.abs(ov.avg_loss_pts ?? 0)}pt`}
          tone={ov.reward_risk >= 1.5 ? "good" : "warn"} />
        <SummaryTile termKey="win_rate" label="Win rate" value={pct(ov.win_rate)} tone={ov.win_rate >= 0.5 ? "good" : "bad"} />
        <SummaryTile termKey="profit_factor" label="Profit factor" value={ov.profit_factor ?? "—"} tone={ov.profit_factor >= 1.3 ? "good" : "warn"} />
        <SummaryTile termKey="drawdown" label="Max drawdown" value={usd(dd.max_drawdown)}
          sub={dd.max_drawdown_pct != null ? `${dd.max_drawdown_pct}%` : ""} tone="bad" />
      </div>

      {/* partial-data banner */}
      {a && rec.reconciled === false && (
        <div className="vg-pb-catalyst">
          ⚠️ <b>Partial data:</b> {rec.caveat}
        </div>
      )}

      {/* equity curve */}
      {a && a.equityCurve && a.equityCurve.length > 1 && (
        <div className="vg-card">
          <div className="vg-kicker">Equity curve — cumulative P&L{" "}
            <span className="vg-note" style={{ fontWeight: 400 }}>
              (final {usd(ov.total_pnl_dollars)}; dashed = running peak)
            </span>
          </div>
          <div style={{ marginTop: 6, color: "var(--color-text, #888)" }}>
            <EquityCurve curve={a.equityCurve} />
          </div>
        </div>
      )}

      {/* RECOMMENDATIONS — the headline for a trader */}
      {(recs.rules.length > 0 || recs.coaching.length > 0) && (
        <div className="vg-card">
          <div className="vg-kicker">Recommendations to improve your win rate</div>
          {recs.rules.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div className="vg-note" style={{ fontSize: 12, marginBottom: 4 }}>RULES (from your numbers)</div>
              <div style={{ display: "grid", gap: 8 }}>
                {recs.rules.map((r, i) => <RecRow key={i} r={r} icon="→" />)}
              </div>
            </div>
          )}
          {recs.coaching.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="vg-note" style={{ fontSize: 12, marginBottom: 4 }}>DO MORE / DO LESS</div>
              <div style={{ display: "grid", gap: 8 }}>
                {recs.coaching.map((r, i) => <RecRow key={i} r={r} icon="•" />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* risk & discipline */}
      {risk.available && (
        <div className="vg-card">
          <div className="vg-kicker">Risk & discipline</div>
          <div className="vg-pb-ladder" style={{ marginTop: 6 }}>
            <RiskRow label="Biggest single loss"
              value={`${usd(risk.worst_loss_usd)} (${Math.abs(risk.worst_loss_pts)}pt)`}
              note={risk.worst_vs_avg_loss ? `${risk.worst_vs_avg_loss}× a normal loser` : ""} bad />
            <RiskRow label="Worst losing streak" value={`${risk.worst_losing_streak} in a row`}
              note={risk.worst_losing_streak >= 4 ? "revenge-trade risk" : ""} bad={risk.worst_losing_streak >= 4} />
            <RiskRow label="Typical hold" value={`${risk.median_hold_min}m`}
              note={risk.longest_loser_hold_min ? `longest loser held ${Math.round(risk.longest_loser_hold_min)}m` : ""} />
          </div>
        </div>
      )}

      {/* forward level watch */}
      {recs.watch && recs.watch.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Next-session watch (generic NQ playbook)</div>
          <div style={{ display: "grid", gap: 4, marginTop: 6, fontSize: 14, lineHeight: 1.5 }}>
            {recs.watch.map((w, i) => (
              <div key={i} className={i === recs.watch.length - 1 ? "vg-note" : ""}>{w.text}</div>
            ))}
          </div>
        </div>
      )}

      {/* projected 0DTE levels from the ETF playbook (NQ<-QQQ, RTY<-IWM) */}
      {proj.available && (proj.zones || []).length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">
            {proj.contract} levels — from the {proj.etf} 0DTE playbook (×{proj.ratio})
          </div>
          <div className="vg-pb-ladder" style={{ marginTop: 6 }}>
            {proj.zones.sort((x, y) => (y.price || 0) - (x.price || 0)).map((z, i) => (
              <div key={i} className="vg-pb-lvl">
                <span className={cls("vg-badge", z.role === "resistance" ? "bad" : z.role === "support" ? "good" : "plain")}
                  style={{ minWidth: 74, textAlign: "center" }}>{z.role}</span>
                <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(z.lo)}–{Math.round(z.hi)}
                </span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>
                  {(z.kinds || []).join(" · ")}
                </span>
              </div>
            ))}
          </div>
          <div className="vg-note" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
            {proj.note}
          </div>
        </div>
      )}

      {/* meaningful edges/leaks + per-lens tables */}
      {DIM_ORDER.filter((d) => byDim[d] && byDim[d].length).map((d) => (
        <details key={d} className="vg-card" open={d === "exit_type"}>
          <summary className="vg-kicker" style={{ cursor: "pointer" }}>{DIM_LABEL[d] || d}</summary>
          <div className="vg-pb-ladder" style={{ marginTop: 6 }}>
            {byDim[d].sort((x, y) => y.n - x.n).map((b, i) => (
              <div key={i} className="vg-pb-lvl">
                <span className={cls("vg-badge", b.win_rate >= (baseline || 0.5) ? "good" : "bad")}
                  style={{ minWidth: 46, textAlign: "center" }}>{pct(b.win_rate)}</span>
                <span style={{ fontSize: 14 }}>{relabel(b.value)}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>
                  n={b.n} · net {usd(b.total_pnl)}{b.n < 5 ? " · thin" : ""}
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
          <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 4 }}>
            <div><b>Cancel rate:</b> {pct(ob.cancel_rate)} ({ob.cancelled} of {ob.total_orders} orders)</div>
            <div><b>Filled:</b> {ob.filled} · <b>Stop orders:</b> {ob.stop_orders}</div>
          </div>
        </div>
      )}

      {/* glossary — what the metrics mean */}
      <GlossaryCard terms={["expectancy", "reward_risk", "profit_factor",
        "drawdown", "win_rate"]} />

      <div className="vg-pb-caveats">
        <div>P&L is gross of commissions (not in the AMP export). Times are ET. Reward:risk and edges use points so micro/mini aren't conflated.</div>
        <div>Context for reviewing your trading, not a signal (ADR-010). Reads your CSV export; places no orders.</div>
      </div>
    </div>
  );
}

function RecRow({ r, icon }) {
  return (
    <div className="vg-row" style={{ gap: 8, alignItems: "baseline" }}>
      <span style={{ opacity: 0.6, fontSize: 14 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>{r.text}</div>
        {r.evidence && <div className="vg-note" style={{ fontSize: 12 }}>{r.evidence}</div>}
      </div>
    </div>
  );
}

function RiskRow({ label, value, note, bad }) {
  return (
    <div className="vg-pb-lvl">
      <span style={{ fontSize: 14, minWidth: 150 }}>{label}</span>
      <span className={cls("vg-badge", bad ? "bad" : "plain")} style={{ textAlign: "center" }}>{value}</span>
      {note && <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>{note}</span>}
    </div>
  );
}

// thin adapter over the canonical StatTile — keeps the glossary <Term> wiring
// while the visual comes from ONE tile design (see util.jsx StatTile).
function SummaryTile({ label, value, sub, tone, termKey }) {
  return <StatTile label={termKey ? <Term k={termKey}>{label}</Term> : label}
    value={value} note={sub} tone={tone} />;
}
