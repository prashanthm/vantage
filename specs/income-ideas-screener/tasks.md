# Income Ideas Screener — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Every idea names backing + account

  ## Loop AC

  - [x] AC-1: Every idea names backing + account
    - verify: `grep -q "INCOME_IDEAS" src/options.jsx`

- [x] T2: Not-yet-eligible positions show the gap

  ## Loop AC

  - [x] AC-2: Not-yet-eligible positions show the gap
    - verify: `grep -q "Not yet eligible" src/data.js`

- [x] T3: Approval caveat on restricted accounts

  ## Loop AC

  - [x] AC-3: Approval caveat on restricted accounts
    - verify: `grep -q "401(k)" src/data.js`

- [x] T4: Assignment-wash warning ties to Tax Center

  ## Loop AC

  - [x] AC-4: Assignment-wash warning ties to Tax Center
    - verify: `grep -q "wash the loss if" src/options.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

