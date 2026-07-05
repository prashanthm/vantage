# Accounts & Scope Rail — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Rail lists all accounts + consolidated entry with derived balances

  ## Loop AC

  - [x] AC-1: Rail lists all accounts + consolidated entry with derived balances
    - verify: `grep -q "accountValue" src/app.jsx`

- [x] T2: Selecting an entry updates shared scope state consumed by all views

  ## Loop AC

  - [x] AC-2: Selecting an entry updates shared scope state consumed by all views
    - verify: `grep -q "setAccountId" src/app.jsx`

- [x] T3: Read-only note visible (ADR-010 surface)

  ## Loop AC

  - [x] AC-3: Read-only note visible (ADR-010 surface)
    - verify: `grep -q "never holds funds or places orders" src/app.jsx`

- [x] T4: bundle compiles cleanly

  ## Loop AC

  - [x] AC-4: esbuild transform succeeds
    - verify: `./build.sh`

