// ScannerView — the ONE strategies surface, laid out as the pipeline:
//   strategy families → today's scanned setups → the paper record of executing
//   them → the promotion gate to real money (ADR-015 lifecycle).
// The old standalone #/strategies page merged in here (IA streamline): its
// LifecycleBoard renders as the promotion section, the scanner-spread paper
// book renders as the record section, and the reclaim paper book (playbook
// tickets) rides along collapsed.
import { cls, dirCls, LoadBar } from "./util.jsx";
import { useLive, getScanner, refreshScanner, addScannerTicker, removeScannerTicker, getSpreadBook } from "./live.js";
import { ScannerSpreadBook, PaperView } from "./paper.jsx";
import { LifecycleBoard } from "./strategies_view.jsx";
import { TelegramSignalsCard } from "./telegram_card.jsx";

const { useState, useEffect } = React;

// one entry per strategy family (mirror server SCANNERS; labels carry the
// validated read so the picker doubles as the strategy legend)
const SCANNERS = [
  { id: "ict_htf", label: "A+ ICT hourly setup" },
  { id: "breakout_hold", label: "Breakout hold — 3 closes above a pivot cluster (long)" },
  { id: "rsi2_mr", label: "RSI(2) dip in uptrend — time/MA exit (long)" },
];

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
function SignalCard({ h, onOpen, inPaper }) {
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
        {inPaper && <span className="vg-badge info" style={{ marginLeft: "auto" }}
          title="a paper spread is open for this setup — see the Paper tab">→ in paper</span>}
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
                  {runner && h.runner_is_pool ? "draw" : `${t.r ?? "?"}R`}
                </span>
                <span className="vg-scan-rung-px">{t.price}</span>
                <span className="vg-scan-rung-sz">{t.size != null ? `${Math.round(t.size * 100)}%` : ""}</span>
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
function TierGroup({ label, hits, onOpen, paperSyms }) {
  const longs = hits.filter((h) => h.dir === "long");
  const shorts = hits.filter((h) => h.dir !== "long");
  const side = (name, list) => list.length > 0 && (
    <div className="vg-scan-side">
      <div className="vg-scan-sidehd">{name} · {list.length}</div>
      <div className="vg-scan-grid">
        {list.map((h) => <SignalCard key={h.symbol} h={h} onOpen={onOpen}
          inPaper={paperSyms && paperSyms.has(h.symbol)} />)}
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

// Stale setups (aged past 'current'), each with how it resolved — target hit,
// invalidated, or still open. A track record, not a live signal; compact rows.
function HistoryTable({ rows, onOpen }) {
  const tone = (o) => (o === "target" ? "good" : o === "invalidated" ? "bad" : "plain");
  const lbl = (o) => (o === "target" ? "✓ target" : o === "invalidated" ? "✕ invalid" : "· open");
  // filters — a scan history is unreadable as an unfiltered wall of chips.
  const [fq, setFq] = useState("");          // ticker search
  const [fTier, setFTier] = useState("all"); // all | A+ | B
  const [fDir, setFDir] = useState("all");   // all | long | short
  const [fOut, setFOut] = useState("all");   // all | open | target | invalidated
  const [open, setOpen] = useState(null);    // expanded row key
  const shown = rows.filter((h) =>
    (!fq || String(h.symbol || "").toUpperCase().includes(fq.toUpperCase()))
    && (fTier === "all" || h.tier === fTier)
    && (fDir === "all" || h.dir === fDir)
    && (fOut === "all" || (h.outcome || "open") === fOut));
  const zone = (h) => (Array.isArray(h.entry_zone) && h.entry_zone.length === 2
    ? `${h.entry_zone[0]}–${h.entry_zone[1]}` : h.ce ?? "—");
  return (
    <div className="vg-scan-group" style={{ marginTop: 20 }}>
      <div className="vg-scan-grouphead" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="vg-kicker">History · {shown.length}{shown.length !== rows.length ? ` of ${rows.length}` : ""}</span>
        <span className="vg-scan-rationale">setups that aged past current — how they played out</span>
        <span className="vg-row" style={{ gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <input className="vg-scan-filter" value={fq} placeholder="ticker…"
            onChange={(e) => setFq(e.target.value)} aria-label="Filter by ticker" />
          <select className="vg-scan-filter" value={fTier} onChange={(e) => setFTier(e.target.value)}>
            <option value="all">tier: all</option><option value="A+">A+</option><option value="B">B</option>
          </select>
          <select className="vg-scan-filter" value={fDir} onChange={(e) => setFDir(e.target.value)}>
            <option value="all">side: all</option><option value="long">long</option><option value="short">short</option>
          </select>
          <select className="vg-scan-filter" value={fOut} onChange={(e) => setFOut(e.target.value)}>
            <option value="all">outcome: all</option><option value="open">open</option>
            <option value="target">target</option><option value="invalidated">invalidated</option>
          </select>
        </span>
      </div>
      <div className="vg-scan-histlist">
        {shown.map((h) => {
          const key = `${h.symbol}|${h.as_of}`;
          const expanded = open === key;
          return (
            <div key={key} className={cls("vg-scan-histrow", expanded && "open")}>
              <div className="vg-scan-histhead" onClick={() => setOpen(expanded ? null : key)}
                title={expanded ? "collapse" : "show full setup"}>
                <span className="vg-scan-sym" style={{ fontSize: 14, cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); onOpen && onOpen(h.symbol); }}
                  title={`open ${h.symbol} chart`}>{h.symbol}</span>
                <b className={cls("vg-scan-dir", dirCls(h.dir === "long" ? 1 : -1))}>
                  {h.tier} {h.dir === "long" ? "LONG" : "SHORT"}</b>
                <span className="vg-note vg-scan-histdetail">
                  entry {zone(h)} · stop {h.invalid ?? "—"}
                  {Array.isArray(h.targets) && h.targets.length
                    ? ` · runner ${h.targets[h.targets.length - 1].price}` : ""}
                </span>
                <span className="vg-note" style={{ fontSize: "var(--vg-text-xs)" }}>{h.bars_ago}h ago</span>
                <span className={cls("vg-badge", tone(h.outcome))} style={{ fontSize: "var(--vg-text-xs)" }}>
                  {lbl(h.outcome)}</span>
                <span className="vg-note">{expanded ? "▾" : "▸"}</span>
              </div>
              {expanded && (
                <div className="vg-scan-histbody">
                  <div className="vg-note" style={{ marginBottom: 4 }}>
                    triggered {h.hour || String(h.as_of || "").slice(11, 16)} ·
                    {" "}{h.ob_backed ? "OB-backed" : "no OB"} ·
                    {" "}{h.runner_is_pool ? "runner = liquidity pool" : "runner = fixed R"}
                  </div>
                  {(h.targets || []).map((t, i) => (
                    <div key={i} className="vg-scan-histtgt">
                      <span className="vg-note">T{i + 1} · {t.r}R</span>
                      <b>{t.price}</b>
                      <span className="vg-note">{Math.round((t.size || 0) * 100)}%{t.note ? ` · ${t.note}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && <div className="vg-note" style={{ padding: 12 }}>no setups match the filters</div>}
      </div>
    </div>);
}

export function ScannerView({ onOpenSymbol, tab, onTab }) {
  const active = tab === "paper" || tab === "performance" ? tab : "scan";
  const [scanner, setScanner] = useState("ict_htf");
  const [nonce, setNonce] = useState(0);
  const [note, setNote] = useState(null);
  const [entry, setEntry] = useState("");
  const [symFilter, setSymFilter] = useState("");

  // open paper spreads → the "→ in paper" badge on scan cards (client join)
  const bookQ = useLive(() => getSpreadBook(), null, [nonce]);
  const paperSyms = new Set(((bookQ.data && bookQ.data.open) || [])
    .map((r) => r.underlying || r.symbol).filter(Boolean));

  const q = useLive(() => getScanner(scanner), null, [scanner, nonce]);
  const d = q.data && q.data.available ? q.data : null;
  const running = d && d.status === "running";
  const prog = (d && d.progress) || null;
  const allHits = (d && d.hits) || [];
  const hits = symFilter
    ? allHits.filter((h) => h.symbol.includes(symFilter.trim().toUpperCase()))
    : allHits;
  const aplus = hits.filter((h) => h.tier === "A+");
  const bs = hits.filter((h) => h.tier !== "A+");
  const history = (d && d.history) || [];
  const manual = (d && d.manual_tickers) || [];
  // data staleness: the last stored bar vs now. If the data is behind the live
  // market (weekend / pre-market), say so — the setups are "as of" that bar.
  const dataThrough = d && d.data_through;
  const staleHrs = dataThrough ? (Date.now() - new Date(dataThrough).getTime()) / 3.6e6 : 0;
  const isStaleData = staleHrs > 20;   // ~ beyond an overnight gap

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
          <div className="vg-row" style={{ gap: 10, alignItems: "baseline" }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>Strategies</h2>
            <div className="vg-row" style={{ gap: 4 }}>
              {[["scan", "Scan"], ["paper", "Paper"], ["performance", "Performance"]].map(([k, l]) => (
                <button key={k} className={cls("vg-seg-btn", active === k && "on")}
                  onClick={() => onTab && onTab(k)}>{l}</button>
              ))}
            </div>
          </div>
          <p className="vg-sub" style={{ margin: "4px 0 0" }}>
            {active === "scan" && "Backtest-validated setups scanned across the Nasdaq-100 + S&P top-100 · long A+ setups auto-open a paper spread (shorts are display-only — H11)."}
            {active === "paper" && "Open paper positions from the scans — the live sample the promotion gate judges."}
            {active === "performance" && "The record per strategy, and the gate to real money."}
          </p>
        </div>
      </div>

      {active === "scan" && <>
      {/* universe status strip */}
      <div className="vg-card vg-scan-strip" style={{ padding: 12, marginBottom: 12 }}>
        <select value={scanner} onChange={(e) => setScanner(e.target.value)}
          aria-label="scanner type" className="vg-fc-syminput" style={{ width: "auto" }}>
          {SCANNERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <input className="vg-fc-syminput" value={symFilter} spellCheck={false}
          onChange={(e) => setSymFilter(e.target.value.toUpperCase())}
          placeholder="filter symbol" aria-label="filter setups by symbol" style={{ width: 110 }} />
        {running ? (
          <span className="vg-note">
            {prog ? `${prog.phase}… ${prog.done}/${prog.total}` : "scanning…"}
          </span>
        ) : d ? (
          <span className="vg-note">
            covered <b>{d.covered_n}</b>/<b>{d.universe_n}</b> · {aplus.length} A+ · {bs.length} B ·
            last run {ago(d.ran_at)}
            {isStaleData && dataThrough && (
              <span className="vg-scan-stale"> · ⚠ data through {hhmm(dataThrough)} {String(dataThrough).slice(5, 10)} (market closed — setups as of then)</span>
            )}
          </span>
        ) : <span className="vg-note">no scan yet — run a refresh to seed data + scan</span>}
        <button className="vg-btn-sm vg-btn-primary" disabled={running} onClick={() => refresh(false)}
          style={{ marginLeft: "auto" }}>
          {running ? <><span className="vg-spin" aria-hidden="true">⟳</span> Scanning… ({pct}%)</> : "⟳ Refresh scan"}
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
      {aplus.length > 0 && <TierGroup label="A+ setups" hits={aplus} onOpen={onOpenSymbol} paperSyms={paperSyms} />}
      {bs.length > 0 && <TierGroup label="B setups" hits={bs} onOpen={onOpenSymbol} paperSyms={paperSyms} />}

      {d && hits.length === 0 && (
        <div className="vg-card" style={{ padding: 18 }}>
          <p className="vg-note" style={{ margin: 0 }}>
            No CURRENT hourly setups across {d.covered_n} covered tickers. A+ is a
            high-conviction, deliberately rare tier — a quiet scan is normal.
            {history.length > 0 && " Recently-played-out setups are in history below."}
          </p>
        </div>)}

      {/* history — setups that aged past 'current' (played out), with outcome.
          Keeps the live grid current while showing what happened. */}
      {history.length > 0 && <HistoryTable rows={history} onOpen={onOpenSymbol} />}

      {/* honest coverage tail */}
      {d && (d.no_data || []).length > 0 && (
        <p className="vg-note" style={{ marginTop: 12, fontSize: 12, color: "var(--vg-dim)" }}>
          no data ({d.no_data.length}): {d.no_data.join(", ")} — hourly bars not fetched yet; refresh to seed.
        </p>)}
      <p className="vg-note" style={{ marginTop: 8, fontSize: 12, color: "var(--vg-dim)" }}>
        Hourly setups (validated timeframe) · a heads-up to drop to a lower timeframe for entry · not advice.
      </p>
      </>}

      {active === "paper" && <>
        <ScannerSpreadBook refreshNonce={nonce} alwaysShow section="open" />
        <TelegramSignalsCard refreshNonce={nonce} />
        {/* the reclaim paper book — playbook-ticket fills, the other paper feeder */}
        <details className="vg-card" style={{ marginTop: 12 }}>
          <summary className="vg-kicker" style={{ cursor: "pointer" }}>
            Reclaim paper book (playbook tickets)</summary>
          <PaperView refreshNonce={nonce} />
        </details>
      </>}

      {active === "performance" && <>
        <ScannerSpreadBook refreshNonce={nonce} alwaysShow section="performance" />
        <div style={{ marginTop: 16 }}>
          <LifecycleBoard />
        </div>
      </>}
    </div>
  );
}
