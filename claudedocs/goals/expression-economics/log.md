# Hypothesis log — expression-economics

## E0 baseline
method: derived from H11 (WR 0.4295, ~1:1 debit-spread payoff)
value: EV −0.141 per $ risked. The book agrees (PF 0.72, −$10.9k).

## H1 shares/R expression carries the edge the spread strips (pre-registered BEFORE run)
The signal's validated form is R-multiples (confluence stack +0.59R at
rr2.0). Express each A+ long as shares: entry at scan close, stop at
invalid (1R), exit at zone target — realized R = ±(distance/risk).
prediction: mean realized R ≥ +0.15/trade on the long-only set (n≥300 from
the same sweep), halves same-sign each ≥ half aggregate. Unresolved at
245-bar cap mark at cap close (not excluded — shares have no expiry
convention; conservative mark-to-cap).
decision if CONFIRMED: pipe expression for ict_htf → shares with
stop/target exits (scanner-shares book gains a stop/target exit spec);
spread arming off.

## H2 1R-target spread restores spread EV (pre-registered BEFORE run)
Same race but target at entry+1R (symmetric): a ~1:1 payoff needs
WR > 0.5, and a real edge should tilt the symmetric race.
prediction: first-touch WR(1R vs invalid) ≥ 0.55 → EV ≥ +0.10 per $.
decision if CONFIRMED (and H1 not): short strike moves to ~1R in
spread_from_hit.
tie-break if both confirm: higher EV per unit risk wins; halves stability
breaks remaining ties.
