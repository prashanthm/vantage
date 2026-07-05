# Sector Heatmap — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: 11 sectors with aggregates

  ## Loop AC

  - [x] AC-1: 11 sectors with aggregates
    - verify: `grep -q "SECTORS.map" src/app.jsx`

- [x] T2: Tint scales with |move|, neutral near flat

  ## Loop AC

  - [x] AC-2: Tint scales with |move|, neutral near flat
    - verify: `grep -q "heatTint" src/util.jsx`

- [x] T3: Signed % text on every tile (not color-alone)

  ## Loop AC

  - [x] AC-3: Signed % text on every tile (not color-alone)
    - verify: `grep -q "signPct(st.pct)" src/app.jsx`

- [x] T4: Modal states holding accounts or Not held

  ## Loop AC

  - [x] AC-4: Modal states holding accounts or Not held
    - verify: `grep -q "You hold this in" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

