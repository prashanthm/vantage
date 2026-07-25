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
