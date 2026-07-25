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

## H1/H2 VERDICTS (run 2026-07-25, research/ict_expression_sweep.py)
n=935 long-only armed setups, span 2023-09 → 2026-07.
H1 shares/R at scan-close entry: mean +0.093R (bar ≥ +0.15), halves
0.148 / 0.038 (B below half-aggregate) → **DISPROVEN**.
H2 1R-target spread race: WR 0.5118 (bar ≥ 0.55), halves 0.522/0.501 →
**DISPROVEN** — a coin flip, EV ≈ +0.02 at 1:1.
Lesson: arming at SCAN CLOSE (price already away from the gap) is not the
validated expression — C13 measured entry AT the FVG CE with the tight
far-edge stop. The chase erodes the R geometry the edge lives in.

## H3 resting entry at the CE recovers the validated geometry (pre-registered BEFORE run)
Expression: on an A+ long, rest a limit at the setup's CE (entry_zone
midpoint the card already shows); fill only if price returns within 24
hourly bars; stop = the detector's invalid (FVG-far-edge based); target =
entry + 2.0× risk (the C13 rr2.0 frame); first-touch race, stop-first,
245-bar cap from fill; unfilled = no trade (recorded as fill-rate).
prediction: fill-rate 0.4–0.7; on FILLED trades mean R ≥ +0.20 (C13
showed +0.59R on SPX hourly; predict decay on the 60-name universe but
clearing the ship bar), halves same-sign each ≥ half aggregate, n ≥ 250.
decision if CONFIRMED: pipe expression → resting SHARES entry at CE with
stop/target exits via Alpaca paper equity orders (submit_paper_equity
exists); spread arming off. If DISPROVEN too → fail-all clause: ict_htf
auto-arming OFF (display-only), per the goal contract.
