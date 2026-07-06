// AI Charts view — a real TradingView Lightweight Charts candlestick chart fed
// by the Vantage backend (/api/bars + /api/bars/overlay), with the fixture SVG
// chart kept as a progressive-enhancement fallback.
//
// Live path (window.LightweightCharts present AND /api/bars returns real data):
//   - candlestick + volume histogram from /api/bars
//   - S/R price lines (green/red, width+opacity scaled by strength)
//   - suggested covered-call strike line + cost-basis line + current price
//   - conviction/recommendation badge on the card header
// Fallback path (no Lightweight Charts global, or /api/bars 404s / backend down):
//   - the original seeded-OHLC SVG candlestick chart (SvgChart below), unchanged.
import { TODAY, MARKET, LOTS, AI_INSIGHTS, CHART_PARAMS, CHART_MARKERS, CHART_LEVELS, CHART_RECS } from "./data.js";
import { genOHLC } from "./ohlc.js";
import { usd, signUsd, signPct, cls, dirCls, acctOf, lotValue, lotCost, fmtDate } from "./util.jsx";
import * as live from "./live.js";
import { mapBars, mapBarsOverlay } from "./live.js";

const { useState, useMemo, useRef, useEffect } = React;
const { FAQItem } = window.LookeyDS;

// Live timeframes map 1:1 to the backend's daily|weekly|monthly series.
const TF_LIVE = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];
// Fallback (SVG) timeframes are bar-count windows over the simulated series.
const TIMEFRAMES = [ { key: "1M", bars: 22 }, { key: "3M", bars: 66 }, { key: "6M", bars: 120 } ];
const UP = "#059669", DOWN = "#dc2626";
const STRIKE_COLOR = "#7c3aed", COST_COLOR = "#932cfa", PRICE_COLOR = "#0f172a";
const MAX_LEVELS_PER_SIDE = 6; // cap the S/R ladder drawn so strength scaling reads clearly

const fmtD = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

// True only when the vendored Lightweight Charts UMD actually loaded a usable
// createChart (feature check, per the vendoring plan's placeholder gate).
const hasLW = () => typeof window !== "undefined" && !!(window.LightweightCharts && window.LightweightCharts.createChart);

/* ============================================================= badge helpers */

// conviction.label -> display + color. Backend labels: strong|neutral|weak|freefall.
const CONVICTION = {
  strong:   { text: "STRONG",   fg: "#056645", bg: "#e7f6ef" },
  neutral:  { text: "NEUTRAL",  fg: "#475569", bg: "#eef1f6" },
  weak:     { text: "WEAK",     fg: "#92600a", bg: "#fdf0d9" },
  freefall: { text: "FREEFALL", fg: "#a01818", bg: "#fdeaea" },
};
// recommendation -> human label for the badge.
const REC_LABEL = {
  HOLD_AND_SELL_CALL: "HOLD & SELL CALL",
  CLOSE_AND_BOOK_LOSS: "CLOSE & BOOK LOSS",
  HOLD_WASH_BLOCKED: "HOLD — WASH BLOCKED",
  MONITOR: "MONITOR",
};

function ConvictionBadge({ analysis }) {
  if (!analysis) return null;
  const c = CONVICTION[analysis.conviction.label] || CONVICTION.neutral;
  const rec = REC_LABEL[analysis.recommendation] || analysis.recommendation;
  return (
    <div className="vg-row" style={{ gap: 8, flexWrap: "wrap" }}>
      <span style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 0.3, padding: "3px 10px",
        borderRadius: 999, color: c.fg, background: c.bg,
      }}>{c.text}</span>
      <span style={{
        fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
        color: "#0f172a", background: "#eef1f6", border: "1px solid #dfe4ec",
      }}>{rec}</span>
    </div>
  );
}

// One-line rationale under the badge (the persisted decision's own sentence).
function badgeRationale(analysis) {
  if (!analysis) return null;
  return analysis.rationale || null;
}

/* ============================================================= live candle chart */

// The suggested-strike price line label, e.g. "sell 132.56C ~$444".
function strikeLabel(action) {
  if (!action || action.kind !== "sell_call" || action.suggestedStrike == null) return null;
  const strike = Number(action.suggestedStrike).toFixed(2);
  const credit = action.estCredit != null ? ` ~$${Math.round(action.estCredit)}` : "";
  return `sell ${strike}C${credit}`;
}

// A single support/resistance level -> createPriceLine options. Strength drives
// width (1..4px) and opacity so a strength-5 shelf reads bold and a strength-1
// touch reads faint.
function levelLine(level, isSupport) {
  const strength = Math.max(1, Math.min(5, Number(level.strength) || 1));
  const width = Math.max(1, Math.round(strength / 1.5)); // 1..3
  const base = isSupport ? [5, 150, 105] : [220, 38, 38]; // UP / DOWN rgb
  const opacity = 0.35 + (strength / 5) * 0.5; // 0.45..0.85
  const price = Number(level.price);
  return {
    price,
    color: `rgba(${base[0]},${base[1]},${base[2]},${opacity.toFixed(2)})`,
    lineWidth: width,
    lineStyle: window.LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: `${isSupport ? "S" : "R"} ${price.toFixed(2)}`,
  };
}

function LiveCandleChart({ symbol, setSymbol }) {
  const [tf, setTf] = useState("daily");
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const priceLinesRef = useRef([]);

  // Fetch bars for the active timeframe and the overlay bundle for the symbol.
  const [bars, setBars] = useState(null);
  const [overlay, setOverlay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setNoData(false);
    live.getBars(symbol, tf).then((raw) => {
      if (!alive) return;
      const mapped = mapBars(raw);
      setBars(mapped);
      setLoading(false);
      if (!mapped || !mapped.bars.length) setNoData(true);
    });
    return () => { alive = false; };
  }, [symbol, tf]);

  useEffect(() => {
    let alive = true;
    live.getBarsOverlay(symbol).then((raw) => {
      if (alive) setOverlay(mapBarsOverlay(raw));
    });
    return () => { alive = false; };
  }, [symbol]);

  // Create the chart once per mount; dispose on unmount (Lightweight Charts
  // leaks its canvas + resize listeners otherwise).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasLW()) return undefined;
    const LW = window.LightweightCharts;
    const chart = LW.createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#64748b", fontSize: 11 },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      rightPriceScale: { borderColor: "#e2e8f0" },
      timeScale: { borderColor: "#e2e8f0", timeVisible: false },
      crosshair: { mode: LW.CrosshairMode.Normal },
    });
    const candle = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      borderUpColor: UP, borderDownColor: DOWN,
    });
    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(100,116,139,0.4)",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    return () => {
      chart.remove();
      chartRef.current = candleRef.current = volumeRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // Push bar data into the series whenever bars change.
  useEffect(() => {
    const candle = candleRef.current, volume = volumeRef.current;
    if (!candle || !volume || !bars || !bars.bars.length) return;
    candle.setData(bars.bars.map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    })));
    volume.setData(bars.bars.map((b) => ({
      time: b.time, value: b.volume,
      color: b.close >= b.open ? "rgba(5,150,105,0.35)" : "rgba(220,38,38,0.35)",
    })));
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, [bars]);

  // Redraw all overlay price lines when bars (timeframe) or overlay change.
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    // clear the previous set
    for (const pl of priceLinesRef.current) { try { candle.removePriceLine(pl); } catch (e) { /* series gone */ } }
    priceLinesRef.current = [];
    if (!overlay) return;
    const add = (opts) => { priceLinesRef.current.push(candle.createPriceLine(opts)); };

    // S/R for the active timeframe (bars.levels is the same series' S/R). The
    // backend returns a full ladder (dozens of levels on daily); draw only the
    // strongest few per side so strength-scaling stays legible.
    const levels = (bars && bars.levels) || (overlay.levels && overlay.levels[tf]) || { support: [], resistance: [] };
    const topBy = (arr) => [...(arr || [])].sort((a, b) => (b.strength || 0) - (a.strength || 0)).slice(0, MAX_LEVELS_PER_SIDE);
    topBy(levels.support).forEach((lv) => add(levelLine(lv, true)));
    topBy(levels.resistance).forEach((lv) => add(levelLine(lv, false)));

    // Suggested covered-call strike (accented, distinct).
    const label = strikeLabel(overlay.analysis && overlay.analysis.action);
    if (label && overlay.analysis.action.suggestedStrike != null) {
      add({
        price: Number(overlay.analysis.action.suggestedStrike),
        color: STRIKE_COLOR,
        lineWidth: 2,
        lineStyle: window.LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: label,
      });
    }

    // Cost basis (equity avg cost first, else option avg cost).
    const cb = overlay.costBasis;
    const cost = cb && (cb.equity ? cb.equity.avgCost : cb.options ? cb.options.avgCost : null);
    if (cost != null) {
      add({
        price: Number(cost),
        color: COST_COLOR,
        lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: `cost ${Number(cost).toFixed(2)}`,
      });
    }

    // Current price marker.
    if (overlay.currentPrice != null) {
      add({
        price: Number(overlay.currentPrice),
        color: PRICE_COLOR,
        lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: "price",
      });
    }
  }, [overlay, bars, tf]);

  const analysis = overlay && overlay.analysis;
  const rationale = badgeRationale(analysis);

  return (
    <div>
      <div className="vg-spread" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>AI Charts</h2>
          <p className="vg-sub" style={{ margin: "4px 0 0" }}>
            Live candles from your bars snapshot · S/R, strike &amp; cost overlays · educational only
          </p>
        </div>
        <SymbolPills symbol={symbol} setSymbol={setSymbol} />
      </div>

      <div className="vg-card" style={{ padding: 16 }}>
        <div className="vg-spread" style={{ marginBottom: 8, alignItems: "flex-start" }}>
          <div className="vg-row" style={{ flexWrap: "wrap" }}>
            <strong style={{ fontSize: 17 }}>{symbol}</strong>
            {overlay && overlay.currentPrice != null && <b style={{ fontSize: 16 }}>{usd(overlay.currentPrice, 2)}</b>}
            <ConvictionBadge analysis={analysis} />
          </div>
          <div className="vg-pills">
            {TF_LIVE.map((t) => (
              <button key={t.key} className={cls("vg-pill", tf === t.key && "sel")} onClick={() => setTf(t.key)}>{t.label}</button>
            ))}
          </div>
        </div>

        {rationale && (
          <p className="vg-note" style={{ margin: "0 0 10px", lineHeight: 1.5 }}>{rationale}</p>
        )}

        <div className="vg-chartwrap" style={{ position: "relative" }}>
          <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
          {loading && <div className="vg-note" style={{ position: "absolute", top: 8, left: 8 }}>loading…</div>}
        </div>

        <div className="vg-row" style={{ marginTop: 10, fontSize: 12, color: "var(--color-grey)", flexWrap: "wrap" }}>
          <span><span className="vg-mk-swatch" style={{ background: UP }} /> support (by strength)</span>
          <span><span className="vg-mk-swatch" style={{ background: DOWN }} /> resistance (by strength)</span>
          <span><span className="vg-mk-swatch" style={{ background: STRIKE_COLOR }} /> suggested call strike</span>
          <span><span className="vg-mk-swatch" style={{ background: COST_COLOR }} /> your cost basis</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================= symbol pills */

// Cash-like sleeves the position book carries that have no chart.
const NON_TICKER = new Set(["CASH", "CRYPTO", "FUTURES", "SWEEP"]);
// An option display symbol ("PLTR 2026-10-16 120C") -> its underlying ("PLTR");
// a plain equity symbol passes through. Non-ticker sleeves are dropped upstream.
const underlyingOf = (sym) => String(sym).split(" ")[0].toUpperCase();

// The held UNDERLYINGS (live positions when the backend is up, fixture holdings
// otherwise) — option contract symbols collapse to their underlying, cash-like
// sleeves are dropped — plus the fixture chart symbols, de-duped, order-stable.
function useSymbolChoices() {
  const live_ = live.useLive(() => live.positions().then((p) => live.mapPositions(p)), null, []);
  const rawHeld = (live_.data || []).map((p) => p.symbol);
  const rawFixture = [...new Set(LOTS.map((l) => l.symbol))];
  const normalize = (arr) => {
    const seen = new Set();
    const out = [];
    for (const s of arr) {
      const u = underlyingOf(s);
      if (NON_TICKER.has(u) || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  };
  const source = rawHeld.length ? normalize(rawHeld) : normalize(rawFixture);
  const out = [...source];
  for (const s of Object.keys(CHART_PARAMS)) if (!out.includes(s)) out.push(s);
  return out;
}

function SymbolPills({ symbol, setSymbol }) {
  const choices = useSymbolChoices();
  return (
    <div className="vg-pills">
      {choices.map((s) => (
        <button key={s} className={cls("vg-pill", symbol === s && "sel")} onClick={() => setSymbol(s)}>{s}</button>
      ))}
    </div>
  );
}

/* ============================================================= view entry */

// Decides live vs. fallback. Live requires the Lightweight Charts global AND a
// live bars payload for the symbol; on 404 / backend-down we probe once and
// render the SVG chart so the view is never blank.
export function ChartsView({ symbol, setSymbol }) {
  const [mode, setMode] = useState(hasLW() ? "probing" : "svg");

  useEffect(() => {
    if (!hasLW()) { setMode("svg"); return undefined; }
    let alive = true;
    setMode("probing");
    live.getBars(symbol, "daily").then((raw) => {
      if (!alive) return;
      const mapped = mapBars(raw);
      setMode(mapped && mapped.bars.length ? "live" : "svg");
    });
    return () => { alive = false; };
  }, [symbol]);

  if (mode === "live") return <LiveCandleChart key={symbol} symbol={symbol} setSymbol={setSymbol} />;
  if (mode === "probing") {
    // brief transitional render — keep the header + pills, show a spinner note
    return (
      <div>
        <div className="vg-spread" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19 }}>AI Charts</h2>
            <p className="vg-sub" style={{ margin: "4px 0 0" }}>loading live candles…</p>
          </div>
          <SymbolPills symbol={symbol} setSymbol={setSymbol} />
        </div>
        <div className="vg-card" style={{ padding: 16 }}>
          <div className="vg-chartwrap" />
        </div>
      </div>
    );
  }
  return <SvgChart symbol={symbol} setSymbol={setSymbol} />;
}

/* ============================================================= SVG fallback chart */

// Track an element's rendered size so the SVG viewBox can match it 1:1.
function useSize(ref, fallback) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// The original simulated-OHLC candlestick chart — retained verbatim as the
// progressive-enhancement fallback when Lightweight Charts is absent or the
// backend has no bars for the symbol.
function SvgChart({ symbol, setSymbol }) {
  const [tf, setTf] = useState("3M");
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const size = useSize(wrapRef, { w: 960, h: 450 });

  const params = CHART_PARAMS[symbol] || CHART_PARAMS.SPY;
  const price = (MARKET[symbol] && MARKET[symbol].price) || 100;
  const all = useMemo(
    () => genOHLC(symbol, price, params, TODAY, CHART_MARKERS[symbol] || []),
    [symbol] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const bars = useMemo(() => all.slice(-TIMEFRAMES.find((t) => t.key === tf).bars), [all, tf]);

  const held = LOTS.filter((l) => l.symbol === symbol);
  const heldShares = held.reduce((s, l) => s + l.shares, 0);
  const avgCost = heldShares ? held.reduce((s, l) => s + lotCost(l), 0) / heldShares : null;

  const W = Math.max(320, size.w), VH = 70, PADR = 56, PADT = 10;
  const H = Math.max(240, size.h - VH);
  const plotW = W - PADR, n = bars.length;
  const levels = CHART_LEVELS[symbol];
  let lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
  if (levels) { lo = Math.min(lo, levels.support); hi = Math.max(hi, levels.resistance); }
  if (avgCost != null) { lo = Math.min(lo, avgCost); hi = Math.max(hi, avgCost); }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const y = (p) => PADT + ((hi - p) / (hi - lo)) * (H - PADT - 6);
  const x = (i) => (i + 0.5) * (plotW / n);
  const cw = Math.max(2, (plotW / n) * 0.62);
  const maxV = Math.max(...bars.map((b) => b.v));
  const insight = AI_INSIGHTS[symbol];

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.min(n - 1, Math.max(0, Math.floor(px / (plotW / n))));
    setHover(px <= plotW ? i : null);
  };

  const gridLines = 4;
  const hb = hover != null ? bars[hover] : null;

  return (
    <div>
      <div className="vg-spread" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>AI Charts</h2>
          <p className="vg-sub" style={{ margin: "4px 0 0" }}>
            Simulated candles · AI markers &amp; levels are illustrative · educational only
          </p>
        </div>
        <SymbolPills symbol={symbol} setSymbol={(s) => { setSymbol(s); setHover(null); }} />
      </div>

      <div className="vg-card" style={{ padding: 16 }}>
          <div className="vg-spread" style={{ marginBottom: 8 }}>
            <div className="vg-row">
              <strong style={{ fontSize: 17 }}>{symbol}</strong>
              {MARKET[symbol] && <span className="vg-note">{MARKET[symbol].name}</span>}
              {MARKET[symbol] && <b style={{ fontSize: 16 }}>{usd(MARKET[symbol].price, 2)}</b>}
              {MARKET[symbol] && (
                <span className={dirCls(MARKET[symbol].dayPct)} style={{ color: MARKET[symbol].dayPct >= 0 ? UP : DOWN, fontWeight: 600 }}>
                  {signPct(MARKET[symbol].dayPct)}
                </span>
              )}
              {insight && <span className={cls("vg-bias", insight.bias)} style={{ fontSize: 12 }}>{insight.bias}</span>}
            </div>
            <div className="vg-pills">
              {TIMEFRAMES.map((t) => (
                <button key={t.key} className={cls("vg-pill", tf === t.key && "sel")} onClick={() => { setTf(t.key); setHover(null); }}>{t.key}</button>
              ))}
            </div>
          </div>

          <div ref={wrapRef} className="vg-chartwrap" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H + VH}`} preserveAspectRatio="none" role="img"
              aria-label={`${symbol} candlestick chart, ${tf}`}>
              {Array.from({ length: gridLines + 1 }, (_, g) => {
                const p = lo + ((hi - lo) * g) / gridLines;
                return (
                  <g key={g}>
                    <line x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke="#eef1f6" />
                    <text x={plotW + 8} y={y(p) + 4} fontSize="11" fill="#94a3b8">{p >= 100 ? p.toFixed(0) : p.toFixed(1)}</text>
                  </g>
                );
              })}
              {levels && (
                <g>
                  <line x1={0} x2={plotW} y1={y(levels.resistance)} y2={y(levels.resistance)} stroke={DOWN} strokeDasharray="6 4" strokeOpacity="0.55" />
                  <text x={6} y={y(levels.resistance) - 5} fontSize="10.5" fill={DOWN}>resistance {levels.resistance}</text>
                  <line x1={0} x2={plotW} y1={y(levels.support)} y2={y(levels.support)} stroke={UP} strokeDasharray="6 4" strokeOpacity="0.55" />
                  <text x={6} y={y(levels.support) + 13} fontSize="10.5" fill={UP}>support {levels.support}</text>
                </g>
              )}
              {avgCost != null && (
                <g>
                  <line x1={0} x2={plotW} y1={y(avgCost)} y2={y(avgCost)} stroke="#932cfa" strokeDasharray="2 4" strokeWidth="1.6" />
                  <text x={plotW - 4} y={y(avgCost) - 5} fontSize="10.5" fill="#932cfa" textAnchor="end">
                    your avg cost {usd(avgCost, 2)}
                  </text>
                </g>
              )}
              {bars.map((b, i) => {
                const up = b.c >= b.o;
                return (
                  <g key={i}>
                    <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={up ? UP : DOWN} strokeWidth="1" />
                    <rect x={x(i) - cw / 2} y={y(Math.max(b.o, b.c))} width={cw}
                      height={Math.max(1.5, Math.abs(y(b.o) - y(b.c)))} rx="1"
                      fill={up ? UP : DOWN} />
                  </g>
                );
              })}
              {bars.map((b, i) => b.marker && (
                <g key={`m${i}`} className="vg-marker">
                  {b.marker.type === "buy" && <path d={`M ${x(i)} ${y(b.l) + 8} l 6 10 l -12 0 z`} fill="#2e68fd" />}
                  {b.marker.type === "sell" && <path d={`M ${x(i)} ${y(b.h) - 18} l 6 -10 l -12 0 z`} fill="#dc2626" />}
                  {b.marker.type === "note" && <circle cx={x(i)} cy={y(b.h) - 14} r="5" fill="#ca8a04" />}
                  <text x={x(i)} y={b.marker.type === "buy" ? y(b.l) + 30 : y(b.h) - 26} fontSize="9.5"
                    fill="#4d525f" textAnchor="middle">AI</text>
                </g>
              ))}
              {bars.map((b, i) => (
                <rect key={`v${i}`} x={x(i) - cw / 2} y={H + VH - (b.v / maxV) * (VH - 12)}
                  width={cw} height={(b.v / maxV) * (VH - 12)} rx="1"
                  fill={b.c >= b.o ? UP : DOWN} opacity="0.35" />
              ))}
              <text x={0} y={H + 12} fontSize="10" fill="#94a3b8">volume</text>
              {hb && (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={PADT} y2={H + VH} stroke="#01081b" strokeOpacity="0.25" strokeDasharray="3 3" />
                  <line x1={0} x2={plotW} y1={y(hb.c)} y2={y(hb.c)} stroke="#01081b" strokeOpacity="0.18" strokeDasharray="3 3" />
                </g>
              )}
            </svg>
            {hb && (
              <div className="vg-charttip" style={{ left: `${Math.min(92, (x(hover) / W) * 100)}%` }}>
                <b>{fmtD(hb.date)}</b> · O {hb.o.toFixed(2)} · H {hb.h.toFixed(2)} · L {hb.l.toFixed(2)} · C {hb.c.toFixed(2)}
                {hb.marker && <div className="mk">{hb.marker.label}</div>}
              </div>
            )}
          </div>

          <div className="vg-row" style={{ marginTop: 10, fontSize: 12, color: "var(--color-grey)" }}>
            <span><span className="vg-mk-swatch" style={{ background: "#2e68fd" }} /> AI buy/accumulation</span>
            <span><span className="vg-mk-swatch" style={{ background: "#dc2626" }} /> AI sell/distribution</span>
            <span><span className="vg-mk-swatch" style={{ background: "#ca8a04", borderRadius: 99 }} /> AI note</span>
            {avgCost != null && <span><span className="vg-mk-swatch" style={{ background: "#932cfa" }} /> your avg cost</span>}
          </div>
          <div className="vg-markerlist">
            {(CHART_MARKERS[symbol] || []).map((m, i) => {
              const bar = all[all.length - 1 - m.ago];
              return (
                <span key={i} className={cls("vg-badge", m.type === "buy" ? "info" : m.type === "sell" ? "bad" : "warn")}>
                  {bar ? fmtD(bar.date) : ""} — {m.label}
                </span>
              );
            })}
          </div>
      </div>
    </div>
  );
}

// Contextual AI rail for the charts view — rendered by the app shell inside
// the studio's right pane: AI read + your position + AI recommendation + FAQ.
export function ChartsRail({ symbol }) {
  const insight = AI_INSIGHTS[symbol], rec = CHART_RECS[symbol];
  const held = LOTS.filter((l) => l.symbol === symbol);
  const heldShares = held.reduce((s, l) => s + l.shares, 0);
  const heldUnrl = held.reduce((s, l) => s + lotValue(l) - lotCost(l), 0);
  return (
    <div>
      <div className="vg-card">
        <div className="vg-kicker">AI read</div>
        {insight && <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "0 0 10px" }}>{insight.summary}</p>}
        {insight && (
          <div className="vg-row" style={{ gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div className="vg-spread" style={{ fontSize: 12, color: "var(--color-grey)" }}>
                <span>Momentum</span><span>{insight.momentum}</span>
              </div>
              <div className="vg-meter"><span style={{ width: `${insight.momentum}%` }} /></div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="vg-spread" style={{ fontSize: 12, color: "var(--color-grey)" }}>
                <span>Sentiment</span><span>{insight.sentiment}</span>
              </div>
              <div className="vg-meter"><span style={{ width: `${insight.sentiment}%`, background: "var(--color-secondary)" }} /></div>
            </div>
          </div>
        )}
        {!insight && <p className="vg-note" style={{ margin: 0 }}>No AI read for {symbol}.</p>}
      </div>

      <div className="vg-card">
        <div className="vg-kicker">Your position</div>
        {heldShares > 0 ? (
          <div>
            <div className="vg-spread" style={{ fontSize: 14 }}>
              <b>{heldShares} sh · {usd(heldShares * ((MARKET[symbol] && MARKET[symbol].price) || 0))}</b>
              <span className={dirCls(heldUnrl)} style={{ color: heldUnrl >= 0 ? UP : DOWN, fontWeight: 600 }}>{signUsd(heldUnrl)}</span>
            </div>
            {held.map((l, i) => (
              <div key={i} className="vg-note" style={{ marginTop: 6 }}>
                {acctOf(l.account).short}: {l.shares} sh @ {usd(l.costPerShare, 2)} ({fmtDate(l.date)})
              </div>
            ))}
          </div>
        ) : (
          <p className="vg-note" style={{ margin: 0 }}>Not held in any linked account.</p>
        )}
      </div>

      {rec && (
        <div className="vg-card vg-reccard">
          <div className="vg-kicker">AI recommendation</div>
          <div className="vg-recaction">{rec.action}</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "8px 0" }}>{rec.detail}</p>
          <p className="vg-note" style={{ margin: 0 }}>⚠ Risk: {rec.risk}</p>
        </div>
      )}

      <div className="vg-card">
        <ChartFaq />
      </div>
    </div>
  );
}

function ChartFaq() {
  const [open, setOpen] = useState(false);
  return (
    <FAQItem question="What are the AI markers?" open={open} onToggle={() => setOpen(!open)}>
      Blue triangles mark AI-detected accumulation/entry zones, red triangles distribution/exit pressure, and gold
      dots contextual notes (bias flips, TLH windows on lots you own). In this prototype both the candles and the
      markers are simulated — educational only, never trading advice.
    </FAQItem>
  );
}
