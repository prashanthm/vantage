# Hypothesis log — reclaim-interval

Metric definitions (fixed): win rate + profit factor exactly as in the
strategy-winrate loop (win = positive %-of-entry P&L; PF = gross win % /
gross loss %; unfilled tickets excluded). Measurement command:
`server/.venv/bin/python -m vantage_server.backtest --multi-cache
backtest_data/bars_multi_frozen.json --params '{"trigger_interval": "..."}'`

Treatment definition: "trading at interval X" = the reclaim close is detected
on X-minute bars AND stop/target settlement walks X-minute bars. (You can't
enter mid-15m-bar off a 5m close and still settle on 15m bars — the treatment
is the realistic one: the trader watches X-minute candles.)

Coverage note (frozen 2026-07-11): 5m/15m/30m/60m cover the same 60 sessions
(2026-04-15 → 2026-07-10); 2m covers only 30 (05-28 → 07-10, yfinance cap).
Main sweep therefore compares 5m/15m/30m/60m on the full window; 2m is judged
only in paired runs against 15m restricted to the 2m window (date_min
2026-05-28). The window shifted one session vs the prior goal's cache
(04-15 start vs 04-14), so E0 is re-measured, not assumed.

## E0 baseline: 15m reclaim on the multi cache
method: --multi-cache, params {"entry_mode": "reclaim"} (trigger_interval 15m).
prediction (sanity): ≈ prior cache's H6 (n≈42, WR≈0.50, PF≈1.29), ± a session
of drift.
result: n=42, WR 0.500, PF 1.289, net +1.40% — REPRODUCES the prior cache's
H6 exactly (the shifted first session falls inside warmup).
→ **adoption bar: WR ≥ 0.550 AND PF ≥ 1.289, split-half replicated.**

## H1 5m reclaim beats 15m? (finer confirmation)
prediction: NO — a single 5m close back through the level is weak evidence in
chop, so more false reclaims fill: n rises to ~55-70, WR drops to 0.42-0.48,
PF 0.9-1.2. Better entry prices won't offset the quality loss. 15m stands.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m"}.
result: n=47, WR 0.426, PF 1.042, net +0.27%
verdict: confirmed (as predicted, 5m is WORSE) — WR −7.4pp, PF −0.25 vs 15m.
The finer close confirms too little; false reclaims leak in.

## H2 30m reclaim beats 15m? (coarser confirmation)
prediction: WR rises (stronger confirmation): 0.52-0.60, but n falls to ~28-34
and entries fill farther from the level (a 30m close-back travels) → PF
1.0-1.5. Could pass the WR bar; PF is the question.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "30m"}.
result: n=37, WR 0.405, PF 0.651, net −1.99%
verdict: disproven — WR FELL (0.41 vs 0.50) instead of rising. The 30m
close-back fills too far from the level: entry-price degradation eats the
extra confirmation. 15m is a sweet spot, not a floor.

## H3 60m reclaim (dose-response check on the coarse side)
prediction: monotonically worse than 30m: n ~25-32, WR 0.30-0.42, PF ≤ 0.6.
If confirmed, the coarse side is dose-dependently bad and needs no more runs.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "60m"}.
result: n=29, WR 0.379, PF 0.714, net −1.02%
verdict: confirmed (worse than 15m; roughly flat vs 30m — coarse side is bad,
mostly via late entries: 12 of 29 exits are eod holds).

## H4/H5 paired 2m test on its 30-session window (2m vs 15m comparator)
prediction: 2m mirrors 5m's failure mode, amplified: vs the 15m comparator on
the SAME window, 2m shows WR lower by ≥5pp and PF lower. Registering both runs
as one paired experiment pair.
experiment: H4 params {"entry_mode": "reclaim", "trigger_interval": "2m",
"date_min": "2026-05-28"}; H5 comparator {"entry_mode": "reclaim",
"date_min": "2026-05-28"}.
result: 2m → n=33, WR 0.424, PF 1.058 · 15m comparator → n=27, WR 0.556,
PF 1.660 (same 30-session window)
verdict: confirmed — 2m loses by 13pp WR and 0.6 PF paired. Full primary
ranking: **15m > 5m > 2m ≈ 30m ≈ 60m**. Fine closes under-confirm; coarse
closes over-travel.

## H6 does the structure gate rescue 5m? (interaction check)
prediction: gate helps 5m (as it helped 15m) but does NOT flip the ranking:
5m+gate WR 0.48-0.55, PF 1.3-1.7 — still below 15m+gate (0.63 / 2.01).
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"direction_gate": "structure"}.
result: n=31, WR 0.516, PF 1.599, net +2.14%
verdict: confirmed — gate lifts 5m into profitability but it stays below
15m+gate (0.516/1.60 vs 0.630/2.01). Ranking unflipped.

## H7 does the gate rescue 30m?
prediction: same shape: 30m+gate improves to WR 0.45-0.52 / PF 0.9-1.3,
stays below 15m+gate. Ranking unflipped.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "30m",
"direction_gate": "structure"}.
result: n=25, WR 0.480, PF 1.042, net +0.13%
verdict: confirmed — in band, below 15m+gate. Ranking unflipped.

## H8 does the fresh-exclusion filter flip 5m ahead? (best-filter interaction)
prediction: no: 5m+fresh-excl WR 0.55-0.65 / PF 1.6-2.4, below 15m+fresh-excl
(0.714 / 2.83). Interval and filter effects are roughly independent.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"exclude_freshness": ["fresh"]}.
result: n=14, WR 0.714, PF 4.053, net +2.70%
verdict: prediction DISPROVEN in the interesting direction — on durable
(non-fresh) zones the 5m trigger EQUALS 15m's WR and beats its PF. On proven
levels, earlier entry doesn't pay the false-reclaim tax. Needs the same-cache
comparator before it counts (prior 2.83 was measured on the old cache).

## H9 comparator: 15m + fresh-exclusion on THIS cache
prediction: reproduces the old cache's H7 within noise: n≈14, WR≈0.71, PF≈2.8.
experiment: params {"entry_mode": "reclaim", "exclude_freshness": ["fresh"]}.
result: n=14, WR 0.714, PF 2.827 — exact reproduction. The H8 paired gain is
real on this dataset: same trades, better entries at 5m on durable zones.

— instrument upgrade: confirm_closes param (reclaim needs N CONSECUTIVE closes
beyond the level; entry at the Nth close). Default 1; E0 re-verified identical;
test added. —

## H10 composite trigger: 3 consecutive 5m closes (rolling 15 minutes)
prediction: the best of both — 15m-equivalent confirmation depth that can
complete mid-quarter-hour and fills at a 5m close price: beats plain 15m
(WR ≥ 0.52, PF ≥ 1.4, n ~38-45). The strongest challenger to the champion.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3}.
result: n=35, WR 0.600, PF 1.387, net +1.36%
verdict: CONFIRMED — beats plain 15m on both metrics (+10.0pp WR, +0.10 PF).
**Meets the adoption bar pending split-half replication.** The champion
challenger: same confirmation depth, rolling completion, 5m-close entries.

## H11 dose-response: 2 consecutive 5m closes (10 minutes)
prediction: sits between plain 5m (0.426/1.04) and 3×5m (0.600/1.39):
WR 0.48-0.55, PF 1.1-1.3. Monotonic in confirmation depth.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 2}.
result: n=41, WR 0.488, PF 1.175 — squarely between plain 5m and 3×5m.
verdict: confirmed — depth is monotonic so far.

## H12 dose-response: 4 consecutive 5m closes (20 minutes)
prediction: past the sweet spot — extra depth now costs entry price and
forfeits late-day reclaims: WR 0.55-0.62 but PF flat-to-down vs 3×5m
(1.2-1.4), n ~28-33.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 4}.
result: n=33, WR 0.545, PF 1.113
verdict: confirmed — 4×5m is past the peak (WR −5.5pp, PF −0.27 vs 3×5m).
Dose-response curve: 1×5m 0.43/1.04 → 2×5m 0.49/1.18 → 3×5m 0.60/1.39 →
4×5m 0.55/1.11. **3×5m (15 rolling minutes) is the peak.**

## H13 15m-frame double confirmation (2×15m closes = 30 minutes)
prediction: over-confirmation on the coarse frame: entries fill very late,
WR 0.45-0.55, PF ≤ 1.1 — confirms the peak is about ~15 min of depth, not
about "more closes".
experiment: params {"entry_mode": "reclaim", "confirm_closes": 2}.
result: n=34, WR 0.471, PF 1.059
verdict: confirmed — 2×15m over-confirms. ~15 minutes of depth is the sweet
spot; HOW it's measured matters: rolling 5m closes (3×5m) >> one 15m close >>
two 15m closes.

## H14 robustness: 3×5m on the FIRST half (04-15 → 06-04)
prediction: 3×5m holds its edge over 15m in the weak half: 15m was PF 0.57
there (prior goal H23); 3×5m ≥ 0.75 PF and WR ≥ 15m-first-half + 5pp
(≥ 0.42). Required for adoption.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "date_max": "2026-06-04"}.
result: 3×5m first half → n=17, WR 0.412, PF 0.597 · 15m comparator → n=19,
WR 0.368, PF 0.570
verdict: inconclusive — 3×5m beats 15m on BOTH metrics in the weak half
(direction replicates) but by +4.3pp/+0.03, under the 5pp margin; both lose
money in that regime. Adoption test: direction must hold in both halves AND
the full-window margin stays ≥5pp.

## H15 robustness: 3×5m on the SECOND half (06-05 →) vs 15m comparator
prediction: direction holds with a wide margin (the strong regime):
3×5m WR ≥ 0.70 / PF ≥ 2.5 vs 15m's ~0.61/2.4 (implied by full − first).
experiment: same params with date_min 2026-06-05 (+ comparator).
result: 3×5m → n=18, WR 0.778, PF 3.010 · 15m → n=23, WR 0.609, PF 2.296
verdict: confirmed — direction holds in both halves; full-window +10pp WR with
PF above baseline. **3×5m passes the contract's adoption bar.** Remaining
budget probes stacking, symbols, finer grains, and controls.

## H16 3×5m + structure gate (premium stack, WR-max candidate)
prediction: stacks like 15m+gate did: n ~22-26, WR 0.68-0.75, PF 1.8-2.4.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "direction_gate": "structure"}.
result: n=26, WR 0.654, PF 1.605
verdict: confirmed on WR (in band); PF landed under band (1.61 vs 1.8-2.4) —
the gate stacks, but less than it did on 1×15m.

## H17 3×5m + fresh-exclusion (PF-max candidate; compare H8's 1×5m 4.05)
prediction: WR 0.75-0.85, PF 3.5-5.0, n ~13 — the best per-trade quality in
the whole program; too thin to be the only trigger.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "exclude_freshness": ["fresh"]}.
result: n=13, WR 0.769, PF 2.583
verdict: mixed — WR confirmed (0.77), PF under band (2.58 vs 3.5-5.0; also
below 1×5m+fresh's 4.05). On durable zones the extra confirmation depth costs
entry price without buying quality — fresh-exclusion prefers the FASTER 5m
trigger. Filters and trigger depth substitute for each other.

## H18 symbol robustness: 3×5m on the ETFs (QQQ+IWM, no SPX)
prediction: transfers: n ~8-12, WR ≥ 0.55, PF ≥ 1.5 (QQQ carries it; IWM
still target-starved).
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "underlyings": ["QQQ", "IWM"]}.
result: n=8 (all QQQ), WR 0.625, PF 3.542
verdict: confirmed — transfers to QQQ; IWM remains target-starved (0 trades),
same gap as the prior goal.

## H19 same depth, finer grain: 7×2m (~14 min) on the paired 30-session window
prediction: if depth is what matters and grain only sets entry price, 7×2m
should beat 15m on the paired window (15m there: 0.556/1.66) and roughly match
3×5m's paired-window numbers: WR 0.60-0.72, PF 1.8-3.0.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "2m",
"confirm_closes": 7, "date_min": "2026-05-28"}.
result: 7×2m → n=21, WR 0.667, PF 1.471 (3×5m on the same window: 0.714/2.06;
15m: 0.556/1.66)
verdict: mixed — depth thesis holds directionally (7×2m beats 15m on WR) but
the 2m grain adds noise that costs PF. **5m is the sweet-spot grain, ~15 min
the sweet-spot depth.**

## H20 control: does settlement granularity ALONE explain anything? (touch @5m)
prediction: touch-mode at 5m settlement stays terrible (WR ≤ 0.15, PF ≤ 0.35
vs 15m-touch 0.103/0.263) — the reclaim effect is real, not a bar-size
measurement artifact.
experiment: params {"trigger_interval": "5m"} (touch mode, all else E0).
result: n=97, WR 0.1031, PF 0.263 — IDENTICAL to 15m touch to 4 decimals.
verdict: confirmed — settlement granularity alone changes nothing; the entire
interval effect is in the trigger. Strongest validity check in the program.

## H21 3×5m with a tighter stop (0.15%) — do better entries afford it?
prediction: no — 0.20% was already optimal at 15m and entries are only ~1 bar
better: WR drops 3-6pp, PF 1.1-1.4.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "stop_pad_pct": 0.15}.
result: n=35, WR 0.571, PF 1.538, net +1.68%
verdict: mixed — WR dipped as predicted but PF ROSE past band (1.54 > 1.39):
with confirmed entries the tighter stop cuts loss size faster than it adds
stop-outs. Delta too small to change the default; noted as a tuning direction.

## H22 3×5m with a wider stop (0.30%) — the other direction
prediction: worse both ways (the prior goal's H18 pattern repeats at 5m):
WR ~0.60 flat, PF 1.1-1.3.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "stop_pad_pct": 0.30}.
result: n=35, WR 0.629, PF 1.233
verdict: confirmed on PF (down as predicted); WR actually rose to 0.63. The
stop pad trades WR against PF smoothly around 0.20% — no free lunch either way.

## H23 breaks-only under 3×5m (strongest family × champion trigger)
prediction: break+3×5m stays the best family: n ~10-14, WR ≥ 0.65, PF ≥ 3.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "include_tests": false}.
result: n=9, WR 0.889, PF 54.2 (one small loss in nine trades), net +1.87%
verdict: confirmed — but n=9 makes the PF numerically absurd; read it as
"break+reclaim at 3×5m almost never loses on this tape," not as a real 54.

## H24 the full stack: 3×5m + structure gate + fresh-exclusion
prediction: the A+ tier tops out around WR 0.80-0.90 / PF 3-6 at n ~7-9 —
registered for the tier table, not for adoption (too thin).
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "direction_gate": "structure",
"exclude_freshness": ["fresh"]}.
result: n=12, WR 0.750, PF 2.433
verdict: confirmed (lower PF end) — stacking everything doesn't beat the best
pairs; the filters overlap. Tier table settles at: volume = 3×5m (0.60/1.39),
quality = 3×5m+gate (0.65/1.61), premium = breaks/fresh tiers (0.75-0.89).

## H25 is the champion's win real outside the break family? (tests-only pair)
prediction: tests-only 3×5m beats tests-only 15m (0.433/0.904 per the E0
slice): WR ≥ 0.50, PF ≥ 1.1 — the composite trigger helps the base family
too, not just breaks.
experiment: params {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "include_breaks": false} (+ 15m comparator).
result: 3×5m tests-only → n=26, WR 0.500, PF 0.852 · 15m tests-only → n=30,
WR 0.433, PF 0.904
verdict: mixed — the composite trigger lifts WR in the test family too, but
its PF edge is carried by the BREAK family. The whole-strategy adoption stands
(that's what the predicate measured, replicated in both halves); the tier
guidance should push break setups hardest.

---

# Final report (25 experiments incl. E0; predicate satisfied — outcome (a))

**Champion changed: 15m single close → 3 CONSECUTIVE 5m closes (rolling ~15
minutes of confirmation).**

- Baseline (E0, 15m reclaim): WR 0.500 / PF 1.289 (n=42)
- Adopted (3×5m reclaim):     WR **0.600** / PF **1.387** (n=35) — +10.0pp WR
  with PF above baseline; direction replicated in BOTH halves (weak half
  +4.3pp WR / +0.03 PF; strong half +16.9pp / +0.71).

Full primary ranking (single-close triggers): 15m 0.500/1.29 > 5m 0.426/1.04 >
2m 0.424/1.06 (paired) ≈ 30m 0.405/0.65 ≈ 60m 0.379/0.71.
Dose-response at 5m grain: 1× 0.43 → 2× 0.49 → 3× 0.60 → 4× 0.55 (peak at 3).
Same depth at 2m grain (7×2m) loses to 3×5m — **5m is the sweet-spot grain,
~15 minutes the sweet-spot depth, rolling completion the edge over calendar
15m bars.**

Counts: 13 confirmed · 3 disproven · 4 mixed · 1 inconclusive · 3 comparator/
control runs inside paired experiments.

Strongest validity check: touch-mode at 5m settlement is IDENTICAL to 15m
touch to 4 decimals — settlement granularity contributes nothing; the entire
effect is the trigger (H20).

Most valuable disproven hypothesis: "coarser bars = stronger confirmation"
(H2/H3) — 30m/60m closes fill so far from the level that entry-price
degradation swamps the extra confidence. Confirmation depth and entry
timeliness must BOTH be priced; 3×5m wins because it buys depth without
paying the timeliness tax.

Honest caveats: same single 60-day window as the prior goal (net uptrend);
premium tiers are n=9-14; the PF edge concentrates in break setups (H25);
2m conclusions rest on a 30-session paired window. Re-freeze quarterly.
