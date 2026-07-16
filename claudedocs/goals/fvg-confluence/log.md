# Hypothesis log — fvg-confluence

## E0 — confirm the blindness (done, no experiment needed)
The trade DNA, session_activity.correlate_levels, coach_pine, and Mira all
correlate ONLY to the playbook confluence ladder (GEX walls / S-R / fib / volume
PoC). Grep across the backend: NO fvg / fair-value-gap / order-block / imbalance
/ CHoCH / BOS / sweep computation exists anywhere. "fair_value" in
expectations.py is OPTION pricing, unrelated. → The operator's FVG entries are
invisible by construction, not by oversight. CONFIRMED.

## Data blocker (recorded honestly)
Tried to backtest FVG-confluence on the operator's REAL 07-15/-16 trades.
yfinance returns ZERO intraday bars (1m/5m/15m) for those dates from this
environment; the stored DNA windows are also empty (they fetch live). The frozen
cache ends 2026-07-10, BEFORE these sessions. So the operator's specific recent
trades cannot be FVG-tested here right now.

Fallback under evaluation: test the FVG-confluence MECHANISM on real trades that
fall INSIDE the frozen window (Apr 15 - Jul 10), if any exist — proves whether
{level + fresh-FVG} separates P&L, even if not on the exact recent trades.

## H1 — {level + fresh-FVG} confluence separates P&L (frozen-window fallback)
prediction: on the 53 frozen-window trades, the {level+FVG} "both" bucket beats
level-only on WR and avg P&L.
experiment: fvg_bt_frozen.py — 3-candle FVG on 15m frozen bars, tag each real
trade entry by {near level} × {in fresh directional FVG}, bucket P&L.
result: both=EMPTY (0 trades) · level_only n=6 WR0.33 -$1805 · fvg_only n=1 +$590
· neither n=46 WR0.57 +$753.
verdict: INCONCLUSIVE (not disproven). The "both" bucket is empty because 15m
FVGs almost never coincide with an entry bar — but the operator trades 1m FVGs.
Testing 1m structure on 15m bars is the WRONG resolution; this is a data
artifact, not evidence against FVGs. The real test needs 1m bars for the
operator's actual sessions, which yfinance won't return here.

## Blocked — verdict pending 1m data
Cannot complete the FVG-confluence test: (a) the operator's 07-15/-16 1m bars are
unfetchable from this environment; (b) the frozen cache is 15m, too coarse for
1m FVGs. The MECHANISM (3-candle FVG detection) works and is cheap to compute
live in prod — but the EDGE remains unvalidated. Recommendation: capture 1m bars
going forward (store the DNA windows persistently) so the next few sessions of
real FVG entries can be tested at the right resolution before building FVG into
the coach.
