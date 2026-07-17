# Goal: Backtest each ICT concept against SPX for predictive edge

Systematically test every mechanically-definable ICT concept from
`claudedocs/research/ict-concepts-reference.md` against SPX, to separate the
concepts that carry real edge from the ones that are narrative. Same rigor that
exposed the IPDA distance artifact (`ipda-edge`): every level/zone/timing claim
must beat a **matched null**, and any concept that survives the statistical screen
then earns a **P&L** test with ICT's own stop/target rules.

- **Outcome**: A per-concept verdict table (`log.md` + a summary in
  `findings.md`) stating, for each ICT concept, whether it has predictive edge on
  SPX (confirmed / disproven / inconclusive) with the measurement, so the coach
  only ever wires in concepts that earned it. Disproven concepts are logged, not
  discarded — a disproof is as valuable as a confirmation.

- **Concepts in scope** (each ≥1 experiment; "everything incl. confluence"):
  1. **Liquidity sweep → reversal** (sweep of swing/EQH-EQL then reverse)
  2. **FVG as a reaction level** (price returns to a fresh FVG → reacts / fills to CE)
  3. **FVG fill tendency** (does an unfilled FVG get filled more than a random gap?)
  4. **Order block reaction** (price returns to an unmitigated OB → reacts)
  5. **Breaker block flip** (retest of a breaker holds in the new direction)
  6. **Premium/discount** (buy-in-discount / sell-in-premium beats random side)
  7. **OTE zone** (0.62–0.79 retرace entry beats a random retrace level)
  8. **Equal highs/lows as a draw** (EQH/EQL get swept more than random levels)
  9. **Killzone time-of-day** (moves initiated in London/NY-AM/PM killzones vs off-zone)
  10. **Macro windows** (09:50–10:10, 10:50–11:10 — do they concentrate expansion?)
  11. **Judas swing / PO3** (session-open false move then reverse into the true dir)
  12. **Displacement** (does an FVG born of displacement outperform one that isn't?)
  13. **CONFLUENCE STACK** (bias-proxy + sweep + displacement + FVG in discount —
      does the combined rule beat each ingredient alone and a random control?)

  Concepts intentionally NOT standalone-testable (documented, not scored):
  draw-on-liquidity *direction* (needs discretionary HTF bias — but proxied in the
  confluence test), full manual multi-TF narrative. IPDA already has a verdict
  (`ipda-edge`, no edge) — not re-run; referenced.

- **Success predicate** (two-stage, per concept):
  - **Stage 1 — statistical edge vs a MATCHED null.** The concept's predicted
    behavior (reversal at a level, fill of a gap, reaction at a zone, expansion in
    a window) must beat a **matched control** by **≥ +10 percentage points AND
    p < 0.05** on the 3-yr hourly SPX set. The control must be *distance-/time-/
    context-matched* (e.g. a random level the same distance from price, a random
    time window of equal length) — a uniform-range null is NOT sufficient (that is
    the exact mistake the IPDA magnet edge hid behind). Confirmed-S1 / disproven-S1
    / inconclusive (n < 30).
  - **Stage 2 — tradeable P&L (only for concepts that pass S1).** Build the
    mechanical version with ICT's stop (beyond the swept wick / structure) and
    target (opposite liquidity / measured), and measure **net R and win-rate vs a
    random-entry control** matched on trade count and holding period. Confirmed
    only if it beats the random-entry control on net R with WR ≥ break-even for its
    R:R. A concept that passes S1 but loses money in S2 is verdict **"real pattern,
    not tradeable."**
  - A concept is **CONFIRMED** only if it clears S1 *and* (where applicable) S2;
    **DISPROVEN** if it fails S1 or is unprofitable in S2; **INCONCLUSIVE** if
    under-sampled. The goal is ACHIEVED when every in-scope concept carries a
    two-stage verdict and `findings.md` ranks them for coach-wiring priority.

- **Baseline (E0)**: reuse/extend `server/scratch/ipda_backtest.py`'s harness on
  `bars_hourly_730d.json`; resample to the needed TFs; port the ICT engine
  (`vantage_server/ict.py`) detectors (pivots, sweeps, OBs, FVGs, breakers,
  liquidity). Measure the **matched-null distributions** each concept is judged
  against (reversal rate at random levels, fill rate of random gaps, expansion in
  random time windows, P&L of random entries). No edge claim in E0 — it defines
  every null.

- **Budget**: 30+ experiments (deep dive). Paced via `/loop` so it survives across
  sessions; iterations tracked with Task tools. One concept-variable per
  experiment; predictions pre-registered in `log.md` before each run.

- **Trigger**: now.

- **Constraints**: **backtest ONLY** on the frozen harness
  (`server/backtest_data/*.json`) — no live yfinance, no touching prod coach code.
  Reuse `vantage_server/ict.py` + the `ipda_backtest.py` scaffolding. Analysis
  scripts live in `server/scratch/` (untracked, per the ict-coach/ipda-edge
  precedent). **Nothing wired into the coach** until `findings.md` carries verdicts
  and the user reviews. Honest small-n / resolution caveats per concept (hourly
  resolution means intraday-timing concepts like macros are coarse — flag it).

- **Honest caveats**:
  - Hourly bars are coarse for the *timing* concepts (macros are 20-min windows;
    Judas is a first-30-min move). Those get tested at hourly first, flagged as
    resolution-limited, and re-run on the 15-min set (`bars_frozen.json`, 60 days)
    where feasible — but 60 days is a short sample.
  - The **matched null is the whole ballgame.** Any "edge" that doesn't beat a
    properly matched control is presumed an artifact (the ipda-edge lesson).
  - "Bias" for the confluence test is *proxied* mechanically (e.g. trend of the
    HTF close, or side of the daily open) — it is NOT ICT's discretionary bias, so
    the confluence result bounds what a *mechanical* version can do, not the
    discretionary method.
  - SPX only, this instrument, this 3-yr window. Not a claim about ICT on FX/other
    indices or other regimes.

Status: **ACHIEVED** · started+finished 2026-07-17 · dataset: bars_hourly_730d.json
(^GSPC hourly, ~700 OOS days) · ranked verdicts in findings.md.

RESULT: On SPX hourly, ICT's reaction/imbalance concepts carry real matched-null-
robust edge — OPPOSITE the 1m ict-coach result. **6 CONFIRMED** (confluence stack
#1 at +0.59R/trade, FVG-reaction, displacement filter, order-block, sweep→reversal,
hour-of-day expansion); **2 DISPROVEN** (FVG-fill = raw-number trap, premium/discount
= loses in a trend); **3 real-but-not-tradeable** (OTE fails S2, equal-H/L under bar,
Judas unscored); **1 INCONCLUSIVE** (breaker, n=26). The confluence stack (sweep →
displacement → FVG) is the headline: highest P&L, validating ICT's "confluence is
the edge" claim. Nothing wired to the coach yet (per constraint) — findings.md ranks
what earned it.
