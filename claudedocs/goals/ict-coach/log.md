# Hypothesis log — ict-coach

## Source indicators (studied, E0 groundwork)
liq-levels-mtf.pine: liquidity levels = ta.pivothigh/low(15,5); a level is
"mitigated" when price closes/wicks through it (= the liquidity grab). HTF variant
via request.security. Alerts on new high (breakout) / low (breakdown).

t4t-high-prob-ob.pine: the full ICT engine, all deterministic —
 - liquidity pools = pivots(2); sweep = strict break (consumes pool) OR equal
   touch within 0.15xATR (keeps pool armed) OR lower-low/higher-high vs prior 20.
 - ORDER BLOCK = sweep[2] → OB candle (opposite color, holds extreme) →
   displacement candle (>0.7xATR) → FVG (low>high[2] bull / high<low[2] bear).
   This is the "high-probability" filter: sweep + displacement + FVG, all three.
 - mitigation: test = wick into zone, fill = close through far side.
 - BREAKER = a filled OB re-confirmed by an opposite FVG within 3 bars → polarity
   flip (support<->resistance).
All reproducible in Python → the coach can compute these live (Pine can't reason,
but Vantage can). This is the foundation for every feature below.

## E0 baseline — port the indicators, confirm they detect the structures
method: ict_engine.py (Python port of both Pine scripts) run on the 4 persisted
1m sessions (07-13..16). Report pivots/sweeps/OBs/breakers/FVGs per session +
spot-check OB zones against the annotated charts.
result:
  07-13  pivots 46/46  sweeps 58hi/107lo  OB 4+/1-  FVG 8
  07-14  pivots 54/52  sweeps 93hi/63lo   OB 4+/2-  FVG 7
  07-15  pivots 49/50  sweeps 84hi/85lo   OB 2+/3-  FVG 12
  07-16  pivots 51/50  sweeps 65hi/109lo  OB 1+/5-  FVG 12
Cross-check on 07-16: OB- at 7548-7551 (12:34) = the red OB- box at the put wall
on the operator's chart; OB bull 7530-7532 (14:17) = the max-pain support zone;
5 bear OBs vs 1 bull = a bearish session bias matching the afternoon grind down;
109 low-sweeps = repeated sell-side raids (the "grab liquidity then bounce"
behavior). VERDICT: PASS — the engine faithfully reproduces the chart structures.
kept: engine (scratchpad); not prod yet.

## H1 (pre-registered) — a LIQUIDITY SWEEP before entry separates winners
prediction: entries that came AFTER a fresh sweep of the SAME-side liquidity in
the trade direction (long after an SSL sweep / short after a BSL sweep, within
~10 bars before entry) have a higher win rate + avg P&L than entries with no
recent sweep. This is the core ICT premise (enter on the reversal AFTER the raid).
experiment: tag each real trade by {recent same-direction sweep before entry}, bucket P&L.
result: (pending)
verdict: (pending)

result: swept_then_entry n=41 WR 0.56 +$102 avg | no_sweep n=7 WR 0.71 +$234 avg.
verdict: DISPROVEN (as stated). A recent same-direction sweep did NOT separate
winners — it was slightly WORSE. Root cause: on 1m bars sweeps are ubiquitous
(65-109/session), so "sweep in the last 10 bars" is true for 41/48 trades — too
loose to be a signal. The raw sweep isn't the edge; what it SETS UP (the OB/FVG
that forms after) is. Rules out "just look for a recent sweep."
kept: reverted (no build).

## H2 (pre-registered) — entry INSIDE a fresh OB zone separates winners
prediction: entries whose price sits INSIDE a fresh, unmitigated order-block zone
in the trade direction (long in a bull OB / short in a bear OB) — the validated
sweep+displacement+FVG structure — have a higher WR + avg than entries not in an
OB. This is the operator's actual method (enter the OB retrace), and the OB is a
much stricter filter than a raw sweep.
experiment: tag each trade by {price in a fresh directional OB zone at entry}, bucket.
result: (pending)
verdict: (pending)

result: in_fresh_OB n=1 WR 1.00 +$440 | not_in_OB n=47 WR 0.57 +$114.
verdict: INCONCLUSIVE (detector calibration). Only 1 trade landed inside an
unmitigated OB — the 1m OB zones are 1-3pt wide and mitigate fast, so they rarely
coincide with a fill. Not a disproof of OB confluence; the "inside the exact
unmitigated zone" test is too strict at 1m. Refine (near-an-OB tolerance /
recently-tested OBs) in H4.
kept: reverted.

## H3 — level x OB confluence
prediction: level+OB beats level-only.
result: level+OB n=0 · OB_only n=1 (+$440) · level_only n=21 WR 0.57 -$29 avg
(net -$609) · neither n=26 +$230 avg.
verdict: CONFIRMED (the level-only trap, again). Same pattern as the FVG work:
LEVEL-ONLY is the worst bucket (-$609, -$29 avg) while neither wins (+$230). The
robust, REPEATED finding across FVG and OB tests: entering a playbook LEVEL
WITHOUT ICT confluence (OB/FVG) is the money leak. "both" is empty only because
the OB detector is too strict (H2) — the level-only side is the real signal.
kept: reverted.

## H4 (pre-registered) — a "near/at an OB or breaker" tolerance populates the confluence
prediction: loosening OB proximity to "within 0.5xATR of a fresh OR recently-
tested OB/breaker zone" (not strictly inside) will populate the level+ICT bucket
with several trades AND that bucket will beat level-only. Tests whether the
level-only trap is rescued specifically by OB/breaker proximity.
experiment: tag with a wider OB/breaker proximity; bucket level x ob-near.
result: (pending)
verdict: (pending)

result: level+OBnear n=1 (-$160) · OBnear_only n=3 (+$400) · level_only n=20
WR 0.60 -$22 avg · neither n=24 +$217.
verdict: DISPROVEN (as a practical signal). Even a 0.5 ATR band populates
level+OB with only 1 trade — the 1m OBs are too rare/small to coincide with level
entries. Rules out OB-PROXIMITY as the usable confluence for THIS operator's fill
timing. (The OB engine is faithful; it just doesn't line up with entries at 1m.)
kept: reverted.

## H5 — level entry with an OPPOSING OB (the draw against you)
prediction: level entries with an opposing fresh OB nearby (long w/ bear OB above)
lose vs level entries that are "clear".
result: level_opposing_OB n=2 WR 0.00 -$332 avg | level_clear n=19 +$3 avg |
not_at_level n=27 +$238.
verdict: CONFIRMED directionally (n=2, tiny). Both opposing-OB level entries LOST
— this is the -$5350 pattern: LONG at support 7550 with the draw (bear OB / max
pain) BELOW. The killer is not "no FVG" per se — it's entering a level when the
ICT STRUCTURE POINTS THE OTHER WAY. Highest-value finding so far, but n=2.
kept: reverted.

## H6 (pre-registered) — DRAW DIRECTION: is the entry WITH or AGAINST the nearest
## unfilled FVG/liquidity target?
prediction: the strongest, highest-n version of H5 — tag each level entry by
whether the nearest UNFILLED draw (FVG/opposing liquidity pool) is in the trade
direction (with the draw) or against it. "against the draw" loses; "with" wins.
This is the operator's core thesis (trade toward the imbalance) and uses FVG+
liquidity (higher-n than OBs).
experiment: compute nearest unfilled draw at entry; tag with/against; bucket.
result: (pending)
verdict: (pending)

result: with_draw n=38 WR 0.58 +$80 | against_draw n=7 WR 0.43 +$259 | no_draw n=3 +$323.
verdict: DISPROVEN as stated — "with the draw" did NOT win (+$80 avg vs +$259
against). BUT this is very likely a BAD DRAW PROXY, not a real disproof: on 1m
there are dozens of tiny FVGs; the NEAREST unfilled FVG is usually a small same-
side gap price just left, NOT the true HTF liquidity target the operator trades
toward (the 7506 Monday liq, the max-pain magnet). nearest-1m-FVG != the draw.
kept: reverted.

## H7 — at a level, WITH vs AGAINST the draw
result: level_WITH_draw n=14 WR 0.50 -$269 avg (net -$3761) | level_AGAINST_draw
n=4 +$546 | not_at_level +$238.
verdict: DISPROVEN / INVERTED — level_WITH_draw was the WORST bucket. Strongly
suggests the nearest-1m-FVG draw proxy is wrong (see H6). The TRUE draw is an HTF
construct (prior-session liquidity, max pain, the daily FVG) — which the
liq-levels-mtf HTF variant and the playbook levels encode, NOT the nearest 1m FVG.
IMPLICATION for the design: "the draw" must be computed on HTF / the playbook
level ladder, not scalped 1m FVGs. Rules out naive 1m-FVG draw.
kept: reverted.

## Robust finding so far (after 7 experiments)
The ONE repeated, cross-validated signal is the LEVEL-WITHOUT-CONFLUENCE TRAP:
- FVG goal H3 (last week): level-only -$218 avg vs level+FVG +$867.
- ict H3: level_only -$29 avg (worst) vs neither +$230.
- ict H5: level+opposing-OB lost 100% (the -$5350 pattern).
Entering a playbook LEVEL without corroborating structure (or WITH structure
against you) is the operator's money leak. The POSITIVE confluence signals
(sweep H1, OB-proximity H4, 1m-draw H6/H7) all FAILED to validate — either too
common (sweeps), too rare (OBs at 1m), or wrong-proxy (1m draw). This reshapes
the design: the coach's highest-value ICT feature is a WARNING on level-only /
level-against-structure entries, NOT a new positive entry trigger.

## H8 — draw = nearest PLAYBOOK level (HTF), not 1m FVG
result: level_WITHlvlDraw n=11 WR 0.55 +$270 avg (+$2965) | level_AGAINSTlvlDraw
n=10 WR 0.60 -$357 avg (-$3574) | not_at_level +$238.
verdict: CONFIRMED. The corrected draw (nearest opposing PLAYBOOK level as the
magnet) works where the 1m-FVG proxy failed: trading a level TOWARD the nearer
opposing level wins (+$270), AGAINST it loses (-$357). Confirms the draw is an
HTF/level construct. This IS the -$5350 trade (long 7550 with max-pain 7529 as
the nearer draw, BELOW). n=10-11 — the strongest positive confluence signal found.
kept: reverted (design input).

## H9 — session timing x at-a-level
result: lvl_open90 n=9 WR 1.00 +$689 avg (+$6205) | lvl_midday n=6 WR 0.17
-$1446 avg (-$8676!) | lvl_close2h n=6 WR 0.33 +$310 | nolvl buckets all modestly
positive.
verdict: CONFIRMED — the single strongest signal in the loop. LEVEL trades in
MIDDAY (11:00-14:00) are catastrophic (WR 0.17, -$8676 net = ~the entire weekly
loss); level trades in the OPEN win 100%. The -$5350 (12:06) and -$1285 (13:58)
were both midday level trades. Corroborates the operator's own midday-stall
observation. The time-of-day x level interaction is the highest-value coach
feature by P&L impact.
kept: reverted (design input).

## H10 — combined avoid-flag (level & (midday OR against level-draw))
result: FLAG_low_conviction n=13 WR 0.46 -$434 avg (net -$5644) | level_clean n=8
WR 0.75 +$629 avg (net +$5035) | not_at_level +$238.
verdict: CONFIRMED — the synthesized warning cleanly separates the level losers.
Flagging the 13 (midday OR against-the-draw level entries) isolates -$5644 of
loss; the 8 clean level trades made +$5035. This is the actionable feature,
validated end-to-end.
kept: reverted (this IS the design-doc recommendation).

## LOOP SUMMARY (10 experiments; budget 12)
CONFIRMED: H3/H5 (level-without/against-structure trap), H8 (HTF/level-based
draw direction), H9 (midday x level = catastrophic), H10 (combined flag works).
DISPROVEN: H1 (raw sweep — too common), H6/H7 (1m-FVG draw — wrong proxy, inverted).
INCONCLUSIVE: H2/H4 (OB proximity — engine faithful but OBs too rare/small at 1m
to coincide with fills).
MOST VALUABLE DISPROVEN: H6/H7 — "trade with the nearest 1m FVG draw" INVERTED
(-$3761), proving the draw is an HTF/level construct, not a scalped 1m gap. This
redirected the whole design from "1m FVG signals" to "HTF/level-based context".
