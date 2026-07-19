// PortfolioView — the Portfolio Analyzer section. Roll-up analysis the per-ticker
// notebook can't give, all CURRENCY-SCOPED (INR and USD are never cross-summed):
// diversification (sector + concentration/HHI), income, character (beta/PE), risk
// (vol/Sharpe/drawdown, data-gated), winners/losers by gain %, per-account
// concentration, and rebalance drift. Plus a Mira "Analyze my portfolio" pane that
// reads the DNA and returns recommended actions. One /api/portfolio/analyze call
// feeds the cards; the account scope comes from the app rail, currency from a toggle.
import { cls, LoadBar, StatTile, usd, signPct, dirCls } from "./util.jsx";
import { useLive, portfolioAnalyze, portfolioPerformance, streamTurn } from "./live.js";
import { MiraRender } from "./mira-render.jsx";

const { useState, useCallback, useRef, useEffect } = React;

const pct = (n, d = 1) => (n == null ? "—" : `${Number(n).toFixed(d)}%`);
// money in a bucket's own currency (INR gets lakh/crore grouping via toLocaleString).
const ccyMoney = (n, ccy) => (n == null ? "—"
  : new Intl.NumberFormat(ccy === "INR" ? "en-IN" : "en-US",
      { style: "currency", currency: ccy || "USD", maximumFractionDigits: 0 }).format(n));

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

function IncomeCard({ inc, ccy }) {
  if (!inc) return null;
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">Income</span></div>
      <div className="vg-pf-stats">
        <StatTile label="Projected annual" value={ccyMoney(inc.annual_income, ccy)} note="from dividends" />
        <StatTile label="Portfolio yield" value={pct(inc.portfolio_yield, 2)} />
        <StatTile label="Yield on cost" value={pct(inc.yield_on_cost, 2)} />
      </div>
      {(inc.contributors || []).length > 0 && (
        <table className="vg-pf-table">
          <thead><tr><th>symbol</th><th>yield</th><th>annual</th></tr></thead>
          <tbody>
            {inc.contributors.slice(0, 8).map((r) => (
              <tr key={r.symbol}><td>{r.symbol}</td><td>{pct(r.yield, 2)}</td><td>{ccyMoney(r.annual_income, ccy)}</td></tr>
            ))}
          </tbody>
        </table>)}
    </div>);
}

// Winners/losers by unrealized gain % (not just $) — the "what to trim / harvest" read.
function WinnersLosersCard({ wl, ccy }) {
  if (!wl) return null;
  const Row = ({ r }) => (
    <tr>
      <td>{r.symbol}</td>
      <td className={dirCls(r.gain_pct)}>{r.gain_pct == null ? "—" : signPct(r.gain_pct)}</td>
      <td className={dirCls(r.unrealized)}>{ccyMoney(r.unrealized, r.currency || ccy)}</td>
    </tr>);
  const winners = wl.winners_pct || [];
  const losers = wl.losers_pct || [];
  if (!winners.length && !losers.length) return null;
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">Winners &amp; losers</span>
        <span className="vg-note">by gain %</span></div>
      <div className="vg-pf-wl">
        <div>
          <div className="vg-pf-wl-h up">Top winners</div>
          <table className="vg-pf-table"><tbody>{winners.map((r) => <Row key={r.symbol} r={r} />)}</tbody></table>
        </div>
        <div>
          <div className="vg-pf-wl-h down">Worst losers</div>
          <table className="vg-pf-table"><tbody>{losers.map((r) => <Row key={r.symbol} r={r} />)}</tbody></table>
        </div>
      </div>
    </div>);
}

// Risk metrics — data-gated: shows coverage honestly, never fabricates a Sharpe.
function RiskCard({ rk }) {
  if (!rk) return null;
  if (!rk.available) {
    return (
      <div className="vg-card vg-pf-card">
        <div className="vg-pf-head"><span className="vg-pf-title">Risk</span></div>
        <p className="vg-note vg-pf-note">{rk.note || "No stored bars — seed them to compute risk."}</p>
      </div>);
  }
  const sharpeTone = rk.sharpe == null ? "plain" : rk.sharpe >= 1 ? "good" : rk.sharpe >= 0.5 ? "warn" : "bad";
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">Risk</span>
        <span className={cls("vg-badge", sharpeTone)}>Sharpe {rk.sharpe == null ? "—" : rk.sharpe}</span></div>
      <div className="vg-pf-stats">
        <StatTile label="Annualized vol" value={pct(rk.vol_annual_pct)} />
        <StatTile label="Sortino" value={rk.sortino == null ? "—" : rk.sortino} />
        <StatTile label="Max drawdown" value={pct(rk.max_drawdown_pct)} deltaDir={dirCls(rk.max_drawdown_pct)} />
      </div>
      <p className="vg-note vg-pf-note">{rk.days}d window · {pct(rk.coverage_pct)} of book has bars</p>
    </div>);
}

// Per-account concentration — surfaces single-account / single-broker risk per currency.
function ByAccountCard({ ba }) {
  if (!ba || !(ba.accounts || []).length) return null;
  const conc = ba.concentration || {};
  const flags = Object.entries(conc).filter(([, c]) => c.top_pct >= 60 && c.n_accounts > 1);
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">By account</span></div>
      <table className="vg-pf-table">
        <thead><tr><th>account</th><th>broker</th><th>value</th></tr></thead>
        <tbody>
          {ba.accounts.map((a) => (
            <tr key={a.account}>
              <td>{a.name}</td><td>{a.broker || "—"}</td>
              <td>{Object.entries(a.by_currency || {}).map(([c, v]) => ccyMoney(v, c)).join(" · ")}</td>
            </tr>))}
        </tbody>
      </table>
      {flags.map(([c, cc]) => (
        <p key={c} className="vg-note vg-pf-note">
          {cc.top_account} holds {pct(cc.top_pct)} of the {c} book — single-account concentration.
        </p>))}
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

// Mira reads the whole portfolio DNA and returns a health read + recommended ACTIONS.
// Same streamTurn + PORTFOLIO_SNAPSHOT_REF pattern as the chart's forecast pane.
function AnalyzePane({ account }) {
  const [state, setState] = useState(null); // {loading} | {text} | {error}
  const abortRef = useRef(null);
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);
  // a new account scope invalidates the prior read.
  useEffect(() => { setState(null); }, [account]);

  const run = useCallback(() => {
    setState({ loading: true, text: "" });
    const ref = `PORTFOLIO_SNAPSHOT_REF account=${account}`;
    const prompt = `Analyze my portfolio and give me recommended actions. Read the DNA — currencies are separate books, never combine them — and end in concrete, sized actions (trim / harvest / rebalance / diversify).\n${ref}`;
    let text = "";
    abortRef.current = streamTurn(prompt, `portfolio-${account}`, (evt) => {
      if (evt.kind === "error") { setState({ error: evt.text || "Mira failed." }); abortRef.current = null; return; }
      if ((evt.kind === "token" || evt.kind === "delta" || evt.kind === "message") && evt.text) {
        text += evt.text; setState({ loading: true, text }); return;
      }
      if (evt.kind === "done") {
        abortRef.current = null;
        if (evt.text && !text) text = evt.text;
        setState({ text });
      }
    });
  }, [account]);

  return (
    <div className="vg-card vg-pf-card vg-pf-analyze">
      <div className="vg-pf-head">
        <span className="vg-pf-title">Mira · portfolio actions</span>
        <button className="vg-btn sm" onClick={run} disabled={state?.loading}>
          {state?.loading ? "Analyzing…" : state ? "Re-analyze" : "Analyze my portfolio"}
        </button>
      </div>
      {!state && <p className="vg-note vg-pf-note">Mira reads your portfolio DNA and recommends actions — decision-support, not orders.</p>}
      {state?.loading && !state.text && <LoadBar />}
      {state?.error && <p className="vg-note vg-pf-note bad">{state.error}</p>}
      {state?.text && <MiraRender text={state.text} />}
    </div>);
}

export function PortfolioView({ accountId }) {
  const account = accountId || "all";
  const [ccy, setCcy] = useState("");   // "" → dominant bucket (server picks)
  const q = useLive(() => portfolioAnalyze(account, ccy), null, [account, ccy]);
  const d = q.data;
  const currencies = d?.currencies || [];
  const activeCcy = d?.currency || ccy || (currencies[0] || "USD");
  return (
    <div className="vg-pf">
      <div className="vg-pf-topbar">
        <h2 className="vg-pf-h2">Portfolio</h2>
        <span className="vg-note">Roll-up analysis · scope: {account}</span>
        {currencies.length > 1 && (
          <div className="vg-pf-ccy" role="group" aria-label="currency">
            {currencies.map((c) => (
              <button key={c} className={cls("vg-chip", c === activeCcy && "on")}
                onClick={() => setCcy(c)}>{c}</button>
            ))}
          </div>)}
      </div>
      {q.loading && <LoadBar />}
      {d && (
        <div className="vg-pf-grid">
          <AnalyzePane account={account} />
          <DiversificationCard d={d.diversification} />
          <WinnersLosersCard wl={d.winners_losers} ccy={activeCcy} />
          <RiskCard rk={d.risk} />
          <IncomeCard inc={d.income} ccy={activeCcy} />
          <RebalanceCard rb={d.rebalance} targets={d.targets} />
          <CharacterCard ch={d.character} />
          <ByAccountCard ba={d.by_account} />
          <PerformanceCard account={account} />
        </div>)}
      {!q.loading && !d && <p className="vg-note" style={{ padding: 14 }}>No portfolio data.</p>}
    </div>);
}
