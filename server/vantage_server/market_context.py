"""Native Market Context — breadth + VIX term structure + sector rotation +
intermarket macro, computed by Vantage itself (no Sentinel dependency).

Replaces the retired ``/sentinel/logs/market_context.json`` artifact that
``sentinel_bridge.market_context()`` used to read. Context for reading the tape
only (ADR-008); computes nothing that places an order (ADR-010).

Data sources, by reliability:
  - breadth + sector rotation: STORED daily bars for the 11 SPDR sector ETFs
    (+ SPY), via Store.load_bars — cached, offline-friendly.
  - VIX term structure + intermarket (DXY/10Y/oil/gold): LIVE yfinance daily
    fetch (these aren't primed in the store). Each block degrades to
    ``available: false`` on a fetch miss — never raises into the playbook.

Everything is CLOSE/DAILY only. Free delayed data can't give reliable intraday
TICK/ADD, so this module doesn't pretend to (goal: market-context-native).
"""
from __future__ import annotations

from typing import Any

# The 11 S&P sector SPDRs — the breadth basket + rotation universe.
SECTOR_ETFS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLB", "XLU", "XLRE", "XLC"]
SECTOR_NAMES = {
    "XLK": "Technology", "XLF": "Financials", "XLE": "Energy", "XLV": "Health Care",
    "XLI": "Industrials", "XLY": "Cons. Discretionary", "XLP": "Cons. Staples",
    "XLB": "Materials", "XLU": "Utilities", "XLRE": "Real Estate", "XLC": "Communication",
}
# Intermarket symbols → label (yfinance tickers).
INTERMARKET = {"DX-Y.NYB": "dxy", "^TNX": "tnx", "CL=F": "oil", "GC=F": "gold",
               "HYG": "hyg"}

#: SHOCK-ECHO thresholds (context-forecast-edge goal, frozen 3y daily, shuffle
#: p<.005, monotone): a big DXY / credit move is followed by an outsized-RANGE
#: SPX day — dxy ≥0.8% → 1.38× (n=37), hyg ≥0.7% → 1.76× (n=27). RANGE only:
#: direction failed controls for every driver tested (oil was a 0.49 coin).
SHOCK_ECHO = {"dxy": (0.8, 1.4, "the dollar"), "hyg": (0.7, 1.8, "credit (HYG)")}


def _closes(daily: list[dict]) -> list[float]:
    return [float(b["close"]) for b in daily if b.get("close") is not None]


def _sma(xs: list[float], n: int) -> float | None:
    return sum(xs[-n:]) / n if len(xs) >= n else None


def _pct_chg(daily: list[dict]) -> float | None:
    """Last close-to-close % change."""
    c = _closes(daily)
    if len(c) < 2 or c[-2] == 0:
        return None
    return round((c[-1] / c[-2] - 1.0) * 100, 2)


# ------------------------------------------------------------------ breadth + sectors

def _breadth_and_sectors(load_bars) -> tuple[dict, list[dict]]:
    """% of sector ETFs above their 50-day SMA (breadth proxy), advance-decline
    ratio (up vs down on the day), 20d new highs/lows — plus each sector's
    trailing 20d return for rotation. Store-backed; degrades per-symbol."""
    above = below = adv = dec = nh = nl = counted = 0
    sectors: list[dict] = []
    for etf in SECTOR_ETFS:
        data = load_bars(etf)
        daily = data.get("daily") if isinstance(data, dict) else None
        if not daily:
            continue
        closes = _closes(daily)
        if len(closes) < 51:
            continue
        counted += 1
        last = closes[-1]
        sma50 = _sma(closes, 50)
        if sma50 is not None:
            if last >= sma50:
                above += 1
            else:
                below += 1
        chg = _pct_chg(daily)
        if chg is not None:
            if chg > 0:
                adv += 1
            elif chg < 0:
                dec += 1
        window = closes[-20:]
        if last >= max(window):
            nh += 1
        if last <= min(window):
            nl += 1
        ret20 = round((last / closes[-21] - 1.0) * 100, 2) if len(closes) >= 21 and closes[-21] else None
        sectors.append({"etf": etf, "name": SECTOR_NAMES.get(etf, etf),
                        "chg_pct": chg, "ret_20d_pct": ret20,
                        "above_50ma": (sma50 is not None and last >= sma50)})
    if counted == 0:
        return {"available": False}, []
    sectors.sort(key=lambda s: (s["ret_20d_pct"] is None, -(s["ret_20d_pct"] or 0)))
    breadth = {
        "available": True,
        "counted": counted,
        "pct_above_50ma": round(above / counted * 100, 1) if counted else None,
        "ad_ratio": round(adv / dec, 2) if dec else (float(adv) if adv else None),
        "advances": adv, "declines": dec,
        "new_highs_20d": nh, "new_lows_20d": nl,
    }
    return breadth, sectors


# ------------------------------------------------------------------ VIX term structure

def _fetch_daily_closes(symbol: str, period: str = "10d") -> list[float]:
    """Live daily closes for a non-stored symbol (VIX/macro). Best-effort — [] on miss."""
    try:
        import yfinance as yf  # noqa: PLC0415
        df = yf.Ticker(symbol).history(period=period, interval="1d")
        if df is None or df.empty or "Close" not in df:
            return []
        return [float(x) for x in df["Close"].tolist() if x == x]  # drop NaN
    except Exception:  # noqa: BLE001 — live fetch is additive, never load-bearing
        return []


def _vol_block() -> dict:
    """VIX level + band + VIX/VIX3M term structure (contango = calm, backwardation
    = stress). ``contango`` is (vix3m - vix); positive = normal, negative = fear."""
    vix_c = _fetch_daily_closes("^VIX")
    vix3m_c = _fetch_daily_closes("^VIX3M")
    if not vix_c:
        return {"available": False}
    vix = round(vix_c[-1], 2)
    band = ("calm" if vix < 15 else "normal" if vix < 20
            else "elevated" if vix < 28 else "high")
    out = {"available": True, "vix": vix, "band": band, "vix3m": None,
           "contango": None, "stance": None}
    if vix3m_c:
        vix3m = round(vix3m_c[-1], 2)
        contango = round(vix3m - vix, 2)
        out.update({"vix3m": vix3m, "contango": contango,
                    "stance": "contango" if contango >= 0 else "backwardation"})
    return out


# ------------------------------------------------------------------ intermarket

def _intermarket_block() -> dict:
    """DXY / 10Y yield / oil / gold — daily level + % change. Live-fetched;
    per-symbol degradation (a missing one is null, not a failed block)."""
    out: dict[str, Any] = {"available": False}
    got = False
    for sym, label in INTERMARKET.items():
        closes = _fetch_daily_closes(sym)
        if len(closes) < 2 or closes[-2] == 0:
            out[label] = None
            continue
        got = True
        out[label] = {"level": round(closes[-1], 2),
                      "chg_pct": round((closes[-1] / closes[-2] - 1.0) * 100, 2)}
    out["available"] = got
    return out


# ------------------------------------------------------------------ bullets + compose

def _bullets(breadth: dict, sectors: list[dict], vol: dict, inter: dict) -> list[str]:
    b: list[str] = []
    if breadth.get("available") and breadth.get("pct_above_50ma") is not None:
        p = breadth["pct_above_50ma"]
        tone = "broad" if p >= 60 else "narrow" if p <= 40 else "mixed"
        b.append(f"Breadth {tone}: {p}% of sectors above their 50-day "
                 f"(A/D {breadth.get('ad_ratio')}, {breadth.get('new_highs_20d')} new-high / "
                 f"{breadth.get('new_lows_20d')} new-low sectors).")
    if vol.get("available"):
        if vol.get("stance"):
            b.append(f"VIX {vol['vix']} ({vol['band']}); term structure in "
                     f"{vol['stance']} ({vol['contango']:+} vs VIX3M) — "
                     f"{'calm' if vol['stance'] == 'contango' else 'stress: near-term fear bid'}.")
        else:
            b.append(f"VIX {vol['vix']} ({vol['band']}).")
    if sectors:
        lead = sectors[0]
        b.append(f"Sector leadership: {lead['name']} (+{lead['ret_20d_pct']}% 20d) leads, "
                 f"{sectors[-1]['name']} lags.")
    if inter.get("available"):
        parts = [f"{k.upper()} {v['chg_pct']:+}%" for k, v in inter.items()
                 if isinstance(v, dict)]
        if parts:
            b.append("Intermarket: " + ", ".join(parts) + ".")
        # validated shock echo — RANGE information only, never a direction lean
        for key, (thr, mult, name) in SHOCK_ECHO.items():
            v = inter.get(key)
            if isinstance(v, dict) and v.get("chg_pct") is not None and abs(v["chg_pct"]) >= thr:
                b.append(f"{name.capitalize()} just moved {v['chg_pct']:+}% — SPX days "
                         f"after shocks like this run ~{mult}× the usual range "
                         f"(validated). Expect wider swings; this says nothing "
                         f"about direction.")
    return b


def market_context(*, data_dir: str | None = None, live_macro: bool = True) -> dict:
    """The native Market Context read. Same top-level shape the playbook already
    consumes (``breadth``, ``sectors``, ``vol``, ``bullets``) plus a new
    ``intermarket`` block. ``live_macro=False`` skips the yfinance fetches (for
    offline tests) — breadth+sectors still populate from the store."""
    from .store import Store, resolve_data_dir
    store = Store(resolve_data_dir(data_dir))
    breadth, sectors = _breadth_and_sectors(store.load_bars)
    vol = _vol_block() if live_macro else {"available": False}
    inter = _intermarket_block() if live_macro else {"available": False}
    available = bool(breadth.get("available") or vol.get("available"))
    return {
        "available": available,
        "source": "vantage-native",
        "breadth": breadth,
        "sectors": sectors,
        "vol": vol,
        "intermarket": inter,
        "bullets": _bullets(breadth, sectors, vol, inter),
    }


def validated_edges(regime: dict) -> list[str]:
    """The market-context-native goal's two CONFIRMED next-day edges, as plan
    callouts. One source of truth — the forecast snapshot AND the playbook
    both render these. Range/vol edges + one direction lean; never targets
    (targets stay with the level book)."""
    edges = []
    if regime.get("vix_term_stance") == "backwardation" or (
            regime.get("vix_contango") is not None and regime["vix_contango"] < 0):
        edges.append("VIX term structure INVERTED (backwardation) — validated: "
                     "days like this run ~2.4× the usual range. Expect wider "
                     "swings; widen expected ranges and invalidations.")
    bp = regime.get("breadth_pct_above_50ma")
    if bp is not None and bp < 40:
        edges.append(f"Breadth NARROW ({bp}% of sectors above their 50-day) — "
                     "validated: next day runs ~1.7× range and closes UP 2 times "
                     "in 3 (washed-tape bounce lean). Context, not a target.")
    return edges


def _demo() -> None:
    """Self-check: breadth math + term-structure stance are correct without any
    network. Uses synthetic bars so it runs offline."""
    def fake_daily(closes):
        return {"daily": [{"close": c} for c in closes]}

    # 3 sectors: two above their 50-SMA & up, one below & down.
    up = list(range(1, 60))                      # rising → last >= sma50, new 20d high
    down = list(range(60, 1, -1))                # falling → below sma50, new 20d low
    bars = {"XLK": fake_daily(up), "XLF": fake_daily(up), "XLE": fake_daily(down)}
    breadth, sectors = _breadth_and_sectors(lambda s: bars.get(s))
    assert breadth["counted"] == 3, breadth
    assert breadth["pct_above_50ma"] == round(2 / 3 * 100, 1), breadth
    assert breadth["advances"] == 2 and breadth["declines"] == 1, breadth
    assert breadth["new_highs_20d"] == 2 and breadth["new_lows_20d"] == 1, breadth
    assert len(sectors) == 3 and sectors[0]["ret_20d_pct"] >= sectors[-1]["ret_20d_pct"]

    # term structure: vix3m > vix → contango; vix > vix3m → backwardation.
    def stance(vix, vix3m):
        contango = round(vix3m - vix, 2)
        return "contango" if contango >= 0 else "backwardation"
    assert stance(14, 17) == "contango"
    assert stance(30, 24) == "backwardation"

    # offline compose never raises and marks macro unavailable.
    ctx = market_context(live_macro=False)
    assert ctx["source"] == "vantage-native"
    assert ctx["vol"]["available"] is False and ctx["intermarket"]["available"] is False
    print("market_context self-check OK")


if __name__ == "__main__":
    _demo()
