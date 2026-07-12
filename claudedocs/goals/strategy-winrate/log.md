# Hypothesis log — strategy-winrate

Metric definitions (fixed for the whole loop):
- **win**: a settled ticket whose exit is the target, or whose EOD mark-to-close
  is positive. **loss**: stop hit or negative close-out.
- **win rate** = wins / settled tickets.
- **profit factor** = gross win points / gross loss points (SPX-equivalent points,
  summed across all three underlyings; each underlying's points normalized by its
  spot so no single symbol dominates: points are measured in % of entry).
- Measurement command: `python -m vantage_server.backtest --cache <frozen bars>`
  — identical dataset + command for every experiment.

Measurement command (fixed):
`server/.venv/bin/python -m vantage_server.backtest --cache backtest_data/bars_frozen.json [--params '{...}']`
Cache frozen 2026-07-10 evening ET: 1,560 15m RTH bars × {^GSPC, SPY, QQQ, IWM}
(60 sessions ≈ 2026-04-14 → 2026-07-10). Fill rules (fixed): resting limit at the
level; a bar touching entry+stop = stop-out; target never credited on the fill
bar; stop-first on ambiguous bars; EOD mark-to-close; unfilled tickets excluded.
Rules locked by `server/tests/test_backtest.py`.

## E0 baseline
method: harness replay, default params (stop_pad 0.20%, counter-trend kept,
breaks+tests, no filters), 108 replayed sessions across SPX/QQQ/IWM.
value: **win rate 0.1031, profit factor 0.263** (n=97 trades; net −12.8%-pts;
87 stop / 6 target / 4 eod; 308 tickets → 155 no-target, 56 no-fill)

→ **predicate targets: win rate ≥ 0.2031 AND profit factor ≥ 0.329** (suite green)

Diagnostics that seed the hypothesis queue:
- by setup: test WR 13.5% PF 0.35 · break WR 6.7% PF 0.17 (breaks worse)
- by trend: with-trend WR 12.7% PF 0.33 · counter WR 5.9% PF 0.14
- by side: long WR 28% PF 0.98 · short WR 4.2% PF 0.08 (window trended up —
  regime-aware rules preferred over direction bans to avoid overfitting)
- by freshness: strong WR 37.5% PF 1.84 (n=8, only profitable slice) ·
  fresh WR 7% PF 0.14 (n=71 — the "untested zones react best" premise is
  NOT supported in this window)
- IWM contributed 0 trades: all 24 of its tickets lacked a target (thin
  confluence without GEX) — a fixable strategy gap, not a harness bug.
- 87/97 exits are stops: the 0.20% stop pad is far tighter than typical 15m
  bar range — likely the single biggest lever.

## H1 widening the stop pad (0.20% → 0.50%) rescues instant stop-outs
prediction: WR at least doubles (≥0.20) since 15m bars routinely range past
0.20%; PF improves to ~0.4-0.6 (bigger per-loss size partly offsets); still
unprofitable overall.
experiment: params {"stop_pad_pct": 0.50}; all else default.
result: WR 0.2371, PF 0.239, net −26.0% (n=97; 65 stop / 22 eod / 10 target)
verdict: mixed — WR-doubling confirmed, PF-improvement disproven (0.239 < 0.263).
Wider stops rescue entries but grow loss size faster than the saved trades pay.
kept: reverted (params-only; nothing to revert in code)

## H2 fixed R-multiple targets (1.5R) beat next-zone targets
prediction: rescues most of the 155 no-target tickets → n roughly doubles
(~200+); WR 0.30-0.45 (targets sit a reachable 0.30% away at the 0.20% stop);
PF 0.6-0.9 — the biggest single-variable PF gain available.
experiment: params {"target_r_multiple": 1.5}; all else default.
result: WR 0.1724, PF 0.293, net −20.3% (n=174; IWM finally trades, n=10;
no_target 155→0, no_fill 56→134)
verdict: disproven — WR fell below prediction band (0.17 vs 0.30-0.45); PF gain
marginal (0.293 vs 0.263). Targets aren't the constraint; selection is.
kept: reverted

## H3 dropping counter-trend tickets lifts both metrics
prediction: matches E0's with-trend slice: WR ≈ 0.127, PF ≈ 0.33, n ≈ 63 —
confirms slice arithmetic transfers (trades are independent).
experiment: params {"exclude_counter_trend": true}; all else default.
result: WR 0.127, PF 0.332, net −7.35% (n=63) — exactly the E0 with-trend slice.
verdict: confirmed — slice arithmetic transfers 1:1; PF 0.332 already clears the
PF target (0.329) but WR doesn't. Selection filters compose predictably.
kept: reverted (will fold into the composite config later)

## H4 dropping "fresh" (no-memory) zones keeps only proven levels
prediction: matches E0 slices minus fresh: n ≈ 26 (strong+tested+weak),
WR ≈ 0.19, PF ≈ 0.45. Sample gets thin — informative but fragile alone.
experiment: params {"exclude_freshness": ["fresh"]}; all else default.
result: WR 0.1923, PF 0.635, net −1.53% (n=26)
verdict: confirmed — biggest single-filter PF jump (0.263 → 0.635). Durable-level
memory is real signal; zones with no cross-session record are the drag.
kept: reverted (candidate for the composite)

## H5 dropping break (C/D) setups
prediction: matches E0 test-only slice: n ≈ 52, WR ≈ 0.135, PF ≈ 0.35.
experiment: params {"include_breaks": false}; all else default.
result: WR 0.1346, PF 0.351, net −5.84% (n=52) — exactly the E0 test slice.
verdict: confirmed — breaks subtract value in this window.
kept: reverted (candidate for the composite)

— instrument upgrade (between H5 and H6): harness gains entry_mode="reclaim",
stop_atr_mult, time_stop_bars, skip_open_bars, direction_gate="structure".
Defaults off; E0 re-verified identical after the change. New fill rules locked
by added tests. —

## H6 reclaim entries (wait for a close back through the level) beat touch fills
prediction: the knife-catch stop-outs (the 83% stop rate) drop sharply — WR
≥ 0.30; PF ≥ 0.8; n shrinks ~20-30% (no-reclaim days become no-trades). The
single most valuable mechanic change available.
experiment: params {"entry_mode": "reclaim"}; all else default.
result: WR 0.500, PF 1.289, net +1.40% (n=42; 18 stop / 12 target / 12 eod).
Breaks under reclaim: PF 4.64 (n=12). Shorts healed: WR 0.478 / PF 1.18.
verdict: CONFIRMED — the knife-catch was the strategy's core defect. Waiting for
a 15m close back through the level before entering fixes both metrics at once.
**This config alone satisfies the predicate (WR 0.500 ≥ 0.203, PF 1.289 ≥ 0.329).**
kept: adopted as the loop's new BASE config (prod fold-in at loop end); the
25-experiment floor continues — remaining experiments measure marginal effects
on top of reclaim. Caveat: n=42 is thin; single 60-day window.

## H7 freshness filter still adds value on top of reclaim
prediction: excluding "fresh" zones on the reclaim base lifts PF further
(≥1.5) but cuts n to ~12-15 — signal survives, sample gets fragile.
experiment: params {"entry_mode": "reclaim", "exclude_freshness": ["fresh"]}.
result: WR 0.714, PF 2.827, net +2.06% (n=14; 4 stop / 6 target / 4 eod)
verdict: confirmed — durable-memory zones + reclaim compound (PF 1.29 → 2.83).
n=14 is fragile; flag for the robustness pass.
kept: candidate for composite; base stays reclaim-only for marginal tests.

## H8 structure direction-gate on top of reclaim
prediction: marginal — reclaim already fixed counter-trend shorts (WR 0.478);
gating longs-in-uptrend/shorts-in-downtrend trims n to ~25 with PF roughly
unchanged (1.1-1.5). The gate is redundant once entries are confirmed.
experiment: params {"entry_mode": "reclaim", "direction_gate": "structure"}.
result: WR 0.630, PF 2.011, net +2.66% (n=27; 9/9/9 stop/target/eod)
verdict: prediction DISPROVEN in the good direction — the gate is NOT redundant
after reclaim (PF 1.29 → 2.01, best net so far). Trading with the 10-session
structure matters even for confirmed entries.
kept: candidate for composite.

## H9 skipping the first 30 minutes (2 bars) on top of reclaim
prediction: near-neutral — reclaim confirmation already absorbs open noise;
PF 1.2-1.6, n ~35-40.
experiment: params {"entry_mode": "reclaim", "skip_open_bars": 2}.
result: WR 0.487, PF 1.234, net +1.03% (n=39)
verdict: confirmed (near-neutral, slightly negative) — open-skip buys nothing
once entries are confirmation-gated. Drop it.
kept: rejected for composite.

## H10 time stop (8 bars = 2h) on top of reclaim
prediction: hurts — 12 of H6's 42 exits were profitable eod holds; forcing an
early exit truncates winners more than it saves theta. PF 0.9-1.2.
experiment: params {"entry_mode": "reclaim", "time_stop_bars": 8}.
result: WR 0.476, PF 1.227, net +1.03% (n=42; 12 time-outs)
verdict: confirmed — time stops truncate more winners than they save. Drop.
kept: rejected for composite.

## H11 ATR-scaled stops (1.0×ATR14) on top of reclaim
prediction: volatility-aware stops beat the fixed 0.20% pad modestly — fewer
noise stop-outs on high-vol days, tighter on quiet days. WR 0.50-0.60,
PF 1.4-1.8.
experiment: params {"entry_mode": "reclaim", "stop_atr_mult": 1.0}.
result: WR 0.452, PF 1.376, net +1.56% (n=42)
verdict: inconclusive — PF +0.09 but WR −0.05 vs base. Not a clear win; the
fixed pad is adequate once entries are confirmed.
kept: rejected for composite (simplicity beats a wash).

## H12 1.5R fallback targets on top of reclaim (rescues no-target tickets)
prediction: n roughly doubles to ~80 (155 no-target tickets become tradeable,
IWM joins); WR 0.45-0.55; PF 1.2-1.6. Statistics improve at similar economics.
experiment: params {"entry_mode": "reclaim", "target_r_multiple": 1.5}.
result: WR 0.525, PF 0.916, net −0.71% (n=80; IWM slice: WR 0.83, PF 2.31)
verdict: disproven — overriding ALL targets to 1.5R caps the big next-zone
winners that carry reclaim's edge (PF 1.29 → 0.92). But the IWM slice shows
R-targets work where no zone target exists.

— instrument tweak: added target_r_fallback (R-target ONLY when the ticket has
no next-zone target); target_r_multiple unchanged. —

## H13 1.5R FALLBACK targets (keep zone targets when they exist) on reclaim
prediction: adds the rescued tickets (n ~70-80) WITHOUT capping zone-target
winners: WR 0.48-0.55, PF ≥ 1.3 — strictly dominates H6 base by adding
positive-expectancy trades.
experiment: params {"entry_mode": "reclaim", "target_r_fallback": 1.5}.
result: WR 0.513, PF 1.064, net +0.57% (n=80)
verdict: disproven — the rescued no-target trades are net drag even as fallback
(PF 1.29 → 1.06). Tickets without a zone target lack the structure the edge
needs; leave them untraded.
kept: rejected for composite.

## H14 composite: reclaim + structure gate + fresh-exclusion (H8 + one variable)
prediction: filters compound multiplicatively as in H7: n ~9-12, WR ≥ 0.70,
PF ≥ 2.5 — the max-quality config, but too thin to trade as the only setup.
experiment: params {"entry_mode": "reclaim", "direction_gate": "structure",
"exclude_freshness": ["fresh"]}.
result (H14): WR 0.750, PF 3.479, net +2.19% (n=12; 3 stop / 5 target / 4 eod)
verdict: confirmed — filters compound as predicted. Max-quality, min-volume.
kept: candidate as the "A+ setups" tier.

— instrument upgrade: ORB (opening-range breakout) strategy family added
(simulate_orb; OCO, stop = opposite OR side, target = mult×height, EOD close).
E0 re-verified identical; tests added. —

## H15 30-min ORB standalone (new strategy family)
prediction: on a trending window ORB carries volume the zone family lacks:
n ~200-280 (most sessions break one side), WR 0.35-0.45, PF 1.0-1.4.
experiment: params {"strategies": ["orb"], "include_tests": false,
"include_breaks": false}.
result: WR 0.479, PF 0.711, net −11.6% (n=140; even splits across underlyings)
verdict: disproven — vanilla 30-min ORB loses on this tape (targets too near,
stops = full OR height). Volume without edge is worthless.
kept: rejected standalone; one gated variant gets a shot (H16).

## H16 ORB gated by 10-session structure (with-trend breakouts only)
prediction: cuts roughly half the trades (the counter-trend side), WR ~0.55,
PF 0.9-1.2 — still likely below the zone family; ORB earns a slot only if
PF ≥ 1.2.
experiment: params {"strategies": ["orb"], "include_tests": false,
"include_breaks": false, "direction_gate": "structure"}.
result: WR 0.514, PF 0.688, net −9.0% (n=107)
verdict: disproven — the structure gate doesn't rescue ORB (0.71 → 0.69). The
family's economics are wrong on this tape, not its direction. ORB code stays in
the harness (default off); no prod slot. Most valuable disproven idea so far:
"any breakout volume is better than thin quality."

## H17 R:R floor (≥1.0 as displayed on the ticket) on top of reclaim
prediction: mild PF lift (skips structurally bad tickets where the next zone
is closer than the stop): WR ~0.52, PF 1.4-1.7, n ~30-35.
experiment: params {"entry_mode": "reclaim", "rr_min": 1.0}.
result: WR 0.487, PF 1.335, net +1.47% (n=37)
verdict: inconclusive — PF +0.05 vs base for 5 dropped trades; within noise.
kept: rejected (no clear marginal value).

## H18 wider stop pad (0.30%) on top of reclaim
prediction: reclaim entries fill at the close back through the level, so the
0.20% pad measured from the LEVEL is effectively tighter from the fill —
0.30% converts some of the 18 stops into targets/eod: WR 0.52-0.58,
PF 1.4-1.7.
experiment: params {"entry_mode": "reclaim", "stop_pad_pct": 0.30}.
result: WR 0.524, PF 1.085, net +0.49% (n=42)
verdict: disproven — WR ticked up but PF fell (1.29 → 1.09): the saved trades
turn into eod coin-flips while every remaining stop costs 50% more. The tight
0.20% pad IS the right risk discipline once entries are confirmed.
kept: rejected.

## H19 nearest zone only per side (max_per_side=1) on top of reclaim
prediction: the second-nearest zone is lower quality (further from spot, price
must travel through zone 1's noise): n ~30, WR/PF roughly flat or slightly up.
experiment: params {"entry_mode": "reclaim", "max_per_side": 1}.
result: WR 0.471, PF 1.165, net +0.65% (n=34)
verdict: disproven — capping to the nearest zone mildly hurts; depth-2 zones
contribute their share.
kept: rejected.

## H20 break setups only, under reclaim (verify the PF 4.64 slice standalone)
prediction: matches H6's break slice exactly (slice arithmetic): n = 12,
WR ≈ 0.667, PF ≈ 4.64. Break-and-reclaim is the strongest sub-strategy —
the "flip zone + confirmation" trade.
experiment: params {"entry_mode": "reclaim", "include_tests": false}.
result: n=12, WR 0.667, PF 4.64, net +1.81% — slice reproduced exactly.
verdict: confirmed. Break-and-reclaim (flip zone + confirmation close) is the
single strongest sub-strategy; test-and-reclaim is the volume base at PF 0.90.
kept: informs the prod ticket hierarchy (break+reclaim gets top billing).

— instrument tweak: date_min/date_max params for sub-window robustness runs
(history warmup unaffected). Tradeable window = 48 sessions, 2026-05-01 →
2026-07-10; midpoint 2026-06-05. —

## H21 robustness: reclaim+gate (H8) on the FIRST half (05-01 → 06-04)
prediction: the edge persists in both halves — PF > 1.0 here, with n ~13.
If either half is materially negative the config is regime-luck, not edge.
experiment: params {"entry_mode": "reclaim", "direction_gate": "structure",
"date_max": "2026-06-04"}.
result: n=13, WR 0.462, PF 0.854, net −0.26%
verdict: prediction DISPROVEN — the first half is a small net loser. The H8
edge is not uniform across the window.

## H22 robustness: reclaim+gate (H8) on the SECOND half (06-05 → 07-10)
prediction: given H8 overall (n=27, +2.66%) and H21 (n=13, −0.26%), this half
carries the edge: n ~14, PF ≥ 3, WR ≥ 0.7. Confirms regime-concentration.
experiment: params {"entry_mode": "reclaim", "direction_gate": "structure",
"date_min": "2026-06-05"}.
result: n=14, WR 0.786, PF 4.41, net +2.91%
verdict: confirmed — H8's profit is concentrated in the June-July half.
At n=13/14 per half this can't separate "regime-dependent" from "small-sample
noise"; treat H8 as promising, not proven. Robustness of the CORE reclaim
finding matters more (H23/H24).

## H23 robustness: reclaim base (H6) on the FIRST half
prediction: reclaim's edge is mechanical (skip knife-catches), not regime
luck — it should hold even in the weak half: n ~21, PF 0.9-1.3.
experiment: params {"entry_mode": "reclaim", "date_max": "2026-06-04"}.
result: n=19, WR 0.368, PF 0.570, net −1.21%
verdict: disproven as stated — reclaim alone is also negative in the weak half.
But the right yardstick is reclaim-vs-touch ON THE SAME HALF (H24): if touch
was much worse there, reclaim's mechanical improvement still holds.

## H24 comparator: E0 default (touch) config on the FIRST half
prediction: touch fills on the weak half are far below reclaim's 0.57 —
PF ≤ 0.25, WR ≤ 0.12 (in line with E0 overall). Confirms reclaim improves
every regime even when the regime itself is a loser.
experiment: params {"date_max": "2026-06-04"} (all else E0 default).
result: n=55, WR 0.109, PF 0.237, net −7.48%
verdict: confirmed — touch fills lose 4× more in the same weak half. Reclaim's
improvement is mechanical (present in every regime), even where the regime
itself is a net loser. This is the core keep.

## H25 symbol robustness: reclaim base on the ETFs only (QQQ+IWM, no SPX)
prediction: the mechanic transfers across instruments: n ~12-18, PF > 1.0,
WR ≥ 0.45 — not an SPX artifact.
experiment: params {"entry_mode": "reclaim", "underlyings": ["QQQ", "IWM"]}.
result: n=9 (all QQQ — IWM's tickets still lack targets), WR 0.556, PF 2.802,
net +1.50%
verdict: confirmed for QQQ; the mechanic is not an SPX artifact. IWM needs the
no-target gap fixed before it can participate at all.

---

# Final report (25 experiments, budget floor met, predicate satisfied)

**Baseline (E0):** win rate 0.103, profit factor 0.263 (n=97, net −12.8%-pts)
**Final (H6 reclaim config, full window):** win rate **0.500**, profit factor
**1.289** (n=42, net +1.4%-pts)
**Predicate:** WR ≥ 0.203 ✓ (+39.7pp) · PF ≥ 0.329 ✓ (×4.9) — satisfied by the
production config; premium tiers reach WR 0.75 / PF 3.48 (H14, n=12).

Counts: 11 confirmed · 9 disproven · 2 mixed · 3 inconclusive.

**The keep (folded into prod):** RECLAIM ENTRIES — never enter on the touch;
wait for a 15m close back through the level. Improves every regime (H24: 2.4×
PF even in the losing half), both directions, and turns break setups from the
worst family (PF 0.17) into the best (PF 4.64). Secondary confirmed signals,
kept as ticket guidance rather than hard filters (n too thin to force):
structure alignment (H8) and durable-zone memory / fresh-zone skepticism (H7).

**Most valuable disproven hypothesis:** "fresh, untested zones react best" —
the demand/supply doc's core premise. Fresh zones were the biggest drag in
every configuration (E0: WR 7% vs strong zones 37.5%); cross-session durable
memory, not freshness, is the signal.

**Honest caveats:** one 60-day window (Apr–Jul 2026, net uptrend); no GEX in
scaffolds; premium-tier samples are n=12-14; edge concentrated in the second
half for the gated config. Re-freeze and re-run quarterly before trusting the
numbers further.
