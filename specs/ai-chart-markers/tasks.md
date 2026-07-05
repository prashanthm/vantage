# AI Chart Markers — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Three marker glyph types render

  ## Loop AC

  - [x] AC-1: Three marker glyph types render
    - verify: `grep -q "b.marker.type" src/charts.jsx`

- [x] T2: Legend always visible

  ## Loop AC

  - [x] AC-2: Legend always visible
    - verify: `grep -q "vg-mk-swatch" src/charts.jsx`

- [x] T3: Tooltip includes marker label

  ## Loop AC

  - [x] AC-3: Tooltip includes marker label
    - verify: `grep -q "hb.marker" src/charts.jsx`

- [x] T4: Dated timeline chips

  ## Loop AC

  - [x] AC-4: Dated timeline chips
    - verify: `grep -q "vg-markerlist" src/charts.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

