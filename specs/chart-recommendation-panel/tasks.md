# Chart Recommendation Panel — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Held symbols show position + avg-cost line

  ## Loop AC

  - [x] AC-1: Held symbols show position + avg-cost line
    - verify: `grep -q "your avg cost" src/charts.jsx`

- [x] T2: Unheld symbols say Not held

  ## Loop AC

  - [x] AC-2: Unheld symbols say Not held
    - verify: `grep -q "Not held in any linked account" src/charts.jsx`

- [x] T3: Recommendation card has action/rationale/risk

  ## Loop AC

  - [x] AC-3: Recommendation card has action/rationale/risk
    - verify: `grep -q "vg-recaction" src/charts.jsx`

- [x] T4: Education FAQ present

  ## Loop AC

  - [x] AC-4: Education FAQ present
    - verify: `grep -q "What are the AI markers" src/charts.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

