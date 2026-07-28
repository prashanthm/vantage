# Goal: improve win rate (post-reclaim)

## Outcome
Raise the frozen-tape backtest win rate above the new reclaim-default baseline,
without giving back profit factor, and prove it generalizes (2nd window + OOS
halves) — the same rigor that validated the reclaim ship.

## Success predicate (MEASURABLE)
Overall win-rate rises **≥ +5 percentage points** (66.7% → ≥ 71.7%) on
`bars_frozen.json`, with **profit-factor ≥ baseline (3.22)** AND the improvement
**holds on the 730d 2nd window (`bars_hourly_730d`) and both chronological halves**
of the primary. **Guard: any experiment must keep ≥ 20 trades** on the primary
tape — a WR lift from shrinking to a handful of cherry-picked trades is DISQUALIFIED.
Ship to V1 only if it clears this bar.

## Baseline (E0)
`run_backtest(bars_frozen)` with the now-default reclaim entry:
- **overall WR = 0.667, n=27, PF = 3.22, net +4.24**
- Laggards: SHORT WR 0.56 (n=16) vs LONG 0.82 (n=11); `test` setup 0.61 (n=18)
  vs `break` 0.78 (n=9); 8 of 27 exits still stops.

## Candidate levers (hypotheses to test, one per iteration)
- confirm_closes sweep (2/3 vs default 1) — more confirmation → higher WR?
- direction_gate (only shorts in downtrend, longs in uptrend) — kills wrong-side losers
- volume_confirm_mult — require the confirming bar to have volume
- skip_open_bars — avoid the noisy first N bars
- stop_atr_mult — ATR-scaled stop vs the fixed 0.20% pad
- setup filter — is `test` setup structurally worse, drop or gate it?
Each: change ONE param, measure WR + PF + trade count, then OOS-check the winners.

## Budget
12 experiments. One experiment per iteration, one variable each.

## Constraints
- READ-ONLY on the frozen tape (ADR-010); post-processing / param changes only.
- Min 20 trades per experiment (anti-cherry-pick guard, in the predicate).
- Ship only after clearing the bar incl. OOS; that ship is a separate gated step.
- Respect the "backtest before shipping strategy changes" rule.

## Trigger
Now.

## Status
ACHIEVED (predicate DISPROVEN — WR not tunable to a winner; entry signal ~coin-flip) — 5 experiments, 2026-07-28.
