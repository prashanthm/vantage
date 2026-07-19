// Managed Exits — the exit monitor's book (ADR-010 v3).
//
// One job: show every position the execution carve-out opened and what the
// monitor is doing about it — the resting protective stop (the invariant),
// the trailing high-water/ratchet state or the T1 target it will swap to,
// and the close-out history. Actions: run one monitor pass now (tick) and
// disarm (release a row from management; its broker-side stop is LEFT
// RESTING — disarm never removes protection).
//
// The continuous loop is `python -m vantage_server.execution_monitor`; this
// view is the operator's window onto the same state, not a replacement.
import { getExits, exitsTick, disarmExit } from "./live.js";
import { PositionsTable } from "./positions_table.jsx";
import { cls } from "./util.jsx";

const { useEffect, useState } = React;

const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));

const STATUS_TONE = {
  pending_entry: "warn",
  active: "good",
  closed: "",
  disarmed: "warn",
};

export function ExitsView({ refreshNonce }) {
  const [data, setData] = useState({ positions: [], broker: [], live_gate: false });
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState(null);   // last tick's action log
  const [note, setNote] = useState(null);

  const load = async () => setData(await getExits(undefined, { mergeBroker: true }));
  useEffect(() => { load(); }, [refreshNonce]);
  // While anything is open the monitor state moves — keep the view honest.
  useEffect(() => {
    const open = data.positions.some((p) => p.status === "active" || p.status === "pending_entry");
    if (!open) return undefined;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [data.positions.map((p) => p.status).join(",")]);

  const tick = async () => {
    setBusy(true); setNote(null);
    const v = await exitsTick();
    setBusy(false);
    if (!v || !v.available) { setNote((v && v.note) || "tick failed"); return; }
    setActions(v.actions || []);
    load();
  };

  const disarm = async (id) => {
    setNote(null);
    const v = await disarmExit(id);
    if (!v || !v.available) setNote((v && v.note) || `disarm ${id} failed`);
    load();
  };

  const open = data.positions.filter((p) => p.status === "active" || p.status === "pending_entry");
  const done = data.positions.filter((p) => p.status !== "active" && p.status !== "pending_entry");

  return (
    <div className="vg-pane-body">
      <div className="vg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>Managed Exits</h2>
        <div className="vg-row" style={{ gap: 8, alignItems: "center" }}>
          <span className={cls("vg-badge", data.live_gate ? "good" : "warn")}
            title="server env VANTAGE_LIVE_OK — without it the monitor observes but never places/cancels">
            {data.live_gate ? "live gate ON" : "live gate off — observe only"}
          </span>
          <button className="vg-btn-sm" onClick={tick} disabled={busy}>
            {busy ? "Ticking…" : "Run monitor pass"}
          </button>
        </div>
      </div>
      <p className="vg-note" style={{ marginTop: 2, fontSize: 12 }}>
        Positions opened by the execute path (ADR-010 v2), managed exits-only by the
        monitor (v3): the protective stop always rests at the broker; the monitor
        swaps it to the T1 target (ladder) or ratchets it on new extremes (trailing).
        Run <code>python -m vantage_server.execution_monitor</code> continuously while
        anything here is open.
      </p>
      {note && <p className="vg-note" style={{ color: "#c0392b" }}>{note}</p>}

      <BrokerBook rows={data.broker || []} />

      <h3 className="vg-kicker" style={{ marginTop: 14 }}>Under management ({open.length})</h3>
      {open.length === 0
        ? <p className="vg-note">Nothing under management.</p>
        : <ExitTable rows={open} onDisarm={disarm} />}

      {actions && (
        <>
          <h3 className="vg-kicker" style={{ marginTop: 14 }}>Last pass ({actions.length} action{actions.length === 1 ? "" : "s"})</h3>
          {actions.length === 0
            ? <p className="vg-note">No actions — everything already in shape.</p>
            : <ul className="vg-note" style={{ margin: "4px 0 0 16px", fontSize: 12 }}>
                {actions.map((a, i) => (
                  <li key={i}>#{a.position} <b>{a.action}</b>
                    {Object.entries(a).filter(([k]) => !["position", "action", "live"].includes(k))
                      .map(([k, v]) => ` · ${k}=${JSON.stringify(v)}`).join("")}</li>
                ))}
              </ul>}
        </>
      )}

      <h3 className="vg-kicker" style={{ marginTop: 14 }}>History ({done.length})</h3>
      {done.length === 0
        ? <p className="vg-note">No closed managed positions yet.</p>
        : <ExitTable rows={done} history />}
    </div>
  );
}

// The BROKER's book — what you actually hold, whether or not the bot opened
// it. The `managed` flag is the point: an unmanaged position has no monitor
// stop resting behind it.
function BrokerBook({ rows }) {
  const held = rows.filter((p) => (p.shares || 0) !== 0);
  if (!held.length) return null;
  return (
    <>
      <h3 className="vg-kicker" style={{ marginTop: 14 }}>
        Broker book ({held.length}) · what you actually hold
      </h3>
      <PositionsTable rows={held} dayPl warn={{
        text: (n) => `${n.length} position${n.length === 1 ? "" : "s"} with no monitor stop — `
          + "the exit monitor only protects what the execute path opened.",
      }} />
    </>
  );
}

function ExitTable({ rows, onDisarm, history }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="vg-table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th>#</th><th>opened</th><th>symbol</th><th>side</th><th>qty</th>
            <th>entry</th><th>stop</th><th>policy</th>
            <th>{history ? "exit" : "high-water"}</th>
            <th>status</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td title={p.opened_at}>{String(p.opened_at || "").slice(0, 10)}</td>
              <td><b>{p.symbol}</b></td>
              <td>{p.side}</td>
              <td>{fmt(p.qty, 0)}</td>
              <td>{fmt(p.entry_price)}</td>
              <td>
                {p.stop_price == null && p.status === "active"
                  ? (p.exit_policy === "ladder" && p.stop_order_id
                      ? <span title="stop swapped for the target sell">→ T1 {fmt(p.target_price)}</span>
                      : <span className="vg-badge warn" title="no resting stop — next pass re-arms">re-arming</span>)
                  : fmt(p.stop_price)}
                {p.exit_policy === "ladder" && p.target_price != null && p.stop_price != null &&
                  <span className="vg-note"> → {fmt(p.target_price)}</span>}
              </td>
              <td title={p.exit_policy === "trailing" ? "stop ratchets by the initial stop distance" : "monitor swaps stop → T1 when it trades"}>
                {p.exit_policy}
              </td>
              <td>
                {history
                  ? <>{fmt(p.exit_price)}{p.exit_reason ? <span className="vg-note"> · {p.exit_reason}</span> : null}</>
                  : fmt(p.high_water)}
              </td>
              <td><span className={cls("vg-badge", STATUS_TONE[p.status])}>{p.status}</span></td>
              <td>
                {!history && onDisarm && (
                  <button className="vg-linkbtn" title="release from management (stop keeps resting)"
                    onClick={() => onDisarm(p.id)}>disarm</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
