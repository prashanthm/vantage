# Scanner exit ladder — backtest (2026-07-19)

The ICT hourly scanner (`ict_htf.htf_setup`) gave entry + invalidation but **no
target**. Backtested target options on the frozen SPX-hourly harness
(`backtest_data/bars_hourly_730d.json`, 5073 bars, 149 confluence setups).

## Method
Per setup: entry = FVG center (`ce`), stop = far FVG edge (`invalid`). Walk forward
≤48 hourly bars; stop checked before target within a bar (conservative). Expectancy
in R (win = target distance / risk, loss = −1, timeout ≈ 0).

## Results

| Target | n | hit-rate | expectancy | % positive |
|---|---|---|---|---|
| pure draw-on-liquidity (nearest opposing pool) | 140 | 23.6% | — | — |
| single 1R | 149 | 61.7% | +0.23R | — |
| single 2R | 149 | 55.0% | +0.65R | — |
| single 3R | 149 | 49.7% | +0.99R | 50% |
| capped draw (≤4R, else skip) | 24 | 54.2% | +1.08R | 54% |
| **EXIT LADDER** (50%@1R, 25%@2R, 25%@pool/3R, BE after TP1) | **149** | — | **+1.28R** | **62%** |

## Verdict
- **Pure draw-on-liquidity is unusable** as a single target: the nearest opposing
  pool averages ~38R away, so only 23.6% get hit before the stop. The distance is
  the problem, not the concept.
- **The exit ladder wins on every axis** — best expectancy (+1.28R), highest
  positive rate (62%), and it applies to all 149 setups (not a filtered subset).
  The breakeven-after-TP1 move is what lifts the positive rate: once 1R banks and
  the stop is at entry, the setup can't lose.
- Ladder rungs: **TP1 = 1R** (bank 50%, stop→BE) · **TP2 = 2R** (bank 25%) ·
  **TP3 = draw-on-liquidity pool**, or 3R when no pool sits beyond 2R (runner, 25%).

Shipped into `htf_setup` as `targets` (the ladder) + `runner_is_pool` flag; the
scanner card surfaces the three rungs. Context only (ADR-008) — a heads-up, not an
order. Relates to [[goal-ict-concepts-edge]] (confluence stack +0.59R validated).
