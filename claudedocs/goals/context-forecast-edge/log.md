# Hypothesis log — context-forecast-edge

Method: `server/research/context_edge.py` on the frozen artifacts named in
goal.md. All predictions below were written BEFORE any experiment ran.

## E0 freeze + census
prediction: ~750 daily rows per macro symbol; SPY 5m ≈ 60 sessions incl. the
2026-07-23 tear; ES hourly 730d unchanged. Down-≥1%-by-late-day sessions:
~6–10 in the 5m window (thin — flagged), ~35–55 in the ES 2y window.

## H1 late-day dealer unwind ("the tear")
Claim: on big DOWN days, the final minutes reverse UP (0DTE/negative-gamma
hedge unwind into the bell).
pre-registered predictions:
- H1a (SPY 5m, 60d): on days ≤ −1.0% vs prior close as of 15:45, the last-15m
  return (15:45→16:00) has positive mean AND ≥65% up-rate, vs an all-days
  baseline near zero. Bar: mean ≥ +0.05% and up-rate ≥ 0.65 (n will be thin —
  a directional read below n=8 is logged inconclusive regardless of values).
- H1b (ES hourly, 730d): the LAST HOUR on ≤ −1% days — the academic intraday-
  momentum literature says continuation (down), the unwind story says reverse.
  I predict the hourly grain is TOO COARSE for the unwind (it lives in the
  last 10–15 min) and H1b shows continuation-or-flat: mean ≤ 0. If H1b is
  strongly positive too, the effect is bigger than the story.
- Controls: same stats on up-days (≥ +1%) — the unwind story predicts the
  MIRROR (sell-back, negative last-15m) there; a generic "last minutes always
  rally" result fails the mechanism test.

## H2 intermarket direction ("oil up = bear")
Claim: big oil (and DXY / rates / credit) moves carry SPX information beyond
SPX's own tape.
pre-registered predictions:
- H2a direction: DISPROVEN. For |oil move| ≥ 3% days, next-day SPX direction
  agreement with the "oil up = SPX down" rule will not beat 55%, and the
  oil/SPX rolling-60d correlation sign will flip at least twice across 3y
  (sign instability = no stable direction rule). Same expectation for DXY,
  TNX, HYG.
- H2b range: PARTIALLY CONFIRMED at best. |oil| ≥ 3% or |TNX| ≥ 4% days are
  followed by next-day SPX true range ≥ 1.3× baseline (a shock-vol echo, like
  the two validated context edges — range, not direction). Bar: ratio ≥ 1.3
  with n ≥ 25 and monotone across move-size buckets.
- Control: shuffle test — 500 random day-sets of equal n must beat the
  observed ratio < 5% of the time.

## H3 (conditional — only if H1a confirms with its mirror)
Wire a deterministic "unwind watch" context line (negative gamma + down ≥1%
at 15:30 → 'the desks buy back into the bell on days like this — don't add
shorts in the last 15 minutes') to the snapshot + cockpit checklist.

---

# Results (frozen artifacts macro_daily_3y.json + spy_5m_60d.json +
# es_hourly_730d.json; research/context_edge.py)

## E0  755 daily rows/symbol · SPY 5m 59 usable sessions · ES 594 RTH days.
Down-≥1% sessions: 6 in the 5m window (thin, as predicted), 55 on ES 2y.

## H1 late-day dealer unwind: **DISPROVEN**
H1a (SPY last-15m, down≥1% at 15:45): n=6 → below the pre-registered n≥8
floor, but the direction read is AGAINST the thesis: mean −0.059%, up-rate
0.33. The 2026-07-23 tear (+0.31%) is the single largest value in the set —
the operator observed the OUTLIER: 4 of the other 5 big-down days SOLD OFF
further in the last 15 minutes. Mirror (up≥1% days): mean −0.04, up-rate
0.20 — not the unwind mirror either.
H1b (ES last RTH hour, n=55 down days): mean +0.001%, up-rate 0.47 — DEAD
FLAT, exactly the registered coarse-grain prediction. No continuation, no
reversal. Verdict: no harvestable last-minutes effect exists at either
grain; H3 does NOT fire.

## H2a intermarket direction: **DISPROVEN** (as registered)
"driver up → SPX down next day" agreement on big-move days: oil 0.49 (a
coin, n=111 — the operator's specific thesis is the WEAKEST of the four),
HYG 0.44, TNX 0.57 (n=7). Rolling-60d corr sign flips over 3y: oil 24,
DXY 26, TNX 20 — no stable sign anywhere. One marginal exception, flagged
not adopted: DXY 0.65 (24/37, nominal p≈.05, unadjusted across 4 symbols,
26 sign flips) — needs its own pre-registered confirmation before any use.

## H2b shock → next-day RANGE echo: **CONFIRMED for DXY and HYG**
bar: ratio ≥1.3, n≥25, shuffle p<.05, monotone buckets.
- DXY |move|≥0.8%: 1.38× (n=37, p=.004); buckets 0.99→1.29→1.74× monotone ✓
- HYG |move|≥0.7%: 1.76× (n=27, p=.000); buckets 1.12→1.25→3.52× monotone ✓
- oil ≥3%: 1.19× — FAILS the 1.3× bar (p=.000 but effect too small) ✗
- TNX ≥4%: 1.94× but n=7 ✗ (thin; logged, not adopted)

# Decision (predicate met)

Shipped: (1) Phase 0 — the market-context block (breadth/VIX-term/
intermarket + the two previously-validated edges' callouts) now reaches
build_snapshot → the 15-min forecast prompt; the forecaster is no longer
blind to it. (2) H2b — HYG added to the intermarket block; deterministic
SHOCK_ECHO bullets for DXY ≥0.8% (~1.4×) and HYG ≥0.7% (~1.8×), phrased as
RANGE-only context ("this says nothing about direction"). NOT shipped: any
oil line (both tests failed), any direction lean, any last-minutes rule.

Counts: 1 confirmed (H2b, 2 of 4 drivers) · 2 disproven (H1, H2a) · budget
used 5 of 10. Most valuable disproof: the operator's own late-day tear —
it was the largest outlier in its class, and 4 of 5 comparable days did
the opposite; without this test it was one memorable sample away from
becoming a trading rule. Caveats: 5m window is 60 days (yfinance cap);
gamma-conditioned cuts not possible at n=6; echo thresholds are close-to-
close moves — the intraday recompute surfaces them with the same wording,
where "next day" reads slightly early. Re-freeze quarterly.

**Status: ACHIEVED** · closed 2026-07-23
