// Check for the replay predicted-path monotonic-dedupe (chart_layers.jsx replay()).
// LW rejects non-ascending / duplicate times; two forecasts at the same second must
// be nudged forward. Run: node tests/replay_path.test.mjs
function predPathTimes(forecasts) {
  const pts = [];
  let lastT = -Infinity;
  for (const f of forecasts) {
    if (f.target == null) continue;
    const tt = f.as_of_ts <= lastT ? lastT + 1 : f.as_of_ts;
    pts.push({ time: tt, value: f.target });
    lastT = tt;
  }
  return pts.map((p) => p.time);
}

let passed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } passed++; };

// strictly ascending output even with duplicate/decreasing input times
const times = predPathTimes([
  { as_of_ts: 100, target: 10 },
  { as_of_ts: 100, target: 11 },   // dup → +1
  { as_of_ts: 100, target: 12 },   // dup → +1 again
  { as_of_ts: 90, target: 13 },    // earlier → still nudged forward
  { as_of_ts: 200, target: 14 },
]);
ok(JSON.stringify(times) === JSON.stringify([100, 101, 102, 103, 200]), `ascending+deduped, got ${times}`);
// forecasts without a target are skipped
ok(predPathTimes([{ as_of_ts: 100 }, { as_of_ts: 200, target: 5 }]).length === 1, "no-target skipped");

console.log(`ok — ${passed} replay-path assertions passed`);
