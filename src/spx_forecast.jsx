// SpxForecastPanel — "what will price do?", chart-centric.
//
// A 5-min candle chart of the session (from the persisted 1m bars, resampled),
// with the coach's playbook levels drawn as labeled price lines, the ICT
// structures (active order blocks, fresh FVGs) as shaded zones, and — once you
// forecast — the analyst's TARGET (green) / INVALIDATION (red) / DRAW overlaid.
// Below the chart: the structured forecast (MiraRender) + prior forecasts with
// their accuracy score. The score is graded against elapsed price action.
import { cls, LoadBar } from "./util.jsx";
import { parseMira, MiraRender } from "./mira-render.jsx";
import { chartTheme } from "./charts.jsx";
import {
  useLive, streamTurn, getSpxSnapshot, saveSpxForecast,
  getSpxForecasts, scoreSpxForecast,
} from "./live.js";

const { useState, useRef, useEffect } = React;

const hasLW = () => typeof window !== "undefined"
  && !!(window.LightweightCharts && window.LightweightCharts.createChart);

// pull bias/target/invalidation out of the structured forecast (top-level or an
// A2UI keyvals row) so we can overlay them on the chart.
function forecastFields(data) {
  if (!data) return {};
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  let bias = data.bias, target = num(data.target), invalid = num(data.invalidation);
  for (const sec of data.sections || []) {
    for (const r of sec.rows || []) {
      const k = String(r.k || "").toLowerCase();
      if (!bias && k.includes("bias")) bias = String(r.v || "").toLowerCase();
      if (target == null && k.includes("target")) target = num(r.v);
      if (invalid == null && (k.includes("invalid") || k.includes("stop"))) invalid = num(r.v);
    }
  }
  return { bias: String(bias || "").toLowerCase(), target, invalid };
}

// The chart: candles + coach levels + ICT zones + (optional) forecast overlay.
function ForecastChart({ snap, forecast }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const linesRef = useRef([]);
  const zonesRef = useRef([]);

  // create once
  useEffect(() => {
    const el = elRef.current;
    if (!el || !hasLW()) return undefined;
    const LW = window.LightweightCharts;
    const th = chartTheme();
    const chart = LW.createChart(el, {
      autoSize: true, height: 340,
      layout: { background: { color: "transparent" }, textColor: th.text, fontSize: 11 },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      rightPriceScale: { borderColor: th.border },
      timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: LW.CrosshairMode.Normal },
    });
    const candle = chart.addCandlestickSeries({
      upColor: th.up, downColor: th.down, wickUpColor: th.up, wickDownColor: th.down,
      borderUpColor: th.up, borderDownColor: th.down,
    });
    chartRef.current = chart; candleRef.current = candle;
    return () => { chart.remove(); chartRef.current = candleRef.current = null;
      linesRef.current = []; zonesRef.current = []; };
  }, []);

  // candles
  useEffect(() => {
    const candle = candleRef.current;
    const bars = snap && snap.bars_5m;
    if (!candle || !bars || !bars.length) return;
    candle.setData(bars);
    if (chartRef.current) chartRef.current.timeScale().fitContent();
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

    // a shaded horizontal zone (OB / FVG) via a filled band series between top/bottom
    const addZone = (top, bottom, rgb, alpha) => {
      const area = chart.addBaselineSeries({
        baseValue: { type: "price", price: bottom },
        topFillColor1: `rgba(${rgb},${alpha})`, topFillColor2: `rgba(${rgb},${alpha})`,
        topLineColor: `rgba(${rgb},0)`, bottomLineColor: `rgba(${rgb},0)`,
        bottomFillColor1: "rgba(0,0,0,0)", bottomFillColor2: "rgba(0,0,0,0)",
        lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      });
      area.setData([{ time: t0, value: top }, { time: t1, value: top }]);
      zonesRef.current.push(area);
    };

    // coach levels — labeled price lines, tinted by role
    (snap.levels || []).forEach((lv) => {
      const lbl = String(lv.label || "");
      const isRes = /resist|call wall/i.test(lbl);
      const isSup = /support|put wall|max pain/i.test(lbl);
      const rgb = isRes ? th.downRgb : isSup ? th.upRgb : [176, 106, 0];
      addLine({
        price: lv.price,
        color: `rgba(${rgb.join(",")},0.55)`,
        lineWidth: /wall|max pain|durable/i.test(lbl) ? 2 : 1,
        lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true,
        title: lbl.replace(/\s*[★✦].*$/, "").slice(0, 22),
      });
    });

    // ICT order blocks (support/resistance zones) + fresh FVGs
    const ict = snap.ict || {};
    (ict.active_order_blocks || []).slice(0, 6).forEach((o) => {
      const rgb = o.side === "bull" ? th.upRgb : th.downRgb;
      addZone(o.top, o.bottom, rgb.join(","), 0.10);
    });
    (ict.fresh_fvgs || []).slice(0, 6).forEach((f) => {
      const rgb = f.side === "bull" ? th.upRgb : th.downRgb;
      addZone(f.hi, f.lo, rgb.join(","), 0.07);
    });

    // the forecast overlay: target (green), invalidation (red), draw marker
    if (forecast) {
      const { target, invalid } = forecast;
      if (target != null) addLine({
        price: target, color: `rgba(${th.upRgb.join(",")},0.95)`, lineWidth: 2,
        lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: `TARGET ${target}`,
      });
      if (invalid != null) addLine({
        price: invalid, color: `rgba(${th.downRgb.join(",")},0.95)`, lineWidth: 2,
        lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: `INVALID ${invalid}`,
      });
    } else if (ict.draw && ict.draw.level != null) {
      // before a forecast, mark the level-based DRAW so the "what next" is visible
      addLine({
        price: ict.draw.level, color: "rgba(124,92,255,0.9)", lineWidth: 2,
        lineStyle: LW.LineStyle.Dotted, axisLabelVisible: true,
        title: `DRAW ${ict.draw.dir === "up" ? "↑" : "↓"} ${ict.draw.level}`,
      });
    }
  }, [snap, forecast]);

  if (!hasLW()) {
    return <p className="vg-note" style={{ marginTop: 8 }}>Chart unavailable (Lightweight Charts didn't load).</p>;
  }
  return <div ref={elRef} className="vg-fc-chart" />;
}

// One stored forecast row (collapsible) with its score badge.
function ForecastRow({ f, onScore, scoring }) {
  const [open, setOpen] = useState(false);
  const sc = f.score;
  const tone = !sc ? "plain"
    : sc.verdict === "hit target" || sc.verdict === "direction correct" ? "good"
    : sc.verdict === "invalidated" || sc.verdict === "direction wrong" ? "bad" : "plain";
  return (
    <div className="vg-fc-row">
      <div className="vg-fc-rowhead" onClick={() => setOpen((v) => !v)}>
        <span className="vg-note">{f.day} · {String(f.as_of || "").slice(11, 16)}</span>
        <span className="vg-fc-price-sm">@ {f.price_at}</span>
        {sc
          ? <span className={cls("vg-badge", tone)} style={{ fontSize: 11 }}>{sc.verdict}{sc.moved_pt != null ? ` · ${sc.moved_pt >= 0 ? "+" : ""}${sc.moved_pt}pt` : ""}</span>
          : <button className="vg-btn-sm" disabled={scoring === f.id}
              onClick={(e) => { e.stopPropagation(); onScore(f.id); }}>
              {scoring === f.id ? "…" : "score it"}
            </button>}
        <span className="vg-fc-caret">{open ? "▾" : "▸"}</span>
      </div>
      {open && <div className="vg-fc-rowbody"><MiraRender data={f.forecast} text={f.forecast_text} /></div>}
    </div>
  );
}

export function SpxForecastPanel({ symbol = "SPX" }) {
  const [nonce, setNonce] = useState(0);
  const snapQ = useLive(() => getSpxSnapshot(), null, [nonce]);
  const priors = useLive(() => getSpxForecasts(undefined, symbol, 30), null, [nonce]);
  const [read, setRead] = useState(null);
  const [scoring, setScoring] = useState(null);
  const abortRef = useRef(null);
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);

  const s = snapQ.data && snapQ.data.available ? snapQ.data : null;
  const busy = read && read.loading;
  const fcFields = read && read.data ? forecastFields(read.data) : null;

  const forecast = () => {
    if (!s) return;
    setRead({ loading: true });
    let text = "";
    const ref = `SPX_SNAPSHOT_REF day=${s.day} as_of=${s.as_of} underlying=${symbol}`;
    const prompt = `What will ${symbol} price do from here? Reason over the snapshot and give a structured, scoreable forecast (bias, expected path, level targets, invalidation, confidence).\n${ref}`;
    abortRef.current = streamTurn(prompt, `spx-forecast-${s.day}-${s.as_of}`, (evt) => {
      if (evt.kind === "error") { setRead({ error: evt.message || "Mira error" }); return; }
      if (evt.kind === "delta") { text += evt.text || ""; setRead({ loading: true, text }); return; }
      if (evt.kind === "done") {
        abortRef.current = null;
        const data = parseMira(text);
        setRead({ text, data });
        saveSpxForecast({ day: s.day, as_of: s.as_of, symbol, snapshot: s,
          forecast: data || null, forecast_text: text })
          .then(() => setNonce((n) => n + 1)).catch(() => {});
      }
    });
  };

  const score = (fid) => {
    setScoring(fid);
    scoreSpxForecast(fid).then(() => setNonce((n) => n + 1)).finally(() => setScoring(null));
  };

  const t = (s && s.technicals) || {};
  const draw = (s && s.ict && s.ict.draw) || {};

  return (
    <div className="vg-card vg-fc vg-loadhost" style={{ marginTop: 14 }}>
      {(snapQ.loading || busy) && <LoadBar />}
      <div className="vg-spread">
        <div className="vg-kicker" style={{ margin: 0 }}>What will price do? · SPX analyst</div>
        <button className="vg-btn-sm" disabled={busy || !s} onClick={forecast}>
          {busy ? <><span className="vg-spin" aria-hidden="true">⟳</span> Reading the tape…</> : "🔮 Forecast now"}
        </button>
      </div>

      {!s && !snapQ.loading && (
        <p className="vg-note" style={{ marginTop: 8 }}>
          {snapQ.data && snapQ.data.note ? snapQ.data.note : "No snapshot yet — needs the day's 1m bars."}
        </p>)}

      {s && (
        <div className="vg-fc-tapehead">
          <b>{s.price}</b>
          <span className="vg-note">{s.day} · {String(s.as_of || "").slice(11, 16)} ET</span>
          <span className="vg-fc-tape">
            VWAP {t.vwap} ({t.vs_vwap_pt >= 0 ? "+" : ""}{t.vs_vwap_pt}) · RSI {t.rsi} · vol {t.rel_volume}×
            {draw.dir ? <> · draw {draw.dir} → <b>{draw.level}</b></> : null}
          </span>
        </div>)}

      {s && <ForecastChart snap={s} forecast={fcFields} />}

      {read && (read.error
        ? <p className="vg-note" style={{ marginTop: 8, color: "var(--vg-down)" }}>{read.error}</p>
        : (read.data || read.text)
          ? <div style={{ marginTop: 10 }}><MiraRender data={read.data} text={read.text} /></div>
          : read.loading ? <p className="vg-note" style={{ marginTop: 8 }}>Reasoning over the liquidity, draw, and structure…</p> : null)}

      {priors.data && priors.data.forecasts && priors.data.forecasts.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="vg-kicker">Prior forecasts</div>
          {priors.data.forecasts.map((f) => (
            <ForecastRow key={f.id} f={f} onScore={score} scoring={scoring} />
          ))}
        </div>)}
      <p className="vg-note" style={{ marginTop: 10, fontSize: 11, color: "var(--vg-dim)" }}>
        Levels are the nightly EOD estimate · 0DTE-blind · not advice.
      </p>
    </div>
  );
}
