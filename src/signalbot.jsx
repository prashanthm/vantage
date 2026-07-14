// Signal Bot — configuration + tracking + the signal↔live correlation.
//
// One job: the operator's window onto the reclaim signal bot. Configure the
// Telegram wiring (stored in the backend's meta table; container env wins
// when set), see what is armed and what has fired, and read the correlation
// table: every bot signal beside its PAPER outcome (the strategy's honest
// track record) and, when the operator took it live, the LIVE outcome from
// the managed-exits book. The continuous loop is
// `python -m vantage_server.signal_bot`; "Poll now" drives one pass.
import { getBotStatus, saveBotConfig, botPoll, getBotPerformance, getNightlyStatus } from "./live.js";
import { cls } from "./util.jsx";

const { useEffect, useState } = React;

const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));
const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(2)}`);

export function SignalBotView({ refreshNonce }) {
  const [status, setStatus] = useState(null);
  const [perf, setPerf] = useState(null);
  const [nightly, setNightly] = useState(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(null);

  const load = async () => {
    const [s, p, n] = await Promise.all([
      getBotStatus(), getBotPerformance(), getNightlyStatus(10)]);
    setStatus(s && s.available !== false ? s : null);
    setPerf(p && p.available !== false ? p : null);
    setNightly(n && n.available && n.runs ? n.runs : []);
  };
  useEffect(() => { load(); }, [refreshNonce]);

  const poll = async () => {
    setBusy("poll"); setNote(null);
    const v = await botPoll();
    setBusy("");
    if (!v || !v.available) { setNote((v && v.note) || "poll failed"); return; }
    setNote(`pass done — ${v.events.length} event(s)`
            + (v.events.length ? `: ${v.events.map((e) => e.kind).join(", ")}` : ""));
    load();
  };

  if (status === null) {
    return (
      <div className="vg-pane-body">
        <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Signal Bot</h2>
        <p className="vg-note">Signal bot needs the SQLite backend (and a reachable backend URL in Settings).</p>
      </div>
    );
  }

  const s = perf && perf.summary;
  return (
    <div className="vg-pane-body">
      <div className="vg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>Signal Bot
          <span className="vg-note" style={{ fontSize: 12, fontWeight: 400 }}> · reclaim strategy → Telegram</span>
        </h2>
        <div className="vg-row" style={{ gap: 8, alignItems: "center" }}>
          <span className={cls("vg-badge", status.telegram ? "good" : "warn")}>
            {status.telegram ? `telegram on (${status.telegram_source})` : "telegram off — log-only"}
          </span>
          <span className={cls("vg-badge", status.market_open ? "good" : "plain")}>
            {status.market_open ? "market open" : "market closed"}
          </span>
          <button className="vg-btn-sm" onClick={poll} disabled={busy === "poll"}>
            {busy === "poll" ? "Polling…" : "Poll now"}
          </button>
        </div>
      </div>
      <p className="vg-note" style={{ marginTop: 2, fontSize: 12 }}>
        Signals = the paper pipeline's reclaim tickets (armed pending → 3×5m reclaim
        confirms → target/stop). Every signal is tracked in Paper Trading (source
        "auto"); live executions land in Managed Exits. Keep
        <code> python -m vantage_server.signal_bot</code> running for continuous pushes.
      </p>
      {note && <p className="vg-note">{note}</p>}

      <ConfigCard status={status} onSaved={load} />

      {s && (
        <div className="vg-row" style={{ gap: 18, marginTop: 14, flexWrap: "wrap", fontSize: 13 }}>
          <span><b>{s.signals}</b> signals</span>
          <span>paper: <b>{s.paper_closed}</b> closed · WR <b>{s.paper_win_rate == null ? "—" : `${Math.round(s.paper_win_rate * 100)}%`}</b> · P&L <b>{money(s.paper_pnl)}</b></span>
          <span>live: <b>{s.live_taken}</b> taken · <b>{s.live_closed}</b> closed · P&L <b>{money(s.live_pnl)}</b></span>
        </div>
      )}

      <h3 className="vg-kicker" style={{ marginTop: 14 }}>
        Armed levels ({(status.armed || []).length}) · live signals ({(status.live_signals || []).length})
      </h3>
      {(status.armed || []).length === 0 && (status.live_signals || []).length === 0
        ? <p className="vg-note">Nothing armed — the bot arms each underlying's playbook levels at the next pass.</p>
        : (
          <table className="vg-table" style={{ fontSize: 13 }}>
            <thead><tr><th>paper #</th><th>state</th><th>side</th><th>symbol</th>
              <th>level</th><th>entry</th><th>stop</th><th>target</th><th>session</th></tr></thead>
            <tbody>
              {[...(status.live_signals || []), ...(status.armed || [])].map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td><span className={cls("vg-badge", t.fill_status === "filled" ? "good" : "info")}>
                    {t.fill_status === "filled" ? "🔔 confirmed" : "armed"}</span></td>
                  <td>{t.side}</td><td><b>{t.symbol}</b></td>
                  <td>{fmt(t.spy_level)}</td>
                  <td>{t.fill_status === "filled" ? fmt(t.spy_entry) : "—"}</td>
                  <td>{fmt(t.spy_stop)}</td><td>{fmt(t.spy_target)}</td>
                  <td className="vg-note">{t.session || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <NightlyCard runs={nightly || []} />

      <h3 className="vg-kicker" style={{ marginTop: 16 }}>Signal ↔ live correlation</h3>
      {!perf || perf.rows.length === 0
        ? <p className="vg-note">No signals recorded yet.</p>
        : (
          <div style={{ overflowX: "auto" }}>
            <table className="vg-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>#</th><th>session</th><th>signal</th>
                  <th colSpan={3} style={{ borderLeft: "1px solid var(--vg-border, #333)" }}>paper</th>
                  <th colSpan={4} style={{ borderLeft: "1px solid var(--vg-border, #333)" }}>live</th>
                </tr>
                <tr className="vg-note">
                  <th /><th /><th />
                  <th style={{ borderLeft: "1px solid var(--vg-border, #333)" }}>outcome</th><th>exit</th><th>P&L</th>
                  <th style={{ borderLeft: "1px solid var(--vg-border, #333)" }}>taken</th><th>entry→exit</th><th>P&L</th><th>match</th>
                </tr>
              </thead>
              <tbody>
                {perf.rows.map((r) => {
                  const sg = r.signal, lv = r.live;
                  return (
                    <tr key={sg.paper_id}>
                      <td>{sg.paper_id}</td>
                      <td className="vg-note">{sg.session || "—"}</td>
                      <td>{sg.side} <b>{sg.symbol}</b> @ {fmt(sg.level)}</td>
                      <td style={{ borderLeft: "1px solid var(--vg-border, #333)" }}>
                        {sg.status === "open"
                          ? (sg.fill_status === "filled" ? "open (filled)" : "armed")
                          : sg.exit_reason}
                      </td>
                      <td>{fmt(sg.exit)}</td>
                      <td>{sg.status === "closed" && sg.exit_reason !== "never_filled"
                        ? `${money(sg.pnl)} (${money(sg.pnl_pct)}%)` : "—"}</td>
                      <td style={{ borderLeft: "1px solid var(--vg-border, #333)" }}>
                        {lv ? `#${lv.managed_id} · ${lv.exit_policy}` : "—"}</td>
                      <td>{lv ? `${fmt(lv.entry_price)} → ${lv.exit_price != null ? fmt(lv.exit_price) : lv.status}` : ""}</td>
                      <td>{lv ? money(lv.pnl) : ""}</td>
                      <td>{lv && (lv.linked
                        ? <span className="vg-badge good" title="explicit signal_paper_id link">exact</span>
                        : <span className="vg-badge info" title="matched by symbol+side+date">≈</span>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

const _dur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`);

function NightlyCard({ runs }) {
  if (!runs.length) {
    return (
      <>
        <h3 className="vg-kicker" style={{ marginTop: 16 }}>Nightly runs</h3>
        <p className="vg-note">No pipeline snapshot recorded yet — the first one lands after the next 17:45 ET run (or run <code>./nightly-docker.sh</code> now).</p>
      </>
    );
  }
  return (
    <>
      <h3 className="vg-kicker" style={{ marginTop: 16 }}>Nightly runs</h3>
      {runs.map((run, i) => <NightlyRun key={run.id || i} run={run} />)}
    </>
  );
}

function NightlyRun({ run }) {
  const [open, setOpen] = useState(false);
  const jobs = run.jobs || [];
  const bad = jobs.filter((j) => !j.ok);
  const total = jobs.reduce((a, j) => a + (j.duration_sec || 0), 0);
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", border: "1px solid var(--vg-border, #333)", borderRadius: 8 }}>
      <div className="vg-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="vg-note" style={{ fontSize: 12, minWidth: 120 }}>
          {String(run.started_at || "").slice(0, 16).replace("T", " ")}
        </span>
        <span className={cls("vg-badge", bad.length ? "bad" : "good")}>
          {jobs.length - bad.length}✓ {bad.length}✗ · {_dur(total)}
        </span>
        <span className="vg-note" style={{ fontSize: 11 }}>{run.variant}</span>
        <button className="vg-linkbtn" onClick={() => setOpen(!open)}>
          {open ? "hide jobs" : "show jobs"}
        </button>
      </div>
      {/* failures always visible — that's the point of the snapshot */}
      {!open && bad.map((j, i) => (
        <p key={i} className="vg-note" style={{ margin: "6px 0 0", fontSize: 12 }}>
          ✗ <b>{j.job}</b> ({_dur(j.duration_sec || 0)}) — <code>{(j.tail || "").split("\n").slice(-1)[0]}</code>
        </p>
      ))}
      {open && (
        <table className="vg-table" style={{ marginTop: 8, fontSize: 12 }}>
          <thead><tr><th /><th>job</th><th>duration</th><th>last output</th></tr></thead>
          <tbody>
            {jobs.map((j, i) => (
              <tr key={i}>
                <td>{j.ok ? "✓" : "✗"}</td>
                <td>{j.job}</td>
                <td>{_dur(j.duration_sec || 0)}</td>
                <td className="vg-note" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={j.tail || ""}>{(j.tail || "").split("\n").slice(-1)[0]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ConfigCard({ status, onSaved }) {
  const [tokenInput, setTokenInput] = useState("");
  const [chatInput, setChatInput] = useState(status.telegram_chat_id || "");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  const save = async (test) => {
    setBusy(test ? "test" : "save"); setMsg(null);
    const body = {};
    if (tokenInput) body.bot_token = tokenInput;
    if (chatInput !== (status.telegram_chat_id || "")) body.chat_id = chatInput;
    if (test) body.test = true;
    const v = await saveBotConfig(body);
    setBusy("");
    if (!v || !v.available) { setMsg((v && v.note) || "save failed"); return; }
    setTokenInput("");
    setMsg(test ? (v.test_sent ? "test message sent ✓" : "saved, but the test send FAILED — check token/chat id")
                : "saved");
    onSaved();
  };

  const envManaged = status.telegram_source === "env";
  return (
    <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--vg-border, #333)", borderRadius: 8, maxWidth: 620 }}>
      <div className="vg-kicker" style={{ margin: "0 0 8px", fontSize: 11 }}>Telegram configuration</div>
      {envManaged && (
        <p className="vg-note" style={{ margin: "0 0 8px", fontSize: 12 }}>
          Managed by container env (TELEGRAM_BOT_TOKEN/CHAT_ID) — env wins; values saved here take over only when the env vars are unset.
        </p>
      )}
      <div className="vg-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="vg-note" style={{ fontSize: 12 }}>
          bot token <input type="password" value={tokenInput} autoComplete="off"
            placeholder={status.telegram_token_tail ? `saved …${status.telegram_token_tail}` : "from @BotFather"}
            style={{ width: 180, marginLeft: 4 }}
            onChange={(e) => setTokenInput(e.target.value.trim())} />
        </label>
        <label className="vg-note" style={{ fontSize: 12 }}>
          chat id <input value={chatInput} placeholder="your DM / group id"
            style={{ width: 110, marginLeft: 4 }}
            onChange={(e) => setChatInput(e.target.value.trim())} />
        </label>
        <button className="vg-btn-sm" disabled={!!busy} onClick={() => save(false)}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button className="vg-btn-sm" disabled={!!busy} onClick={() => save(true)}>
          {busy === "test" ? "Testing…" : "Save & send test"}
        </button>
      </div>
      {msg && <p className="vg-note" style={{ margin: "8px 0 0", fontSize: 12 }}>{msg}</p>}
    </div>
  );
}
