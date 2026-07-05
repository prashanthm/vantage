# Unusual Flow Feed — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Side badges styled by polarity

  ## Loop AC

  - [x] AC-1: Side badges styled by polarity
    - verify: `grep -q "f.side ===" src/options.jsx`

- [x] T2: Mock-feed label present

  ## Loop AC

  - [x] AC-2: Mock-feed label present
    - verify: `grep -q "mock feed" src/options.jsx`

- [x] T3: bundle compiles cleanly

  ## Loop AC

  - [x] AC-3: esbuild transform succeeds
    - verify: `./build.sh`

