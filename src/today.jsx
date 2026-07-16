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
import { TicketModal, PineModal } from "./playbook.jsx";
import { getBotStatus, getBotPerformance, getNightlyStatus, getPlaybook,
         getTradeablePositions, recomputePlaybook, getPlaybookPine,
         getReclaimPine, getCoachPine } from "./live.js";
import { cls, StatTile } from "./util.jsx";
import { SpxForecastPanel } from "./spx_forecast.jsx";

const { useEffect, useState } = React;

const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));
const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Number(v)).toFixed(0)}`);

export function TodayView({ refreshNonce }) {
  const [status, setStatus] = useState(null);
  const [perf, setPerf] = useState(null);
  const [nightly, setNightly] = useState(null);
  const [pb, setPb] = useState(null);
  const [pos, setPos] = useState(null);
  const [ticket, setTicket] = useState(null);   // {sym, spot, seed, signalId}

  const load = async () => {
    const [s, p, n, b, q] = await Promise.all([
      getBotStatus(), getBotPerformance(), getNightlyStatus(1), getPlaybook(null),
      getTradeablePositions(),
    ]);
    setStatus(s && s.available !== false ? s : null);
    setPerf(p && p.available !== false ? p : null);
    setNightly(n && n.available && n.runs && n.runs.length ? n.runs[0] : null);
    setPb(b && b.available ? b : null);
    setPos(q && q.positions ? q.positions : []);
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
          seed: { level: t.spy_level, entry: t.spy_entry,
                  role: t.side === "long" ? "support" : "resistance" },
          signalId: t.id,
        })} />

      <PositionsCard rows={pos} />

      <WhyCard pb={pb} onReload={load} />

      <SpxForecastPanel symbol="SPX" />

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

// -------------------------------------------------------------- 2. positions

// What am I actually IN right now? Broker truth (not just what the bot
// opened), flagged with whether the exit monitor is protecting it — an
// UNPROTECTED position is the one thing here that should make you look twice.
function PositionsCard({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-kicker">Positions · flat</div>
        <p className="vg-note" style={{ marginTop: 6 }}>
          No SPY/QQQ/IWM position open — nothing at risk right now.
        </p>
      </div>
    );
  }
  const naked = rows.filter((p) => !p.managed);
  return (
    <div className={cls("vg-card", naked.length && "vg-card-alarm")} style={{ marginTop: 14 }}>
      <div className="vg-spread">
        <div className="vg-kicker" style={{ marginBottom: 0 }}>
          Positions · {rows.length} open
        </div>
        <a className="vg-linkbtn" href="#exits">full book →</a>
      </div>
      <table className="vg-table" style={{ marginTop: 10, fontSize: 13 }}>
        <thead>
          <tr><th>symbol</th><th>shares</th><th>cost</th><th>value</th>
            <th>unrealized</th><th>protection</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.symbol}>
              <td><b>{p.symbol}</b></td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.shares, 0)}</td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.cost)}</td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.value)}</td>
              <td className={p.unrealized >= 0 ? "vg-up" : "vg-down"}
                style={{ fontVariantNumeric: "tabular-nums" }}>{money(p.unrealized)}</td>
              <td>
                {p.managed
                  ? <span className="vg-badge good">stop {fmt(p.stop_price)}</span>
                  : <span className="vg-badge bad">unprotected</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {naked.length > 0 && (
        <p className="vg-verdict">
          ⚠️ {naked.map((p) => p.symbol).join(", ")} {naked.length === 1 ? "has" : "have"} no
          monitor stop — the exit monitor is not protecting {naked.length === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- 3. why

function WhyCard({ pb, onReload }) {
  const [busy, setBusy] = useState(false);      // regenerate in flight
  const [pine, setPine] = useState(null);       // {loading|script|error} for the modal
  const [pineTitle, setPineTitle] = useState("TradingView Pine");
  const [note, setNote] = useState(null);       // transient "regenerated" confirmation
  if (!pb) return null;
  const sc = pb.scaffold || {};
  const reg = sc.regime || {};
  const sym = sc.symbol || "SPX";
  const levels = (sc.confluence || []).slice(0, 6);
  // the GEX anchors off the ladder — the dealer-gamma levels, shown explicitly
  const gex = (sc.level_ladder || [])
    .filter((r) => String(r.source || "").toUpperCase() === "GEX")
    .map((r) => ({ price: r.price, label: String(r.kind || "").replace(/\s*\(.*\)$/, "") }));
  const lede = (pb.narrative || "").split("\n").filter(Boolean)[0] || null;

  // Regenerate the levels NOW (recompute → store), then re-pull the Today read
  // so the fresh scaffold shows. All in the UI — no files, no navigation.
  const regenerate = async () => {
    setBusy(true); setNote(null);
    try {
      await recomputePlaybook(undefined, sym);   // writes the store (fresh GEX)
      if (onReload) await onReload();             // re-pull with the new scaffold
      setNote("levels regenerated");
    } catch (e) {
      setNote("regenerate failed");
    } finally {
      setBusy(false);
    }
  };
  // Pine (playbook or reclaim) rendered on demand from the fresh scaffold, as
  // text in a copy modal — never written to disk.
  const showPine = async (kind) => {
    setPineTitle(kind === "reclaim" ? "Reclaim Strategy Pine"
      : kind === "coach" ? "Coach Pine (live discipline)" : "Playbook Pine");
    setPine({ loading: true });
    const res = kind === "reclaim" ? await getReclaimPine(undefined, sym)
      : kind === "coach" ? await getCoachPine(undefined, sym)
      : await getPlaybookPine(undefined, sym);
    setPine(res && res.available ? { script: res.script } : { error: true });
  };

  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread">
        <div className="vg-kicker" style={{ margin: 0 }}>Why · today's read</div>
        <div className="vg-row" style={{ gap: 6 }}>
          <button className="vg-btn-sm" disabled={busy} onClick={regenerate}>
            {busy ? <><span className="vg-spin" aria-hidden="true">⟳</span> Regenerating…</>
                  : "↻ Regenerate levels"}
          </button>
          <button className="vg-btn-sm" disabled={busy} onClick={() => showPine("playbook")}>Pine</button>
          <button className="vg-btn-sm" disabled={busy} onClick={() => showPine("reclaim")}>Reclaim Pine</button>
          <button className="vg-btn-sm" disabled={busy} onClick={() => showPine("coach")}
            title="Live discipline coach — WAIT/ENTER/EXIT/HOLD/WARN with your GEX levels baked in">🎯 Coach Pine</button>
        </div>
      </div>
      {note && <p className="vg-note" style={{ margin: "4px 0 0", fontSize: 11,
        color: note.includes("fail") ? "var(--vg-down)" : "var(--vg-up)" }}>✓ {note}</p>}
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
      {gex.length > 0 && (
        <div className="vg-row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {gex.map((g, i) => (
            <span key={i} className="vg-badge plain" title={g.label}>
              {g.label}: <b>{fmt(g.price, 0)}</b>
            </span>
          ))}
        </div>
      )}
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
      {pine && <PineModal pine={pine} session={pb.session} title={pineTitle}
        symbol={sym} onClose={() => setPine(null)} />}
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
