# Plan: Full multi-underlying support (SPX + QQQ + IWM, + NQ/RTY futures projection)

## Instrument model (why futures ride on the ETF playbooks)

The playbook's edge = **dealer GEX** (needs an options chain w/ OI) + **confluence zones**
(needs bars). By index family:

- **ES / SPX / SPY** — the existing SPX playbook.
- **NQ / NDX / QQQ** — same Nasdaq-100 underlying. QQQ has liquid options → build the QQQ
  playbook (GEX + zones). **NQ the future has no usable options chain**, but tracks QQQ/NDX
  tick-for-tick, so NQ's levels ARE the QQQ playbook's levels rescaled by the NQ/QQQ price
  ratio (~41×). No separate NQ GEX — that would just re-derive QQQ's.
- **RTY / RUT / IWM** — same Russell 2000. Build the IWM playbook; RTY = IWM levels rescaled
  (~RTY/IWM ratio).

So: **build QQQ + IWM playbooks (full mode), then PROJECT them into NQ/RTY futures points.**
One source of truth per index family; the futures reference the same zones, in futures terms.

## Context

Today the entire 0DTE pipeline — playbook, GEX, confluence/durable zones, paper tickets
(the new demand/supply layer), and the trading journal — is SPX-only (traded via the SPY
proxy). The user wants **full-mode** support for QQQ and IWM: each gets its own playbook
**including GEX** (from its own option chain, not a proxy), its own zones/tickets, and its
own daily journal entry, selectable via a **SPX/QQQ/IWM switcher** on the Playbook, Paper,
and Journal pages. One journal entry auto-created per underlying per day.

Exploration established that the compute layer is mostly symbol-agnostic already, but three
things block multi-underlying: (1) the `spx_playbook` and GEX **storage keys** are
single-underlying (collide across symbols), (2) `build_playbook`/`paper`/journal **hardcode
SPX/SPY**, and (3) several **price-scale constants** are tuned to SPX's ~7000 magnitude.

Decisions (from the user): GEX from each ETF's **own chain** (no NDX/RUT proxy); a **symbol
switcher** UI (not stacked, not separate nav); **one journal entry per underlying per day**.

## Guardrails

- **New feature branch** off `main` (we are currently on `main`). Never work on `main`.
- Everything stays **journal/analysis + paper only — places no orders (ADR-010).**
- **SPX behavior must not regress.** SPX stays the default everywhere; QQQ/IWM are additive.
- Migrations must be **additive + idempotent** and preserve existing rows (mirror the v7→v8
  `ALTER TABLE` + PK-rebuild pattern already in `db.py`).

## The symbol model

Introduce one small registry (new `underlyings.py` or a dict in `spx_playbook.py`) mapping a
canonical underlying key → its data symbols and price scale:

| key   | bar symbol | GEX chain | proxy (P&L/strike) | round step | cluster tol |
|-------|-----------|-----------|--------------------|-----------|-------------|
| SPX   | `^GSPC`   | `^SPX`→SPY fallback | `SPY` | 50 | 6.0 |
| QQQ   | `QQQ`     | `QQQ`     | `QQQ` (self)       | 5  | 0.6 |
| IWM   | `IWM`     | `IWM`     | `IWM` (self)       | 1  | 0.25 |

- SPX keeps its index-bars-for-price + SPY-for-volume + SPY-proxy-for-strikes split.
- QQQ/IWM are ETFs: bars carry their own volume (no SPY-volume trick) and their own chain
  for GEX; the "proxy" is the ETF itself, so no SPX→SPY ratio conversion (ratio = 1).
- `round_step`/`cluster_tol` become per-underlying so zones cluster sensibly at each price.

This registry is the single source of truth threaded through every layer below.

## Phase 1 — GEX storage per-symbol (do first; it's the hidden blocker)

`gex.py` compute is already symbol-parameterized (`fetch_book`/`build_snapshot`/`record`/
`--symbol`), but storage collides.

- **Schema (`db.py`, bump `SCHEMA_VERSION` 8→9):**
  - `gex_snapshot`: drop the `CHECK (id=1)` singleton; re-key to `symbol TEXT PRIMARY KEY`
    (one latest snapshot per symbol).
  - `gex_history`: PK `date` → `(date, symbol)`.
  - Idempotent migration: since these are forward-accruing caches (safe to reset), the
    simplest correct migration is create-new-shape-if-absent; existing single-symbol rows are
    SPX and can be stamped `symbol='^SPX'`/`'SPX'` on migrate.
- **Store (`store.py`):** `put_gex_snapshot` key on `symbol` (not `id=1`);
  `load_gex_snapshot(symbol)` + `record_gex_history`/`load_gex_history(symbol)` take + filter
  symbol. Default `symbol="^SPX"` to preserve current callers.
- **Guard the SPY-proxy fallback (`gex.py:257-266`):** only fall back to the SPY chain when
  `symbol` is an SPX form (`^SPX`/`^GSPC`/`SPX`). For QQQ/IWM a thin book must NOT be hijacked
  by SPY — return the (possibly thin) native snapshot with a caveat instead.
- **sentinel_bridge:** `gex_snapshot(store, symbol)` / `gex_history(store, symbol)` thread the
  param; `pull_all(..., symbol=...)` passes it down.
- **Verify:** run `python -m vantage_server.gex --symbol ^SPX`, `--symbol QQQ`, `--symbol IWM`
  in sequence; confirm all three snapshots coexist in `gex_snapshot`/`gex_history` (no
  overwrite), each with its own spot/walls.

## Phase 2 — Parameterize `build_playbook` for any underlying

- **`build_playbook(today, store, underlying="SPX")`** (`spx_playbook.py:753`): replace the
  hardcoded `_fetch_15m("^GSPC")` / `_fetch_15m("SPY")` / `record_levels(..., "SPX")` /
  `load_level_history("SPX")` / `"symbol": "SPX"` with registry lookups. For ETFs, use their
  own bars for both price and volume (skip the SPY-volume dict). Pass `symbol` into
  `pull_all`/`gex_snapshot` (Phase 1) so it reads that underlying's GEX.
- **Price-scale constants → per-underlying:** `ROUND_LEVELS_STEP` (line 33) and `_cluster`'s
  `tol` (line 78) come from the registry. The `7000` spot fallbacks (lines 421, 515-516, 665,
  721) only bite when spot is missing; make them registry-driven too for correctness.
- **Display strings:** the SPX-worded caveats (828-834) and `build_setups` trigger strings
  (599/607/614/622) take the underlying label. Keep SPX's exact wording when `underlying=="SPX"`.
- **Storage (`store.py` + `db.py`):** `spx_playbook` PK `date` → `(date, symbol)`, add
  `symbol` column (schema v9, same bump as Phase 1). `upsert_spx_playbook(day, scaffold,
  narrative, symbol)` / `load_spx_playbook(day, symbol)` / `load_spx_playbook_before(day,
  symbol)` take + filter symbol (default `"SPX"`). INSERT-OR-REPLACE target becomes
  `(date, symbol)`.
- **CLI (`spx_playbook.py:840`):** add `--symbol` (default SPX). Pine output filename becomes
  per-underlying (`pine/<sym>_playbook.pine`), SPX keeps `spx_playbook.pine`.
- **Verify:** generate all three playbooks; confirm each stores under its own `(date, symbol)`
  and that QQQ/IWM zones cluster at sane prices (spot-relative), GEX walls populated from their
  own chains.

## Phase 3 — Journal: one entry per underlying per day

- **`load_journal_snapshot_for_day(day, symbol)`** (`store.py:1327`): add `AND symbol=?` — the
  idempotency gate, so each underlying gets its own daily entry. (The `symbol` column already
  exists; no ALTER needed, but add an index on `(substr(created_at), symbol)` or `(session,
  symbol)`.)
- **`ensure_today_entry(store, underlying="SPX")`** (`journal.py:267`): loop-friendly — freeze
  that underlying's prior playbook (`pick_forecast(store, today, "prior", symbol)`), store the
  real `symbol` (not the hardcoded `"SPX"`), and re-score against the right bar symbol.
- **Scoring symbol from the snapshot:** `score_snapshot`/`score_all_open` derive the bar symbol
  from `snap["symbol"]` via the registry (SPX→`^GSPC`, QQQ→`QQQ`, IWM→`IWM`) instead of the
  hardcoded `^GSPC` default.
- **`pick_forecast(store, day, kind, symbol)`** (`journal.py:68`): thread symbol into its
  `load_spx_playbook_before/load_spx_playbook` calls.
- **`build_journal(store, symbol)`**: filter snapshots to the selected underlying;
  `journal_accuracy` computed per underlying.
- **API:** `/api/journal` + `/api/journal/ensure_today` take a `symbol` query/param;
  `ensure_today` loops SPX/QQQ/IWM (or ensures just the requested one). `/api/journal/upload`
  already has a `symbol` Form param — make `pick_forecast` honor it. All new/changed writes stay
  on the ADR-010 allowlist test.
- **Verify:** open the journal for each symbol; confirm a distinct daily entry per underlying,
  each scored against its own forecast + bars.

## Phase 4 — Paper tickets per underlying

- **`build_tickets(scaffold, ..., underlying="SPX")`** (`paper.py`): the demand/supply logic is
  scaffold-driven and already generic; the SPX/SPY hardcoding is in the translation layer.
  Registry-drive: bar symbol for `_session_range`, proxy symbol + ratio for entry/target/stop/
  strike. For QQQ/IWM ratio=1 (trade the ETF directly), so `to_spy`/`nearest_strike` generalize
  to `to_proxy`/nearest-strike-at-the-ETF's-strike-step.
- **`build_analysis(store, scaffold, underlying)`** and the `/api/paper*` routes take `symbol`;
  `load_spx_playbook(symbol)` selects the right scaffold. `paper_trades.symbol` already exists;
  store the real underlying/proxy.
- **CLI (`paper.py:447`):** add `--symbol` for the nightly settle loop.
- **BREAK_PCT / freshness / trend / OTM** all carry over unchanged (they read the scaffold).
  OTM points-per-underlying: SPX uses SPX points; QQQ/IWM use their own smaller point scale
  (registry) so "25pt OTM" becomes proportional.
- **Verify:** `/api/paper?symbol=QQQ` returns QQQ tickets with QQQ entries/strikes; settle works.

## Phase 5 — Nightly loop

- **`nightly-docker.sh`:** wrap the GEX, playbook, and paper-settle steps in a symbol loop:
  ```
  for SYM in "^SPX:SPX" "QQQ:QQQ" "IWM:IWM"; do
    run "GEX $SYM"      vantage_server.gex --symbol <chain>
    run "playbook $SYM" vantage_server.spx_playbook --symbol <key>
  done
  run "paper settle"    vantage_server.paper --settle   # settles all open, any symbol
  ```
  SPX stays first so its artifacts (and the default views) are unchanged. Keep failures
  per-symbol non-fatal (one bad chain shouldn't abort the night).
- **Verify:** run the nightly once; confirm 3 playbooks + 3 GEX snapshots stored, SPX identical
  to before.

## Phase 6 — Frontend symbol switcher

- **Registry in JS** (small const in `live.js` or a shared module): `["SPX","QQQ","IWM"]`.
- **`getPlaybook/getPaper/getJournal/ensureTodayJournal`** (`live.js`) take a `symbol` arg →
  `?symbol=` query (mirror the existing `getBars(symbol)`/`getAnalysis(symbol)` pattern at
  `live.js:116/140`). Default `"SPX"`.
- **PlaybookView / PaperView / JournalView:** add a `symbol` state + a compact SPX/QQQ/IWM
  segmented toggle at the top of each; pass `symbol` into the fetch and into the `useLive`
  dependency array so switching re-fetches. Journal's ensure-on-mount runs for the selected
  symbol.
- **Labels:** de-hardcode "SPX"/"SPY" copy where it should reflect the selected underlying;
  keep SPX wording when SPX is selected.
- **MCP (`server.py:346`):** `vantage.spx_playbook` gains an optional `symbol` arg (default
  SPX) so the model can read QQQ/IWM playbooks too.
- **Verify (browser):** switch SPX→QQQ→IWM on each page; confirm data changes, SPX view is
  byte-for-byte the current behavior, journal shows the right per-symbol daily entry.

## Phase 7 — NQ/RTY futures projection (derive from QQQ/IWM playbooks)

No new GEX/playbook compute — a thin projection layer. NQ rides QQQ, RTY rides IWM.

- **Ratio:** compute the live futures↔ETF ratio (NQ=F last / QQQ last; RTY=F last / IWM last)
  the same way `paper.spy_price_and_ratio` derives SPX/SPY. Register `NQ→QQQ`, `RTY→IWM` with
  point values already in `futures.py` (`POINT_VALUES = {"NQ":20.0,"MNQ":2.0}`; add RTY/M2K).
- **Projection helper** (in `futures.py` or a small `projection.py`): take the QQQ (or IWM)
  scaffold's `confluence`/`table` levels and multiply prices by the ratio → the same zones in
  NQ (or RTY) points, tagged with their role/kinds/GEX-source. This is display/analysis only.
- **Surface:** show the projected zones on the Futures page as "today's NQ levels (from the
  QQQ 0DTE playbook)" — a forward reference alongside the existing retrospective analysis. No
  orders (ADR-010).
- **Verify:** projected NQ level = QQQ level × ratio; spot-check a wall (e.g. QQQ call wall →
  NQ points) against the live NQ chart.

## Phase 8 — Fix futures playbook-alignment to use the ETF GEX

Correction from exploration: `futures.playbook_alignment` (`futures.py:716`) ALREADY fetches
`NQ=F` bars and computes NQ-native VWAP + fractal S/R — so the price structure is NQ-correct,
not SPX. The real gap is that it uses ONLY pivot/VWAP structure and ignores the **GEX regime**
(walls, gamma flip) that makes the SPX playbook a playbook.

- Feed the **QQQ playbook's GEX levels** (gamma flip, call/put walls), projected to NQ points
  via the Phase 7 ratio, into `playbook_alignment` so an NQ entry is graded with/against the
  actual dealer-gamma regime for the Nasdaq-100 — not just NQ pivots.
- Keep it best-effort (omit the dimension if the QQQ playbook or NQ bars are unavailable —
  never fabricate), matching the current contract.
- **Verify:** an NQ fill near a projected QQQ put wall in a positive-gamma (range) regime grades
  'with' a buy-the-dip; the alignment reason cites the GEX level, not just a pivot.

## Files touched (by phase)

- **db.py / store.py** — schema v9 (`gex_snapshot`, `gex_history`, `spx_playbook` re-keyed;
  journal index), symbol-aware store methods. (P1-P4)
- **gex.py / sentinel_bridge.py** — per-symbol GEX + fallback guard. (P1)
- **spx_playbook.py** — parameterize `build_playbook`, registry, `--symbol`. (P2)
- **journal.py** — per-underlying ensure/score/pick/build. (P3)
- **paper.py** — per-underlying tickets + `--symbol`. (P4)
- **nightly-docker.sh** — symbol loop. (P5)
- **api.py** — `symbol` params on playbook/journal/paper routes; ADR-010 allowlist unchanged. (P2-P4)
- **live.js / playbook.jsx / paper.jsx / journal.jsx / app.jsx** — switcher. (P6)
- **mcp/vantage_mcp/server.py** — `symbol` on `vantage.spx_playbook`. (P6)
- **futures.py (+ src/futures.jsx)** — NQ/RTY projection from QQQ/IWM scaffolds; GEX-aware
  `playbook_alignment`; add RTY/M2K point values. (P7-P8)
- **Tests** — extend `test_gex`, `test_journal`, `test_paper`, `test_api` with QQQ/IWM cases +
  an SPX-unchanged regression per phase.

## Verification (end-to-end, after all phases)

1. **Unit:** each phase's tests pass; a dedicated "SPX output unchanged" regression (same
   scaffold/tickets/journal shape as before this work) guards against regression.
2. **Migration:** point at the real volume DB copy; confirm v8→v9 applies additively, existing
   SPX rows preserved and stamped `symbol='SPX'`.
3. **Nightly:** one full `nightly-docker.sh` run yields 3 playbooks + 3 GEX snapshots; SPX
   identical to a pre-change baseline.
4. **Live/browser:** on the Docker stack, switch SPX/QQQ/IWM on Playbook, Paper, Journal;
   verify zones/tickets/journal populate per underlying, strikes/prices are in the ETF's scale,
   and the ADR-010 mutation-route test still passes.

## Honest scope note

This is a **large, multi-phase refactor** (schema migration + 8 modules + frontend), not a
toggle — because the codebase was built SPX-first with single-underlying storage keys. The
compute math is reusable; the work is threading `symbol` through storage, the playbook builder,
and the UI, plus making price-scale constants relative. Recommend implementing + verifying
**phase by phase** (each phase independently testable, SPX never regressing) rather than one big
change. QQQ/IWM GEX quality depends on yfinance option-chain availability for those ETFs
(generally good, but caveated like SPX's).
