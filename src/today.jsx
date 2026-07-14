// Today — the one screen that answers "what do I trade today?".
//
// Born from the ux-feature-value goal (claudedocs/goals/ux-feature-value):
// driving the live app showed 2 of 5 core jobs FAILED. A user could not act
// on a fired signal at all (no row action; the signal's SPY level wasn't even
// present on the SPX playbook where tickets live), and "how am I doing?" got
// three contradicting answers across three views — the most flattering of
// which silently dropped the losing trades.
//
// This view collapses that: four cards, zero navigation.
//   1. Signals   — the decision, with Execute ON the row (pre-seeded ticket)
//   2. Why       — the playbook read, compressed; levels behind a disclosure
//   3. Strategy  — the HONEST record (bot's own trades), losses included
//   4. Machine   — last nightly run, failures named inline
//
// It composes existing surfaces (it does not fork them): Execute opens the
// same gated TicketModal the playbook uses (dry-run → arm → confirm), so
// there is exactly ONE order path in the product (ADR-010 v2).
import { TicketModal } from "./playbook.jsx";
import { getBotStatus, getBotPerformance, getNightlyStatus, getPlaybook } from "./live.js";
import { cls, StatTile } from "./util.jsx";

const { useEffect, useState } = React;

const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));
const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Number(v)).toFixed(0)}`);

export function TodayView({ refreshNonce }) {
  const [status, setStatus] = useState(null);
  const [perf, setPerf] = useState(null);
  const [nightly, setNightly] = useState(null);
  const [pb, setPb] = useState(null);
  const [ticket, setTicket] = useState(null);   // {sym, spot, seed, signalId}

  const load = async () => {
    const [s, p, n, b] = await Promise.all([
      getBotStatus(), getBotPerformance(), getNightlyStatus(1), getPlaybook(null),
    ]);
    setStatus(s && s.available !== false ? s : null);
    setPerf(p && p.available !== false ? p : null);
    setNightly(n && n.available && n.runs && n.runs.length ? n.runs[0] : null);
    setPb(b && b.available ? b : null);
  };
  useEffect(() => { load(); }, [refreshNonce]);
  // signals move while the market is open — keep the decision surface honest
  useEffect(() => {
    if (!status || !status.market_open) return undefined;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [status && status.market_open]);

  if (!status) {
    return (
      <div className="vg-pane-body">
        <h2 style={{ margin: 0, fontSize: 19 }}>Today</h2>
        <p className="vg-note">Needs the SQLite backend — check the backend URL in Settings.</p>
      </div>
    );
  }

  const live = status.live_signals || [];
  const armed = status.armed || [];
  const spot = (pb && pb.scaffold && pb.scaffold.regime && pb.scaffold.regime.spot) || null;

  return (
    <div className="vg-pane-body">
      <div className="vg-spread">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Today</h2>
          <p className="vg-sub">
            Everything you need to trade, in one screen
            {spot ? ` · SPX ${fmt(spot, 1)}` : ""}
          </p>
        </div>
        <div className="vg-row" style={{ gap: 6, alignItems: "center" }}>
          <span className={cls("vg-badge", status.market_open ? "good" : "plain")}>
            {status.market_open ? "market open" : "market closed"}
          </span>
          <span className={cls("vg-badge", status.telegram ? "good" : "warn")}>
            {status.telegram ? "bot on" : "bot off"}
          </span>
        </div>
      </div>

      <SignalsCard live={live} armed={armed} spot={spot}
        onExecute={(t) => setTicket({
          // the signal already names symbol + side + level: seed the ticket
          // with them so the user never re-derives what the app knows.
          sym: t.symbol, spot,
          seed: { level: t.spy_level, role: t.side === "long" ? "support" : "resistance" },
          signalId: t.id,
        })} />

      <WhyCard pb={pb} />

      <div className="vg-stats" style={{ marginTop: 14, gridTemplateColumns: "1fr 1fr" }}>
        <StrategyCard perf={perf} />
        <MachineCard run={nightly} />
      </div>

      {ticket && (
        <TicketModal sym={ticket.sym} spot={ticket.spot} seed={ticket.seed}
          signalPaperId={ticket.signalId} onClose={() => setTicket(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 1. signals

function SignalsCard({ live, armed, spot, onExecute }) {
  const n = live.length;
  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread">
        <div className="vg-kicker" style={{ marginBottom: 0 }}>
          Signals · {n} confirmed{armed.length ? `, ${armed.length} waiting` : ""}
        </div>
        <a className="vg-linkbtn" href="#signalbot">history →</a>
      </div>

      {n === 0 && armed.length === 0 && (
        <p className="vg-note" style={{ marginTop: 12 }}>
          Nothing armed yet — the bot arms each session's playbook levels at its next pass.
        </p>
      )}

      {live.map((t) => <SignalRow key={t.id} t={t} onExecute={onExecute} />)}
      {armed.map((t) => <SignalRow key={t.id} t={t} armed />)}
    </div>
  );
}

function SignalRow({ t, armed, onExecute }) {
  const long = t.side === "long";
  const risk = (t.spy_entry != null && t.spy_stop != null)
    ? Math.abs(t.spy_entry - t.spy_stop) * (t.shares || 100) : null;
  const rr = (t.spy_entry != null && t.spy_stop != null && t.spy_target != null)
    ? Math.abs(t.spy_target - t.spy_entry) / Math.abs(t.spy_entry - t.spy_stop) : null;
  return (
    <div className={cls("vg-sigrow", armed && "armed", !armed && (long ? "live-long" : "live-short"))}>
      <span style={{ fontSize: 14 }}>{armed ? "○" : "🔔"}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-.01em" }}>
          <span className={long ? "vg-up" : "vg-down"}>{t.side.toUpperCase()}</span>{" "}
          {t.symbol}{" "}
          <span className="vg-note" style={{ fontWeight: 400 }}>
            {armed ? `armed at ${fmt(t.spy_level)}` : `${long ? "reclaimed" : "rejected"} ${fmt(t.spy_level)}`}
          </span>
        </div>
        <div className="vg-note" style={{ marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
          {armed
            ? <>waiting for the 3×5m reclaim · stop {fmt(t.spy_stop)} · target {fmt(t.spy_target)}</>
            : <>
                entry <b>{fmt(t.spy_entry)}</b> · stop <b>{fmt(t.spy_stop)}</b> ·{" "}
                {t.spy_target != null
                  ? <>target <b>{fmt(t.spy_target)}</b></>
                  : <span className="vg-warn-text">no target — open-ended</span>}
                {risk != null && <> · risk <b>${risk.toFixed(0)}</b></>}
                {rr != null && <> · R:R <b>{rr.toFixed(1)}</b></>}
              </>}
        </div>
      </div>
      {armed
        ? <button className="vg-btn-sm" disabled style={{ opacity: .45 }}>Waiting</button>
        : <button className="vg-btn-sm vg-btn-primary" onClick={() => onExecute(t)}>Execute</button>}
    </div>
  );
}

// -------------------------------------------------------------------- 2. why

function WhyCard({ pb }) {
  if (!pb) return null;
  const sc = pb.scaffold || {};
  const reg = sc.regime || {};
  const levels = (sc.confluence || []).slice(0, 6);
  // the narration's first paragraph IS the read — the rest is disclosure
  const lede = (pb.narrative || "").split("\n").filter(Boolean)[0] || null;
  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-kicker">Why · today's read</div>
      <p className="vg-note" style={{ marginTop: 6, color: "var(--vg-dim)" }}>
        {lede || (
          <>
            <b>{reg.gamma === "negative" ? "Negative" : "Positive"} gamma</b>
            {reg.vix ? <>, VIX {fmt(reg.vix, 1)}</> : null}
            {reg.gamma === "negative"
              ? " — dealer hedging amplifies moves: a momentum tape. Trade with the move, not against it."
              : " — dealer hedging dampens moves: expect mean reversion between the walls."}
          </>
        )}
      </p>
      <details style={{ marginTop: 8 }}>
        <summary className="vg-note" style={{ cursor: "pointer", fontWeight: 600 }}>
          levels &amp; full playbook
        </summary>
        <table className="vg-table" style={{ marginTop: 8, fontSize: 12.5 }}>
          <tbody>
            {levels.map((z, i) => (
              <tr key={i}>
                <td>{(z.kinds || []).join(" + ") || z.role}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <b>{fmt(z.price, 1)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="vg-note" style={{ marginTop: 8 }}>
          <a className="vg-linkbtn" href="#playbook">open the full playbook →</a>
        </p>
      </details>
    </div>
  );
}

// --------------------------------------------------------------- 3. strategy

function StrategyCard({ perf }) {
  const s = (perf && perf.summary) || null;
  if (!s) return <div className="vg-card"><div className="vg-kicker">Is the strategy working?</div>
    <p className="vg-note" style={{ marginTop: 10 }}>No closed signals yet.</p></div>;

  const losing = s.paper_pnl < 0;
  const thin = s.paper_closed < 20;   // honesty: n=8 is not a verdict
  return (
    <div className={cls("vg-card", losing && "vg-card-alarm")}>
      <div className="vg-kicker">Is the strategy working?</div>
      <div className="vg-row" style={{ gap: 22, marginTop: 8, flexWrap: "wrap" }}>
        <Metric label="win rate" bad={losing}
          value={s.paper_win_rate == null ? "—" : `${Math.round(s.paper_win_rate * 100)}%`} />
        <Metric label="net P&L" bad={losing} value={money(s.paper_pnl)} />
        <Metric label="closed" value={String(s.paper_closed)} />
      </div>
      {losing && (
        <p className="vg-verdict">
          ⚠️ Losing money over {s.paper_closed} trades.
          {thin ? " Small sample — but do not size up." : " Stop and re-validate before taking more."}
        </p>
      )}
      <p className="vg-note" style={{ marginTop: 8, fontSize: 11 }}>
        The bot's OWN trades, every underlying, losses included.
        {s.live_taken > 0 && <> Live: {s.live_taken} taken · {money(s.live_pnl)}.</>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- 4. machine

function MachineCard({ run }) {
  if (!run) {
    return (
      <div className="vg-card">
        <div className="vg-kicker">Is the machine OK?</div>
        <p className="vg-note" style={{ marginTop: 10 }}>No nightly run recorded yet.</p>
      </div>
    );
  }
  const jobs = run.jobs || [];
  const bad = jobs.filter((j) => !j.ok);
  const total = jobs.reduce((a, j) => a + (j.duration_sec || 0), 0);
  return (
    <div className={cls("vg-card", bad.length && "vg-card-alarm")}>
      <div className="vg-kicker">Is the machine OK?</div>
      <div className="vg-row" style={{ gap: 22, marginTop: 8, flexWrap: "wrap" }}>
        <Metric label="jobs ok" value={`${jobs.length - bad.length}✓`} />
        <Metric label="failed" value={`${bad.length}✗`} bad={bad.length > 0} />
        <Metric label="runtime" value={total >= 60 ? `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s` : `${total}s`} />
      </div>
      {bad.map((j, i) => (
        <p key={i} className="vg-note" style={{ marginTop: 6, color: "var(--vg-down)" }}>
          ✗ <b>{j.job}</b> — {(j.tail || "").split("\n").slice(-1)[0].slice(0, 60)}
        </p>
      ))}
      <p className="vg-note" style={{ marginTop: 8, fontSize: 11 }}>
        last run {String(run.started_at || "").slice(0, 16).replace("T", " ")} ·{" "}
        <a className="vg-linkbtn" href="#signalbot">all jobs →</a>
      </p>
    </div>
  );
}

function Metric({ label, value, bad }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: "-.01em",
        fontVariantNumeric: "tabular-nums", color: bad ? "var(--vg-down)" : undefined }}>{value}</div>
      <div className="vg-note" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
    </div>
  );
}
