# Goal: context-forecast-edge

**Outcome** — decide whether macro/intermarket moves (oil, DXY, rates, credit)
and the late-day dealer-unwind effect carry information the Mira forecast
should receive — and wire ONLY what survives controls.

**Origin** — operator theses from 2026-07-23 (SPX −1.21%): (1) "oil up
solidifies bear signals" (oil was +6.1%, 10-day oil/SPX corr −0.58); (2) "the
last 10 minutes was a tear — market makers buying back" (+24.7pt in the final
10 min off the session low, on a negative-gamma 0DTE day).

**Phase 0 (shipped with this goal, already validated elsewhere)** — the
market-context block (breadth/VIX-term/intermarket, market-context-native
goal: backwardation → 2.35× range n=48; breadth<40% → 1.68× range + 66%
up-rate n=500) now reaches build_snapshot → the 15-min forecast prompt.
Previously plan-only; the forecaster was blind to it.

**Success predicate** — H1 and H2 each classified (confirmed / disproven /
inconclusive) against their pre-registered bars on frozen data; anything
confirmed is wired as a deterministic CONTEXT line (never a target source)
plus, for H1, a cockpit checklist line; anything disproven is logged and NOT
wired. Budget 10 experiments. Research-only until verdicts land (ADR-010).

**Data** — new frozen artifacts (existing caches untouched):
`macro_daily_3y.json` (CL=F, DX-Y.NYB, ^TNX, HYG, GLD, ^GSPC, ^VIX daily 3y),
`spy_5m_60d.json` (fresh SPY 5m incl. 2026-07-23). ES hourly reuses
`es_hourly_730d.json`. Gamma-regime history from the store's gex history
(length-limited; conditioned cuts reported only where n permits).

**Constraints** — direction claims need controls (shuffle/sign-stability);
plain-register phrasing on any surfaced line; the level-book target discipline
is untouchable here.

**Status**: ACHIEVED · started 2026-07-23 · closed 2026-07-23 — H1 (late-day
unwind) and H2a (intermarket direction, incl. the oil thesis) disproven;
H2b shock→range echo confirmed for DXY/HYG and shipped as context bullets;
Phase 0 (context block → forecast snapshot) shipped. See log.md.
