"""Replay Forecast — step a chosen day (any ticker) at a selectable interval and
grade the resulting sequence of forecasts.

This module is PURE, DETERMINISTIC store computation — no Mira, no network I/O
beyond an on-demand 1m prime. It gives the API three deterministic building
blocks that keep the Mira-free-backend invariant intact:

  - ``prime_day``    : seed one day's 1m bars for a symbol if they aren't stored
                       (reuses the same yfinance path as the nightly seed).
  - ``replay_steps`` : the ordered as_of grid for a session — one snapshot point
                       every ``step_min`` minutes, each SNAPPED to the nearest
                       stored 1m bar at-or-before it (so the SPA forecasts against
                       real bars, exactly what ``build_snapshot`` truncates to).
                       ET/DST comes from the bars' own timezone — never hardcoded.
  - ``gather_grade_bundle`` : the graded run bundle — every forecast of a run WITH
                       its CODE-computed accuracy score, plus deterministic
                       hit-rates bucketed by time-of-day / bias / tier. These
                       numbers are what the LLM grader NARRATES; it never computes
                       or invents them (the anti-reward-hacking guarantee).

Ticker-agnostic: ``symbol`` is a parameter (default SPX). The honest reach limit
is the 1m data window — yfinance serves 1m history only ~30 days back, so days
older than that can't be primed and ``prime_day`` reports it rather than failing
silently.
"""
from __future__ import annotations

import datetime as _dt

from . import seed_intraday as _seed
from . import spx_snapshot as _snap

#: RTH / pre-market bounds in ET minutes-of-day.
_ET_OPEN = 9 * 60 + 30       # 09:30
_ET_CLOSE = 16 * 60          # 16:00
_ET_PREMARKET = 8 * 60       # 08:00 (pre-market start when premarket=True)

#: min scored forecasts a bucket needs before we report its rate (else "insufficient
#: sample" — never a fabricated hit-rate from one or two data points).
_MIN_BUCKET_N = 3


def bar_sym_for(symbol: str) -> str:
    """The stored-bar symbol for an underlying (SPX is kept under ^GSPC)."""
    sym = (symbol or "SPX").upper()
    return "^GSPC" if sym == "SPX" else sym


def prime_day(store, symbol: str, day: str) -> dict:
    """Ensure the day's 1m bars for ``symbol`` are stored; fetch them if missing.

    Returns ``{available, primed, note?}``. ``available`` is False (with a note)
    when the day is out of the ~30-day 1m window and yfinance returns nothing —
    the caller surfaces that instead of failing silently. Idempotent: a day
    already stored is left as-is (``primed=False, available=True``)."""
    if not getattr(store, "uses_sqlite", False):
        return {"available": False, "primed": False,
                "note": "replay needs the SQLite backend"}
    bar_sym = bar_sym_for(symbol)
    if store.load_intraday_bars(bar_sym, day, "1m"):
        return {"available": True, "primed": False}
    ohlc = _seed._rth_1m(bar_sym, day)
    if not ohlc or not ohlc.get("ts"):
        return {"available": False, "primed": False,
                "note": (f"No 1m bars available for {symbol} on {day}. yfinance "
                         "serves 1-minute history only ~30 days back, so older "
                         "days can't be replayed at 1m resolution.")}
    store.save_intraday_bars(bar_sym, day, "1m", ohlc)
    return {"available": True, "primed": True}


def _minute_of_day(iso_ts: str) -> int:
    """ET minutes-of-day for a stored bar timestamp (the ts already carries the
    session's ET tz, so wall-clock hour/minute is the ET time — no conversion)."""
    t = _dt.datetime.fromisoformat(iso_ts)
    return t.hour * 60 + t.minute


def replay_steps(store, day: str, symbol: str = "SPX", *,
                 premarket: bool = False, step_min: int = 15) -> list[dict]:
    """The ordered as_of grid for one session: a step every ``step_min`` minutes
    from the session start to the close, each snapped to the nearest STORED 1m bar
    at-or-before the grid time. Returns ``[{as_of, price_at, minute_of_day}]`` in
    chronological order. Grid points with no bar at-or-before them are dropped
    (sparse pre-market, gaps). Empty when the day has no stored 1m bars.

    DST-safe: the grid is expressed in ET minutes-of-day read from the bars' own
    timestamps, so it tracks whichever ET offset the session actually used."""
    bar_sym = bar_sym_for(symbol)
    ohlc = store.load_intraday_bars(bar_sym, day, "1m")
    if not ohlc or not ohlc.get("ts"):
        return []
    ts, cl = ohlc["ts"], ohlc["close"]
    # (minute_of_day, index) for every bar, in order
    mins = [_minute_of_day(t) for t in ts]
    start = _ET_PREMARKET if premarket else _ET_OPEN
    step = max(1, int(step_min))

    steps: list[dict] = []
    last_idx = None
    grid_min = start
    while grid_min <= _ET_CLOSE:
        # the last bar whose minute-of-day is <= this grid minute (snap back)
        snap_idx = None
        for k, m in enumerate(mins):
            if m <= grid_min:
                snap_idx = k
            else:
                break
        if snap_idx is not None and snap_idx != last_idx:
            steps.append({
                "as_of": ts[snap_idx],
                "price_at": round(float(cl[snap_idx]), 2),
                "minute_of_day": mins[snap_idx],
            })
            last_idx = snap_idx
        grid_min += step
    return steps


def _time_bucket(minute_of_day: int | None) -> str:
    """Coarse session bucket for a forecast's as_of — the time-of-day dimension
    the calibration reports hit-rate by."""
    if minute_of_day is None:
        return "unknown"
    if minute_of_day < _ET_OPEN:
        return "premarket"
    if minute_of_day < 11 * 60:
        return "open (09:30-11:00)"
    if minute_of_day < 14 * 60:
        return "midday (11:00-14:00)"
    return "close (14:00-16:00)"


def _forecast_bias(row: dict) -> str:
    """The forecast's called bias (from the structured plot), lowercased."""
    fc = row.get("forecast") or {}
    plot = fc.get("plot") if isinstance(fc, dict) else None
    bias = (plot or {}).get("bias") if isinstance(plot, dict) else None
    if not bias:
        bias = fc.get("bias") if isinstance(fc, dict) else None
    return str(bias or "unknown").lower()


def _forecast_tier(row: dict) -> str:
    """The hourly-setup tier present in the snapshot at forecast time (A+/B/none)
    — the ict_htf heads-up dimension the calibration reports hit-rate by."""
    snap = row.get("snapshot") or {}
    htf = snap.get("ict_htf") if isinstance(snap, dict) else None
    if not isinstance(htf, dict) or not htf.get("present"):
        return "none"
    return str(htf.get("tier") or "present")


def _hit(score: dict | None) -> bool | None:
    """Did the forecast RESOLVE correctly? A directional, immutable read of the
    code score: target reached → hit; invalidated or direction-wrong → miss;
    inconclusive/too-early → None (excluded from the rate). Never inflates."""
    if not score:
        return None
    verdict = str(score.get("verdict") or "")
    if verdict in ("hit target", "direction correct"):
        return True
    if verdict in ("invalidated", "direction wrong"):
        return False
    return None


def _rate(rows: list[dict]) -> dict:
    """Hit-rate over scored forecasts, with provenance gating: a bucket under the
    minimum sample reports ``insufficient=True`` and NO rate (never a fabricated
    number from one or two points)."""
    hits = [_hit(r.get("score")) for r in rows]
    resolved = [h for h in hits if h is not None]
    n = len(resolved)
    if n < _MIN_BUCKET_N:
        return {"n": n, "insufficient": True}
    wins = sum(1 for h in resolved if h)
    return {"n": n, "wins": wins, "hit_rate": round(wins / n, 3)}


# ── continuous accuracy: how far the predicted target/path was from reality ──
# The verdict scorer is binary (hit/miss). These metrics measure the DISTANCE
# between the prediction and where price actually went — "how close to reality",
# the thing the Replay chart shows and the forecast-accuracy goal optimizes.
# Deterministic and offline: computed from the persisted forecast + score fields
# (target/price_at/post_high/post_low), no LLM.

def _plot(row: dict) -> dict:
    fc = row.get("forecast") or {}
    p = fc.get("plot") if isinstance(fc, dict) else None
    return p if isinstance(p, dict) else {}


def target_error(row: dict) -> float | None:
    """ONE-SIDED direction-aware target error (points): the UNDERSHOOT only.

    The predicted `target` sits on one side of `price_at`; the realized excursion is
    the tape's best travel toward it (an up-call's high / a down-call's low). If the
    excursion REACHED the target (or ran past it — overshoot), the call was right and
    the error is **0**: a conservative target that price exceeds is not a forecasting
    failure. Only when price fell SHORT of the target does the shortfall count.

    This corrects the original two-sided |target − excursion|, which wrongly punished
    a reached-then-exceeded target the same as one never reached — and thereby rewarded
    over-ambitious targets (goal: forecast-accuracy, C1 finding). None when the
    forecast can't be measured (no target/price_at, or unscored → no post_high/low)."""
    plot = _plot(row)
    fc = row.get("forecast") or {}
    target = _snap._first_price(plot.get("target") if plot.get("target") is not None
                                else (fc.get("target") if isinstance(fc, dict) else None))
    price_at = _snap._num(row.get("price_at"))
    sc = row.get("score") or {}
    post_high = _snap._num(sc.get("post_high"))
    post_low = _snap._num(sc.get("post_low"))
    if target is None or price_at is None or post_high is None or post_low is None:
        return None
    if target >= price_at:
        # up-call: reached if the high got to the target; shortfall = target − high
        return round(max(0.0, target - post_high), 2)
    # down-call: reached if the low got to the target; shortfall = low − target
    return round(max(0.0, post_low - target), 2)


def path_mae(row: dict, store) -> float | None:
    """Mean absolute distance (points) between the predicted PATH steps and the
    realized close at each step's projected time — the "does the shape track"
    metric. Recomputes from 1m bars: the path steps are evenly projected forward
    from ``as_of`` over the session, and each step price is compared to the actual
    close nearest that projected time. None when there's no path or no bars.

    Cheap and deterministic (reads stored 1m bars, no LLM). Complements
    ``target_error`` (endpoint) with a shape read."""
    plot = _plot(row)
    path = plot.get("path") if isinstance(plot.get("path"), list) else None
    as_of = row.get("as_of")
    day = row.get("day")
    sym = (row.get("symbol") or "SPX").upper()
    if not path or not as_of or not day:
        return None
    steps = [_snap._num(s.get("price")) for s in path if isinstance(s, dict)]
    steps = [s for s in steps if s is not None]
    if not steps:
        return None
    bar_sym = bar_sym_for(sym)
    ohlc = (store.load_intraday_bars_since(bar_sym, day, "1m")
            or store.load_intraday_bars(bar_sym, day, "1m"))
    if not ohlc or not ohlc.get("ts"):
        return None
    ts, cl = ohlc["ts"], ohlc["close"]
    fut = [k for k, t in enumerate(ts) if t > as_of]
    if not fut:
        return None
    # project the N path steps evenly across the remaining future bars, and compare
    # each step price to the actual close at that projected bar.
    errs = []
    n = len(steps)
    for i, sp in enumerate(steps):
        frac = (i + 1) / n
        idx = fut[min(len(fut) - 1, int(round(frac * (len(fut) - 1))))]
        errs.append(abs(sp - cl[idx]))
    return round(sum(errs) / len(errs), 2) if errs else None


def _median(vals: list[float]) -> float | None:
    xs = sorted(v for v in vals if v is not None)
    if not xs:
        return None
    m = len(xs) // 2
    return round((xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2), 2)


def error_stats(rows: list[dict], store=None) -> dict:
    """Aggregate continuous-error stats over resolved forecasts: median + mean abs
    target-error (the headline), and (when a store is given) median path-MAE. Only
    forecasts that HAVE a score are counted (same universe as the hit-rate), so
    the two metrics are comparable. Median is the headline (robust to a single
    wild day); mean is reported alongside so outlier-domination is visible."""
    te = [target_error(r) for r in rows if r.get("score")]
    te = [x for x in te if x is not None]
    out = {
        "n": len(te),
        "median_abs_target_error_pts": _median(te),
        "mean_abs_target_error_pts": round(sum(te) / len(te), 2) if te else None,
    }
    if store is not None:
        pm = [path_mae(r, store) for r in rows if r.get("score")]
        pm = [x for x in pm if x is not None]
        out["median_path_mae_pts"] = _median(pm)
        out["n_path"] = len(pm)
    return out


def calibration_scores(rows: list[dict], store=None) -> dict:
    """The DETERMINISTIC, code-computed calibration for a graded run — overall
    hit-rate plus hit-rate bucketed by time-of-day, called bias, and hourly tier,
    PLUS the continuous target-error stats (``error``). Every number here is
    computed from the persisted ``score`` fields; the LLM grader only reads and
    narrates these, never recomputes them. ``store`` (optional) enables path-MAE."""
    def _by(keyfn) -> dict:
        groups: dict[str, list[dict]] = {}
        for r in rows:
            groups.setdefault(keyfn(r), []).append(r)
        return {k: _rate(v) for k, v in sorted(groups.items())}

    return {
        "overall": _rate(rows),
        "by_time": _by(lambda r: _time_bucket(_minute_of_day(r.get("as_of"))
                                              if r.get("as_of") else None)),
        "by_bias": _by(_forecast_bias),
        "by_tier": _by(_forecast_tier),
        "error": error_stats(rows, store),   # continuous accuracy (target-error/path-MAE)
    }


def gather_grade_bundle(store, run_id: str) -> dict | None:
    """The graded-run bundle the grader reads: every forecast of ``run_id`` WITH
    its code score, the deterministic calibration scores, the prior calibration
    (for compounding commentary), and a compact per-step digest for the prompt.

    Returns None when the run has no forecasts. The scores here are authoritative
    and code-computed — the grader NARRATES them, never produces them."""
    rows = store.list_spx_forecasts_by_run(run_id)
    if not rows:
        return None
    day = rows[0].get("day")
    underlying = (rows[0].get("symbol") or "SPX").upper()
    scores = calibration_scores(rows)

    steps = []
    for r in rows:
        fc = r.get("forecast") or {}
        plot = fc.get("plot") if isinstance(fc, dict) else None
        plot = plot if isinstance(plot, dict) else {}
        sc = r.get("score") or {}
        steps.append({
            "id": r.get("id"),
            "as_of": r.get("as_of"),
            "time_bucket": _time_bucket(_minute_of_day(r["as_of"]) if r.get("as_of") else None),
            "price_at": r.get("price_at"),
            "bias": _forecast_bias(r),
            "target": plot.get("target"),
            "invalidation": plot.get("invalidation"),
            "tier": _forecast_tier(r),
            "verdict": sc.get("verdict"),
            "moved_pt": sc.get("moved_pt"),
            "hit": _hit(sc),
        })

    prior = None
    if getattr(store, "uses_sqlite", False):
        # the latest calibration generated before this run's own (so a re-grade
        # doesn't read itself); None when this is the first ever grade.
        own = store.load_spx_calibration_by_run(run_id)
        before = own.get("generated_at") if own else None
        prior = store.load_latest_spx_calibration(before=before, underlying=underlying)

    n_resolved = scores["overall"].get("n", 0)
    return {
        "run_id": run_id,
        "day": day,
        "underlying": underlying,
        "n_forecasts": len(rows),
        "n_scored": n_resolved,
        "scores": scores,          # CODE-COMPUTED — the grader echoes these
        "steps": steps,            # per-forecast digest for the prompt
        "prior": prior,            # prior calibration (compounding), may be None
    }


def build_grade_prompt(bundle: dict) -> str:
    """The grader preamble: the deterministic scores + the per-step digest, with
    the hard clause that the model READS the numbers and never computes them —
    the structural guard against reward-hacking. The Mira forecast_grader appends
    its A2UI contract to this."""
    import json
    b = bundle
    prior = b.get("prior")
    if prior:
        prior_line = (
            f"\nPRIOR CALIBRATION (run {prior.get('run_id')}, {prior.get('day')}): "
            f"scores {json.dumps(prior.get('scores'))}. BUILD ON IT — say what "
            f"changed and whether the analyst's calibration is improving.\n")
    else:
        prior_line = "\nNo prior calibration — this is the baseline.\n"
    return (
        "You are grading a REPLAY FORECAST run: the forecast-analyst was asked 'what "
        f"will price do?' at each interval step through {b['underlying']} on "
        f"{b['day']} ({b['n_forecasts']} forecasts, {b['n_scored']} resolved). "
        "Your job is to grade how the analyst's read EVOLVED as the tape "
        "developed — was it early, late, whipsawed, or well-adapted?\n"
        f"{prior_line}"
        "\nSCORES — ALREADY COMPUTED IN CODE. Read and narrate them; NEVER "
        "compute, alter, or invent a score or hit-rate. Cite ONLY these grounded "
        f"numbers: {json.dumps(b['scores'])}.\n"
        "(Buckets marked insufficient have too small a sample — say 'insufficient "
        "sample', do NOT fabricate a rate.)\n"
        f"\nPER-STEP DIGEST (as_of, bias, target, tier, verdict, moved_pt, hit): "
        f"{json.dumps(b['steps'])}\n"
        "\nBe specific and direct about the SEQUENCE — where the analyst flipped, "
        "where it held correctly, which time-of-day it read best/worst. "
        "Educational only, not financial advice."
    )
