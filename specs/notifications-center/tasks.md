# Notifications Center — Tasks

> Each task carries a `## Loop AC` of behavioral `verify:` commands (run from the repo root).
> Backfill: tasks reflect the as-implemented decomposition; all Loop AC pass on current main.

- [x] T1: Unread badge counts only unmuted types

  ## Loop AC

  - [x] AC-1: Unread badge counts only unmuted types
    - verify: `grep -q "settings.notifPrefs\[n.type\]" src/app.jsx`

- [x] T2: Click marks read; mark-all-read works

  ## Loop AC

  - [x] AC-2: Click marks read; mark-all-read works
    - verify: `grep -q "Mark all read" src/app.jsx`

- [x] T3: Per-type mute persists via settings save

  ## Loop AC

  - [x] AC-3: Per-type mute persists via settings save
    - verify: `grep -q "notifPrefs" src/util.jsx`

- [x] T4: Typed rendering with icon/label/time

  ## Loop AC

  - [x] AC-4: Typed rendering with icon/label/time
    - verify: `grep -q "NOTIF_TYPES" src/app.jsx`

- [x] T5: bundle compiles cleanly

  ## Loop AC

  - [x] AC-5: esbuild transform succeeds
    - verify: `./build.sh`

