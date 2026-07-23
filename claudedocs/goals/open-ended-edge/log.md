# Hypothesis log — open-ended-edge

Method for every run: `.venv/bin/python -m vantage_server.backtest
--cache backtest_data/bars_multi_frozen.json --params '{...}'` from
`server/`, identical code path, frozen cache. Champion params =
`{"entry_mode":"reclaim","trigger_interval":"5m","confirm_closes":3}`.

## E0 champion re-measure (sanity)
method: champion params, frozen multi-cache.
prediction: reproduces n=34 WR 0.706 PF 2.99 net +4.55% (reclaim-
confirmations E0, same cache; only drift source would be code changes since).

## H1 the open-ended (target=None) class, traded as live trades it, has no edge
prediction (pre-registered): simulated stop-only with EOD mark-to-close —
the live exit policy — the target-less class shows PF < 1.0 and WR < 0.50.
It is the class behind 4 of 5 live post-gate losses; the thesis is that a
reclaim confirmation that fires with NO opposing level above it is late
momentum-chasing, not a level trade.
experiment: harness param `open_ended: "stop_eod"` (additive; default None
keeps today's exclusion) — target-less tickets simulate with stop-or-EOD
exits; report the class SEPARATELY from the with-target population.

## H2 chase cap: voiding fills whose risk ballooned past design risk improves PF
prediction (pre-registered): with `max_chase_risk: 2.0` (void the fill when
|fill−stop| > 2× |level−stop|), the with-target champion population loses
few trades (n −0 to −15%) and PF holds or improves (≥ 2.99); the open-ended
class (if H1 ran it) loses its worst losers. Live evidence: #29's fill risk
was 4.5× design.
experiment: harness param `max_chase_risk: 2.0` on champion params.

## H3 same-side dedup cuts drawdown without hurting PF
prediction (pre-registered): `max_per_side: 1` (existing harness param) —
n drops ~20–40%, PF within ±10% of champion, max drawdown (worst session
net) improves. Live evidence: both loss-pairs were same-side duplicates
filling on the same close.
experiment: champion params + `{"max_per_side": 1}`.

---

# Results (frozen multi-cache; harness extension commit adds `open_ended` +
# `max_chase_risk` params, default-off; E0 re-verified byte-identical after)

## E0  n=25 WR 0.720 PF 3.267 net +3.73%
Drift from the logged 34/0.706/2.99: DIRECTION_GATE=True is now baked into
`paper.build_tickets` (shipped 2026-07-16), so counter-trend tickets never
spawn (by_trend.counter n=0). RE-BASELINED at 25/0.720/3.267. Headline count:
of 248 tickets, **137 (55%) are target-less** — the class live trades and the
harness dropped.

## H1  open-ended class (stop_eod): n=24 WR 0.458 PF 1.593 net +2.37%
verdict: **DISPROVEN** (WR<0.50 held; PF<1 did not — the class is net
POSITIVE under day-scoped exits; 14/24 exits are eod marks). Splits (thin n,
direction only): shorts PF 1.84 (n=16) vs longs 0.90 (n=8); SPX PF 2.69
(n=15), QQQ 0.98, IWM n=1. NOT an uptrend-long artifact.

## H2  chase cap: DISPROVEN with monotone dose-response
k=2.0 → n 19 WR 0.684 PF 2.227 (champion 3.267 — cap removed winners);
k=1.5 → n 11 PF 0.813; k=3.0 → never binds (identical to champion). Same
mechanism as the rejected volume gate: fills that ran are fills that WORKED.
Live #29's 4.5× chase was real but not representative.

## H3  max_per_side=1: n 19 WR 0.632 PF 1.961 net +1.58
verdict: **DISPROVEN** (PF −40%, far outside the ±10% bar — the duplicate
zone tickets are net winners on tape; drawdown check moot).

## H4 (added) open-ended class with trailing exits instead of stop_eod
prediction: none pre-registered (exploratory rescue check).
result: class n=24 WR 0.417 **PF 0.649** net −1.12% (20/24 trail exits) —
trailing chops the eod riders. stop_eod is the class's only positive exit.

## H5 (added) live counterfactual — EOD close on the 4 live open-ended losses
#28 −494→−161 · #29 −684→−161 · #83 −265→−265 (same-day stop) ·
#84 −515→−350. **Total −$1,958 → −$937.** Overnight holding ~doubled the
losses, and it is exactly the behavior no validated number ever measured
(the harness marks every trade at session close).

# Decision (predicate met)

All three pre-registered guards DISPROVEN — nothing to gate. The confirmed
divergence is the EXIT: every validated number (champion 3.267 AND class
1.59) assumes day-scoped exits; live rode overnight. **Shipped: reclaim-book
paper trades close at the fill day's last bar (`exit_reason="eod"`) when
neither target nor stop hits** — `paper._settle_one` + tests. Target-less
tickets stay tradable (H1: they carry edge under this exit; voiding them
would discard PF 1.59 flow and 55% of tickets).

Counts: 0 confirmed of 3 pre-registered (all disproven) · 2 added
measurements drove the decision. Most valuable disproof: the chase cap —
the intuitive fix for the ugliest live loss would have cut champion PF by a
third. Caveats: single 60-day window (net uptrend); class side/underlying
splits are n≤16 — no side/underlying gates justified; overnight gap risk is
UNMEASURED by the harness (one more reason the eod exit is the only honest
policy). Re-freeze and re-run quarterly.

**Status: ACHIEVED** — 8 runs of 10 budgeted (E0×2 incl. invariance check,
H1, H2×3, H3, H4) + 1 counterfactual.

## Addendum (2026-07-24) — 15:45 cutoff, split by class
Operator asked for a flat-by-15:45 close. Measured on the frozen tape
(harness param `eod_cutoff`, additive):
- with-target: WR 0.72→0.64, PF 3.267→2.792, net 3.73→3.23% — the last
  15 minutes carries real winner drift; cutoff REJECTED for this class.
- open-ended: WR 0.458→0.50, PF 1.593→1.657, net 2.37→2.45% — runners
  have no take-profit; clipping the noisy tail HELPS. Cutoff ADOPTED.
Decision (operator): open-ended trades flat by 15:45 ET (`_settle_one`,
first bar stamped ≥15:45 closes at the prior bar = the 15:45 mark; fills
inside the final 15 min mark at entry); with-target trades keep the
last-bar close. Caveat: the tape prices idealized bar-close fills — real
15:45–16:00 fill quality (MOC, spreads) is unmeasured either way.
