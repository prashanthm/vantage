"""SPX dealer gamma exposure (GEX) — computed natively in Vantage.

Ported from the proven Sentinel implementation so Vantage no longer depends on
Sentinel's GEX file. The mechanics are real (dealer hedging flows depend on their
net gamma; positive-gamma regimes measurably dampen realized vol), but the SIGN
CONVENTION every public GEX product shares is unverifiable from the tape: we
ASSUME dealers are long the calls and short the puts customers traded (+calls,
−puts). That assumption is stated on every surface this feeds.

Internally consistent by construction: the regime label is DERIVED from the net
GEX sign (cannot contradict it); the flip point is a re-priced zero crossing (not
a hardcoded level); walls are constrained to opposite sides of spot.

Per contract, dollar gamma per 1% move: Γ_BS × OI × 100 × S² × 0.01. Expirations
≤ MAX_DTE (60) — the near book is where hedging pressure lives. This is the same
OI-based read every public GEX uses, so it is BLIND to 0DTE positioning (~half of
SPX volume) and cannot be back-seeded — it accrues forward, one snapshot per run.

Data source is yfinance (same as the rest of Vantage). Writes to the Vantage
store (gex_snapshot + gex_history), read via ``sentinel_bridge.gex_snapshot``.
Context, not a signal (ADR-010 read-only; no orders).

CLI: ``python -m vantage_server.gex [--data-dir D] [--dry-run]``.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import math
import sys
from zoneinfo import ZoneInfo

from .store import Store, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2

ET = ZoneInfo("America/New_York")

MAX_DTE = 60
MAX_EXPIRATIONS = 10
RISK_FREE = 0.04
CONTRACT_MULT = 100
SWEEP_PCT = 0.15          # flip search: spot ±15%
SWEEP_STEPS = 121
LADDER_STRIKES = 24
MIN_BOOK_CONTRACTS = 500  # below this the ^SPX chain's OI is unusable (use SPY)


# ── pure GEX math (ported verbatim — internally consistent) ──────────────────

def bs_gamma(spot: float, strike: float, iv: float, t_years: float,
             r: float = RISK_FREE) -> float:
    """Black-Scholes gamma (same for calls and puts)."""
    if spot <= 0 or strike <= 0 or iv <= 0 or t_years <= 0:
        return 0.0
    d1 = (math.log(spot / strike) + (r + iv * iv / 2) * t_years) / (iv * math.sqrt(t_years))
    phi = math.exp(-d1 * d1 / 2) / math.sqrt(2 * math.pi)
    return phi / (spot * iv * math.sqrt(t_years))


def contract_gex(spot: float, strike: float, iv: float, t_years: float,
                 oi: float, is_call: bool) -> float:
    """Dollar GEX per 1% spot move, standard sign convention (+calls, −puts)."""
    g = bs_gamma(spot, strike, iv, t_years) * oi * CONTRACT_MULT * spot * spot * 0.01
    return g if is_call else -g


def _book_gex(book: list[dict], spot: float) -> float:
    return sum(contract_gex(spot, c["strike"], c["iv"], c["t"], c["oi"], c["is_call"])
               for c in book)


def gex_curve(book: list[dict], spot: float) -> list[tuple[float, float]]:
    """Net GEX re-priced across a spot sweep: [(level, net_gex), ...]."""
    lo, hi = spot * (1 - SWEEP_PCT), spot * (1 + SWEEP_PCT)
    step = (hi - lo) / (SWEEP_STEPS - 1)
    return [(lo + i * step, _book_gex(book, lo + i * step)) for i in range(SWEEP_STEPS)]


def gamma_flip(curve: list[tuple[float, float]], spot: float) -> float | None:
    """Spot level where net GEX crosses zero (nearest to spot)."""
    crossings = []
    for (l0, v0), (l1, v1) in zip(curve, curve[1:]):
        if v0 == 0 or (v0 < 0) != (v1 < 0):
            frac = 0.5 if v1 == v0 else abs(v0) / abs(v1 - v0)
            crossings.append(l0 + frac * (l1 - l0))
    if not crossings:
        return None
    return round(min(crossings, key=lambda x: abs(x - spot)), 0)


def walls(by_strike: dict[float, dict], spot: float) -> tuple[float | None, float | None]:
    """(call_wall, put_wall): largest call GEX at/above spot; largest |put GEX| at/
    below spot. Constrained to opposite sides by construction."""
    above = {k: v["call_gex"] for k, v in by_strike.items() if k >= spot and v["call_gex"] > 0}
    below = {k: -v["put_gex"] for k, v in by_strike.items() if k <= spot and v["put_gex"] < 0}
    call_wall = max(above, key=above.get) if above else None
    put_wall = max(below, key=below.get) if below else None
    return call_wall, put_wall


def max_pain(front: list[dict]) -> float | None:
    """Strike minimizing option holders' intrinsic payout (front expiry only)."""
    strikes = sorted({c["strike"] for c in front})
    if not strikes:
        return None

    def payout(s: float) -> float:
        total = 0.0
        for c in front:
            if c["is_call"]:
                total += max(0.0, s - c["strike"]) * c["oi"]
            else:
                total += max(0.0, c["strike"] - s) * c["oi"]
        return total
    return min(strikes, key=payout)


def build_narrative(snap: dict) -> list[str]:
    """How-to-read-it narrative, DERIVED from the snapshot's own values."""
    spot, flip = snap.get("spot"), snap.get("gamma_flip")
    net = snap.get("net_gex_bn")
    put_wall, call_wall = snap.get("put_wall"), snap.get("call_wall")
    lines: list[str] = []
    if snap.get("regime") == "negative":
        lines.append(
            f"Dealers are net SHORT gamma at spot ({net}B): their hedging sells into declines "
            "and buys into rallies, so intraday moves tend to be amplified — a momentum tape.")
    else:
        lines.append(
            f"Dealers are net LONG gamma at spot (+{net}B): their hedging buys dips and sells "
            "rips, so moves tend to be dampened — a mean-reversion tape.")
    if flip is not None and spot is not None:
        direction = "rallies" if flip > spot else "falls"
        other = ("stabilizing (dealers dampen moves)" if flip > spot
                 else "amplifying (dealers feed moves)")
        lines.append(
            f"The regime flips at ~{flip:.0f}: if SPX {direction} through it, hedging turns "
            f"{other}. Below the flip is momentum regime, above is mean-reversion regime.")
    else:
        lines.append("No zero crossing inside ±15% of spot — the regime is one-sided across "
                     "the plausible intraday range.")
    if put_wall is not None and call_wall is not None:
        lines.append(
            f"Hedging concentrations: puts at {put_wall:.0f} below, calls at {call_wall:.0f} "
            "above — price often slows near these because dealer re-hedging is heaviest there. "
            "They are magnets/brakes, not guarantees.")
    lines.append(
        "Caveats: computed from overnight open interest — 0DTE positioning (roughly half of "
        "SPX volume) is invisible to every OI-based GEX, this one included.")
    return lines


def compute_gex(book: list[dict], spot: float) -> dict:
    """Full GEX snapshot from a contract book (pure)."""
    by_strike: dict[float, dict] = {}
    call_total = put_total = 0.0
    for c in book:
        g = contract_gex(spot, c["strike"], c["iv"], c["t"], c["oi"], c["is_call"])
        row = by_strike.setdefault(c["strike"], {"call_gex": 0.0, "put_gex": 0.0})
        if c["is_call"]:
            row["call_gex"] += g
            call_total += g
        else:
            row["put_gex"] += g
            put_total += g

    net = call_total + put_total          # put_total is negative by convention
    gross = call_total + abs(put_total)
    regime = "positive" if net >= 0 else "negative"   # DERIVED — cannot contradict net
    call_wall, put_wall = walls(by_strike, spot)
    curve = gex_curve(book, spot)
    flip = gamma_flip(curve, spot)

    front_t = min((c["t"] for c in book), default=None)
    front = [c for c in book if c["t"] == front_t] if front_t is not None else []

    ladder = sorted(by_strike.items(), key=lambda kv: -abs(kv[1]["call_gex"] + kv[1]["put_gex"]))
    ladder = sorted(ladder[:LADDER_STRIKES], key=lambda kv: -kv[0])

    return {
        "spot": round(spot, 2),
        "net_gex": round(net, 0),
        "net_gex_bn": round(net / 1e9, 2),
        "regime": regime,
        "regime_text": ("positive gamma — dealer hedging dampens moves" if net >= 0
                        else "negative gamma — dealer hedging amplifies moves"),
        "call_share_pct": round(call_total / gross * 100, 1) if gross else None,
        "put_share_pct": round(abs(put_total) / gross * 100, 1) if gross else None,
        "gamma_flip": flip,
        "call_wall": call_wall,
        "put_wall": put_wall,
        "max_pain": max_pain(front),
        "ladder": [{"strike": k, "gex": round(v["call_gex"] + v["put_gex"], 0)}
                   for k, v in ladder],
        "curve": [{"spot": round(l, 0), "gex_bn": round(v / 1e9, 3)}
                  for l, v in curve[::3]],
        "n_contracts": len(book),
    }


# ── data fetch (CBOE delayed CDN — the REAL SPX chain) ──────────────────────

CBOE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/{sym}.json"
_OCC = None  # compiled lazily


def fetch_cboe_book(sym: str = "_SPX", max_dte: int = MAX_DTE) -> tuple[float, list[dict]]:
    """The CBOE delayed chain (15-min, unauthenticated) → (spot, book).
    Gamma is ALWAYS recomputed from the feed's IV via Black-Scholes — the feed's
    own greeks are rounded to ~4dp, which swings billions on the 100k+-OI box
    strikes (verified 2026-07-21: rounding alone flipped the net's sign).
    dte=0 is excluded: after the close that book is dead but still shows OI."""
    import json as _json  # noqa: PLC0415
    import re as _re  # noqa: PLC0415
    import urllib.request as _ur  # noqa: PLC0415
    global _OCC
    if _OCC is None:
        root = sym.lstrip("_")
        _OCC = _re.compile(rf"^{root}\w*?(\d{{6}})([CP])(\d{{8}})$")
    req = _ur.Request(CBOE_URL.format(sym=sym), headers={"User-Agent": "Mozilla/5.0"})
    with _ur.urlopen(req, timeout=60) as r:
        d = _json.loads(r.read().decode())["data"]
    spot = float(d.get("current_price") or d.get("close") or 0)
    today = _dt.date.today()
    book: list[dict] = []
    for o in d.get("options") or []:
        m = _OCC.match((o.get("option") or "").replace(" ", ""))
        if not m:
            continue
        dte = (_dt.datetime.strptime(m.group(1), "%y%m%d").date() - today).days
        if dte < 1 or dte > max_dte:
            continue
        oi = float(o.get("open_interest") or 0)
        iv = float(o.get("iv") or 0)
        if oi <= 0 or iv <= 0.01 or iv > 5:
            continue
        book.append({"strike": int(m.group(3)) / 1000.0, "iv": iv,
                     "t": max(dte, 1) / 365.0, "oi": oi, "is_call": m.group(2) == "C"})
    return spot, book


# ── data fetch (yfinance) ────────────────────────────────────────────────────

def fetch_book(symbol: str = "^SPX", max_dte: int = MAX_DTE,
               max_expirations: int = MAX_EXPIRATIONS) -> tuple[float, list[dict]]:
    import yfinance as yf  # noqa: PLC0415
    t = yf.Ticker(symbol)
    hist = t.history(period="1d")
    spot = float(hist["Close"].iloc[-1])
    today = _dt.date.today()
    book: list[dict] = []
    used = 0
    for e in t.options:
        dte = (_dt.date.fromisoformat(e) - today).days
        if dte < 1 or dte > max_dte:
            continue
        if used >= max_expirations:
            break
        oc = t.option_chain(e)
        t_years = max(dte, 1) / 365.0
        for df, is_call in ((oc.calls, True), (oc.puts, False)):
            for _, r in df.iterrows():
                oi = float(r.get("openInterest") or 0)
                iv = float(r.get("impliedVolatility") or 0)
                if math.isnan(oi) or math.isnan(iv):
                    continue
                if oi <= 0 or iv <= 0.01 or iv > 5:
                    continue
                book.append({"strike": float(r["strike"]), "iv": iv,
                             "t": t_years, "oi": oi, "is_call": is_call})
        used += 1
    return spot, book


def _scale_levels(snap: dict, ratio: float) -> dict:
    """Convert SPY-chain levels to SPX-equivalents (display scaling only)."""
    out = dict(snap)
    for key in ("spot", "gamma_flip", "call_wall", "put_wall", "max_pain"):
        if out.get(key) is not None:
            out[key] = round(out[key] * ratio, 0)
    out["ladder"] = [{"strike": round(r["strike"] * ratio, 0), "gex": r["gex"]}
                     for r in snap.get("ladder", [])]
    out["curve"] = [{"spot": round(r["spot"] * ratio, 0), "gex_bn": r["gex_bn"]}
                    for r in snap.get("curve", [])]
    return out


def build_snapshot(symbol: str = "^SPX", *, now: _dt.datetime | None = None) -> dict:
    """Fetch the chain + compute the full GEX snapshot (with the SPY-proxy
    fallback when the ^SPX chain OI is unusable). Pure-ish: only the yfinance
    fetch touches the network. ``now`` overridable for deterministic stamping."""
    now = now or _dt.datetime.now(ET)
    is_spx = symbol.upper() in ("^SPX", "^GSPC", "SPX")
    # SPX: the CBOE delayed feed carries the REAL index chain (institutional
    # book, ~4.5× the proxy's contracts) — primary since 2026-07-21. The SPY
    # proxy is computed alongside and embedded, because the two books can
    # DISAGREE on regime (verified: SPX +5.05B positive vs proxy −1.95B
    # negative on the same evening) and that divergence is itself information.
    if is_spx:
        try:
            spot, book = fetch_cboe_book("_SPX")
        except Exception:
            spot, book = 0.0, []
        if len(book) >= MIN_BOOK_CONTRACTS and spot > 0:
            snap = compute_gex(book, spot)
            snap["proxy"] = None
            try:
                spy_spot, spy_book = fetch_book("SPY")
                p = compute_gex(spy_book, spy_spot)
                ratio = spot / spy_spot if spy_spot else 10.0
                p = _scale_levels(p, ratio)
                snap["proxy"] = {k: p.get(k) for k in (
                    "net_gex_bn", "regime", "gamma_flip", "call_wall",
                    "put_wall", "max_pain", "n_contracts")}
                snap["proxy"]["source"] = f"SPY-chain proxy ×{ratio:.2f} (yfinance)"
            except Exception:
                pass
            px = snap.get("proxy") or {}
            snap["regime_divergence"] = bool(px) and px.get("regime") != snap["regime"]
            snap["narrative"] = build_narrative(snap)
            if snap["regime_divergence"]:
                snap["narrative"].append(
                    f"SOURCE DISAGREEMENT: the real SPX chain reads {snap['regime']} gamma "
                    f"({snap['net_gex_bn']:+.2f}B) but the SPY proxy reads {px.get('regime')} "
                    f"({px.get('net_gex_bn'):+.2f}B). The books differ (institutional index vs "
                    "retail/hedge ETF); when they disagree, the regime is uncertain — size down.")
            snap.update({
                "generated_at": now.isoformat(), "date": now.date().isoformat(),
                "symbol": symbol, "source": "SPX chain (CBOE delayed)",
                "note": ("Dealer-gamma from the real SPX chain (CBOE delayed CDN, BS gamma "
                         "from feed IV — feed greeks are rounded and unusable). Sign "
                         "convention: dealers long customer calls (+), short puts (−). "
                         f"Expirations 1–{MAX_DTE} DTE. OI-based — blind to 0DTE flow. "
                         "SPY-proxy read embedded under 'proxy'. Context, not a signal."),
            })
            return snap
    spot, book = fetch_book(symbol)
    source = symbol
    scale_note = ""
    # The SPY-chain proxy exists ONLY because yahoo's ^SPX OI is unusable; it must
    # never hijack a thin QQQ/IWM book (those have deep native chains and their own
    # strikes — scaling them by SPX/SPY would be nonsense). Restrict to SPX forms.
    if is_spx and len(book) < MIN_BOOK_CONTRACTS:
        spx_spot = spot
        spy_spot, book = fetch_book("SPY")
        snap = compute_gex(book, spy_spot)
        ratio = spx_spot / spy_spot if spy_spot else 10.0
        snap = _scale_levels(snap, ratio)
        source = "SPY-chain proxy"
        scale_note = (f" Computed from SPY's chain (yahoo SPX OI is unusable) and scaled "
                      f"×{ratio:.2f} to SPX terms; net GEX is SPY-complex dollars.")
        snap["spot"] = round(spx_spot, 2)
    else:
        snap = compute_gex(book, spot)
        if len(book) < MIN_BOOK_CONTRACTS:
            scale_note = (f" Thin chain ({len(book)} contracts) — levels less reliable.")
    snap["narrative"] = build_narrative(snap)
    snap.update({
        "generated_at": now.isoformat(),
        "date": now.date().isoformat(),
        "symbol": symbol,
        "source": source,
        "note": (
            "EOD dealer-gamma estimate computed in Vantage. Sign convention (the one every "
            "public GEX product assumes, unverifiable from the tape): dealers long customer "
            "calls (+), short customer puts (−). Regime label derived from the net's sign; "
            "flip is a re-priced zero crossing; walls are opposite sides of spot. Expirations "
            f"≤{MAX_DTE} DTE. OI-based — blind to 0DTE flow. Context, not a signal." + scale_note
        ),
    })
    return snap


def record(store: Store, symbol: str = "^SPX", *,
           now: _dt.datetime | None = None) -> dict:
    """Compute + persist the GEX snapshot to the store (snapshot + history row)."""
    snap = build_snapshot(symbol, now=now)
    store.put_gex_snapshot(snap)
    store.record_gex_history(snap)
    return snap


# ============================================================ CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.gex",
        description="Compute the SPX dealer-gamma (GEX) snapshot natively from the "
                    "yfinance option chain and store it. Context, not a signal.")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--symbol", default="^SPX", help="underlying (default ^SPX)")
    p.add_argument("--dry-run", action="store_true", help="print the snapshot, write nothing")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    data_dir = resolve_data_dir(args.data_dir)
    store = Store(data_dir)
    if not getattr(store, "uses_sqlite", False):
        print("error: GEX snapshot requires the SQLite backend (a vantage.db)",
              file=sys.stderr)
        return EXIT_USER_ERROR
    if args.dry_run:
        snap = build_snapshot(args.symbol)
        import json
        print(json.dumps(snap, indent=2, default=str))
        print("[dry-run] nothing written")
        return EXIT_OK
    snap = record(store, args.symbol)
    print(f"GEX: net {snap['net_gex_bn']}B ({snap['regime']}), flip {snap['gamma_flip']}, "
          f"walls {snap['put_wall']}/{snap['call_wall']}, max pain {snap['max_pain']} "
          f"[{snap['source']}]")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
