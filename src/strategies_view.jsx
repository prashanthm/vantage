// LifecycleBoard — the ADR-015 strategy lifecycle board, rendered as the
// promotion section of the merged Strategies (scanner) page. One card per registered
// strategy showing its STAGE (paper → eligible → live → paused), the promotion gate
// (live-paper win-rate vs the frozen backtest baseline), its caps, and the operator
// controls (promote / pause / resume). A global banner shows whether autonomous live
// is ARMED (both env gates + kill switch clear) — because that's the difference
// between "records what it would do" and "moves real money". Plus the immutable
// audit trail per strategy.
//
// This subsumes the old Signal Bot + Paper + Managed Exits into one lifecycle: they
// were three views of one pipeline; this is the pipeline as a lifecycle.
import { cls, LoadBar, StatTile, usd } from "./util.jsx";
import {
  useLive, getLifecycle, promoteStrategy, pauseStrategy, resumeStrategy,
  lifecycleTick, getStrategyAudit,
} from "./live.js";

const { useState, useCallback, useEffect } = React;

const pct = (n, d = 1) => (n == null ? "—" : `${(Number(n) * 100).toFixed(d)}%`);

const STAGE_TONE = { paper: "plain", eligible: "good", live: "info", paused: "warn" };
const STAGE_LABEL = { paper: "PAPER", eligible: "ELIGIBLE", live: "LIVE", paused: "PAUSED" };

// The gate read: paper win-rate vs the frozen backtest baseline, and whether it passes.
function GateRow({ gate }) {
  if (!gate) return null;
  const wr = gate.paper_win_rate, base = gate.baseline_win_rate;
  return (
    <div className="vg-sl-gate">
      <div className="vg-sl-gatebar">
        <span className="vg-note">paper</span>
        <b className={cls(gate.passes ? "vg-up" : "vg-down")}>{pct(wr)}</b>
        <span className="vg-note">vs baseline</span>
        <b>{pct(base)}</b>
        <span className="vg-note">· {gate.paper_n}/{gate.min_sample} trades</span>
        <span className={cls("vg-badge", gate.passes ? "good" : "plain")}
          style={{ marginLeft: "auto" }}>
          {gate.passes ? "GATE PASSES" : "GATE NOT MET"}
        </span>
      </div>
      <p className="vg-note vg-sl-gatewhy">{gate.reason}</p>
    </div>
  );
}

// The promote form: pick the account + set caps (only shown when the gate passes).
function PromoteForm({ sid, onDone }) {
  const [acct, setAcct] = useState("ALPACA-PAPER");
  const [maxUsd, setMaxUsd] = useState(5000);
  const [maxPos, setMaxPos] = useState(3);
  const [maxLoss, setMaxLoss] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = () => {
    setBusy(true); setErr(null);
    promoteStrategy(sid, { account: acct, caps: {
      max_order_usd: Number(maxUsd), max_positions: Number(maxPos),
      max_daily_loss_usd: Number(maxLoss),
    } }).then((r) => {
      setBusy(false);
      if (r && r.available === false) { setErr(r.note || "promotion refused"); return; }
      onDone();
    }).catch((e) => { setBusy(false); setErr(String(e && e.message || e)); });
  };
  return (
    <div className="vg-sl-promote">
      <div className="vg-sl-caps">
        <label>Account <input value={acct} onChange={(e) => setAcct(e.target.value)} /></label>
        <label>Max $/order <input type="number" value={maxUsd} onChange={(e) => setMaxUsd(e.target.value)} /></label>
        <label>Max positions <input type="number" value={maxPos} onChange={(e) => setMaxPos(e.target.value)} /></label>
        <label>Daily max-loss $ <input type="number" value={maxLoss} onChange={(e) => setMaxLoss(e.target.value)} /></label>
      </div>
      <button className="vg-btn sm on" onClick={submit} disabled={busy}>
        {busy ? "Promoting…" : "Promote to live"}
      </button>
      {err && <p className="vg-note bad">{err}</p>}
      <p className="vg-note">Promotion is deliberate — it enables autonomous orders for this
        strategy within these caps. Orders still only reach the broker when live is ARMED (below).</p>
    </div>
  );
}

// The per-strategy audit trail (collapsible) — the immutable record of every decision.
function AuditTrail({ sid }) {
  const [open, setOpen] = useState(false);
  const q = useLive(() => (open ? getStrategyAudit(sid) : Promise.resolve(null)), null, [sid, open]);
  const rows = (q.data && q.data.audit) || [];
  return (
    <div className="vg-sl-audit">
      <button className="vg-linkbtn" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} audit trail{rows.length ? ` (${rows.length})` : ""}
      </button>
      {open && q.loading && <LoadBar />}
      {open && rows.length > 0 && (
        <table className="vg-sl-audittable">
          <thead><tr><th>when</th><th>mode</th><th>order</th><th>reason</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="vg-note">{String(a.at || "").slice(5, 16).replace("T", " ")}</td>
                <td><span className={cls("vg-badge",
                  a.mode === "submitted" ? "info" : a.mode === "cap_breach" ? "bad"
                    : a.mode === "refused" ? "warn" : "plain")}>{a.mode}</span></td>
                <td className="vg-note">{a.order?.side} {a.order?.qty} {a.order?.symbol}
                  {a.order?.est_usd ? ` · ${usd(a.order.est_usd)}` : ""}</td>
                <td className="vg-note">{a.reason || "—"}</td>
              </tr>))}
          </tbody>
        </table>)}
      {open && !q.loading && rows.length === 0 && (
        <p className="vg-note" style={{ padding: "2px 0" }}>No orders yet.</p>)}
    </div>);
}

function StrategyCard({ s, armed, onChange }) {
  const stage = s.stage;
  const [busy, setBusy] = useState(false);
  const act = (fn) => { setBusy(true); fn().then(() => { setBusy(false); onChange(); })
    .catch(() => setBusy(false)); };
  return (
    <div className="vg-card vg-sl-card">
      <div className="vg-sl-head">
        <div>
          <span className="vg-sl-name">{s.display_name || s.strategy_id}</span>
          <span className={cls("vg-badge", STAGE_TONE[stage])} style={{ marginLeft: 8 }}>
            {STAGE_LABEL[stage] || stage}</span>
        </div>
        <span className="vg-note">{(s.universe || []).join(" · ")}</span>
      </div>

      <GateRow gate={s.gate} />

      {stage === "live" && (
        <div className="vg-sl-live">
          <div className="vg-sl-stats">
            <StatTile label="Account" value={s.live_account || "—"} />
            <StatTile label="Max $/order" value={s.caps?.max_order_usd ? usd(s.caps.max_order_usd) : "—"} />
            <StatTile label="Max positions" value={s.caps?.max_positions ?? "—"} />
            <StatTile label="Daily max-loss" value={s.caps?.max_daily_loss_usd ? usd(s.caps.max_daily_loss_usd) : "—"} />
          </div>
          {!armed && <p className="vg-note warn">Live stage, but autonomous is NOT armed — orders record as dry-run only.</p>}
          <button className="vg-btn sm" disabled={busy}
            onClick={() => act(() => pauseStrategy(s.strategy_id, { reason: "operator" }))}>Pause</button>
        </div>)}

      {stage === "paused" && (
        <div className="vg-sl-live">
          {s.paused_reason && <p className="vg-note warn">Paused: {s.paused_reason}</p>}
          <button className="vg-btn sm" disabled={busy}
            onClick={() => act(() => resumeStrategy(s.strategy_id))}>Resume</button>
        </div>)}

      {stage === "eligible" && <PromoteForm sid={s.strategy_id} onDone={onChange} />}

      {stage === "paper" && (
        <p className="vg-note vg-sl-gatewhy">In paper validation — it becomes promotable when the
          gate passes (paper win-rate beats the frozen backtest baseline over the min sample).</p>)}

      <AuditTrail sid={s.strategy_id} />
    </div>);
}

export function LifecycleBoard() {
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const q = useLive(() => getLifecycle(), null, [nonce]);
  const d = q.data;
  const strategies = (d && d.strategies) || [];
  const gates = (d && d.gates) || {};
  const [ticking, setTicking] = useState(false);
  const runTick = () => {
    setTicking(true);
    lifecycleTick(false).then(() => { setTicking(false); refresh(); })
      .catch(() => setTicking(false));
  };

  return (
    <div className="vg-sl">
      <div className="vg-sl-topbar">
        <h2 className="vg-sl-h2" style={{ fontSize: 16 }}>Promotion pipeline</h2>
        <span className="vg-note">Paper → gate → promote → autonomous · one lifecycle</span>
        <button className="vg-btn sm vg-btn-primary" style={{ marginLeft: "auto" }} onClick={runTick} disabled={ticking}>
          {ticking ? "Running…" : "Run driver pass (dry-run)"}
        </button>
      </div>

      {/* the arm banner — the difference between dry-run and real money. */}
      {d && (
        <div className={cls("vg-sl-arm", gates.armed ? "live" : "safe")}>
          {gates.armed
            ? <><b>⚡ AUTONOMOUS LIVE ARMED</b> — promoted strategies place REAL orders within their caps.</>
            : <><b>Dry-run (safe)</b> — autonomous is not armed; orders record what they'd do but reach no broker.</>}
          <span className="vg-note" style={{ marginLeft: "auto" }}>
            VANTAGE_LIVE_OK {gates.live_env ? "✓" : "✗"} · VANTAGE_AUTONOMOUS_OK {gates.autonomous_env ? "✓" : "✗"}
            · kill switch {gates.kill_switch ? "ENGAGED" : "clear"}
          </span>
        </div>)}

      {q.loading && <LoadBar />}
      {d && d.available === false && (
        <p className="vg-note" style={{ padding: 14 }}>{d.note || "The strategy lifecycle needs the SQLite backend."}</p>)}
      {strategies.length > 0 && (
        <div className="vg-sl-grid">
          {strategies.map((s) => (
            <StrategyCard key={s.strategy_id} s={s} armed={!!gates.armed} onChange={refresh} />
          ))}
        </div>)}
    </div>);
}
