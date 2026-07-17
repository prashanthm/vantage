# Hypothesis log — ipda-edge

Dataset: server/backtest_data/bars_hourly_730d.json (^GSPC hourly, 2023-08..2026-07).
IPDA via ict.ipda_ranges over daily hi/lo resampled from the hourly bars.
Every IPDA test is compared against a matched RANDOM-LEVEL null (E0).

## E0 baseline — random-level null + full IPDA reaction/magnet table
method: ipda_backtest.py both --lookback all. For each IPDA level (20/40/60-day
  hi/lo/eq) over ~670 out-of-sample hourly test days: REACTION = first-touch then
  reverse >=1.0 hourly-ATR within 6 bars; MAGNET = level within 0.5 daily-ATR of
  the open and not yet touched -> touched intraday. Each compared to a matched
  random level drawn uniformly from the same prior N-day range (seed 42).
prediction (pre-registered): the random-level reversal rate will be substantial
  (any horizontal level near price gets reversal-tested often), maybe 0.4-0.6;
  IPDA hi/lo will beat it but I expect the edge to be SMALL (<10pp) once matched
  against random levels in the same range — i.e. most of the "IPDA works" feeling
  is just "levels near price get touched." I predict eq (equilibrium) shows the
  weakest/least-significant edge of the three roles.
result: baseline established + full table computed (~670 OOS test days).
  Random-level nulls: REACTION reversal ~0.46; MAGNET touch ~0.36.
  REACTION (reverse >=1 ATR): IPDA hi+lo 0.485 vs rand 0.463 -> edge +2.3pp,
    p=0.27 (NOT sig). eq 0.502 vs 0.546 -> -4.3pp. Per-cut "edges" cancel
    (ipda40_lo +18pp n=31 vs ipda60_hi -18pp) = noise.
  MAGNET (touch when near open): IPDA hi+lo 0.466 vs rand 0.362 -> edge +10.3pp,
    p<0.0001, n=479 (SIG, clears the +10pp/p<0.05 bar). Lows strongest
    (+25-28pp). eq 0.353 vs 0.335 -> +1.8pp p=0.68 (no edge).
verdict: confirmed (baseline + null measured). My pre-registered prediction was
  RIGHT on reaction (small, <10pp, not sig) and eq (weakest), but WRONG that the
  magnet edge would also wash out — magnet edge is large and significant.
kept: n/a (measurement)

## H1 IPDA hi/lo are REACTION (reversal) levels
prediction: hi/lo reverse >=1 ATR more often than random by >=10pp, p<0.05.
experiment: reaction_test, IPDA hi/lo vs matched random (in E0 run).
result: +2.3pp (0.485 vs 0.463), p=0.27, n=581. Fails the bar.
verdict: DISPROVEN — IPDA extremes are not reliable reversal points at hourly
  granularity. The apparent per-cut edges are noise (they cancel across lookbacks).
kept: reverted (nothing to keep — do NOT wire IPDA as a fade/reversal signal)

## H2 IPDA hi/lo are MAGNETS (draws)
prediction: when an IPDA level sits within 0.5 daily-ATR of the open and isn't
  yet touched, it gets touched intraday >=10pp more than a matched random level.
experiment: magnet_test, IPDA hi/lo vs matched random (in E0 run).
result: +10.3pp (0.466 vs 0.362), p<0.0001, n=479. Clears the bar. Lows
  strongest (ipda20_lo +25pp, ipda40_lo +28pp, ipda60_lo +26pp).
verdict: CONFIRMED — IPDA hi/lo act as real draws: price near one at the open is
  meaningfully more likely to reach it than a matched random level.
kept: pending robustness checks (H3+) before any recommendation.

## H3 IPDA equilibrium (eq) has edge
prediction: eq shows the weakest edge of the three roles (pre-registered in E0).
experiment: eq reaction + magnet vs random (in E0 run).
result: reaction -4.3pp (p=0.22), magnet +1.8pp (p=0.68). No edge either way.
verdict: DISPROVEN — IPDA equilibrium is not a useful reaction or draw level.
  Drop eq from any coach wiring; keep only hi/lo.
kept: reverted (eq stays overlay-only decoration)

## H4 the magnet edge survives a DISTANCE-MATCHED null (not a distance artifact)
prediction: the H2 magnet edge is partly an artifact — the uniform-range random
  level is on average FARTHER from the open than the IPDA extreme that qualified
  as "near", so random gets touched less just for being farther. With a
  distance-matched null (random level placed at the SAME distance from the open
  as the IPDA level, random side), I predict the +10.3pp edge SHRINKS materially,
  possibly below the +10pp bar. If it survives >=+7pp p<0.05, the draw is real
  beyond mere proximity.
experiment: magnet_test_distmatched — control level at the SAME distance from
  the open as the IPDA level (same side, small jitter); rerun magnet test.
result: IPDA hi+lo 0.466 vs distance-matched ctrl 0.446 -> edge +1.9pp, p=0.40,
  n=479. Every per-cut edge is <+4pp and non-sig. The +10.3pp from H2 was almost
  entirely a DISTANCE ARTIFACT (uniform-range random levels sit farther from the
  open, so they touch less).
verdict: DISPROVEN — the IPDA magnet edge does NOT survive a distance-matched
  null. Being an IPDA extreme adds ~2pp over any level the same distance away:
  noise. The draw is "nearest level gets touched," not "IPDA level gets touched."
kept: reverted. This overturns H2's confirmed magnet edge — the honest verdict
  after controlling for distance is NO edge. This is the single most valuable
  result of the loop.

## H5 reaction edge appears under different reversal params (not a threshold artifact)
prediction: the null reaction result (H1) is robust — sweeping REV_ATR in
  {0.5, 0.75, 1.5} and REV_BARS in {3, 10} will NOT surface a significant,
  consistent IPDA hi/lo reversal edge over random. I predict no parameter set
  clears +10pp p<0.05 on the aggregate hi+lo.
experiment: sweep REV_ATR {0.5,0.75,1.0,1.5} x REV_BARS {3,6,10} = 12 configs,
  aggregate IPDA hi+lo vs matched random.
result: edge ranges -2.2pp..+3.6pp across all 12 configs; min p=0.07; NONE clears
  the bar. Reaction/reversal edge is absent at every threshold.
verdict: DISPROVEN (robustly) — no IPDA reversal edge survives parameter sweep.
kept: reverted.

## H6 the draw works from FARTHER (magnet edge at wider MAG_ATR, distance-matched)
prediction: a magnet should pull from a distance, so maybe the distance-matched
  test at MAG_ATR=0.5 (H4) was too tight to see it. I predict widening MAG_ATR to
  {1.0, 1.5, 2.0} still shows NO distance-matched edge (<+7pp / not sig) — if H4
  killed it at 0.5, distance-matching kills it at every band. (Testing my own
  disproof for robustness.)
experiment: rerun distance-matched magnet at MAG_ATR in {0.5,1.0,1.5,2.0}.
result: distance-matched edge +1.9pp / +0.7pp / +0.6pp / +0.5pp across bands;
  all p>0.39. Never significant at any distance.
verdict: DISPROVEN — the draw does not work from any distance beyond what
  proximity alone explains. Confirms H4 across all near-bands.
kept: reverted.

---

## SUMMARY (goal ACHIEVED — predicate measured, verdict is NO edge)

baseline vs final: random-null reversal ~0.46 / touch ~0.36. IPDA hi/lo:
  reversal +2.3pp (ns), touch +10.3pp (sig) BUT distance-matched +1.9pp (ns).
hypotheses: confirmed 1 (E0 baseline) ; disproven 5 (H1 reaction, H2 overturned
  by H4, H3 eq, H4 distance-artifact, H5 param-robust, H6 distance-robust) ;
  inconclusive 0.
changes kept: NONE wired into the coach. IPDA stays an optional VISUAL OVERLAY.
most valuable disproven hypothesis: **H4** — the apparently-significant magnet
  edge (+10.3pp, p<0.0001) was a DISTANCE ARTIFACT. Against a distance-matched
  null it fell to +1.9pp (p=0.40). Without that control we would have shipped a
  fake edge into the coach. The uniform-range random baseline was not enough; the
  distance-matched null is what exposed the truth.

RECOMMENDATION: do NOT wire IPDA 20/40/60-day levels into the live coach as a
  reaction or draw signal — on 3 years of SPX hourly data they carry no edge
  beyond "a level near current price gets touched," which is already captured by
  the validated draw-to-nearest-playbook-level logic. Keep IPDA as the toggle-off
  visual overlay we shipped. Equilibrium adds nothing; could be dropped from the
  overlay too.
