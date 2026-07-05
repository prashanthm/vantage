# Vantage — every account, one view

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

> Prototype disclaimer: simulated data throughout. Nothing here is financial,
> investment, or tax advice, and the app never connects to a broker.
