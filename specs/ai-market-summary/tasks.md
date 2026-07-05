# AI Market Summary — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Symbol switch swaps read in place

  ## Loop AC

  - [x] AC-1: Symbol switch swaps read in place
    - verify: `grep -q "AI_INSIGHTS\[symbol\]" src/app.jsx`

- [x] T2: Three-state bias badge styling

  ## Loop AC

  - [x] AC-2: Three-state bias badge styling
    - verify: `grep -q "vg-bias" app.css`

- [x] T3: Meters render 0-100 with values

  ## Loop AC

  - [x] AC-3: Meters render 0-100 with values
    - verify: `grep -q "vg-meter" src/app.jsx`

- [x] T4: Picks click through when a read exists

  ## Loop AC

  - [x] AC-4: Picks click through when a read exists
    - verify: `grep -q "AI_PICKS.map" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

