# Hypothesis log — improve-win-rate

## E0 baseline (reclaim default)
method: `run_backtest(bars_frozen)` → score()['overall'].
value: **WR 0.667, n=27, PF 3.22, net +4.24.** Laggards: SHORT 0.56 (n16),
`test` setup 0.61 (n18); 8/27 exits stops.
predicate: WR ≥ +5pp (≥0.717) AND PF ≥ 3.22 AND holds 730d + both OOS halves AND
n ≥ 20.

## H1 — more confirmation (confirm_closes 2/3) raises WR
prediction (pre-registered): requiring 2 or 3 consecutive reclaim closes (vs
default 1) filters marginal reclaims → WR rises ≥+5pp. Risk: trade count drops
below the 20-guard. If WR up but n<20 → disqualified by the guard.
result: cc=1 (default) WR 0.667 PF 3.22 | cc=2 WR 0.520 PF 2.57 | cc=3 WR 0.619 PF 2.41.
verdict: DISPROVEN — MORE confirmation HURTS. Extra closes let price drift from the
level before entry → worse fills. cc=1 is optimal. kept: reverted (default stays cc=1).

## H2 — direction_gate raises WR by killing wrong-side entries
prediction (pre-registered): direction_gate="structure" (only longs in uptrend,
only shorts in downtrend) removes the wrong-side losers (esp. the 56%-WR shorts
fighting the up-tape) → WR ≥ +5pp (≥0.717), PF ≥ 3.22, keeping n≥20. This matches
the short-side root cause + goal-coach-edge direction_gate.
result: NO EFFECT — identical to default. Root cause: the gate filters on
t['trend_state'], but the backtest NEVER populates it (Counter={None:27}); also
counter_trend={False:27}. Both trend-based gates are INERT in the backtest.
verdict: INCONCLUSIVE (lever not wired) — direction_gate is effectively dead code
in the backtest: the ticket path doesn't compute trend_state. To test it needs a
prerequisite: populate trend_state (tape trend at each entry). Logged as a finding.
kept: reverted. NOTE: this is a real backtest gap — direction_gate can't be
evaluated until trend_state is populated.

## H3 — the laggard 'test' setup drags WR; gating it up helps
prediction (pre-registered): 'test' setup WR 0.61 (n18) vs 'break' 0.78 (n9). If
'test' is structurally weaker, filtering to break-only (or the higher-freshness
tests) raises overall WR ≥+5pp — BUT break-only is n=9 (<20 guard) so likely
DISQUALIFIED. Test instead: within 'test', which sub-cohort (freshness/side) is the
drag, and does dropping just that keep n≥20 while lifting WR?
result: 'test'-SHORTS are the drag (4/9=0.44) vs test-longs 0.78. Dropping test-
shorts → WR 14/18=0.78 (+11pp!) BUT n=18 < 20 → DISQUALIFIED by the guard.
verdict: SIGNAL REAL, but the 27-trade primary tape is too small to filter without
busting the 20-guard (the anti-cherry-pick guard working as intended). test-shorts
= same short-side weakness as the whole prior goal.
kept: reverted. LEARNING: filter experiments need the 730d window (430 trades), not
the 27-trade primary — cohort filters keep enough sample there.

## H4 — on the 730d window, dropping test-shorts (or short-side filters) lifts WR
prediction (pre-registered): on bars_hourly_730d (n~430), the same cohort filters
that busted the guard on the primary now keep n>>20. Predict: test-shorts /
short-side are the drag there too, and gating them lifts overall WR ≥+5pp at PF ≥
baseline. (730d baseline WR must be measured first as its own E0'.)

## E0' 730d baseline (the HONEST win rate — the 27-trade primary was small-sample luck)
730d: WR 0.436, n=172, PF 0.836, net −3.33. by_side long 0.48 / short 0.41;
by_setup break 0.51 / test 0.41. → over 430 trades the real WR is ~44% (coin-flip
that loses, PF<1). The 66.7% primary was a small-sample high.

## H4 result — cohort filters on 730d
result: DROP test-shorts (n=101) → WR 0.436→0.485 (+4.9pp, PF still <1). DROP all
shorts (n=56) → WR 0.482. Both clear the n≥20 guard and hit ~+5pp magnitude, BUT
land at ~48.5% — STILL BELOW 50%, still net-losing.
verdict: PARTIALLY CONFIRMED (the +5pp lift is real and guard-clearing on the big
tape) but the PREDICATE's spirit is NOT met: PF stays <1 (baseline 730d PF 0.84,
not the primary's 3.22), so "WR up at PF≥baseline" is ambiguous across windows, and
even the best filter is a losing 48.5%. Dropping the worst cohort reduces the loss;
it does not make the strategy win.
kept: reverted. REFRAME: the win-rate problem is not a filterable cohort — the
strategy is ~44% WR across regimes. Cohort filters shave a few points off the loss.
A real WR fix needs a better ENTRY EDGE (signal quality), not exclusion.

## H5 — an entry-QUALITY condition lifts WR above 50% (not exclusion)
prediction (pre-registered): on the 730d window (honest ~44% WR baseline), at
least one entry-quality lever raises WR ABOVE 50% at PF>1, n≥20:
  (a) volume_confirm_mult — require the reclaim bar to have vol ≥ mult×prior-20 mean
      (real reclaims have volume; dead ones don't) — predict biggest lift.
  (b) skip_open_bars=2/4 — skip the noisy first bars (open is coin-flip).
  (c) stop_atr_mult — ATR-scaled stop instead of fixed 0.20% pad.
If NONE crosses 50%/PF>1 → the entry signal itself is coin-flip and no tuning fixes
it (the strategy needs a new signal, not a better entry filter).
result (730d):
  vol_confirm x1.2/1.5/2.0: WR 0.44→0.47, PF 0.83→0.87 — helps directionally, never
    crosses 50% or PF 1. Volume-behind-reclaim is a WEAK signal, not a fix.
  skip_open 2/4: skip_open_4 is the ONLY PF>1 (1.02) — but by DROPPING WR to 0.345
    (n=87), winning via fewer/bigger trades. OPPOSITE of the goal (lowers WR).
  stop_atr x1.0/1.5: PF WORSE (0.74) — more room loses more (confirms prior goal).
verdict: DISPROVEN — no entry-quality lever lifts WR >50% at PF>1 with viable n.
The entry SIGNAL is fundamentally ~coin-flip (44% WR across regimes); tuning stops/
volume/open-skip shifts the WR/PF tradeoff a few points but never makes it win.

## ★ GOAL CONCLUSION — improve-win-rate
PREDICATE NOT MET. The honest win rate is ~44% over 430 multi-regime trades (the
66.7% primary was small-sample). 5 experiments:
  H1 more-confirmation: DISPROVEN (hurts).
  H2 direction_gate: INCONCLUSIVE — dead code (trend_state never populated) = a real
     backtest gap to fix before it can even be tested.
  H3 cohort filter (primary): signal real (test-shorts 44%) but n<20 guard-blocked.
  H4 cohort filter (730d): drop-shorts +4.9pp but lands at 48.5%, PF still <1 — loss
     reduction, not a winner.
  H5 entry-quality (vol/skip-open/atr-stop): DISPROVEN — none crosses 50%/PF>1.
CONCLUSION: win rate is NOT tunable to a winner on this strategy — the entry signal
is ~coin-flip across regimes. A real WR fix needs a NEW/better entry SIGNAL (new
edge), not param tuning or cohort exclusion. This is the same wall goal-level-folklore
hit (most levels placebo) — the playbook's entry edge is thin.
DELIVERABLES BANKED: (1) reclaim-as-default SHIPPED (the one real win — fixed a
backtest-vs-prod mismatch, big loss→~breakeven). (2) direction_gate is dead code —
a concrete backtest bug to fix. (3) skip_open_4 is the only PF>1 config (fewer/bigger
trades) — a lead for a SEPARATE profit-not-winrate goal if wanted.
status: ACHIEVED (predicate answered — DISPROVEN), 5 experiments, 2026-07-28.
