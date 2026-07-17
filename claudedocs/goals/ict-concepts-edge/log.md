# Hypothesis log — ict-concepts-edge

Dataset: `server/backtest_data/bars_hourly_730d.json` (^GSPC hourly, ~700 OOS days),
plus `bars_frozen.json` (15-min, 60 days) for timing concepts.
Engine: `vantage_server/ict.py` detectors. Harness extends `server/scratch/ipda_backtest.py`.

**Predicate reminder (two-stage):**
- S1: concept behavior beats a MATCHED (distance/time/context-matched) null by
  ≥ +10pp AND p < 0.05. Uniform-range nulls are insufficient (the IPDA lesson).
- S2 (if S1 passes): mechanical strategy beats a matched random-entry control on
  net R, WR ≥ break-even for its R:R.

One concept-variable per experiment. Predictions pre-registered BEFORE each run.

---

## E0 baseline — the matched nulls (pending)
method: port ict.py detectors into the hourly harness; measure the null
distributions each concept is judged against — random-level reversal rate,
random-gap fill rate, random-window expansion, random-entry P&L. Also verify each
detector fires on the frozen set (sanity: does it find the structures).
prediction (pre-registered): the random-level reversal null will sit ~0.45–0.50
and the random-gap fill null high (~0.6–0.8) — SPX gaps fill often regardless — so
FVG "fill tendency" will look strong until matched; I expect most concepts to
show a real-but-small raw effect that shrinks toward the null once matched, with
the confluence stack the most likely to retain a modest edge.
result: (pending)
verdict: (pending)
