# Goal: Backtest ICT IPDA data-range levels for predictive edge on SPX

- **Outcome**: A backtest verdict on whether the ICT IPDA data-range levels
  (20/40/60 trading-day high, low, equilibrium) have real predictive edge on SPX
  — as REACTION levels (reversal points) and/or as MAGNETS (draws) — sufficient
  to justify wiring them into the live coach. If disproven, they stay an optional
  visual overlay only.

- **Success predicate** (per level-type × lookback, and aggregate):
  - **REACTION**: when price first reaches an IPDA hi/lo, does it reverse by
    ≥1.0 ATR (within the next 6 hourly bars) MORE OFTEN than at a matched random
    horizontal level drawn from the same session's price range? Confirmed if the
    reversal-rate edge (IPDA − random) is ≥ +10 percentage points AND passes a
    binomial significance check (p < 0.05) on the 3-yr hourly set.
  - **MAGNET**: when price is within 0.5 ATR of an IPDA level at the start of a
    session but not touching it, does it TOUCH that level intraday MORE OFTEN
    than it touches a matched random level at the same distance? Same +10pp /
    p<0.05 bar.
  - An IPDA level type is "confirmed" if it clears the bar on reaction OR magnet;
    "disproven" if it fails both; "inconclusive" if the sample is too thin
    (n < 30 touches) to reach significance.
  - The overall goal is ACHIEVED (predicate measured) once every level-type ×
    lookback carries a verdict + the random-baseline control is measured. The
    RECOMMENDATION (wire into coach / keep as overlay only) follows the verdicts.

- **Baseline (E0)**: compute IPDA 20/40/60-day ranges over the 3-yr hourly
  ^GSPC frozen set the SAME way production does (ict.ipda_ranges over daily
  hi/lo resampled from the hourly bars), and confirm the levels are produced for
  each test day with full lookback history. Then measure the RANDOM-LEVEL
  control: reversal rate + touch rate at matched random levels. No edge claim
  yet — this is the null distribution every IPDA test is compared against.

- **Budget**: 15 experiments. Trigger: now.

- **Constraints**: backtest ONLY on the frozen harness (server/backtest_data/
  bars_hourly_730d.json) — no live yfinance calls, no touching prod coach code.
  Reuse ict.ipda_ranges (already shipped). Analysis scripts live in
  server/scratch/ (gitignored) or server/research/. Nothing wired into the coach
  until this doc carries verdicts and the user reviews. Honest small-n caveats
  per cut.

- **Honest caveats**: hourly resolution means "touch"/"reversal" are measured at
  hourly granularity — a level pierced and reclaimed within an hour reads as a
  touch, not a wick. ATR is hourly ATR. The random-level baseline is the crux:
  any IPDA "edge" only counts if it beats matched random levels, controlling for
  the fact that ANY horizontal level near price gets touched often.

Status: **ACHIEVED** · started+finished 2026-07-17 · dataset: bars_hourly_730d.json (^GSPC hourly, 2023-08..2026-07)

VERDICT: **NO edge.** IPDA 20/40/60-day levels carry no reaction (reversal) edge
(+2.3pp, ns, robust across 12 param configs) and no draw/magnet edge once
distance-matched (+1.9pp, ns, robust across 4 distance bands). The raw magnet
"edge" (+10.3pp, p<0.0001) was a distance artifact killed by H4. Equilibrium is
worthless on both tests. RECOMMENDATION: keep IPDA as the toggle-off visual
overlay already shipped; do NOT wire it into the coach as a signal. 6 hypotheses,
1 confirmed (baseline), 5 disproven, 0 inconclusive.
