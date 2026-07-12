# Multi-Currency Accounts + Zerodha (Kite) — Implementation Plan

*2026-07-12 · Status: READY for approval (cross-sum audit folded in).*

## Context

Add a Zerodha (Indian, INR-denominated) account as a **first-class citizen**
without corrupting the existing USD totals. Vantage today has no currency
typing: `value`/`cost`/`unrealized`/`day_pl` are bare floats treated as USD,
formatted with `$`, and **summed across accounts** into portfolio value,
allocation %, and harvestable-loss figures. Mixing INR into those sums is
silently wrong math, not a display bug. The US tax engine (wash-sale §1091,
TLH) encodes US law that doesn't map to Indian CG rules.

## Decisions (settled with user)

- **Never cross-sum currencies.** No single all-accounts number mixes INR +
  USD. "All accounts" shows a **USD subtotal and an INR subtotal, side by
  side, never added.** (⇒ NO FX rate feed, no rate-staleness to manage — this
  simplifies the plan.)
- **Gate off US tax for non-US accounts.** Wash-sale / TLH don't run on
  non-USD (or `jurisdiction != "US"`) accounts; they show "n/a (non-US
  account)". Indian STCG/LTCG is a separate future engine, out of scope.
- **Kite Connect API connector only** (no CSV path). Follows the `schwab.py`
  registered-stub pattern.

## Design seam: ONE chokepoint (audit finding)

The audit found the whole value graph funnels through exactly two functions —
`engine.py:131 lot_value(lot, quotes)` and `engine.py:135 lot_cost(lot)`.
`positions()`, `allocation()`, `account_value()`, `tlh_candidates()`, and every
SPA `.reduce()` are all downstream of those two; none re-derives value. Combined
with the "never cross-sum" decision, this means:

1. **`Account.currency` (default `"USD"`) + `Account.jurisdiction` (default
   `"US"`)** in `models.py:15` and the `db.py` accounts table; `Quote.currency`
   (default `"USD"`) set from the symbol suffix. Defaults ⇒ existing data and
   goldens unchanged.
2. **`lot_currency(lot, accounts)` returns the owning account's currency**, and
   the rollups group value/cost BY that currency. `positions()` total,
   `allocation()`, `account_value()` return a `{currency: subtotal}` map;
   weights/percentages are computed **within** a currency bucket (a
   cross-currency % is meaningless and never computed). A single-currency book
   yields `{"USD": total}` — one key, byte-equivalent to today.
3. **The nine cross-sum sites are NOT edited individually.** Because they all
   compose `lot_value`/`lot_cost`, making the rollup group by currency at the
   two source functions fixes the entire graph — no touching each `sum()`/
   `.reduce()`.
4. **Presentation shows subtotals, never a mixed total.** The SPA all-accounts
   rail and dashboard tiles render per-currency lines ("$376,307 · ₹1,50,000"),
   never added.

No FX conversion, no rate feed (the "never cross-sum" decision removed that
entire subsystem).

## The nine cross-sum sites (audit) — corrected by the seam, not edited

Server: `engine.py:151` account_value · `:250` positions total (→ weights) ·
`:283-288` allocation · `:325` TLH USD-threshold · `api.py:104` /api/accounts
value + `:125` allocation %. SPA: `app.jsx:284` all-accounts rail · `:541-545`
dashboard totalValue/dayPl/unrlPl/harvestableLoss · `:492,505-507` harvest +
drift %. All become currency-grouped via the seam; the SPA renders the
`{ccy: subtotal}` maps as side-by-side lines.

## Phase 1 — Currency typing (models + engine, US-behavior-preserving)

- `models.py`: add `Account.currency: str = "USD"`, `Account.jurisdiction:
  str = "US"`; `Quote.currency: str = "USD"`. `Lot` stays account-keyed
  (currency derived from its account). Store load/save round-trips the fields
  (additive; JSON + SQLite migration, defaults on old rows).
- `engine.py`: `money_by_currency(lots, quotes, accounts)` groups lot value/
  cost/unrealized by the owning account's currency. `positions()` total,
  `allocation()`, per-account value, and TLH loss aggregation route through
  it. Public return shapes gain the currency map; single-currency path returns
  one key (goldens hold — the parity fixtures are all USD).
- **Formatting**: a currency-aware `fmt_money(amount, currency)` (server side
  for any "$" strings; SPA `usd()` → `money(amount, ccy)` rendering ₹ vs $ and
  the Indian lakh grouping). `$` literals become currency-driven.

## Phase 2 — Quotes for Indian symbols

- Symbol convention: an INR account's tickers carry the Yahoo market suffix
  (`RELIANCE.NS` NSE / `.BO` BSE). `quotes.py` `_is_chartable`/`_yf_fetch`
  already pass symbols through to yfinance verbatim — `.NS` works today; the
  fix is (a) not stripping the suffix anywhere, (b) tagging the resulting
  `Quote.currency` from the account, (c) `asset_class` for Indian equities =
  a new `intlEquity`-adjacent bucket or reuse `intlEquity` (decide in review).
- Analyst datasets (relative_strength vs SPY/sector ETFs, growth/expectations
  via yfinance) are **US-benchmark-bound**: gate them to `jurisdiction == "US"`
  OR benchmark Indian names against `^NSEI` (Nifty 50) + an India sector proxy.
  v1: gate off (show "n/a — non-US benchmarks not configured"), like the tax
  gating; India benchmarks are a fast-follow.

## Phase 3 — Gate US tax logic for non-US accounts

- Audit: the ONLY gate today is `Account.taxable` (bool), which conflates
  "tax-advantaged (IRA)" with "US tax rules apply" — exactly the seam that
  breaks. Add `jurisdiction` (or derive `!= "US"` from currency) and guard at
  the TOP of `wash_status` (`engine.py:165`) and `tlh_candidates`
  (`engine.py:293`) — one short-circuit each, not a rewrite: non-US symbols
  return `{status: "na", reason: "non-US jurisdiction"}`. The `threshold_usd`
  comparison (`engine.py:325`) never runs for INR lots as a result.
- MCP tools + REST (`/api/tax/wash`, `/api/tax/tlh`) surface the `na`; the
  advisor/analyze hints already degrade on missing data and report it plainly.
  No Indian tax math in v1 (explicitly deferred).

## Phase 4 — Kite Connect connector (`brokers/zerodha.py`)

Following `brokers/schwab.py`'s registered-stub pattern + `base.BrokerConnection`:

- Dependency: `kiteconnect` (add to server pyproject; it's the official SDK).
- `broker_id = "zerodha"`, `display_name = "Zerodha"`.
- Auth: Kite's api_key + api_secret → daily `request_token` (login URL flow) →
  `access_token`, stored in a chmod-600 token file (env override first,
  mirroring `robinhood_auth`). `interactive_auth()` prints the login URL and
  exchanges the pasted request_token; `auth_status()` reports token validity
  (Kite tokens expire at ~6am IST daily — surface that).
- `fetch_positions(account)` → Kite `holdings()` (long-term) [+ `positions()`
  for intraday if wanted], normalized to the `Position` TypedDict
  ({symbol with .NS suffix, shares, avg_cost, current_price}); INR amounts
  stay INR (the account is INR). Audit note: Kite tradingsymbols are bare
  (`RELIANCE`) — the connector appends `.NS`/`.BO` from the holding's exchange
  field so quotes.py prices them on Yahoo. `Position` TypedDict has no currency
  field; currency comes from the account, so no change needed there.
- Audit note: `importer._to_float` strips `$`/`,`/`%` but not `₹`, and
  `api_cash_lot` mints a `$1`-priced CASH symbol — the Kite path produces INR
  lots directly (no rupee-string parsing) and an INR cash sleeve, sidestepping
  both.
- `fetch_portfolio(account)` → total_value in INR from holdings.
- READ-ONLY allowlist enforced (ADR-010): only `holdings`/`positions`/`profile`
  /`ltp` reachable; any order/mutation method raises `ReadOnlyViolation`. Ship
  the refusal-path unit test (base.py docstring requires it).
- Importer: `zerodha` auto-joins `--broker` choices via the registry; account
  created with `currency="INR"`, `jurisdiction="IN"`.

## Verification

1. Server + MCP + SPA suites green (`VANTAGE_QUOTES=fixture`); the USD parity
   goldens UNCHANGED (proves US behavior byte-preserved).
2. New tests: mixed-currency rollup returns `{USD:…, INR:…}` never summed;
   wash/TLH `na` for an IN account; a `.NS` quote prices and tags INR;
   Kite connector read-only refusal path.
3. Live (needs your Kite api_key/secret + one-time login): import the Zerodha
   holdings, confirm the SPA shows a separate ₹ subtotal that never folds into
   the $ total, and the notebook for an Indian name shows technicals but
   "n/a" for US-tax/US-benchmark sections.

## Risks / open questions (for review)

- **asset_class for Indian equities** — reuse `intlEquity` or add an India
  bucket? (allocation is per-currency anyway, so low stakes.)
- **Kite daily token expiry** — the access token dies ~6am IST; live sync
  needs a daily re-auth. Acceptable for a manual-refresh workflow; note it.
- **India benchmarks (Nifty/sector)** for the analyst datasets — v1 gates
  off; wiring `^NSEI` is the natural fast-follow.
- **kiteconnect dependency** pulls in its own deps — confirm it's acceptable
  in the server image.

## Sequencing
Phase 1 (typing + rollups, US-preserving) → Phase 3 (tax gate — cheap, high
safety) → Phase 2 (Indian quotes) → Phase 4 (Kite connector). Each phase lands
with tests; the USD goldens are the regression backstop throughout.
