// chart_layers.jsx — draw Vantage-DNA layers onto the InstrumentChart.
//
// Each layer group (coach levels, ICT order blocks, FVGs, liquidity, the DRAW,
// prior-day H/L/C, GEX anchors) is drawn independently and returns the LWC handles
// it created, so the caller can toggle a group on/off by drawing/removing just its
// handles. Adapted from the proven Playbook overlay (spx_forecast.jsx) and
// generalized: data comes from GET /api/chart/{symbol}/layers.
//
// A price line hangs off the candle series; a shaded zone is a baseline series
// spanning the visible time range. Handles are {kind:'line'|'zone', handle}.
import { chartTheme } from "./charts.jsx";

// how many of each ICT structure to draw (nearest to price) — the multi-day scan
// can surface many; drawing them all is noise.
const NEAR_N = 5;

function timeSpan(candles) {
  if (!candles || !candles.length) return [0, 0];
  return [candles[0].time, candles[candles.length - 1].time];
}
function nearest(arr, mid, px, n) {
  return (arr || []).slice()
    .sort((a, b) => Math.abs(mid(a) - px) - Math.abs(mid(b) - px)).slice(0, n);
}

// A single layer group's draw fn. Returns an array of handles to remove later.
// `ctx` = { chart, candle, LW, candles, layers, price }.
export const LAYER_DRAWERS = {
  levels(ctx) {
    const th = chartTheme();
    const out = [];
    for (const lv of ctx.layers.levels || []) {
      const lbl = String(lv.label || "");
      const isRes = /resist|call wall/i.test(lbl);
      const isSup = /support|put wall|max pain/i.test(lbl);
      const rgb = isRes ? th.downRgb : isSup ? th.upRgb : [176, 106, 0];
      out.push({ kind: "line", handle: ctx.candle.createPriceLine({
        price: lv.price, color: `rgba(${rgb.join(",")},0.6)`,
        lineWidth: /wall|max pain|durable/i.test(lbl) ? 2 : 1,
        lineStyle: ctx.LW.LineStyle.Dashed, axisLabelVisible: true,
        title: lbl.replace(/\s*[★✦].*$/, "").slice(0, 20) }) });
    }
    return out;
  },

  orderBlocks(ctx) {
    const th = chartTheme();
    const [t0, t1] = timeSpan(ctx.candles);
    return nearest(ctx.layers.order_blocks, (o) => (o.top + o.bottom) / 2, ctx.price, NEAR_N)
      .map((o) => {
        const rgb = (o.side === "bull" ? th.upRgb : th.downRgb).join(",");
        return zone(ctx, t0, t1, o.top, o.bottom, rgb, 0.14,
          `${o.side === "bull" ? "demand" : "supply"} OB`);
      }).flat();
  },

  fvgs(ctx) {
    const th = chartTheme();
    const [t0, t1] = timeSpan(ctx.candles);
    return nearest(ctx.layers.fvgs, (f) => (f.hi + f.lo) / 2, ctx.price, NEAR_N)
      .map((f) => {
        const rgb = (f.side === "bull" ? th.upRgb : th.downRgb).join(",");
        return zone(ctx, t0, t1, f.hi, f.lo, rgb, 0.10,
          `${f.side === "bull" ? "bull" : "bear"} FVG`);
      }).flat();
  },

  liquidity(ctx) {
    const liq = ctx.layers.liquidity || {};
    const rgb = "184,122,22";  // amber, distinct from coach/OB/FVG
    const out = [];
    for (const p of nearest(liq.bsl, (x) => x, ctx.price, 4)) {
      out.push(line(ctx, p, rgb, 0.6, ctx.LW.LineStyle.Dotted, "BSL"));
    }
    for (const p of nearest(liq.ssl, (x) => x, ctx.price, 4)) {
      out.push(line(ctx, p, rgb, 0.6, ctx.LW.LineStyle.Dotted, "SSL"));
    }
    return out;
  },

  draw(ctx) {
    const d = ctx.layers.draw;
    if (!d || d.level == null) return [];
    return [line(ctx, d.level, "124,92,255", 0.9, ctx.LW.LineStyle.Dotted,
      `DRAW ${d.dir === "up" ? "↑" : "↓"}`, 2)];
  },

  prior(ctx) {
    const p = ctx.layers.prior || {};
    const out = [];
    const mk = (price, label) => price != null &&
      out.push(line(ctx, price, "120,120,130", 0.7, ctx.LW.LineStyle.Dashed, label));
    mk(p.prev_high, "PDH"); mk(p.prev_low, "PDL"); mk(p.prev_close, "PDC");
    return out;
  },

  gex(ctx) {
    const g = ctx.layers.gex || {};
    const th = chartTheme();
    const out = [];
    const mk = (price, label, rgb) => price != null &&
      out.push(line(ctx, price, rgb, 0.8, ctx.LW.LineStyle.Solid, label, 1));
    mk(g.call_wall, "call wall", th.downRgb.join(","));
    mk(g.put_wall, "put wall", th.upRgb.join(","));
    mk(g.gamma_flip, "γ flip", "176,106,0");
    mk(g.max_pain, "max pain", "120,120,130");
    return out;
  },

  // the analyst's latest forecast: TARGET (green) / INVALIDATION (red) as reference
  // lines, and the numbered predicted PATH projected forward from the last candle
  // into the empty right space (so it reads "from here, price goes 1→2→3…").
  // Adapted from the Playbook overlay (spx_forecast.jsx). Reads ctx.forecast.
  forecast(ctx) {
    const fc = ctx.forecast;
    if (!fc) return [];
    const th = chartTheme();
    const out = [];
    if (fc.target != null) out.push({ kind: "line", handle: ctx.candle.createPriceLine({
      price: fc.target, color: `rgb(${th.upRgb.join(",")})`, lineWidth: 2,
      lineStyle: ctx.LW.LineStyle.Solid, axisLabelVisible: true, title: "🎯 TARGET" }) });
    if (fc.invalidation != null) out.push({ kind: "line", handle: ctx.candle.createPriceLine({
      price: fc.invalidation, color: `rgb(${th.downRgb.join(",")})`, lineWidth: 2,
      lineStyle: ctx.LW.LineStyle.Solid, axisLabelVisible: true, title: "✕ INVALID" }) });

    // project the path forward: one bar per step from the last candle, at each
    // step's price, with a numbered arrow marker carrying the step's note.
    const steps = (fc.path || []).filter((s) => s.price != null);
    const candles = ctx.candles;
    if (steps.length && candles.length) {
      const t1 = candles[candles.length - 1].time;
      const barSec = candles.length > 1
        ? (candles[candles.length - 1].time - candles[candles.length - 2].time) || 300 : 300;
      const px0 = ctx.price || candles[candles.length - 1].close;
      const data = [{ time: t1, value: px0 }];
      const markers = [];
      const down = fc.bias === "down";
      steps.forEach((st, i) => {
        const tt = t1 + barSec * (i + 1);
        data.push({ time: tt, value: st.price });
        markers.push({ time: tt, position: down ? "belowBar" : "aboveBar",
          shape: down ? "arrowDown" : "arrowUp",
          color: down ? `rgb(${th.downRgb.join(",")})` : `rgb(${th.upRgb.join(",")})`,
          text: `${st.seq} · ${st.price}${st.note ? " " + st.note : ""}`.slice(0, 34) });
      });
      try {
        const ps = ctx.chart.addLineSeries({ color: "rgba(124,92,255,0.95)", lineWidth: 2,
          lineStyle: ctx.LW.LineStyle.Dashed, lastValueVisible: false,
          priceLineVisible: false, crosshairMarkerVisible: false });
        ps.setData(data);
        ps.setMarkers(markers);
        out.push({ kind: "series", handle: ps });
      } catch (e) { /* older LW builds — skip the projection */ }
    }
    return out;
  },

  // a saved REPLAY run: the sequence of that day's forecasts drawn on the chart —
  // a marker at each forecast's origin (as_of / price_at) colored by its graded
  // verdict (hit target = green, invalidated = red, else neutral), plus a faint
  // target line per forecast. Reads ctx.replay = {forecasts:[{as_of_ts, price_at,
  // target, verdict}]}. Read-only; drawn from already-stored scores (no Mira).
  replay(ctx) {
    const rp = ctx.replay;
    if (!rp || !rp.forecasts || !rp.forecasts.length) return [];
    const th = chartTheme();
    const out = [];
    const markers = [];
    const [t0, t1] = timeSpan(ctx.candles);
    for (const f of rp.forecasts) {
      if (f.as_of_ts == null || f.price_at == null) continue;
      // only mark forecasts whose origin falls within the visible candle range.
      if (t0 && t1 && (f.as_of_ts < t0 || f.as_of_ts > t1)) continue;
      const hit = f.verdict === "hit target";
      const bad = f.verdict === "invalidated";
      const color = hit ? `rgb(${th.upRgb.join(",")})`
        : bad ? `rgb(${th.downRgb.join(",")})` : "rgb(176,106,0)";
      markers.push({ time: f.as_of_ts, position: "aboveBar", shape: "circle", color,
        text: `${f.target != null ? "→" + f.target : ""} ${f.verdict || ""}`.trim().slice(0, 22) });
    }
    if (markers.length) {
      // markers must be sorted by time for LWC.
      markers.sort((a, b) => a.time - b.time);
      try { ctx.candle.setMarkers(markers); out.push({ kind: "markers", handle: null }); }
      catch (e) { /* */ }
    }
    return out;
  },
};

// the toggleable layer chips (order = draw order top→bottom in the toolbar).
// `needsLevels` marks the ones that require a playbook symbol (coach/GEX).
export const LAYERS = [
  { key: "levels", label: "Levels", needsLevels: true },
  { key: "orderBlocks", label: "OB", needsLevels: false },
  { key: "fvgs", label: "FVG", needsLevels: false },
  { key: "liquidity", label: "Liq", needsLevels: false },
  { key: "draw", label: "Draw", needsLevels: false },
  { key: "prior", label: "PD H/L/C", needsLevels: false },
  { key: "gex", label: "GEX", needsLevels: true },
  { key: "forecast", label: "Forecast", needsLevels: false, needsForecast: true },
  { key: "replay", label: "Replay", needsLevels: false, needsReplay: true },
];

// ── primitives ───────────────────────────────────────────────────────────────
function line(ctx, price, rgb, alpha, style, title, width = 1) {
  return { kind: "line", handle: ctx.candle.createPriceLine({
    price, color: `rgba(${rgb},${alpha})`, lineWidth: width,
    lineStyle: style, axisLabelVisible: true, title }) };
}
function zone(ctx, t0, t1, top, bottom, rgb, alpha, tag) {
  const area = ctx.chart.addBaselineSeries({
    baseValue: { type: "price", price: bottom },
    topFillColor1: `rgba(${rgb},${alpha})`, topFillColor2: `rgba(${rgb},${alpha})`,
    topLineColor: `rgba(${rgb},0.5)`, bottomLineColor: `rgba(${rgb},0.5)`,
    bottomFillColor1: "rgba(0,0,0,0)", bottomFillColor2: "rgba(0,0,0,0)",
    lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  area.setData([{ time: t0, value: top }, { time: t1, value: top }]);
  const handles = [{ kind: "zone", handle: area }];
  if (tag) handles.push({ kind: "line", handle: ctx.candle.createPriceLine({
    price: top, color: `rgba(${rgb},0.9)`, lineWidth: 1,
    lineStyle: ctx.LW.LineStyle.Dotted, axisLabelVisible: false, title: tag }) });
  return handles;
}

export function removeLayerHandle(chart, candle, h) {
  if (!h) return;
  try {
    if (h.kind === "line") candle.removePriceLine(h.handle);
    else if (h.kind === "markers") candle.setMarkers([]);  // clear replay origin markers
    else chart.removeSeries(h.handle);
  } catch (e) { /* */ }
}
