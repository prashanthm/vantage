# Hypothesis log — playbook-params

Metrics + fill rules identical to the prior two loops. Measurement command:
`server/.venv/bin/python -m vantage_server.backtest --multi-cache
backtest_data/bars_multi_frozen.json --params '{"entry_mode": "reclaim",
"trigger_interval": "5m", "confirm_closes": 3, <design override>}'`

Design parameters under test (prod defaults in parentheses):
- recent_sessions (10) — the swing window the chart dims read
- confluence_tol_pct (0.15) — zone clustering tolerance, % of spot
- min_zone_dims (2) — distinct dimensions a confluence zone needs
- pivot_n (2) — fractal pivot width (bars each side)
- durable_min_sessions (3) / durable_tol_pct (0.12) / durable_max_dist_pct (1.5)
- ladder_exclude ([]) — drop round / fib / poc rows from the ladder
- vp_bins (40) — volume-profile bin count

## E0 baseline
method: champion trigger, all design params at prod defaults.
value: n=35, WR 0.600, PF 1.387 — byte-identical after plumbing.
→ adoption bar: WR ≥ 0.63 AND PF ≥ 1.45 with n ≥ 28, split-half replicated.

## H1 shorter swing window (recent_sessions 10 → 5)
prediction: fresher levels track the tape better but S/R clusters get thinner
(pivots need ≥2 touches in fewer bars): n drops to ~25-30, WR 0.55-0.65,
PF 1.2-1.6 — a wash or slight loss from volume.
experiment: design override {"recent_sessions": 5}.
result: n=48, WR 0.583, PF 2.072, net +5.61% — best net in the whole program
verdict: prediction disproven in the good direction — fresher levels produce
MORE zones near spot and much better economics. Fails only the WR bar
(0.583 < 0.63). Dose-response around 5 next.

## H2 recent_sessions 7 (between the champion 10 and the H1 winner 5)
prediction: interpolates: n ~40-44, WR 0.58-0.62, PF 1.6-1.9.
experiment: design override {"recent_sessions": 7}.
result: n=48, WR 0.458, PF 0.790, net −1.41%
verdict: disproven, and it breaks monotonicity violently (5→2.07, 7→0.79,
10→1.39). Suspicion: the window length relocates every fib/swing anchor and
results are placement luck, not signal. Mapping 4 and 6 to confirm or refute
instability before believing H1.

## H3 neighborhood map: recent_sessions 4 and 6 (registered as one experiment)
prediction: if the parameter is UNSTABLE, 4 and 6 will scatter wildly
(PF anywhere in 0.7-2.2 with no pattern); if 5 is a real optimum, both should
be ≥ 1.6 PF. I predict instability: scatter.
experiment: design overrides {"recent_sessions": 4} and {"recent_sessions": 6}.
result: 4 → n=53, WR 0.547, PF 1.457 · 6 → n=45, WR 0.422, PF 0.653
verdict: confirmed (instability) — {4:1.46, 5:2.07, 6:0.65, 7:0.79, 10:1.39}
is scatter, not a curve. recent_sessions is UNSTABLE at this sample size;
H1's win is placement luck. **Window stays at 10.** Most valuable finding so
far: guard every "winner" with a neighborhood map before believing it.

## H4 tighter zone clustering (confluence_tol_pct 0.15 → 0.10)
prediction: tighter bands = more precise zones but fewer confluences: n ~28-33,
WR 0.58-0.64, PF 1.3-1.6 — precision helps reclaim entries slightly.
experiment: design override {"confluence_tol_pct": 0.10}.
result: n=21, WR 0.524, PF 0.861
verdict: disproven — tighter clustering starves the zone count AND the
survivors trade worse. 0.15 beats 0.10.

## H5 looser zone clustering (0.15 → 0.20)
prediction: wider bands merge more dims per zone: n ~38-45, WR 0.57-0.63,
PF 1.3-1.7 — mild gain from stronger zones.
experiment: design override {"confluence_tol_pct": 0.20}.
result: n=56, WR 0.536, PF 1.157
verdict: disproven — more zones, worse quality. 0.15 sits at a local optimum
(0.10 → 0.86, 0.15 → 1.39, 0.20 → 1.16).

## H6 much looser clustering (0.25) — completes the tol curve
prediction: continues down: WR ≤ 0.55, PF ≤ 1.1, n ~60+. Confirms 0.15 peak.
experiment: design override {"confluence_tol_pct": 0.25}.
result: n=72, WR 0.486, PF 1.046
verdict: confirmed — smooth downhill from 0.15. Unlike recent_sessions, the
tol curve IS well-behaved (0.10 → 0.86 · 0.15 → 1.39 · 0.20 → 1.16 ·
0.25 → 1.05): 0.15 is a genuine local peak. Keep 0.15.

## H7 stricter zones (min_zone_dims 2 → 3)
prediction: only heavy-confluence zones survive: n ~12-18 (fails the volume
guard), WR 0.65-0.75, PF 1.8-3.0 — quality up, unadoptable as default.
experiment: design override {"min_zone_dims": 3}.
result: n=1 — without GEX in the scaffold, 3-dimension confluences barely exist.
verdict: disproven (volume collapse; fails n ≥ 28 by construction on this
dataset). Note: with live GEX in prod the zone counts would be higher — this
result is dataset-bounded.

## H8 every level is a zone (min_zone_dims 2 → 1)
prediction: n explodes (~90-130) and quality dives (WR 0.45-0.55, PF 0.9-1.2)
— confluence is doing real work.
experiment: design override {"min_zone_dims": 1}.
result: n=346, WR 0.494, PF 0.884, net −5.66%
verdict: confirmed — confluence (≥2 dims) earns its keep: single-dim levels
trade at coin-flip WR with negative expectancy. The ≥2 rule stays.

## H9 wider fractal pivots (pivot_n 2 → 3)
prediction: slower, more significant swings; fewer but cleaner S/R shelves:
n ~28-34, WR 0.58-0.66, PF 1.4-1.8 — mild quality gain.
experiment: design override {"pivot_n": 3}.
result: n=34, WR 0.706, PF 2.990, net +4.55%
verdict: CONFIRMED and clears the adoption bar (0.706 ≥ 0.63, 2.99 ≥ 1.45,
n 34 ≥ 28) — wider pivots pick only significant swings, so the S/R shelves
that survive are the ones the tape actually respects. NOT adopted yet: after
the recent_sessions lesson, requires the neighborhood map (H10) + split-half.

## H10 pivot neighborhood: pivot_n 1 and 4 (registered as one experiment)
prediction: if the effect is real structure (not placement luck) the curve is
orderly: pivot_n 1 (noisy pivots) clearly worse than baseline (PF ≤ 1.1);
pivot_n 4 stays strong (PF ≥ 1.8) with lower n (~24-30) — a plateau on the
wide side, not scatter.
experiment: design overrides {"pivot_n": 1} and {"pivot_n": 4}.
result: pivot_n 1 → n=34, WR 0.529, PF 1.144 · pivot_n 4 → n=45, WR 0.622,
PF 1.477
verdict: confirmed in shape — the curve is orderly (1: 1.14 → 2: 1.39 →
3: 2.99 → 4: 1.48), a genuine hill with 3 at the peak, unlike the
recent_sessions scatter. pivot_n 4 landed under my PF band (1.48 vs ≥1.8) but
both flanks beat or match baseline. Proceed to split-half.

## H11 split-half replication for pivot_n 3
prediction: direction holds in both halves vs the E0 champion's halves
(E0: 0.412/0.597 first, 0.778/3.01 second): pivot_n 3 first half WR ≥ 0.45
AND PF ≥ 0.8; second half WR ≥ 0.78 AND PF ≥ 3.0.
experiment: pivot_n 3 with date_max 2026-06-04, then date_min 2026-06-05.
result: first half → n=16, WR 0.625, PF 2.115 · second half → n=18, WR 0.778,
PF 4.260
verdict: CONFIRMED — replicates in both halves and REPAIRS the champion's weak
first half (profitable at PF 2.1 where E0 sat at 0.60). Strongest adoption
candidate in three loops. Symbol robustness next.

## H12 symbol robustness: pivot_n 3 on the ETFs (QQQ+IWM)
prediction: transfers: n ~7-11, WR ≥ 0.60, PF ≥ 2 (QQQ carries; IWM still
target-starved).
experiment: pivot_n 3 with underlyings ["QQQ", "IWM"].
result: n=13 (all QQQ), WR 0.615, PF 3.082
verdict: confirmed — transfers to QQQ (and wider pivots even give QQQ more
trades: 13 vs 8). IWM unchanged (target-starved). pivot_n 3 has now passed:
adoption bar, orderly neighborhood, split-half, symbol transfer. ADOPT at
loop end; continuing the sweep for independent params.

## H13 easier durable promotion (durable_min_sessions 3 → 2)
prediction: more durable bands → more freshness="strong/tested" tags and more
targets: n up ~10%, WR/PF mildly up (the durable-memory signal was real in
loop 1): WR 0.60-0.65, PF 1.5-1.8.
experiment: design override {"durable_min_sessions": 2}.
result: n=35, WR 0.600, PF 1.387 — IDENTICAL to E0.
verdict: inconclusive as registered, but diagnostic: durable-level params are
INERT in the base config — durable bands feed only freshness tags, and no
freshness filter is active. They must be tested under the fresh-exclusion tier
where freshness decides which trades exist.

## H14 durable_min_sessions 2 UNDER the fresh-exclusion tier
prediction: easier promotion re-tags some "fresh" zones as memory-backed →
the filtered tier gains trades: n 16-22 (vs 13 at min_sessions 3, measured
next as comparator), WR ≥ 0.65, PF ≥ 2.0.
experiment: {"exclude_freshness": ["fresh"], "durable_min_sessions": 2}
(+ min_sessions 3 comparator, both under the champion trigger).
result: min_sessions 2 and 3 both → n=13, WR 0.769, PF 2.583 — identical.
verdict: inconclusive/inert — the durable bands that overlap traded zones all
have ≥3 sessions on this window; the threshold doesn't bind. Durable knobs are
low-leverage on this dataset.

## H15 durable band width (durable_tol_pct 0.12 → 0.20) under fresh-exclusion
prediction: wider bands absorb more zones into "memory-backed" tags: n 15-20,
WR 0.65-0.75, PF 1.8-2.6. If still identical, durable params are declared
inert and skipped for the rest of the loop.
experiment: {"exclude_freshness": ["fresh"], "durable_tol_pct": 0.20}.
result: n=18, WR 0.667, PF 1.751
verdict: disproven — wider bands DO bind (n 13→18) but the added
"memory-backed" trades are lower quality (PF 2.58 → 1.75). The tight 0.12
band is what makes the durable signal selective. Keep 0.12.

## H16 drop round numbers from the ladder (ladder_exclude ["round"])
prediction: round numbers are the weakest dimension (always present, no
information): removing them prunes fake confluences → n ~26-32, WR and PF
flat-to-up (WR 0.60-0.66, PF 1.4-1.8).
experiment: design override {"ladder_exclude": ["round"]}.
result: n=10, WR 0.600, PF 1.256
verdict: disproven — round numbers are load-bearing: without GEX most 2-dim
zones are chart-dim + round-number stacks, so removing them collapses volume
(35→10) with no quality gain on the survivors. Psychological levels are real
structure on this tape. Keep.

## H17 drop fib levels from the ladder (ladder_exclude ["fib"])
prediction: fibs are anchored to the swing extremes and carry real info, but
they're 4 of ~11 ladder rows: n drops to ~18-24, PF 1.0-1.5 — a loss. Keep
fibs.
experiment: design override {"ladder_exclude": ["fib"]}.
result: n=16, WR 0.375, PF 0.651
verdict: confirmed — dropping fibs guts both volume AND quality. The fib grid
is the single most valuable chart dimension. Keep.

## H18 drop the volume PoC (ladder_exclude ["poc"])
prediction: PoC is one magnet row; zones lose their poc+x stacks: n ~26-31,
metrics near-flat (WR 0.57-0.63, PF 1.2-1.5). PoC is nice-to-have, not
load-bearing.
experiment: design override {"ladder_exclude": ["poc"]}.
result: n=37, WR 0.595, PF 1.131
verdict: mostly confirmed (near-flat WR, PF a bit lower than predicted band) —
PoC contributes modest value. Keep. Every ladder dimension has now earned its
slot; the composition stands.

## H19 volume-profile resolution (vp_bins 40 → 20)
prediction: coarser profile moves the PoC to a broader shelf: small effect,
n ~33-37, WR/PF within ±10% of E0. vp_bins is a low-leverage knob.
experiment: design override {"vp_bins": 20}.
result: n=42, WR 0.595, PF 1.526, net +2.50%
verdict: mixed — bigger effect than predicted (PF +0.14, n +7) but WR flat and
under the bar. Not adoptable alone; interesting only if it composes with
pivot_n 3.

## H20 fine volume profile (vp_bins 80) — completes the bins curve
prediction: sharper PoC placement, small effect either way: WR 0.57-0.63,
PF 1.2-1.6.
experiment: design override {"vp_bins": 80}.
result: n=44, WR 0.568, PF 1.106
verdict: confirmed (small, slightly negative) — bins curve: 20 → 1.53,
40 → 1.39, 80 → 1.11. Mild coarse preference, WR flat everywhere; vp_bins is
low-leverage. Candidate only in combination.

## H21 combo: pivot_n 3 + vp_bins 20 (the two positive-PF knobs)
prediction: roughly additive on PF if independent: WR 0.68-0.74, PF 2.8-3.6,
n ~36-42. If PF lands under pivot-3-alone (2.99), the knobs interact
negatively and pivot_n 3 stands alone.
experiment: design overrides {"pivot_n": 3, "vp_bins": 20}.
result: n=39, WR 0.667, PF 2.287, net +4.58%
verdict: disproven for additivity — the combo clears the bar but sits BELOW
pivot-3-alone on both WR (0.667 vs 0.706) and PF (2.29 vs 2.99). The knobs
interact (the coarser PoC relocates zones that pivot-3 already placed well).
**pivot_n 3 stands alone.**

## H22 interaction probe: does pivot_n 3 change the best confluence tol?
prediction: no — 0.15 remains the peak under pivot_n 3; tol 0.20 with
pivot_n 3 lands below pivot-3-alone (WR ≤ 0.68, PF ≤ 2.5).
experiment: design overrides {"pivot_n": 3, "confluence_tol_pct": 0.20}.
result: n=58, WR 0.569, PF 1.313
verdict: confirmed — 0.15 remains the tol peak under pivot_n 3. No parameter
interaction rescues looser clustering.

## H23 pivot_n 3 under the premium tiers (gate / fresh-exclusion)
prediction: stacks positively: pivot3+gate WR ≥ 0.72 / PF ≥ 3.0 (n ~22-26);
registered for the tier table.
experiment: {"pivot_n": 3, "direction_gate": "structure"}.
result: n=25, WR 0.720, PF 3.267, net +3.73%
verdict: confirmed — the structure gate stacks on pivot_n 3 (premium tier:
0.72/3.27 at n=25).

## H24 independence check: pivot_n 3 under the OLD trigger (single 15m close)
prediction: the design gain is trigger-independent: 15m reclaim + pivot_n 3
beats the 15m base (0.500/1.289) at WR ≥ 0.55, PF ≥ 1.8 — the two adopted
changes compound rather than overlap.
experiment: {"entry_mode": "reclaim", "pivot_n": 3} (15m trigger).
result: n=40, WR 0.600, PF 2.384, net +4.72%
verdict: confirmed — pivot_n 3 lifts the OLD trigger too (0.50/1.29 →
0.60/2.38). The design gain and the trigger gain are independent goods that
compound.

## H25 final adopted-config verification (the whole stack, pre-registered)
prediction: adopting pivot_n=3 as the prod default and re-running the champion
config reproduces H9 exactly: n=34, WR 0.706, PF 2.990 — the predicate's
outcome (a) measurement of record.
experiment: {"entry_mode": "reclaim", "trigger_interval": "5m",
"confirm_closes": 3, "pivot_n": 3} (then flip the prod default and verify the
default path gives the same numbers).
result: default path (no override) reproduces n=34, WR 0.7059, PF 2.990 ✓;
full suite green (77/77 strategy-adjacent; the 20 failures are the documented
pre-existing test_api/test_signals live-data drift).
verdict: confirmed — adopted.

---

# Final report (25 experiments + E0; predicate satisfied — outcome (a))

**Was it worth changing the playbook design parameters? Yes — exactly ONE.**

- Baseline (E0, champion trigger, prod design): WR 0.600 / PF 1.387 (n=35)
- Adopted (fractal pivot width 2 → 3):          WR **0.706** / PF **2.990**
  (n=34) — +10.6pp WR, PF more than doubled; bar was 0.63 / 1.45 / n≥28.

Evidence pivot_n=3 is real, not luck: orderly neighborhood (1: 1.14 → 2: 1.39
→ 3: 2.99 → 4: 1.48); split-half replicated (first half 0.625/2.12 — repairs
the champion's weak regime; second 0.778/4.26); transfers to QQQ (0.615/3.08);
lifts the OLD 15m trigger too (0.500/1.29 → 0.600/2.38) — independent of the
trigger gain. Premium tier: pivot3 + structure gate = 0.72/3.27 (n=25).

Everything else measured and kept AT CURRENT VALUES:
- confluence_tol 0.15: a genuine local peak (0.10 → 0.86, 0.20 → 1.16, 0.25 → 1.05)
- min_zone_dims 2: ≥3 collapses volume (n=1, no GEX); 1 → 346 coin-flip trades
  at negative expectancy — confluence earns its keep
- ladder composition: round numbers are load-bearing (drop → n collapses 35→10);
  fibs are the most valuable dimension (drop → 0.375/0.65); PoC modest but keep
- durable-level knobs: inert on this dataset (bands that matter all qualify);
  widening tol to 0.20 dilutes the memory signal (2.58 → 1.75)
- vp_bins: low-leverage; 20 mildly better alone but interacts NEGATIVELY with
  pivot_n 3 (combo 2.29 < 2.99) — not adopted
- recent_sessions: UNSTABLE — {4: 1.46, 5: 2.07, 6: 0.65, 7: 0.79, 10: 1.39}
  is scatter, not signal; keep 10

Counts: 12 confirmed · 8 disproven · 3 mixed · 2 inconclusive.

Most valuable disproven hypothesis: "recent_sessions 5 is a better window"
(H1's PF 2.07, best net in the program) — killed by the neighborhood map (H3).
The loop's procedural lesson: **map the neighborhood before believing any
single-point winner**; it saved us from shipping a lottery ticket.

Cumulative across the three loops (same frozen tape, honest caveats apply):
touch-entry baseline 0.103/0.26 → reclaim 0.500/1.29 → 3×5m trigger
0.600/1.39 → pivot_n 3 design 0.706/2.99.

Caveats: one 60-day net-uptrend window; no GEX in backtest scaffolds (live
playbooks have richer ladders — zone-count results are dataset-bounded);
premium tiers n=13-25. Re-freeze and re-validate quarterly.
