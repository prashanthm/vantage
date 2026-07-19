// ScannerView — the ICT setup scanner across a universe (top-10 holdings of
// SPY/QQQ/IWM). Shows a universe status strip (coverage + freshness + refresh) and
// ranked signal cards (A+ first). The A+ hourly setup is the first scanner type;
// the selector is ready for more. Click a card → opens that ticker's chart.
import { cls, dirCls, LoadBar } from "./util.jsx";
import { useLive, getScanner, refreshScanner, addScannerTicker, removeScannerTicker } from "./live.js";

const { useState, useEffect } = React;

const SCANNERS = [{ id: "ict_htf", label: "A+ ICT hourly setup" }];

// "3h ago" from an ISO ran_at.
function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : "");

// one ranked signal card. The setup rationale (h.reason) is identical across all
// hits of a tier — it names the SETUP TYPE, not the ticker — so it's hoisted into
// one caption above the grid, and the card shows only what varies: direction (as a
// colored edge), symbol, the entry→invalid numbers, freshness, and OB-backing.
function SignalCard({ h, onOpen }) {
  const long = h.dir === "long";
  const dir = long ? 1 : -1;
  const z = Array.isArray(h.entry_zone) ? h.entry_zone : null;
  return (
    <button className={cls("vg-scan-card", long ? "long" : "short")}
      onClick={() => onOpen && onOpen(h.symbol)}
      title={`open ${h.symbol} chart`}>
      <div className="vg-scan-cardhead">
        <span className="vg-scan-sym">{h.symbol}</span>
        <b className={cls("vg-scan-dir", dirCls(dir))}>{long ? "LONG" : "SHORT"}</b>
        {h.ob_backed && <span className="vg-scan-ob" title="order-block backed">OB</span>}
      </div>
      <div className="vg-scan-nums">
        <div className="vg-scan-num">
          <span className="vg-scan-numlbl">entry</span>
          <span className="vg-scan-numval">{z ? `${z[0]}–${z[1]}` : (h.ce ?? "—")}</span>
        </div>
        <div className="vg-scan-num">
          <span className="vg-scan-numlbl">invalid</span>
          <span className="vg-scan-numval down">{h.invalid ?? "—"}</span>
        </div>
      </div>
      {Array.isArray(h.targets) && h.targets.length > 0 && (
        <div className="vg-scan-ladder">
          {h.targets.map((t, i) => {
            const runner = i === h.targets.length - 1;
            return (
              <div key={i} className="vg-scan-rung">
                <span className="vg-scan-rung-r">
                  {runner ? (h.runner_is_pool ? "draw" : "3R") : `${t.r}R`}
                </span>
                <span className="vg-scan-rung-px">{t.price}</span>
                <span className="vg-scan-rung-sz">{Math.round(t.size * 100)}%</span>
              </div>);
          })}
        </div>
      )}
      <div className="vg-scan-foot vg-note">
        @ {hhmm(h.as_of)}{h.bars_ago != null ? ` · ${h.bars_ago}h ago` : ""}
      </div>
    </button>
  );
}

// A tier's hits, split into LONG and SHORT sub-blocks. The setup rationale is
// captioned once for the tier (identical across its hits); each side is its own
// labeled column so direction is read from structure, not a per-card marker.
function TierGroup({ label, hits, onOpen }) {
  const longs = hits.filter((h) => h.dir === "long");
  const shorts = hits.filter((h) => h.dir !== "long");
  const side = (name, list) => list.length > 0 && (
    <div className="vg-scan-side">
      <div className="vg-scan-sidehd">{name} · {list.length}</div>
      <div className="vg-scan-grid">
        {list.map((h) => <SignalCard key={h.symbol} h={h} onOpen={onOpen} />)}
      </div>
    </div>);
  return (
    <div className="vg-scan-group">
      <div className="vg-scan-grouphead">
        <span className="vg-kicker">{label} · {hits.length}</span>
        {hits[0].reason && <span className="vg-scan-rationale">{hits[0].reason}</span>}
      </div>
      <div className="vg-scan-sides">
        {side("Long", longs)}
        {side("Short", shorts)}
      </div>
    </div>);
}

export function ScannerView({ onOpenSymbol }) {
  const [scanner, setScanner] = useState("ict_htf");
  const [nonce, setNonce] = useState(0);
  const [note, setNote] = useState(null);
  const [entry, setEntry] = useState("");

  const q = useLive(() => getScanner(scanner), null, [scanner, nonce]);
  const d = q.data && q.data.available ? q.data : null;
  const running = d && d.status === "running";
  const prog = (d && d.progress) || null;
  const hits = (d && d.hits) || [];
  const aplus = hits.filter((h) => h.tier === "A+");
  const bs = hits.filter((h) => h.tier !== "A+");
  const manual = (d && d.manual_tickers) || [];

  // while a background scan runs, poll the status every 3s until it completes.
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNonce((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, [running]);

  const refresh = (refreshUniverse = false) => {
    setNote(null);
    refreshScanner(scanner, refreshUniverse)
      .then((r) => {
        if (r && r.status === "already_running") setNote("a scan is already running…");
        setNonce((n) => n + 1);
      })
      .catch((e) => setNote(String((e && e.message) || e)));
  };

  const addTicker = () => {
    const s = entry.trim().toUpperCase();
    if (!s) return;
    setEntry("");
    addScannerTicker(s).then(() => setNonce((n) => n + 1)).catch((e) => setNote(String((e && e.message) || e)));
  };
  const removeTicker = (s) =>
    removeScannerTicker(s).then(() => setNonce((n) => n + 1)).catch(() => {});

  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <div className="vg-loadhost">
      {(q.loading || running) && <LoadBar />}

      <div className="vg-spread" style={{ marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>🔭 Scanner</h2>
          <p className="vg-sub" style={{ margin: "4px 0 0" }}>
            Backtest-validated ICT hourly setups across the Nasdaq-100 + S&P top-100 (by weight).
          </p>
        </div>
      </div>

      {/* universe status strip */}
      <div className="vg-card vg-scan-strip" style={{ padding: 12, marginBottom: 12 }}>
        <select value={scanner} onChange={(e) => setScanner(e.target.value)}
          aria-label="scanner type" className="vg-fc-syminput" style={{ width: "auto" }}>
          {SCANNERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {running ? (
          <span className="vg-note">
            {prog ? `${prog.phase}… ${prog.done}/${prog.total}` : "scanning…"}
          </span>
        ) : d ? (
          <span className="vg-note">
            covered <b>{d.covered_n}</b>/<b>{d.universe_n}</b> · {aplus.length} A+ · {bs.length} B ·
            last run {ago(d.ran_at)}
          </span>
        ) : <span className="vg-note">no scan yet — run a refresh to seed data + scan</span>}
        <button className="vg-btn-sm" disabled={running} onClick={() => refresh(false)}
          style={{ marginLeft: "auto" }}>
          {running ? <><span className="vg-spin" aria-hidden="true">⟳</span> Scanning… ({pct}%)</> : "↻ Refresh scan"}
        </button>
      </div>
      {running && <div className="vg-fc-progress" style={{ marginBottom: 12 }}>
        <div className="vg-fc-progress-bar" style={{ width: `${pct}%` }} /></div>}

      {/* manual ticker box */}
      <div className="vg-card vg-scan-manual" style={{ padding: 12, marginBottom: 12 }}>
        <span className="vg-note" style={{ fontWeight: 600 }}>Watch tickers</span>
        <form style={{ display: "inline-flex", gap: 6 }}
          onSubmit={(e) => { e.preventDefault(); addTicker(); }}>
          <input className="vg-fc-syminput" value={entry} spellCheck={false}
            onChange={(e) => setEntry(e.target.value.toUpperCase())}
            placeholder="add ticker" aria-label="add scanner ticker" style={{ width: 110 }} />
          <button className="vg-btn-sm" type="submit">＋ add</button>
        </form>
        {manual.length > 0 && (
          <div className="vg-scan-chips">
            {manual.map((s) => (
              <span key={s} className="vg-scan-chip">{s}
                <button className="vg-scan-chip-x" title="remove" onClick={() => removeTicker(s)}>✕</button>
              </span>))}
          </div>)}
        {manual.length === 0 && <span className="vg-note">none — add ad-hoc names to always scan them.</span>}
      </div>
      {note && <p className="vg-note" style={{ color: "var(--vg-down)", marginBottom: 10 }}>{note}</p>}

      {/* ranked signal cards — shared rationale captioned once per tier, then the
          hits split into LONG / SHORT sub-blocks so direction is structural. */}
      {aplus.length > 0 && <TierGroup label="A+ setups" hits={aplus} onOpen={onOpenSymbol} />}
      {bs.length > 0 && <TierGroup label="B setups" hits={bs} onOpen={onOpenSymbol} />}

      {d && hits.length === 0 && (
        <div className="vg-card" style={{ padding: 18 }}>
          <p className="vg-note" style={{ margin: 0 }}>
            No hourly setups right now across {d.covered_n} covered tickers. A+ is a
            high-conviction, deliberately rare tier — a quiet scan is normal.
          </p>
        </div>)}

      {/* honest coverage tail */}
      {d && (d.no_data || []).length > 0 && (
        <p className="vg-note" style={{ marginTop: 12, fontSize: 11, color: "var(--vg-dim)" }}>
          no data ({d.no_data.length}): {d.no_data.join(", ")} — hourly bars not fetched yet; refresh to seed.
        </p>)}
      <p className="vg-note" style={{ marginTop: 8, fontSize: 11, color: "var(--vg-dim)" }}>
        Hourly ICT setups (validated timeframe) · a heads-up to drop to a lower timeframe for entry · not advice.
      </p>
    </div>
  );
}
