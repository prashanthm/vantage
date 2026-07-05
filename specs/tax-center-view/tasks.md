# Tax Center View — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Per-lot rows with status badges and action column

  ## Loop AC

  - [x] AC-1: Per-lot rows with status badges and action column
    - verify: `grep -q "Clear to harvest" src/app.jsx`

- [x] T2: Blocked rows show reason and clear date inline

  ## Loop AC

  - [x] AC-2: Blocked rows show reason and clear date inline
    - verify: `grep -q "c.wash.reason" src/app.jsx`

- [x] T3: Education FAQ references current settings

  ## Loop AC

  - [x] AC-3: Education FAQ references current settings
    - verify: `grep -q "Rev. Rul. 2008-5" src/app.jsx`

- [x] T4: Sidebar dot iff a clear candidate exists

  ## Loop AC

  - [x] AC-4: Sidebar dot iff a clear candidate exists
    - verify: `grep -q "vg-navdot" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

