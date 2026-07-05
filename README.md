# Vantage — every account, one view

> **AI-SDLC (kadence) artifacts:** [`initiatives/vantage/`](initiatives/vantage/) — initiative charter,
> product brief (Epic Index), 7 epics, 18 features, ADR catalog + 13 ADRs, generated
> [`INDEX.md`](initiatives/vantage/INDEX.md); engineering specs in [`specs/`](specs/)
> (spec/plan/tasks per feature, Loop AC verified). Status lives on the
> [GitHub issues](https://github.com/prashanthm/vantage/issues) (ADRs #1–13, epics #14–20, features #21–38).

A functioning prototype of a **cross-account portfolio & market intelligence hub** — a
one-stop shop for traders and investors: recommendations, analysis, and notifications
computed across *all* linked brokerage accounts, not one at a time.

Built on the **Lookey design system** (`pm-design-system` on claude.ai/design): Navbar,
Button, Modal, FormField, SecurityCard, FAQItem plus token-styled glue (Outfit font,
`--color-primary #2e68fd`, light surfaces). Product concept inspired by the Fortune 6
dashboard (`~/personal/f6io` screenshots) and sentinel's `tlh_monitor.py`.

## Why "Vantage"

A vantage point is a position that lets you see everything at once — which is exactly
the product's edge: wash sales, exposure overlap, and allocation drift are invisible
inside any single account and only appear when every account is viewed together.

## Information architecture (v2)

No more single scroll: a persistent left sidebar routes between dedicated views
(hash-routed, deep-linkable — `#/overview`, `#/tax`, `#/charts`, …), following the
standard fintech dashboard pattern (one job per screen, global account scope pinned
in the sidebar):

- **Portfolio**: Overview · Holdings · Tax Center · Recommendations
- **Intelligence**: Market Intel · Options Intel · AI Charts

## Key aspects (industry standards)

- **Accounts rail** — 4 mock linked accounts (taxable, Roth IRA, 401(k), robo) with an
  "All accounts" consolidated toggle; every number re-derives on switch.
- **Portfolio overview** — stat tiles (total, day P/L, unrealized, harvestable losses)
  and an allocation bar with drift-vs-target badges.
- **Cross-account holdings** — combined positions, per-lot expandable rows, overlap
  flags (VOO/SPY/VTI = same US-large-blend exposure) and concentration flags.
- **Tax Center (TLH)** — sentinel semantics: lots marked to close, harvest threshold,
  different-index partner map (VOO→VTI, IWM→IJR…), and the critical detail single-account
  tools miss: the **30-day wash-sale window checked across every account** including
  IRAs and scheduled auto-buys (Rev. Rul. 2008-5). Decision-support only; no orders.
- **Recommendations** — ranked cards: harvest, pause-auto-buy, concentration,
  overlap consolidation, contribute-to-rebalance, cash drag.
- **Market intelligence** — ticker strip, AI market summary per symbol, AI picks,
  pattern-signal scanner (active/past), sector heatmap with drill-in analysis modal.
- **Options Intelligence** — IV-rank/expected-move/put-call context tiles, income
  ideas screened against your actual holdings and cash per account (covered calls,
  cash-secured puts, eligibility and approval-level caveats), unusual-flow feed,
  and TLH cross-checks (assignment can wash a planned harvest).
- **AI Charts** — full-screen seeded candlestick chart (`src/ohlc.js`) with volume,
  AI buy/sell/note markers, support/resistance levels, your avg-cost overlay,
  crosshair tooltip, timeframes, and a portfolio-aware AI recommendation panel
  (e.g. NVDA: "Trim after Aug 15" — the lot's long-term date).
- **Notifications center** — unified alert types with read state and per-type prefs.
- **Vantage AI chat** — canned portfolio-aware responses (demo).
- **Settings** — thresholds, tax rate, default view; persisted to `localStorage`.
- **Compliance banner** — educational only, not financial/tax advice.

The cross-account math (consolidation, overlap detection, wash-sale windows, benefit
estimates) is real logic in `src/app.jsx`; only the data (`src/data.js`) is mock.

## Run

```sh
./build.sh                 # recompile src/app.jsx -> app.js (needs npx/esbuild)
python3 -m http.server 8642
open http://localhost:8642
```

`ds/` and `vendor/` are copied verbatim from the local Lookey DS bundle
(`~/personal/117/lookey-site/ds-bundle`); regenerate from there if the DS changes.

## Backend (`server/`)

The deterministic portfolio engine as a Python 3.12 service (ADR-013/ADR-014):
the same positions / allocation / wash-sale / TLH math as `src/util.jsx`, exposed
read-only via REST for the SPA and as MCP `vantage.*` tools for Mira (the AI side
does no portfolio math). Fixture data mirrors `src/data.js`; parity golden tests
pin the two together. See [`server/README.md`](server/README.md).

```sh
make -C server setup    # server/.venv + editable install (Python 3.12)
make -C server test     # engine units, parity goldens, API + MCP contract tests
make -C server run-api  # REST on http://127.0.0.1:8641 (/api/*)
make -C mcp run  # MCP streamable HTTP on http://127.0.0.1:8640/mcp
```

Ports: **8640** MCP · **8641** REST API · **8642** SPA · **8080** Mira (external).

### Getting your real portfolio in

Replace the fixture lots with a broker positions export via the importer CLI
(operator-side file management — the API itself stays read-only). Always
`--dry-run` first to see what would be parsed before anything is written:

```sh
cd server
.venv/bin/python -m vantage_server.importer positions.csv \
    --broker fidelity --account fid-taxable --as-of 2026-07-05 --dry-run   # then re-run without --dry-run
.venv/bin/python -m vantage_server.importer positions.csv \
    --broker schwab --account schwab-roth --as-of 2026-07-05
.venv/bin/python -m vantage_server.importer ofxdownload.csv \
    --broker vanguard --account vg-401k --as-of 2026-07-05
```

If the target account isn't in `accounts.json` yet, append it in the same run
with `--add-account "id,name,short,type,taxable"`. Live (delayed) quotes come
from `./stack start --live` instead of `run-api`. Full importer
semantics (merge vs replace, backups, generic CSV): [`server/README.md`](server/README.md).

### Frontend integration (Phase V4)

The SPA is wired to both services through `src/live.js` (plain `fetch` +
`ReadableStream`, no dependencies) as **progressive enhancement — fixtures stay
the fallback**:

- On load (and whenever settings change) the views that read portfolio/tax data
  (Overview, Holdings, Tax Center) fetch from the backend; when a call succeeds
  the live payload replaces the fixture-derived numbers, and any failure —
  service down, timeout (~2.5s), non-200 — silently keeps the fixtures. The app
  is fully functional with neither service running.
- **Mira chat**: with `AI assistant = Mira` (default), the chat panel streams
  `POST /turn` SSE — plan steps render as a subtle "thinking" line sequence,
  tokens accumulate into the reply. If Mira is unreachable or errors, the
  message falls back to the canned rule with an "offline — canned reply" hint.
  Setting it to Off restores the pure canned demo. Market Intel also renders
  Mira's `GET /insights?domain=advisor` report in place of the fixture AI-picks
  panel when available.
- **Status dots** in the sidebar footer show `data live/demo` (backend health,
  with quote source/as-of in the tooltip) and `AI live/demo/off` (Mira health).
- **Settings** gains the two URLs (`Backend URL` → `http://127.0.0.1:8641`,
  `Mira URL` → `http://127.0.0.1:8080`) and the Mira/Off toggle; all persisted
  under the same `vantage.settings.v1` localStorage key (ADR-009 — still the
  only client-side persistence).

> Prototype disclaimer: simulated data throughout. Nothing here is financial,
> investment, or tax advice, and the app never connects to a broker.
