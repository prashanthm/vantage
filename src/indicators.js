// indicators.js — pure client-side technical indicators computed from LWC candles.
//
// Every function takes the candle array ({time, open, high, low, close, volume?})
// the chart already has and returns LWC-ready series data ({time, value}[]) or,
// for volume/POC, the histogram rows + a point-of-control price. No server round
// trip — the indicators layer draws straight from the candles in memory.
//
// Kept framework-free and side-effect-free so it unit-tests without a DOM.

// Simple moving average of closes over `period`. Emits a point only once enough
// bars exist (LWC line series tolerate a shorter series than the candles).
export function sma(candles, period) {
  if (!candles || candles.length < period || period < 1) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: round(sum / period) });
  }
  return out;
}

// Session-anchored VWAP: cumulative (typical-price · volume) / cumulative volume,
// restarting each calendar day (in UTC — matches how bars are stored). Meaningful
// only when volume is present; returns [] if the series carries no volume.
export function vwap(candles) {
  if (!candles || !candles.length) return [];
  if (!candles.some((c) => (c.volume || 0) > 0)) return [];
  const out = [];
  let day = null, pv = 0, vol = 0;
  for (const c of candles) {
    const d = dayKey(c.time);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const tp = (c.high + c.low + c.close) / 3;
    const v = c.volume || 0;
    pv += tp * v; vol += v;
    if (vol > 0) out.push({ time: c.time, value: round(pv / vol) });
  }
  return out;
}

// Wilder's RSI over `period` (default 14), emitted as {time, value} in 0..100.
// Uses Wilder smoothing (the standard) after the first `period` seed average.
export function rsi(candles, period = 14) {
  if (!candles || candles.length <= period) return [];
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgG = gain / period, avgL = loss / period;
  const out = [{ time: candles[period].time, value: rsiVal(avgG, avgL) }];
  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out.push({ time: candles[i].time, value: rsiVal(avgG, avgL) });
  }
  return out;
}

// Volume histogram rows (green/red by candle direction) + the point-of-control:
// the price level (bucketed) where the most volume traded across the window.
// Returns { bars: {time, value, color}[], poc: number|null }. Empty if no volume.
export function volumeProfile(candles, up, down, buckets = 60) {
  if (!candles || !candles.length || !candles.some((c) => (c.volume || 0) > 0)) {
    return { bars: [], poc: null };
  }
  const bars = candles.map((c) => ({
    time: c.time, value: c.volume || 0,
    color: c.close >= c.open ? up : down,
  }));
  // POC via a price histogram: bin each candle's typical price weighted by volume.
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
  if (!(hi > lo)) return { bars, poc: null };
  const width = (hi - lo) / buckets;
  const acc = new Array(buckets).fill(0);
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    let b = Math.floor((tp - lo) / width);
    if (b < 0) b = 0; else if (b >= buckets) b = buckets - 1;
    acc[b] += c.volume || 0;
  }
  let best = 0;
  for (let i = 1; i < buckets; i++) if (acc[i] > acc[best]) best = i;
  const poc = round(lo + (best + 0.5) * width);
  return { bars, poc };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function rsiVal(avgG, avgL) {
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  const rs = avgG / avgL;
  return round(100 - 100 / (1 + rs));
}
function dayKey(t) {
  // t is unix seconds; bucket by UTC calendar day without Date-math surprises.
  return Math.floor(t / 86400);
}
function round(x) { return Math.round(x * 100) / 100; }
