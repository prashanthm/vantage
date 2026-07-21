// PaperView — paper-trade the 0DTE playbook on SPY (Intelligence nav).
// A NO-MONEY simulation: today's playbook signals become SPY trade tickets
// (entry at the level, target = next level, stop just beyond), you log one with
// one click, and it auto-closes when SPY touches target or stop. Builds an honest
// track record of whether trading the levels works — before risking real money.
// Places NO real orders (ADR-010). Not financial advice.
import { cls, SymbolSwitcher } from "./util.jsx";
import { Term, GlossaryCard } from "./glossary.jsx";
import { useLive, getPaper, openPaperTrade, settlePaper, closePaperTrade, getSpreadBook } from "./live.js";

const { useState } = React;

const usd = (v) => (v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`);
const pct = (v) => (v == null ? "—" : `${Math.round(100 * v)}%`);
const px = (v) => (v == null ? "—" : Number(v).toFixed(2));

// zone-freshness badge tone: strong=good, tested=warn, weak=bad, fresh=info
// zone-freshness tones. NOTE: "fresh" was demoted from info to plain — the
// backtest loop (claudedocs/goals/strategy-winrate) disproved "untested zones
// react best"; durable cross-session memory (strong) is the real signal.
const FRESH_TONE = { strong: "good", fresh: "plain", tested: "warn", weak: "bad" };

// Cumulative-P&L area chart: a zero baseline, a faint peak line (the high-water
// mark → visualizes drawdown), a gradient area fill under the equity line, and an
// emphasized endpoint dot with the current value. Uniform aspect (no stretching).
let _gradN = 0;
function EquityCurve({ curve }) {
  if (!curve || curve.length < 2) return null;
  const W = 720, H = 150, padX = 8, padT = 14, padB = 10;
  const xs = curve.map((p) => p.cum), peaks = curve.map((p) => p.peak);
  const lo = Math.min(0, ...xs), hi = Math.max(...peaks, ...xs, 0), range = hi - lo || 1;
  const x = (i) => padX + (i / (curve.length - 1)) * (W - 2 * padX);
  const y = (v) => H - padB - ((v - lo) / range) * (H - padT - padB);
  const line = (a) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = xs[xs.length - 1];
  const up = last >= 0;
  const col = up ? "var(--vg-up)" : "var(--vg-down)";
  const gid = `eq-grad-${(_gradN = (_gradN + 1) % 1000)}`;
  const area = `${line(xs)} L${x(curve.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`;
  const ex = x(curve.length - 1), ey = y(last);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet"
      style={{ display: "block" }} role="img" aria-label="Cumulative P&L equity curve">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.22" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* zero baseline */}
      <line x1={padX} y1={y(0)} x2={W - padX} y2={y(0)} stroke="var(--vg-rule)" strokeOpacity="0.6" strokeDasharray="2 3" />
      {/* peak (high-water) line → the gap below it reads as drawdown */}
      <path d={line(peaks)} fill="none" stroke="var(--vg-faint)" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="3 3" />
      <path d={area} fill={`url(#${gid})`} />
      <path d={line(xs)} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" />
      {/* endpoint marker + current value */}
      <circle cx={ex} cy={ey} r="3.5" fill={col} />
      <text x={ex - 6} y={ey - 8} textAnchor="end" fontSize="12" fontWeight="600" fill={col}
        style={{ fontVariantNumeric: "tabular-nums" }}>{usd(last)}</text>
    </svg>
  );
}

// A clean, aligned closed-trades table shared by the reclaim + scanner-spread books.
// Winners/losers first (the real record), then the no-fill/voided $0 rows folded into
// a collapsed tail so they don't drown out the actual results. `label`/`detail`/`reason`
// are accessors so each book supplies its own columns.
function TrackRecordTable({ rows, label, detail, reason }) {
  const [showAll, setShowAll] = React.useState(false);
  const real = rows.filter((r) => (r.pnl || 0) !== 0);
  const flat = rows.filter((r) => (r.pnl || 0) === 0);   // never_filled / voided
  const shown = showAll ? real : real.slice(0, 15);
  const Row = (r) => {
    const pnl = r.pnl || 0;
    const tone = pnl > 0 ? "good" : pnl < 0 ? "bad" : "flat";
    return (
      <div key={r.id} className="vg-tr-row">
        <span className={cls("vg-tr-dot", tone)} aria-hidden="true" />
        <span className={cls("vg-tr-pnl", tone)}>{pnl === 0 ? "—" : usd(pnl)}</span>
        <span className="vg-tr-label">{label(r)}</span>
        <span className="vg-tr-detail">{detail(r)}</span>
        <span className={cls("vg-tr-reason", reason(r))}>{reason(r)}</span>
      </div>
    );
  };
  return (
    <div className="vg-tr-table">
      {shown.map(Row)}
      {real.length > 15 && !showAll && (
        <button className="vg-linkbtn vg-tr-more" onClick={() => setShowAll(true)}>
          show {real.length - 15} more
        </button>
      )}
      {flat.length > 0 && (
        <div className="vg-tr-flat">
          {flat.length} no-fill / voided ({flat.filter((r) => reason(r) === "never_filled").length} never filled ·
          {" "}{flat.filter((r) => reason(r) === "voided").length} voided) — $0, excluded from win-rate
        </div>
      )}
    </div>
  );
}

export function PaperView({ refreshNonce }) {
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState("");   // which action is in flight
  const [sym, setSym] = useState("SPX");  // SPX | QQQ | IWM
  const pv = useLive(() => getPaper(sym), null, [refreshNonce, nonce, sym]);
  const d = pv.data;

  const reload = () => setNonce((n) => n + 1);
  const doOpen = async (t) => { setBusy("open"); await openPaperTrade(t); setBusy(""); reload(); };
  const doSettle = async () => { setBusy("settle"); await settlePaper(sym); setBusy(""); reload(); };
  const doClose = async (row) => {
    // close at the target-side reference (best available without a live quote here)
    setBusy(`close${row.id}`);
    await closePaperTrade(row.id, row.spy_target || row.spy_entry, sym);
    setBusy(""); reload();
  };

  if (d && d.available === false) {
    return (
      <div className="vg-pane-body">
        <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Paper trading</h2>
        <p className="vg-note">{d.note || "Paper trading needs the SQLite backend + a generated playbook."}</p>
      </div>
    );
  }

  const tickets = (d && d.tickets) || [];
  const open = (d && d.open) || [];
  const closed = (d && d.closed) || [];
  const stats = (d && d.stats) || {};

  return (
    <div className="vg-pane-body vg-playbook">
      <div className="vg-pb-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Paper trading <span className="vg-note" style={{ fontSize: 13, fontWeight: 400 }}>· no money</span></h2>
          <div className="vg-row" style={{ gap: 10, marginTop: 6, marginBottom: 4, alignItems: "center" }}>
            <SymbolSwitcher value={sym} onChange={setSym} />
          </div>
          <div className="vg-note">
            {d ? `${open.length} open · ${closed.length} closed` : "loading…"}
            {d && d.session ? ` · from the ${d.session} ${sym} playbook` : ""}
          </div>
          <div className="vg-row" style={{ gap: 6, marginTop: 8 }}>
            <button className="vg-btn-sm accent" disabled={busy === "settle"} onClick={doSettle}>
              {busy === "settle" ? "Checking…" : "Check fills (settle)"}
            </button>
          </div>
        </div>
        {stats.n > 0 && (
          <div className="vg-pb-levels">
            <Tile label="Win rate" value={pct(stats.win_rate)} tone={stats.win_rate >= 0.5 ? "good" : "bad"} termKey="win_rate" />
            <Tile label="Net P&L" value={usd(stats.total_pnl)} tone={stats.total_pnl >= 0 ? "good" : "bad"} />
            <Tile label="Profit factor" value={stats.profit_factor ?? "—"} tone={stats.profit_factor >= 1.3 ? "good" : "warn"} termKey="profit_factor" />
            <Tile label="Closed" value={stats.n} />
          </div>
        )}
      </div>

      {/* how it works */}
      <div className="vg-note" style={{ fontSize: 13, margin: "2px 0 4px" }}>
        Signals from today's playbook, priced on SPY. Wait for the{" "}
        <Term k="reclaim">reclaim trigger</Term> — never enter on the touch — then log
        the trade and it auto-closes when it hits the <Term k="fade">target or stop</Term>.
        No real orders are ever placed.
      </div>

      {/* why-no-tickets honesty (IWM: validated 3-year finding) */}
      {d && d.ticket_note && (
        <div className="vg-card">
          <div className="vg-kicker">No tradeable tickets</div>
          <div className="vg-note" style={{ fontSize: 13, marginTop: 6 }}>{d.ticket_note}</div>
        </div>
      )}

      {/* today's trade tickets */}
      {tickets.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Today's trade tickets (SPY)</div>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {tickets.map((t, i) => (
              <div key={i} className="vg-pb-setup">
                <div className="vg-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                  <div>
                    <span className={cls("vg-badge", t.side === "long" ? "good" : "bad")}
                      style={{ minWidth: 44, textAlign: "center" }}>
                      {t.side === "long" ? "BUY" : "SELL"}
                    </span>{" "}
                    <b>{t.signal}</b>
                    {t.setup === "break" && (
                      <span className="vg-badge warn" style={{ marginLeft: 6, fontSize: 12 }}>BREAK — experts</span>
                    )}
                    {t.counter_trend && (
                      <span className="vg-badge bad" style={{ marginLeft: 6, fontSize: 12 }}>⚠ counter-trend</span>
                    )}
                    {t.freshness && (
                      <span className={cls("vg-badge", FRESH_TONE[t.freshness] || "plain")}
                        style={{ marginLeft: 6, fontSize: 12 }}>{t.freshness}</span>
                    )}
                  </div>
                  <button className="vg-btn-sm" disabled={busy === "open"} onClick={() => doOpen(t)}>
                    Paper trade
                  </button>
                </div>
                <div className="vg-note" style={{ fontSize: 13, marginTop: 4 }}>
                  Entry <b>{px(t.spy_entry)}</b> · target <b>{px(t.spy_target)}</b> · stop <b>{px(t.spy_stop)}</b>
                  {t.reward_risk != null && <> · <Term k="reward_risk">R:R</Term> {t.reward_risk}</>}
                  {" · "}~{px(t.ref_strike)} 0DTE
                  {t.otm_strike != null && <> · ~{px(t.otm_strike)} OTM</>}
                  {t.spx_level ? ` · ${t.underlying || "SPX"} ${Math.round(t.spx_level)}` : ""}
                </div>
                {t.entry_note && (
                  <div className="vg-note" style={{ fontSize: 12, marginTop: 3 }}>
                    <b><Term k="reclaim">Trigger</Term>:</b> {t.entry_note}
                  </div>
                )}
                {(t.freshness_note || t.trend_note || t.otm_note) && (
                  <div className="vg-note" style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>
                    {[t.trend_note, t.freshness_note, t.otm_note].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* open positions */}
      {open.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Open paper trades</div>
          <div className="vg-pb-ladder" style={{ marginTop: 6 }}>
            {open.map((r) => (
              <div key={r.id} className="vg-pb-lvl">
                <span className={cls("vg-badge", r.side === "long" ? "good" : "bad")} style={{ minWidth: 44, textAlign: "center" }}>
                  {r.side === "long" ? "BUY" : "SELL"}
                </span>
                <span style={{ fontSize: 14 }}>{r.signal}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>
                  entry {px(r.spy_entry)} · tgt {px(r.spy_target)} · stop {px(r.spy_stop)}
                </span>
                <button className="vg-linkbtn" style={{ marginLeft: 8 }} disabled={busy === `close${r.id}`}
                  onClick={() => doClose(r)}>{busy === `close${r.id}` ? "…" : "close"}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* track record — equity curve hero + an aligned trade table */}
      {closed.length > 0 && (
        <div className="vg-card vg-tr">
          <div className="vg-spread" style={{ alignItems: "baseline" }}>
            <div className="vg-kicker" style={{ marginBottom: 0 }}>Track record</div>
            <span className="vg-note" style={{ fontSize: 12 }}>
              {Object.entries(stats.by_exit || {}).map(([k, v]) => `${v} ${k}`).join(" · ")}
            </span>
          </div>
          <div className="vg-tr-curve">
            <EquityCurve curve={d.equity_curve} />
          </div>
          <TrackRecordTable
            rows={closed}
            label={(r) => r.signal}
            detail={(r) => `${px(r.spy_entry)} → ${px(r.spy_exit)}`}
            reason={(r) => r.exit_reason} />
        </div>
      )}

      <GlossaryCard terms={["reclaim", "fade", "reward_risk", "win_rate", "profit_factor"]} />

      {/* the scanner debit-spread book — its OWN record, never mixed with the
          SPX reclaim win-rate above (different P&L basis). */}
      <ScannerSpreadBook refreshNonce={refreshNonce} />

      <div className="vg-pb-caveats">
        <div>SPY is a proxy for SPX; P&L is on SPY shares. A simulation for learning + strategy validation.</div>
        <div>Places NO real orders and touches no broker or funds (ADR-010). Not financial advice.</div>
      </div>
    </div>
  );
}

// A compact display of a scanner debit spread: "COP PUT 114/110 ×4".
function spreadLabel(r) {
  const kind = r.structure === "debit_call_spread" ? "CALL" : "PUT";
  return `${r.underlying} ${kind} ${px(r.long_strike)}/${px(r.short_strike)} ×${r.contracts}`;
}

// The scanner debit-spread book: auto-logged A+ setups, settled on each
// underlying's bars. Kept SEPARATE from the SPX reclaim record — the two have
// different P&L bases, so blending their win-rate would be meaningless.
export function ScannerSpreadBook({ refreshNonce, alwaysShow }) {
  const q = useLive(() => getSpreadBook(), null, [refreshNonce]);
  const d = q.data;
  if (!d || d.available === false) return null;
  const open = d.open || [];
  const closed = d.closed || [];
  const stats = d.stats || {};
  // alwaysShow (Positions page): render the section header + an empty-state even
  // when nothing has fired yet, so paper trades have a permanent, findable home.
  if (!open.length && !closed.length) {
    if (!alwaysShow) return null;
    return (
      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-kicker">Paper trades — scanner spreads</div>
        <p className="vg-note" style={{ margin: "8px 0 0", fontSize: 13 }}>
          No paper spreads yet. When an A+ scanner setup fires it opens a debit spread
          here (on Alpaca paper when configured) — open positions + a closed track
          record with win-rate. Separate from the SPX reclaim book.
        </p>
      </div>
    );
  }
  // any row on the real broker → show the "Alpaca paper" book-of-record note.
  const onAlpaca = [...open, ...closed].some((r) => r.broker === "alpaca-paper");
  // broker status → a short, readable label for an open row.
  const brokerLabel = (r) => {
    if (r.broker !== "alpaca-paper") return null;
    if (r.fill_status === "pending") return { text: "submitted", tone: "warn" };
    if (r.broker_status === "filled" || r.fill_status === "filled") return { text: "filled", tone: "good" };
    return { text: r.broker_status || "working", tone: "plain" };
  };
  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread" style={{ alignItems: "baseline" }}>
        <div className="vg-kicker" style={{ marginBottom: 0 }}>Scanner spreads</div>
        <span className="vg-note" style={{ fontSize: 12 }}>
          auto-logged from A+ setups · debit spreads · separate from the reclaim record
          {onAlpaca && <> · <b style={{ color: "var(--vg-up)" }}>Alpaca paper</b> (real fills)</>}
        </span>
      </div>
      {stats.n > 0 && (
        <div className="vg-stats" style={{ marginTop: 10 }}>
          <Tile label="Net P&L" value={usd(stats.total_pnl)} tone={stats.total_pnl >= 0 ? "good" : "bad"} />
          <Tile label="Win rate" value={pct(stats.win_rate)} termKey="win_rate" />
          <Tile label="Profit factor" value={stats.profit_factor != null ? stats.profit_factor.toFixed(2) : "—"} termKey="profit_factor" />
          <Tile label="Closed" value={stats.n} />
        </div>
      )}
      {open.length > 0 && (
        <>
          <div className="vg-note" style={{ fontSize: 12, margin: "12px 0 4px" }}>Open ({open.length})</div>
          <div className="vg-pb-ladder">
            {open.map((r) => {
              const bs = brokerLabel(r);
              return (
                <div key={r.id} className="vg-pb-lvl">
                  <span className={cls("vg-badge", r.side === "long" ? "good" : "bad")}
                    style={{ minWidth: 44, textAlign: "center" }}>
                    {r.side === "long" ? "CALL" : "PUT"}
                  </span>
                  <span style={{ fontSize: 14 }}>{spreadLabel(r)}</span>
                  {bs && <span className={cls("vg-badge", bs.tone)} style={{ fontSize: 12 }}>{bs.text}</span>}
                  <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>
                    target {px(r.short_strike)} · invalid {px(r.underlying_invalid)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {closed.length > 0 && (
        <>
          {d.equity_curve && d.equity_curve.length > 1 && (
            <div className="vg-tr-curve"><EquityCurve curve={d.equity_curve} /></div>)}
          <TrackRecordTable
            rows={closed}
            label={(r) => spreadLabel(r)}
            detail={(r) => (r.exit_reason === "target" ? `→ ${px(r.short_strike)}` : `× ${px(r.underlying_invalid)}`)}
            reason={(r) => r.exit_reason} />
        </>
      )}
      <div className="vg-pb-caveats" style={{ marginTop: 10 }}>
        {onAlpaca
          ? <div>Book of record: <b>Alpaca paper</b> — real multi-leg fills, closed on the
              invalidation (stop-loss) or target. Paper account only, no real money.</div>
          : <div>Debit spreads modeled from scanner setups (no live options chain — debit ≈ ½ width).
              A simulation; places no orders (ADR-010).</div>}
      </div>
    </div>
  );
}

function Tile({ label, value, tone, termKey }) {
  return (
    <div className="vg-pb-tile">
      <div className="vg-note" style={{ fontSize: 12 }}>{termKey ? <Term k={termKey}>{label}</Term> : label}</div>
      <div className={cls("vg-pb-tileval", tone)}>{value}</div>
    </div>
  );
}
