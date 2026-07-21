"""odte_read — the 0DTE implied-vs-realized read (odte_research Phase A).

The single most important 0DTE question, per the vendored research system:
is the market charging MORE for today's movement than it has been delivering
(sell premium), LESS (buy / stand aside), or about right? This module answers
it deterministically from our own data:

  implied  — ATM straddle mid from the LATEST chain_snaps tick (the recorder's
             archive; Alpaca data). ATM = the strike whose call delta is
             nearest 0.50 — self-contained, no external spot needed.
  realized — median absolute close-to-close move over the last 20 sessions
             (daily bars via the existing yf_bars fetcher).

Verdict thresholds follow the research system's calibrated bands (vol_bot):
ratio > 1.15 → SELL tilt; < 0.85 → BUY tilt; between → STAND DOWN — sitting
out is a first-class decision. Deterministic math; Mira may narrate, never
compute (ADR-008 posture). Read-only.
"""
from __future__ import annotations

import datetime as _dt

SELL_RATIO = 1.15
BUY_RATIO = 0.85
STALE_MINUTES = 20   # a read older than this during RTH is flagged degraded


def _latest_tick(store, underlying: str) -> list[dict]:
    """All contract rows of the most recent snapshot tick for the underlying's
    nearest recorded expiry."""
    conn = store._backend._conn()
    try:
        row = conn.execute(
            "SELECT expiry, MAX(snapped_at) AS snapped_at FROM chain_snaps"
            " WHERE underlying=? GROUP BY expiry ORDER BY expiry LIMIT 1",
            (underlying,)).fetchone()
        if not row:
            return []
        return [dict(r) for r in conn.execute(
            "SELECT * FROM chain_snaps WHERE underlying=? AND expiry=?"
            " AND snapped_at=?",
            (underlying, row["expiry"], row["snapped_at"])).fetchall()]
    finally:
        conn.close()


def _mid(r: dict) -> float | None:
    b, a = r.get("bid"), r.get("ask")
    if b is None or a is None or (b <= 0 and a <= 0):
        return None
    return (float(b) + float(a)) / 2.0


def implied_from_chain(rows: list[dict]) -> dict | None:
    """ATM straddle read from one snapshot tick. ATM = call delta nearest 0.50
    when greeks are present; otherwise (Alpaca's indicative feed omits greeks
    intraday) the strike where call-mid ≈ put-mid — put-call parity pins the
    spot there. Spot is estimated as that strike (± half a strike step)."""
    calls = {r["strike"]: r for r in rows if r.get("right") == "C"}
    puts = {r["strike"]: r for r in rows if r.get("right") == "P"}
    scored = [(abs((c.get("delta") or 0) - 0.5), k) for k, c in calls.items()
              if c.get("delta") is not None and k in puts]
    if not scored:
        # delta-free fallback: min |call mid − put mid| across strikes with
        # two-sided quotes on both rights.
        scored = []
        for k, c in calls.items():
            p = puts.get(k)
            if p is None:
                continue
            cm, pm = _mid(c), _mid(p)
            if cm is None or pm is None:
                continue
            scored.append((abs(cm - pm), k))
    if not scored:
        return None
    _, atm = min(scored)
    cm, pm = _mid(calls[atm]), _mid(puts[atm])
    if cm is None or pm is None:
        return None
    straddle = cm + pm
    return {"atm_strike": atm, "spot_est": atm, "straddle_usd": round(straddle, 2),
            "implied_move_pct": round(straddle / atm * 100, 3),
            "atm_iv": calls[atm].get("iv"),
            "snapped_at": rows[0].get("snapped_at"),
            "expiry": rows[0].get("expiry"), "source": rows[0].get("source")}


def _session_fraction_remaining() -> float | None:
    """Fraction of the RTH session (9:30–16:00 ET) still ahead; 1.0 pre-open,
    None after the close or on weekends (an overnight read prices the FULL next
    session, so scaling doesn't apply)."""
    et = _dt.datetime.now(_dt.timezone.utc).astimezone(
        _dt.timezone(_dt.timedelta(hours=-4)))
    if et.weekday() >= 5:
        return None
    mins = et.hour * 60 + et.minute
    if mins <= 9 * 60 + 30:
        return 1.0
    if mins >= 16 * 60:
        return None
    return round((16 * 60 - mins) / 390.0, 3)


def realized_baseline(underlying: str, sessions: int = 20) -> float | None:
    """Median |close-to-close| daily move (%) over the last N sessions."""
    from .yf_bars import fetch_historicals
    start = (_dt.date.today() - _dt.timedelta(days=sessions * 2 + 10)).isoformat()
    try:
        bars = fetch_historicals(underlying, start_time=start, interval="day")
    except Exception:  # noqa: BLE001 — yfinance flakiness → honest None
        return None
    closes = [b.get("close") for b in bars if b.get("close")]
    if len(closes) < 8:
        return None
    moves = [abs(closes[i] / closes[i - 1] - 1) * 100
             for i in range(1, len(closes))][-sessions:]
    moves.sort()
    return round(moves[len(moves) // 2], 3)


def build_read(store, underlying: str = "SPY") -> dict:
    """The full read: implied vs realized + verdict + staleness contract."""
    rows = _latest_tick(store, underlying.upper())
    imp = implied_from_chain(rows) if rows else None
    if not imp:
        return {"available": False,
                "note": f"no recorded chain for {underlying} yet — the recorder "
                        "fills chain_snaps every 5 min during RTH"}
    real = realized_baseline(underlying.upper())
    age_min = None
    try:
        snapped = _dt.datetime.fromisoformat(imp["snapped_at"])
        age_min = round((_dt.datetime.now(_dt.timezone.utc) - snapped)
                        .total_seconds() / 60, 1)
    except (TypeError, ValueError):
        pass
    # Intraday, the straddle prices only the REST of the session, so the
    # full-day realized baseline must be scaled by √(fraction remaining) —
    # otherwise every afternoon reading skews "movement is cheap".
    frac = _session_fraction_remaining()
    real_scaled = (round(real * (frac ** 0.5), 3)
                   if (real is not None and frac is not None) else real)
    out = {"available": True, "underlying": underlying.upper(), **imp,
           "realized_med_pct": real, "realized_scaled_pct": real_scaled,
           "session_fraction_remaining": frac,
           "age_minutes": age_min,
           "degraded": bool(age_min is not None and age_min > STALE_MINUTES),
           "ratio": None, "verdict": "NO BASELINE",
           "verdict_note": "realized baseline unavailable (bars fetch failed)"}
    real = real_scaled if real_scaled else real
    if real and real > 0:
        ratio = round(imp["implied_move_pct"] / real, 2)
        out["ratio"] = ratio
        if ratio > SELL_RATIO:
            out["verdict"] = "SELL PREMIUM"
            out["verdict_note"] = (f"options price a {imp['implied_move_pct']}% move; "
                                   f"the market has been delivering ~{real}% — "
                                   "movement is overpriced")
        elif ratio < BUY_RATIO:
            out["verdict"] = "BUY / LONG VOL"
            out["verdict_note"] = (f"options price {imp['implied_move_pct']}% vs "
                                   f"~{real}% delivered — movement is cheap")
        else:
            out["verdict"] = "STAND DOWN"
            out["verdict_note"] = ("implied ≈ realized — no vol edge either way; "
                                   "sitting out is a position")
    return out


def _demo() -> None:
    rows = [
        {"right": "C", "strike": 743.0, "bid": 2.02, "ask": 2.05, "delta": 0.447,
         "iv": 0.156, "snapped_at": "2026-07-21T02:40:41+00:00",
         "expiry": "2026-07-21", "source": "alpaca-indicative"},
        {"right": "P", "strike": 743.0, "bid": 2.72, "ask": 2.79, "delta": -0.556},
        {"right": "C", "strike": 742.0, "bid": 2.59, "ask": 2.62, "delta": 0.512},
        {"right": "P", "strike": 742.0, "bid": 2.35, "ask": 2.37, "delta": -0.488},
    ]
    imp = implied_from_chain(rows)
    # 742C delta .512 is nearer .50 than 743C .447 → ATM 742; straddle 2.605+2.36
    assert imp["atm_strike"] == 742.0, imp
    assert abs(imp["straddle_usd"] - 4.97) < 0.02, imp
    assert abs(imp["implied_move_pct"] - 0.669) < 0.01, imp
    # verdict banding
    assert SELL_RATIO > 1 > BUY_RATIO
    print("odte_read._demo OK")


if __name__ == "__main__":
    _demo()
