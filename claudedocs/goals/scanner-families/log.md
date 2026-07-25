# Hypothesis log — scanner-families

Method: `server/research/scanner_families.py` on `scanner_univ_hourly.json`
(60 symbols × 730d hourly). All predictions written BEFORE any run.

## E0 freeze + census
prediction: ~2,900 RTH-hourly bars/symbol; zone counts O(20–60)/symbol;
enough signal density that every family clears n≥40 except possibly H4's
gated subsets.

## H1 break-and-reclaim / role-flip (the ported index champion)
signal: durable zone closed-through by ≥0.1×ATR, then 3 consecutive hourly
closes back through → trade the reclaim direction; stop = level ∓ 0.5×ATR,
target = next zone in-direction (skip if none within 5×ATR); 40-bar cap.
prediction (pre-registered): CONFIRMED — PF 1.3–1.8, WR 0.45–0.60, n ≥ 80,
positive in BOTH date halves. Prior: zone hysteresis is 1 of 2 surviving
level effects; 3×close reclaim is the validated index entry. If this fails,
neither surviving level effect transfers to single names.

## H2 gap-continuation (the 730-session SPX edge, ported)
signal: open gap ≥1.5% vs prior close → enter at the FIRST hourly close if
still beyond prior close, in gap direction; exit day close.
prediction (pre-registered): continuation rate ≥0.58 (SPX analog ~6.5/10)
but trade PF only 1.0–1.3 — single-name gaps are earnings/news-contaminated
in a way index gaps aren't. Classify CONFIRMED only if cont ≥0.58 AND PF
≥1.3 with n≥100; expect INCONCLUSIVE (rate holds, PF doesn't).

## H3 volatility-compression → expansion (range edge, direction-free)
signal: trailing 30-bar true-range sum in the bottom quintile of its own
trailing 360-bar distribution → measure next-3-session range vs baseline.
prediction (pre-registered): CONFIRMED — expansion ratio ≥1.3×, n≥100,
shuffle p<.05, monotone across compression quintiles. Every RANGE edge
tested in this repo has survived; every direction edge has died.

## H4 context-gated arming (regime gates on H1's signals)
gates: (a) VIX>VIX3M backwardation days; (b) universe breadth <40%.
prediction (pre-registered): INCONCLUSIVE — the gates are real (validated
at index level) but gated-subset n will be thin (<30 entries); bar for
CONFIRMED: gated PF ≥ 1.5× ungated with n≥30 on either gate.

## H5 sector/relative-strength pullback (RS filter on H1)
signal: H1 reclaim longs only in top-quartile 20d-return names.
prediction (pre-registered): DISPROVEN — momentum-flavored FILTERS on
validated entries have consistently removed winners here (volume gate,
chase cap, dedup all died the same death). Bar for CONFIRMED: filtered PF
≥ H1 PF + 0.2 with n ≥ 40. I expect the filter to cut n hard and PF to be
flat-to-worse. Registered against my own recommendation ranking.

---

# Results (frozen scanner_univ_hourly.json, 60 symbols; single run each,
# pre-registered bars; H1 robustness sweep added)

## E0  60/60 symbols froze; cache spans ~2023→2026-07 for some symbols
(yfinance returns more than the requested 730d of 1h for part of the
universe — MORE history, noted, not a problem).

## H1 break-and-reclaim / role-flip: **CONFIRMED — long side only**
All: n=778 WR 0.767 PF 2.00, both halves positive (2.60 / 1.58).
**Longs: n=453 WR 0.830 PF 3.60.  Shorts: n=325 PF 0.99 — breakeven noise.**
Robustness (longs): positive EVERY year (2023 PF 8.8 · 2024 7.5 · 2025 5.2 ·
2026 2.1 with n=195); survives removing the top-5 symbols (PF 3.22); worst
single trade −6.1%. Verdict: confirmed above the bar; the shipping detector
is LONG-ONLY (short reclaims join the graveyard). Caveats: PF decays toward
the present (2-year up-tape tailwind is real); no fees/slippage; 40-bar cap.

## H2 gap-continuation: **DISPROVEN — the SPX edge does NOT transfer**
6,860 single-name gaps ≥1.5%: continuation rate **0.468** (below coin; SPX
was ~0.65) and the trade PF 0.95. Single-name big gaps are earnings/news
events that mean-revert slightly; index gap physics don't port. Full stop.

## H3 compression → expansion: **DISPROVEN — INVERTED**
28,843 events: compressed 30-bar windows are followed by **0.78×** the
baseline forward range — quiet stays quiet (vol clustering), the opposite
of the squeeze story. My "range edges always survive here" prior broke:
the surviving range edges (backwardation, breadth, shock echo) are
STRESS-conditioned; calm-conditioned expansion is folklore.

## H4 context-gated arming: **DISPROVEN**
Backwardation gate makes H1 WORSE (PF 1.75 gated vs 2.05 ungated);
breadth<40% gate is flat (2.03 vs 1.99). Neither near the 1.5× bar. Index-
level regime context does not select better single-name reclaims.

## H5 RS filter: **DISPROVEN** (as pre-registered, against my own ranking)
Top-quartile-RS longs: PF 3.66 vs baseline 3.60 (+0.06, bar was +0.20) at
half the n. The filter pays nothing and halves the trade count — the same
death as every other filter-on-a-validated-entry here.

# Decision (predicate met)

One family ships: **long-only hourly break-and-reclaim** as a new scanner
detector (follow-up implementation: SCANNERS registry entry reusing the
zone-cluster + 3-close reclaim spec, tiered by target distance, through the
existing A+ arm → contract-risk gate → snap-to-chain → Alpaca paper pipe).
Four families to the graveyard: single-name gap continuation, compression
squeeze, context gating, RS filtering.

Counts: 1 confirmed · 4 disproven · 7 runs of 15 budgeted. Most valuable
disproof: H3 — "squeeze → expansion" is one of the most-cited retail
patterns and it's backwards at this grain. **Status: ACHIEVED** · 2026-07-24

## Addendum (2026-07-24) — H1 RECLASSIFIED during detector build
Building the live detector, a mirror-tape unit test exposed contamination in
H1: pivot-HIGH clusters sitting above flat price read as "already broken",
so any 3-close pop above them counted as a reclaim. Decomposing:
- TRUE support-reclaims (held above first, lost, reclaimed): longs n=323
  PF **1.40**, halves 1.04/1.34 — marginal, NOT shipped.
- The contaminating class — **breakout-hold** (>=2-pivot resistance cluster
  price NEVER held above, then 3 consecutive hourly closes above): longs
  n=416 WR 0.822 **PF 3.61**, halves 6.10/2.37 — this was the edge all
  along, misfiled under "reclaim".
Shipping detector = `breakout_hold` (long-only), registry + cron + arm-tag
`setup=breakout_hold` + per-strategy book stats. The unit test that caught
this (mirror tape) is kept as the long-only/reclaim-exclusion regression.

---

# Wave 2 (2026-07-24) — popular-strategy survey, pre-registered BEFORE runs

Survey of widely-used retail/quant families not yet tested here, mapped to
testability on the existing frozen tape (daily series derived from
scanner_univ_hourly.json). Excluded without testing: ORB (already dead),
AVWAP pullbacks (placebo, level-folklore), overnight effects (strongest
null), Wyckoff springs (= the reclaim class, PF 1.40), BB-squeeze (= H3,
inverted), PEAD (no earnings data), monthly rotation (portfolio-level, not
a scanner). Pairs/stat-arb deferred (build cost, wave 3 candidate).

## H6 RSI(2) mean reversion (Connors) — the most-cited MR system
signal: daily RSI(2) < 10 while close > 200-day MA → buy close; exit on
close > 5-day MA or after 5 sessions.
prediction: CONFIRMED — PF ≥ 1.3, n ≥ 150, both halves ≥ 1.1. This family
rhymes with the validated washed-tape bounce; dip-buying quality in
uptrends is the one direction edge with a live pedigree here.

## H7 golden-cross pullback (trend-following staple)
signal: 50MA > 200MA and close pulls back to ≤ 20MA → buy close; exit
after 10 sessions or at close < entry − 2×ATR(14).
prediction: INCONCLUSIVE — PF 1.0–1.3 with a big half-split (the 2-year
up-tape flatters trend entries; half-B decay will disqualify it).

## H8 Donchian 55-day breakout (turtle/new-highs momentum)
signal: close > prior 55-day high → buy close; exit at close < prior
20-day low.
prediction: CONFIRMED-WITH-CAVEAT at best — PF ≥ 1.3 overall but driven by
the tailwind; classify honestly on the halves. If halves diverge > 2×,
log INCONCLUSIVE regardless of the aggregate.

## H9 big-dip buying in quality (retail favorite "buy the dip")
signal: daily return ≤ −4% while close > 200-day MA → buy close; exit
after 5 sessions.
prediction: CONFIRMED — PF ≥ 1.3, n ≥ 80. Same mean-reversion physics as
H6/breadth-bounce; the −4% bar keeps it to genuine washouts.

# Wave 2 results (daily series from the frozen hourly cache; halves = date split)

## H6 RSI(2) mean reversion: **CONFIRMED** — the wave's one keeper
n=532 WR 0.703 PF 1.487 · halves **1.517 / 1.463** — stable, meets every
pre-registered bar (PF≥1.3, n≥150, halves≥1.1). Dip-buying quality names in
uptrends is the one direction edge that keeps validating here (rhymes with
the breadth-bounce). Complements breakout_hold (momentum long) with a
mean-reversion long.

## H7 golden-cross pullback: **INCONCLUSIVE** (as registered)
PF 1.349 but halves 1.119 / 1.620 — the aggregate is the up-tape talking;
half A is barely alive. Not a scanner.

## H8 Donchian 55 breakout: **INCONCLUSIVE per the pre-committed rule**
Aggregate PF 2.536 looks spectacular — and the halves are 1.241 / 4.818
(3.9× divergence; the whole edge is the recent runaway-trend leg). The
"if halves diverge >2×, inconclusive regardless of aggregate" clause was
written for exactly this. Not shipped; re-examine after a down regime.

## H9 big-dip (−4% in uptrend): passed its letter-bar, **NOT SHIPPED**
Aggregate PF 1.443 (bar was ≥1.3 ✓) but halves 0.927 / 2.098 — half A
LOSES money. Fails the stability standard the rest of the wave was held
to, and H6 captures the same mean-reversion physics with stable halves.
Logged as inconclusive-in-practice; superseded by H6.

Wave-2 counts: 1 confirmed (H6) · 3 inconclusive. Running totals for the
goal: 2 confirmed (breakout_hold, RSI2-MR) · 4 disproven · 3 inconclusive ·
11 runs of 15. Follow-up candidate: H6 detector as a third scanner family —
note its exit is time/MA-based (2–5 sessions), so the trade expression
needs its own design (the debit-spread arm assumes a level target).

# Wave 3 — exit-ladder for breakout_hold (2026-07-24, pre-registered before run)

## H10 laddered exit on H1-longs (breakout_hold class)
Ladder mirrors the validated ICT ladder, adapted to keep the FINAL exit at
the validated zone target (execution-neutral for the spread pipe — the
short strike is targets[-1] and must not move):
  - tgt ≤ 1R           → single full exit at tgt (ladder degenerates to baseline)
  - 1R < tgt ≤ 2R      → 50% at 1R (stop→breakeven after), 50% at tgt
  - tgt > 2R           → 50% at 1R (BE after), 25% at 2R, 25% at tgt
Stop-first on ambiguous bars, TIME_CAP mark-to-close on the remainder —
same conventions as _simulate.
prediction: ladder RAISES win rate and cuts avg loss ≥25% (the BE move
after TP1 converts full-stop losses into scratches); PF stays ≥ 2/3 of the
H1-longs baseline (≥ ~2.4). Halves must both stay ≥ 1.1. If PF < 2/3
baseline → disproven: ladder stays OFF breakout_hold cards (single target
remains the displayed plan).

result (frozen tape, bh_signals reproduces the addendum class, n=491
baseline PF 3.822 halves 5.91/2.73):
  ladder: n=491 WR 0.849 PF 3.625 net +375% (vs +415%) · halves 5.54/2.63
verdict: **CONFIRMED-AS-SAFE, mechanism disproven** — PF holds at 95% of
baseline (kill floor was 2/3), WR +1.2pt, halves stable; but the predicted
avg-loss cut did NOT materialize (avgL -1.84 -> -1.93). The ladder trades
~10% of net for banked partials/smoothness — acceptable for the promotion
path, no edge added. SHIPPED to breakout_hold cards: rungs 50%@1R
(stop->BE) / 25%@2R / 25%@zone, final rung PINNED at the validated zone so
the spread short strike (targets[-1]) is byte-identical. Degenerate cases:
zone<=1R single full exit; zone<=2R two rungs 50/50.

# Wave 3 (2026-07-25) — formula-DSL discovery (NVIDIA-blueprint engine, our court)

## Pre-registration (BEFORE any candidate IC was computed)
Frozen tape: scanner_univ_hourly.json (60 names, hourly, price-only,
through 07-23; survivorship caveat as ever). Metric: mean Spearman IC of
signal vs 7-bar (~1 day) forward return, NON-overlapping windows,
cross-sections with ≥30 names, ~700 windows.
PLACEBO BAR (computed first, from 200 random matched-complexity formulas):
null |IC| p50 0.0075 · p95 0.0122; best-of-20-random p50 0.0129 ·
p95 0.0293. (NVIDIA's own accept bar |IC|≥0.02 sits BELOW the max-of-20
null median-to-p95 band — their loop ships luck. Quantified.)
ACCEPTANCE (all four): |IC| ≥ 0.0293 (beat luck-with-20-tries at p95) ·
|t| ≥ 3 · halves same sign with both |IC_half| ≥ 0.015 · sign matches the
pre-registered prediction. 18 candidates registered with rationales in
research/formula_candidates.py (committed before the run).

## Wave 3 results — ALL 18 REJECTED (and the blueprint convicted by its own bar)
Not one candidate met a single acceptance criterion, let alone all four.
Fifteen are dead-zero noise (|IC| ≤ 0.01). The three "best" tell the story:
- near_high  IC −0.0224 (t −2.4): predicted +, came out NEGATIVE
- lottery_max IC +0.0213 (t +1.9): predicted −, came out POSITIVE
- lowvol     IC +0.0208 (t +1.9): predicted −, came out POSITIVE
All three: BELOW the luck-with-20-tries bar (0.0293), sign-FLIPPED vs
their registered economics, and halves-unstable (second half — the
runaway 2025-26 leg — carries everything: 0.0035/0.038, 0.0055/0.0371).
A naive |IC| ≥ 0.02 loop — NVIDIA's own acceptance rule — would have
"discovered" and shipped all three. Our placebo bar + sign
pre-registration + halves killed them in one pass.
verdict: wave 3 CLOSED — 0 confirmed / 18 no-edge. Hourly next-day
cross-sectional alpha on 60 mega-caps is an efficient desert, as an
honest test should find. The engine (operator DSL + placebo-calibrated
court) is now reusable: research/formula_signals.py + _candidates.py.
Most valuable output: the quantified proof that the blueprint's
acceptance threshold ships luck.

# Baseline run (2026-07-25, pre-registered BEFORE running) — ict_htf SPREAD-expression WR

Purpose: the ADR-015 gate baseline for ict_htf currently uses 0.531 DERIVED
from the C13 confluence-stack record (rr2.0 avg +0.593R, n=149, binary
arithmetic). The live paper expression differs: arm at scan (A+ tier, entry
= CE at scan close), WIN = underlying touches targets[-1] (the zone / short
strike) first, LOSS = underlying_invalid first, stop-first on ambiguous
bars, cap 245 hourly bars (~35 calendar days = the spread's TARGET_DTE);
unresolved at cap/tape-end excluded (mirrors "money-at-risk closes only").
This run MEASURES that expression's WR on the frozen tape
(backtest_data/scanner_univ_hourly.json, 60 names, price-only) using the
PRODUCTION detector (ict_htf.htf_setup + ict.active_obs, verbatim), swept
as-of per bar, one trade per (symbol, trigger_i), first appearance with
bars_ago ≤ 3.

prediction: measured WR in [0.45, 0.60] (the derived 0.531 ± the
expression mismatch); n ≥ 60.
pre-committed rule: IF n ≥ 60 AND halves (date split) are within 2× of
each other in win-ODDS terms, the measured aggregate WR REPLACES 0.531 as
the frozen gate baseline (provenance updated in strategy.py). ELSE the
derived 0.531 stays and this run logs inconclusive. Either way the number
is frozen after this run — no re-rolls.

execution note: first harness run INVALIDATED by a coding defect, caught by
an impossible invariant — 0 longs in 2,237 trades (the live scanner surfaces
longs daily). Cause: harness read setup["direction"]; the detector's key is
"dir" → every trade defaulted to short and the first-touch sides were
flipped for real longs. Not a re-roll of the measurement: the defect made
the first run measure a different (nonsensical) expression. Fixed key,
rerun below with the same pre-registered rule.

result (fixed harness): n=2234 · WR 0.3782 · halves 0.3608 / 0.3957
(odds-ratio 1.16 — stable) · 1099 longs / 1135 shorts · span 2023-09 →
2026-07. Prediction band [0.45, 0.60] MISSED low — the derived 0.531
overstated the spread expression (C13's tight FVG stop + rr2.0 ≠ the
zone-target/ladder-stop expression the pipe actually trades).
verdict: per the pre-committed rule, 0.3782 REPLACES 0.531 as the frozen
ict_htf gate baseline (strategy.py provenance updated). Frozen — no re-rolls.
FINDING: at the debit spread's ~1:1 payoff, 0.378 WR is BELOW BREAKEVEN —
a WR-only gate would mark a losing book eligible (live paper 0.422/PF 0.72
is exactly that). Gate hardened: scanner families additionally require
paper PF ≥ 1.0 (lifecycle.evaluate_gate). Conservative-only change.
follow-up candidate (NOT run, would need pre-registration): per-side split
of the 2234 — if A+ shorts drag the aggregate the way every other family's
shorts did, long-only arming is the next experiment.

## H11 A+ ict_htf shorts drag the spread expression (pre-registered BEFORE run)
Context: every family validated on this tape is long-only (breakout_hold by
construction, rsi2_mr by construction, reclaim/role-flip long-only PF 3.60);
the ict_htf pipe is the only one arming shorts. Split the SAME 2,234-trade
baseline run by side (descriptive split of the frozen measurement — same
harness, per-side stats added to output).
prediction: short WR < long WR by ≥ 5pp; long-only WR ≥ 0.40; long-only
halves stable (odds ratio < 2).
pre-committed decision rule: IF (long WR − short WR ≥ 5pp) AND long n ≥ 300
AND long halves within 2× odds → SHIP long-only arming for ict_htf spreads
(shorts stay visible on the Scan tab, never auto-armed to paper) AND the
ict_htf gate baseline becomes the long-only WR. ELSE keep both-side arming
and the 0.3782 baseline. Frozen after this run.

## H11 result — CONFIRMED, both actions shipped
long: n=1099 WR 0.4295 halves 0.4335/0.4255 (odds 1.03 — the stablest split
in this goal) · short: n=1135 WR 0.3286 halves 0.289/0.368 (odds 1.43).
Gap 10.1pp ≥ 5pp ✓ · long n ≥ 300 ✓ · long halves < 2× ✓ → per the
pre-committed rule:
1. ict_htf pipe arms LONG-ONLY (scanner.py run_scan; shorts stay on the
   Scan tab, display-only) — now every armed family is long-only.
2. ict_htf gate baseline = 0.4295 (long-only WR), strategy.py provenance
   updated. Still below the ~1:1 debit breakeven → the PF ≥ 1.0 floor
   stays load-bearing.
Frozen. Prediction verified exactly as registered (shorts drag, longs
stable) — the fourth long-only confirmation on this tape.
