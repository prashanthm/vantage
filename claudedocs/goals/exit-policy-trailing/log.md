# Goal: exit policy — fixed T1 target vs trailing stop (swing-trading prep)

**Question.** The managed-exit monitor (ADR-010 v3) supports two exit
policies: `ladder` (rest stop; swap to the T1 target when it trades — the
validated champion geometry) and `trailing` (ratchet the stop by the initial
entry→stop distance on new extremes; operator-proposed 2026-07-12). Which
should be the DEFAULT for reclaim executions?

**Rule honored.** Every strategy change must be backtested before it ships
(user rule, reclaim-confirmations log). Predictions below are REGISTERED
BEFORE any experiment runs. Harness: `bars_multi_frozen.json` (frozen
2026-07-11; 5m fill frame 2026-04-15→07-10), champion config
`{entry_mode: reclaim, trigger_interval: 5m, confirm_closes: 3}`.
Instrument extension: `simulate_fill(exit_policy="trailing", trail_mult=k)`
— trail = k × fill→stop distance, original stop is the floor, pessimistic
intrabar ordering (ratchet before adverse test), locked by 7 new tests in
test_backtest.py. Both policies simulate the IDENTICAL fill population.

**Champion baseline (E0 expected).** n=34, WR 0.706, PF 2.99, net +4.55%
(reclaim-confirmations E0 re-measure with pivot_n=3).

## Pre-registered hypotheses

- **H-T1 (trail 1.0x).** The reclaim stop pad is 0.20% — a ~0.2–0.4% trail
  on 5m SPY/QQQ/IWM bars is inside ordinary intrabar noise. PREDICT: WR
  rises (many small locked "trail" wins) but avg win shrinks more; PF and
  net BOTH fall below champion. Expect PF ≤ ~2.3.
- **H-T2 (trail 1.5x).** PREDICT: between H-T1 and champion; PF still below
  2.99.
- **H-T3 (trail 2.0x).** PREDICT: closest to champion; may approach but not
  beat PF 2.99, because the harness marks-to-close at EOD — the runner
  upside that justifies trailing needs multi-day holds the day-session
  harness cannot express.

**Decision rule (registered).** `trailing` becomes the DEFAULT exit_policy
only if some trail_mult beats the champion on BOTH PF and net % on the
identical population. Otherwise `ladder` stays the default and `trailing`
remains an opt-in per-ticket policy for swing use — explicitly documented
as NOT validated by this harness for multi-day holds (out of scope: the
harness is session-scoped; EOD truncation biases against trailing).

## Results (run 2026-07-12, frozen multi-cache, identical n=34 population)

| arm | n | WR | PF | net% | avg% | exits |
|---|---|---|---|---|---|---|
| E0 target (champion) | 34 | **0.706** | **2.99** | **+4.55** | 0.134 | stop 8 / eod 13 / target 13 |
| E1 trail 1.0x | 34 | 0.559 | 1.90 | +2.23 | 0.066 | trail 28 / eod 6 |
| E2 trail 1.5x | 34 | 0.559 | 2.09 | +3.68 | 0.108 | stop 7 / trail 14 / eod 13 |
| E3 trail 2.0x | 34 | 0.500 | 1.67 | +2.62 | 0.077 | stop 10 / trail 8 / eod 16 |

**Baseline replicated exactly** (E0 = the recorded champion numbers), so the
instrument extension changed nothing about the existing measurement.

**Hypothesis outcomes.**
- H-T1: RIGHT on the decision metrics (PF 1.90 ≤ 2.3 predicted ceiling; net
  falls), WRONG on mechanism — WR FELL (0.71→0.56), it did not rise. The
  tight trail doesn't lock small wins; a reclaim fill sits ~one stop-distance
  above the level, so the first ordinary 5m pullback exits BELOW the fill —
  the trail converts target-wins and eod-wins into small losses.
- H-T2: RIGHT — between E1 and champion (PF 2.09, net 3.68), still below on
  both.
- H-T3: WRONG — 2.0x is not the closest; it is worse than 1.5x (PF 1.67).
  The wide trail gives back too much on winners while the floor stops still
  take full losses. Non-monotone in trail width.

**Decision (per the registered rule).** No arm beats the champion on either
PF or net → **`ladder` stays the DEFAULT exit_policy.** `trailing` remains
an opt-in per-ticket policy (`exit_policy: "trailing"` on
/api/ticket/execute) intended for multi-day swing use, which this
session-scoped harness cannot validate (EOD truncation structurally biases
against trailing here — stated in the registration, not an after-the-fact
excuse; a multi-day harness would be needed to measure trailing's actual
use case).

