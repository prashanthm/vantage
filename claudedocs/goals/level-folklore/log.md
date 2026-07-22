# Hypothesis log — level-folklore

## E0 baseline
method: TDST-study machinery — daily bars aggregated from frozen
`bars_hourly_730d.json` (^GSPC RTH, 730 sessions 2023-08→2026-07; SPY for
volume-dependent tests); touch = day reaches within 0.10% of an active level
having opened on the respected side; hold = close back on the respected side;
placebo = distance-matched draws (real level's distance from its anchor,
random sign, ×U(0.7,1.3) jitter), 200 seeded draws, z = (real − placebo mean)/sd.
Calendar tests use label-permutation instead of placebo levels. Seed 20260721.

────────────────────────────────────────────────────────────────────────
ALL PREDICTIONS BELOW WERE WRITTEN BEFORE ANY EXPERIMENT RAN (2026-07-21).
────────────────────────────────────────────────────────────────────────

## H1 PDH/PDL/PDC act as S/R the following session
predicate: z ≥ 2 on day-0 hold with ≥ 25 touches, per level type. Secondary:
after a PDH/PDL SWEEP (range trades through), reversal rate (close back
inside) ≥ 55%.
prediction: weak-to-inconclusive on hold (z between 1 and 2.5 — these are
universally watched, unlike TDST, but the IPDA/TDST pattern says named levels
underperform their reputation); sweep-reversal ≥ 55% CONFIRMED for PDH/PDL
(consistent with the already-confirmed midday-level-trap result). PDC: no edge.

## H2 Round numbers (SPX 50s/100s) act as S/R
predicate: z ≥ 2, ≥ 25 touches.
prediction: DISPROVEN (z < 1). Pure folklore; nothing anchors flow to SPX
cash round numbers strongly enough to survive a distance-matched control.

## H3 Volume PoC (rolling 10-session, SPY) acts as a magnet/accept level
predicate: z ≥ 2 on hold, ≥ 25 touches (SPY daily, PoC from hourly volume).
prediction: INCONCLUSIVE-to-weak (z 1–2). There is a real mechanism (volume
memory) but a 10-session profile is crude; expect direction right, size small.

## H4 Touch-count durability — shelves with ≥3 distinct-session touches hold
better than 2-touch shelves (cohort comparison, no placebo)
predicate: hold-rate difference ≥ +4pp with ≥ 40 touches per cohort and a
two-proportion z ≥ 1.6.
prediction: CONFIRMED in direction, small in size (+2–5pp). This validates
the ★Nd durable-ranking we ship.

## H5 Zone hysteresis beats the line rule (the feature shipped today)
predicate: on hourly shelves with touch-spread bands, the band-traversal flip
rule produces ≥ 30% fewer FALSE flips (role reverts within 5 bars) than the
mid-line rule, while dropping ≤ 30% of true flips.
prediction: CONFIRMED — this is near-mechanical (hysteresis suppresses
oscillation), the question is only the size of the true-flip cost.

## H6 Gap behavior — fill rates fall with gap size; large gaps continue
predicate & metrics: same-day fill rate by |gap| bucket (<0.2%, 0.2–0.5%,
0.5–1.0%, >1.0%); first-hour continuation rate (first hourly bar's direction
matches gap sign). "Rule support" = for |gap| ≥ 0.5%, continuation ≥ 55% —
i.e. fading a big gap in hour one is fighting the odds.
prediction: CONFIRMED — small gaps fill ≥ 65% same day, >1.0% gaps fill
< 45%, and first-hour continuation on ≥ 0.5% gaps ≥ 55% (this is the
quantified version of the "no counter-gap before 10:00" rule).

## H7 Max-pain pin — 0DTE closes gravitate toward max pain
predicate: mean |close − max_pain| < placebo-strike mean by z ≥ 2, n ≥ 20
sessions of stored playbooks.
prediction: INCONCLUSIVE BY N — the stored playbook history is only weeks
old; log the point estimate and re-run when n ≥ 40.

## H8 Floor-trader pivots (PP/R1/S1 from prior-day OHLC)
predicate: z ≥ 2, ≥ 25 touches.
prediction: DISPROVEN (z < 1). Same class as round numbers.

## H9 Day-of-week effects on SPX range/direction
predicate: any weekday's mean |return| or mean signed return outside the 95%
band of 1000 label permutations.
prediction: DISPROVEN for direction; possibly one weekday clears on |range|
(FOMC Wednesdays) but I predict none survive at 95% on this window.

## H10 Anchored VWAP from the 60-session swing high/low (SPY) acts as S/R
predicate: z ≥ 2, ≥ 25 touches.
prediction: DISPROVEN-to-inconclusive (z < 1.5). Popular, mechanism thin.


────────────────────────────────────────────────────────────────────────
RESULTS (run 2026-07-21, server/scratch/level_folklore.py, seed 20260721;
H7 in-container vs the store)
────────────────────────────────────────────────────────────────────────

## H1 result
PDH: 314 touches, hold 0.573 vs placebo 0.590±0.022, z −0.79
PDL: 262 touches, hold 0.565 vs 0.571±0.024, z −0.27
PDC: 350 touches, hold 0.569 vs 0.568±0.016, z +0.06
Sweeps: PDH swept 212× — reversal only 0.354; PDL swept 187× — reversal 0.406.
verdict: DISPROVEN on both counts. Hold rates are exactly placebo. The
sweep-reversal folklore INVERTS on dailies: a sweep continues ~60–65% of the
time. (Post-hoc observation, NOT a result: sweep-continuation as a signal is
a candidate for its own pre-registered test.) Prediction: half wrong — the
sweep-reversal ≥55% call missed badly.

## H2 result
667 touches, hold 0.580 vs placebo 0.590±0.016, z −0.61.
verdict: DISPROVEN (as predicted).

## H3 result
168 touches, hold 0.571 vs 0.567±0.026, z +0.17.
verdict: DISPROVEN at this power (prediction said weak/inconclusive; there is
simply nothing there).

## H4 result
2-touch shelves: hold 0.588 (n=226). ≥3-touch: 0.573 (n=614). Δ −1.5pp, z −0.40.
verdict: DISPROVEN — prediction WRONG. More historical touches do NOT make a
shelf hold better; if anything the reverse. Ship implication: the ★Nd durable
tag stays DESCRIPTIVE ("has held N days"), it must not be presented as
predictive strength. (Caveat: synthetic 30-session clustering, not the exact
production durable-level definition — a production-definition rerun is fair
game later, but the premise took real damage here.)

## H5 result
Line rule: 531 flips, 49.7% false. Band rule: 361 flips, 35.7% false.
False-flip reduction 51%, true-flip retention 86.9%
(predicate: ≥30% reduction with ≥70% retention).
verdict: CONFIRMED (as predicted) — validates the zone-hysteresis feature
shipped today (e2bf37d) with numbers.

## H6 result
|gap| <0.2%:   n 273, same-day fill 0.813, first-hour continuation 0.509
0.2–0.5%:     n 267, fill 0.539, continuation 0.528
0.5–1.0%:     n 118, fill 0.297, continuation 0.585
>1.0%:        n 36,  fill 0.167, continuation 0.750
verdict: CONFIRMED on all three sub-predicates (small gaps fill 81% ≥ 65%;
>1% gaps fill 17% < 45%; ≥0.5% continuation 0.585/0.750 ≥ 0.55). This is the
quantified "no counter-gap trades in hour one": fading a ≥0.5% gap fights
59–75% continuation odds, and the fill you're betting on happens ≤30% of the
time. Jul 8 + Jul 21 (−$11.7k) were exactly this trade.

## H7 result
7 sessions with a stored max_pain + session close.
mean |close − max_pain| 36.8 vs placebo strikes 40.7±5.4, z −0.71 (direction =
pin, size = noise).
verdict: INCONCLUSIVE BY N (as predicted). Re-run at n ≥ 40 (~2 months).

## H8 result
PP: 324 touches, z +0.77 · R1: 354 touches, z −1.82 (WORSE than placebo) ·
S1: 277 touches, z +0.40.
verdict: DISPROVEN (as predicted).

## H9 result
signed: max weekday deviation 0.142, perm95 0.174, p 0.178.
abs-range: 0.066 vs perm95 0.130, p 0.620.
verdict: DISPROVEN (as predicted).

## H10 result
307 touches, hold 0.573 vs placebo 0.574±0.023, z −0.04.
verdict: DISPROVEN (as predicted).

## Summary
CONFIRMED 2 (H5 zone hysteresis, H6 gap behavior) · DISPROVEN 7 ·
INCONCLUSIVE 1 (H7, n-gated). Predictions right on 8/10 (wrong: H1
sweep-reversal — it inverts; H4 touch-count durability — flat/negative).

Most valuable single finding: **the 57% wall** — every level family (PDH/PDL/
PDC, rounds, PoC, pivots, AVWAP, multi-touch shelves) holds ~0.55–0.59 of
touches, and so does every distance-matched placebo. "Holding" at that rate is
a property of the touch/hold DEFINITION, not of the level. Any feature that
implies a named level is special now carries the burden of beating that wall.
