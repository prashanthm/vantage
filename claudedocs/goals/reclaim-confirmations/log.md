# Hypothesis log — reclaim-confirmations

Validating the NEW gates added to the shareable reclaim Pine (volume
confirmation + confluence strength) on the frozen multi-interval cache before
they ship as defaults. Champion baseline = the reclaim-interval goal's adopted
config: `{entry_mode: reclaim, trigger_interval: 5m, confirm_closes: 3}`
(WR 0.600 / PF 1.387). Harness upgrade this run: `volume_confirm_mult` /
`volume_len` params (confirming bar volume >= mult x prior-20-bar mean).

Rule (user-set): every strategy change must be backtested before it ships.

## E0 champion re-measure (sanity)
method: multi-cache, params {entry_mode: reclaim, trigger_interval: 5m, confirm_closes: 3}
prediction: reproduces WR 0.600 / PF 1.387 (same frozen cache, same code path).

## H1 volume confirmation at 1.0x (reclaim on at-least-average participation)
prediction: small WR gain (+2-5pp), n drops ~10-20%; PF flat-to-up. Filters
drift-reclaims on dead tape but 1.0x is permissive.
experiment: E0 params + {volume_confirm_mult: 1.0}

## H2 volume confirmation at 1.2x
prediction: the sweet spot if the thesis holds — WR +5pp or better with PF >=
champion; n drops ~25-40%. Adopt bar: WR >= 0.65 AND PF >= 1.39.
experiment: E0 params + {volume_confirm_mult: 1.2}

## H3 volume confirmation at 1.5x (strict)
prediction: n too thin (< ~20) to conclude; WR noisy. Logged for the curve
shape, not adoption.
experiment: E0 params + {volume_confirm_mult: 1.5}

## H4 confluence strength >= 3 dims (the "meaningful levels" gate)
prediction: WR up (+3-8pp) — the strategy-winrate goal already showed strong
zones beat fresh/weak ones — but n may halve; PF at least holds.
experiment: E0 params + {min_strength: 3}

## H5 best-of-H1..3 volume x confluence >= 3 (stacked)
prediction: directionally best WR of the set; n thin (may be inconclusive).
experiment: E0 params + {volume_confirm_mult: <best>, min_strength: 3}

---

# Results (frozen multi-cache, all runs identical code path)

E0 re-measure: n=34 WR 0.706 PF 2.99 (higher than the goal-era 0.600/1.387 —
the playbook-params goal later adopted pivot_n 3, changing scaffolds; all runs
below share this code so comparisons are clean).

## E0  n=34 WR 0.706 PF 2.99 net +4.55%  (stops 8)
## H1  n=30 WR 0.667 PF 2.27 net +2.73%  (stops 4)   verdict: DISPROVEN
## H2  n=29 WR 0.517 PF 1.54 net +1.33%  (stops 2)   verdict: DISPROVEN
## H3  n=28 WR 0.500 PF 1.18 net +0.40%  (stops 1)   verdict: DISPROVEN
## H4  n=6  WR 0.500 PF 1.26 net +0.21%              verdict: DISPROVEN (n thin but direction clear)
## H5  not run — stacking two disproven components is pointless.

**Volume confirmation: rejected.** Monotone dose-response AGAINST it
(PF 2.99→2.27→1.54→1.18 as the gate tightens). Mechanism: the gate delays
fills past the good entries (stop count collapses 8→4→2→1 because winners are
skipped, not because losers are filtered) — reclaims fire on quiet drift; the
volume comes after. NOT shipped to Pine/spec.

**Confluence: 2 dims stands, 3 rejected.** The champion's zones already carry
>=2 dims (min_zone_dims=2) — that IS the validated "meaningful levels" bar.
Forcing 3 starves it (n 34→6, PF 2.99→1.26). Pine live-pivot gate ships at
MIN_CONFLUENCE=2 (pivot + >=1 stacking dim), mirroring the validated playbook
parameter — NOT at 3.

Harness upgrade kept: volume_confirm_mult/volume_len params (default off) so
the disproof is re-runnable.

---

# Round 2 — time-of-day (pre-registered before any measurement)

## H6 the champion's edge is time-dependent (diagnostic slice, no gate)
prediction: open hour (9:30-10:30) is the weakest bucket (chop, levels not yet
respected); midday (11:00-14:00) strongest; fills after ~14:30 drag from "eod"
truncation (13/34 champion exits were eod — no room to resolve).
method: champion run, trades bucketed by fill hour (fill_idx on the 5m frame).

## H7 skip the first 30 minutes (skip_open_bars=2 on 15m = 30min)
prediction: WR +2-6pp, n drops <=20%; PF holds or improves. Adopt bar:
WR >= 0.72 AND PF >= 2.99 with n >= 25.
experiment: champion params + {skip_open_bars: 2}

## H8 no new entries after 14:00 ET (post-filter on fill hour)
prediction: removes most eod exits; WR +3-8pp on the surviving set; n drops
~25-35%. Adopt bar: same as H7.
method: champion trades, drop fills at/after 14:00, re-score.

# Round 2 results

## H6 fill-hour slice — prediction WRONG in both directions
09:30 n=2 WR 1.00 · 10:00 n=15 WR 0.733 PF 3.05 · 11:00 n=9 WR 0.556 ·
12:00 n=3 · 13:00 n=2 · 14:00+ n=3 (all won). The OPEN is the strongest
period, not the weakest; late fills are not a drag (eod exits are spread, not
late-clustered). The reclaim's mechanics already time-cluster fills at
10:00-11:00 (open-range levels get tested, then 3x5m confirms) — the strategy
has an implicit time structure without a gate. verdict: no time weakness found.

## H7 skip first 30m — better full-window, FAILS split-half
full: n=32 WR 0.719 PF 3.40 net +4.80 (champ 0.706/2.99/+4.55) — misses the
pre-registered WR bar (0.72) by a hair. Split-half: H1 5.91 vs 2.81 PF (better),
H2 2.63 vs 3.08 (WORSE). Improvement does not replicate → NOT adopted.
skip 1h: n=28 WR 0.643 PF 2.53 — clearly worse. verdict: DISPROVEN (no adoption).

## H8 late-entry cutoffs — every cutoff worse
before 13:00 WR 0.690 PF 2.89 · before 14:00 0.677/2.64 · before 15:00
0.697/2.95 vs champion 0.706/2.99. Cutoffs remove winners. verdict: DISPROVEN.

**Time-of-day: no gate ships.** Buckets are thin (n<=15) — no gate is
justified, and none measured better robustly. Champion unchanged.
