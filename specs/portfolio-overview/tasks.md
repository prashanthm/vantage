# Portfolio Overview — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Four stat tiles re-derive on scope change

  ## Loop AC

  - [x] AC-1: Four stat tiles re-derive on scope change
    - verify: `grep -q "Harvestable losses" src/app.jsx`

- [x] T2: Allocation bar uses validated categorical palette with labels

  ## Loop AC

  - [x] AC-2: Allocation bar uses validated categorical palette with labels
    - verify: `grep -q "ASSET_CLASSES" src/app.jsx`

- [x] T3: Drift badges only in consolidated scope at >=3pt deviation

  ## Loop AC

  - [x] AC-3: Drift badges only in consolidated scope at >=3pt deviation
    - verify: `grep -q "Math.abs(drift) >= 3" src/app.jsx`

- [x] T4: Benefit note derives from settings tax rate

  ## Loop AC

  - [x] AC-4: Benefit note derives from settings tax rate
    - verify: `grep -q "settings.taxRate" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

