// Trade Analytics view — round-trip scorecard, defensible edges/leaks, the full
// condition table (with small-n honesty), and the recent closed round-trips.
//
// Real-data-only surface: there is NO fixture for the ML journal. useLive(..,
// null, ..) means the view renders its "run the trade-analysis build" empty
// state until /api/ml/roundtrips + /api/ml/trade_stats return a built payload.
// HONESTY is the UX: only buckets the engine marked `significant` are shown as
// edges; everything else is visually muted with an "n too small" note so the
// user never reads noise as signal.
import { cls, usd, signUsd, signPct, fmtDate, underlyingOf, StatTile } from "./util.jsx";
import { useLive, getRoundtrips, getTradeStats, getDayPnl } from "./live.js";
import { FuturesView } from "./futures.jsx";

const { useMemo } = React;

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const pct1 = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));

// ── CI bar ───────────────────────────────────────────────────────────────────
// Renders a [ci_low .. ci_high] credible interval on a 0..100% track, with the
// baseline marked. Edge (interval right of baseline) = green; leak = red.
function CiBar({ ciLow, ciHigh, winRate, baseline, kind }) {
  if (ciLow == null || ciHigh == null) return null;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const lo = clamp(ciLow) * 100;
  const hi = clamp(ciHigh) * 100;
  const wr = winRate == null ? null : clamp(winRate) * 100;
  const base = baseline == null ? null : clamp(baseline) * 100;
  const color = kind === "leak" ? "var(--vg-danger)" : "var(--vg-success-deep)";
  return (
    <div style={{ marginTop: 8 }}>
      <div
        role="img"
        aria-label={`Credible interval ${pct1(ciLow)} to ${pct1(ciHigh)}, baseline ${pct1(baseline)}`}
        style={{ position: "relative", height: 14, background: "var(--color-light)", borderRadius: 999 }}
      >
        <div style={{
          position: "absolute", left: `${lo}%`, width: `${Math.max(hi - lo, 1.5)}%`,
          top: 3, height: 8, borderRadius: 999, background: color, opacity: 0.85,
        }} />
        {wr != null && (
          <div style={{
            position: "absolute", left: `${wr}%`, top: 1, width: 2, height: 12,
            background: color, transform: "translateX(-1px)",
          }} />
        )}
        {base != null && (
          <div title={`baseline ${pct1(baseline)}`} style={{
            position: "absolute", left: `${base}%`, top: 0, width: 2, height: 14,
            background: "var(--color-grey)", transform: "translateX(-1px)",
          }} />
        )}
      </div>
      <div className="vg-note" style={{ marginTop: 4, fontSize: 12 }}>
        CI {pct1(ciLow)}–{pct1(ciHigh)} · baseline {pct1(baseline)}
      </div>
    </div>
  );
}

// ── scorecard ──────────────────────────────────────────────────────────────
function Scorecard({ summary }) {
  const s = summary || {};
  const pf = s.profit_factor;
  return (
    <div className="vg-stats">
      <StatTile label="Win rate" value={pct1(s.win_rate)} note={`${s.wins ?? 0}W / ${s.losses ?? 0}L`} />
      <StatTile label="Profit factor" value={num(pf)}
        delta={pf == null ? null : pf >= 1 ? "profitable" : "below breakeven"}
        deltaDir={pf != null && pf >= 1 ? "up" : "down"} />
      <StatTile label="Avg hold"
        value={s.avg_holding_days == null ? "—" : `${num(s.avg_holding_days, 1)}d`} />
      <StatTile label="Avg MFE capture" value={pct(s.avg_mfe_capture)}
        note="share of peak move captured" />
      <StatTile label="Closed trades" value={s.count ?? 0}
        note={s.entry_unknown ? `${s.entry_unknown} est. entry` : null} />
    </div>
  );
}

// ── notable edges/leaks (SIGNIFICANT only) ───────────────────────────────────
function NotableCards({ notable, baseline }) {
  const significant = (notable || []).filter((b) => b.significant === true);
  if (significant.length === 0) {
    return (
      <div className="vg-card" style={{ marginTop: 8 }}>
        <div className="vg-kicker">No defensible edges yet</div>
        <p className="vg-note" style={{ margin: "6px 0 0", maxWidth: 620 }}>
          No condition's win-rate separates from your {pct1(baseline)} baseline with enough trades
          to be credible. Differences seen so far are within noise for the current sample — more
          closed round-trips are needed before a real edge or leak can be claimed.
        </p>
      </div>
    );
  }
  return (
    <div className="vg-cardgrid" style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 14, marginTop: 8,
    }}>
      {significant.map((b) => (
        <div key={`${b.dimension}:${b.value}`} className="vg-card">
          <div className="vg-spread">
            <strong style={{ fontSize: 14 }}>{b.value}</strong>
            <span className={cls("vg-badge", b.kind === "leak" ? "bad" : "good")}>
              {b.kind === "leak" ? "▼ leak" : "▲ edge"}
            </span>
          </div>
          <div className="vg-note" style={{ marginTop: 2 }}>{b.dimension.replace(/_/g, " ")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700 }}>{pct1(b.win_rate)}</span>
            <span className={cls("vg-note", b.kind === "leak" ? "down" : "up")}>
              {signPct((b.win_rate - (baseline || 0)) * 100)} vs baseline
            </span>
          </div>
          <div className="vg-note">n = {b.n} trades</div>
          <CiBar ciLow={b.ci_low} ciHigh={b.ci_high} winRate={b.win_rate}
            baseline={baseline} kind={b.kind} />
        </div>
      ))}
    </div>
  );
}

// ── condition table (all buckets; small-n muted) ─────────────────────────────
function ConditionTable({ buckets, baseline }) {
  const rows = (buckets || []).filter((b) => b.dimension !== "__baseline__");
  if (rows.length === 0) return null;
  return (
    <div className="vg-card vg-tablewrap" style={{ marginTop: 8, padding: "8px 12px" }}>
      <table className="vg-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", fontSize: 13, color: "var(--color-grey)" }}>
            <th style={{ padding: "10px 12px" }}>Condition</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>n</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>Win rate</th>
            <th style={{ padding: "10px 12px" }}>Credible interval (90%)</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>Avg P/L</th>
            <th style={{ padding: "10px 12px" }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const thin = b.n < 3; // engine's min_n for defensibility
            return (
              <tr key={`${b.dimension}:${b.value}`} style={{ opacity: thin ? 0.5 : 1 }}>
                <td style={{ padding: "9px 12px" }}>
                  <b>{b.value}</b>
                  <span className="vg-note" style={{ marginLeft: 6 }}>{b.dimension.replace(/_/g, " ")}</span>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }} className="num">{b.n}</td>
                <td style={{ padding: "9px 12px", textAlign: "right" }} className="num">{pct1(b.win_rate)}</td>
                <td style={{ padding: "9px 12px", minWidth: 180 }}>
                  <CiBar ciLow={b.ci_low} ciHigh={b.ci_high} winRate={b.win_rate} baseline={baseline} />
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }} className="num">{b.avg_pnl == null ? "—" : signUsd(b.avg_pnl)}</td>
                <td style={{ padding: "9px 12px" }}>
                  {thin
                    ? <span className="vg-badge plain" title="Too few trades to be statistically defensible">n too small</span>
                    : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── round-trips table ────────────────────────────────────────────────────────
function RoundtripsTable({ roundtrips, setSymbol, go }) {
  const rows = useMemo(() => {
    const rs = [...(roundtrips || [])];
    rs.sort((a, b) => String(b.close_date || "").localeCompare(String(a.close_date || "")));
    return rs.slice(0, 50);
  }, [roundtrips]);
  if (rows.length === 0) return null;
  const jump = (sym) => { if (setSymbol && go) { const u = underlyingOf(sym); setSymbol(u); go("ic", u); } };
  return (
    <div className="vg-card vg-tablewrap" style={{ marginTop: 8, padding: "8px 12px" }}>
      <table className="vg-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", fontSize: 13, color: "var(--color-grey)" }}>
            <th style={{ padding: "10px 12px" }}>Symbol</th>
            <th style={{ padding: "10px 12px" }}>Kind</th>
            <th style={{ padding: "10px 12px" }}>Open → Close</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>Held</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>Realized $</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>%</th>
            <th style={{ padding: "10px 12px" }}>Result</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>MFE capture</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.symbol}:${r.close_date}:${i}`} className={setSymbol ? "click" : ""}
              onClick={setSymbol ? () => jump(r.symbol) : undefined}
              style={setSymbol ? { cursor: "pointer" } : undefined}>
              <td style={{ padding: "9px 12px" }}><b>{r.symbol}</b>{r.entry_unknown ? <span className="vg-note" style={{ marginLeft: 6 }}>est.</span> : null}</td>
              <td style={{ padding: "9px 12px" }}><span className="vg-chip">{r.kind}</span></td>
              <td style={{ padding: "9px 12px" }} className="vg-note">{fmtDate(r.open_date)} → {fmtDate(r.close_date)}</td>
              <td style={{ padding: "9px 12px", textAlign: "right" }} className="num">{r.holding_days}d</td>
              <td style={{ padding: "9px 12px", textAlign: "right" }} className={cls("num", r.realized_pnl >= 0 ? "up" : "down")}>{signUsd(r.realized_pnl)}</td>
              <td style={{ padding: "9px 12px", textAlign: "right" }} className={cls("num", r.realized_pct >= 0 ? "up" : "down")}>{signPct(r.realized_pct)}</td>
              <td style={{ padding: "9px 12px" }}>
                <span className={cls("vg-badge", r.win ? "good" : "bad")}>{r.win ? "✓ Win" : "✕ Loss"}</span>
              </td>
              <td style={{ padding: "9px 12px", textAlign: "right" }} className="num">{pct(r.mfe_capture)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── view ─────────────────────────────────────────────────────────────────────
// Track record — ONE surface for "how am I actually doing", split by book:
//   Day trades — the 0DTE decisions (journal); daily P&L strip + link to the
//                windowed WR/PF + SWOT that already live in Journal → Analysis.
//   Swings     — multi-day equity/option round-trips from brokerage history,
//                with the credible-interval edge engine (the old "Performance").
//   Futures    — the imported futures record (FuturesView, unchanged).
// Tabs are hash-routed (#/trades/swings, #/trades/futures).
const TR_TABS = [
  { key: "day", label: "Day trades" },
  { key: "swings", label: "Swings" },
  { key: "futures", label: "Futures" },
];

function DayTradesTab({ go }) {
  // last 30 sessions from the (now realized-correct) day-pnl endpoint — cheap.
  const days = [];
  for (let i = 0; i < 44; i++) {          // 44 calendar days ≈ 30 sessions
    const d = new Date(Date.now() - i * 864e5);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10));
  }
  const q = useLive(() => getDayPnl(days.slice(0, 30)), null, []);
  const pnl = (q.data && q.data.available && q.data.pnl) || {};
  const rows = Object.entries(pnl).filter(([, v]) => v.has_fills)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const total = rows.reduce((s, [, v]) => s + (v.realized || 0), 0);
  const green = rows.filter(([, v]) => (v.realized || 0) > 0).length;
  return (
    <div>
      <div className="vg-stats" style={{ margin: "12px 0" }}>
        <StatTile label="Net (last 30 sessions)" value={usd(total)}
          tone={total >= 0 ? "good" : "bad"} note={`${rows.length} trading days`} />
        <StatTile label="Green days" value={`${green} / ${rows.length}`} />
        <StatTile label="Best day" value={usd(Math.max(0, ...rows.map(([, v]) => v.realized || 0)))} />
        <StatTile label="Worst day" value={usd(Math.min(0, ...rows.map(([, v]) => v.realized || 0)))} tone="bad" />
      </div>
      <div className="vg-card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.map(([d, v]) => (
          <div key={d} className="vg-tr-dayrow">
            <span className="vg-note">{d}</span>
            <span className="vg-note">{v.trades} decisions</span>
            <b className={v.realized >= 0 ? "vg-up" : "vg-down"} style={{ marginLeft: "auto" }}>{usd(v.realized)}</b>
          </div>
        ))}
      </div>
      <p className="vg-note" style={{ marginTop: 10 }}>
        Full windowed win-rate / profit-factor, the pattern census, and the SWOT
        live in <a className="vg-linkbtn" href="#/journal/analysis">Journal → Analysis</a> —
        per-trade desk reviews in <a className="vg-linkbtn" href="#/journal">the Journal</a>.
      </p>
    </div>
  );
}

export function TradeAnalyticsView({ accountId, settings, setSymbol, go, tab = "day", onTab }) {
  return (
    <div>
      <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>Track record</h2>
        <div className="vg-row" style={{ gap: 4 }}>
          {TR_TABS.map((t) => (
            <button key={t.key} className={cls("vg-seg-btn", tab === t.key && "on")}
              onClick={() => onTab && onTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === "day" && <DayTradesTab go={go} />}
      {tab === "futures" && <FuturesView />}
      {tab === "swings" && <SwingsTab accountId={accountId} settings={settings} setSymbol={setSymbol} go={go} />}
    </div>
  );
}

function SwingsTab({ accountId, settings, setSymbol, go }) {
  const rt = useLive(() => getRoundtrips(accountId), null, [accountId, settings]).data;
  const ts = useLive(() => getTradeStats(accountId), null, [accountId, settings]).data;

  const summary = rt && rt.summary;
  const hasTrades = summary && summary.count > 0;
  const asOf = (rt && rt.roundtrips_as_of) || (ts && ts.trade_stats_as_of) || null;
  const baseline = ts && ts.baseline_win_rate;

  return (
    <div>
      <div className="vg-spread">
        <div>
          <p className="vg-sub" style={{ marginTop: 8 }}>
            Swing round-trips — multi-day equity/option positions reconstructed from
            brokerage history, with statistically-defensible edges
            {asOf ? ` · as of ${asOf}` : ""} · educational only, not advice
          </p>
        </div>
      </div>

      {!hasTrades ? (
        <div className="vg-card" style={{ marginTop: 8 }}>
          <div className="vg-kicker">No trade analysis available</div>
          <p className="vg-note" style={{ margin: "6px 0 0", maxWidth: 620 }}>
            The round-trip journal and condition stats haven't been built yet, or the backend is
            unreachable. Run the trade-analysis build (it also runs nightly), then confirm the
            backend URL in Settings.
          </p>
          <pre style={{
            background: "var(--color-light)", border: "1px solid var(--color-border)", borderRadius: 8,
            padding: "10px 12px", margin: "10px 0 0", fontSize: 13, lineHeight: 1.5, overflowX: "auto",
          }}>
            <code>{"cd server\n.venv/bin/python -m vantage_server.ml.build_roundtrips --account rh-margin --broker-account <N>\n.venv/bin/python -m vantage_server.ml.build_features --account rh-margin --from-roundtrips"}</code>
          </pre>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12 }}><Scorecard summary={summary} /></div>

          <div className="vg-kicker" style={{ marginTop: 20 }}>Defensible edges & leaks</div>
          <p className="vg-note" style={{ margin: "2px 0 0", maxWidth: 620 }}>
            Only conditions whose 90% credible interval clears your {pct1(baseline)} baseline with
            enough trades to matter. Anything thinner is held back below.
          </p>
          <NotableCards notable={ts && ts.notable} baseline={baseline} />

          <div className="vg-kicker" style={{ marginTop: 20 }}>All conditions</div>
          <p className="vg-note" style={{ margin: "2px 0 0", maxWidth: 620 }}>
            Every entry condition by win-rate and credible interval. Rows with too few trades to be
            defensible are muted and marked “n too small” — don't read them as signal.
          </p>
          <ConditionTable buckets={ts && ts.buckets} baseline={baseline} />

          <div className="vg-kicker" style={{ marginTop: 20 }}>Recent round-trips</div>
          <RoundtripsTable roundtrips={rt && rt.roundtrips} setSymbol={setSymbol} go={go} />
        </>
      )}
    </div>
  );
}
