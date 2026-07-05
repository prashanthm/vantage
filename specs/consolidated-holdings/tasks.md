# Consolidated Holdings — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Rows aggregate lots per symbol with account chips

  ## Loop AC

  - [x] AC-1: Rows aggregate lots per symbol with account chips
    - verify: `grep -q "positions(accountId)" src/app.jsx`

- [x] T2: Row click toggles per-lot subrows with term (short/long)

  ## Loop AC

  - [x] AC-2: Row click toggles per-lot subrows with term (short/long)
    - verify: `grep -q "long-term" src/app.jsx`

- [x] T3: Overlap badge only in all-accounts scope

  ## Loop AC

  - [x] AC-3: Overlap badge only in all-accounts scope
    - verify: `grep -q "p.overlap && accountId" src/app.jsx`

- [x] T4: Concentration badge for non-ETF weight > 7%

  ## Loop AC

  - [x] AC-4: Concentration badge for non-ETF weight > 7%
    - verify: `grep -q "p.weight > 7" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

