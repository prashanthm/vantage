// SpxForecastPanel — "what will price do?", chart-centric.
//
// A 5-min candle chart of the session (from the persisted 1m bars, resampled),
// with the coach's playbook levels drawn as labeled price lines, the ICT
// structures (active order blocks, fresh FVGs) as shaded zones, and — once you
// forecast — the analyst's TARGET (green) / INVALIDATION (red) / DRAW overlaid.
// Below the chart: the structured forecast (MiraRender) + prior forecasts with
// their accuracy score. The score is graded against elapsed price action.
import { cls, dirCls, LoadBar } from "./util.jsx";
import { parseMira, MiraRender } from "./mira-render.jsx";
import { chartTheme } from "./chart_theme.jsx";
import {
  useLive, streamTurn, getSpxSnapshot, saveSpxForecast,
  getSpxForecasts, scoreSpxForecast, prepareSpx, refreshSpx,
  planReplay, getReplays, getReplay, scoreReplay, calibrateReplay,
} from "./live.js";

const { useState, useRef, useEffect } = React;

// symbols that get coach levels + forecast (the engine needs a GEX chain).
const PLAYBOOK_SYMBOLS = ["SPX", "QQQ", "IWM"];

const hasLW = () => typeof window !== "undefined"
  && !!(window.LightweightCharts && window.LightweightCharts.createChart);

// pull bias/target/invalidation out of the structured forecast (top-level or an
// A2UI keyvals row) so we can overlay them on the chart.
// The chart overlay fields come from the analyst's STRUCTURED `plot` object
// (bias/target/invalidation/path) — Vantage just plots it, no prose parsing.
// The analyst owns the judgment; the SPA owns the drawing. Old forecasts (made
// before `plot` existed) have no plot object — for those we extract target /
// invalidation from the keyvals ONLY (a single clean number), and show no path.
function forecastFields(data) {
  if (!data) return {};
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const p = data.plot;
  if (p && typeof p === "object") {
    const b = String(p.bias || "").toLowerCase();
    const biasDir = /down|bear|short/.test(b) ? "down" : /up|bull|long/.test(b) ? "up" : b;
    const path = (Array.isArray(p.path) ? p.path : [])
      .map((st, i) => ({
        seq: num(st.seq) || i + 1,
        price: num(st.price),
        dir: /down|short|bear/.test(String(st.dir || "").toLowerCase()) ? "down"
          : /up|long|bull/.test(String(st.dir || "").toLowerCase()) ? "up" : biasDir,
        note: String(st.note || "").slice(0, 40),
      }))
      .filter((st) => st.price != null)
      .slice(0, 5);
    return { bias: biasDir, target: num(p.target), invalid: num(p.invalidation), path };
  }
  // legacy forecast (no plot object): a clean number from the Targets keyvals only.
  const firstNum = (v) => { const m = String(v).match(/\d{3,6}(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  let target = null, invalid = null;
  for (const sec of data.sections || []) {
    for (const r of sec.rows || []) {
      const k = String(r.k || "").toLowerCase();
      if (target == null && k.includes("target") && !/upside|wrong|if /.test(k)) target = firstNum(r.v);
      if (invalid == null && (k.includes("invalid") || k.includes("stop"))) invalid = firstNum(r.v);
    }
  }
  return { bias: "", target, invalid, path: [] };
}

// The chart: candles + coach levels + ICT zones + (optional) forecast overlay.
function ForecastChart({ snap, forecast }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const linesRef = useRef([]);
  const zonesRef = useRef([]);
  const markedRef = useRef(false);
  const pathSeriesRef = useRef(null);

  // create once
  useEffect(() => {
    const el = elRef.current;
    if (!el || !hasLW()) return undefined;
    const LW = window.LightweightCharts;
    const th = chartTheme();
    const chart = LW.createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: th.text, fontSize: 11 },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      // wider right scale + top/bottom margins so the labeled level tags have
      // room and don't clip against the edge. rightOffset leaves future space for
      // the projected forecast path.
      rightPriceScale: { borderColor: th.border, minimumWidth: 116,
        scaleMargins: { top: 0.08, bottom: 0.08 }, autoScale: true },
      timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false,
        rightOffset: 12 },
      crosshair: { mode: LW.CrosshairMode.Normal },
      // wheel zooms BOTH axes; both axes drag-stretchable (vertical price zoom).
      handleScale: {
        mouseWheel: true, pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true,
        horzTouchDrag: true, vertTouchDrag: true },
    });
    const candle = chart.addCandlestickSeries({
      upColor: th.up, downColor: th.down, wickUpColor: th.up, wickDownColor: th.down,
      borderUpColor: th.up, borderDownColor: th.down,
    });
    chartRef.current = chart; candleRef.current = candle;
    return () => { chart.remove(); chartRef.current = candleRef.current = null;
      linesRef.current = []; zonesRef.current = []; pathSeriesRef.current = null; };
  }, []);

  // candles
  const fittedRef = useRef(false);
  useEffect(() => {
    const candle = candleRef.current;
    const bars = snap && snap.bars_5m;
    if (!candle || !bars || !bars.length) return;
    candle.setData(bars);
    // fit once on first load; don't yank the user's manual zoom on 5-min updates
    if (chartRef.current && !fittedRef.current) {
      chartRef.current.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [snap]);

  // levels + ICT zones + forecast overlay (redraw on snap/forecast change)
  useEffect(() => {
    const candle = candleRef.current, chart = chartRef.current;
    if (!candle || !chart || !snap) return;
    const LW = window.LightweightCharts;
    const th = chartTheme();
    // clear
    for (const pl of linesRef.current) { try { candle.removePriceLine(pl); } catch (e) { /* */ } }
    for (const z of zonesRef.current) { try { chart.removeSeries(z); } catch (e) { /* */ } }
    linesRef.current = []; zonesRef.current = [];
    const addLine = (o) => linesRef.current.push(candle.createPriceLine(o));
    const bars = snap.bars_5m || [];
    const t0 = bars.length ? bars[0].time : 0;
    const t1 = bars.length ? bars[bars.length - 1].time : 0;

    // DECLUTTER: when a forecast is on the chart, fade the standing context
    // (coach levels / OB-FVG zones / liquidity) so the numbered path + target
    // stand out. `dim` scales opacity; `ctxN` trims how many context items draw.
    const hasFc = !!(forecast && (forecast.target != null || (forecast.path && forecast.path.length)));
    const dim = hasFc ? 0.35 : 1.0;
    const ctxN = hasFc ? 3 : 5;
    const liqN = hasFc ? 2 : 4;

    // a shaded horizontal zone (OB / FVG) via a filled band between top/bottom,
    // with a text tag on its upper edge so you can tell WHAT the band is.
    const addZone = (top, bottom, rgb, alpha, tag) => {
      const area = chart.addBaselineSeries({
        baseValue: { type: "price", price: bottom },
        topFillColor1: `rgba(${rgb},${alpha})`, topFillColor2: `rgba(${rgb},${alpha})`,
        topLineColor: `rgba(${rgb},0.5)`, bottomLineColor: `rgba(${rgb},0.5)`,
        bottomFillColor1: "rgba(0,0,0,0)", bottomFillColor2: "rgba(0,0,0,0)",
        lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      });
      area.setData([{ time: t0, value: top }, { time: t1, value: top }]);
      zonesRef.current.push(area);
      if (tag) addLine({
        price: top, color: `rgba(${rgb},0.9)`, lineWidth: 1,
        lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: tag,
      });
    };

    // coach levels — labeled price lines, tinted by role (dimmed under a forecast)
    (snap.levels || []).forEach((lv) => {
      const lbl = String(lv.label || "");
      const isRes = /resist|call wall/i.test(lbl);
      const isSup = /support|put wall|max pain/i.test(lbl);
      const rgb = isRes ? th.downRgb : isSup ? th.upRgb : [176, 106, 0];
      addLine({
        price: lv.price,
        color: `rgba(${rgb.join(",")},${0.55 * dim})`,
        lineWidth: /wall|max pain|durable/i.test(lbl) ? 2 : 1,
        lineStyle: LW.LineStyle.Dashed, axisLabelVisible: !hasFc,
        title: hasFc ? "" : lbl.replace(/\s*[★✦].*$/, "").slice(0, 20),
      });
    });

    const px = snap.price || (bars.length ? bars[bars.length - 1].close : 0);
    const nearest = (arr, mid, n) => (arr || [])
      .slice().sort((a, b) => Math.abs(mid(a) - px) - Math.abs(mid(b) - px)).slice(0, n);

    // ICT order blocks (support/resistance zones) + fresh FVGs — directional
    // tint (green = demand/bullish, red = supply/bearish) + a text tag. Over the
    // multi-day history these can be many; keep the ones NEAREST current price.
    const ict = snap.ict || {};
    nearest(ict.active_order_blocks, (o) => (o.top + o.bottom) / 2, ctxN).forEach((o) => {
      const rgb = (o.side === "bull" ? th.upRgb : th.downRgb).join(",");
      addZone(o.top, o.bottom, rgb, 0.14 * dim, hasFc ? "" : `${o.side === "bull" ? "demand" : "supply"} OB`);
    });
    nearest(ict.fresh_fvgs, (f) => (f.hi + f.lo) / 2, ctxN).forEach((f) => {
      const rgb = (f.side === "bull" ? th.upRgb : th.downRgb).join(",");
      addZone(f.hi, f.lo, rgb, 0.10 * dim, hasFc ? "" : `${f.side === "bull" ? "bull" : "bear"} FVG`);
    });

    // unswept liquidity pools — resting BSL (above) / SSL (below), the prior
    // highs/lows price is drawn to sweep. Thin amber dotted lines, nearest few.
    const liq = ict.unswept_liquidity || {};
    const liqRgb = "184,122,22";  // amber, distinct from coach/OB/FVG
    nearest(liq.bsl, (p) => p, liqN).forEach((p) => addLine({
      price: p, color: `rgba(${liqRgb},${0.6 * dim})`, lineWidth: 1,
      lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "BSL",
    }));
    nearest(liq.ssl, (p) => p, liqN).forEach((p) => addLine({
      price: p, color: `rgba(${liqRgb},${0.6 * dim})`, lineWidth: 1,
      lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "SSL",
    }));

    // the level-based DRAW (the magnet) — always shown; violet, distinct.
    if (ict.draw && ict.draw.level != null) addLine({
      price: ict.draw.level, color: "rgba(124,92,255,0.9)", lineWidth: 2,
      lineStyle: LW.LineStyle.Dotted, axisLabelVisible: true,
      title: `DRAW ${ict.draw.dir === "up" ? "↑" : "↓"}`,
    });

    // clear any prior projected-path series
    if (pathSeriesRef.current) {
      try { chart.removeSeries(pathSeriesRef.current); } catch (e) { /* */ }
      pathSeriesRef.current = null;
    }

    // the FORECAST overlay. TARGET / INVALIDATION stay as horizontal reference
    // lines (they're levels); the numbered PATH projects FORWARD from the last
    // bar into the future space — so it reads as "from here, price goes 1→2→3…"
    // and its labels sit in the empty right area, not colliding with the levels.
    if (forecast) {
      const { target, invalid, path } = forecast;
      if (target != null) addLine({
        price: target, color: `rgb(${th.upRgb.join(",")})`, lineWidth: 3,
        lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: `🎯 TARGET`,
      });
      if (invalid != null) addLine({
        price: invalid, color: `rgb(${th.downRgb.join(",")})`, lineWidth: 3,
        lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: `✕ INVALID`,
      });

      // project the path forward: a line from the current price at t1, stepping
      // one bar into the future per step, at each step's price. Numbered markers
      // at each vertex. barSec = spacing of the last two bars (≈5m).
      const steps = (path || []).filter((st) => st.price != null);
      if (t1 && steps.length) {
        const barSec = bars.length > 1 ? (bars[bars.length - 1].time - bars[bars.length - 2].time) || 300 : 300;
        const px0 = snap.price || (bars.length ? bars[bars.length - 1].close : steps[0].price);
        const data = [{ time: t1, value: px0 }];
        const markers = [];
        steps.forEach((st, i) => {
          const tt = t1 + barSec * (i + 1);
          data.push({ time: tt, value: st.price });
          // marker carries the number, the PRICE, and the narrative action so you
          // can read WHAT price should do at each step, right on the chart.
          const label = `${st.seq} · ${st.price}${st.note ? " " + st.note : ""}`.slice(0, 34);
          markers.push({
            time: tt, position: st.dir === "down" ? "belowBar" : "aboveBar",
            shape: st.dir === "down" ? "arrowDown" : "arrowUp",
            color: st.dir === "down" ? `rgb(${th.downRgb.join(",")})` : `rgb(${th.upRgb.join(",")})`,
            text: label,
          });
        });
        try {
          const ps = chart.addLineSeries({
            color: "rgba(124,92,255,0.95)", lineWidth: 2,
            lineStyle: LW.LineStyle.Dashed, lastValueVisible: false,
            priceLineVisible: false, crosshairMarkerVisible: false,
          });
          ps.setData(data);
          ps.setMarkers(markers);
          pathSeriesRef.current = ps;
        } catch (e) { /* older LW builds — skip the projection */ }
      }

      // a marker at the forecast's origin bar — "now" for a live forecast, or
      // "called @ HH:MM" for a pinned prior (its origin isn't the live present).
      if (t1) {
        try {
          candle.setMarkers([{
            time: t1, position: "aboveBar", shape: "circle",
            color: "rgb(124,92,255)", text: (forecast.origin && forecast.origin.label) || "now",
          }]);
          markedRef.current = true;
        } catch (e) { /* older LW builds */ }
      }
    } else if (markedRef.current) {
      try { candle.setMarkers([]); } catch (e) { /* */ }
      markedRef.current = false;
    }
  }, [snap, forecast]);

  if (!hasLW()) {
    return <p className="vg-note" style={{ marginTop: 8 }}>Chart unavailable (Lightweight Charts didn't load).</p>;
  }
  return <div ref={elRef} className="vg-fc-chart" />;
}

// One stored forecast row (collapsible) with its score badge + a chart-overlay
// toggle. Clicking "📈" overlays this forecast's target/invalidation + numbered
// path on the chart; the header still expands the full read.
function ForecastRow({ f, onScore, scoring, selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const sc = f.score;
  const tone = !sc ? "plain"
    : sc.verdict === "hit target" || sc.verdict === "direction correct" ? "good"
    : sc.verdict === "invalidated" || sc.verdict === "direction wrong" ? "bad" : "plain";
  // Clicking the ROW selects it → overlays its levels + numbered path on the chart
  // (the natural expectation). The ▸ caret is a separate control that expands the
  // full written read. "score it" and the caret stop propagation so they don't toggle
  // the overlay.
  return (
    <div className={cls("vg-fc-row", selected && "vg-fc-row-sel")}>
      <div className="vg-fc-rowhead" style={{ cursor: "pointer" }}
        title={selected ? "hide from chart" : "show this forecast on the chart"}
        onClick={() => onSelect(selected ? null : f)}>
        <span className="vg-fc-showbtn" aria-hidden="true">📈</span>
        <span className="vg-note">{f.day} · {String(f.as_of || "").slice(11, 16)}</span>
        <span className="vg-fc-price-sm">@ {f.price_at}</span>
        {sc
          ? <span className={cls("vg-badge", tone)} style={{ fontSize: 11 }}>{sc.verdict}{sc.moved_pt != null ? ` · ${sc.moved_pt >= 0 ? "+" : ""}${sc.moved_pt}pt` : ""}</span>
          : <button className="vg-btn-sm" disabled={scoring === f.id}
              onClick={(e) => { e.stopPropagation(); onScore(f.id); }}>
              {scoring === f.id ? "…" : "score it"}
            </button>}
        <span className="vg-fc-caret" title="show the written read"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>{open ? "▾" : "▸"}</span>
      </div>
      {selected && <div className="vg-fc-rowhint">📈 shown on chart — click again to hide</div>}
      {open && <div className="vg-fc-rowbody"><MiraRender data={f.forecast} text={f.forecast_text} /></div>}
    </div>
  );
}

// The 0DTE Playbook is split into a CHART (center canvas) and a RAIL (the forecast
// button + read + prior forecasts), which lives in the app's right side panel so it
// gets full height and the chart gets the full width. Both share one state store via
// this context: the provider owns the state; the chart and the rail consume it.
const PlaybookCtx = React.createContext(null);
const usePlaybook = () => React.useContext(PlaybookCtx);

function usePlaybookStore(initialSymbol) {
  const [symbol, setSymbolState] = useState((initialSymbol || "SPX").toUpperCase());
  const [entry, setEntry] = useState(symbol);
  const [nonce, setNonce] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [prepNote, setPrepNote] = useState(null);
  const [read, setRead] = useState(null);
  const [scoring, setScoring] = useState(null);
  const [selected, setSelected] = useState(null);   // a prior forecast pinned to the chart
  const [autoRefresh, setAutoRefresh] = useState(true);
  const abortRef = useRef(null);
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);

  // AUTO-UPDATE: every 5 min, re-fetch fresh 1m bars for a playbook symbol then
  // re-pull the snapshot so the chart / levels / tape stay ~current. Pauses when
  // the tab is hidden (no point polling in the background) and when off. The
  // backend RTH cron also refreshes bars, so this stays cheap even solo.
  useEffect(() => {
    if (!autoRefresh || !PLAYBOOK_SYMBOLS.includes(symbol)) return undefined;
    const tick = () => {
      if (document.hidden) return;
      refreshSpx(symbol).then(() => setNonce((n) => n + 1)).catch(() => {});
    };
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, symbol]);

  const snapQ = useLive(() => getSpxSnapshot(undefined, undefined, symbol), null, [symbol, nonce]);
  const priors = useLive(() => getSpxForecasts(undefined, symbol, 30), null, [symbol, nonce]);

  const s = snapQ.data && snapQ.data.available ? snapQ.data : null;
  const isPlaybook = PLAYBOOK_SYMBOLS.includes(symbol);
  const busy = read && read.loading;
  const liveFields = read && read.data ? forecastFields(read.data) : null;
  // a PINNED prior forecast overrides the live one on the chart; else show the live.
  // origin = the marker at the path's start: "now" for a fresh forecast, or
  // "called @ HH:MM" for a pinned prior (its origin isn't the live present).
  const fcFields = selected
    ? { ...forecastFields(selected.forecast),
        origin: { label: `called @ ${String(selected.as_of || "").slice(11, 16)}`, price: selected.price_at } }
    : (liveFields ? { ...liveFields, origin: { label: "now" } } : null);

  const applySymbol = (sym) => {
    const s2 = String(sym || "").trim().toUpperCase();
    if (!s2 || s2 === symbol) return;
    setRead(null); setPrepNote(null);
    setSymbolState(s2); setEntry(s2);
  };

  const prepare = () => {
    setPreparing(true); setPrepNote(null);
    prepareSpx(symbol, 5)
      .then((r) => {
        if (r && r.note) setPrepNote(r.note);
        setNonce((n) => n + 1);   // re-fetch the snapshot
      })
      .catch((e) => setPrepNote(String(e && e.message || e)))
      .finally(() => setPreparing(false));
  };

  // stream the forecast for a given day/as_of (the analyst re-fetches the snapshot
  // server-side from the ref, so a fresh as_of => fresh reasoning).
  const runForecast = (day, asOf) => {
    let text = "";
    const ref = `SPX_SNAPSHOT_REF day=${day} as_of=${asOf} underlying=${symbol}`;
    const prompt = `What will ${symbol} price do from here? Reason over the snapshot and give a structured, scoreable forecast (bias, expected path, level targets, invalidation, confidence).\n${ref}`;
    abortRef.current = streamTurn(prompt, `spx-forecast-${symbol}-${day}-${asOf}`, (evt) => {
      if (evt.kind === "error") { setRead({ error: evt.message || "Mira error" }); return; }
      // Mira delivers the answer as text frames — `token` (a whole A2UI JSON in
      // one frame) or streaming `delta`/`message`. Accumulate any of them.
      if ((evt.kind === "token" || evt.kind === "delta" || evt.kind === "message") && evt.text) {
        text += evt.text; setRead({ loading: true, text }); return;
      }
      if (evt.kind === "done") {
        abortRef.current = null;
        if (evt.text && !text) text = evt.text;   // answer carried on the done frame
        const data = parseMira(text);
        if (!data && !text) { setRead({ error: "Mira returned an empty forecast." }); return; }
        setRead({ text, data });
        saveSpxForecast({ day, as_of: asOf, symbol, snapshot: s,
          forecast: data || null, forecast_text: text })
          .then(() => setNonce((n) => n + 1)).catch(() => {});
      }
    });
  };

  // Forecast = REFRESH-THEN-FORECAST: pull today's freshest 1m bars first, then
  // reason over them — so the read is always current at the moment you ask,
  // independent of the 5-min auto cycle. Falls back to the loaded snapshot if the
  // refresh fails or the symbol has no bars.
  const forecast = () => {
    if (!s) return;
    setRead({ loading: true });
    refreshSpx(symbol)
      .then((r) => {
        const day = (r && r.available && r.day) || s.day;
        const asOf = (r && r.available && r.as_of) || s.as_of;
        runForecast(day, asOf);
      })
      .catch(() => runForecast(s.day, s.as_of));   // degrade to the loaded snapshot
  };

  const score = (fid) => {
    setScoring(fid);
    scoreSpxForecast(fid).then(() => setNonce((n) => n + 1)).finally(() => setScoring(null));
  };

  const t = (s && s.technicals) || {};
  const draw = (s && s.ict && s.ict.draw) || {};

  return {
    symbol, entry, setEntry, applySymbol, PLAYBOOK_SYMBOLS,
    s, snapQ, isPlaybook, busy, preparing, prepNote, prepare,
    read, forecast, score, scoring, selected, setSelected, fcFields,
    autoRefresh, setAutoRefresh, priors, t, draw,
  };
}

// Provider — owns the store; wrap the playbook route so both the chart and the
// rail (in the app's right pane) read the same state.
export function PlaybookProvider({ initialSymbol = "SPX", children }) {
  const store = usePlaybookStore(initialSymbol);
  return <PlaybookCtx.Provider value={store}>{children}</PlaybookCtx.Provider>;
}

// The CHART canvas (center) — symbol bar, tape, HTF banner, legend, candles.
export function SpxPlaybookView() {
  const p = usePlaybook();
  if (!p) return null;
  const { symbol, entry, setEntry, applySymbol, s, snapQ, isPlaybook, preparing,
    prepNote, prepare, selected, setSelected, fcFields, autoRefresh, setAutoRefresh,
    t, draw, busy } = p;
  return (
    <div className="vg-loadhost">
      {(snapQ.loading || busy || preparing) && <LoadBar />}

      <div className="vg-spread" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>0DTE Playbook — {symbol}</h2>
          <p className="vg-sub" style={{ margin: "4px 0 0" }}>
            {isPlaybook
              ? "5-min candles · coach levels · ICT structure · what will price do?"
              : "5-min candles — coach levels & forecast need a GEX chain (SPX / QQQ / IWM)"}
          </p>
        </div>
        <form className="vg-fc-symbar"
          onSubmit={(e) => { e.preventDefault(); applySymbol(entry); }}>
          {PLAYBOOK_SYMBOLS.map((sy) => (
            <button type="button" key={sy}
              className={cls("vg-fc-chip", sy === symbol && "vg-fc-chip-on")}
              onClick={() => applySymbol(sy)}>{sy}</button>
          ))}
          <input className="vg-fc-syminput" value={entry} spellCheck={false}
            onChange={(e) => setEntry(e.target.value.toUpperCase())}
            placeholder="symbol" aria-label="chart symbol" />
          <button className="vg-btn-sm" type="submit">Load</button>
        </form>
      </div>

      <div className="vg-card vg-fc-chartcard" style={{ padding: 14 }}>
        {s && (
          <div className="vg-fc-tapehead">
            <b>{s.price}</b>
            <span className="vg-note">{s.day} · {String(s.as_of || "").slice(11, 16)} ET{s.history_days > 1 ? ` · ${s.history_days}-day history` : ""}</span>
            <span className="vg-fc-tape">
              VWAP {t.vwap} ({t.vs_vwap_pt >= 0 ? "+" : ""}{t.vs_vwap_pt}) · RSI {t.rsi} · vol {t.rel_volume}×
              {draw.dir ? <> · draw {draw.dir} → <b>{draw.level}</b></> : null}
            </span>
            {isPlaybook && (
              <button className={cls("vg-fc-auto", autoRefresh && "vg-fc-auto-on")}
                onClick={() => setAutoRefresh((v) => !v)}
                title="Auto-refresh the 1m bars + chart every 5 minutes during market hours">
                {autoRefresh ? "● auto 5m" : "○ auto off"}
              </button>)}
          </div>)}

        {s && selected && (
          <div className="vg-fc-pinned">
            <span>📈 showing forecast @ {selected.day} · {String(selected.as_of || "").slice(11, 16)}</span>
            {fcFields && fcFields.path && fcFields.path.length > 0 && (
              <span className="vg-note">path: {fcFields.path.map((x) => x.price).join(" → ")}</span>)}
            <button className="vg-fc-pinned-x" onClick={() => setSelected(null)}>✕ clear</button>
          </div>)}

        {s && s.ict_htf && s.ict_htf.present && (
          <div className={cls("vg-fc-htf", s.ict_htf.tier === "A+" && "vg-fc-htf-ap")}>
            <span className="vg-fc-htf-tag">{s.ict_htf.tier === "A+" ? "⚡" : "•"} {s.ict_htf.tier} HOURLY SETUP</span>
            <b className={dirCls(s.ict_htf.dir === "long" ? 1 : -1)}>{s.ict_htf.dir.toUpperCase()}</b>
            <span className="vg-note">{s.ict_htf.reason}</span>
            <span className="vg-fc-htf-drop">→ drop to 5m/1m for entry</span>
            {Array.isArray(s.ict_htf.entry_zone) && (
              <span className="vg-note">zone {s.ict_htf.entry_zone[0]}–{s.ict_htf.entry_zone[1]} · invalid {s.ict_htf.invalid}</span>
            )}
          </div>)}

        {s && (
          <div className="vg-fc-legend">
            <span><i className="vg-lg-sw vg-lg-dash" style={{ borderColor: "var(--vg-up)" }} />coach support</span>
            <span><i className="vg-lg-sw vg-lg-dash" style={{ borderColor: "var(--vg-down)" }} />coach resistance</span>
            <span><i className="vg-lg-sw" style={{ background: "rgba(31,157,107,0.18)" }} />demand OB / bull FVG</span>
            <span><i className="vg-lg-sw" style={{ background: "rgba(217,59,78,0.18)" }} />supply OB / bear FVG</span>
            <span><i className="vg-lg-sw vg-lg-dot" style={{ borderColor: "rgb(184,122,22)" }} />liquidity pool (BSL/SSL)</span>
            <span><i className="vg-lg-sw vg-lg-dot" style={{ borderColor: "#7c5cff" }} />draw (magnet)</span>
            {fcFields && <span><i className="vg-lg-sw" style={{ background: "var(--vg-up)" }} />🎯 forecast + numbered path</span>}
          </div>)}

        {s
          ? <ForecastChart key={symbol} snap={s} forecast={fcFields} />
          : (
            <div className="vg-fc-empty">
              {snapQ.loading
                ? <p className="vg-note">Loading candles…</p>
                : <>
                    <p className="vg-note" style={{ marginBottom: 12 }}>
                      {snapQ.data && snapQ.data.note
                        ? snapQ.data.note
                        : `No stored 1m bars for ${symbol} yet.`}
                    </p>
                    <button className="vg-btn" disabled={preparing} onClick={prepare}>
                      {preparing
                        ? <><span className="vg-spin" aria-hidden="true">⟳</span> Fetching {symbol} data…</>
                        : `⤓ Fetch data & compute levels`}
                    </button>
                    {prepNote && <p className="vg-note" style={{ marginTop: 10 }}>{prepNote}</p>}
                  </>}
            </div>)}
      </div>
    </div>
  );
}

// The RAIL — the "what will price do?" panel + read + prior forecasts. Rendered in
// the app's right side panel (full height) so the chart gets the full width.
export function SpxPlaybookRail() {
  const p = usePlaybook();
  if (!p) return null;
  const { s, isPlaybook, busy, read, forecast, score, scoring, selected,
    setSelected, priors } = p;
  return (
    <div className="vg-pane-body vg-fc-rail">
      <div className="vg-card">
        <div className="vg-spread">
          <div className="vg-kicker" style={{ margin: 0 }}>What will price do?</div>
          <button className="vg-btn-sm" disabled={busy || !s || !isPlaybook} onClick={forecast}
            title={!isPlaybook ? "forecast needs coach levels (SPX / QQQ / IWM)" : undefined}>
            {busy ? <><span className="vg-spin" aria-hidden="true">⟳</span> Reading…</> : "🔮 Forecast now"}
          </button>
        </div>
        {!isPlaybook && (
          <p className="vg-note" style={{ marginTop: 8 }}>
            Chart only — the forecast reasons over coach levels, which need a GEX chain.
          </p>)}
        {read && (read.error
          ? <p className="vg-note" style={{ marginTop: 8, color: "var(--vg-down)" }}>{read.error}</p>
          : (read.data || read.text)
            ? <div style={{ marginTop: 10 }}><MiraRender data={read.data} text={read.text} /></div>
            : read.loading
              ? <p className="vg-note" style={{ marginTop: 8 }}>Reasoning over the liquidity, draw, and structure…</p>
              : (isPlaybook && s)
                ? <p className="vg-note" style={{ marginTop: 8 }}>Hit forecast for a scoreable directional read.</p>
                : null)}
      </div>

      {priors.data && priors.data.forecasts && priors.data.forecasts.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Prior forecasts</div>
          {priors.data.forecasts.map((f) => (
            <ForecastRow key={f.id} f={f} onScore={score} scoring={scoring}
              selected={selected && selected.id === f.id}
              onSelect={setSelected} />
          ))}
        </div>)}

      <p className="vg-note" style={{ fontSize: 11, color: "var(--vg-dim)" }}>
        Levels are the nightly EOD estimate · 0DTE-blind · not advice.
      </p>
    </div>
  );
}

// ── Replay Forecast ──────────────────────────────────────────────────────────
// Step a chosen day at an interval, fire a fresh forecast at each step, plot the
// whole SEQUENCE on one chart + a comparison table, then GRADE the run. The score
// is code (backend score_forecast); the grade is Mira narrating those numbers.

// a short HH:MM ET label for an as_of ISO string.
const hhmm = (iso) => String(iso || "").slice(11, 16);

// hue-ramp a forecast by its position in the run: early = cool blue, late = warm
// orange, so you can read the time-of-day of each path at a glance.
function rampColor(i, n, alpha) {
  const t = n > 1 ? i / (n - 1) : 0;              // 0 (early) → 1 (late)
  const hue = 210 - 210 * t;                       // 210 (blue) → 0 (red)
  return `hsla(${hue}, 75%, 55%, ${alpha})`;
}

// The multi-path replay chart: session candles + one faint projected path per
// forecast (hue-ramped by time), the selected/hovered one at full strength, and
// ALL step markers aggregated into a single setMarkers call (it replaces).
function ReplayChart({ snap, forecasts, activeId, etShiftSec = 0 }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const actualRef = useRef(null);                  // the real market path (line)
  const predSeriesRefs = useRef([]);               // one dashed line per forecast prediction

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
        scaleMargins: { top: 0.12, bottom: 0.12 }, autoScale: true },
      timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: LW.CrosshairMode.Normal },
      handleScale: { mouseWheel: true, pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true,
        horzTouchDrag: true, vertTouchDrag: true },
    });
    // the ACTUAL market path — a solid neutral line of the real closes, so the
    // forecasts can be read AGAINST what price actually did.
    const actual = chart.addLineSeries({
      color: th.text, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerVisible: true,
    });
    chartRef.current = chart; actualRef.current = actual;
    return () => { chart.remove(); chartRef.current = actualRef.current = null;
      predSeriesRefs.current = []; };
  }, []);

  // the actual market line: close of each candle, restricted to the run's day so
  // the chart frames the session (not the whole multi-day history). Fit once.
  const fittedRef = useRef(false);
  useEffect(() => {
    const actual = actualRef.current;
    const bars = snap && snap.bars_5m;
    if (!actual || !bars || !bars.length) return;
    const day = snap.day;
    // LightweightCharts renders the time axis in UTC, so an ET session (09:30-16:00)
    // would label as 13:30-20:00. We shift every time by the ET offset so the axis
    // prints ET wall-clock. The day-filter must use the SAME shifted time so a
    // 09:30-ET bar (13:30 UTC) is matched on the ET date, not the UTC date.
    const shifted = (t) => t + etShiftSec;
    const etDate = (t) => new Date(shifted(t) * 1000).toISOString().slice(0, 10);
    const dayBars = day ? bars.filter((b) => etDate(b.time) === day) : bars;
    const use = dayBars.length ? dayBars : bars;
    actual.setData(use.map((b) => ({ time: shifted(b.time), value: b.close })));
    if (chartRef.current) { chartRef.current.timeScale().fitContent(); fittedRef.current = true; }
  }, [snap, etShiftSec]);

  // predictions: ONE connected "predicted path" — each forecast's target plotted
  // at its call time, joined chronologically, so it reads as a single predicted
  // line laid against the actual line. Per-call hit/miss + call-time is carried by
  // the arrow markers on the actual line (a single line can't colour per-segment).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const LW = window.LightweightCharts;
    const th = chartTheme();
    for (const s of predSeriesRefs.current) { try { chart.removeSeries(s); } catch (e) { /* */ } }
    predSeriesRefs.current = [];
    const list = (forecasts || [])
      .filter((f) => f.plot && f.plot.target != null && f._t0)
      .slice().sort((a, b) => a._t0 - b._t0);
    const n = list.length;
    const markers = [];
    if (list.length) {
      // the connected predicted-path: (call time → its target), point per forecast.
      // Dedupe/monotonic time so LW accepts it; use a violet accent distinct from
      // the neutral actual line.
      const pts = [];
      let lastT = -Infinity;
      for (const f of list) {
        const base = f._t0 + etShiftSec;   // same ET display shift as the actual line
        const t = base <= lastT ? lastT + 1 : base;
        pts.push({ time: t, value: f.plot.target });
        lastT = t;
      }
      try {
        const ps = chart.addLineSeries({
          color: "rgba(124,92,255,0.95)", lineWidth: 2, lineStyle: LW.LineStyle.Solid,
          lastValueVisible: false, priceLineVisible: false,
          crosshairMarkerVisible: true, pointMarkersVisible: true,
        });
        ps.setData(pts);
        predSeriesRefs.current.push(ps);
      } catch (e) { /* older LW */ }
    }
    // arrow markers at each call time, tinted by OUTCOME (green hit / red miss),
    // on the ACTUAL line — so the connected predicted line stays one clean colour
    // while each call's correctness is still legible.
    list.forEach((f, i) => {
      const isActive = activeId != null && f.id === activeId;
      const sc = f.score || {};
      const good = sc.verdict === "hit target" || sc.verdict === "direction correct";
      const bad = sc.verdict === "invalidated" || sc.verdict === "direction wrong";
      const from = f.price_at != null ? f.price_at : f.plot.target;
      const up = f.plot.target >= from;
      markers.push({
        time: f._t0 + etShiftSec, position: up ? "aboveBar" : "belowBar",
        shape: up ? "arrowUp" : "arrowDown",
        color: good ? `rgb(${th.upRgb.join(",")})` : bad ? `rgb(${th.downRgb.join(",")})` : rampColor(i, n, 0.9),
        text: isActive ? `${hhmm(f.as_of)} → ${f.plot.target}` : hhmm(f.as_of),
      });
    });
    markers.sort((a, b) => a.time - b.time);
    try { if (actualRef.current) actualRef.current.setMarkers(markers); } catch (e) { /* */ }
  }, [snap, forecasts, activeId, etShiftSec]);

  if (!hasLW()) {
    return <p className="vg-note" style={{ marginTop: 8 }}>Chart unavailable (Lightweight Charts didn't load).</p>;
  }
  return <div ref={elRef} className="vg-fc-chart" />;
}

// The replay store: drives the plan → serial forecast loop → score, and holds the
// run state the view renders. Serial (one Mira turn at a time) with a Stop.
function useReplayStore() {
  const [symbol, setSymbol] = useState("SPX");
  const [entry, setEntry] = useState("SPX");
  const todayISO = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(todayISO);
  const [stepMin, setStepMin] = useState(15);
  const [premarket, setPremarket] = useState(false);
  const [note, setNote] = useState(null);
  const [runId, setRunId] = useState(null);
  const [runState, setRunState] = useState(null);   // {total, done, status} | null
  const [nonce, setNonce] = useState(0);
  const [activeId, setActiveId] = useState(null);    // hovered/selected row
  const [grade, setGrade] = useState(null);          // {loading|data|text|error}
  const stopRef = useRef(false);
  const abortRef = useRef(null);
  const runningRef = useRef(false);   // airtight re-entry guard (sync, not state)
  useEffect(() => () => { stopRef.current = true; if (abortRef.current) abortRef.current(); }, []);

  // the run's saved forecasts (+ scores + calibration), re-fetched on nonce bump.
  const runQ = useLive(() => (runId ? getReplay(runId) : Promise.resolve(null)),
    null, [runId, nonce]);

  // one Mira forecast for (day, asOf); resolves when the turn is done + saved.
  // `rid` is passed EXPLICITLY (not read from state) — the run_id is minted inside
  // `start` and the loop calls this before the setRunId re-render lands, so the
  // closed-over state value would still be stale (null).
  const forecastStep = (asOf, rid) => new Promise((resolve) => {
    getSpxSnapshot(day, asOf, symbol).then((snapEnv) => {
      const snapshot = snapEnv && snapEnv.available ? snapEnv : null;
      if (!snapshot) { resolve(false); return; }
      let text = "";
      const ref = `SPX_SNAPSHOT_REF day=${day} as_of=${asOf} underlying=${symbol}`;
      const prompt = `What will ${symbol} price do from here? Reason over the snapshot and give a structured, scoreable forecast (bias, expected path, level targets, invalidation, confidence).\n${ref}`;
      abortRef.current = streamTurn(prompt, `replay-${symbol}-${day}-${asOf}`, (evt) => {
        if (evt.kind === "error") { resolve(false); return; }
        if ((evt.kind === "token" || evt.kind === "delta" || evt.kind === "message") && evt.text) {
          text += evt.text; return;
        }
        if (evt.kind === "done") {
          abortRef.current = null;
          if (evt.text && !text) text = evt.text;
          const data = parseMira(text);
          saveSpxForecast({ day, as_of: asOf, symbol, snapshot,
            forecast: data || null, forecast_text: text, run_id: rid })
            .then(() => resolve(true)).catch(() => resolve(false));
        }
      });
    }).catch(() => resolve(false));
  });

  // PLAN → loop over steps (skipping any already saved for this run) → SCORE.
  const start = () => {
    // guard against re-entry: a second Run while one is in flight would mint a new
    // run_id and race the first loop's saves. Ignore it — Stop first to restart.
    // A ref (not the async `runState`) is the source of truth so overlapping calls
    // in the same tick can't both pass.
    if (runningRef.current) return;
    runningRef.current = true;
    setNote(null); setGrade(null); stopRef.current = false;
    setRunState({ status: "planning", total: 0, done: 0 });
    planReplay(day, symbol, premarket, stepMin).then(async (plan) => {
      if (!plan || !plan.available) {
        setRunState(null);
        setNote((plan && plan.note) || "Couldn't plan the run for that day.");
        return;
      }
      const rid = plan.run_id;
      setRunId(rid);
      const steps = plan.steps || [];
      // resume: skip as_ofs already saved for this run
      let existing = [];
      try { const g = await getReplay(rid); existing = (g && g.forecasts) || []; } catch (e) { /* */ }
      const done0 = new Set(existing.map((f) => f.as_of));
      setRunState({ status: "running", total: steps.length, done: done0.size });
      let stopped = false;
      for (let k = 0; k < steps.length; k++) {
        if (stopRef.current) { setRunState((r) => ({ ...r, status: "stopped" })); stopped = true; break; }
        const asOf = steps[k].as_of;
        if (!done0.has(asOf)) {
          await forecastStep(asOf, rid);
          setNonce((x) => x + 1);
        }
        setRunState((r) => ({ ...r, status: "running", done: k + 1 }));
      }
      if (!stopped) {
        // grade with code once the sequence is in
        try { await scoreReplay(rid); } catch (e) { /* score-later is fine */ }
        setRunState((r) => ({ ...(r || {}), status: "done", done: steps.length, total: steps.length }));
        setNonce((x) => x + 1);
      }
    }).catch((e) => { setRunState(null); setNote(String((e && e.message) || e)); })
      .finally(() => { runningRef.current = false; });
  };

  const stop = () => { stopRef.current = true; runningRef.current = false; if (abortRef.current) abortRef.current(); };

  const applySymbol = (sym) => {
    const s2 = String(sym || "").trim().toUpperCase();
    if (!s2) return;
    setSymbol(s2); setEntry(s2);
    setRunId(null); setRunState(null); setGrade(null); setNote(null);
  };

  // GRADE: persist the deterministic calibration, then stream the Mira grader over
  // the run. The grade NARRATES the code scores — it never produces a number.
  const gradeRun = () => {
    if (!runId) return;
    setGrade({ loading: true });
    calibrateReplay(runId).then(() => {
      let text = "";
      const ref = `FORECAST_GRADE_REF run_id=${runId}`;
      const prompt = `Grade this replay forecast run — how did the analyst's read evolve through the day? Read the code-computed scores and narrate them.\n${ref}`;
      abortRef.current = streamTurn(prompt, `grade-${runId}`, (evt) => {
        if (evt.kind === "error") { setGrade({ error: evt.message || "Mira error" }); return; }
        if ((evt.kind === "token" || evt.kind === "delta" || evt.kind === "message") && evt.text) {
          text += evt.text; setGrade({ loading: true, text }); return;
        }
        if (evt.kind === "done") {
          abortRef.current = null;
          if (evt.text && !text) text = evt.text;
          const data = parseMira(text);
          setGrade({ text, data });
          // persist the grader's PROSE back onto the calibration record so the
          // memory compounds (the SCORES were already written by calibrateReplay
          // above; here we only add the narrative — never a number).
          const narrative = (data && data.headline)
            || (text || "").replace(/\s+/g, " ").slice(0, 800) || null;
          calibrateReplay(runId, { narrative })
            .then(() => setNonce((x) => x + 1))
            .catch(() => setNonce((x) => x + 1));
        }
      });
    }).catch((e) => setGrade({ error: String((e && e.message) || e) }));
  };

  // the saved-runs list (newest first), re-pulled when a run completes (nonce).
  const runsQ = useLive(() => getReplays(40), null, [nonce]);

  // LOAD a saved run — point the view at an existing run_id (no new forecasting).
  // Sync the symbol/day inputs to it too so the header + snapshot match.
  const loadRun = (run) => {
    if (!run || !run.run_id) return;
    stop();                              // halt any in-flight run first
    runningRef.current = false;
    setSymbol(run.symbol || "SPX"); setEntry(run.symbol || "SPX");
    if (run.day) setDay(run.day);
    setGrade(null); setNote(null);
    setRunState({ status: "done", total: run.n || 0, done: run.n || 0 });
    setRunId(run.run_id);
    setNonce((x) => x + 1);
  };

  return {
    symbol, entry, setEntry, applySymbol, PLAYBOOK_SYMBOLS,
    day, setDay, stepMin, setStepMin, premarket, setPremarket,
    note, runId, runState, start, stop, runQ, runsQ, loadRun, activeId, setActiveId,
    grade, gradeRun, todayISO,
  };
}

// enrich a saved forecast row for the chart: parse its plot + attach the chart
// time anchor (t0) and bar spacing so the path can project forward from it.
function enrichForRun(forecasts, snap) {
  const bars = (snap && snap.bars_5m) || [];
  const lastT = bars.length ? bars[bars.length - 1].time : 0;
  const barSec = bars.length > 1 ? (bars[bars.length - 1].time - bars[bars.length - 2].time) || 300 : 300;
  // map each forecast's as_of (ET ISO) to the nearest candle time at-or-before it
  const toUnix = (iso) => Math.floor(new Date(iso).getTime() / 1000);
  return (forecasts || []).map((f) => {
    const ff = forecastFields(f.forecast);
    const fUnix = toUnix(f.as_of);
    // snap t0 to the candle at-or-before the forecast time (else the last bar)
    let t0 = lastT;
    for (const b of bars) { if (b.time <= fUnix) t0 = b.time; else break; }
    return { ...f, plot: { bias: ff.bias, target: ff.target, invalidation: ff.invalid, path: ff.path },
      _t0: t0, _barSec: barSec };
  });
}

// The Replay Forecast view: inputs, progress, the multi-path chart, the step
// comparison table, and the grade + calibration panel.
export function SpxReplayView() {
  const p = useReplayStore();
  const { symbol, entry, setEntry, applySymbol, day, setDay, stepMin, setStepMin,
    premarket, setPremarket, note, runId, runState, start, stop, runQ, runsQ, loadRun,
    activeId, setActiveId, grade, gradeRun, todayISO } = p;

  // the run's forecasts + a snapshot of the WHOLE day (as_of=null → full session)
  const rows = (runQ.data && runQ.data.forecasts) || [];
  const cal = runQ.data && runQ.data.calibration;
  const snapQ = useLive(() => (runId ? getSpxSnapshot(day, undefined, symbol) : Promise.resolve(null)),
    null, [runId, day, symbol, rows.length]);
  const snap = snapQ.data && snapQ.data.available ? snapQ.data : null;
  const enriched = snap ? enrichForRun(rows, snap) : [];

  // ET display shift: LightweightCharts renders its axis in UTC, so an ET session
  // would mislabel (09:30 ET → 13:30). Derive the session's ET offset from a
  // forecast's as_of (…-04:00 / -05:00) and shift chart times so the axis prints
  // ET wall-clock. Negative offset (behind UTC) → shift back by that many seconds.
  const etShiftSec = (() => {
    const iso = (rows[0] && rows[0].as_of) || "";
    const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60);
  })();

  const running = runState && (runState.status === "running" || runState.status === "planning");
  const pct = runState && runState.total ? Math.round((runState.done / runState.total) * 100) : 0;

  // 30-day 1m reach: clamp the date picker so the user can't pick a day the data
  // can't reach (the backend also reports it, but this is the honest UI guard).
  const minDay = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();

  return (
    <div className="vg-loadhost">
      {(running || snapQ.loading || (grade && grade.loading)) && <LoadBar />}

      <div className="vg-spread" style={{ marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>🎬 Replay Forecast — {symbol}</h2>
          <p className="vg-sub" style={{ margin: "4px 0 0" }}>
            Step the day, forecast at each interval, plot the sequence, grade the run.
          </p>
        </div>
      </div>

      <div className="vg-card" style={{ padding: 14, marginBottom: 12 }}>
        <form className="vg-fc-symbar" style={{ flexWrap: "wrap", gap: 10 }}
          onSubmit={(e) => { e.preventDefault(); applySymbol(entry); }}>
          {PLAYBOOK_SYMBOLS.map((sy) => (
            <button type="button" key={sy}
              className={cls("vg-fc-chip", sy === symbol && "vg-fc-chip-on")}
              onClick={() => applySymbol(sy)}>{sy}</button>
          ))}
          <input className="vg-fc-syminput" value={entry} spellCheck={false}
            onChange={(e) => setEntry(e.target.value.toUpperCase())}
            placeholder="symbol" aria-label="replay symbol" />
          <label className="vg-note">day{" "}
            <input type="date" value={day} min={minDay} max={todayISO}
              onChange={(e) => setDay(e.target.value)} aria-label="replay day" />
          </label>
          <label className="vg-note">every{" "}
            <select value={stepMin} onChange={(e) => setStepMin(Number(e.target.value))}
              aria-label="replay interval">
              <option value={5}>5m</option>
              <option value={15}>15m</option>
              <option value={30}>30m</option>
              <option value={60}>60m</option>
            </select>
          </label>
          <label className="vg-note" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={premarket}
              onChange={(e) => setPremarket(e.target.checked)} /> pre-market
          </label>
          {running
            ? <button type="button" className="vg-btn-sm" onClick={stop}>■ Stop</button>
            : <button type="submit" className="vg-btn" onClick={(e) => { e.preventDefault(); if (entry !== symbol) applySymbol(entry); start(); }}>
                ▶ Run replay
              </button>}
        </form>

        {runState && (
          <div style={{ marginTop: 10 }}>
            <div className="vg-note">
              {runState.status === "planning" ? "Priming data & planning steps…"
                : runState.status === "running" ? `Forecasting ${runState.done}/${runState.total} …`
                : runState.status === "stopped" ? `Stopped at ${runState.done}/${runState.total}`
                : `Done — ${runState.total} forecasts.`}
            </div>
            <div className="vg-fc-progress"><div className="vg-fc-progress-bar" style={{ width: `${pct}%` }} /></div>
          </div>)}
        {note && <p className="vg-note" style={{ marginTop: 8, color: "var(--vg-down)" }}>{note}</p>}
      </div>

      {runsQ.data && runsQ.data.runs && runsQ.data.runs.length > 0 && (
        <div className="vg-card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="vg-kicker" style={{ margin: "0 0 8px" }}>Saved runs</div>
          <div className="vg-fc-runlist">
            {runsQ.data.runs.map((r) => (
              <button key={r.run_id}
                className={cls("vg-fc-runchip", r.run_id === runId && "vg-fc-runchip-on")}
                onClick={() => loadRun(r)}
                title={`load ${r.symbol} ${r.day} — ${r.n} forecasts`}>
                <b>{r.symbol}</b>
                <span className="vg-note">{r.day}</span>
                <span className="vg-fc-runmeta">{r.n_scored}/{r.n} scored</span>
                {r.graded && <span className="vg-badge info" style={{ fontSize: 9 }}>graded</span>}
              </button>
            ))}
          </div>
        </div>)}

      {snap && enriched.length > 0 && (
        <div className="vg-card vg-fc-chartcard" style={{ padding: 14, marginBottom: 12 }}>
          <div className="vg-fc-legend" style={{ marginBottom: 8 }}>
            <span><i className="vg-lg-sw" style={{ background: "var(--vg-ink)" }} />actual price</span>
            <span><i className="vg-lg-sw" style={{ background: "#7c5cff" }} />predicted path</span>
            <span><i className="vg-lg-sw" style={{ background: "var(--vg-up)" }} />▲ call hit</span>
            <span><i className="vg-lg-sw" style={{ background: "var(--vg-down)" }} />▲ call missed</span>
          </div>
          <ReplayChart key={`${symbol}-${runId}`} snap={snap} forecasts={enriched}
            activeId={activeId} etShiftSec={etShiftSec} />
        </div>)}

      {rows.length > 0 && (
        <div className="vg-card" style={{ padding: 0, marginBottom: 12, overflowX: "auto" }}>
          <table className="vg-fc-cmp">
            <thead>
              <tr>
                <th>time</th><th>@ px</th><th>bias</th>
                <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th>
                <th>target</th><th>invalid</th><th>result</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((f) => {
                const path = (f.plot && f.plot.path) || [];
                const sc = f.score;
                const tone = !sc ? "plain"
                  : sc.verdict === "hit target" || sc.verdict === "direction correct" ? "good"
                  : sc.verdict === "invalidated" || sc.verdict === "direction wrong" ? "bad" : "plain";
                return (
                  <tr key={f.id}
                    className={cls("vg-fc-cmprow", activeId === f.id && "vg-fc-cmprow-on")}
                    onMouseEnter={() => setActiveId(f.id)} onMouseLeave={() => setActiveId(null)}>
                    <td>{hhmm(f.as_of)}</td>
                    <td>{f.price_at}</td>
                    <td className={dirCls(f.plot.bias === "up" ? 1 : f.plot.bias === "down" ? -1 : 0)}>
                      {f.plot.bias || "—"}</td>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <td key={i} className="vg-fc-cmpstep" title={path[i] ? path[i].note : ""}>
                        {path[i] ? path[i].price : ""}</td>))}
                    <td>{f.plot.target != null ? f.plot.target : "—"}</td>
                    <td>{f.plot.invalidation != null ? f.plot.invalidation : "—"}</td>
                    <td>{sc
                      ? <span className={cls("vg-badge", tone)} style={{ fontSize: 10 }}>{sc.verdict}</span>
                      : <span className="vg-note">—</span>}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>)}

      {rows.length > 0 && (
        <div className="vg-card" style={{ padding: 14 }}>
          <div className="vg-spread">
            <div className="vg-kicker" style={{ margin: 0 }}>Grade this run</div>
            <button className="vg-btn-sm" disabled={grade && grade.loading} onClick={gradeRun}>
              {grade && grade.loading ? <><span className="vg-spin" aria-hidden="true">⟳</span> Grading…</> : "⚖️ Grade the run"}
            </button>
          </div>
          <p className="vg-note" style={{ marginTop: 6, fontSize: 11, color: "var(--vg-dim)" }}>
            Scores are computed in code; the grader reads and narrates them — it never invents a number.
            The calibration below is grader-owned and read-only (never fed back to the forecaster).
          </p>
          {grade && (grade.error
            ? <p className="vg-note" style={{ marginTop: 8, color: "var(--vg-down)" }}>{grade.error}</p>
            : (grade.data || grade.text)
              ? <div style={{ marginTop: 10 }}><MiraRender data={grade.data} text={grade.text} /></div>
              : null)}

          {cal && cal.scores && (
            <div className="vg-fc-cal" style={{ marginTop: 12 }}>
              <div className="vg-kicker">Calibration record <span className="vg-note">(read-only)</span></div>
              <ReplayCalibration scores={cal.scores} />
            </div>)}
        </div>)}
    </div>
  );
}

// The deterministic calibration — hit-rate overall + by time/bias/tier. Insufficient
// buckets show "n<min" and NO rate (never a fabricated number).
function ReplayCalibration({ scores }) {
  const pctOf = (b) => (b && b.insufficient) ? "insufficient" : `${Math.round((b.hit_rate || 0) * 100)}% (${b.wins}/${b.n})`;
  const overall = scores.overall || {};
  const group = (label, obj) => (
    <div className="vg-fc-calgrp">
      <div className="vg-note" style={{ fontWeight: 600 }}>{label}</div>
      {Object.entries(obj || {}).map(([k, v]) => (
        <div key={k} className="vg-fc-calrow"><span>{k}</span><span>{pctOf(v)}</span></div>
      ))}
    </div>
  );
  return (
    <div>
      <div className="vg-fc-calrow" style={{ fontWeight: 600 }}>
        <span>Overall</span><span>{pctOf(overall)}</span></div>
      {group("By time of day", scores.by_time)}
      {group("By called bias", scores.by_bias)}
      {group("By hourly tier", scores.by_tier)}
    </div>
  );
}
