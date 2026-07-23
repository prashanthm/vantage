# Goal: breaker-fvg-anchor

**Outcome** — a frozen-tape verdict on the chart observation (MNQ, 2026-07-22):
levels the Liquidity Sweep Hunter marks `× broken` appear to anchor the edges
of FVGs that form LATER. Is that a real correlation (the breaker/role-flip
read in FVG coordinates) or the placebo wall recruiting another believer?

**Instruments/timeframes** — NQ=F (the MNQ tape), 5m · 15m · 60m. User scoped
to NQ only (no QQQ robustness leg).

**Definitions (mirror the indicator + ict.py)**
- Swing level: fractal pivot, 10 bars each side, confirmed 10 bars late.
- Broken: a CLOSE beyond the level with penetration ≥ 0.1×ATR(14); the level
  is "broken" from that bar until it ages out (300 bars, the indicator cap).
- FVG: 3-bar gap (low[j] > high[j−2] bull / high[j] < low[j−2] bear); both
  edges considered ("top of FVG or bottom of FVG" per the observation).
- Hit: either FVG edge within 0.25×ATR(14, at formation) of a prior broken
  level. Robustness band: 0.10×ATR.
- H2 population: FVGs formed ≥ 3 bars AFTER the level broke (co-generation
  excluded). H1 measures the excluded window (±2 bars) as the sanity check.
- Control: per FVG, the same hit test against K random levels drawn uniformly
  from the trailing 300-bar price range, K = count of live broken levels at
  that moment; 500 permutations for p.

**Success predicate** — H2 classified per timeframe: CONFIRMED on a TF only
if hit-rate lift vs the random-level control ≥ 1.5× with permutation p < 0.05.
Goal is achieved when all three timeframes carry a verdict (confirmed /
disproven / inconclusive) in the log, whatever they are.

**Baseline (E0)** — freeze NQ=F 5m/15m/60m yfinance bars to
`server/backtest_data/nq_fvg_breaker.json` (new artifact; existing frozen
caches untouched) and report population sizes (pivots, breaks, FVGs) per TF.

**Budget** — 10 experiments. **Trigger** — now. **Constraints** — research
only (no orders, no store writes, ADR-010); frozen caches append-only; any
trading-rule change stemming from this needs its own pre-registered run.

**Status**: ACHIEVED · started 2026-07-23 · closed 2026-07-23 — H2 disproven
on all three timeframes (lift ≈ 1.0 vs random-level control); H1 disproven
too (co-generated FVGs are not edge-anchored). The observation is the
base-rate illusion. See log.md.
