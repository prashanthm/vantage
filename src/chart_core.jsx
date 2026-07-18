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
import { useLive, getChart, refreshChart } from "./live.js";

const { useState, useRef, useEffect, useCallback } = React;

const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D", "1W", "1M"];
const hasLW = () => typeof window !== "undefined"
  && !!(window.LightweightCharts && window.LightweightCharts.createChart);

// a compact OHLC readout that tracks the crosshair.
function ohlcText(bar) {
  if (!bar) return null;
  const d = (bar.close >= bar.open);
  return { o: bar.open, h: bar.high, l: bar.low, c: bar.close, up: d };
}

export function InstrumentChart({ symbol, tf, setTf, overlays, height }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const fittedKey = useRef(null);
  const [hover, setHover] = useState(null);   // crosshair OHLC
  const [nonce, setNonce] = useState(0);      // manual-refresh cache bust
  const [refreshing, setRefreshing] = useState(false);

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
      rightPriceScale: { borderColor: th.border, minimumWidth: 64,
        scaleMargins: { top: 0.08, bottom: 0.08 }, autoScale: true },
      timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false, rightOffset: 6 },
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
export function InstrumentChartCard({ symbol, defaultTf = "15m", overlays, height }) {
  const [tf, setTf] = useState(defaultTf);
  return <InstrumentChart symbol={symbol} tf={tf} setTf={setTf} overlays={overlays} height={height} />;
}
