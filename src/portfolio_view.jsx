// PortfolioView — the Portfolio Analyzer section. Roll-up analysis the per-ticker
// notebook can't give, all CURRENCY-SCOPED (INR and USD are never cross-summed):
// diversification (sector + concentration/HHI), income, character (beta/PE), risk
// (vol/Sharpe/drawdown, data-gated), winners/losers by gain %, per-account
// concentration, and rebalance drift. Plus a Mira "Analyze my portfolio" pane that
// reads the DNA and returns recommended actions. One /api/portfolio/analyze call
// feeds the cards; the account scope comes from the app rail, currency from a toggle.
import { cls, LoadBar, StatTile, usd, signPct, dirCls, money, syncedAgo } from "./util.jsx";
import {
  useLive, portfolioAnalyze, portfolioPerformance,
  createAccount, editAccount, deleteAccount, syncAccount, importTransactions,
} from "./live.js";
import { MiraRender } from "./mira-render.jsx";
import { useStreamTurn } from "./use_stream_turn.js";

const { useState, useRef } = React;

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
    <div className="vg-card vg-pf-card vg-pf-c-div">
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

// Compact display symbol so long OCC option names (e.g. "SPXW 2026-07-17 7485C")
// don't blow out the table width: underlying + "…<strike><C|P>". Equities unchanged.
function shortSym(sym) {
  const s = String(sym || "");
  const m = s.match(/^(\S+)\s+\d{4}-\d{2}-\d{2}\s+(\d+(?:\.\d+)?[CP])$/);
  return m ? `${m[1]} ${m[2]}` : s;
}

// Winners/losers by unrealized gain % (not just $) — the "what to trim / harvest"
// read. A single stacked list (winners then losers), each a full-width row:
// symbol · gain% · $ — so it never smushes two tables into half a card.
function WinnersLosersCard({ wl, ccy }) {
  if (!wl) return null;
  const winners = wl.winners_pct || [];
  const losers = wl.losers_pct || [];
  if (!winners.length && !losers.length) return null;
  const Item = ({ r }) => (
    <div className="vg-pf-wl-item">
      <span className="vg-pf-wl-sym" title={r.symbol}>{shortSym(r.symbol)}</span>
      <span className={cls("vg-pf-wl-pct", dirCls(r.gain_pct))}>
        {r.gain_pct == null ? "—" : signPct(r.gain_pct)}</span>
      <span className={cls("vg-pf-wl-usd", dirCls(r.unrealized))}>
        {ccyMoney(r.unrealized, r.currency || ccy)}</span>
    </div>);
  return (
    <div className="vg-card vg-pf-card vg-pf-c-wl">
      <div className="vg-pf-head"><span className="vg-pf-title">Winners &amp; losers</span>
        <span className="vg-note">by gain %</span></div>
      {winners.length > 0 && <>
        <div className="vg-pf-wl-h up">Top winners</div>
        <div className="vg-pf-wl-list">{winners.map((r) => <Item key={r.symbol} r={r} />)}</div>
      </>}
      {losers.length > 0 && <>
        <div className="vg-pf-wl-h down">Worst losers</div>
        <div className="vg-pf-wl-list">{losers.map((r) => <Item key={r.symbol} r={r} />)}</div>
      </>}
    </div>);
}

// Risk metrics — data-gated: shows coverage honestly, never fabricates a Sharpe.
function RiskCard({ rk }) {
  if (!rk) return null;
  if (!rk.available) {
    return (
      <div className="vg-card vg-pf-card">
        <div className="vg-pf-head"><span className="vg-pf-title">Risk</span>
          <span className="vg-badge plain">no data</span></div>
        <p className="vg-note vg-pf-note">{rk.note
          || "No stored daily bars for these holdings — risk (Sharpe / vol / drawdown) "
             + "needs a price series. Scope to a US-equity account, or seed bars, to compute it."}</p>
      </div>);
  }
  // low coverage → the numbers exist but represent a small slice; say so loudly.
  const thin = (rk.coverage_pct ?? 0) < 60;
  const sharpeTone = thin ? "plain"
    : rk.sharpe == null ? "plain" : rk.sharpe >= 1 ? "good" : rk.sharpe >= 0.5 ? "warn" : "bad";
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">Risk</span>
        <span className={cls("vg-badge", sharpeTone)}>Sharpe {rk.sharpe == null ? "—" : rk.sharpe}</span></div>
      <div className="vg-pf-stats">
        <StatTile label="Annualized vol" value={pct(rk.vol_annual_pct)} />
        <StatTile label="Sortino" value={rk.sortino == null ? "—" : rk.sortino} />
        <StatTile label="Max drawdown" value={pct(rk.max_drawdown_pct)} deltaDir={dirCls(rk.max_drawdown_pct)} />
      </div>
      {thin
        ? <p className="vg-note vg-pf-note warn">⚠ Only {pct(rk.coverage_pct)} of the book has price
            bars — these figures cover a slice, not the whole portfolio. Scope to a US-equity
            account for a fuller read.</p>
        : <p className="vg-note vg-pf-note">{rk.days}d window · {pct(rk.coverage_pct)} of book has bars</p>}
    </div>);
}

// Per-account concentration — surfaces single-account / single-broker risk per currency.
// Upload a transaction CSV for one account (hidden file input + a labeled button).
function UploadTxn({ acctId, onDone }) {
  const ref = useRef(null);
  const [state, setState] = useState(null);   // {busy} | {result} | {error}
  const pick = () => ref.current && ref.current.click();
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setState({ busy: true });
    importTransactions(f, acctId, "fidelity").then((r) => {
      if (r && r.available === false) { setState({ error: r.note || "import failed" }); return; }
      setState({ result: r });
      onDone && onDone();
    }).catch((err) => setState({ error: String(err && err.message || err) }))
      .finally(() => { if (ref.current) ref.current.value = ""; });
  };
  return (
    <>
      <input ref={ref} type="file" accept=".csv" style={{ display: "none" }} onChange={onFile} />
      <button className="vg-linkbtn" onClick={pick} disabled={state?.busy}
        title="Upload a Fidelity transaction-history CSV → parsed into buys/sells + realized gains">
        {state?.busy ? "importing…" : "⬆ transactions"}
      </button>
      {state?.result && <span className="vg-note good"> +{state.result.imported} ({state.result.buys}b/{state.result.sells}s)</span>}
      {state?.error && <span className="vg-note bad"> {state.error}</span>}
    </>);
}

// Add a new broker/account (manual or an API-broker sync target).
function AddAccount({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ id: "", name: "", broker: "fidelity", currency: "USD", taxable: true });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (!f.id.trim() || !f.name.trim()) { setErr("id and name are required"); return; }
    setBusy(true); setErr(null);
    createAccount(f).then((r) => {
      setBusy(false);
      if (r && r.error) { setErr(r.error); return; }
      setOpen(false); setF({ id: "", name: "", broker: "fidelity", currency: "USD", taxable: true });
      onAdded && onAdded();
    }).catch((e) => { setBusy(false); setErr(String(e && e.message || e)); });
  };
  if (!open) return <button className="vg-btn sm" onClick={() => setOpen(true)}>+ Add broker / account</button>;
  return (
    <div className="vg-pf-addacct">
      <div className="vg-pf-addgrid">
        <label>ID <input value={f.id} placeholder="fid-taxable" onChange={(e) => setF({ ...f, id: e.target.value })} /></label>
        <label>Name <input value={f.name} placeholder="Fidelity Brokerage" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Broker
          <select value={f.broker} onChange={(e) => setF({ ...f, broker: e.target.value })}>
            <option value="fidelity">Fidelity (CSV)</option>
            <option value="schwab-api">Schwab</option>
            <option value="robinhood">Robinhood</option>
            <option value="zerodha">Zerodha (INR)</option>
            <option value="alpaca">Alpaca</option>
            <option value="">Manual / other</option>
          </select></label>
        <label>Currency
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option>USD</option><option>INR</option>
          </select></label>
        <label className="vg-pf-chk"><input type="checkbox" checked={f.taxable}
          onChange={(e) => setF({ ...f, taxable: e.target.checked })} /> taxable</label>
      </div>
      <div className="vg-row" style={{ gap: 8 }}>
        <button className="vg-btn sm on" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add"}</button>
        <button className="vg-btn sm" onClick={() => { setOpen(false); setErr(null); }}>cancel</button>
      </div>
      {err && <p className="vg-note bad">{err}</p>}
    </div>);
}

// The Accounts card — the account manager: list + scope-select + per-account
// refresh/upload/remove + add. Merges the live account list (scopeAccounts) with
// the analyzer's per-account concentration flags.
function AccountManagerCard({ ba, accounts, accountId, setAccountId, refreshing,
                             onRefreshAccount, onChanged }) {
  const conc = (ba && ba.concentration) || {};
  const flags = Object.entries(conc).filter(([, c]) => c.top_pct >= 60 && c.n_accounts > 1);
  const list = accounts || [];
  const remove = (a) => {
    if (!window.confirm(`Remove account "${a.short}" and its lots? This can't be undone.`)) return;
    deleteAccount(a.id).then(() => onChanged && onChanged());
  };
  return (
    <div className="vg-pf-managepanel">
      <div className="vg-pf-acctlist">
        {list.map((a) => {
          const csvOnly = a.refreshable === false;
          const pending = !!(refreshing && refreshing[a.id]);
          return (
            <div key={a.id} className={cls("vg-pf-acctrow", accountId === a.id && "on")}>
              <button className="vg-pf-acctpick" onClick={() => setAccountId && setAccountId(a.id)}
                title={`Scope to ${a.short}`}>
                <span className="vg-pf-acctname"><b>{a.short}</b>
                  {a.broker && <span className="vg-badge plain" style={{ marginLeft: 6 }}>{a.broker}</span>}</span>
                <span className="vg-note">{a.type}{a.lastSynced !== undefined ? ` · synced ${syncedAgo(a.lastSynced)}` : ""}</span>
              </button>
              <span className="vg-pf-acctval">{money(a.value, a.currency || "USD")}</span>
              <span className="vg-pf-acctactions">
                {!csvOnly && (
                  <button className="vg-linkbtn" disabled={pending}
                    onClick={() => onRefreshAccount && onRefreshAccount(a.id)}
                    title={`Refresh ${a.short} (re-pull holdings)`}>{pending ? "…" : "⟳ sync"}</button>)}
                <UploadTxn acctId={a.id} onDone={onChanged} />
                <button className="vg-linkbtn bad" onClick={() => remove(a)} title="Remove account">✕</button>
              </span>
            </div>);
        })}
      </div>
      {flags.map(([c, cc]) => (
        <p key={c} className="vg-note vg-pf-note">
          {cc.top_account} holds {pct(cc.top_pct)} of the {c} book — single-account concentration.
        </p>))}
      <div style={{ marginTop: 8 }}><AddAccount onAdded={onChanged} /></div>
    </div>);
}

// The slim account BAR at the top — scope chips (All + each account with its
// value) + a ⚙ Manage toggle that expands the full manager inline. Accounts are
// both the inventory ("what do I own") AND the lens (scope recomputes every card),
// so this is a control, not a footer — it lives above the analysis.
function AccountBar({ ba, accounts, accountId, setAccountId, refreshing,
                     onRefreshAccount, onChanged }) {
  const [manage, setManage] = useState(false);
  const list = accounts || [];
  const total = list.reduce((m, a) => { const c = a.currency || "USD"; m[c] = (m[c] || 0) + (a.value || 0); return m; }, {});
  const totalLabel = Object.entries(total).map(([c, v]) => money(v, c)).join(" · ");
  return (
    <div className="vg-card vg-pf-acctbar">
      <div className="vg-pf-chips">
        <button className={cls("vg-pf-chip-acct", accountId === "all" && "on")}
          onClick={() => setAccountId && setAccountId("all")} title="All accounts">
          <b>All</b> <span className="vg-note">{totalLabel}</span>
        </button>
        {list.map((a) => (
          <button key={a.id} className={cls("vg-pf-chip-acct", accountId === a.id && "on")}
            onClick={() => setAccountId && setAccountId(a.id)} title={`Scope to ${a.name || a.short}`}>
            <b>{a.short}</b> <span className="vg-note">{money(a.value, a.currency || "USD")}</span>
          </button>))}
        <button className={cls("vg-btn sm vg-pf-manage", manage && "on")}
          onClick={() => setManage((v) => !v)} title="Add / import / sync / remove accounts">
          ⚙ {manage ? "Done" : "Manage"}
        </button>
      </div>
      {manage && (
        <AccountManagerCard ba={ba} accounts={accounts} accountId={accountId}
          setAccountId={setAccountId} refreshing={refreshing}
          onRefreshAccount={onRefreshAccount} onChanged={onChanged} />)}
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

function PerformanceCard({ account, accounts }) {
  const q = useLive(() => portfolioPerformance(account), null, [account]);
  const d = q.data;
  // Until a value-history time series accrues, show the point-in-time book value
  // by currency (from the live account list) so the slot is informative, not empty.
  const scoped = (accounts || []).filter((a) => account === "all" || a.id === account);
  const byCcy = scoped.reduce((m, a) => { const c = a.currency || "USD"; m[c] = (m[c] || 0) + (a.value || 0); return m; }, {});
  return (
    <div className="vg-card vg-pf-card">
      <div className="vg-pf-head"><span className="vg-pf-title">Performance</span>
        <span className="vg-note">point-in-time</span></div>
      {Object.keys(byCcy).length > 0 && (
        <div className="vg-pf-stats">
          {Object.entries(byCcy).map(([c, v]) => (
            <StatTile key={c} label={`Book value · ${c}`} value={money(v, c)} />
          ))}
        </div>)}
      {q.loading && <LoadBar />}
      {d && d.available && d.twr != null && (
        <div className="vg-pf-stats">
          <StatTile label="Time-weighted return" value={signPct(d.twr)} deltaDir={dirCls(d.twr)} />
          <StatTile label="vs benchmark" value={d.benchmark != null ? signPct(d.benchmark) : "—"} />
        </div>)}
      {d && !d.available && (
        <p className="vg-note vg-pf-note">Time-weighted return + benchmark accrue once nightly
          value snapshots begin — no history yet.</p>)}
    </div>);
}

// Mira reads the whole portfolio DNA and returns a health read + recommended ACTIONS.
// Same streamTurn + PORTFOLIO_SNAPSHOT_REF pattern as the chart's forecast pane.
function AnalyzePane({ account }) {
  const { state, run: runTurn } = useStreamTurn([account]);
  const run = () => {
    const ref = `PORTFOLIO_SNAPSHOT_REF account=${account}`;
    const prompt = `Analyze my portfolio and give me recommended actions. Read the DNA — currencies are separate books, never combine them — and end in concrete, sized actions (trim / harvest / rebalance / diversify).\n${ref}`;
    runTurn(prompt, `portfolio-${account}`);
  };

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

export function PortfolioView({ accountId, setAccountId, scopeAccounts,
                               refreshing, onRefreshAccount, onAccountsChanged }) {
  const account = accountId || "all";
  const [ccy, setCcy] = useState("");   // "" → dominant bucket (server picks)
  const q = useLive(() => portfolioAnalyze(account, ccy), null, [account, ccy]);
  const d = q.data;
  const currencies = d?.currencies || [];
  const activeCcy = d?.currency || ccy || (currencies[0] || "USD");
  const scopeLabel = account === "all" ? "all accounts"
    : ((scopeAccounts || []).find((a) => a.id === account)?.short || account);
  return (
    <div className="vg-pf">
      <div className="vg-pf-topbar">
        <h2 className="vg-pf-h2">Portfolio</h2>
        <span className="vg-note">Roll-up analysis · scope: {scopeLabel}
          {account !== "all" && <button className="vg-linkbtn" style={{ marginLeft: 6 }}
            onClick={() => setAccountId && setAccountId("all")}>all →</button>}</span>
        {currencies.length > 1 && (
          <div className="vg-pf-ccy" role="group" aria-label="currency">
            {currencies.map((c) => (
              <button key={c} className={cls("vg-chip", c === activeCcy && "on")}
                onClick={() => setCcy(c)}>{c}</button>
            ))}
          </div>)}
      </div>
      {/* the account bar is a CONTROL (scope + inventory) — always at the top,
          above the analysis it drives. */}
      <AccountBar ba={d?.by_account} accounts={scopeAccounts} accountId={account}
        setAccountId={setAccountId} refreshing={refreshing}
        onRefreshAccount={onRefreshAccount} onChanged={onAccountsChanged} />
      {q.loading && <LoadBar />}
      {d && (
        <div className="vg-pf-grid">
          {/* 1 — Mira's actions (full width) */}
          <AnalyzePane account={account} />
          {/* 2 — composition: what the book IS (Diversification + Winners/losers, 2 cols each) */}
          <DiversificationCard d={d.diversification} />
          <WinnersLosersCard wl={d.winners_losers} ccy={activeCcy} />
          {/* 3 — the analytical read: risk · income · rebalance · character (1 col each) */}
          <RiskCard rk={d.risk} />
          <IncomeCard inc={d.income} ccy={activeCcy} />
          <RebalanceCard rb={d.rebalance} targets={d.targets} />
          <CharacterCard ch={d.character} />
          {/* 4 — value */}
          <PerformanceCard account={account} accounts={scopeAccounts} />
        </div>)}
      {!q.loading && !d && <p className="vg-note" style={{ padding: 14 }}>No portfolio data.</p>}
    </div>);
}
