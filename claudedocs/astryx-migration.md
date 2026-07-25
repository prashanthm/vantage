# Astryx migration — wave log (branch: feat/astryx-migration)

Plan of record: the IA/layout audit artifact (2026-07-24) — strangler
migration, /next/ grows until it IS the app. Guardrails: identity is a theme;
every wave ships working; old route redirects only at parity; real vs paper
never blends; Journal migrates last; lightweight-charts stays.

## W0 — foundations · DONE (41c8a9e)
AppShell + SideNav (Desk/Book/Review) + cmd-K palette + hash router at
/next/. theme-vantage.css: Plex + 12px floor over theme-neutral tokens.
Templates: Workbench / Ledger / Brief (pages never set margins).
SPACE RULE (operator, 2026-07-24): use the width — parallel content sits
side by side via .vg-cols/.vg-cols.wide (auto-fit, no media queries); data
tables get .vg-dense. A single narrow column on a wide desk is a defect. links.js =
the link contract (canonical href builders; flip in place as pages migrate).
Cockpit ported onto Workbench (identity gate PASSED — verified in browser).
Deploy fix: fonts/ was never in the SPA image (all Plex 404'd silently).

## W1 — Performance · DONE (this commit)
New in-shell page: Real | Paper segmented tabs.
Real: last-14-session day P&L (journal/day-pnl) + swing roundtrips
(ml/roundtrips). Paper: by-strategy (incl. Taken-live bridge + manual tags)
+ scanner/reclaim book stats. Verified in browser, both tabs, live data.
PARITY GAP (deliberate, no redirect yet): ml/trade_stats condition buckets
(legacy #/trades) and full open/closed paper position lists + equity curves
(legacy Strategies/paper) are linked, not ported. Port before redirecting
those routes.

## W2 — kill the zombie cockpits · DONE (this commit)
TodayView DELETED (593 lines). Its unique surfaces survived the page:
ToneCompareCard -> src/tone_card.jsx (cockpit + journal import it);
SignalsCard/SignalRow/StrategyCard/MachineCard -> src/ops_cards.jsx,
rendered by CockpitView's new OpsBlock (signals -> TicketModal execute path
preserved, edge guard intact). #/today redirects to #/home/cockpit in the
hash parser. cockpit-astryx/ DELETED — /cockpit/ 301s to /next/#/cockpit
(nginx); Dockerfile no longer ships it. Browser-verified: redirect lands on
the cockpit face, OpsBlock shows the armed SPY signal, /cockpit 301,
legacy shell healthy. Two of three cockpits are gone; /next/ is the third.

## W3 — Book · DONE (this commit)
In-shell Book page (Ledger template): Positions tab = THE canon holdings
table (all accounts, currency-correct per row, weight flags, chart links
per the contract); Analyzer tab = per-currency roll-up (sector
concentration chips + winners/losers from portfolio/snapshot). Band: total
(USD base) + USD-book day move + Real-style segmented control. Verified in
browser both tabs. PARITY GAP before redirecting #/holdings + #/portfolio:
lots/tax detail, account filter, and the analyzer's action recommendations
stay legacy (linked from the page).

## W4a — Scanner · DONE (this commit)
In-shell Scanner (Ledger template): strategy SegmentedControl (3 families),
coverage/freshness line, background refresh with 5s polling, watch-ticker
add/remove chips, A+/B tier groups (full exit-ladder rungs on cards),
history with ticker/tier/side/outcome filters + expandable rows. Every
symbol chart-linked. vg-cols grid = 4 cards across on a wide desk.
Verified: ict_htf + rsi2_mr live data, strategy switch, filters render.
Nav flipped to page; legacy #/scanner stays routable (redirect at W6).

## W4b — Daily plan · DONE (this commit)
In-shell plan page: regime banner (CALM/AMPLIFY plain narrative), symbol
segmented control (SPX/QQQ/IWM), spot/VIX/gamma tiles, Refresh-plan POST,
the two trigger scenarios side by side, the computed level ladder
(chart-linked, dense) beside market context + caveats. PARITY GAP before
#/playbook redirect: pine export + ticket staging (legacy-linked).

Waves remaining: W5 Journal (LAST, feature-freeze during) · W6 delete
vg-*/buildless shell + flip all legacy redirects at parity.
## W5 — Journal (last) · TODO   ## W6 — delete vg-*/buildless shell · TODO
