"""Bayesian condition BUCKETS — the small-n-honest statistics layer.

PURE, I/O-free, fully deterministic. Turns featured round-trips (features.py)
into "under what conditions do I win/lose?" with CREDIBLE INTERVALS, so a
20%-win bucket built on 4 trades is never mistaken for a real edge.

The core is ``beta_binomial``: a Beta-Binomial posterior over a win-rate. With
a Beta(a, b) prior and (wins, losses) observed, the posterior is
Beta(a + wins, b + losses); its mean is the smoothed win-rate and a credible
interval comes from the Beta inverse-CDF (quantile). We implement the Beta
quantile in PURE PYTHON (no scipy) — see ``_beta_ppf`` for the method and its
documented precision.

``condition_buckets`` groups round-trips by each categorical feature VALUE and
scores every group with beta_binomial, always including an OVERALL baseline row
so each bucket is comparable to "your average". ``notable_buckets`` keeps only
the buckets whose credible interval CLEARLY separates from the baseline win-rate
AND have enough trips (n >= min_n) — the statistically-defensible edges/leaks;
everything else is explicitly marked "not enough data" (the guard against
reading noise off 37 trades).
"""
from __future__ import annotations

import math

# ------------------------------------------------------------- Beta math

def _log_beta(a: float, b: float) -> float:
    """log B(a, b) = logГ(a) + logГ(b) - logГ(a+b)."""
    return math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)


def _betacf(x: float, a: float, b: float) -> float:
    """Continued fraction for the incomplete beta (Lentz's method).

    Numerical Recipes ``betacf`` — converges for x < (a+1)/(a+b+2); the caller
    (``_betainc``) uses the symmetry transform for larger x. ~1e-12 accuracy in
    well under the 200-iteration cap for the a,b<~2000 range we use."""
    tiny = 1e-30
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1.0 / d
    h = d
    for m in range(1, 201):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-14:
            break
    return h


def _betainc(x: float, a: float, b: float) -> float:
    """Regularized incomplete beta I_x(a, b) = CDF of Beta(a, b) at x.

    Pure-python Numerical-Recipes implementation. Accurate to ~1e-12 for the
    small integer-ish a,b we form from win/loss counts."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = _log_beta(a, b)
    front = math.exp(a * math.log(x) + b * math.log1p(-x) - lbeta)
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(x, a, b) / a
    return 1.0 - front * _betacf(1.0 - x, b, a) / b


def _beta_ppf(q: float, a: float, b: float) -> float:
    """Inverse CDF (quantile) of Beta(a, b) at probability ``q`` via bisection
    on the monotone ``_betainc``.

    Bisection to a tolerance of 1e-10 on the probability (or ~60 iterations),
    which pins x to ~1e-10 absolute — far tighter than the round-to-4-decimals
    the bucket rows use. q is clamped to (0, 1); q<=0 -> 0.0, q>=1 -> 1.0."""
    if q <= 0.0:
        return 0.0
    if q >= 1.0:
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        cdf = _betainc(mid, a, b)
        if abs(cdf - q) < 1e-10 or (hi - lo) < 1e-12:
            return mid
        if cdf < q:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


# ------------------------------------------------------- beta_binomial

def beta_binomial(
    wins: int, losses: int, *, prior_a: float = 1.0, prior_b: float = 1.0,
    ci: float = 0.90,
) -> dict:
    """Beta-Binomial posterior win-rate with a credible interval.

    Prior Beta(prior_a, prior_b) (default Beta(1,1) = uniform), observing
    ``wins`` and ``losses`` gives the posterior Beta(a, b) with
    a = prior_a + wins, b = prior_b + losses. Returns:

        {mean, ci_low, ci_high, ci, a, b}

    where ``mean`` = a/(a+b) is the posterior mean win-rate and (ci_low,
    ci_high) is the equal-tailed ``ci`` (default 90%) credible interval from the
    Beta inverse-CDF (``_beta_ppf``) at the (1-ci)/2 and (1+ci)/2 quantiles.

    With 0 wins and 0 losses this returns the prior's mean (0.5 for Beta(1,1))
    and its interval — never a divide-by-zero. Values are rounded to 6 decimals;
    the underlying quantile is accurate to ~1e-10 (see _beta_ppf)."""
    if wins < 0 or losses < 0:
        raise ValueError("wins and losses must be non-negative")
    a = prior_a + wins
    b = prior_b + losses
    mean = a / (a + b)
    tail = (1.0 - ci) / 2.0
    lo = _beta_ppf(tail, a, b)
    hi = _beta_ppf(1.0 - tail, a, b)
    return {
        "mean": round(mean, 6),
        "ci_low": round(lo, 6),
        "ci_high": round(hi, 6),
        "ci": ci,
        "a": a,
        "b": b,
    }


# ------------------------------------------------------- condition buckets

#: The categorical feature dimensions bucketed by default. Each is a key that
#: appears in a featured round-trip's ``features`` dict (features.py). Numeric
#: features (rsi, distances) are excluded — they are summarized inside the
#: categorical bands (vol_percentile_band, dte_band, ...) built by features.py.
DEFAULT_DIMENSIONS = (
    "daily_trend",
    "weekly_trend",
    "vol_percentile_band",
    "near_support",
    "near_resistance",
    "rsi_declining",
    "dte_band",
    "moneyness",
    "option_type",
    "day_of_week",
    "is_monday",
    "is_friday",
    "holding_bucket",
    "earnings_within_window",
    "size_tertile",
)

_BASELINE_DIMENSION = "__baseline__"
_BASELINE_VALUE = "all_trades"


def _win_loss(trips: list[dict]) -> tuple[int, int]:
    wins = sum(1 for t in trips if t.get("win"))
    return wins, len(trips) - wins


def _pnls(trips: list[dict]) -> list[float]:
    out = []
    for t in trips:
        v = t.get("realized_pnl")
        if v is not None:
            try:
                out.append(float(v))
            except (TypeError, ValueError):
                continue
    return out


def _feature_value(trip: dict, dimension: str):
    """The bucketed VALUE of ``dimension`` for a featured trip, or None to skip.

    Reads trip["features"][dimension]. Booleans are stringified ("true"/"false")
    so a bucket VALUE is always a stable string key; None (feature unknown,
    e.g. an equity's moneyness or a null earnings flag) is skipped for that
    dimension so unknowns never form a phantom bucket."""
    feats = trip.get("features") or {}
    val = feats.get(dimension)
    if val is None:
        return None
    if isinstance(val, bool):
        return "true" if val else "false"
    return str(val)


def _bucket_row(
    dimension: str, value: str, trips: list[dict], *,
    prior_a: float, prior_b: float, ci: float,
) -> dict:
    """One scored bucket: counts, Bayesian win-rate + CI, and $ aggregates."""
    wins, losses = _win_loss(trips)
    n = len(trips)
    pnls = _pnls(trips)
    bb = beta_binomial(wins, losses, prior_a=prior_a, prior_b=prior_b, ci=ci)
    return {
        "dimension": dimension,
        "value": value,
        "n": n,
        "wins": wins,
        "losses": losses,
        "win_rate": round(wins / n, 6) if n else None,
        "mean": bb["mean"],
        "ci_low": bb["ci_low"],
        "ci_high": bb["ci_high"],
        "ci": ci,
        "avg_pnl": round(sum(pnls) / len(pnls), 2) if pnls else None,
        "total_pnl": round(sum(pnls), 2),
    }


def baseline_win_rate(featured_roundtrips: list[dict]) -> float | None:
    """The raw overall win-rate (wins / n) across all featured trips, or None
    when there are none. This is the "your average" every bucket is judged
    against."""
    n = len(featured_roundtrips)
    if not n:
        return None
    wins = sum(1 for t in featured_roundtrips if t.get("win"))
    return round(wins / n, 6)


def condition_buckets(
    featured_roundtrips: list[dict], *,
    dimensions: tuple[str, ...] | list[str] = DEFAULT_DIMENSIONS,
    prior_a: float = 1.0, prior_b: float = 1.0, ci: float = 0.90,
) -> list[dict]:
    """Group featured round-trips by each feature VALUE and score every group.

    For each dimension in ``dimensions`` and each distinct value that dimension
    takes, emit a bucket row: {dimension, value, n, wins, losses, win_rate,
    mean, ci_low, ci_high, ci, avg_pnl, total_pnl}. ``win_rate`` is the raw
    frequency; ``mean``/``ci_*`` are the Bayesian posterior (beta_binomial) so a
    thin bucket has a wide interval.

    The OVERALL BASELINE is always emitted as the first row
    (dimension="__baseline__", value="all_trades") so every bucket is comparable
    to "your average". Rows are sorted baseline-first, then by n DESC, then by
    EDGE (win_rate - baseline) DESC — the biggest, most-separated buckets on top.
    Deterministic (ties broken by dimension then value)."""
    rows: list[dict] = []
    baseline = _bucket_row(
        _BASELINE_DIMENSION, _BASELINE_VALUE, featured_roundtrips,
        prior_a=prior_a, prior_b=prior_b, ci=ci,
    )
    base_rate = baseline["win_rate"] if baseline["win_rate"] is not None else 0.0

    for dim in dimensions:
        groups: dict[str, list[dict]] = {}
        for trip in featured_roundtrips:
            value = _feature_value(trip, dim)
            if value is None:
                continue
            groups.setdefault(value, []).append(trip)
        for value in groups:
            rows.append(_bucket_row(
                dim, value, groups[value],
                prior_a=prior_a, prior_b=prior_b, ci=ci,
            ))

    def edge(row: dict) -> float:
        wr = row["win_rate"]
        return (wr - base_rate) if wr is not None else -1.0

    rows.sort(key=lambda r: (-r["n"], -edge(r), r["dimension"], r["value"]))
    return [baseline] + rows


def notable_buckets(
    buckets: list[dict], *, baseline: float | None, min_n: int = 3,
) -> list[dict]:
    """The statistically-defensible edges and leaks (and only those).

    A bucket is NOTABLE when it has enough trips (n >= min_n) AND its credible
    interval CLEARLY separates from the ``baseline`` win-rate:

      * a good edge:  ci_low  > baseline  (even the pessimistic end beats average)
      * a bad  leak:  ci_high < baseline  (even the optimistic end trails average)

    Each notable row is returned with the fields of the bucket plus
    {kind: "edge"|"leak", edge (win_rate - baseline), significant: True}.

    Buckets that don't clear both bars are NOT returned as notable — but a bucket
    that separates yet is too thin (n < min_n) is returned with
    {significant: False, note: "n<min, not significant"} so the caller can show
    "seen, but not enough data". The baseline row itself is never notable.
    Returns [] when baseline is None (nothing to compare against). Sorted by
    |edge| DESC (strongest signal first), deterministic."""
    if baseline is None:
        return []
    out: list[dict] = []
    for b in buckets:
        if b.get("dimension") == _BASELINE_DIMENSION:
            continue
        wr = b.get("win_rate")
        if wr is None:
            continue
        ci_low = b.get("ci_low")
        ci_high = b.get("ci_high")
        is_edge = ci_low is not None and ci_low > baseline
        is_leak = ci_high is not None and ci_high < baseline
        if not (is_edge or is_leak):
            continue
        row = dict(b)
        row["kind"] = "edge" if is_edge else "leak"
        row["edge"] = round(wr - baseline, 6)
        if b["n"] >= min_n:
            row["significant"] = True
        else:
            row["significant"] = False
            row["note"] = "n<min, not significant"
        out.append(row)
    out.sort(key=lambda r: (-abs(r["edge"]), r["dimension"], r["value"]))
    return out
