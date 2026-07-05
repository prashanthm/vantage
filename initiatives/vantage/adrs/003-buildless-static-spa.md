# ADR-003: Buildless static SPA — React globals + one-shot esbuild JSX transform

## Status

Accepted

## Context

The prototype must render the Lookey DS (which ships as a browser-global bundle expecting `window.React`) and iterate fast without a toolchain to maintain. A framework app (Next/Vite) brings dev servers, config, and dependency churn that a mock-data SPA doesn't need.

## Decision Drivers

1. The DS bundle's own loading contract is script-tag globals (`react.js` → `_ds_bundle.js` → app), making a bundler-managed module graph unnecessary.
2. One `build.sh` line (`npx esbuild src/app.jsx --bundle --jsx=transform --outfile=app.js`) is the entire toolchain; no `node_modules`, no lockfile, no config drift.
3. Any static file server (or file host) runs the app — deployment surface stays trivial (ADR-012).
4. Rejected: **Vite/Next app** — real dev ergonomics, but adds a node project, dependency updates, and framework lock-in to a throwaway-tier prototype. Rejected: **no-build JSX via Babel-standalone CDN** — violates offline/self-contained loading and slows every page load.

## Research & Rubric

No options weighed — charter decision; the DS loading contract constrained the space.

## Decision

Vantage is a static SPA: `index.html` loads vendored React, the DS bundle, `app.css`, and a single `app.js` produced by a one-shot esbuild JSX transform of `src/*.jsx`. No framework, no dev server, no node project.

## Consequences

### Becomes Easier

- Clone → `./build.sh` → serve; CI needs nothing but esbuild via npx.
- The app works from any static host; vendored deps mean no supply-chain churn.

### Becomes Harder

- No HMR/dev server; each change is rebuild + refresh.
- No TypeScript or import-graph tooling; discipline lives in file layout (`src/util.jsx`, `src/data.js`).

## Applies To

- All UI features; ADR-004 (DS as sole styling source), ADR-012 (static hosting).
