// chart_drawings.jsx — render persisted drawings onto a Lightweight-Charts chart.
//
// A drawing is { id, kind, points:[{time,price}...], style:{color,width} }.
//   hline     — 1 point, drawn as a price line on the candle series.
//   trendline — 2 points, a segment between them (line series, 2 data points).
//   ray       — 2 points, extended to the last candle time (line series).
//   rect      — 2 points (opposite corners), outlined as a 5-point closed loop.
//
// Each drawing renders to one LWC handle we can remove: a price line (hline) or a
// line series (the rest). Returns the handle so the caller can track + tear down.
// Pure w.r.t. React — just LWC calls; kept out of chart_core so that file stays
// focused on the chart lifecycle.

const DEFAULT_COLOR = "#B97A16";  // vg-accent

export function drawOne(chart, candle, d) {
  const color = (d.style && d.style.color) || DEFAULT_COLOR;
  const width = (d.style && d.style.width) || 1.5;
  const pts = d.points || [];
  if (d.kind === "hline") {
    if (!pts.length) return null;
    const line = candle.createPriceLine({
      price: pts[0].price, color, lineWidth: Math.round(width),
      lineStyle: 0, axisLabelVisible: true, title: d.style?.label || "" });
    return { kind: "priceLine", handle: line };
  }
  // segment-based kinds → a line series with 2+ points, sorted by time.
  const series = chart.addLineSeries({
    color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
    crosshairMarkerVisible: false });
  series.setData(segmentData(d, chart));
  return { kind: "series", handle: series };
}

// Build the {time,value}[] a segment kind draws. Ray extends its slope to the
// right edge; rect outlines the box; trendline is just the two endpoints.
function segmentData(d, chart) {
  const [a, b] = d.points;
  if (d.kind === "rect") {
    const t0 = Math.min(a.time, b.time), t1 = Math.max(a.time, b.time);
    const p0 = a.price, p1 = b.price;
    // closed loop: TL → TR → BR → BL → TL (LWC line series needs ascending time,
    // so we can't truly close a box with one series; draw top+bottom+sides as a
    // zig that reads as a rectangle outline across ascending time).
    return sortByTime([
      { time: t0, value: p0 }, { time: t1, value: p0 },
      { time: t1, value: p1 }, { time: t0, value: p1 },
      { time: t0, value: p0 },
    ]);
  }
  if (d.kind === "ray") {
    const last = lastTime(chart) || Math.max(a.time, b.time);
    const [lo, hi] = a.time <= b.time ? [a, b] : [b, a];
    const slope = (hi.price - lo.price) / ((hi.time - lo.time) || 1);
    const endT = Math.max(hi.time, last);
    const endP = lo.price + slope * (endT - lo.time);
    return [{ time: lo.time, value: lo.price }, { time: endT, value: endP }];
  }
  // trendline
  return sortByTime([{ time: a.time, value: a.price }, { time: b.time, value: b.price }]);
}

function sortByTime(rows) { return rows.slice().sort((x, y) => x.time - y.time); }

function lastTime(chart) {
  try {
    const r = chart.timeScale().getVisibleRange();
    return r ? r.to : null;
  } catch (e) { return null; }
}

export function removeOne(chart, candle, drawn) {
  if (!drawn) return;
  try {
    if (drawn.kind === "priceLine") candle.removePriceLine(drawn.handle);
    else chart.removeSeries(drawn.handle);
  } catch (e) { /* */ }
}

// A short human label for a drawing (used in the drawings list + Mira context).
export function drawingLabel(d) {
  const pts = d.points || [];
  if (d.kind === "hline") return `line @ ${pts[0]?.price}`;
  if (d.kind === "rect") return `box ${pts[0]?.price}–${pts[1]?.price}`;
  const verb = d.kind === "ray" ? "ray" : "trend";
  return `${verb} ${pts[0]?.price}→${pts[1]?.price}`;
}
