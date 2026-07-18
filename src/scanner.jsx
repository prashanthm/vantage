// ScannerView — the ICT setup scanner across a universe (top-10 holdings of
// SPY/QQQ/IWM). Shows a universe status strip (coverage + freshness + refresh) and
// ranked signal cards (A+ first). The A+ hourly setup is the first scanner type;
// the selector is ready for more. Click a card → opens that ticker's chart.
import { cls, dirCls, LoadBar } from "./util.jsx";
import { useLive, getScanner, refreshScanner } from "./live.js";

const { useState } = React;

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

// one ranked signal card — reuses the playbook HTF banner styling.
function SignalCard({ h, onOpen }) {
  const isAp = h.tier === "A+";
  const dir = h.dir === "long" ? 1 : -1;
  const z = Array.isArray(h.entry_zone) ? h.entry_zone : null;
  return (
    <button className={cls("vg-scan-card", isAp && "vg-scan-card-ap")}
      onClick={() => onOpen && onOpen(h.symbol)}
      title={`open ${h.symbol} chart`}>
      <div className="vg-scan-cardhead">
        <span className="vg-scan-sym">{h.symbol}</span>
        <span className={cls("vg-scan-tier", isAp && "ap")}>{isAp ? "⚡ A+" : "• B"}</span>
        <b className={dirCls(dir)}>{String(h.dir || "").toUpperCase()}</b>
        <span className="vg-scan-age vg-note">setup @ {hhmm(h.as_of)}</span>
      </div>
      <div className="vg-scan-cardmeta">
        {z && <span>entry <b>{z[0]}–{z[1]}</b></span>}
        <span>invalid <b>{h.invalid}</b></span>
        {h.ob_backed && <span className="vg-badge info" style={{ fontSize: 9 }}>OB-backed</span>}
      </div>
      <div className="vg-scan-reason vg-note">{h.reason}</div>
    </button>
  );
}

export function ScannerView({ onOpenSymbol }) {
  const [scanner, setScanner] = useState("ict_htf");
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState(null);

  const q = useLive(() => getScanner(scanner), null, [scanner, nonce]);
  const d = q.data && q.data.available ? q.data : null;
  const hits = (d && d.hits) || [];
  const aplus = hits.filter((h) => h.tier === "A+");
  const bs = hits.filter((h) => h.tier !== "A+");

  const refresh = (refreshUniverse = false) => {
    setRefreshing(true); setNote(null);
    refreshScanner(scanner, refreshUniverse)
      .then((r) => { if (r && !r.available && r.note) setNote(r.note); setNonce((n) => n + 1); })
      .catch((e) => setNote(String((e && e.message) || e)))
      .finally(() => setRefreshing(false));
  };

  return (
    <div className="vg-loadhost">
      {(q.loading || refreshing) && <LoadBar />}

      <div className="vg-spread" style={{ marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>🔭 Scanner</h2>
          <p className="vg-sub" style={{ margin: "4px 0 0" }}>
            Backtest-validated ICT hourly setups across the top holdings of SPY · QQQ · IWM.
          </p>
        </div>
      </div>

      {/* universe status strip */}
      <div className="vg-card vg-scan-strip" style={{ padding: 12, marginBottom: 12 }}>
        <select value={scanner} onChange={(e) => setScanner(e.target.value)}
          aria-label="scanner type" className="vg-fc-syminput" style={{ width: "auto" }}>
          {SCANNERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {d ? (
          <span className="vg-note">
            covered <b>{d.covered_n}</b>/<b>{d.universe_n}</b> · {aplus.length} A+ · {bs.length} B ·
            last run {ago(d.ran_at)}{d.universe_source === "pinned-fallback" ? " · pinned list" : ""}
          </span>
        ) : <span className="vg-note">no scan yet — run a refresh to seed data + scan</span>}
        <button className="vg-btn-sm" disabled={refreshing} onClick={() => refresh(false)}
          style={{ marginLeft: "auto" }}>
          {refreshing ? <><span className="vg-spin" aria-hidden="true">⟳</span> Scanning…</> : "↻ Refresh scan"}
        </button>
        <button className="vg-btn-sm" disabled={refreshing} onClick={() => refresh(true)}
          title="re-pull the ETF top-10 holdings too">↻ universe</button>
      </div>
      {note && <p className="vg-note" style={{ color: "var(--vg-down)", marginBottom: 10 }}>{note}</p>}

      {/* ranked signal cards */}
      {aplus.length > 0 && (
        <>
          <div className="vg-kicker">A+ setups</div>
          <div className="vg-scan-grid">
            {aplus.map((h) => <SignalCard key={h.symbol} h={h} onOpen={onOpenSymbol} />)}
          </div>
        </>)}
      {bs.length > 0 && (
        <>
          <div className="vg-kicker" style={{ marginTop: 14 }}>B setups</div>
          <div className="vg-scan-grid">
            {bs.map((h) => <SignalCard key={h.symbol} h={h} onOpen={onOpenSymbol} />)}
          </div>
        </>)}

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
