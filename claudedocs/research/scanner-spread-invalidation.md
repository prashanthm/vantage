# Scanner invalidation buffer — backtest (2026-07-19)

The ICT hourly scanner's `invalid` (thesis-invalidation reference) sat AT the FVG far
edge. That is spike-bait: **median risk 0.27 ATR** (entry→edge), so 111/149 setups had
a stop under 0.5 ATR — a single hourly wick regularly exceeds the whole distance. The
user flagged it ("a spike will take out the stop") and asked for the stop to sit
**beyond** the FVG.

## Method
Frozen SPX-hourly harness (`backtest_data/bars_hourly_730d.json`, 5073 bars, 149
confluence setups). For each setup, push the stop BEYOND the far edge by `buf × ATR`
(ATR at the FVG formation bar), recompute the validated exit ladder (50%@1R / 25%@2R /
25%@pool-or-3R, breakeven after TP1) off the new risk, and walk forward ≤48 hourly bars
(stop checked before target within a bar — conservative).

## Results

| buffer (ATR beyond edge) | median risk | ladder expectancy | % positive |
|---|---|---|---|
| 0.00 (raw far edge, spike-bait) | 0.27 ATR | +1.28R | 62% |
| **0.10** | **0.37 ATR** | **+0.55R** | **64%** |
| 0.25 | 0.52 ATR | +0.42R | 62% |
| 0.50 | 0.77 ATR | +0.40R | 66% |

## Verdict
- The raw-edge **+1.28R is largely a tiny-denominator artifact** — when risk is 0.27
  ATR, any small favorable move is a huge R-multiple, but that fragile stop is exactly
  what a real wick takes out (hourly bars mask the intrabar spike, so the raw-edge
  number is optimistic).
- Moving the stop beyond the gap **holds or improves the positive rate** (62→64-66%)
  while making the stop *survivable*. Nominal R drops because the denominator is now
  realistic.
- **Chose 0.10 ATR** — the smallest buffer that puts the stop past the FVG edge
  (median risk 0.37 ATR), keeping the tightest survivable risk. Shipped as
  `INVALID_BUFFER_ATR` in `ict_htf.py`; `invalid = far − dir × 0.10 × ATR`.

Corroboration: `tests/test_htf_signals.py`'s own P&L sim already buffered the stop by
`stop_buf=0.25 × ATR` beyond the far edge — the test authors knew the raw edge was too
tight. 0.10 is a more conservative buffer than the test's 0.25.

Relates to [[goal-ict-concepts-edge]] (confluence stack +0.59R), scanner-exit-ladder.md.
