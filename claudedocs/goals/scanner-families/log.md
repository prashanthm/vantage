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
