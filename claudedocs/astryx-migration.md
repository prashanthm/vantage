# Astryx migration — wave log (branch: feat/astryx-migration)

Plan of record: the IA/layout audit artifact (2026-07-24) — strangler
migration, /next/ grows until it IS the app. Guardrails: identity is a theme;
every wave ships working; old route redirects only at parity; real vs paper
never blends; Journal migrates last; lightweight-charts stays.

## W0 — foundations · DONE (41c8a9e)
AppShell + SideNav (Desk/Book/Review) + cmd-K palette + hash router at
/next/. theme-vantage.css: Plex + 12px floor over theme-neutral tokens.
Templates: Workbench / Ledger / Brief (pages never set margins). links.js =
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

## W3 — Book · TODO   ## W4 — Scanner + Daily plan · TODO
## W5 — Journal (last) · TODO   ## W6 — delete vg-*/buildless shell · TODO
