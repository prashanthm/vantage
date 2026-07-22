# HTF-setup gate on reclaim entries — pre-registration (2026-07-22, BEFORE run)

H: reclaim entries taken WITH a present hourly ICT setup (production
ict_htf.htf_setup, the +0.59R-validated detector) outperform; entries AGAINST
a present setup underperform (against-HTF-draw trap, ict-coach goal).
Method: identical 344-entry reclaim harness as vwap-gate-backtest.md (frozen
hourly ^GSPC, shelves/2-close reclaim, ±1×ATR / 8-bar exits). At each entry,
htf_setup on the trailing 240 hourly bars; cohorts = AGREE (present, same
direction), NONE (absent/suppressed), OPPOSE (present, other direction).
Predicate: AGREE avg R ≥ ungated baseline +0.15R with n ≥ 50; secondary:
OPPOSE avg R < 0. Else NO EDGE.
Prediction: honestly uncertain after the VWAP inversion. I predict AGREE
improves but with n well under 50 (hourly setups are sparse — many entries
will be NONE), landing INCONCLUSIVE-BY-N; OPPOSE negative on a small sample.

## Result

```
agree: n 0
none: n 103  avgR +0.192  win 0.612
oppose: n 241  avgR -0.012  win 0.498
```

verdict: PRIMARY NOT MET — AGREE n=0 (prediction right for the wrong reason:
not sparse, but STRUCTURAL — a reclaim is a reversal off a flush, and the
hourly detector, when present at that moment, is always pointed WITH the
flush, i.e. against the entry). Secondary: OPPOSE −0.012R (direction
consistent, ~zero). The real signal is post-hoc and NOT pre-registered: the
VETO split — entries with NO standing hourly setup +0.192R / 61% win (n=103)
vs entries against a present setup −0.012R (n=241), Δ +0.204R. Consistent
with the confirmed against-HTF-draw trap, but a post-hoc cut does not ship:
needs its own pre-registered confirmation (held-out split / different window)
before the coach gets an HTF veto. No engine change from this run.
