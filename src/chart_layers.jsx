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
    else chart.removeSeries(h.handle);
  } catch (e) { /* */ }
}
