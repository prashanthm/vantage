# Chart Engine — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Deterministic seeded series end at quote

  ## Loop AC

  - [x] AC-1: Deterministic seeded series end at quote
    - verify: `grep -q "closes\[n - 1\] = endPrice" src/ohlc.js`

- [x] T2: Volume subchart renders per bar

  ## Loop AC

  - [x] AC-2: Volume subchart renders per bar
    - verify: `grep -q "volume" src/charts.jsx`

- [x] T3: S/R lines labeled and dashed

  ## Loop AC

  - [x] AC-3: S/R lines labeled and dashed
    - verify: `grep -q "resistance" src/charts.jsx`

- [x] T4: Crosshair tooltip with OHLC

  ## Loop AC

  - [x] AC-4: Crosshair tooltip with OHLC
    - verify: `grep -q "vg-charttip" src/charts.jsx`

- [x] T5: Timeframe slicing 1M/3M/6M

  ## Loop AC

  - [x] AC-5: Timeframe slicing 1M/3M/6M
    - verify: `grep -q "TIMEFRAMES" src/charts.jsx`

- [x] T6: bundle compiles cleanly

  ## Loop AC

  - [x] AC-6: esbuild transform succeeds
    - verify: `./build.sh`

