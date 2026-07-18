# Portfolio Analyzer — build plan

## Context

Vantage today is a strong **trading/analysis** tool with a portfolio *ledger* attached.
The investor half shows *what you hold* (value, cost, P&L, per-ticker recommendation)
but does little *analysis of the portfolio as a whole*. As a portfolio analyzer it is
essentially: a tax-loss/wash-sale engine + a 4-bucket allocation view + a hardcoded
drift nudge + a per-ticker research notebook.

The classic portfolio-analyzer core is missing: **true diversification (sector/geo +
concentration), returns vs benchmark, configurable rebalancing, income projection,
realized-gains tax, and portfolio-level risk.**

Goal: build these as a coherent **Portfolio Analyzer** surface, reusing existing data
wherever it already lives (sector/beta/dividend-yield per ticker, lots, allocation).

**Load-bearing facts (from inventory):**
- Allocation = 4 fixed asset classes only (`engine.py:325`, `api.py:233`). No sector/geo/concentration.
- **Sector + beta + dividend_yield already fetched per ticker** (`fundamentals.py:27,36`,
  `relative_strength.py:55`) — aggregated NOWHERE at portfolio level.
- Drift = hardcoded global `ALLOCATION_TARGETS 70/10/15/5`, client-side only (`data.js:199`, `app.jsx:649`).
- Tax = wash + TLH only (`api.py:253,273`); NO realized-gains endpoint.
- **No portfolio value-history** — returns/equity-curve need a new table + a nightly snapshot
  (hook: `POST /api/nightly/record` `api.py:1190`; launchd plists in `deploy/`).
- Positions carry `cost / unrealized / weight / lots` (`models.py:77`); `lots` have
  `cost_per_share` + `date` (holding period).

---

## Phase A — Diversification & Concentration (cheapest, highest value)

The data exists; it's an aggregation + a view. Turns the blind 4-bucket allocation into
a real diversification picture.

- **Server**: `GET /api/portfolio/diversification?account=` — weight per **sector**
  (from `fundamentals.sector`), per **asset class** (reuse allocation), plus
  **concentration metrics**: top-5 weight, single-name max, sector max, and **HHI**
  (Σ weightᵢ²) with a plain-English band (diversified / moderate / concentrated).
  Reuse `engine.positions` for weights + `fundamentals` for sector.
- **UI**: a Diversification card on the Dashboard / a Portfolio tab — sector bar,
  concentration flags, "top 5 = X% of the book", the HHI band. Reuse the existing
  allocation legend + `Concentrated` badge styling.
- **Dashboard action**: surface a **concentration alert** in the action queue (today the
  `>7%` badge never becomes an action) — `buildActionQueue` `app.jsx:613`.

**Verify:** sector weights sum to ~100% of equity; a known concentrated book (the Indian
large-caps) shows high HHI + single-name flags; unit test the HHI + top-N math.

## Phase B — Income projection (cheap; data per ticker exists)

- **Server**: `GET /api/portfolio/income?account=` — per-holding `shares ×
  dividend_yield × price` → **projected annual dividend income**, portfolio **yield**,
  **yield-on-cost**, and a per-holding contribution list. Reuse `fundamentals.dividend_yield`
  + positions.
- **UI**: an Income card (projected annual $, portfolio yield %, yield-on-cost, top
  contributors) + optional upcoming ex-div dates (already a per-ticker catalyst).

**Verify:** projected income = Σ(sharesᵢ × yieldᵢ × priceᵢ); yield = income / total value.

## Phase C — Realized gains & investor tax view (medium)

Complements the existing wash/TLH with the investor's realized-tax picture.

- **Server**: `GET /api/tax/gains?account=&year=` — from the imported `history` +
  `lots`, compute **realized gains YTD**, **short-term vs long-term split** (holding
  period from lot `date`), and an **estimated tax** at the user's rate (`settings.taxRate`).
  Reuse `history` rows + lot holding-period logic (`app.jsx:1102` already labels ST/LT).
- **UI**: extend the Tax page — realized YTD, ST/LT breakdown, est. tax owed, alongside
  the existing wash/TLH.

**Verify:** ST/LT split matches lot dates; realized = Σ(sell proceeds − matched cost).

## Phase D — Configurable rebalancing & drift (medium)

Upgrade the hardcoded client-side nudge into a real, per-account, actionable rebalancer.

- **Server**: a small `allocation_targets` store table (per account or global) +
  `GET/POST /api/portfolio/targets`. `GET /api/portfolio/rebalance?account=` returns
  **drift per class/sector vs target** + **specific trade suggestions** ("trim $X of
  tech, add $Y to bonds") — trade math, not prose. Move the drift logic server-side.
- **UI**: a target-editor (set your model) + a Rebalance card with the drift bars and
  suggested trades. Reuse the existing drift chip + `ALLOCATION_TARGETS` as the default.

**Verify:** targets persist per account; suggested trades zero out the largest drifts;
sum of suggested buys ≈ sum of sells (cash-neutral) unless new cash specified.

## Phase E — Returns vs benchmark (heaviest — needs history)

The investor's #1 question, but there's no valued time series today.

- **New**: a `portfolio_value_history` table (date, account, total_value, contributions,
  withdrawals) + a **nightly snapshot** hooked into `POST /api/nightly/record`
  (`api.py:1190`) / the launchd job. Store daily so an equity curve accrues over time.
- **Server**: `GET /api/portfolio/performance?account=&period=` — **time-weighted return**
  (contribution-adjusted) + **money-weighted (IRR)** + **vs a benchmark** (SPX/VTI, using
  the bars already fetched). Honest note: TWR is only meaningful once history accrues.
- **UI**: replace/augment the "Performance" tab (today it's *trade* round-trips) with a
  portfolio equity curve + return vs benchmark. Keep the trade-analytics as a sub-tab.

**Verify:** a hand-computed TWR over a seeded 3-day history matches; benchmark line uses
the same date range; contributions don't inflate return.

## Phase F — Portfolio-level fundamentals & risk roll-up (medium)

- **Server**: `GET /api/portfolio/rollup?account=` — **weighted-average portfolio beta**
  (Σ weightᵢ βᵢ), blended P/E, aggregate growth/expectations, portfolio-wide news
  sentiment. Reuse per-ticker `fundamentals`/`beta`/`relative_strength`/`news`, weight by
  position.
- **UI**: a "Portfolio character" card — your beta (market sensitivity), blended
  valuation, sector tilt vs the market.

**Verify:** portfolio beta = Σ(weightᵢ × betaᵢ); weights sum to 1.

---

## Sequencing & honest scope

- **A → B first** (diversification + income): the data exists, pure aggregation, high
  value, low risk. Ship these and the analyzer already feels real.
- **C, D, F** are medium — new endpoints + a small store table (targets), but bounded.
- **E (returns) is the heaviest** and only becomes truly useful over time (needs history
  to accrue) — do it last, and be honest that day-1 it shows little until the nightly
  snapshot builds a series. Consider seeding from any existing dated data.
- Each phase: one endpoint + one card, browser-verified, unit-tested for the math,
  committed. No phase blocks another except E's history dependency.
- Reuse everywhere: `engine.positions` (weights), `fundamentals` (sector/beta/yield),
  `history`+`lots` (realized/holding-period), the nightly hook, existing card/badge CSS.

## Where it lives (IA)

A **Portfolio** surface (extend the Dashboard, or a dedicated route) that hosts the cards:
Diversification, Income, Tax (realized + wash/TLH), Rebalance, Performance, Character.
The per-ticker Notebook (chart-first) stays the drill-down; this is the roll-up.
