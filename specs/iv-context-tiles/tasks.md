# IV Context Tiles — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Tiles render rank/meter/move/PCR per symbol

  ## Loop AC

  - [x] AC-1: Tiles render rank/meter/move/PCR per symbol
    - verify: `grep -q "OPTIONS_CONTEXT" src/options.jsx`

- [x] T2: Threshold-based labels not color-alone

  ## Loop AC

  - [x] AC-2: Threshold-based labels not color-alone
    - verify: `grep -q "IV rank" src/options.jsx`

- [x] T3: Click-through to charts with symbol

  ## Loop AC

  - [x] AC-3: Click-through to charts with symbol
    - verify: `grep -q 'go("charts")' src/options.jsx`

- [x] T4: bundle compiles cleanly

  ## Loop AC

  - [x] AC-4: esbuild transform succeeds
    - verify: `./build.sh`

