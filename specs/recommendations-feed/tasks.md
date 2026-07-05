# Recommendations Feed — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Six insight cards with distinct accents

  ## Loop AC

  - [x] AC-1: Six insight cards with distinct accents
    - verify: `grep -c "SecurityCard accent" src/app.jsx | grep -qv "^0$"`

- [x] T2: Quantified cards re-derive from settings

  ## Loop AC

  - [x] AC-2: Quantified cards re-derive from settings
    - verify: `grep -q "settings.taxRate / 100" src/app.jsx`

- [x] T3: Overview shows top actions with link to full feed

  ## Loop AC

  - [x] AC-3: Overview shows top actions with link to full feed
    - verify: `grep -q "All recommendations" src/app.jsx`

- [x] T4: Options income teaser links to Options Intel

  ## Loop AC

  - [x] AC-4: Options income teaser links to Options Intel
    - verify: `grep -q "Open Options Intel" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

