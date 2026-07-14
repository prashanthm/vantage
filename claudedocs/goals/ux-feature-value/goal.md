# Goal: UX evaluation — which Vantage features earn their place?

**Started:** 2026-07-14 · **Status:** ACHIEVED (2026-07-14, 5/5 experiments)

## Outcome

Every top-level Vantage feature (the ~12 SPA views + the surfaces behind
them) carries an evidence-backed verdict — **KEEP / FIX / CUT** — derived
from navigating the live app the way a user actually would, task by task.

## Success predicate

MEASURABLE, checkable at exit:

1. **Coverage:** every nav view + every route reachable from it receives a
   verdict (KEEP / FIX / CUT) with cited evidence. No "TBD".
2. **Grounding:** each verdict cites at least one *observed* datum from
   driving the live UI — a step count, a dead end, an empty state, a
   broken/degraded render, a latency, or a contradiction between two
   surfaces. Opinion without an observation is not a verdict.
3. **Discrimination:** the study must actually discriminate — at least one
   CUT and at least one KEEP, i.e. it cannot conclude "everything is fine"
   (that would mean the instrument failed, not that the app is perfect).
4. **Task success rate is recorded** for each of the 5 user tasks:
   completed unaided / completed with a workaround / failed — measured by
   me driving the real SPA at :8642, not by reading code.

## Baseline (E0)

Inventory + cold-open reality check: enumerate every nav item and route,
then load the live SPA and record what a first-time user sees on each view
(rendered / empty / error / stale). This is the "what exists and does it
even work" floor that later task experiments are measured against.

## Method

Each experiment = ONE realistic user task, driven end-to-end in the real
browser against the live stack (SPA :8642 → backend :8641 → Mira :8080).
Per task I pre-register: the job-to-be-done, the path I *predict* a user
takes, and the predicted friction. Then I walk it and record what actually
happened: steps taken, dead ends, moments where the UI answers the question
vs. makes me go elsewhere.

Evidence is behavioral (what the app did when driven), cross-checked
against usage traces already in the DB (row counts per feature = what has
ever actually been used) as a corroborating, secondary signal.

## Budget

5 experiments (E1–E5), one user task each, after the E0 baseline.

## Constraints

- **Read-only on money.** No live orders. `VANTAGE_LIVE_OK` stays unset;
  execution paths are exercised in dry-run only, never live.
- No production data destruction; the goal must not mutate the portfolio DB
  beyond what a normal user click would (e.g. logging a paper trade is fine,
  deleting rows is not).
- Verdicts may recommend cuts; this goal does not itself delete features.

## The 5 tasks (pre-registered, chosen as the app's actual jobs-to-be-done)

- **E1 — "What do I trade today?"** Cold open → decide today's trade.
- **E2 — "Is a signal firing right now, and do I act?"** Signal → execution.
- **E3 — "How am I doing?"** Performance/track record across paper + live.
- **E4 — "What do I own and what's it doing?"** Portfolio/positions/tax.
- **E5 — "Did the machine work last night?"** Ops/trust: bot + nightly.
