# Overnight (Globex) action → RTH impact, modeled on ES futures
# Pre-registration (2026-07-22, BEFORE the data was examined)

Upgrade of overnight-shorts-backtest.md: the cash study saw only the gap;
ES=F hourly carries the true 18:00→09:30 overnight session. New frozen
artifact: backtest_data/es_hourly_730d.json (yfinance ES=F 1h, frozen today).

A) COVERING RESIDUE: after a big overnight decline (ON ret ≤ −0.5%,
   18:00 prev → 09:30), does RTH (09:30→16:00) rally? Predicate: conditional
   RTH mean ≥ unconditional baseline +0.15% AND %positive ≥ 57%, n ≥ 30.
B) CONTINUATION: does RTH continue the overnight direction at all?
   Predicate: sign-agreement rate outside 50% ± 4pp with n ≥ 400.
Prediction: A NO EDGE (the night prices its own covering; consistent with the
cash-gap result). B within noise (48–54%) — overnight and RTH are near-
independent sessions; if anything mild REVERSAL after big ON moves.

## Result

```
bars: 13686 2024-02-28T00:00 → 2026-07-22T08:00
sessions: 595
baseline RTH: mean +0.013%  %pos 0.539
A after ON ≤ -0.5%: n 76  mean -0.009%  %pos 0.553
B continuation: 286/577 = 0.496
context, ON ≥ +0.5%: n 100  mean -0.003%  %pos 0.550
```

verdict: NO EDGE on both — the strongest null of the whole program.
A: after a big overnight decline the RTH session is indistinguishable from
any other day (−0.009% vs +0.013% baseline, 55.3% vs 53.9% positive, n=76).
No covering residue exists even with the full Globex session observed. The
symmetric check (ON ≥ +0.5%) is equally flat (−0.003%, n=100).
B: overnight→RTH sign continuation is 49.6% over 577 sessions — a coin flip
to three decimal places. The two sessions are directionally INDEPENDENT.
Predictions: both called correctly. Implication for the cockpit: the
overnight move's DIRECTION carries zero information for the day; only the
resulting gap's SIZE does (H6). The "short covering" story, even measured
where the covering actually happens, is fully priced by 09:30. Frozen
artifact committed for reuse: backtest_data/es_hourly_730d.json.
