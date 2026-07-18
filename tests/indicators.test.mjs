// Golden tests for src/indicators.js — run with: node tests/indicators.test.mjs
// No framework: plain assertions against hand-computed values. Exits non-zero on
// the first failure so it can gate a build.
import { sma, vwap, rsi, volumeProfile } from "../src/indicators.js";

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  passed++;
}
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ~${b})`); }

// candles: time (unix sec), OHLC, volume
const C = (t, o, h, l, c, v = 0) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

// ── SMA ──────────────────────────────────────────────────────────────────────
{
  const bars = [C(1, 0, 0, 0, 10), C(2, 0, 0, 0, 20), C(3, 0, 0, 0, 30), C(4, 0, 0, 0, 40)];
  const out = sma(bars, 2);
  ok(out.length === 3, "sma(2) emits n-period+1 points");
  ok(out[0].time === 2 && out[0].value === 15, "sma(2) first = (10+20)/2 = 15");
  ok(out[2].value === 35, "sma(2) last = (30+40)/2 = 35");
  ok(sma(bars, 5).length === 0, "sma with period > length → []");
}

// ── VWAP ─────────────────────────────────────────────────────────────────────
{
  // one day, two bars. tp = (h+l+c)/3.
  const b1 = C(100, 0, 12, 8, 10, 100);   // tp = 10
  const b2 = C(200, 0, 24, 16, 20, 100);  // tp = 20
  const out = vwap([b1, b2]);
  ok(out.length === 2, "vwap emits one point per bar");
  near(out[0].value, 10, 0.001, "vwap after bar1 = tp1 = 10");
  near(out[1].value, 15, 0.001, "vwap after bar2 = (10*100+20*100)/200 = 15");
  ok(vwap([C(1, 0, 0, 0, 10, 0)]).length === 0, "vwap with no volume → []");
  // resets across calendar day (86400s apart)
  const day2 = C(100 + 86400, 0, 33, 27, 30, 50); // tp = 30, new day
  const reset = vwap([b1, day2]);
  near(reset[1].value, 30, 0.001, "vwap resets on a new UTC day → tp of first bar");
}

// ── RSI ──────────────────────────────────────────────────────────────────────
{
  // all-gains → RSI 100; all-losses → RSI 0 (avgL=0 vs avgG=0 branches).
  const rising = Array.from({ length: 20 }, (_, i) => C(i + 1, 0, 0, 0, 10 + i));
  const rout = rsi(rising, 14);
  ok(rout.length === rising.length - 14, "rsi emits length-period points");
  near(rout[rout.length - 1].value, 100, 0.001, "all-up RSI = 100");
  const falling = Array.from({ length: 20 }, (_, i) => C(i + 1, 0, 0, 0, 100 - i));
  near(rsi(falling, 14).pop().value, 0, 0.001, "all-down RSI = 0");
  ok(rsi(rising.slice(0, 10), 14).length === 0, "rsi with too few bars → []");
}

// ── volume profile + POC ─────────────────────────────────────────────────────
{
  // Most volume concentrated at price ~50 → POC near 50.
  const bars = [
    C(1, 9, 11, 9, 10, 10),    // tp ~10
    C(2, 49, 51, 49, 50, 500), // tp ~50, heavy
    C(3, 51, 52, 50, 50, 400), // tp ~50.7, heavy
    C(4, 89, 91, 89, 90, 10),  // tp ~90
  ];
  const { bars: vbars, poc } = volumeProfile(bars, "#0a0", "#a00");
  ok(vbars.length === 4, "volumeProfile emits a bar per candle");
  ok(vbars[1].color === "#0a0" && vbars[3].color === "#0a0", "up candles green");
  ok(poc >= 45 && poc <= 55, `POC lands in the heavy ~50 zone (got ${poc})`);
  ok(volumeProfile([C(1, 0, 0, 0, 10, 0)], "#0a0", "#a00").poc === null, "no volume → poc null");
}

console.log(`ok — ${passed} indicator assertions passed`);
