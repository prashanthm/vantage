# Overnight-shorts / short-covering fingerprints — pre-reg (2026-07-22, BEFORE run)

Story: shorts held overnight → low inventory → RTH rallies on covering.
True positioning is unobservable free; we test its two behavioral fingerprints
on frozen hourly ^GSPC (730 sessions):
A) WEAK CLOSE → COVERING OPEN: prior-day last-RTH-hour return ≤ −0.3% →
   next day's FIRST-hour return. Predicate: mean first-hour ret > uncond
   baseline AND %positive ≥ 55% with n ≥ 40.
B) GAP ASYMMETRY: down-gaps ≤ −0.3% recover intraday (close>open) more often
   than up-gaps ≥ +0.3% give back (close<open). Predicate: P(recover|down) −
   P(fade|up) ≥ +8pp with ≥ 40 events per side.
Prediction: NO EDGE on A (weak-close momentum and reversal roughly cancel);
B mildly positive (+3–6pp, below predicate) — the covering story is real but
mostly priced into the overnight gap itself, leaving little for RTH.

## Result

```
A baseline: first-hour mean +0.012%  %pos 0.520  (n 729)
A weak-close: n 38  mean +0.006%  %pos 0.500
B down-gaps<=-0.3%: n 115  P(RTH recovers) 0.461
B up-gaps>=+0.3%:  n 180  P(RTH fades)    0.400
B asymmetry: +0.061
```

verdict: NO EDGE on both, as pre-registered predicates define it.
A: weak closes are followed by a dead-average first hour (+0.006% vs +0.012%
baseline, 50.0% positive, n=38 — also under the n≥40 bar). No covering pop.
B: the asymmetry EXISTS in the predicted direction (+6.1pp: down-gaps recover
46.1% vs up-gaps fade 40.0%, n=115/180) but sits inside the predicted
3–6pp "mostly priced into the gap" band and under the +8pp predicate.
Prediction record: both called correctly. The tradable content of the
short-covering story is already spent in the overnight gap itself — by the
RTH open there is no residue worth gating on. Nothing wires into the coach;
consistent with H6 (the gap's SIZE, not its story, is what carries odds).
