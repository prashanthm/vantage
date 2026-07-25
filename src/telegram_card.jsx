// Telegram signals — channels the operator's own account subscribes to,
// pulled by the listener daemon into an inbox; fully-parsed signals auto-open
// paper trades (book "telegram", channel = strategy). This card is the desk
// view: allow-list management, the inbox with parse status, open sim trades,
// and the per-channel record. Paper only (ADR-010) — no execute path here.
import { useLive, getJson } from "./live.js";
import { cls } from "./util.jsx";

const { useState } = React;

const backend = () => (JSON.parse(localStorage.getItem("vantage-settings") || "{}").backendUrl
  || "http://127.0.0.1:8641").replace(/\/+$/, "");
const usd = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}`);
const STATUS_CHIP = {
  traded: ["good", "TRADED"], inbox: ["plain", "inbox"],
  "skipped-open": ["warn", "skipped · open"], duplicate: ["plain", "dup"],
};

export function TelegramSignalsCard({ refreshNonce }) {
  const [nonce, setNonce] = useState(0);
  const [entry, setEntry] = useState("");
  const q = useLive(() => getJson(`${backend()}/api/telegram`), null, [refreshNonce, nonce]);
  const d = q.data && q.data.available ? q.data : null;
  const add = async (e) => {
    e.preventDefault();
    const name = entry.trim();
    if (!name) return;
    setEntry("");
    await fetch(`${backend()}/api/telegram/channels`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: name }) }).catch(() => {});
    setNonce((n) => n + 1);
  };
  const drop = async (name) => {
    await fetch(`${backend()}/api/telegram/channels/${encodeURIComponent(name)}`,
      { method: "DELETE" }).catch(() => {});
    setNonce((n) => n + 1);
  };
  const inbox = (d && d.inbox) || [];
  const book = (d && d.book) || {};
  const open = book.open || [];
  const byChannel = book.by_channel || {};
  return (
    <div className="vg-card" style={{ marginTop: 12 }}>
      <div className="vg-spread" style={{ alignItems: "baseline" }}>
        <div className="vg-kicker" style={{ marginBottom: 0 }}>Telegram signals</div>
        <span className="vg-note" style={{ fontSize: 12 }}>
          your subscribed channels → inbox → auto paper trades · channel = strategy
          {d && !d.session && <> · <b>no session</b> — run the one-time login (listener docstring)</>}
        </span>
      </div>

      {/* allow-list */}
      <div className="vg-row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        {((d && d.channels) || []).map((c) => (
          <span key={c} className="vg-scan-chip">@{c}
            <button className="vg-scan-chip-x" title="remove" onClick={() => drop(c)}>✕</button>
          </span>
        ))}
        <form style={{ display: "inline-flex", gap: 6 }} onSubmit={add}>
          <input className="vg-fc-syminput" value={entry} spellCheck={false}
            onChange={(e) => setEntry(e.target.value)} placeholder="add @channel"
            aria-label="allow-list a telegram channel" style={{ width: 140 }} />
          <button className="vg-btn-sm" type="submit">＋ add</button>
        </form>
        <span className="vg-note" style={{ fontSize: 12 }}>restart the listener after edits</span>
      </div>

      {/* open sim trades */}
      {open.length > 0 && (
        <div className="vg-pb-ladder" style={{ marginTop: 10 }}>
          {open.map((r) => (
            <div key={r.id} className="vg-pb-lvl">
              <span className={cls("vg-badge", r.side === "long" ? "good" : "bad")}
                style={{ minWidth: 44, textAlign: "center" }}>{r.side === "long" ? "LONG" : "SHORT"}</span>
              <span style={{ fontSize: 14 }}>{r.symbol} ×{r.shares} @ {r.spy_entry}</span>
              <span className="vg-badge plain" style={{ fontSize: 12 }}>@{r.setup}</span>
              <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>
                target {r.spy_target} · stop {r.spy_stop} · sim
              </span>
            </div>
          ))}
        </div>
      )}

      {/* per-channel record — which channels are actually worth following */}
      {Object.keys(byChannel).length > 0 && (
        <table className="vg-mini" style={{ marginTop: 10, width: "100%" }}><tbody>
          {Object.entries(byChannel).map(([name, s]) => (
            <tr key={name}>
              <td style={{ fontSize: 12 }}>@{name}</td>
              <td className="vg-note" style={{ fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {s.open || 0} open{s.n ? ` · ${Math.round((s.win_rate || 0) * 100)}% over ${s.n}` : " · no closes yet"}
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {s.n ? <b className={s.total_pnl >= 0 ? "vg-up" : "vg-down"} style={{ fontSize: 12 }}>{usd(s.total_pnl)}</b>
                     : <span className="vg-note" style={{ fontSize: 12 }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody></table>
      )}

      {/* inbox */}
      {inbox.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="vg-kicker" style={{ cursor: "pointer", fontSize: 12 }}>
            Inbox · {inbox.length} recent</summary>
          {inbox.map((m, i) => {
            const [tone, label] = STATUS_CHIP[m.status] || ["plain", m.status];
            return (
              <div key={i} className="vg-row" style={{ gap: 8, marginTop: 6, alignItems: "baseline" }}>
                <span className={cls("vg-badge", tone)} style={{ fontSize: 11, flexShrink: 0 }}>{label}</span>
                <span className="vg-note" style={{ fontSize: 12, flexShrink: 0 }}>@{m.channel}</span>
                <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={m.text}>{m.text}</span>
              </div>
            );
          })}
        </details>
      )}
      {d && !inbox.length && (
        <p className="vg-note" style={{ margin: "8px 0 0", fontSize: 13 }}>
          No messages yet. Allow-list a channel, then start the listener:
          <code style={{ marginLeft: 4 }}>docker compose --profile telegram up -d</code>
        </p>
      )}
      <p className="vg-note" style={{ margin: "10px 0 0", fontSize: 12, opacity: 0.75 }}>
        Only fully-specified signals trade (side + ticker + entry + stop + target, coherent
        levels) · ${"1,000"} notional sim per signal · no real orders (ADR-010).
      </p>
    </div>
  );
}
