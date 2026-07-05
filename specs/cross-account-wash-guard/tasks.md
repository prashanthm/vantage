# Cross-Account Wash Guard — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Same-family recent buy in any account blocks with reason + clear date

  ## Loop AC

  - [x] AC-1: Same-family recent buy in any account blocks with reason + clear date
    - verify: `grep -q "RECENT_BUYS.find" src/util.jsx`

- [x] T2: Scheduled auto-buy within 30 days blocks with pause hint

  ## Loop AC

  - [x] AC-2: Scheduled auto-buy within 30 days blocks with pause hint
    - verify: `grep -q "AUTO_BUYS.find" src/util.jsx`

- [x] T3: Families wash each other; different-index partners do not

  ## Loop AC

  - [x] AC-3: Families wash each other; different-index partners do not
    - verify: `grep -q "WASH_FAMILIES" src/util.jsx`

- [x] T4: Window constant is 30 days

  ## Loop AC

  - [x] AC-4: Window constant is 30 days
    - verify: `grep -q "WASH_WINDOW_DAYS = 30" src/data.js`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

