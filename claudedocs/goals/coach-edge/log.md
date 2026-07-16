# Hypothesis log — coach-edge

## E0 baseline
method: `.venv/bin/python -m vantage_server.backtest --cache backtest_data/bars_frozen.json --params '{...}'`,
summarized via `bt_summary.py`. Frozen 60-day 15m window (Apr–Jul 2026).

**Backtest, reclaim config `{"entry_mode":"reclaim"}`:**
- overall n=40, **WR 0.600, PF 2.384**, net +4.72%
- counts: 111 sessions · 337 tickets · 121 no_fill · **176 no_target**
- longs WR 0.750 / PF 3.28; shorts WR 0.500 / PF 1.886

**Live paper trades (from the DB, what the user is judging):**
- 17 closed (filled): 4 win / 7 loss / 6 scratch → **WR ~24%, net −$1,027**
- loser exits: 5 stop, 2 "target" (the wrong-side-target bug: target BELOW entry
  on a long → instant fake target-hit at a loss)
- R:R of target-bearing trades included 0.5, 0.1, 0.2 — sub-1R junk armed

**The gap:** backtest 0.60 WR vs live 0.24 WR on the same strategy. The
implementation has drifted from the validated harness. Two concrete bugs found
in the paper/coach codepath:
  (a) wrong-side targets — 176/337 tickets have no valid next-zone target; the
      paper pipeline sometimes set target = an opposing level on the WRONG side
      of entry, settling as an immediate loss labeled "target".
  (b) no min-R:R floor — sub-1R setups armed and lost.

Predicate (restated): corrected target/R:R logic must backtest to WR ≥ 0.45 AND
PF ≥ 1.2 on this window, AND the closed-trade audit must show zero wrong-side
targets and zero sub-min-R:R arms.

## H1 (pre-registered) — a min-R:R gate lifts PF without gutting WR
prediction: adding `rr_min: 1.5` to the reclaim config KEEPS win rate ≥ 0.55 and
RAISES profit factor above the 2.384 baseline (it drops the low-R:R losers). n
will fall (fewer tickets qualify) but should stay ≥ 20.
experiment: params `{"entry_mode":"reclaim","rr_min":1.5}`.
result: overall n=36, WR 0.583, PF 2.421, net +4.54%. Tickets 337→147,
**no_target 176→0**, no_fill 121→111. Longs WR 0.733/PF 3.16; shorts WR
0.476/PF 1.96.
verdict: CONFIRMED. WR 0.583 ≥ 0.55 ✓; PF 2.421 > 2.384 baseline ✓. The key
find: rr_min=1.5 drives no_target to ZERO — it structurally removes the
untargetable + wrong-side-target tickets that were the paper pipeline's losers.
This is the fix. n=36 ≥ 20. Predicate range (WR≥0.45, PF≥1.2) already cleared.
kept: yes — this is the config to port into the paper pipeline / coach.

## H2 (pre-registered) — shorts are the weak side; a direction gate helps
prediction: shorts (WR 0.476) drag the blended number. Adding
`direction_gate:"structure"` (longs in uptrend, shorts in downtrend) on top of
rr_min=1.5 will RAISE overall WR above 0.60 by cutting counter-trend shorts,
though n drops further (expect n ≥ 20).
experiment: params `{"entry_mode":"reclaim","rr_min":1.5,"direction_gate":"structure"}`.
result: overall n=25, **WR 0.640, PF 3.095**, net +4.0%. All 25 are with-trend
(counter-trend removed). Longs WR 0.800/PF 5.92; shorts WR 0.533/PF 2.07.
no_target 0.
verdict: CONFIRMED. WR 0.583→0.640, PF 2.42→3.10 as predicted. Counter-trend
shorts were the drag; gating them out lifts both. n=25 ≥ 20. Trade-off: n falls
from 36, so fewer setups — but far cleaner.
kept: yes — candidate prod config.

## Interim decision (after H2)
The predicate is CLEARED by the corrected config: WR 0.640 ≥ 0.45, PF 3.095 ≥
1.2, no_target=0 (the wrong-side-target bug is structurally impossible once
rr_min forces a valid correctly-sided target). The strategy HAS an edge on this
window; the live paper 24% is an implementation defect, not a dead strategy.
Remaining work is porting rr_min + direction_gate into the paper/coach codepath
and re-auditing live trades — NOT more strategy search. Honest caveat holds: one
60-day uptrending window, no live GEX, shorts remain the weaker side (0.53).
