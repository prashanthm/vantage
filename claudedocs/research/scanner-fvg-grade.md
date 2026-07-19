# Scanner FVG-size grade + stop floor — backtest (2026-07-19)

The user asked: "if the FVG is tiny, how can it be A+?" and "shouldn't a larger
displacement + larger FVG grade higher?" The A+ tier was gated ONLY on the sweep
confluence + a displacement ≥ 0.7 ATR — FVG *size* played no role. A survey of the
live universe showed **53/74 A+ setups (72%) had a stop < 0.5 ATR** (median 0.29):
thin FVGs are the norm, so the stops are spike-bait regardless of the §1 buffer.

## Method
60d hourly bars (yfinance) across 28 liquid equities (AMAT, NXPI, ADBE, AMD, KLAC,
CRM, AMZN, …), 318 confluence setups. Exit ladder (50%@1R / 25%@2R / 25%@3R, BE
after TP1), stop = FVG far edge + 0.10 ATR buffer, then FLOORED to a minimum ATR
distance. Walk forward ≤48 hourly bars, stop-before-target within a bar.

## Findings

### 1. FVG size stratifies performance; displacement does NOT
Per-band exit-ladder expectancy (floor 0.5 ATR):

| FVG / ATR | n | exp R | % positive |
|---|---|---|---|
| <0.3 (thin) | 124 | +0.12 | **48% (coin-flip)** |
| 0.3–0.5 | 59 | +0.41 | 63% |
| 0.5–0.7 | 39 | +0.28 | 59% |
| 0.7–1.0 | 31 | +1.05 | **81%** |
| ≥1.0 (fat) | 65 | +0.63 | **82%** |

Marginals: **FVG≥0.7 → +0.76R / 81%**; disp≥1.0 → +0.34R / 62%; disp 0.7-1.0 →
+0.46R / 62%. In the 2D displacement×FVG grid, expectancy climbs strongly ACROSS
FVG bands but is flat-to-negative DOWN displacement bands (a violent displacement
often overshoots and mean-reverts). **Displacement magnitude does not belong in the
grade** — only as the existing ≥0.7-ATR gate that forms the FVG.

### 2. Confluence (the sweep) stays additive — keep it
Confluence vs bare disp-FVG at each FVG band:

| FVG band | confluence | bare (no sweep) |
|---|---|---|
| thin<0.3 | +0.17 / 51% | +0.05 / 46% |
| med | +0.38 / 63% | +0.25 / 55% |
| fat≥0.7 | +0.77 / 81% | +0.71 / 78% |

The sweep lifts every band ~0.1R / 3-5pts. Confluence + FVG size STACK — we are not
replacing confluence, we're grading within it.

### 3. Stop floor: 0.5 ATR is the sweet spot
gate×floor grid: within any FVG gate, floor 0.5 ATR was best; floor ≥1.0 REDUCED
expectancy (wider stops cost more R than they save). e.g. gate 0.5: floor 0.0
+0.59, floor 0.5 **+0.62**, floor 1.0 +0.51, floor 1.5 +0.36.

## Shipped grade (all values backtested)
- **A+** = confluence (sweep→disp-FVG) AND FVG ≥ 0.7 ATR — 81% win, +0.77R.
- **B**  = confluence + FVG 0.3–0.7 ATR (63%), OR a bare fat FVG≥0.7 with no sweep.
- **suppressed** = FVG < 0.3 ATR (48%, no edge) — not surfaced.
- **stop** = max(FVG-edge + 0.10 ATR buffer, entry − 0.5 ATR) — floored so no
  survivor has a sub-0.5-ATR stop.

Constants in ict_htf.py: `FVG_GRADE_HI=0.7`, `FVG_GRADE_LO=0.3`, `STOP_FLOOR_ATR=0.5`.

## Two implementations, one calculation
The same grade + floor is MIRRORED into `coach_pine.py` (the TradingView chart
indicator) with identical constants (`FVG_GRADE_HI/LO`, `INVALID_BUFFER_ATR`,
`STOP_FLOOR_ATR`) — so a setup the scanner flags is verifiable on the chart: same A+
grade, same thin-suppression, same floored invalidation (drawn as a dashed line).
Pine can't call the Python (TradingView sandbox), so this is a faithful mirror, not
a shared module — when either changes, update both and keep the constants equal. The
Python `ict_htf` remains the parity-validated source; Pine reproduces its numbers.

Relates to [[goal-ict-concepts-edge]], scanner-exit-ladder.md, scanner-spread-invalidation.md.
