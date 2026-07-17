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
  getSpxForecasts, scoreSpxForecast, prepareSpx,
} from "./live.js";

const { useState, useRef, useEffect } = React;

// symbols that get coach levels + forecast (the engine needs a GEX chain).
const PLAYBOOK_SYMBOLS = ["SPX", "QQQ", "IWM"];

const hasLW = () => typeof window !== "undefined"
  && !!(window.LightweightCharts && window.LightweightCharts.createChart);

// pull bias/target/invalidation out of the structured forecast (top-level or an
// A2UI keyvals row) so we can overlay them on the chart.
function forecastFields(data) {
  if (!data) return {};
  // The analyst emits prose values ("Sweep 7504.0 SSL, then reclaim to 7529.4"),
  // not bare numbers — so pull the FIRST price-shaped number out of the string.
  const firstPrice = (v) => {
    if (v == null) return null;
    const m = String(v).match(/\d{2,6}(?:\.\d+)?/);
    const n = m ? parseFloat(m[0]) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  let bias = data.bias, target = firstPrice(data.target), invalid = firstPrice(data.invalidation);
  for (const sec of data.sections || []) {
    for (const r of sec.rows || []) {
      const k = String(r.k || "").toLowerCase();
      // take the primary downside/main target — skip the "if wrong" upside row
      if (!bias && k.includes("bias")) bias = String(r.v || "").toLowerCase();
      if (target == null && k.includes("target") && !/upside|wrong|if /.test(k)) target = firstPrice(r.v);
      if (invalid == null && (k.includes("invalid") || k.includes("stop"))) invalid = firstPrice(r.v);
    }
  }
  // bias words → up/down for the overlay
  const b = String(bias || "").toLowerCase();
  const biasDir = /down|bear|short/.test(b) ? "down" : /up|bull|long/.test(b) ? "up" : b;
  return { bias: biasDir, target, invalid };
}

// The chart: candles + coach levels + ICT zones + (optional) forecast overlay.
function ForecastChart({ snap, forecast }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const linesRef = useRef([]);
  const zonesRef = useRef([]);
  const markedRef = useRef(false);

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
      // room and don't clip against the edge.
      rightPriceScale: { borderColor: th.border, minimumWidth: 116,
        scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false,
        rightOffset: 3 },
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
        title: lbl.replace(/\s*[★✦].*$/, "").slice(0, 20),
      });
    });

    // ICT order blocks (support/resistance zones) + fresh FVGs — directional
    // tint (green = demand/bullish, red = supply/bearish) + a text tag.
    const ict = snap.ict || {};
    (ict.active_order_blocks || []).slice(0, 4).forEach((o) => {
      const rgb = (o.side === "bull" ? th.upRgb : th.downRgb).join(",");
      addZone(o.top, o.bottom, rgb, 0.14, `${o.side === "bull" ? "demand" : "supply"} OB`);
    });
    (ict.fresh_fvgs || []).slice(0, 4).forEach((f) => {
      const rgb = (f.side === "bull" ? th.upRgb : th.downRgb).join(",");
      addZone(f.hi, f.lo, rgb, 0.10, `${f.side === "bull" ? "bull" : "bear"} FVG`);
    });

    // the level-based DRAW (the magnet) — always shown; violet, distinct.
    if (ict.draw && ict.draw.level != null) addLine({
      price: ict.draw.level, color: "rgba(124,92,255,0.9)", lineWidth: 2,
      lineStyle: LW.LineStyle.Dotted, axisLabelVisible: true,
      title: `DRAW ${ict.draw.dir === "up" ? "↑" : "↓"}`,
    });

    // the FORECAST overlay — the loudest thing on the chart: thick solid green
    // TARGET / red INVALIDATION lines, plus a marker on the bar it was called.
    if (forecast) {
      const { target, invalid } = forecast;
      if (target != null) addLine({
        price: target, color: `rgb(${th.upRgb.join(",")})`, lineWidth: 3,
        lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: `🎯 TARGET`,
      });
      if (invalid != null) addLine({
        price: invalid, color: `rgb(${th.downRgb.join(",")})`, lineWidth: 3,
        lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: `✕ INVALID`,
      });
      // a marker at the forecast's origin bar so "called from here" is visible
      if (t1) {
        try {
          candle.setMarkers([{
            time: t1, position: "aboveBar", shape: "circle",
            color: "rgb(124,92,255)", text: "forecast",
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

// The full-screen 0DTE Playbook: a chart-centric forecast workspace. Enter any
// symbol → its 5m candle chart. For the playbook symbols (SPX / QQQ / IWM) the
// coach levels + ICT structures overlay and the "what will price do?" forecast
// works. When a symbol has no stored bars yet, a "fetch data" button seeds them
// on demand. Left: chart. Right rail: tape, forecast button, structured read,
// prior forecasts with accuracy scores.
export function SpxPlaybookView({ initialSymbol = "SPX" }) {
  const [symbol, setSymbolState] = useState((initialSymbol || "SPX").toUpperCase());
  const [entry, setEntry] = useState(symbol);
  const [nonce, setNonce] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [prepNote, setPrepNote] = useState(null);
  const [read, setRead] = useState(null);
  const [scoring, setScoring] = useState(null);
  const abortRef = useRef(null);
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);

  const snapQ = useLive(() => getSpxSnapshot(undefined, undefined, symbol), null, [symbol, nonce]);
  const priors = useLive(() => getSpxForecasts(undefined, symbol, 30), null, [symbol, nonce]);

  const s = snapQ.data && snapQ.data.available ? snapQ.data : null;
  const isPlaybook = PLAYBOOK_SYMBOLS.includes(symbol);
  const busy = read && read.loading;
  const fcFields = read && read.data ? forecastFields(read.data) : null;

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

  const forecast = () => {
    if (!s) return;
    setRead({ loading: true });
    let text = "";
    const ref = `SPX_SNAPSHOT_REF day=${s.day} as_of=${s.as_of} underlying=${symbol}`;
    const prompt = `What will ${symbol} price do from here? Reason over the snapshot and give a structured, scoreable forecast (bias, expected path, level targets, invalidation, confidence).\n${ref}`;
    abortRef.current = streamTurn(prompt, `spx-forecast-${symbol}-${s.day}-${s.as_of}`, (evt) => {
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
        <form
          className="vg-fc-symbar"
          onSubmit={(e) => { e.preventDefault(); applySymbol(entry); }}
        >
          {PLAYBOOK_SYMBOLS.map((sy) => (
            <button
              type="button" key={sy}
              className={cls("vg-fc-chip", sy === symbol && "vg-fc-chip-on")}
              onClick={() => applySymbol(sy)}
            >{sy}</button>
          ))}
          <input
            className="vg-fc-syminput" value={entry} spellCheck={false}
            onChange={(e) => setEntry(e.target.value.toUpperCase())}
            placeholder="symbol" aria-label="chart symbol"
          />
          <button className="vg-btn-sm" type="submit">Load</button>
        </form>
      </div>

      <div className="vg-fc-grid">
        <div className="vg-card vg-fc-chartcard" style={{ padding: 14 }}>
          {s && (
            <div className="vg-fc-tapehead">
              <b>{s.price}</b>
              <span className="vg-note">{s.day} · {String(s.as_of || "").slice(11, 16)} ET</span>
              <span className="vg-fc-tape">
                VWAP {t.vwap} ({t.vs_vwap_pt >= 0 ? "+" : ""}{t.vs_vwap_pt}) · RSI {t.rsi} · vol {t.rel_volume}×
                {draw.dir ? <> · draw {draw.dir} → <b>{draw.level}</b></> : null}
              </span>
            </div>)}

          {s && (
            <div className="vg-fc-legend">
              <span><i className="vg-lg-sw vg-lg-dash" style={{ borderColor: "var(--vg-up)" }} />coach support</span>
              <span><i className="vg-lg-sw vg-lg-dash" style={{ borderColor: "var(--vg-down)" }} />coach resistance</span>
              <span><i className="vg-lg-sw" style={{ background: "rgba(31,157,107,0.18)" }} />demand OB / bull FVG</span>
              <span><i className="vg-lg-sw" style={{ background: "rgba(217,59,78,0.18)" }} />supply OB / bear FVG</span>
              <span><i className="vg-lg-sw vg-lg-dot" style={{ borderColor: "#7c5cff" }} />draw (magnet)</span>
              {fcFields && <span><i className="vg-lg-sw" style={{ background: "var(--vg-up)" }} />🎯 forecast target / invalidation</span>}
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

        <div className="vg-fc-rail">
          <div className="vg-card">
            <div className="vg-spread">
              <div className="vg-kicker" style={{ margin: 0 }}>What will price do?</div>
              <button
                className="vg-btn-sm" disabled={busy || !s || !isPlaybook} onClick={forecast}
                title={!isPlaybook ? "forecast needs coach levels (SPX / QQQ / IWM)" : undefined}
              >
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
                <ForecastRow key={f.id} f={f} onScore={score} scoring={scoring} />
              ))}
            </div>)}

          <p className="vg-note" style={{ fontSize: 11, color: "var(--vg-dim)" }}>
            Levels are the nightly EOD estimate · 0DTE-blind · not advice.
          </p>
        </div>
      </div>
    </div>
  );
}

// Back-compat alias (older mounts referenced SpxForecastPanel).
export const SpxForecastPanel = SpxPlaybookView;
