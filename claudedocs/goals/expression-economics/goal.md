# Goal: expression-economics

**Outcome:** the ict_htf pipeline trades an expression whose backtest EV is
positive at the measured long-only WR — or we prove no simple expression is
and stand the family down from auto-arming.

**Context / diagnosis:** the live expression (debit spread, short strike at
the zone, modeled debit ≈ ½ width) pays ~1:1 on a signal whose validated
shape is multi-R (zone typically ≥2R from entry, stop 1R). Measured
long-only WR 0.4295 (H11) × 1:1 payoff = −0.14 per $ risked. The detection
is validated; the translation to a trade strips the R-multiple.

**Success predicate:** a pre-registered expression with backtest EV
> +0.10 per unit risk on the frozen tape (long-only A+ set, n ≥ 300),
halves same-sign with both ≥ half the aggregate EV. Ship = switch the pipe
to that expression. Fail-all = ict_htf auto-arming OFF (display-only).

**Baseline (E0):** current expression EV = 2×0.4295 − 1 = −0.141 per $
(from the H11 measurement; no new run needed).

**Budget:** 4 experiments. **Instrument:** research/ict_spread_baseline.py
(extended to record per-trade rr + alternative races). Frozen tape only.

**Constraints:** paper pipe only (ADR-010); the detector is untouched —
this goal changes only the trade expression. Status: ACTIVE 2026-07-25.
