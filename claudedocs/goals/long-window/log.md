# Hypothesis log — long-window

Metrics + fill rules identical to prior loops. Measurement command:
`server/.venv/bin/python -m vantage_server.backtest --cache
backtest_data/bars_hourly_730d.json --params '{...}'`
(single-interval cache; scaffolds AND fills on hourly bars — coarser than
prod; only DIRECTIONAL mechanism verdicts transfer, never absolute numbers.)

Coverage: 730 SESSIONS (2023-08-11 → 2026-07-10, ~3 years). Robustness
slices (stricter than the contracted two): Y1 ≤ 2024-07-10, Y2 = 2024-07-11 →
2025-07-10, Y3 ≥ 2025-07-11. REPLICATES requires full-window WR+PF wins plus
directional wins in Y2 AND Y3 (contract); Y1 reported as extra evidence.

Mechanism verdict rule: REPLICATES = beats its control on BOTH WR and PF on
the full window AND directionally in each yearly half.

## E0 baseline
method: touch entries, prod design params (pivot_n 3 now default), hourly.
value: (pending freeze)
result: n=697, WR 0.1148, PF 0.245, net −91.6% (603 stop / 50 target / 44 eod;
1051 replayed sessions, 2833 tickets, 1818 no-target)
value recorded. The touch baseline is as broken over 3 years as over 60 days.
Method note: yearly slices are computed post-hoc from each run's per-trade
list — equivalent to date_min/date_max runs because the date filter only gates
trading, never scaffold content.

## H1 MECHANISM: reclaim vs touch (the program's core claim)
prediction: REPLICATES — reclaim (1 hourly close) beats touch on WR and PF on
the full 3 years AND in each of Y1/Y2/Y3. Magnitude guess: WR 0.35-0.50,
PF 0.9-1.4 (hourly closes travel farther than 15m ones, so weaker than the
60-day numbers but decisively above touch's 0.115/0.245 everywhere).
experiment: {"entry_mode": "reclaim"} vs E0, sliced.
result: reclaim full 0.406/0.75 (n=249) vs touch 0.115/0.245 (n=697);
Y1 0.427/0.85 vs 0.106/0.21 · Y2 0.486/1.018 vs 0.139/0.291 · Y3 0.339/0.588
vs 0.105/0.241.
verdict: **REPLICATES** — reclaim beats touch on WR and PF in the full window
and all three yearly slices. WR in band; PF (0.75) under my 0.9-1.4 band:
hourly reclaim is directionally right but not profitable stand-alone (matches
loop 2's "hourly triggers are weak" finding). Mechanism real; absolute config
granularity-bound.

## H2 MECHANISM: pivot width 3 vs 2 (under reclaim)
prediction: REPLICATES — pivot_n 3 ≥ pivot_n 2 on WR and PF, full + Y2 + Y3
(margin smaller than the 60-day +10.6pp; guess +2-8pp WR, +0.1-0.5 PF).
experiment: {"entry_mode": "reclaim", "pivot_n": 2} control vs the H1 run.
result: pivot2 full 0.442/0.884 vs pivot3 0.406/0.75; Y1 0.464/1.033 vs
0.427/0.85 · Y2 0.518/1.252 vs 0.486/1.018 · Y3 0.359/0.58 vs 0.339/0.588.
verdict: **FAILS TO REPLICATE** as stated — pivot 2 beats pivot 3 at hourly.
But pivot_n counts BARS: 15m×3 = 45 min of lookaround; hourly×3 = 3 HOURS.
Reframed hypothesis: the law is a TIME-scale sweet spot, not "wider is
better". Hourly n=1 (1h lookaround, nearest to the adopted 45min) should then
beat n=2 (2h). Testing before issuing the verdict.

## H3 pivot time-scale law: hourly pivot_n 1 completes the dose curve
prediction: if the sweet spot is ~45-90 MINUTES of lookaround (not a bar
count), hourly n=1 ≥ n=2 ≥ n=3 on the full window: n=1 WR ≥ 0.45, PF ≥ 0.95.
If instead n=1 < n=2, the pivot mechanism is genuinely muddy across scales.
experiment: {"entry_mode": "reclaim", "pivot_n": 1}.
result: hourly pivot n=1 → 0.441/0.91 · n=2 → 0.442/0.884 · n=3 → 0.406/0.75.
verdict: confirmed (time-scale reframe) — n=1 ≈ n=2 > n=3 at hourly. Verdict
for the pivot MECHANISM: **"wider is better" is a WINDOW/SCALE ARTIFACT; the
robust law is a lookaround sweet spot of roughly 45min-2h.** The 15m
adoption (3×15m = 45min) sits inside the sweet spot and stands, but its
docstring generality claim must be corrected at loop end.

## H4 MECHANISM: structure direction-gate (under reclaim)
prediction: REPLICATES — the gate improves WR and PF on full + Y2 + Y3
(it encodes "don't fight the 10-session trend", which is regime-generic).
Guess: WR +4-8pp, PF +0.15-0.4 vs reclaim's 0.406/0.75.
experiment: {"entry_mode": "reclaim", "direction_gate": "structure"}.
result: gate full 0.436/0.836 vs 0.406/0.75 (✓✓); Y1 0.432/1.04 vs 0.427/0.85
(✓✓); Y2 0.509/0.968 vs 0.486/1.018 (WR ✓, PF ✗); Y3 0.385/0.714 vs
0.339/0.588 (✓✓).
verdict: PARTIALLY REPLICATES — WR improves in every view; PF in 3 of 4
(fails Y2 by 0.05). Much weaker than the 60-day effect. Gate = mild, mostly-
consistent quality filter, not the multiplier the short window suggested.

## H5 MECHANISM: fresh-vs-durable zones (fresh-exclusion under reclaim)
prediction: REPLICATES — durable-memory selectivity is regime-generic:
fresh-excluded beats reclaim-base on WR and PF, full + Y2 + Y3, n ~60-90.
experiment: {"entry_mode": "reclaim", "exclude_freshness": ["fresh"]}.
result: full 0.403/0.889 vs base 0.406/0.75 (WR ✗ flat, PF ✓); Y1 ✓PF;
Y2 0.423/0.917 vs 0.486/1.018 (✗✗); Y3 0.375/0.777 vs 0.339/0.588 (✓✓).
verdict: **FAILS TO REPLICATE** — the durable-memory/freshness filter, the
60-day program's strongest quality signal, shows only a weak inconsistent PF
tilt over 3 years of hourly data. Downgrade the freshness tier from "signal"
to "weak hint" in guidance. (Caveat: hourly scaffolds construct the freshness
tags from coarser levels — the tag itself is granularity-sensitive.)

## H6 MECHANISM: break setups beat test setups (under reclaim)
prediction: REPLICATES — flip-zone-plus-confirmation is the program's
strongest family: break beats test on WR and PF, full + Y2 + Y3, from the H1
reclaim dump (post-hoc by setup).
experiment: analysis of g4_reclaim.json trades grouped by setup × period.
result: break vs test — full 0.429/0.797 vs 0.395/0.733 (✓✓); Y1 ✓✓;
Y2 0.364/0.566 vs 0.540/1.206 (✗✗, tests dominate); Y3 ✓✓.
verdict: PARTIALLY REPLICATES — break superiority holds in 3 of 4 views but
inverts hard in the Y2 regime. The 60-day "breaks almost never lose" tier
(PF 54, n=9) was small-sample shine; the honest statement is "breaks and
tests trade leadership by regime; neither is discardable."

## H7 MECHANISM: the counter-trend flag marks worse trades
prediction: REPLICATES — with-trend beats counter-trend on WR and PF, full +
Y2 + Y3 (post-hoc from the reclaim dump by counter_trend).
experiment: analysis of g4_reclaim.json trades by counter_trend × period.
result: with-trend vs counter — full 0.436/0.836 vs 0.338/0.596 (✓✓); Y1 ✓✓;
Y2 0.509/0.968 vs 0.400/1.223 (WR ✓, PF ✗ on counter n=15); Y3 0.385/0.714 vs
0.226/0.321 (✓✓ decisively).
verdict: PARTIALLY REPLICATES (strict rule misses on Y2's PF with n=15 —
noise-sized sample). WR improves everywhere; Y3 shows the flag at its best.
The counter-trend warning stays in prod guidance.

## H8 MECHANISM: confluence tolerance peak at 0.15
prediction: REPLICATES as a peak — 0.10 and 0.20 both land below the 0.15
base (full-window PF 0.75) by ≥0.05 PF, mirroring the 60-day curve.
experiment: {"entry_mode": "reclaim", "confluence_tol_pct": 0.10} and
{"...": 0.20}.
result: 0.10 → 0.380/0.64 · 0.15 → 0.406/0.75 · 0.20 → 0.409/0.827 (full).
verdict: **FAILS TO REPLICATE as a universal peak** — at hourly, 0.20 mildly
beats 0.15; only "0.10 is too tight" holds across scales. Clustering
tolerance is scale-dependent; the 15m default keeps 0.15 but loses its
"proven peak" status in guidance.

## H9 MECHANISM: confirmation depth beyond ~15-30 min over-confirms
prediction: REPLICATES — 2 consecutive HOURLY closes (2h of confirmation)
lands below 1 hourly close on both metrics (the 60-day law: depth past the
sweet spot costs entry price without buying quality): PF ≤ 0.70, WR ≤ 0.40.
experiment: {"entry_mode": "reclaim", "confirm_closes": 2}.
result: 2×hourly → full 0.357/0.499 vs 1×hourly 0.406/0.75; worse in every
slice too.
verdict: **REPLICATES** — confirmation depth beyond the sweet spot hurts, at
every scale tested. Combined law across loops: confirmation is an optimum in
TIME (~15-60 min), not a bar count; more is not safer.

## H10 MECHANISM: the tight-stop discipline is scale-dependent (stop pad)
prediction: at hourly, 0.20% (tuned for 15m bar noise) is TOO TIGHT: 0.40%
beats it on PF (≥ 0.85) and WR (+4-10pp); if 0.60% beats 0.40% too, stops
scale with bar size — the "0.20% is right" finding is a 15m-scale fact, not
universal.
experiment: {"entry_mode": "reclaim", "stop_pad_pct": 0.40} and
{"stop_pad_pct": 0.60}.
result: 0.40 → 0.438/0.704 · 0.60 → 0.446/0.705 vs 0.20 → 0.406/0.75.
verdict: my scale-dependence hypothesis DISPROVEN — which REPLICATES the
original mechanism: wider stops buy WR but cost PF at every scale; the tight
pad keeps the best PF even on hourly bars. The stop knob is a smooth WR↔PF
trade-off with no free lunch, everywhere.

## H11 MECHANISM: the edge is not an SPX artifact (per-symbol)
prediction: REPLICATES directionally — QQQ's reclaim slice sits at or above
the SPX slice on PF (as in both short loops); IWM remains target-starved
(n < 30 over 3 years).
experiment: post-hoc by underlying from the reclaim dump.
result: SPX 0.403/0.769 · QQQ n=23, 0.435/0.629 (WR ✓, PF ✗, small n) ·
IWM n=0 — ZERO trades in three years.
verdict: mixed — QQQ comparable, not better; and the IWM no-target gap is now
a CONFIRMED product defect at scale (its confluence never yields an opposing
target). Elevate to prod backlog: IWM needs a target fallback or its own zone
params.

## H12 MECHANISM: vol-scaled stops should beat fixed % ACROSS vol regimes
prediction: loop 1 called ATR stops a wash on 60 days; across 2023-2026 vol
cycles the mechanism gets its real test. If vol-adaptivity is real,
stop_atr_mult 1.0 beats the fixed 0.20% pad on PF over the full window and
in ≥2 of 3 yearly slices (PF ≥ 0.80 full). I predict it DOES (this is what
ATR is for).
experiment: {"entry_mode": "reclaim", "stop_atr_mult": 1.0}.
result: ATR 1.0 → full 0.430/0.695; every slice below the fixed pad's PF.
verdict: DISPROVEN — vol-scaled stops lose to the tight fixed pad even across
three years of vol regimes. ATR widens stops exactly when losses are dearest;
the fixed %-of-level pad stays. (Two loops, two scales, same answer — this
one is settled.)

## H13 hourly-tuned stack: reclaim + gate + tol 0.20 beats reclaim base
prediction: the two surviving hourly improvements compose: full PF ≥ 0.90
(vs 0.75), WR ≥ 0.44, and Y2 stays ≥ 1.0. If composition fails, the hourly
knobs are non-additive like vp_bins was.
experiment: {"entry_mode": "reclaim", "direction_gate": "structure",
"confluence_tol_pct": 0.20}.
result: stack full 0.421/0.886 (vs base 0.406/0.75) ✓✓; Y2 1.265 ✓;
Y3 0.723 vs 0.588 ✓✓; Y1 0.711 vs 0.85 ✗.
verdict: mostly confirmed — gate + looser tol compose at hourly (3 of 4
views), full-window PF a hair under my 0.90 line. Best hourly config found;
still sub-1.0 PF overall — hourly remains a validation instrument, not a
tradeable config.

## H14 consistency grain: the reclaim edge is monthly, not lumpy
prediction: reclaim's net-%-minus-touch's is ≥ 0 in ≥ 65% of calendar months
(~35 months) — the edge is steady rather than driven by a few outlier months.
experiment: post-hoc monthly aggregation of the touch + reclaim dumps.
result: 36/36 months (100%) — reclaim ≥ touch in every calendar month of the
window; the edge's three worst months are still positive (+0.2 to +0.5).
verdict: CONFIRMED emphatically — the reclaim mechanism's edge is steady,
not outlier-driven. This is the single strongest robustness result in the
four-loop program.

## H15 regime split: does reclaim's edge survive DOWN months?
prediction: REPLICATES — grouping months by SPY's own monthly direction,
reclaim beats touch on net% in both up-months and down-months (edge in down
months smaller but positive).
experiment: post-hoc regime split of the touch/reclaim dumps by SPY monthly
close direction from the frozen bars.
result: up-months (25): edge +67.7% · down-months (11): edge +16.0% —
reclaim ~breakeven (−0.1%) in down months where touch loses 16%.
verdict: REPLICATES — the edge survives both regimes; reclaim's defensive
value (not catching knives) shows exactly where it should: in down months.

## H16 cross-granularity anchor: does hourly rank the fine window the same?
prediction: on the last ~60 sessions (2026-04-15 →, the fine-cache period),
hourly reclaim beats hourly touch decisively (WR +20pp or more) — the same
ranking the 5m/15m program measured there.
experiment: post-hoc slice of both dumps to day ≥ 2026-04-15.
result: fine-window slice at hourly — touch 0.094/0.26 vs reclaim 0.400/0.821
(+30.6pp WR, PF ×3.2).
verdict: CONFIRMED — the hourly instrument reproduces the fine-grained
program's core ranking on the same calendar period (touch 0.103/0.263 →
reclaim 0.500/1.289 at 15m). Granularities agree on direction; magnitudes
differ as expected.

## H17 IWM rescue candidate: R-fallback targets give IWM trades at all
prediction: with target_r_fallback 1.5, IWM finally produces trades (n ≥ 20
over 3 years) at defensible quality (PF ≥ 0.7) — loop 1 showed IWM's
R-target slice was its only working mode. If yes → prod fix candidate.
experiment: {"entry_mode": "reclaim", "target_r_fallback": 1.5}, IWM slice.
result: fallback full 0.387/0.526 (drags everything); IWM n=30 at PF 0.247;
QQQ fallback slice 0.277/0.254.
verdict: DISPROVEN — R-fallback rescues volume, not economics, at hourly too
(three loops, three scales, same answer: no-target tickets are no-target for
a reason). IWM's correct status: not tradeable under this strategy until its
level generation improves; do NOT ship a fallback.

## H18 MECHANISM: confluence (≥2 dims) earns its keep at hourly
prediction: REPLICATES — min_zone_dims 1 floods the ticket set with
single-dimension levels and lands clearly below base on PF (≤ 0.65) with
n in the many hundreds.
experiment: {"entry_mode": "reclaim", "min_zone_dims": 1}.
result: n=3665, full 0.400/0.708 vs base 0.406/0.75 — slightly worse per
trade across 15× the volume, hemorrhaging net (−175%).
verdict: REPLICATES (as a filter that protects capital): confluence zones
aren't per-trade magic, but without them the strategy trades constantly and
bleeds. The ≥2-dims rule = exposure discipline. Keep.

## H19 R:R floor at hourly (rr_min 1.0)
prediction: inconclusive again (loop 1's verdict): PF within ±0.07 of base,
n ~200-230 — the displayed R:R doesn't select at any scale.
experiment: {"entry_mode": "reclaim", "rr_min": 1.0}.
result: full 0.410/0.764, all slices within noise of base.
verdict: confirmed (inconclusive at every scale) — the displayed R:R floor
selects nothing. Settled; drop from future loops.

## H20 nearest-zone-only at hourly (max_per_side 1)
prediction: mildly negative again (loop 1): PF 0.68-0.75, n ~200.
experiment: {"entry_mode": "reclaim", "max_per_side": 1}.
result: full 0.414/0.726 — mildly below base, as at 15m.
verdict: confirmed — depth-2 zones contribute at every scale. Keep both.

## H21 time stops at hourly (3 bars ≈ half a session)
prediction: hurts again (loop 1's law "time stops truncate winners"): PF
drops ≥ 0.05 below base; the many profitable eod holds get cut.
experiment: {"entry_mode": "reclaim", "time_stop_bars": 3}.
result: full 0.418/0.834 (vs 0.406/0.75), better in ALL slices (Y1 1.058,
Y2 1.026, Y3 0.651).
verdict: prediction DISPROVEN — time stops HELP at hourly. Loop 1's "time
stops truncate winners" was a 15m-scale fact: fine-grained entries resolve
fast, hourly fills are late and their eod holds skew negative. Scale-dependent
mechanism; noted for the table (and as a candidate refinement IF prod ever
trades coarse bars — it doesn't today).

## H22 open-skip at hourly (skip first bar)
prediction: buys nothing at any scale (loop 1): metrics within noise of base.
experiment: {"entry_mode": "reclaim", "skip_open_bars": 1}.
result: full 0.401/0.754 — within noise of base (0.406/0.75).
verdict: confirmed — open-skip buys nothing at any scale. Settled.

## H23 durable-knob inertness replicates
prediction: durable_min_sessions 2 produces metrics IDENTICAL (or within
noise) to base at hourly too — the knob doesn't bind in the base config.
experiment: {"entry_mode": "reclaim", "durable_min_sessions": 2}.
result: IDENTICAL to base in every view.
verdict: confirmed — durable knobs don't bind outside freshness-filtered
tiers, at any scale. Settled.

## H24 break×gate interaction at hourly
prediction: gate helps breaks less than tests (breaks already require a
polarity flip): breaks-only+gate PF within ±0.1 of breaks-only (0.797).
experiment: {"entry_mode": "reclaim", "include_tests": false,
"direction_gate": "structure"}.
result: breaks+gate full 0.511/1.18 (net positive!); Y1 1.253, Y2 0.533,
Y3 1.871.
verdict: prediction DISPROVEN (good direction) — the gate helps breaks a lot;
break+gate is the only profitable full-window hourly config. Y2's break
weakness persists through it (regime-dependence stands).

## H25 deliverable: verdict table + prod guidance corrections + gate
prediction: suite stays green (bar the known pre-existing failures) after the
two honesty corrections (pivot docstring scale-law wording; freshness comment
softening). Registered as the closing experiment.
experiment: assemble the table below, apply corrections, run pytest.

---

# Final report (26 experiments incl. E0; predicate satisfied — verdict table)

The four-loop program's standing caveat — "one 60-day uptrend tape" — is
retired. Every adopted mechanism was re-tested on 730 hourly sessions
(2023-08-11 → 2026-07-10: the 2023 correction, the 2024 bull, 2025's chop and
drawdowns, 2026). Directional verdicts only; hourly absolutes are not trading
numbers.

## Verdict table

| Mechanism (origin) | Long-window verdict |
|---|---|
| Reclaim > touch (loop 1) | **REPLICATES — everywhere.** Full + all 3 years + 36/36 months + both up- and down-month regimes (+16pp edge even in down months). The program's core finding is real market structure. |
| Confirmation depth sweet spot (loop 2) | **REPLICATES** — 2×hourly < 1×hourly, matching "depth is a TIME optimum (~15-60 min), more is not safer". |
| Tight stop pad keeps best PF (loops 1-2) | **REPLICATES** — wider pads buy WR, cost PF, at every scale. Smooth trade-off, no free lunch. |
| Confluence ≥2 dims (loop 3) | **REPLICATES** (as exposure discipline) — without it: 15× the trades, −175% net. |
| Structure gate (loops 1-3) | PARTIAL — WR up everywhere, PF in 3 of 4 views. A mild consistent filter, not a multiplier. |
| Counter-trend flag (loop 1) | PARTIAL — decisive in trending regimes (Y3), noisy in Y2 (n=15). Keep as warning. |
| Break > test hierarchy (loops 1-3) | PARTIAL — leads in 3 of 4 views but INVERTS in Y2; "breaks almost never lose" (PF 54, n=9) was small-sample shine. Break+gate is the only profitable full-window hourly config (1.18). |
| Pivot width 3 > 2 (loop 3) | **SCALE ARTIFACT as stated** — real law: lookaround sweet spot ~45min-2h. 15m default (=45min) stands; docstring corrected. |
| Fresh-vs-durable filter (loops 1-3) | **FAILS TO REPLICATE** — the 60-day program's strongest quality signal is a weak, inconsistent PF tilt over 3 years. Guidance downgraded to "weak hint"; prod comment corrected. |
| Confluence tol 0.15 peak (loop 3) | **SCALE-DEPENDENT** — only "0.10 too tight" generalizes; hourly prefers 0.20. 15m default keeps 0.15, loses "proven peak" status. |
| Time stops hurt (loop 1) | **SCALE ARTIFACT** — they HELP at hourly (late fills, negative eod skew). Irrelevant to 15m prod today. |
| ATR stops (loop 1) | Settled disproven — loses to fixed pad even across 3 years of vol regimes. |
| R-fallback targets (loops 1-2) | Settled disproven at all scales; IWM confirmed untradeable (0 trades/3 years) — fix is better level generation, NOT a fallback. |
| rr_min / max_per_side / open-skip / durable knobs | Settled: inert or mildly negative at every scale. Dropped from future loops. |

Counts: 10 confirmed · 6 disproven · 4 mixed/partial · 1 inconclusive · 5
post-hoc analyses inside registered experiments.

**Most valuable disproven hypothesis:** "durable-memory zones are the quality
signal" — it anchored the premium tiers of all three short loops and does not
survive three years of regimes. Its demotion (plus the pivot time-scale
reframe) is exactly the kind of correction the long window existed to make.

**What prod carries forward unchanged:** reclaim 3×5m trigger, pivot_n 3 on
15m scaffolds, 0.20% stop pad, ≥2-dim confluence zones, break tickets flagged
for experts with the gate/trend warnings. What changed: two honesty
corrections (pivot docstring scale-law; freshness comment downgrade).

Caveats that remain: hourly granularity proxies the mechanisms, not the
5m/15m execution; GEX absent from all backtest scaffolds; single data vendor.
Next re-validation: re-freeze quarterly; consider a paid 5m archive if the
paper record diverges from backtest expectations.
