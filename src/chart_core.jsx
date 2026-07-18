// InstrumentChart — the reusable chart engine for the chart-first UI.
//
// A first-class Lightweight-Charts (TradingView's open-source engine) candle chart
// for ANY symbol: a timeframe switcher (1m/5m/15m/1H/1D), a crosshair OHLC readout,
// last-price line, both-axis zoom. This is the CANVAS everything else annotates —
// Vantage-DNA layers (P2) and Mira's read draw onto the same chart via the
// `overlays` hook (called with the chart + series refs after candles render).
//
// Extracted from the Playbook chart (spx_forecast.jsx) and generalized: data comes
// from GET /api/chart/{symbol}?tf=, not the SPX-only snapshot.
import { cls, LoadBar } from "./util.jsx";
import { chartTheme } from "./charts.jsx";
import { useLive, getChart, refreshChart, getDrawings, saveDrawing, deleteDrawing, getLayers, getChartForecast, getReplayRun } from "./live.js";
import { sma, vwap, rsi, volumeProfile } from "./indicators.js";
import { drawOne, removeOne } from "./chart_drawings.jsx";
import { LAYERS, LAYER_DRAWERS, removeLayerHandle } from "./chart_layers.jsx";

const { useState, useRef, useEffect, useCallback } = React;

// drawing tools: cursor pans; the rest capture 1 (hline) or 2 (others) clicks.
const TOOLS = [
  { key: "cursor", label: "⌖", title: "Cursor / pan", pts: 0 },
  { key: "hline", label: "─", title: "Horizontal line", pts: 1 },
  { key: "trendline", label: "╱", title: "Trendline", pts: 2 },
  { key: "ray", label: "→", title: "Ray", pts: 2 },
  { key: "rect", label: "▭", title: "Rectangle", pts: 2 },
];
const TOOL_PTS = Object.fromEntries(TOOLS.map((t) => [t.key, t.pts]));
// small id without Date/Math.random dependence surprises — fine for a client key.
let _didSeq = 0;
const newDrawingId = () => `d${(_didSeq++).toString(36)}${performance.now().toString(36).replace(".", "")}`;

const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D", "1W", "1M"];
const hasLW = () => typeof window !== "undefined"
  && !!(window.LightweightCharts && window.LightweightCharts.createChart);

// The indicator chips. `vol` marks the ones that need per-bar volume (absent on
// daily+ bars, where they're disabled). `pane` indicators (rsi/volume) draw on a
// pinned overlay price scale; the rest overlay the main price scale.
const INDICATORS = [
  { key: "ma20",  label: "MA20",  needsVol: false },
  { key: "ma50",  label: "MA50",  needsVol: false },
  { key: "vwap",  label: "VWAP",  needsVol: true },
  { key: "vol",   label: "Vol",   needsVol: true },
  { key: "rsi",   label: "RSI",   needsVol: false },
];
const IND_PREF_KEY = "vg.ic.indicators";
const loadPref = () => {
  try { return new Set(JSON.parse(localStorage.getItem(IND_PREF_KEY) || "[]")); }
  catch (e) { return new Set(); }
};
const savePref = (set) => {
  try { localStorage.setItem(IND_PREF_KEY, JSON.stringify([...set])); } catch (e) { /* */ }
};
// timeframes that carry per-bar volume (intraday); daily+ store volume=0.
const TF_HAS_VOLUME = (tf) => ["1m", "5m", "15m", "1H", "4H"].includes(tf);

const LAYER_PREF_KEY = "vg.ic.layers";
const loadLayerPref = () => {
  try { return new Set(JSON.parse(localStorage.getItem(LAYER_PREF_KEY) || "[]")); }
  catch (e) { return new Set(); }
};
const saveLayerPref = (set) => {
  try { localStorage.setItem(LAYER_PREF_KEY, JSON.stringify([...set])); } catch (e) { /* */ }
};

// a compact OHLC readout that tracks the crosshair.
function ohlcText(bar) {
  if (!bar) return null;
  const d = (bar.close >= bar.open);
  return { o: bar.open, h: bar.high, l: bar.low, c: bar.close, up: d };
}

// refresh an already-drawn indicator's data when the candles change (new tf/refresh),
// reusing the existing series so we don't churn LWC handles. POC line is rebuilt by
// the draw effect's remove/add path, so `vol` only updates its histogram here.
function setInd(drawn, key, candles, th) {
  const h = drawn[key];
  if (!h) return;
  if (key === "ma20") h.setData(sma(candles, 20));
  else if (key === "ma50") h.setData(sma(candles, 50));
  else if (key === "vwap") h.setData(vwap(candles));
  else if (key === "rsi") h.setData(rsi(candles, 14));
  else if (key === "vol") {
    h.setData(volumeProfile(candles, `rgba(${th.upRgb.join(",")},0.5)`,
      `rgba(${th.downRgb.join(",")},0.5)`).bars);
  }
}

export function InstrumentChart({ symbol, tf, setTf, overlays, height,
    replayRunId, replayActive, onReplayToggle, activeCallId }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const fittedKey = useRef(null);
  const indRef = useRef({});                   // key → LWC series handle(s)
  const pocLineRef = useRef(null);             // POC price-line handle
  const drawnRef = useRef({});                 // drawing id → LWC handle
  const pendingRef = useRef([]);               // click points for the in-progress drawing
  const toolRef = useRef("cursor");            // current tool (ref so the click cb sees it)
  const commitDrawingRef = useRef(() => {});   // latest commit fn (creation effect runs once)
  const [hover, setHover] = useState(null);   // crosshair OHLC
  const [nonce, setNonce] = useState(0);      // manual-refresh cache bust
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(loadPref);   // active indicator keys
  const [tool, setTool] = useState("cursor");       // active drawing tool
  const [drawings, setDrawings] = useState([]);     // persisted drawings for this symbol
  const [pendingN, setPendingN] = useState(0);      // clicks captured so far (UI hint)
  const [activeLayers, setActiveLayers] = useState(loadLayerPref);  // active DNA layers
  const layerHandlesRef = useRef({});               // layer key → [handles]
  toolRef.current = tool;

  // the Vantage-DNA layer data for this symbol (coach/ICT/GEX/prior) — price-level
  // annotations independent of the chart timeframe, so keyed on symbol only.
  const layerQ = useLive(() => (symbol ? getLayers(symbol) : Promise.resolve(null)),
    null, [symbol]);
  const layerData = layerQ.data && layerQ.data.available ? layerQ.data : null;
  // the analyst's latest forecast (target/invalidation/path) for the Forecast layer.
  const fcQ = useLive(() => (symbol ? getChartForecast(symbol) : Promise.resolve(null)),
    null, [symbol]);
  const forecastData = fcQ.data && fcQ.data.available ? fcQ.data.forecast : null;

  // Replay: the OVERLAY only. Run selection + the rich detail (descriptions, scores)
  // live in the right-pane ReplayPanel; the chart just draws the selected run's
  // calls as markers. `replayRunId` is the shared selection (from App); the layer is
  // active when replayActive AND the layer chip is on.
  const replayShown = replayActive && activeLayers.has("replay") && !!replayRunId;
  const runDetailQ = useLive(() => (replayShown ? getReplayRun(replayRunId) : Promise.resolve(null)),
    null, [replayShown, replayRunId]);
  const replayData = React.useMemo(() => {
    const d = runDetailQ.data;
    if (!d || !d.available || !Array.isArray(d.forecasts)) return null;
    const forecasts = d.forecasts.map((f) => {
      const fc = f.forecast || {};
      const plot = (fc && typeof fc === "object") ? fc.plot : null;
      const t = f.as_of ? Math.floor(new Date(f.as_of).getTime() / 1000) : null;
      return { id: f.id, as_of_ts: t, price_at: f.price_at,
               target: plot && plot.target != null ? plot.target : null,
               verdict: (f.score && f.score.verdict) || null };
    }).filter((f) => f.as_of_ts != null);
    return { run_id: d.run_id, forecasts, activeCallId };
  }, [runDetailQ.data, activeCallId]);

  const toggleLayer = useCallback((key) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveLayerPref(next);
      return next;
    });
  }, []);

  const toggleInd = useCallback((key) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      savePref(next);
      return next;
    });
  }, []);

  // persist a finished drawing, then render it (optimistically) and reset the tool.
  const commitDrawing = useCallback(async (kind, points) => {
    const d = { id: newDrawingId(), kind, points, style: {} };
    setDrawings((prev) => [...prev, d]);
    setTool("cursor");
    try { await saveDrawing(symbol, { id: d.id, kind, points, style: {} }); }
    catch (e) { /* stays rendered locally; reload will reconcile */ }
  }, [symbol]);
  commitDrawingRef.current = commitDrawing;

  const clearDrawings = useCallback(async () => {
    const ids = drawings.map((d) => d.id);
    setDrawings([]);
    for (const id of ids) { try { await deleteDrawing(symbol, id); } catch (e) { /* */ } }
  }, [symbol, drawings]);

  const undoLastDrawing = useCallback(async () => {
    const last = drawings[drawings.length - 1];
    if (!last) return;
    setDrawings((prev) => prev.slice(0, -1));
    try { await deleteDrawing(symbol, last.id); } catch (e) { /* */ }
  }, [symbol, drawings]);

  const q = useLive(() => (symbol ? getChart(symbol, tf) : Promise.resolve(null)),
    null, [symbol, tf, nonce]);

  const doRefresh = useCallback(async () => {
    if (!symbol || refreshing) return;
    setRefreshing(true);
    try { await refreshChart(symbol, tf); }
    catch (e) { /* surfaced by the chart note on re-pull */ }
    finally { setRefreshing(false); setNonce((n) => n + 1); }
  }, [symbol, tf, refreshing]);
  const data = q.data && q.data.available ? q.data : null;
  const candles = (data && data.candles) || [];

  // create the chart once
  useEffect(() => {
    const el = elRef.current;
    if (!el || !hasLW()) return undefined;
    const LW = window.LightweightCharts;
    const th = chartTheme();
    const chart = LW.createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: th.text, fontSize: 11 },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      rightPriceScale: { borderColor: th.border, minimumWidth: 72,
        scaleMargins: { top: 0.08, bottom: 0.08 }, autoScale: true },
      // rightOffset leaves blank chart space on the right so price-line TITLE labels
      // (coach levels, PDH/PDL, DRAW…) land in the gutter instead of over the candles.
      timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false, rightOffset: 18 },
      crosshair: { mode: LW.CrosshairMode.Normal },
      handleScale: { mouseWheel: true, pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true,
        horzTouchDrag: true, vertTouchDrag: true },
    });
    const candle = chart.addCandlestickSeries({
      upColor: th.up, downColor: th.down, wickUpColor: th.up, wickDownColor: th.down,
      borderUpColor: th.up, borderDownColor: th.down,
    });
    chartRef.current = chart; candleRef.current = candle;
    // crosshair → OHLC readout
    chart.subscribeCrosshairMove((p) => {
      if (!p || !p.time || !p.seriesData) { setHover(null); return; }
      const bar = p.seriesData.get(candle);
      setHover(bar ? ohlcText(bar) : null);
    });
    // click → capture drawing points when a tool is active. Cursor = no-op (pan).
    chart.subscribeClick((p) => {
      const t = toolRef.current;
      const need = TOOL_PTS[t] || 0;
      if (!need || !p || !p.point) return;
      const price = candle.coordinateToPrice(p.point.y);
      const time = p.time != null ? p.time : chart.timeScale().coordinateToTime(p.point.x);
      if (price == null || time == null) return;
      pendingRef.current = [...pendingRef.current, { time, price: Math.round(price * 100) / 100 }];
      setPendingN(pendingRef.current.length);
      if (pendingRef.current.length >= need) {
        const pts = pendingRef.current;
        pendingRef.current = [];
        setPendingN(0);
        commitDrawingRef.current(t, pts);
      }
    });
    return () => { chart.remove(); chartRef.current = candleRef.current = null; };
  }, []);

  // candles — fit content when the (symbol,tf) changes, not on every refresh. Fit
  // on the next frame so the chart has laid out (esp. when coming from an empty tf,
  // where the timescale would otherwise keep the prior/blank range and candles sit
  // off-screen).
  useEffect(() => {
    const candle = candleRef.current, chart = chartRef.current;
    if (!candle || !candles.length) return;
    candle.setData(candles);
    const key = `${symbol}|${tf}`;
    if (chart && fittedKey.current !== key) {
      fittedKey.current = key;
      requestAnimationFrame(() => { try { chart.timeScale().fitContent(); } catch (e) { /* */ } });
    }
  }, [candles, symbol, tf]);

  // let layers draw onto this chart after candles render (P2 hook)
  useEffect(() => {
    if (!overlays || !chartRef.current || !candleRef.current || !candles.length) return undefined;
    return overlays({ chart: chartRef.current, candle: candleRef.current,
                      LW: window.LightweightCharts, candles });
  }, [overlays, candles]);

  // indicators — reconcile the active set against drawn series each time candles
  // or the active set change. Client-side math (indicators.js); no server call.
  // Pane indicators (rsi/vol) draw on pinned overlay price scales so they don't
  // squash the candles.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return undefined;
    const th = chartTheme();
    const drawn = indRef.current;
    const volOk = TF_HAS_VOLUME(tf);
    // effective set: drop volume-dependent indicators on volume-less timeframes.
    const want = new Set([...active].filter((k) => {
      const spec = INDICATORS.find((i) => i.key === k);
      return spec && (!spec.needsVol || volOk);
    }));

    const remove = (key) => {
      const h = drawn[key];
      if (!h) return;
      // POC line lives on the candle series, not the histogram — remove it there.
      if (key === "vol" && pocLineRef.current) {
        try { candleRef.current?.removePriceLine(pocLineRef.current); } catch (e) { /* */ }
        pocLineRef.current = null;
      }
      try { chart.removeSeries(h); } catch (e) { /* */ }
      delete drawn[key];
    };
    // tear down anything no longer wanted
    for (const key of Object.keys(drawn)) if (!want.has(key)) remove(key);
    if (!candles.length) return undefined;

    const line = (color, opts = {}) => chart.addLineSeries({
      color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, ...opts });

    for (const key of want) {
      // vol carries a POC price-line that must track the window; rebuild it fresh
      // rather than trying to move the line. Others reuse their series in place.
      if (drawn[key] && key === "vol") remove(key);
      else if (drawn[key]) { setInd(drawn, key, candles, th); continue; }
      if (key === "ma20") { drawn[key] = line(th.accent); drawn[key].setData(sma(candles, 20)); }
      else if (key === "ma50") { drawn[key] = line(th.text); drawn[key].setData(sma(candles, 50)); }
      else if (key === "vwap") { drawn[key] = line(th.strike || "#7b61ff", { lineStyle: 2 }); drawn[key].setData(vwap(candles)); }
      else if (key === "rsi") {
        const s = chart.addLineSeries({ color: th.accent, lineWidth: 1.5,
          priceScaleId: "rsi", priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerVisible: false });
        try { chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } }); } catch (e) { /* */ }
        s.setData(rsi(candles, 14));
        drawn[key] = s;
      } else if (key === "vol") {
        const { bars, poc } = volumeProfile(candles, `rgba(${th.upRgb.join(",")},0.5)`,
          `rgba(${th.downRgb.join(",")},0.5)`);
        const s = chart.addHistogramSeries({ priceScaleId: "vol",
          priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
        try { chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } }); } catch (e) { /* */ }
        s.setData(bars);
        drawn[key] = s;
        // clear any orphaned POC line before drawing a fresh one.
        if (pocLineRef.current) {
          try { candleRef.current.removePriceLine(pocLineRef.current); } catch (e) { /* */ }
          pocLineRef.current = null;
        }
        if (poc != null) {
          try {
            pocLineRef.current = candleRef.current.createPriceLine({ price: poc,
              color: th.accent, lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "POC" });
          } catch (e) { /* */ }
        }
      }
    }
    return undefined;
  }, [candles, active, tf]);

  // load persisted drawings when the symbol changes; clear pending on switch.
  useEffect(() => {
    let alive = true;
    pendingRef.current = []; setPendingN(0);
    if (!symbol) { setDrawings([]); return undefined; }
    getDrawings(symbol)
      .then((r) => { if (alive && r && r.available) setDrawings(r.drawings || []); })
      .catch(() => { /* leave whatever's there */ });
    return () => { alive = false; };
  }, [symbol]);

  // render drawings — reconcile the `drawings` list against drawn LWC handles.
  // Re-runs when candles change (ray endpoints depend on the visible range) so we
  // rebuild segment kinds; hlines are stable.
  useEffect(() => {
    const chart = chartRef.current, candle = candleRef.current;
    if (!chart || !candle) return undefined;
    const drawn = drawnRef.current;
    const wanted = new Set(drawings.map((d) => d.id));
    // remove handles no longer in the list
    for (const id of Object.keys(drawn)) {
      if (!wanted.has(id)) { removeOne(chart, candle, drawn[id]); delete drawn[id]; }
    }
    // (re)draw each drawing. Segment kinds are cheap to rebuild; do so every pass
    // so rays track the range. hlines only need drawing once.
    for (const d of drawings) {
      if (drawn[d.id] && d.kind === "hline") continue;
      if (drawn[d.id]) { removeOne(chart, candle, drawn[d.id]); delete drawn[d.id]; }
      const h = drawOne(chart, candle, d);
      if (h) drawn[d.id] = h;
    }
    return undefined;
  }, [drawings, candles]);

  // Vantage-DNA layers — reconcile active layer groups against drawn handles.
  // Re-runs when the active set, the fetched layer data, or the candles change
  // (zones span the candle time range). Each group draws independently so a
  // toggle only adds/removes that group's handles.
  useEffect(() => {
    const chart = chartRef.current, candle = candleRef.current;
    if (!chart || !candle) return undefined;
    const handles = layerHandlesRef.current;
    const removeGroup = (key) => {
      (handles[key] || []).forEach((h) => removeLayerHandle(chart, candle, h));
      delete handles[key];
    };
    // if the data or candles changed, everything drawn is stale — redraw all active.
    for (const key of Object.keys(handles)) removeGroup(key);
    if (!candles.length) return undefined;
    const ctx = { chart, candle, LW: window.LightweightCharts, candles,
                  layers: (layerData && layerData.layers) || {}, forecast: forecastData,
                  replay: replayData,
                  price: (layerData && layerData.layers && layerData.layers.price)
                    || candles[candles.length - 1].close };
    // draw each active layer. replay is special: it draws only when a run is
    // actually selected+active (replayShown), driven from the right-pane panel.
    const keysToDraw = new Set(activeLayers);
    if (!replayShown) keysToDraw.delete("replay");
    else keysToDraw.add("replay");
    for (const key of keysToDraw) {
      // forecast/replay draw from their own data; the rest need layerData.
      if (key !== "forecast" && key !== "replay" && !layerData) continue;
      const drawer = LAYER_DRAWERS[key];
      if (!drawer) continue;
      try { handles[key] = drawer(ctx) || []; } catch (e) { handles[key] = []; }
    }
    return undefined;
  }, [activeLayers, layerData, forecastData, replayData, replayShown, candles]);

  // scroll the chart to the selected replay run's day so its markers are in view
  // (a run is day-specific; without this, picking an older day draws markers
  // off-screen). Frame from just before the first forecast to just after the last,
  // clamped to the candles we actually have. Only when Replay is active.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !replayShown || !replayData || !candles.length) return;
    const ts = replayData.forecasts.map((f) => f.as_of_ts).filter((t) => t != null);
    if (!ts.length) return;
    const first = Math.min(...ts), lastT = Math.max(...ts);
    const c0 = candles[0].time, cN = candles[candles.length - 1].time;
    // pad ~2h either side so the day frames nicely; clamp to loaded candle range.
    const pad = 2 * 3600;
    const from = Math.max(c0, first - pad), to = Math.min(cN, lastT + pad);
    if (to > from) {
      requestAnimationFrame(() => {
        try { chart.timeScale().setVisibleRange({ from, to }); } catch (e) { /* */ }
      });
    }
  }, [replayData, replayShown, candles]);

  const last = candles.length ? candles[candles.length - 1].close : null;

  return (
    <div className="vg-ic">
      <div className="vg-ic-head">
        <span className="vg-ic-sym">{symbol}</span>
        {last != null && <span className="vg-ic-px">{last}</span>}
        {hover && (
          <span className={cls("vg-ic-ohlc", hover.up ? "up" : "down")}>
            O {hover.o} H {hover.h} L {hover.l} C {hover.c}
          </span>)}
        <div className="vg-ic-tf">
          {TIMEFRAMES.map((t) => (
            <button key={t} className={cls("vg-ic-tfb", t === tf && "on")}
              onClick={() => setTf(t)}>{t}</button>
          ))}
        </div>
        <button className={cls("vg-ic-refresh", refreshing && "spin")}
          onClick={doRefresh} disabled={refreshing} title={`Refresh ${symbol} bars`}
          aria-label={`Refresh ${symbol} bars`}>↻</button>
      </div>
      <div className="vg-ic-inds">
        {INDICATORS.map((ind) => {
          const disabled = ind.needsVol && !TF_HAS_VOLUME(tf);
          const on = active.has(ind.key) && !disabled;
          return (
            <button key={ind.key} className={cls("vg-ic-chip", on && "on", disabled && "off")}
              onClick={() => !disabled && toggleInd(ind.key)} disabled={disabled}
              title={disabled ? `${ind.label} needs intraday volume (1m–4H)` : `Toggle ${ind.label}`}>
              {ind.label}
            </button>);
        })}
        <div className="vg-ic-tools">
          {TOOLS.map((t) => (
            <button key={t.key} className={cls("vg-ic-tool", t.key === tool && "on")}
              onClick={() => { pendingRef.current = []; setPendingN(0); setTool(t.key); }}
              title={t.title} aria-label={t.title}>{t.label}</button>
          ))}
          {tool !== "cursor" && pendingN > 0 && (
            <span className="vg-ic-hint">{pendingN}/{TOOL_PTS[tool]}</span>)}
          <button className="vg-ic-tool" onClick={undoLastDrawing} disabled={!drawings.length}
            title="Undo last drawing" aria-label="Undo last drawing">⌫</button>
          <button className="vg-ic-tool" onClick={clearDrawings} disabled={!drawings.length}
            title="Clear all drawings" aria-label="Clear all drawings">✕</button>
        </div>
      </div>
      <div className="vg-ic-layers">
        <span className="vg-ic-layers-tag">DNA</span>
        {LAYERS.map((ly) => {
          const gatedLevels = ly.needsLevels && layerData && !layerData.has_levels;
          const gatedFc = ly.needsForecast && !fcQ.loading && !forecastData;
          const gated = gatedLevels || gatedFc;
          const on = (ly.needsReplay ? replayActive : activeLayers.has(ly.key)) && !gated;
          const why = gatedFc ? `No stored forecast for this symbol yet`
            : ly.needsReplay ? `Replay — pick a run in the right panel`
            : gatedLevels ? `${ly.label} needs a coach playbook (SPX/QQQ/IWM)`
            : `Toggle ${ly.label}`;
          const onClick = ly.needsReplay
            ? () => { toggleLayer("replay"); onReplayToggle && onReplayToggle(); }
            : () => !gated && toggleLayer(ly.key);
          return (
            <button key={ly.key} className={cls("vg-ic-chip", on && "on", gated && "off")}
              onClick={onClick} disabled={gated} title={why}>
              {ly.label}
            </button>);
        })}
        {layerQ.loading && <span className="vg-ic-hint">…</span>}
        {layerData && !layerData.has_levels && (
          <span className="vg-ic-layers-note">bars-derived only (no coach chain)</span>)}
      </div>
      <div className="vg-ic-body">
        {(q.loading) && <LoadBar />}
        {!hasLW()
          ? <p className="vg-note" style={{ padding: 12 }}>Chart engine didn't load.</p>
          : <div ref={elRef} className="vg-ic-canvas" style={height ? { height } : undefined} />}
        {!q.loading && !data && (
          <div className="vg-ic-empty">
            <p className="vg-note">{(q.data && q.data.note) || `No chart data for ${symbol}.`}</p>
          </div>)}
      </div>
    </div>
  );
}

// A self-contained wrapper that owns the timeframe state — for quick drop-in use.
export function InstrumentChartCard({ symbol, defaultTf = "15m", overlays, height,
    replayActive, replayRunId, onReplayToggle, activeCallId }) {
  const [tf, setTf] = useState(defaultTf);
  return <InstrumentChart symbol={symbol} tf={tf} setTf={setTf} overlays={overlays} height={height}
    replayActive={replayActive} replayRunId={replayRunId} onReplayToggle={onReplayToggle}
    activeCallId={activeCallId} />;
}
