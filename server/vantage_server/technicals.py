"""Deterministic technical-analysis engine — reads a chart like a trader.

PURE, I/O-free, fully deterministic. Every function takes a bar list
([{date, open, high, low, close, volume}], oldest -> newest — the shape
robinhood.fetch_historicals / bars.resample produce) and returns typed
results (frozen dataclasses / plain dicts). No network, no disk, no clock.

Encodes the playbook EXACTLY:
  * support/resistance = SWING PIVOTS clustered into zones, WEIGHTED by
    VOLUME SHELVES (high-volume price nodes act as S/R);
  * free-fall = "BROKE SUPPORT WITH MOMENTUM" — a support break confirmed by
    momentum (weak/declining RSI + accelerating decline / expanding down-range),
    independent of higher-timeframe alignment;
  * analyze DAILY, WEEKLY, MONTHLY timeframes.

The two load-bearing predicates/formulas are documented at their functions:
``broke_support_with_momentum`` (multi_timeframe_read) and ``_conviction``.
"""
from __future__ import annotations

from dataclasses import dataclass, field


# ------------------------------------------------------------- data shapes

@dataclass(frozen=True)
class Pivot:
    date: str
    price: float


@dataclass(frozen=True)
class VolumeBin:
    low: float
    high: float
    volume: float
    is_shelf: bool


@dataclass(frozen=True)
class Level:
    """A support or resistance zone.

    ``price`` is the volume-weighted center of the clustered pivots;
    ``strength`` = pivot count + shelf bonus (see support_resistance);
    ``kind`` is "support" or "resistance"."""
    price: float
    strength: float
    kind: str
    pivots: int = 1
    shelf_backed: bool = False


@dataclass(frozen=True)
class Trend:
    direction: str          # "up" | "down" | "sideways"
    strength: float         # 0..1
    structure: str          # "HH-HL" | "LH-LL" | "mixed" | "insufficient"


@dataclass(frozen=True)
class Momentum:
    rsi: float
    declining: bool
    accelerating_decline: bool
    range_expanding: bool


# ------------------------------------------------------------- small utils

def _closes(bars: list[dict]) -> list[float]:
    return [float(b["close"]) for b in bars]


def _sma(values: list[float], period: int) -> float | None:
    if len(values) < period or period <= 0:
        return None
    return sum(values[-period:]) / period


def _true_ranges(bars: list[dict]) -> list[float]:
    """Wilder true range per bar (first bar = high-low)."""
    trs: list[float] = []
    prev_close: float | None = None
    for b in bars:
        high = float(b["high"])
        low = float(b["low"])
        if prev_close is None:
            trs.append(high - low)
        else:
            trs.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
        prev_close = float(b["close"])
    return trs


# ------------------------------------------------------------- swing pivots

def swing_pivots(bars: list[dict], lookback: int = 5) -> dict:
    """Local extrema over a symmetric window.

    A swing HIGH is a bar whose ``high`` is STRICTLY greater than the highs of
    the ``lookback`` bars on each side; a swing LOW is strictly less than the
    lows on each side. The first and last ``lookback`` bars can never be
    pivots (no full window). Returns {"highs": [Pivot...], "lows": [Pivot...]}
    in chronological order.
    """
    highs: list[Pivot] = []
    lows: list[Pivot] = []
    n = len(bars)
    if lookback < 1:
        raise ValueError("lookback must be >= 1")
    for i in range(lookback, n - lookback):
        window = range(i - lookback, i + lookback + 1)
        hi = float(bars[i]["high"])
        lo = float(bars[i]["low"])
        is_high = all(hi > float(bars[j]["high"]) for j in window if j != i)
        is_low = all(lo < float(bars[j]["low"]) for j in window if j != i)
        if is_high:
            highs.append(Pivot(date=str(bars[i]["date"]), price=hi))
        if is_low:
            lows.append(Pivot(date=str(bars[i]["date"]), price=lo))
    return {"highs": highs, "lows": lows}


# ----------------------------------------------------------- volume profile

def volume_profile(bars: list[dict], bins: int = 24) -> list[VolumeBin]:
    """Price-bin volume histogram; high-volume nodes are marked shelves.

    Splits the [min low, max high] price range into ``bins`` equal-width
    buckets and assigns each bar's volume to the bucket its CLOSE falls in
    (close is where the day's trade actually settled). A bin is a shelf when
    its volume is in the top quartile (>= the 75th-percentile bin volume among
    non-empty bins) AND non-zero. Returned oldest-price -> highest-price.
    """
    if bins < 1:
        raise ValueError("bins must be >= 1")

    def _finite(b) -> bool:
        try:
            return all(float(b[k]) == float(b[k])  # NaN != NaN
                       for k in ("low", "high", "close", "volume"))
        except (TypeError, ValueError, KeyError):
            return False

    # Bar feeds occasionally emit a NaN row (live 2026-07-13: one EOD bar's
    # NaN close crashed the nightly position-analysis job). A poisoned bar
    # carries no information — drop it rather than let NaN infect min/max.
    bars = [b for b in bars if _finite(b)]
    if not bars:
        return []
    lows = [float(b["low"]) for b in bars]
    highs = [float(b["high"]) for b in bars]
    lo = min(lows)
    hi = max(highs)
    if hi <= lo:
        # degenerate flat series: one bucket carrying all volume
        total = float(sum(int(b["volume"]) for b in bars))
        return [VolumeBin(low=lo, high=hi, volume=total, is_shelf=total > 0)]
    width = (hi - lo) / bins
    vols = [0.0] * bins
    for b in bars:
        close = float(b["close"])
        idx = int((close - lo) / width)
        if idx >= bins:
            idx = bins - 1
        if idx < 0:
            idx = 0
        vols[idx] += float(int(b["volume"]))
    nonzero = sorted(v for v in vols if v > 0)
    threshold = _percentile(nonzero, 0.75) if nonzero else 0.0
    out: list[VolumeBin] = []
    for i, v in enumerate(vols):
        bin_lo = lo + i * width
        bin_hi = lo + (i + 1) * width
        out.append(VolumeBin(low=bin_lo, high=bin_hi, volume=v,
                             is_shelf=v > 0 and v >= threshold))
    return out


def _percentile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolation percentile of a pre-sorted list (q in 0..1)."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = q * (len(sorted_values) - 1)
    lo_i = int(pos)
    hi_i = min(lo_i + 1, len(sorted_values) - 1)
    frac = pos - lo_i
    return sorted_values[lo_i] + (sorted_values[hi_i] - sorted_values[lo_i]) * frac


# ------------------------------------------------------ support / resistance

def support_resistance(
    bars: list[dict], *, current_price: float, lookback: int = 5,
    cluster_pct: float = 0.02,
) -> dict:
    """Cluster swing pivots into S/R zones, weighted by volume-shelf coincidence.

    Algorithm:
      1. Collect all swing highs + lows (swing_pivots).
      2. CLUSTER pivots whose prices sit within ``cluster_pct`` (default 2%) of
         a running cluster mean into one zone. A zone's price is the
         VOLUME-WEIGHTED mean would over-fit; we use the plain mean of member
         pivot prices (deterministic, order-independent after sorting).
      3. WEIGHT: strength = (# pivots in the zone) + shelf bonus. The bonus is
         +1.0 when a volume-profile SHELF overlaps the zone price (high-volume
         node coincides with the pivot cluster -> stronger level).
      4. SPLIT by current_price: zones at/below -> support, above -> resistance
         (a zone exactly at current_price counts as support).
    Each level = Level(price, strength, kind, pivots, shelf_backed). Support is
    sorted nearest-below-first, resistance nearest-above-first (both by
    proximity to current_price).
    """
    piv = swing_pivots(bars, lookback=lookback)
    prices = sorted(p.price for p in piv["highs"] + piv["lows"])
    clusters = _cluster_prices(prices, cluster_pct)
    shelves = [vb for vb in volume_profile(bars) if vb.is_shelf]

    support: list[Level] = []
    resistance: list[Level] = []
    for members in clusters:
        center = sum(members) / len(members)
        # A shelf backs the zone when the zone price falls inside the shelf bin
        # OR within cluster_pct of it — pivots are lows/highs while shelves are
        # keyed on closes, so a small gap between the two is expected and still
        # a coincidence (high-volume node at the pivot).
        shelf_backed = any(
            vb.low - center <= center * cluster_pct
            and center - vb.high <= center * cluster_pct
            for vb in shelves
        )
        strength = float(len(members)) + (1.0 if shelf_backed else 0.0)
        kind = "support" if center <= current_price else "resistance"
        level = Level(price=center, strength=strength, kind=kind,
                      pivots=len(members), shelf_backed=shelf_backed)
        (support if kind == "support" else resistance).append(level)

    support.sort(key=lambda lv: current_price - lv.price)      # nearest below first
    resistance.sort(key=lambda lv: lv.price - current_price)   # nearest above first
    return {"support": support, "resistance": resistance}


def _broken_support(
    bars: list[dict], current_price: float, *, lookback: int = 5,
    cluster_pct: float = 0.02, max_band: float = 0.15,
) -> float | None:
    """The price of the nearest swing-LOW floor that price has fallen THROUGH.

    Support in the playbook is where price previously held (swing lows). When
    price breaks below such a floor, that floor now sits OVERHEAD (above the
    current price) — that is a "broken support". This returns the LOWEST
    swing-low cluster whose price is above ``current_price`` (so price has
    dropped under it) and within ``max_band`` (default 15%) of current — i.e.
    the floor price just fell through, not some distant old level. Returns None
    when price is still at/above every swing-low floor (nothing broken) or the
    only broken floor is implausibly far above.
    """
    piv = swing_pivots(bars, lookback=lookback)
    low_prices = sorted(p.price for p in piv["lows"])
    clusters = _cluster_prices(low_prices, cluster_pct)
    overhead: list[float] = []
    for members in clusters:
        center = sum(members) / len(members)
        if center > current_price:
            band = (center - current_price) / current_price if current_price else 0.0
            if band <= max_band:
                overhead.append(center)
    return min(overhead) if overhead else None


def _cluster_prices(sorted_prices: list[float], cluster_pct: float) -> list[list[float]]:
    """Greedy single-pass clustering of sorted prices: a price joins the
    current cluster when it is within ``cluster_pct`` of the cluster's running
    mean, else it starts a new cluster."""
    clusters: list[list[float]] = []
    for price in sorted_prices:
        if not clusters:
            clusters.append([price])
            continue
        current = clusters[-1]
        mean = sum(current) / len(current)
        if mean > 0 and abs(price - mean) / mean <= cluster_pct:
            current.append(price)
        else:
            clusters.append([price])
    return clusters


# --------------------------------------------------------------------- trend

def trend(bars: list[dict]) -> Trend:
    """Direction + strength from MA slopes and swing structure.

    MA component: for each available MA among 20/50/200 (only those with
    enough bars), compare the MA now vs the MA ``span`` bars ago (span = the
    period) — a rising MA votes up, falling votes down. Structure component:
    over recent swing pivots, higher-highs & higher-lows => "HH-HL" (uptrend),
    lower-highs & lower-lows => "LH-LL" (downtrend), else "mixed".

    direction: "up" if net MA vote > 0 and structure not LH-LL; "down" if net
    vote < 0 and structure not HH-HL; else "sideways". strength (0..1) =
    average of the |MA-slope-fraction| votes that agreed with the direction,
    blended with a structure bonus, clamped to [0,1].
    """
    closes = _closes(bars)
    if len(closes) < 2:
        return Trend(direction="sideways", strength=0.0, structure="insufficient")

    votes: list[float] = []   # signed slope fractions
    for period in (20, 50, 200):
        if len(closes) >= period * 2:
            now = _sma(closes, period)
            prev = _sma(closes[:-period], period)
            if now is not None and prev is not None and prev != 0:
                votes.append((now - prev) / prev)
        elif len(closes) >= period + 1:
            # enough for the MA but not a full period-ago window: use the
            # earliest computable window (shorter timeframes / weekly/monthly)
            now = _sma(closes, period)
            prev = _sma(closes[: period + 1][:period], period)
            if now is not None and prev is not None and prev != 0:
                votes.append((now - prev) / prev)

    if not votes:
        # too few bars for any MA: fall back to first-vs-last close slope
        if closes[0] != 0:
            votes.append((closes[-1] - closes[0]) / closes[0])

    net = sum(votes)
    structure = _swing_structure(bars)

    if net > 0 and structure != "LH-LL":
        direction = "up"
    elif net < 0 and structure != "HH-HL":
        direction = "down"
    else:
        direction = "sideways"

    if direction == "sideways":
        strength = 0.0
    else:
        agree = [abs(v) for v in votes if (v > 0) == (direction == "up")]
        ma_strength = (sum(agree) / len(agree)) if agree else 0.0
        # scale: a 10% MA move over its own span is already a strong slope
        ma_strength = min(ma_strength * 10.0, 1.0)
        structure_bonus = 0.3 if (
            (direction == "up" and structure == "HH-HL")
            or (direction == "down" and structure == "LH-LL")
        ) else 0.0
        strength = max(0.0, min(1.0, 0.7 * ma_strength + structure_bonus))
    return Trend(direction=direction, strength=strength, structure=structure)


def _swing_structure(bars: list[dict], lookback: int = 5) -> str:
    """Classify the last two swing highs and last two swing lows.

    Adapts ``lookback`` down for short series so weekly/monthly still classify.
    """
    lb = lookback
    while lb >= 2:
        piv = swing_pivots(bars, lookback=lb)
        highs = piv["highs"]
        lows = piv["lows"]
        if len(highs) >= 2 and len(lows) >= 2:
            hh = highs[-1].price > highs[-2].price
            hl = lows[-1].price > lows[-2].price
            lh = highs[-1].price < highs[-2].price
            ll = lows[-1].price < lows[-2].price
            if hh and hl:
                return "HH-HL"
            if lh and ll:
                return "LH-LL"
            return "mixed"
        lb -= 1
    return "insufficient"


# ------------------------------------------------------------------ momentum

def rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder's RSI(period). Seeds with the simple average of the first
    ``period`` gains/losses, then smooths (Wilder). Returns None when there are
    fewer than period+1 closes. 100 when there are no losses in the window."""
    if len(closes) < period + 1:
        return None
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        delta = closes[i] - closes[i - 1]
        if delta >= 0:
            gains += delta
        else:
            losses -= delta
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gain = delta if delta > 0 else 0.0
        loss = -delta if delta < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def momentum(bars: list[dict], period: int = 14) -> Momentum:
    """RSI + the three free-fall confirmation flags.

    * rsi: Wilder RSI(14) on closes. When there are too few bars to compute it
      (< period+1 closes — common on the monthly timeframe with ~14 buckets)
      it defaults to the NEUTRAL 50.0, never a fabricated 0.0 that would read as
      "maximally weak". ``declining`` stays False without two computable points.
    * declining: RSI now < RSI one bar ago (momentum falling).
    * accelerating_decline: the last few close-to-close deltas are getting MORE
      negative (each step down bigger than the last) — a decline picking up
      speed. Uses the last 3 deltas: delta[-1] < delta[-2] < delta[-3] AND
      delta[-1] < 0.
    * range_expanding: recent true range is widening — mean TR of the last 3
      bars > mean TR of the prior 3 bars (volatility expansion on the break).
    """
    closes = _closes(bars)
    now = rsi(closes, period)
    prev = rsi(closes[:-1], period) if len(closes) >= period + 2 else None
    rsi_val = now if now is not None else 50.0  # neutral default when uncomputable
    declining = now is not None and prev is not None and now < prev

    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    accelerating = (
        len(deltas) >= 3
        and deltas[-1] < deltas[-2] < deltas[-3]
        and deltas[-1] < 0
    )

    trs = _true_ranges(bars)
    range_expanding = False
    if len(trs) >= 6:
        recent = sum(trs[-3:]) / 3
        prior = sum(trs[-6:-3]) / 3
        range_expanding = recent > prior

    return Momentum(rsi=rsi_val, declining=declining,
                    accelerating_decline=accelerating, range_expanding=range_expanding)


# ------------------------------------------------------- covered-call strikes

def distance_to_resistance(
    bars: list[dict], current_price: float, *, lookback: int = 5,
) -> list[dict]:
    """Nearest resistances above current_price, for covered-call strike
    placement. Returns [{price, pct_away, strength}] sorted nearest-first;
    pct_away is (price - current)/current * 100 (positive)."""
    sr = support_resistance(bars, current_price=current_price, lookback=lookback)
    out: list[dict] = []
    for lv in sr["resistance"]:
        if lv.price <= current_price:
            continue
        pct = (lv.price - current_price) / current_price * 100 if current_price else 0.0
        out.append({"price": lv.price, "pct_away": pct, "strength": lv.strength})
    return out


# ----------------------------------------------------- multi-timeframe read

@dataclass(frozen=True)
class TimeframeRead:
    trend: Trend
    momentum: Momentum
    support_resistance: dict  # {"support": [Level...], "resistance": [Level...]}


@dataclass(frozen=True)
class Conviction:
    score: float   # -1..1
    label: str     # "strong" | "neutral" | "weak" | "freefall"


@dataclass(frozen=True)
class MultiTimeframeRead:
    per_tf: dict                       # {"daily": TimeframeRead, "weekly":..., "monthly":...}
    nearest_support: Level | None
    nearest_resistance: Level | None
    broke_support_with_momentum: bool
    conviction: Conviction
    at_support: bool = False           # current price sitting on a support zone
    factors: dict = field(default_factory=dict)  # the raw booleans feeding conviction


def _near(price: float, level_price: float, pct: float = 0.02) -> bool:
    """True when ``price`` is within ``pct`` of ``level_price``."""
    if level_price == 0:
        return price == 0
    return abs(price - level_price) / level_price <= pct


def multi_timeframe_read(
    daily: list[dict], weekly: list[dict], monthly: list[dict],
    *, current_price: float,
) -> MultiTimeframeRead:
    """The full read across daily/weekly/monthly.

    broke_support_with_momentum (THE free-fall predicate) — evaluated on the
    DAILY timeframe:

        broke_support_with_momentum ==
            (broken_support is not None)          # price fell THROUGH a swing-low floor
            AND daily_momentum.declining          # RSI falling (weak momentum)
            AND (daily_momentum.accelerating_decline
                 OR daily_momentum.range_expanding)  # break confirmed by momentum

        where ``broken_support`` = _broken_support(daily, current_price): the
        nearest swing-LOW floor that now sits OVERHEAD because price dropped
        under it (within 15% of current). "current below the nearest support"
        is exactly this: a support the price previously held has been broken to
        the downside. Higher-timeframe alignment is deliberately NOT required
        (the playbook: "regardless of higher-timeframe alignment"). When price
        is still at/above every swing-low floor, broken_support is None and the
        predicate is False (nothing broken).

    conviction — deterministic scoring, label from score bands:

        Start score = 0.0 (neutral). Apply, on the DAILY read:
          freefall short-circuit: if broke_support_with_momentum -> score = -1.0,
            label "freefall".
          Otherwise accumulate:
            + 0.5  at_support           (price within 2% of nearest support)
            + 0.2  basing               (NOT range_expanding AND RSI in [35,65])
            + 0.2  RSI not weak         (RSI >= 40)
            - 0.4  weekly AND monthly both trending down
            - 0.2  daily.declining
            - 0.2  daily trend direction == "down"
          score clamped to [-1, 1].
        label bands:  score >=  0.5 -> "strong"
                      score <= -0.5 -> "weak"       (deep but not confirmed freefall)
                      else            -> "neutral"

        "strong" therefore means at/near support AND basing (not expanding,
        RSI healthy) AND weekly/monthly not both down — exactly the playbook's
        at-support basing setup.
    """
    per_tf = {
        "daily": _read_tf(daily, current_price),
        "weekly": _read_tf(weekly, current_price),
        "monthly": _read_tf(monthly, current_price),
    }
    daily_read = per_tf["daily"]
    daily_sr = daily_read.support_resistance
    daily_mom = daily_read.momentum

    nearest_support = daily_sr["support"][0] if daily_sr["support"] else None
    nearest_resistance = daily_sr["resistance"][0] if daily_sr["resistance"] else None

    broken_support = _broken_support(daily, current_price)
    broke = (
        broken_support is not None
        and daily_mom.declining
        and (daily_mom.accelerating_decline or daily_mom.range_expanding)
    )

    weekly_down = per_tf["weekly"].trend.direction == "down"
    monthly_down = per_tf["monthly"].trend.direction == "down"
    at_support = nearest_support is not None and _near(current_price, nearest_support.price)

    conviction, factors = _conviction(
        broke=broke,
        at_support=at_support,
        daily_trend=daily_read.trend,
        daily_mom=daily_mom,
        weekly_down=weekly_down,
        monthly_down=monthly_down,
    )
    factors["broken_support_price"] = broken_support
    return MultiTimeframeRead(
        per_tf=per_tf,
        nearest_support=nearest_support,
        nearest_resistance=nearest_resistance,
        broke_support_with_momentum=broke,
        conviction=conviction,
        at_support=at_support,
        factors=factors,
    )


def _read_tf(bars: list[dict], current_price: float) -> TimeframeRead:
    return TimeframeRead(
        trend=trend(bars),
        momentum=momentum(bars),
        support_resistance=support_resistance(bars, current_price=current_price),
    )


def _conviction(
    *, broke: bool, at_support: bool, daily_trend: Trend, daily_mom: Momentum,
    weekly_down: bool, monthly_down: bool,
) -> tuple[Conviction, dict]:
    """See multi_timeframe_read docstring for the exact formula."""
    basing = (not daily_mom.range_expanding) and (35.0 <= daily_mom.rsi <= 65.0)
    rsi_not_weak = daily_mom.rsi >= 40.0
    both_htf_down = weekly_down and monthly_down

    factors = {
        "broke_support_with_momentum": broke,
        "at_support": at_support,
        "basing": basing,
        "rsi_not_weak": rsi_not_weak,
        "both_htf_down": both_htf_down,
        "daily_declining": daily_mom.declining,
        "daily_trend_down": daily_trend.direction == "down",
    }

    if broke:
        return Conviction(score=-1.0, label="freefall"), factors

    score = 0.0
    if at_support:
        score += 0.5
    if basing:
        score += 0.2
    if rsi_not_weak:
        score += 0.2
    if both_htf_down:
        score -= 0.4
    if daily_mom.declining:
        score -= 0.2
    if daily_trend.direction == "down":
        score -= 0.2
    score = max(-1.0, min(1.0, score))

    if score >= 0.5:
        label = "strong"
    elif score <= -0.5:
        label = "weak"
    else:
        label = "neutral"
    return Conviction(score=score, label=label), factors
