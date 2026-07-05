# TLH Candidates Engine — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Each losing lot gets exactly one status

  ## Loop AC

  - [x] AC-1: Each losing lot gets exactly one status
    - verify: `grep -q "tlhCandidates" src/util.jsx`

- [x] T2: Thresholds come from settings ($ and %)

  ## Loop AC

  - [x] AC-2: Thresholds come from settings ($ and %)
    - verify: `grep -q "thresholdUsd" src/util.jsx`

- [x] T3: Partner-map replacement or 31-day-wait instruction

  ## Loop AC

  - [x] AC-3: Partner-map replacement or 31-day-wait instruction
    - verify: `grep -q "PARTNER_MAP" src/util.jsx`

- [x] T4: Benefit = harvestable loss x marginal rate

  ## Loop AC

  - [x] AC-4: Benefit = harvestable loss x marginal rate
    - verify: `grep -q "taxRate" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

