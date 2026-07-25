// Operational cards extracted from the retired TodayView (W2 of the Astryx
// migration) — the surfaces that existed NOWHERE else and must not die with
// the page: live reclaim signals with the execute path (edge guard mirrored
// from the server), the bot's own track record, and the nightly-run health.
import { cls } from "./util.jsx";

const { useState, useEffect } = React;

const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));
const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Number(v)).toFixed(0)}`);

// ---------------------------------------------------------------- 1. signals

export function SignalsCard({ live, armed, spot, onExecute }) {
  const n = live.length;
  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread">
        <div className="vg-kicker" style={{ marginBottom: 0 }}>
          Signals · {n} confirmed{armed.length ? `, ${armed.length} waiting` : ""}
        </div>
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
  // signed reward: a target on the WRONG side of the entry is negative
  const reward = (t.spy_target != null && t.spy_entry != null)
    ? (long ? t.spy_target - t.spy_entry : t.spy_entry - t.spy_target) : null;
  const rr = (reward != null && t.spy_stop != null && t.spy_entry != null)
    ? reward / Math.abs(t.spy_entry - t.spy_stop) : null;
  // the edge guard, mirrored in the UI: the execute path refuses R:R < 1 or a
  // target behind the entry — so don't offer a button that will be rejected.
  const badEdge = !armed && rr != null && rr < 1;
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
                {rr != null && (
                  <> · R:R <b className={badEdge ? "vg-down" : undefined}>{rr.toFixed(2)}</b></>
                )}
              </>}
        </div>
        {badEdge && (
          <div className="vg-note" style={{ marginTop: 4, color: "var(--vg-down)", fontWeight: 600 }}>
            ⚠️ negative edge — the target is nearer than the stop. Not executable.
          </div>
        )}
      </div>
      {armed
        ? <button className="vg-btn-sm" disabled style={{ opacity: .45 }}>Waiting</button>
        : badEdge
          ? <button className="vg-btn-sm" disabled style={{ opacity: .45 }}
              title="refused: R:R below 1 — the execute path would reject this">Blocked</button>
          : <button className="vg-btn-sm vg-btn-primary" onClick={() => onExecute(t)}>Execute</button>}
    </div>
  );
}

// --------------------------------------------------------------- 3. strategy

export function StrategyCard({ perf }) {
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
      <p className="vg-note" style={{ marginTop: 8, fontSize: 12 }}>
        The bot's OWN trades, every underlying, losses included.
        {s.live_taken > 0 && <> Live: {s.live_taken} taken · {money(s.live_pnl)}.</>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- 4. machine

export function MachineCard({ run }) {
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
      <p className="vg-note" style={{ marginTop: 8, fontSize: 12 }}>
        last run {String(run.started_at || "").slice(0, 16).replace("T", " ")}
      </p>
    </div>
  );
}

function Metric({ label, value, bad }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: "-.01em",
        fontVariantNumeric: "tabular-nums", color: bad ? "var(--vg-down)" : undefined }}>{value}</div>
      <div className="vg-note" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
    </div>
  );
}
