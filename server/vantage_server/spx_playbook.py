"""Daily 0DTE SPX playbook — the deterministic scaffold (ADR-008 context layer).

Forward-looking, refreshed nightly. Fuses Sentinel's computed SPX intel (dealer
gamma, S/R zones, breadth/VIX, Fed/macro calendar, zone hit-rates — via
``sentinel_bridge``) with dimensions computed here from SPX 15m bars (fib grid,
VWAP regime, volume-profile PoC/LVN, liquidity sweeps, overnight gaps), an
OpEx/DTE layer, a GEX-regime→next-day-vol edge, and day-of-week / time-of-day
edges.

The output is a **grounded scaffold**: a pure dict of numbers, each traceable to
an artifact or a bar computation — no prose, no invented levels. Mira's synthesis
node turns it into plain-English later; the scaffold IS the ground truth and the
templated fallback. Every setup is CONDITIONAL on a real level ("IF SPX > flip
X"), never a bare directional call. This is decision-support, not a signal, and
it places no orders (ADR-010). The GEX read is OI-based and blind to 0DTE flow —
that caveat rides in the scaffold and must survive to every surface.

CLI: ``python -m vantage_server.spx_playbook [--data-dir D] [--dry-run]``.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import sys
from typing import Any

from . import sentinel_bridge as sb
from .store import resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2

ROUND_LEVELS_STEP = 50  # SPX psychological levels every 50 pts near spot
LOOKBACK_DAYS_15M = 60  # yfinance intraday cap


# ============================================================ bar fetch

def _fetch_15m(symbol: str):
    """SPX/SPY 15m RTH bars for the yfinance intraday window. Lazy import."""
    import yfinance as yf  # noqa: PLC0415

    df = yf.Ticker(symbol).history(period=f"{LOOKBACK_DAYS_15M}d", interval="15m")
    if df.empty:
        return df
    idx = df.index.tz_convert("America/New_York")
    df = df.copy()
    df.index = idx
    mins = idx.hour * 60 + idx.minute
    return df[(mins >= 570) & (mins < 960)]  # 09:30–16:00 ET


def _fetch_daily(symbol: str = "^GSPC"):
    import yfinance as yf  # noqa: PLC0415

    df = yf.Ticker(symbol).history(period="45d", interval="1d")
    if df.empty:
        return df
    df = df.copy()
    df.index = df.index.tz_convert("America/New_York")
    return df


# ============================================================ chart dimensions

def _fractal_pivots(highs, lows, n=2):
    ph, pl = [], []
    for i in range(n, len(highs) - n):
        wh = highs[i - n:i + n + 1]
        if highs[i] == max(wh) and list(wh).count(highs[i]) == 1:
            ph.append(i)
        wl = lows[i - n:i + n + 1]
        if lows[i] == min(wl) and list(wl).count(lows[i]) == 1:
            pl.append(i)
    return ph, pl


def _cluster(prices, tol=6.0):
    prices = sorted(prices)
    clusters: list[list[float]] = []
    for p in prices:
        if clusters and abs(p - clusters[-1][-1]) <= tol:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    return [(round(sum(c) / len(c), 1), len(c)) for c in clusters]


def _fib(hi, lo):
    rng = hi - lo
    return {f"{r*100:.1f}%": round(lo + r * rng, 1)
            for r in (0.382, 0.5, 0.618, 0.786)}


def _volume_profile(closes, vols, bins=40):
    lo, hi = min(closes), max(closes)
    if hi <= lo:
        return None, [], []
    buckets = [0.0] * bins
    for c, v in zip(closes, vols):
        b = min(bins - 1, max(0, int((c - lo) / (hi - lo) * bins)))
        buckets[b] += v
    centers = [lo + (i + 0.5) * (hi - lo) / bins for i in range(bins)]
    order = sorted(range(bins), key=lambda i: buckets[i])
    poc = round(centers[order[-1]], 1)
    lvn = sorted(round(centers[i], 1) for i in order[:4])
    hvn = sorted(round(centers[i], 1) for i in order[-4:])
    return poc, hvn, lvn


def _volume_read(closes, opens, vols, recent=6) -> dict:
    """Volume exhaustion / confirmation read over the tail of the window.

    Compares the last ``recent`` bars' volume to the window's median: FADING into
    the current move = seller/buyer exhaustion (a reversal tell — what preceded
    today's low); EXPANDING while price rises = a confirmed push. Returns
    ``{trend, note}``. Deterministic; pure list math (no numpy)."""
    if not vols or len(vols) < recent + 2:
        return {"trend": "n/a", "note": ""}
    nonzero = [v for v in vols if v > 0]
    if not nonzero:
        return {"trend": "n/a", "note": ""}
    med = sorted(nonzero)[len(nonzero) // 2]
    tail = vols[-recent:]
    tail_avg = sum(tail) / len(tail)
    # is the tail rising (last half vs first half of the recent window)?
    half = recent // 2
    early = sum(tail[:half]) / max(1, half)
    late = sum(tail[half:]) / max(1, recent - half)
    rising_vol = late > early * 1.15
    falling_vol = late < early * 0.85
    up_move = closes[-1] > closes[-recent]
    if rising_vol and up_move:
        return {"trend": "expanding",
                "note": "expanding on the push — buyers confirming"}
    if falling_vol and not up_move:
        return {"trend": "fading",
                "note": "fading into the low — seller exhaustion, watch for a reclaim"}
    if falling_vol and up_move:
        return {"trend": "fading",
                "note": "rally on fading volume — weak push, prone to stall"}
    if tail_avg > med * 1.5:
        return {"trend": "elevated", "note": "above-median volume — active tape"}
    return {"trend": "flat", "note": "volume near its median — no clear tell"}


def _structure_read(highs, lows, closes, n=2) -> dict:
    """A lightweight market-structure read (LuxAlgo's BOS/CHoCH, but as one line
    of text — LuxAlgo already draws the labels). From the swing pivots: is the
    tape making higher-highs/higher-lows (up), lower-highs/lower-lows (down), or
    mixed, and where was the last break of structure (a swing pivot the latest
    price traded through)? Returns ``{state, note, last_break}``.

    We keep it deliberately simple: sign the last two confirmed swing highs and
    the last two swing lows, then check whether the most recent close has taken
    out the last opposing pivot (a BOS/CHoCH)."""
    ph, pl = _fractal_pivots(highs, lows, n=n)
    sh = [highs[i] for i in ph]      # confirmed swing highs, in time order
    sl = [lows[i] for i in pl]       # confirmed swing lows
    if len(sh) < 2 or len(sl) < 2:
        return {"state": "unclear", "note": "not enough swings to read structure",
                "last_break": None}
    hh = sh[-1] > sh[-2]             # higher high?
    hl = sl[-1] > sl[-2]             # higher low?
    if hh and hl:
        state, base = "uptrend", "trending up (rising highs and lows)"
    elif not hh and not hl:
        state, base = "downtrend", "trending down (falling highs and lows)"
    else:
        state, base = "range/transition", "no clear trend (choppy)"
    last = closes[-1]
    last_break = None
    # a BOS/CHoCH = latest close has taken out the most recent opposing pivot
    if last > sh[-1]:
        last_break = round(sh[-1], 1)
        note = f"{base}; just pushed above {last_break:.0f} (turning up)"
    elif last < sl[-1]:
        last_break = round(sl[-1], 1)
        note = f"{base}; just dropped below {last_break:.0f} (turning down)"
    else:
        note = f"{base}; stuck between {sl[-1]:.0f} and {sh[-1]:.0f} for now"
    return {"state": state, "note": note, "last_break": last_break}


RECENT_SESSIONS = 10  # the swing window that matters for a next-session playbook


def _recent_window(spx15, sessions=RECENT_SESSIONS):
    """Restrict to the last N trading sessions — a 60-day 15m pull reaches back to
    stale extremes (a months-old low) that would anchor the fib grid uselessly.
    The tradeable swing for a 0DTE read is the recent one."""
    days = sorted({t.date() for t in spx15.index})[-sessions:]
    if not days:
        return spx15
    return spx15[[t.date() in set(days) for t in spx15.index]]


#: The adopted fractal pivot half-width (playbook-params goal: 2->3 on 15m).
#: Prod passes this EXPLICITLY so the invariant never rides a function default.
ADOPTED_PIVOT_N = 3


def _chart_dimensions(spx15, spyvol_by_ts, scale: dict | None = None,
                      recent_sessions: int = RECENT_SESSIONS,
                      pivot_n: int = 3, vp_bins: int = 40) -> dict:
    """Fib grid, VWAP regime, volume profile, S/R clusters from the RECENT 15m
    window (last N sessions) — the swing that actually frames the next session.
    ``scale`` supplies the per-underlying ``cluster_tol`` (defaults to SPX).
    ``recent_sessions``/``pivot_n``/``vp_bins`` expose the design constants for
    the backtest experiment loop.

    ``pivot_n=3`` (was 2) is the playbook-params loop's adopted finding
    (claudedocs/goals/playbook-params): on 15m bars, 3-bar pivots (45 min of
    lookaround each side) keep only the swings the tape respects — WR
    0.600→0.706, PF 1.39→2.99 under the champion trigger, replicated across
    halves and symbols. The long-window loop (claudedocs/goals/long-window)
    then showed the law is a TIME sweet spot (~45min-2h of lookaround), NOT
    "wider is better": on hourly bars pivot_n 1-2 beats 3. The default of 3 is
    correct for the 15m bars prod feeds this function — revisit if the input
    granularity ever changes."""
    tol = (scale or {}).get("cluster_tol", 6.0)
    if spx15 is None or spx15.empty:
        return {"available": False}
    spx15 = _recent_window(spx15, sessions=recent_sessions)
    H = list(spx15["High"]); L = list(spx15["Low"])
    C = list(spx15["Close"]); O = list(spx15["Open"])
    ts = list(spx15.index)
    vols = [float(spyvol_by_ts.get(t, 0.0)) for t in ts]

    swing_hi, swing_lo = max(H), min(L)
    # VWAP over the window + regime (close above/below)
    tp = [(H[i] + L[i] + C[i]) / 3 for i in range(len(C))]
    cum_pv = cum_v = 0.0
    for i in range(len(C)):
        cum_pv += tp[i] * vols[i]; cum_v += vols[i]
    vwap = round(cum_pv / cum_v, 1) if cum_v else None
    last = C[-1]
    regime = ("above VWAP (buyers in control)" if vwap and last > vwap
              else "below VWAP (sellers in control)" if vwap else "n/a")

    ph, pl = _fractal_pivots(H, L, n=pivot_n)
    res = [z for z in _cluster([H[i] for i in ph], tol=tol) if z[1] >= 2]
    sup = [z for z in _cluster([L[i] for i in pl], tol=tol) if z[1] >= 2]
    poc, hvn, lvn = _volume_profile(C, vols, bins=vp_bins)
    volume_read = _volume_read(C, O, vols)
    structure = _structure_read(H, L, C, n=pivot_n)

    return {
        "available": True,
        "swing_high": round(swing_hi, 1),
        "swing_low": round(swing_lo, 1),
        "last": round(last, 1),
        "vwap": vwap,
        "vwap_regime": regime,
        "fib": _fib(swing_hi, swing_lo),
        "resistance": sorted(res, key=lambda z: -z[0]),  # (price, touches)
        "support": sorted(sup, key=lambda z: -z[0]),
        "poc": poc,
        "hvn": hvn,
        "lvn": lvn,
        "volume_read": volume_read,
        "structure": structure,
    }


# ============================================================ OpEx / DTE

def _third_friday(year: int, month: int) -> _dt.date:
    d = _dt.date(year, month, 1)
    # first Friday
    d += _dt.timedelta((4 - d.weekday()) % 7)
    return d + _dt.timedelta(14)


def opex_layer(today: _dt.date) -> dict:
    """Monthly (3rd-Fri) + quarterly triple-witching (Mar/Jun/Sep/Dec) dates and
    days-to-expiry; flags 0DTE / OpEx / triple-witching for today + next session."""
    # next monthly OpEx on/after today
    y, m = today.year, today.month
    tf = _third_friday(y, m)
    if tf < today:
        m += 1
        if m > 12:
            m = 1; y += 1
        tf = _third_friday(y, m)
    is_quarterly = tf.month in (3, 6, 9, 12)
    dte = (tf - today).days
    today_is_opex = tf == today
    return {
        "next_opex": tf.isoformat(),
        "next_opex_dte": dte,
        "next_opex_quarterly": is_quarterly,
        "today_is_opex": today_is_opex,
        "today_is_triple_witching": today_is_opex and is_quarterly,
        "note": ("Quarterly triple-witching — heavy gamma roll-off, expect a "
                 "regime shift after." if is_quarterly and dte <= 1 else
                 "0DTE SPX options expire every session; this flags the monthly/"
                 "quarterly OpEx where dealer positioning rolls off."),
    }


# ============================================================ GEX regime → vol edge

def _realized_range(day_bars) -> float | None:
    if day_bars is None or day_bars.empty:
        return None
    return float(day_bars["High"].max() - day_bars["Low"].min())


def gex_regime_vol_edge(history: list[dict], spx15) -> dict:
    """Consume Sentinel's staged gex_history: does the gamma regime predict the
    NEXT session's realized range? Groups prior rows by regime sign, joins each to
    the next day's 15m range, reports the mean per regime (with n)."""
    if not history or spx15 is None or spx15.empty:
        return {"available": False, "reason": "insufficient history"}
    # next-day realized range keyed by date
    by_day: dict[str, Any] = {}
    for t, r in spx15.iterrows():
        by_day.setdefault(str(t.date()), []).append((r["High"], r["Low"]))
    day_range = {d: round(max(h for h, _ in v) - min(l for _, l in v), 1)
                 for d, v in by_day.items()}
    days_sorted = sorted(day_range)

    def next_day(d: str) -> str | None:
        for x in days_sorted:
            if x > d:
                return x
        return None

    pos, neg = [], []
    for row in history:
        d = str(row.get("date", ""))[:10]
        nd = next_day(d)
        if nd is None or nd not in day_range:
            continue
        (pos if row.get("regime") == "positive" else neg).append(day_range[nd])

    def stat(xs):
        return {"n": len(xs), "avg_next_range": round(sum(xs) / len(xs), 1)} if xs else {"n": 0}

    out = {"available": bool(pos or neg), "positive_gamma": stat(pos), "negative_gamma": stat(neg)}
    p, n = out["positive_gamma"], out["negative_gamma"]
    if p.get("n") and n.get("n"):
        out["read"] = (f"Positive-gamma days averaged a {p['avg_next_range']}pt next-session "
                       f"range (n={p['n']}); negative-gamma {n['avg_next_range']}pt (n={n['n']}). "
                       "Small sample — directional context only.")
    else:
        out["read"] = "Not enough regime history yet to quantify the next-day-range edge."
    return out


# ============================================================ day/time edges

def day_time_edges(spx15) -> dict:
    """Mean 15m range + up-bias by weekday and by intraday slot (open/lunch/power)."""
    if spx15 is None or spx15.empty:
        return {"available": False}
    from collections import defaultdict
    dow_r, dow_up = defaultdict(list), defaultdict(list)
    tod_r = defaultdict(list)
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for t, r in spx15.iterrows():
        rng = float(r["High"] - r["Low"])
        dow_r[names[t.weekday()]].append(rng)
        dow_up[names[t.weekday()]].append(1 if r["Close"] >= r["Open"] else 0)
        hm = t.strftime("%H:%M")
        slot = ("open (9:30-10:15)" if hm < "10:30" else
                "midday (10:30-14:00)" if hm < "14:00" else
                "power hour (14:00-16:00)")
        tod_r[slot].append(rng)
    dow = {d: {"avg_range": round(sum(v) / len(v), 1),
               "up_pct": round(100 * sum(dow_up[d]) / len(dow_up[d]))}
           for d, v in dow_r.items() if v}
    tod = {s: round(sum(v) / len(v), 1) for s, v in tod_r.items()}
    return {"available": True, "by_weekday": dow, "by_slot": tod}


# ============================================================ level ladder + setups

def build_level_ladder(gex: dict, chart: dict, scale: dict | None = None) -> list[dict]:
    """One price axis: flip / walls / max-pain / fib / PoC / S-R / round numbers,
    each tagged with its kind, sorted high→low. The 'if price reaches X' anchors.
    ``scale`` supplies the per-underlying ``round_step`` (defaults to SPX 50)."""
    round_step = (scale or {}).get("round_step", ROUND_LEVELS_STEP)
    rows: list[dict] = []
    if gex.get("available"):
        for key, kind in (("call_wall", "GEX call wall (resistance)"),
                          ("gamma_flip", "gamma flip (regime line)"),
                          ("put_wall", "GEX put wall (support)"),
                          ("max_pain", "max pain (pin)")):
            v = gex.get(key)
            if v is not None:
                rows.append({"price": round(float(v), 1), "kind": kind, "source": "GEX"})
    if chart.get("available"):
        for lbl, v in (chart.get("fib") or {}).items():
            rows.append({"price": v, "kind": f"fib {lbl}", "source": "chart"})
        if chart.get("poc") is not None:
            rows.append({"price": chart["poc"], "kind": "volume PoC (magnet)", "source": "chart"})
        for price, touches in chart.get("resistance", [])[:3]:
            rows.append({"price": price, "kind": f"resistance ({touches}x tested)", "source": "chart"})
        for price, touches in chart.get("support", [])[:3]:
            rows.append({"price": price, "kind": f"support ({touches}x tested)", "source": "chart"})
        # round numbers near spot
        last = chart.get("last")
        if last:
            base = int(last // round_step) * round_step
            for rn in (base - round_step, base, base + round_step):
                rows.append({"price": float(rn), "kind": "round number", "source": "psych"})
    # dedup by (price rounded to 2, keep first/strongest-source order) + sort
    seen = set(); uniq = []
    for r in rows:
        k = round(r["price"])
        if k not in seen:
            seen.add(k); uniq.append(r)
    return sorted(uniq, key=lambda r: -r["price"])


# maps a ladder kind string -> a coarse dimension type + a short table label.
def _kind_dim(kind: str) -> tuple[str, str]:
    k = (kind or "").lower()
    if "call wall" in k:  return "gex_wall", "call wall"
    if "put wall" in k:   return "gex_wall", "put wall"
    if "flip" in k:       return "flip", "gamma flip"
    if "pain" in k:       return "max_pain", "max pain"
    if "poc" in k:        return "poc", "volume PoC"
    if "fib" in k:        return "fib", k.replace("(magnet)", "").strip()
    if "resistance" in k: return "sr", kind.replace(" tested)", ")").strip()
    if "support" in k:    return "sr", kind.replace(" tested)", ")").strip()
    if "round" in k:      return "round", "round number"
    return "other", kind


def build_confluence(ladder: list[dict], spot: float | None,
                     tol_pct: float = 0.15, min_dims: int = 2) -> list[dict]:
    """Cluster the ladder into confluence ZONES — a band where ≥2 DISTINCT
    dimensions stack (e.g. fib-50 + a support shelf, like today's 7423/7430).
    Only these get drawn on the chart; isolated levels live only in the table.

    Returns ``[{lo, hi, price, kinds:[label...], dims:[type...], strength, role}]``
    sorted high→low. ``role`` = resistance (above spot) / support (below) / pivot.
    """
    if not ladder:
        return []
    tol = (spot or 7000) * tol_pct / 100.0
    rows = sorted(ladder, key=lambda r: r["price"])
    # cluster around the FIRST member's price (a tight band), not chained to the
    # previous member — otherwise a run of evenly-spaced levels merges into one
    # oversized mega-zone. A level joins only if within tol of the cluster ANCHOR.
    clusters: list[list[dict]] = []
    anchors: list[float] = []
    for r in rows:
        if clusters and abs(r["price"] - anchors[-1]) <= tol:
            clusters[-1].append(r)
        else:
            clusters.append([r]); anchors.append(r["price"])
    out: list[dict] = []
    for c in clusters:
        dims = []
        labels = []
        for r in c:
            d, lbl = _kind_dim(r["kind"])
            if d not in dims:
                dims.append(d); labels.append(lbl)
        if len(dims) < min_dims:     # confluence needs ≥min_dims distinct dimensions
            continue
        prices = [r["price"] for r in c]
        lo, hi = min(prices), max(prices)
        mid = round(sum(prices) / len(prices), 1)
        role = ("resistance" if spot and mid > spot
                else "support" if spot and mid < spot else "pivot")
        out.append({"lo": round(lo, 1), "hi": round(hi, 1), "price": mid,
                    "kinds": labels, "dims": dims, "strength": len(dims), "role": role})
    return sorted(out, key=lambda z: -z["price"])


# ============================================================ durable levels (memory)

# dimension types that carry real cross-session MEMORY (a price level that keeps
# mattering). Round numbers are always "there" so they'd swamp the ranking; GEX
# levels move with the OI snapshot but we still track their persistence forward.
_DURABLE_DIMS = ("support", "resistance", "sr", "poc", "swing", "gex_wall",
                 "gamma_flip", "flip", "max_pain")


def session_levels_for_history(chart: dict, gex: dict) -> list[dict]:
    """Flatten a session's price + GEX levels into the shape ``record_levels``
    stores: ``[{price, dim, kind, source, touches?}]``. Price dims come from the
    chart (S/R shelves, PoC, swing hi/lo); GEX dims are recorded going forward so
    their persistence can be measured once enough sessions accrue."""
    out: list[dict] = []
    if chart.get("available"):
        for price, touches in chart.get("resistance", []):
            out.append({"price": price, "dim": "resistance",
                        "kind": f"resistance ({touches}x tested)", "source": "chart",
                        "touches": touches})
        for price, touches in chart.get("support", []):
            out.append({"price": price, "dim": "support",
                        "kind": f"support ({touches}x tested)", "source": "chart",
                        "touches": touches})
        if chart.get("poc") is not None:
            out.append({"price": chart["poc"], "dim": "poc",
                        "kind": "volume PoC", "source": "chart"})
        if chart.get("swing_high") is not None:
            out.append({"price": chart["swing_high"], "dim": "swing",
                        "kind": "swing high", "source": "chart"})
        if chart.get("swing_low") is not None:
            out.append({"price": chart["swing_low"], "dim": "swing",
                        "kind": "swing low", "source": "chart"})
    if gex.get("available"):
        for key, dim, kind in (("call_wall", "gex_wall", "GEX call wall"),
                               ("put_wall", "gex_wall", "GEX put wall"),
                               ("gamma_flip", "gamma_flip", "gamma flip"),
                               ("max_pain", "max_pain", "max pain")):
            v = gex.get(key)
            if v is not None:
                out.append({"price": round(float(v), 1), "dim": dim, "kind": kind,
                            "source": "GEX"})
    return out


def build_durable_levels(history: list[dict], spot: float | None,
                         tol_pct: float = 0.12, min_sessions: int = 3,
                         max_out: int = 6, max_dist_pct: float = 1.5) -> list[dict]:
    """Find levels with cross-session MEMORY — the thing a short recent window
    can't see. Clusters every recorded price (across all sessions) into bands
    (~``tol_pct`` of spot), then keeps a band that showed up on ``min_sessions``
    or more DISTINCT sessions AND sits within ``max_dist_pct`` of spot (a 0DTE
    playbook can't use a level hundreds of points away). That's a level the tape
    kept re-drawing (e.g. a shelf respected for weeks). Also scores how often
    price "respected" it — came within the band that session and closed back away.

    Returns ``[{price, lo, hi, sessions, respected, first_seen, last_seen, dims,
    kind, role, durable}]`` sorted by strength (sessions), nearest-to-spot first
    on ties. ``durable=True`` flags the promotable ones."""
    memory = [r for r in history if r.get("dim") in _DURABLE_DIMS]
    if not memory:
        return []
    tol = (spot or 7000) * tol_pct / 100.0
    max_dist = (spot or 7000) * max_dist_pct / 100.0
    rows = sorted(memory, key=lambda r: r["price"])
    # cluster around each band's anchor (first member) — same anti-mega-zone rule
    # as build_confluence.
    bands: list[list[dict]] = []
    anchors: list[float] = []
    for r in rows:
        if bands and abs(r["price"] - anchors[-1]) <= tol:
            bands[-1].append(r)
        else:
            bands.append([r]); anchors.append(r["price"])

    out: list[dict] = []
    for b in bands:
        sessions = sorted({r["session"] for r in b})
        if len(sessions) < min_sessions:
            continue
        prices = [r["price"] for r in b]
        lo, hi = min(prices), max(prices)
        mid = round(sum(prices) / len(prices), 1)
        if spot and abs(mid - spot) > max_dist:   # out of a 0DTE day's reach
            continue
        dims = sorted({r["dim"] for r in b})
        # "respected": on sessions where the day's range touched the band, did
        # price close back OUT of it (a rejection) rather than through it?
        respected = 0
        for r in b:
            dl, dh, dc = r.get("day_low"), r.get("day_high"), r.get("day_close")
            if dl is None or dh is None or dc is None:
                continue
            touched = dl <= hi and dh >= lo
            closed_out = dc < lo or dc > hi
            if touched and closed_out:
                respected += 1
        role = ("resistance" if spot and mid > spot
                else "support" if spot and mid < spot else "pivot")
        # label by the CURRENT role, not the stale recorded kind — a swing high
        # from weeks ago that price now sits above is acting as support
        # (broken resistance → support); calling it "swing high" would confuse.
        # Keep a tested-shelf's touch count if that's what it was.
        kinds = [r["kind"] for r in b]
        common = max(set(kinds), key=kinds.count)
        if "tested" in common:
            kind = f"{role} ({common.split('(')[-1]}" if "(" in common else f"{role} shelf"
        else:
            kind = f"durable {role}"
        out.append({
            "price": mid, "lo": round(lo, 1), "hi": round(hi, 1),
            "sessions": len(sessions), "respected": respected,
            "first_seen": sessions[0], "last_seen": sessions[-1],
            "dims": dims, "kind": kind, "role": role, "durable": True,
        })
    out.sort(key=lambda z: (-z["sessions"], -z["respected"],
                            abs(z["price"] - (spot or z["price"]))))
    return out[:max_out]


def _targets_from_ladder(ladder: list[dict], trigger: float | None,
                         direction: str, terminal: float | None,
                         n: int = 3) -> list[dict]:
    """The intermediate TARGET LADDER for a conditional setup: the nearest
    known levels beyond ``trigger`` in the trade ``direction`` ('down'|'up'),
    deduped (~2pt), capped at ``n``, always ending at the terminal wall. The
    levels are already computed — a setup must never say 'target not defined'
    while the ladder knows better."""
    out: list[dict] = []
    if trigger is not None:
        cand = []
        for z in ladder or []:
            p = z.get("price")
            if p is None:
                continue
            if direction == "down" and p < trigger - 1:
                cand.append((trigger - p, p, z.get("kind", "")))
            elif direction == "up" and p > trigger + 1:
                cand.append((p - trigger, p, z.get("kind", "")))
        cand.sort()
        for dist, p, kind in cand:
            if any(abs(p - q["price"]) < 2 for q in out):
                continue
            out.append({"price": round(p, 1), "kind": kind,
                        "pts_from_trigger": round(dist, 1)})
            if len(out) >= n:
                break
    if terminal is not None and trigger is not None \
            and not any(abs(terminal - q["price"]) < 2 for q in out):
        out.append({"price": round(terminal, 1),
                    "kind": "put wall" if direction == "down" else "call wall",
                    "pts_from_trigger": round(abs(terminal - trigger), 1)})
    return out


def build_setups(gex: dict, chart: dict, catalysts: dict, opex: dict,
                 label: str = "SPX", ladder: list[dict] | None = None) -> list[dict]:
    """Explicit CONDITIONAL 0DTE setups keyed to real levels. Every one is
    'IF <level/condition> THEN <structure with strikes from the ladder>'.
    ``label`` names the underlying in the trigger text (SPX | QQQ | IWM).
    ``ladder`` (build_level_ladder output) supplies each setup's intermediate
    target ladder — T1/T2 are the nearest known levels, not just the far wall."""
    setups: list[dict] = []
    if not gex.get("available"):
        return setups
    flip = gex.get("gamma_flip"); call_w = gex.get("call_wall"); put_w = gex.get("put_wall")
    spot = gex.get("spot")
    regime = gex.get("regime")

    # Catalyst-day override first (reduce size / expect expansion)
    cat = catalysts.get("today") if catalysts.get("available") else None
    if cat or opex.get("today_is_triple_witching"):
        why = cat or "triple-witching OpEx"
        setups.append({
            "trigger": f"{why} today",
            "bias": "expect bigger swings — trade smaller",
            "structure": "Big scheduled event today. Use smaller size or wait it out — "
                         "the levels are less reliable around news. Re-check after it lands.",
            "levels": {},
        })

    if flip is not None and call_w is not None and put_w is not None:
        # Positive-gamma (spot above flip): calmer tape, expect a range
        if regime == "positive":
            setups.append({
                "trigger": f"{label} stays above the {flip:.0f} line",
                "bias": "calm, range-bound day — moves tend to fade",
                "structure": f"Play the range: buy dips near {put_w:.0f}, "
                             f"sell rallies near {call_w:.0f}. Price likely bounces "
                             "between them rather than trending.",
                "levels": {"put_wall": put_w, "call_wall": call_w, "flip": flip},
                "targets": _targets_from_ladder(ladder, flip, "up", call_w),
            })
            setups.append({
                "trigger": f"{label} drops below the {flip:.0f} line",
                "bias": "day speeds up — moves can run instead of fading",
                "structure": f"Stop buying dips. Below {flip:.0f} the tape can trend "
                             f"down; {put_w:.0f} becomes the next downside target.",
                "levels": {"flip": flip, "put_wall": put_w},
                "targets": _targets_from_ladder(ladder, flip, "down", put_w),
            })
        else:
            setups.append({
                "trigger": f"{label} stays below the {flip:.0f} line",
                "bias": "faster, trendier day — go with the move",
                "structure": f"Trade with the move, not against it. {put_w:.0f} is the "
                             f"next downside target; a move back above {flip:.0f} means "
                             "things are calming down.",
                "levels": {"flip": flip, "put_wall": put_w},
                "targets": _targets_from_ladder(ladder, flip, "down", put_w),
            })
            setups.append({
                "trigger": f"{label} climbs back above the {flip:.0f} line",
                "bias": "calming down — back to a range",
                "structure": f"Above {flip:.0f}, expect a range again — sell rallies "
                             f"near {call_w:.0f}.",
                "levels": {"flip": flip, "call_wall": call_w},
                "targets": _targets_from_ladder(ladder, flip, "up", call_w),
            })
    return setups


# ============================================================ on-chart table

# short "what to expect" per dimension type — the table's action column.
# plain-English "what to expect" per dimension — no jargon, for a non-options reader.
_EXPECT = {
    "gex_wall": "price often stalls / turns here",
    "flip": "trend-change line: above = calmer, below = faster moves",
    "max_pain": "price tends to drift back here",
    "poc": "price gets stuck / chops here",
    "fib": "common bounce level",
    "sr": "held before — more touches = stronger",
    "round": "round number — orders cluster here",
}


def _nearest(levels, spot, above, n=1):
    cand = [z for z in levels if (z["price"] > spot) == above]
    cand.sort(key=lambda z: abs(z["price"] - spot))
    return cand[:n]


def build_table(ladder, confluence, gex, chart, regime, durable=None) -> dict:
    """The compact on-chart table: an ordered set of key levels (durable memory +
    confluence zones first, then flip/walls/PoC) each with a short 'expect', plus
    a one-line read, the volume note, and a structure note. Rows are
    ``{price, label, expect, role, confluence, durable, sessions}``."""
    spot = regime.get("spot") or chart.get("last")
    durable = durable or []
    rows: list[dict] = []
    seen: set = set()
    conf_bands = [(z["lo"], z["hi"]) for z in confluence]

    def _in_confluence(price):
        pad = (spot or 7000) * 0.0005  # small pad so a wall just outside still folds in
        return any(lo - pad <= price <= hi + pad for lo, hi in conf_bands)

    def _durable_at(price):
        """The durable band containing ``price`` (if any) — so a table row that
        coincides with a repeatedly-respected level can wear a ★ memory tag."""
        for z in durable:
            if z["lo"] - 0.5 <= price <= z["hi"] + 0.5:
                return z
        return None

    def add(price, label, expect, role, is_conf=False):
        k = round(price)
        if k in seen or price is None:
            return
        seen.add(k)
        dz = _durable_at(price)
        if dz:
            label = f"{label} ★{dz['sessions']}d"   # respected across N sessions
        rows.append({"price": round(float(price), 1), "label": label,
                     "expect": expect, "role": role, "confluence": is_conf,
                     "durable": bool(dz), "sessions": dz["sessions"] if dz else 0})

    # confluence zones first (the high-signal ones), marked
    for z in confluence:
        add(z["price"], " + ".join(z["kinds"][:2]) + " ✦",
            "good spot to buy dips" if z["role"] == "support" else
            "good spot to sell rallies" if z["role"] == "resistance" else "turning point",
            z["role"], True)
    # then the key GEX/structure levels — but SKIP any that already sit inside a
    # confluence zone (it's represented there), so no duplicate rows.
    for r in ladder:
        d, lbl = _kind_dim(r["kind"])
        if d in ("gex_wall", "flip", "max_pain", "poc") and not _in_confluence(r["price"]):
            role = ("resistance" if spot and r["price"] > spot
                    else "support" if spot and r["price"] < spot else "pivot")
            add(r["price"], lbl, _EXPECT.get(d, ""), role)

    # durable levels from cross-session memory that AREN'T already on the chart's
    # recent ladder — the LuxAlgo-style "level that traces back weeks and keeps
    # getting respected". These are the memory the short window can't see.
    for z in durable:
        if _in_confluence(z["price"]) or round(z["price"]) in seen:
            continue
        # add() appends the ★Nd tag itself via _durable_at — pass the bare kind so
        # the tag isn't doubled.
        add(z["price"], z["kind"],
            f"has held for {z['sessions']} days — watch it closely", z["role"])

    rows.sort(key=lambda x: -x["price"])
    # letter-key each row (A, B, C…) top→bottom so the table maps 1:1 to the
    # letter markers drawn on the chart (the user reads "gamma flip = C", finds C).
    for i, r in enumerate(rows):
        r["key"] = chr(ord("A") + i) if i < 26 else f"A{i}"

    # one-line read: regime + nearest dip-buy + nearest fade + volume
    vr = (chart.get("volume_read") or {})
    dip = _nearest(confluence, spot or 0, above=False) or _nearest(ladder, spot or 0, above=False)
    rip = _nearest(confluence, spot or 0, above=True) or _nearest(ladder, spot or 0, above=True)
    gflip = gex.get("gamma_flip") if gex.get("available") else None
    parts = []
    if gflip is not None and spot is not None:
        parts.append(f"{'above' if spot > gflip else 'below'} the {gflip:.0f} line = "
                     f"{'moves stay calm, expect a range' if spot > gflip else 'moves can run, expect momentum'}")
    if dip:
        d0 = dip[0]
        parts.append(f"buy dips near {d0.get('lo', d0['price']):.0f}-{d0.get('hi', d0['price']):.0f}"
                     if "lo" in d0 else f"support near {d0['price']:.0f}")
    if rip:
        parts.append(f"sell rallies near {rip[0]['price']:.0f}")
    read = "; ".join(parts) if parts else "no clear read"
    struct = (chart.get("structure") or {})

    return {"read": read, "rows": rows, "volume_note": vr.get("note", ""),
            "structure_note": struct.get("note", ""),
            "regime_line": (f"gamma {regime.get('gamma')}"
                            + (f" · VIX {regime['vix']:.0f}" if regime.get("vix") else ""))}


# ============================================================ assemble

def _next_session(today: _dt.date) -> _dt.date:
    d = today + _dt.timedelta(1)
    while d.weekday() >= 5:  # skip weekend (holidays not modeled here)
        d += _dt.timedelta(1)
    return d


def _default_asof(now_et: _dt.datetime) -> _dt.date:
    """The as-of date a scaffold built NOW should carry (session = the next
    trading day after it). The old default — the container's ``date.today()``
    — silently assumed an evening ET run; a run between the UTC date
    rollover (~20:00 ET) and the next close mislabeled the session one day
    forward (live 2026-07-14: a 00:03 ET rerun produced session 07-15 and
    shadowed the correct 07-14 playbook the UI needed). Rule, on the ET
    clock: after the close (or on a weekend) the scaffold serves the NEXT
    session → as-of today; before the close on a trading day it serves
    TODAY's session → as-of the previous trading day."""
    d = now_et.date()
    if now_et.weekday() >= 5 or now_et.hour >= 16:
        return d
    prev = d - _dt.timedelta(1)
    while prev.weekday() >= 5:
        prev -= _dt.timedelta(1)
    return prev


def build_playbook(today: _dt.date | None = None, store: Any = None,
                   underlying: str = "SPX") -> dict:
    """The full deterministic scaffold for ``underlying`` (SPX | QQQ | IWM). Pure
    numbers + conditional setups; no prose.

    When ``store`` is a SQLite-backed Store, this session's levels are recorded to
    ``level_history`` (building the cross-session memory) and durable levels are
    read back from history and folded into the scaffold. Per-underlying data
    symbols + price-scale constants come from the underlyings registry."""
    from . import underlyings as _u
    cfg = _u.get(underlying)
    key = underlying.upper() if underlying else "SPX"
    scale = {"round_step": cfg["round_step"], "cluster_tol": cfg["cluster_tol"]}
    if today is None:
        from zoneinfo import ZoneInfo
        today = _default_asof(_dt.datetime.now(ZoneInfo("America/New_York")))
    nxt = _next_session(today)
    bundle = sb.pull_all(today.isoformat(), nxt.isoformat(), store=store,
                         gex_symbol=cfg["gex_symbol"])

    bars = _fetch_15m(cfg["bar_symbol"])
    if cfg["self_proxy"]:
        # ETF bars carry their own volume; no SPY-volume trick needed.
        vol_by_ts = ({t: float(v) for t, v in zip(bars.index, bars["Volume"])}
                     if bars is not None and not bars.empty and "Volume" in bars else {})
    else:
        spy15 = _fetch_15m("SPY")   # SPX index has no volume — borrow SPY's
        vol_by_ts = ({t: float(v) for t, v in zip(spy15.index, spy15["Volume"])}
                     if spy15 is not None and not spy15.empty else {})
    spx15 = bars   # keep the local name the rest of the body uses

    chart = _chart_dimensions(spx15, vol_by_ts, scale=scale, pivot_n=ADOPTED_PIVOT_N)
    opex = opex_layer(today)
    vol_edge = gex_regime_vol_edge(bundle.get("gex_history", []), spx15)
    edges = day_time_edges(spx15)
    ladder = build_level_ladder(bundle["gex"], chart, scale=scale)
    setups = build_setups(bundle["gex"], chart, bundle["catalysts"], opex,
                          label=cfg["label"], ladder=ladder)

    gex = bundle["gex"]
    mc = bundle["market_context"]
    regime = {
        "gamma": gex.get("regime") if gex.get("available") else None,
        "gamma_text": gex.get("regime_text") if gex.get("available") else None,
        "spot": gex.get("spot") if gex.get("available") else chart.get("last"),
        "vwap_regime": chart.get("vwap_regime"),
        "vix": (mc.get("vol") or {}).get("vix") if mc.get("available") else None,
        "vix_band": (mc.get("vol") or {}).get("band") if mc.get("available") else None,
        "vix_term_stance": (mc.get("vol") or {}).get("stance") if mc.get("available") else None,
        "vix_contango": (mc.get("vol") or {}).get("contango") if mc.get("available") else None,
        "breadth_pct_above_50ma": (mc.get("breadth") or {}).get("pct_above_50ma") if mc.get("available") else None,
        "breadth_ad_ratio": (mc.get("breadth") or {}).get("ad_ratio") if mc.get("available") else None,
        "intermarket": mc.get("intermarket") if mc.get("available") else None,
        "market_bullets": mc.get("bullets") if mc.get("available") else None,
    }
    spot = regime.get("spot")

    # cross-session memory: record this session's levels, then read durable ones
    # back from history. Best-effort — never let the store break the scaffold.
    durable: list[dict] = []
    if store is not None and getattr(store, "uses_sqlite", False):
        try:
            day = None
            if spx15 is not None and not spx15.empty:
                td = spx15[[t.date() == today for t in spx15.index]]
                if not td.empty:
                    day = {"high": round(float(td["High"].max()), 2),
                           "low": round(float(td["Low"].min()), 2),
                           "close": round(float(td["Close"].iloc[-1]), 2)}
            store.record_levels(today.isoformat(), key,
                                session_levels_for_history(chart, gex), day=day)
            hist = store.load_level_history(key)
            durable = build_durable_levels(hist, spot)
        except Exception:  # noqa: BLE001 — memory is additive, not load-bearing
            durable = []

    confluence = build_confluence(ladder, spot)
    table = build_table(ladder, confluence, gex, chart, regime, durable)
    return {
        "symbol": key,
        "proxy": cfg["proxy_symbol"],
        "session": nxt.isoformat(),
        "generated_for": today.isoformat(),
        "regime": regime,
        "sectors": (mc.get("sectors") or []) if mc.get("available") else [],
        "confluence": confluence,
        "durable": durable,
        "table": table,
        "level_ladder": ladder,
        "setups": setups,
        "catalysts": bundle["catalysts"],
        "opex": opex,
        "edges": {
            "gex_regime_next_day_range": vol_edge,
            "day_time": edges,
            "zone_hit_rate": (bundle["zone_scorecard"].get("sources", {}).get("sentinel")
                              if bundle["zone_scorecard"].get("available") else None),
        },
        "chart": chart,
        "missing": bundle["missing"],
        "caveats": [
            "The dealer-gamma (GEX) read is computed from overnight open interest and is "
            f"BLIND to 0DTE positioning — roughly half of {cfg['label']} option volume. Treat "
            "it as context, not a guarantee.",
            "Context for reading the tape, NOT a signal (ADR-008). Places no orders "
            "(ADR-010). Not financial advice.",
        ],
    }


# ============================================================ CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.spx_playbook",
        description="Daily 0DTE SPX playbook scaffold (reads Sentinel intel + SPX 15m "
                    "bars; writes the playbook to the store). Context, not a signal.")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--symbol", default="SPX",
                   help="underlying: SPX (default) | QQQ | IWM")
    p.add_argument("--as-of", help="ISO date to generate for (default: today ET)")
    p.add_argument("--dry-run", action="store_true", help="print the scaffold, write nothing")
    p.add_argument("--backfill-days", type=int, metavar="N",
                   help="seed level_history with ~N days of price-based levels "
                        "recomputed from historical bars, then exit")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    data_dir = resolve_data_dir(args.data_dir)
    # None → build_playbook's ET-clock default (pre-close run = today's session)
    today = _dt.date.fromisoformat(args.as_of) if args.as_of else None

    from .store import Store
    store = Store(data_dir)

    from . import underlyings as _u
    cfg = _u.get(args.symbol)
    key = args.symbol.upper()

    if args.backfill_days:
        if not getattr(store, "uses_sqlite", False):
            print("--backfill-days requires the SQLite backend (a vantage.db)")
            return EXIT_USER_ERROR
        n = backfill_price_levels(store, days=args.backfill_days, until=today,
                                  symbol=cfg["bar_symbol"], record_as=key)
        print(f"seeded {key} level_history with {n} level rows across the last "
              f"~{args.backfill_days} days")
        return EXIT_OK

    scaffold = build_playbook(today, store=store, underlying=key)

    reg = scaffold["regime"]
    print(f"{key} 0DTE playbook for {scaffold['session']} "
          f"(gamma {reg['gamma']}, spot {reg['spot']}, VIX {reg['vix']}):")
    for r in scaffold["level_ladder"]:
        print(f"  {r['price']:>8.1f}  {r['kind']}")
    dn = len(scaffold.get("durable", []))
    print(f"  {len(scaffold['setups'])} conditional setup(s); {dn} durable level(s); "
          f"missing sources: {scaffold['missing'] or 'none'}")

    if args.dry_run:
        import json
        print(json.dumps(scaffold, indent=2, default=str))
        print("[dry-run] nothing written")
        return EXIT_OK

    store.upsert_spx_playbook(scaffold["generated_for"], scaffold, symbol=key)
    print(f"wrote {key} playbook for {scaffold['generated_for']} to the store")
    # Pine (playbook + reclaim indicators) is generated on demand from the
    # stored scaffold and served as TEXT via the API for the UI to copy — no
    # .pine files are written to disk anymore.
    return EXIT_OK


def _fetch_daily_range(symbol: str, days: int):
    """Daily SPX bars for ~``days`` calendar days back (yfinance daily has years
    of history, unlike the 60-day intraday cap). Used only by the backfill."""
    import yfinance as yf  # noqa: PLC0415

    period = f"{max(days + 30, 90)}d"   # pad so the trailing window has context
    df = yf.Ticker(symbol).history(period=period, interval="1d")
    if df.empty:
        return df
    df = df.copy()
    df.index = df.index.tz_convert("America/New_York")
    return df


def backfill_price_levels(store, days: int = 90, until: _dt.date | None = None,
                          symbol: str = "^GSPC", window: int = 20,
                          record_as: str = "SPX") -> int:
    """Seed ``level_history`` with PRICE-based durable levels recomputed per
    historical session from daily SPX bars. For each session in the window we
    take the trailing ``window`` daily bars and derive: fractal S/R shelves (with
    touch counts), the swing high/low, and the session's own OHLC (so the durable
    detector can later score whether price respected each level). GEX is NOT
    back-seeded — no archived option-chain OI exists for past dates (it accrues
    forward from the nightly job). Returns the number of level rows written.

    Idempotent: re-running replaces each session's rows (PRIMARY KEY on
    session/symbol/dim/price)."""
    until = until or _dt.date.today()
    df = _fetch_daily_range(symbol, days)
    if df is None or df.empty:
        return 0
    H = list(df["High"]); L = list(df["Low"]); C = list(df["Close"])
    dates = [t.date() for t in df.index]
    start = until - _dt.timedelta(days=days)
    written = 0
    for i in range(len(dates)):
        d = dates[i]
        if d < start or d > until:
            continue
        w0 = max(0, i - window + 1)
        wh, wl, wc = H[w0:i + 1], L[w0:i + 1], C[w0:i + 1]
        if len(wh) < 5:
            continue
        ph, pl = _fractal_pivots(wh, wl, n=2)
        res = [z for z in _cluster([wh[j] for j in ph]) if z[1] >= 2]
        sup = [z for z in _cluster([wl[j] for j in pl]) if z[1] >= 2]
        levels: list[dict] = []
        for price, touches in sorted(res, key=lambda z: -z[0])[:4]:
            levels.append({"price": price, "dim": "resistance",
                           "kind": f"resistance ({touches}x tested)",
                           "source": "chart", "touches": touches})
        for price, touches in sorted(sup, key=lambda z: -z[0])[:4]:
            levels.append({"price": price, "dim": "support",
                           "kind": f"support ({touches}x tested)",
                           "source": "chart", "touches": touches})
        levels.append({"price": round(max(wh), 1), "dim": "swing",
                       "kind": "swing high", "source": "chart"})
        levels.append({"price": round(min(wl), 1), "dim": "swing",
                       "kind": "swing low", "source": "chart"})
        day = {"high": round(float(H[i]), 2), "low": round(float(L[i]), 2),
               "close": round(float(C[i]), 2)}
        written += store.record_levels(d.isoformat(), record_as, levels, day=day)
    return written


#: Pine indicators (playbook + prefilled reclaim) are NO LONGER written to
#: disk. They are generated on demand from the stored scaffold and served as
#: TEXT by the API (/api/spx/playbook/pine and /api/spx/reclaim/pine) for the
#: UI to copy. See playbook_pine.build_playbook_pine and
#: reclaim_pine.build_reclaim_indicator_for for the generators.


if __name__ == "__main__":
    raise SystemExit(main())
