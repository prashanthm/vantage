# Hypothesis log — breaker-fvg-anchor

Method: `server/research/breaker_fvg_anchor.py` on the frozen
`backtest_data/nq_fvg_breaker.json` (NQ=F 5m/15m/60m). Definitions in goal.md.

## E0 freeze + population census
prediction: 60m ≈ 730d of bars (thousands); 5m/15m capped at yfinance's ~60d.
Populations large enough everywhere except possibly 5m H2 after the ≥3-bar
exclusion.

## H1 co-generation sanity: FVGs born ON the break (±2 bars) sit at the level
prediction (pre-registered): hit rate > 0.60 on every TF — near-mechanical
(the break's displacement candle IS the FVG's middle bar; stops beyond the
swing fuel it). Expect CONFIRMED and boring; this is the part of the chart
observation that carries no forward information.

## H2 future FVGs (≥3 bars post-break) anchor at prior broken levels
prediction (pre-registered): the breaker/role-flip effect is real but
timeframe-dependent — CONFIRMED on 60m (lift ≥ 1.5×, p < 0.05; role-flip is
one of only two effects that survived level-folklore, and the hourly ICT
goal validated structure concepts), BORDERLINE-to-CONFIRMED on 15m, and
DISPROVEN or INCONCLUSIVE on 5m (5m swings are noise; 5m-FVG concepts have
repeatedly failed to carry hourly edges down — hourly≠1m was the
ict-concepts-edge coda). Falsified if lift < 1.5× or p ≥ 0.05 on 60m.

## H3 (conditional, only if H2 confirms somewhere): edge specificity
prediction: broken levels beat NEVER-broken (still-active) pivot levels as
anchors on the confirming TF — i.e., it's the BREAK that matters, not just
"old pivots attract FVGs". If broken ≈ unbroken, the observation collapses
to "FVGs form near old swings", a weaker and less actionable read.

---

# Results (frozen NQ=F, 2026-07-23; research/breaker_fvg_anchor.py)

## E0  populations ample everywhere
5m: 13,635 bars · 714 breaks · 3,035 FVGs (60d) · 15m: 4,565/227/1,025 (60d)
· 60m: 13,684/695/2,992 (730d). H2 n = 3,014 / 1,018 / 2,971 — no thin-sample
excuse available on any timeframe.

## H1 co-generation: **DISPROVEN** (predicted >0.60; measured 0.36–0.38)
At 0.25×ATR: 5m 0.384 · 15m 0.377 · 60m 0.363 — indistinguishable from the
H2/control base rate (~0.38). Even FVGs born ON the break bar do NOT reliably
put an edge at the broken level: the displacement gap usually swallows the
level (level sits INSIDE the gap) or overshoots it. My "near-mechanical"
story was wrong in the precise sense that the level lands mid-gap, not
edge-on.

## H2 future anchoring: **DISPROVEN on all three timeframes** (bar: lift ≥1.5, p<0.05)
eps 0.25×ATR: 5m lift 1.01 (p 0.35) · 15m 0.94 (p 0.95) · 60m 1.04 (p 0.058).
eps 0.10×ATR: 5m 1.09 (p 0.002) · 15m 0.95 (p 0.81) · 60m 1.12 (p 0.002).
eps 0.50×ATR: 1.00 / 0.93 / 0.99 — base rate 55%, signal fully drowned.
Honest footnote: at the tight band a REAL micro-effect exists on 5m/60m
(lift ~1.1, p 0.002 — detectable only because n≈3,000) — about 2 percentage
points of extra hit rate. An order of magnitude short of the bar, invisible
at chart-eye tolerance, not actionable.

## H3  not run — pre-registered as conditional on H2 confirming; it didn't.

# Decision (predicate met — all three TFs classified)

**The chart observation is the base-rate illusion.** At the tolerance a
human eye uses on a chart (≥0.25×ATR), 38–55% of ALL FVGs have an edge
"at" any given set of levels — uniformly RANDOM levels match broken levels
almost exactly (lift ≈ 1.0). What the eye does is keep the hits and discard
the misses; two screenshots is exactly how the 57% wall recruits. No scanner
change, no coach change, no new chart layer. The vendored indicator stays
context-only.

Counts: 0 confirmed · 2 disproven (incl. the H1 sanity prediction — the most
valuable disproof: even co-generated FVGs are NOT edge-anchored) · budget
used 4 runs of 10 (freeze + 3 eps bands). Caveats: NQ=F only (user-scoped);
5m/15m windows are 60 days (yfinance cap); "edge" = gap boundary — a
level-INSIDE-gap variant was not tested and would only weaken the claim
further (less specific).

**Status: ACHIEVED** · closed 2026-07-23
