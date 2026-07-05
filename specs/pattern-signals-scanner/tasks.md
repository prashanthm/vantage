# Pattern Signals Scanner — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Tabs filter with live counts

  ## Loop AC

  - [x] AC-1: Tabs filter with live counts
    - verify: `grep -q "signalsTab" src/app.jsx`

- [x] T2: Outcome badges on past signals

  ## Loop AC

  - [x] AC-2: Outcome badges on past signals
    - verify: `grep -q "hit-target" src/app.jsx`

- [x] T3: Numeric columns tabular + signed move

  ## Loop AC

  - [x] AC-3: Numeric columns tabular + signed move
    - verify: `grep -q "tabular-nums" app.css`

- [x] T4: bundle compiles cleanly

  ## Loop AC

  - [x] AC-4: esbuild transform succeeds
    - verify: `./build.sh`

