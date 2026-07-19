# Portfolio Analyzer v2 — currency-correct, insight-and-action driven

## STATUS: SHIPPED (2026-07-18)

Decisions: per-currency (no FX), account+currency filters, one big build.
Built & browser-verified end-to-end on the real mixed INR+USD book:
- portfolio.py: currency-scoped diversification/income/character + winners_losers
  (gain %) + risk (Sharpe/vol/Sortino/drawdown, data-gated) + by_account + snapshot
  DNA composer. USD book = $433K, INR = ₹3.62M — proven never cross-summed.
- API: /api/portfolio/analyze?currency= + new /api/portfolio/snapshot.
- MCP: vantage.portfolio_snapshot tool (the DNA).
- Mira: portfolio_analyst specialist → health read + recommended ACTIONS (donext),
  INR and USD as separate books, actions cited & sized.
- SPA: currency toggle + Winners/Risk/ByAccount cards + Mira "Analyze my portfolio".
- Bonus fix: model_adapter sanitizes dotted MCP tool names (was 400-ing every
  vantage specialist on DeepSeek). Branches: vantage feat/portfolio-v2,
  mira feat/portfolio-analyst. Not yet merged to main.

## The principle (yours)

> Any feature without insights and actions is not worthwhile.

What I shipped (v1) is **descriptive** — sector bars, income $, beta. It states numbers
but doesn't tell you what to DO, and (worse) it's **wrong on a mixed-currency book**.
v2 makes every card end in an **insight + a recommended action**, and adds a **Mira
portfolio analyst** that reasons over the whole "portfolio DNA" and returns actions.

## The correctness bug to fix FIRST (headline)

The book is mixed-currency (INR .BO/.NS + USD). The engine's cardinal rule is
`value_by_currency` — **"NEVER add across currencies"** (`engine.py:152`). Weights are
computed **per-currency-scope** (`engine.py:314`). But v1's analyzer **summed native
`value` across all holdings** — so diversification, concentration (HHI), income, and
character are computed on ₹1.6M + $44K as if the same unit. **They are wrong.**

There is **no FX conversion in the app today** — currencies are kept native and shown
side-by-side. So v2 must either (a) add an FX rate source and convert to a base currency
for a true single-portfolio view, or (b) analyze per-currency and never cross-sum. Real
portfolio analysis needs ONE normalized view → **(a): add FX, convert to a base currency**.

---

## Phase 1 — Currency correctness: analyze PER CURRENCY (no FX) + filters

DECISION: per-currency (no FX conversion). Respects the engine's "never cross-sum"
rule. The analyzer computes diversification/income/concentration/character **within
each currency bucket**, never combining INR + USD. The UI gets **account + currency
filter toggles** so you scope to (e.g.) "USD only" or "Zerodha".

- Fix `portfolio.py`: every metric takes a currency filter; weights are % of the
  filtered scope's own-currency total (mirror `engine.value_by_currency`).
- Endpoint `/api/portfolio/analyze?account=&currency=` — `currency` filters to one
  bucket (or "all" → the dominant/each-bucket view).
- UI: a currency toggle + account toggle on the Portfolio section; each card computed
  within the chosen scope.

**Insight+action:** "62% of your book is INR (single-currency exposure) — the USD sleeve
is only 12%." **Verify:** weights within a currency sum to 100%; INR and USD never mix.

## Phase 2 — Per-account & per-currency dimensions

- The `account` param already scopes everything (`check_account`, `ds.accounts`); the
  analyze endpoint already takes `account`. Add **per-account breakdown** (each
  account's value, allocation, gain, currency) and a **by-account concentration**
  ("78% of the book is in one account / one broker").
- Account metadata exists: taxable, type, jurisdiction, currency (`accounts` table).

**Insight+action:** "Zerodha holds 68% of assets — single-broker concentration risk."
"Your taxable account has the biggest unrealized gain — harvest-aware before selling."

## Phase 3 — Winners / losers (gain %, not just $)

- Positions carry `unrealized` ($) but **no gain %**. Add `gain_pct = unrealized/cost`
  per holding (base-currency). Rank **top/bottom N by % and by $**.

**Insight+action:** "Top winner NVDA +180% ($X) — trim to lock gains / it's now 38% of
the book (concentration)." "Worst loser SQQQ −34% — TLH-clear, harvest $Y."
(Ties into the existing TLH engine.)

## Phase 4 — Risk: volatility, Sharpe, drawdown

- Bars exist per holding (`load_bars` daily, `load_intraday_bars_range`). Compute a
  **daily return series** per holding → portfolio return series (weighted) →
  **annualized volatility, Sharpe (excess/vol), Sortino, max drawdown**. Portfolio beta
  already exists (weighted). Data-gated: only holdings with stored bars (the Load-data
  path seeds them; surface coverage honestly).

**Insight+action:** "Sharpe 0.4 — return isn't compensating for the risk; your vol is
driven by SOXS/SQQQ (leveraged). Trimming them raises Sharpe to ~0.7." "Max drawdown
−22% concentrated in tech."

## Phase 5 — Mira Portfolio Analyst (the actions brain)

This is the "Mira takes the portfolio DNA → recommended actions" piece. Same pattern as
`journal_analyst` / `forecast_analyst`.

- **New vantage MCP tool** `vantage.portfolio_snapshot(account)` — bundles the "portfolio
  DNA": positions (base-ccy, gain%), allocation, diversification/concentration, income,
  risk (vol/Sharpe/drawdown), per-account/currency, realized gains, drift-vs-target.
  (Compose the v1 analyzer + Phases 1–4.) Read-only, `mcp/vantage_mcp/server.py`.
- **New specialist** `portfolio_analyst.py` (mira) — card + `_infer_portfolio` that
  fetches `vantage.portfolio_snapshot` from a `PORTFOLIO_SNAPSHOT_REF account=...`
  marker; a `synthesis_hint` that reasons like a portfolio analyst and returns:
  (A) human sections (health read, key risks) + (B) a structured `actions` array —
  `[{action: "trim"|"harvest"|"rebalance"|"hedge"|"diversify", symbol?, rationale,
  size?}]` Vantage renders as an action list. Register in `demo.py`.
- **SPA**: the Portfolio section's right pane = the Mira portfolio read (like Mira-on-
  chart), streaming the analyst's actions. A "Analyze my portfolio" button →
  `streamTurn("...PORTFOLIO_SNAPSHOT_REF account=all")`.

**Insight+action:** the WHOLE point — Mira reads the DNA and says "1) Trim NVDA (38% →
target 15%), 2) Harvest SQQQ loss ($Y tax benefit), 3) You're 62% INR — add USD
exposure, 4) Sharpe is low ∵ leveraged ETFs — replace with broad-index." Each is a
concrete, sized, rationaled action.

## Phase 6 — Rewire v1 cards to end in an action

Every existing card gets an insight line + an action chip:
- Diversification → "concentrated (HHI) — top action: trim {name}"
- Income → "yield 2.6% — {N} non-payers dragging it; …"
- Rebalance → already has trade suggestions ✓ (make them one-click intents later)
- Character → "beta 0.9 defensive / P/E rich — …"
- Realized gains → "harvest {loser} to offset {gain}"

---

## Sequencing (analyst priority)

1. **Phase 1 (currency)** — correctness first; everything downstream is wrong without it.
2. **Phase 3 (winners/losers) + Phase 6 (actions on cards)** — cheap, high-insight.
3. **Phase 2 (per-account/currency)** — cheap, real concentration insight.
4. **Phase 5 (Mira analyst)** — the headline "actions brain"; needs the DNA tool (which
   Phases 1–3 build). This is where "insights + actions" fully lands.
5. **Phase 4 (Sharpe/risk)** — most compute, data-gated; do after the DNA tool so it
   flows into Mira too.

## Reuse
- `engine.value_by_currency` (the never-cross-sum primitive), `fundamentals` (sector/
  beta/yield, cached), `load_bars` (return series), `tlh_candidates` (harvest actions),
  the `journal_analyst` specialist template, `vantage.positions/allocation` MCP tools,
  `streamTurn` + the `*_SNAPSHOT_REF` marker pattern, existing card/badge/StatTile CSS.

## Honest caveats
- FX adds a data dependency (rates can be stale/unavailable — degrade gracefully).
- Sharpe/vol only for holdings with stored bars — surface coverage %, never fabricate.
- Mira actions are decision-SUPPORT, educational, not orders (ADR-010) — no execution.
