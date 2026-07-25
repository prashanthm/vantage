"""Wave-3 pre-registered formula candidates. Each entry: (name, builder,
predicted IC sign, rationale). REGISTERED BEFORE ANY IC WAS COMPUTED — the
log commit precedes the run; predictions are part of the record.

Sign convention: predicted sign of the mean Spearman IC between the signal
value and the next-day (7-hourly-bar) forward return, cross-sectionally."""
from formula_signals import (delay, ts_ret, ts_mean, ts_std, ts_min, ts_max,
                             decay_linear, zscore)


def _rp(p):
    """range position 0..1 over n=35"""
    lo, hi = ts_min(p["low"], 35), ts_max(p["high"], 35)
    return (p["close"] - lo) / (hi - lo)


CANDIDATES = [
    ("mom_1m", lambda p: ts_ret(p["close"], 140), +1,
     "classic 1-month momentum: winners keep winning at this horizon"),
    ("mom_1w", lambda p: ts_ret(p["close"], 35), +1,
     "1-week momentum — shorter echo of the same effect"),
    ("rev_1d", lambda p: ts_ret(p["close"], 7), -1,
     "1-day reversal: yesterday's cross-sectional winners mean-revert"),
    ("lowvol", lambda p: ts_std(ts_ret(p["close"], 7), 35), -1,
     "low-volatility anomaly: calm names outperform jumpy ones"),
    ("near_high", lambda p: p["close"] / ts_max(p["high"], 140), +1,
     "proximity to the 1-month high — the 52-week-high effect, scaled down"),
    ("range_pos", _rp, +1,
     "position inside the 1-week range: closing near the top = demand"),
    ("accel", lambda p: ts_ret(p["close"], 35) - delay(ts_ret(p["close"], 35), 35), +1,
     "momentum acceleration: improving momentum beats fading momentum"),
    ("dist_ma", lambda p: p["close"] / ts_mean(p["close"], 140) - 1, +1,
     "distance above the 1-month mean — trend persistence"),
    ("smooth_mom", lambda p: decay_linear(ts_ret(p["close"], 7), 35), +1,
     "linearly-decayed daily returns: recent-weighted momentum, less noise"),
    ("compress", lambda p: ts_mean(p["high"] - p["low"], 7) / ts_mean(p["high"] - p["low"], 35), -1,
     "range compression precedes continuation: quiet names outperform next"),
    ("z_trend", lambda p: zscore(p["close"], 140), +1,
     "1-month z-score of price: standardized trend"),
    ("mr_z1w", lambda p: zscore(p["close"], 35), -1,
     "1-week stretch mean-reverts even inside longer trends"),
    ("intraday_str", lambda p: ts_mean((p["close"] - p["open"]) / p["open"], 35), +1,
     "persistent intra-bar buying (close over open) = real demand"),
    ("close_loc", lambda p: ts_mean((p["close"] - p["low"]) / (p["high"] - p["low"]), 35), +1,
     "bars closing near their highs = buyers finishing in control"),
    ("lottery_max", lambda p: ts_max(ts_ret(p["close"], 7), 140), -1,
     "MAX effect: names with a recent lottery-like day underperform"),
    ("mom_skip", lambda p: ts_ret(delay(p["close"], 35), 105), +1,
     "momentum measured skipping the latest week (12-1 style)"),
    ("recency_tilt", lambda p: decay_linear(p["close"], 35) / ts_mean(p["close"], 35) - 1, +1,
     "recency-weighted vs equal-weighted mean: fresh strength"),
    ("rising_lows", lambda p: ts_min(p["low"], 35) / delay(ts_min(p["low"], 35), 35) - 1, +1,
     "rising lows: the market structure definition of an uptrend"),
]
