// PaperView — paper-trade the 0DTE playbook on SPY (Intelligence nav).
// A NO-MONEY simulation: today's playbook signals become SPY trade tickets
// (entry at the level, target = next level, stop just beyond), you log one with
// one click, and it auto-closes when SPY touches target or stop. Builds an honest
// track record of whether trading the levels works — before risking real money.
// Places NO real orders (ADR-010). Not financial advice.
import { cls } from "./util.jsx";
import { Term, GlossaryCard } from "./glossary.jsx";
import { useLive, getPaper, openPaperTrade, settlePaper, closePaperTrade } from "./live.js";

const { useState } = React;

const usd = (v) => (v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`);
const pct = (v) => (v == null ? "—" : `${Math.round(100 * v)}%`);
const px = (v) => (v == null ? "—" : Number(v).toFixed(2));

// zone-freshness badge tone: strong=good, tested=warn, weak=bad, fresh=info
const FRESH_TONE = { strong: "good", fresh: "info", tested: "warn", weak: "bad" };

function EquityCurve({ curve }) {
  if (!curve || curve.length < 2) return null;
  const W = 640, H = 110, pad = 6;
  const xs = curve.map((p) => p.cum), peaks = curve.map((p) => p.peak);
  const lo = Math.min(0, ...xs), hi = Math.max(...peaks, ...xs), range = hi - lo || 1;
  const x = (i) => pad + (i / (curve.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - lo) / range) * (H - 2 * pad);
  const line = (a) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = xs[xs.length - 1] >= 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke="currentColor" strokeOpacity="0.2" />
      <path d={line(peaks)} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 3" />
      <path d={line(xs)} fill="none" stroke={up ? "#26A69A" : "#EF5350"} strokeWidth="1.75" />
    </svg>
  );
}

export function PaperView({ refreshNonce }) {
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState("");   // which action is in flight
  const pv = useLive(() => getPaper(), null, [refreshNonce, nonce]);
  const d = pv.data;

  const reload = () => setNonce((n) => n + 1);
  const doOpen = async (t) => { setBusy("open"); await openPaperTrade(t); setBusy(""); reload(); };
  const doSettle = async () => { setBusy("settle"); await settlePaper(); setBusy(""); reload(); };
  const doClose = async (row) => {
    // close at the target-side reference (best available without a live quote here)
    setBusy(`close${row.id}`);
    await closePaperTrade(row.id, row.spy_target || row.spy_entry);
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
          <h2 style={{ margin: 0, fontSize: 19 }}>Paper trading <span className="vg-note" style={{ fontSize: 12, fontWeight: 400 }}>· SPY proxy · no money</span></h2>
          <div className="vg-note">
            {d ? `${open.length} open · ${closed.length} closed` : "loading…"}
            {d && d.session ? ` · from the ${d.session} playbook` : ""}
          </div>
          <div className="vg-row" style={{ gap: 6, marginTop: 8 }}>
            <button className="vg-btn-sm" disabled={busy === "settle"} onClick={doSettle}>
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
      <div className="vg-note" style={{ fontSize: 12, margin: "2px 0 4px" }}>
        Signals from today's playbook, priced on SPY. Log one and it auto-closes when SPY
        hits the <Term k="fade">target or stop</Term>. No real orders are ever placed.
      </div>

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
                      <span className="vg-badge warn" style={{ marginLeft: 6, fontSize: 10 }}>BREAK — experts</span>
                    )}
                    {t.counter_trend && (
                      <span className="vg-badge bad" style={{ marginLeft: 6, fontSize: 10 }}>⚠ counter-trend</span>
                    )}
                    {t.freshness && (
                      <span className={cls("vg-badge", FRESH_TONE[t.freshness] || "plain")}
                        style={{ marginLeft: 6, fontSize: 10 }}>{t.freshness}</span>
                    )}
                  </div>
                  <button className="vg-btn-sm" disabled={busy === "open"} onClick={() => doOpen(t)}>
                    Paper trade
                  </button>
                </div>
                <div className="vg-note" style={{ fontSize: 12, marginTop: 4 }}>
                  Entry <b>{px(t.spy_entry)}</b> · target <b>{px(t.spy_target)}</b> · stop <b>{px(t.spy_stop)}</b>
                  {t.reward_risk != null && <> · <Term k="reward_risk">R:R</Term> {t.reward_risk}</>}
                  {" · "}~{px(t.ref_strike)} 0DTE
                  {t.otm_strike != null && <> · ~{px(t.otm_strike)} OTM</>}
                  {t.spx_level ? ` · SPX ${Math.round(t.spx_level)}` : ""}
                </div>
                {(t.freshness_note || t.trend_note || t.otm_note) && (
                  <div className="vg-note" style={{ fontSize: 11, marginTop: 2, opacity: 0.85 }}>
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
                <span style={{ fontSize: 13 }}>{r.signal}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 11 }}>
                  entry {px(r.spy_entry)} · tgt {px(r.spy_target)} · stop {px(r.spy_stop)}
                </span>
                <button className="vg-linkbtn" style={{ marginLeft: 8 }} disabled={busy === `close${r.id}`}
                  onClick={() => doClose(r)}>{busy === `close${r.id}` ? "…" : "close"}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* track record */}
      {closed.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Track record ({closed.length} closed)</div>
          <div style={{ marginTop: 6, color: "var(--color-text, #888)" }}>
            <EquityCurve curve={d.equity_curve} />
          </div>
          <div className="vg-note" style={{ fontSize: 11, margin: "4px 0 6px" }}>
            {Object.entries(stats.by_exit || {}).map(([k, v]) => `${v} ${k}`).join(" · ")}
          </div>
          <div className="vg-pb-ladder">
            {closed.slice(0, 12).map((r) => (
              <div key={r.id} className="vg-pb-lvl">
                <span className={cls("vg-badge", (r.pnl || 0) >= 0 ? "good" : "bad")} style={{ minWidth: 62, textAlign: "right" }}>
                  {usd(r.pnl)}
                </span>
                <span style={{ fontSize: 13 }}>{r.signal}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 11 }}>
                  {px(r.spy_entry)}→{px(r.spy_exit)} · {r.exit_reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <GlossaryCard terms={["fade", "reward_risk", "win_rate", "profit_factor"]} />

      <div className="vg-pb-caveats">
        <div>SPY is a proxy for SPX; P&L is on SPY shares. A simulation for learning + strategy validation.</div>
        <div>Places NO real orders and touches no broker or funds (ADR-010). Not financial advice.</div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone, termKey }) {
  return (
    <div className="vg-pb-tile">
      <div className="vg-note" style={{ fontSize: 11 }}>{termKey ? <Term k={termKey}>{label}</Term> : label}</div>
      <div className={cls("vg-pb-tileval", tone)}>{value}</div>
    </div>
  );
}
