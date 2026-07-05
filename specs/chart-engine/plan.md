# Chart Engine — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/ohlc.js (generator)`
- `src/charts.jsx (ChartsView svg)`
- `src/data.js (CHART_PARAMS, CHART_LEVELS)`
- `app.css (.vg-chartwrap, .vg-charttip)`

## Implementation Steps

1. Seeded PRNG walk-back generator with weekend-skipping dates
2. SVG candle/volume geometry with y-scaling incl. levels + cost basis
3. Crosshair mouse handling + tooltip
4. Timeframe slicing

## ADRs Applied

- ADR-006 (seeded)
- ADR-003 (hand-rolled SVG, no chart lib)
- ADR-004 (status colors)

## Edge Cases

- y-domain must include levels and avg cost even when outside price range
- Mouse leaving chart clears crosshair
