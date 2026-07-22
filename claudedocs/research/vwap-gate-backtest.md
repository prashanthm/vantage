# VWAP-side gate on reclaim triggers — pre-registration (2026-07-21, BEFORE run)

H: gating the coach's reclaim entries by VWAP side (long only above session
VWAP, short only below) improves expectancy vs ungated.
Method: frozen hourly ^GSPC (bars_hourly_730d). Shelves = fractal-pivot
clusters (trailing 300 bars, refreshed /50, ≥3 touches, tol 0.1%). Entry =
touch then 2 consecutive closes back through (reclaim), next-bar open. Exit =
±1×ATR(14) target/stop, else close at 8 bars. R = pnl/ATR. Session VWAP from
same-day hourly typical×volume. Seed n/a (deterministic).
Predicate: gated avg R exceeds ungated avg R by ≥ +0.05R with ≥60 gated
trades; else NO EDGE.
Prediction: small positive (+0.03 to +0.10R) — cutting counter-tape entries
helps — but ~40% fewer trades; genuinely uncertain after the 57%-wall results.

## Result

```
all: n 344  avgR +0.049  win 0.532
gated: n 216  avgR -0.084  win 0.468
rejected: n 128  avgR +0.274  win 0.641
```

verdict: gated−ungated Δ=-0.133R → NO EDGE / NOT MET per predicate.
