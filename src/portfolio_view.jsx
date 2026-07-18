// PortfolioView — the Portfolio Analyzer section. Roll-up analysis the per-ticker
// notebook can't give: diversification (sector + concentration/HHI), income, rebalance
// drift, portfolio character (beta/PE), and a returns-vs-benchmark placeholder that
// accrues from a nightly snapshot. One /api/portfolio/analyze call feeds the cards.
import { cls, LoadBar, StatTile, usd, signPct, dirCls } from "./util.jsx";
import { useLive, portfolioAnalyze, portfolioPerformance } from "./live.js";

const { useState } = React;

const pct = (n, d = 1) => (n == null ? "—" : `${Number(n).toFixed(d)}%`);

// a horizontal weight bar for a labeled row (sector / drift).
function WeightBar({ label, value, max, tone, right }) {
  const w = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="vg-pf-bar">
      <span className="vg-pf-bar-lbl">{label}</span>
      <div className="vg-pf-bar-track"><div className={cls("vg-pf-bar-fill", tone)} style={{ width: `${w}%` }} /></div>
      <span className="vg-pf-bar-val">{right != null ? right : pct(value)}</span>
    </div>);
}

function DiversificationCard({ d }) {
  if (!d) return null;
  const c = d.concentration || {};
  const sectors = Object.entries(d.by_sector || {});
  const maxSec = Math.max(...sectors.map(([, v]) => v), 1);
  const bandTone = { diversified: "good", moderate: "warn", concentrated: "bad" }[c.band] || "plain";
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head">
        <span className="vg-pf-title">Diversification</span>
        <span className={cls("vg-badge", bandTone)}>{c.band} · HHI {c.hhi}</span>
      </div>
      <div className="vg-pf-stats">
        <StatTile label="Top 5 holdings" value={pct(c.top5_weight)} note="of the book" />
        <StatTile label="Largest position" value={pct(c.top_name?.weight)} note={c.top_name?.symbol} />
        <StatTile label="Largest sector" value={pct(c.top_sector?.weight)} note={c.top_sector?.sector} />
      </div>
      <div className="vg-pf-bars">
        {sectors.map(([s, v]) => (
          <WeightBar key={s} label={s} value={v} max={maxSec} tone="accent" />
        ))}
      </div>
      {(c.single_name_flags || []).length > 0 && (
        <p className="vg-note vg-pf-note">
          Concentrated single names (&gt;7%): {c.single_name_flags.map((f) => `${f.symbol} ${pct(f.weight)}`).join(" · ")}
        </p>)}
    </div>);
}

function IncomeCard({ inc }) {
  if (!inc) return null;
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">Income</span></div>
      <div className="vg-pf-stats">
        <StatTile label="Projected annual" value={usd(inc.annual_income)} note="from dividends" />
        <StatTile label="Portfolio yield" value={pct(inc.portfolio_yield, 2)} />
        <StatTile label="Yield on cost" value={pct(inc.yield_on_cost, 2)} />
      </div>
      {(inc.contributors || []).length > 0 && (
        <table className="vg-pf-table">
          <thead><tr><th>symbol</th><th>yield</th><th>annual</th></tr></thead>
          <tbody>
            {inc.contributors.slice(0, 8).map((r) => (
              <tr key={r.symbol}><td>{r.symbol}</td><td>{pct(r.yield, 2)}</td><td>{usd(r.annual_income)}</td></tr>
            ))}
          </tbody>
        </table>)}
    </div>);
}

function RebalanceCard({ rb, targets }) {
  if (!rb) return null;
  const maxDrift = Math.max(...(rb.rows || []).map((r) => Math.abs(r.drift_pct)), 1);
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head">
        <span className="vg-pf-title">Rebalance</span>
        <span className={cls("vg-badge", rb.in_band ? "good" : "warn")}>
          {rb.in_band ? "in band" : `drift ${pct(rb.max_drift_pct)}`}
        </span>
      </div>
      <div className="vg-pf-bars">
        {(rb.rows || []).map((r) => (
          <WeightBar key={r.asset_class} label={`${r.asset_class} (${pct(r.current_pct)} → ${pct(r.target_pct)})`}
            value={r.drift_pct} max={maxDrift} tone={r.drift_pct > 0 ? "down" : "up"}
            right={r.trade_usd ? `${r.action} ${usd(Math.abs(r.trade_usd))}` : "hold"} />
        ))}
      </div>
      <p className="vg-note vg-pf-note">Target model: {Object.entries(targets || {}).map(([k, v]) => `${k} ${v}%`).join(" · ")}</p>
    </div>);
}

function CharacterCard({ ch }) {
  if (!ch) return null;
  const betaNote = ch.beta == null ? "no beta coverage"
    : ch.beta > 1 ? "more volatile than the market"
    : ch.beta < 1 ? "less volatile than the market" : "in line with the market";
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">Portfolio character</span></div>
      <div className="vg-pf-stats">
        <StatTile label="Weighted beta" value={ch.beta == null ? "—" : ch.beta} note={betaNote} />
        <StatTile label="Blended P/E" value={ch.pe == null ? "—" : ch.pe} />
        <StatTile label="Beta coverage" value={pct(ch.covered_pct)} note="of value has a beta" />
      </div>
    </div>);
}

function PerformanceCard({ account }) {
  const q = useLive(() => portfolioPerformance(account), null, [account]);
  const d = q.data;
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">Returns vs benchmark</span></div>
      {q.loading && <LoadBar />}
      {d && !d.available && <p className="vg-note vg-pf-note">{d.note}</p>}
      {d && d.available && d.twr != null && (
        <div className="vg-pf-stats">
          <StatTile label="Time-weighted return" value={signPct(d.twr)} deltaDir={dirCls(d.twr)} />
          <StatTile label="vs benchmark" value={d.benchmark != null ? signPct(d.benchmark) : "—"} />
        </div>)}
    </div>);
}

export function PortfolioView({ accountId }) {
  const account = accountId || "all";
  const q = useLive(() => portfolioAnalyze(account), null, [account]);
  const d = q.data;
  return (
    <div className="vg-pf">
      <div className="vg-pf-topbar">
        <h2 className="vg-pf-h2">Portfolio</h2>
        <span className="vg-note">Roll-up analysis across your holdings · scope: {account}</span>
      </div>
      {q.loading && <LoadBar />}
      {d && (
        <div className="vg-pf-grid">
          <DiversificationCard d={d.diversification} />
          <IncomeCard inc={d.income} />
          <RebalanceCard rb={d.rebalance} targets={d.targets} />
          <CharacterCard ch={d.character} />
          <PerformanceCard account={account} />
        </div>)}
      {!q.loading && !d && <p className="vg-note" style={{ padding: 14 }}>No portfolio data.</p>}
    </div>);
}
