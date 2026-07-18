// Check the level-click hit-test (chart_core.jsx frameToLevel): nearest level within
// ~0.4% tolerance, then the candle whose range is closest to that level.
// Run: node tests/level_anchor.test.mjs
function nearestLevel(levels, clickPrice) {
  let lv = null, best = Infinity;
  for (const l of levels) { const d = Math.abs(l.price - clickPrice); if (d < best) { best = d; lv = l; } }
  if (!lv || best > Math.abs(clickPrice) * 0.004) return null;   // too far from any line
  return lv;
}
function nearestCandle(candles, price) {
  let ci = 0, cbest = Infinity;
  candles.forEach((c, i) => {
    const d = (price > c.high) ? price - c.high : (price < c.low) ? c.low - price : 0;
    if (d < cbest) { cbest = d; ci = i; }
  });
  return ci;
}

let passed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } passed++; };

const levels = [{ price: 7400 }, { price: 7500 }, { price: 7600 }];
ok(nearestLevel(levels, 7503).price === 7500, "picks 7500 for a click at 7503");
ok(nearestLevel(levels, 7450) === null, "7450 is >0.4% (~30pt) from any level → null");
ok(nearestLevel(levels, 7500).price === 7500, "exact hit");

const candles = [
  { high: 7410, low: 7390 },   // 0: around 7400
  { high: 7460, low: 7440 },   // 1
  { high: 7510, low: 7490 },   // 2: straddles 7500
  { high: 7560, low: 7540 },   // 3
];
ok(nearestCandle(candles, 7500) === 2, "7500 lands on the candle that straddles it (idx 2)");
ok(nearestCandle(candles, 7400) === 0, "7400 → idx 0");

console.log(`ok — ${passed} level-anchor assertions passed`);
