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

## H2 — {level + fresh 1m FVG} confluence separates P&L (REAL 1m data, 07-16)
prediction: with 1m bars (the right resolution), the level+FVG "both" bucket
beats level-only on WR and avg P&L.
experiment: fvg_1m.py — 3-candle 1m FVG on the PERSISTED 07-16 bars (390 bars),
12 real SPX trades, bucketed.
result:
  both       n=2 WR 1.00 net +$3087 avg +$1544
  level_only n=3 WR 0.00 net -$6795 avg -$2265   ← incl the -$5350 12:06 call
  fvg_only   n=3 WR 1.00 +$1230
  neither    n=4 WR 1.00 +$2530
verdict: CONFIRMED directionally, strongly. Every level+FVG entry won; every
level-WITHOUT-FVG entry LOST (all 3), including the session's -$5350 disaster.
The specific trap is a LEVEL WITHOUT the imbalance behind it — exactly what the
operator claimed and what Mira/coach are blind to.
CAVEAT: one session, buckets of 2-4. A hint, not proof — could split by luck.
"neither" also won 100%, so it's not "FVG=win" cleanly; it's "level-without-FVG
=trap". The detector is a plain 3-candle gap, not the operator's full LuxAlgo
logic. Need several more captured 1m sessions to call this an edge.

## Status: promising, needs more sessions
The 1m persistence (shipped) makes accumulation automatic. Recommendation: let a
handful more sessions capture, re-run H2 across them; if the level-without-FVG
loss pattern holds, THEN build the FVG leg into the DNA correlation + coach (arm
requires level+FVG; flag level-only as lower-conviction).

## H3 — pooled across all 4 captured 1m sessions this week (48 real trades)
prediction: level+FVG beats level-only across the pooled week, not just 07-16.
experiment: fvg_week.py — 3-candle 1m FVG on persisted bars for 07-13/14/15/16.
result (pooled):
  both       n= 4 WR 0.75 +$3467 avg +$867
  level_only n=23 WR 0.48 -$5016 avg -$218
  fvg_only   n= 5 WR 0.60 +$140
  neither    n=16 WR 0.69 +$7218 avg +$451
  level+FVG vs level-only: WR 0.75 vs 0.48 | avg +$867 vs -$218
  ALL 'at a level' trades (n=27) net -$1549; the 4 with FVG made +$3467, so the
  23 level-WITHOUT-FVG bled -$5016.
verdict: DIRECTIONALLY CONFIRMED but nuanced. The "level-without-FVG is a trap"
pattern is consistent in sign across the week. BUT:
  1. "neither" is the biggest winner (+$7218) → FVG is NOT a universal entry
     filter; it's a CONDITIONAL rescue specifically for LEVEL trades.
  2. the -$5016 level-only loss is dominated by 07-16's -$6795 (mostly the one
     -$5350 trade). Strip it and the pattern weakens materially.
  3. "both" is still n=4 — one loss from WR 0.50.
Per-session: only 07-16 showed the clean split; 07-13 & 07-15 had ZERO "both"
trades and level-only was fine on 07-13 (+$944).

## Refined thesis to test as sessions accumulate
NOT "always need level+FVG". Rather: "a LEVEL entry WITHOUT a fresh FVG is
low-conviction / a trap." The actionable build (when validated on more sessions)
is a WARNING on level-only entries, not an FVG-required arm gate. Need more
sessions where "both" actually populates before building.
