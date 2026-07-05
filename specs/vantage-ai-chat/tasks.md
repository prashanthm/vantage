# Vantage AI Chat — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Wash/TLH/overlap/allocation rules answer with real dataset figures

  ## Loop AC

  - [x] AC-1: Wash/TLH/overlap/allocation rules answer with real dataset figures
    - verify: `grep -q "CHAT_RULES" src/data.js`

- [x] T2: Catch-all fallback exists

  ## Loop AC

  - [x] AC-2: Catch-all fallback exists
    - verify: `grep -q "match: /.\*/" src/data.js`

- [x] T3: Demo + educational disclosure in panel

  ## Loop AC

  - [x] AC-3: Demo + educational disclosure in panel
    - verify: `grep -q "canned responses" src/app.jsx`

- [x] T4: DS FormField + Button compose the input row

  ## Loop AC

  - [x] AC-4: DS FormField + Button compose the input row
    - verify: `grep -q "vg-chatform" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

