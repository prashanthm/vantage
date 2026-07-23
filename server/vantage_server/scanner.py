"""ICT Scanner — run the backtest-validated hourly setup detector across a UNIVERSE.

The A+ hourly setup detector (`ict_htf.htf_setup`, the confluence-stack /
displacement-FVG-reaction confirmed by the `ict-concepts-edge` goal) already runs
per-SPX inside the snapshot. This module runs the SAME detector across a universe of
tickers (top-10 holdings of SPY/QQQ/IWM) and returns a ranked scan the UI + an hourly
cron consume.

PURE + DETERMINISTIC: hourly bars in → tiered signals out. No LLM, no orders
(ADR-010). Pluggable: `SCANNERS` maps a scanner id to a per-symbol detector, so more
scanner types are a dict entry, not a rewrite.

Data: the detector needs only hourly OHLC (pure price), so it works on ANY ticker.
yfinance serves 60m bars directly (~2yr), stored in `intraday_bars` with
interval='60m'. htf_setup needs ≥32 hourly bars (~5 trading days).
"""
from __future__ import annotations

import datetime as _dt
import logging

from . import ict
from . import ict_htf as _htf

log = logging.getLogger("vantage.scanner")

#: The scanner universe = the Nasdaq-100 (QQQ) + S&P-top-100 (SPY) constituents, BY
#: WEIGHT (highest-weight first), deduped. Pinned from the ETF holdings tables
#: (yfinance caps its holdings feed at 10, Wikipedia has no weights / no clean NDX
#: table) — so these are the ground-truth weighted lists, refreshed by re-pasting the
#: holdings. Weight order preserved so a cap keeps the biggest names. `.`→`-` for
#: yfinance (BRK.B → BRK-B).
_QQQ_100 = [
    "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "AVGO", "SPCX", "META", "TSLA",
    "MU", "WMT", "AMD", "ASML", "INTC", "AMAT", "CSCO", "COST", "LRCX", "PLTR",
    "NFLX", "PANW", "KLAC", "ARM", "TXN", "LIN", "SNDK", "TMUS", "CRWD", "AMGN",
    "PEP", "ADI", "QCOM", "GILD", "MRVL", "STX", "SHOP", "WDC", "APP", "BKNG",
    "ISRG", "SBUX", "PDD", "VRTX", "FTNT", "ADP", "CDNS", "MAR", "MNST", "CSX",
    "MELI", "ADBE", "DDOG", "CEG", "ABNB", "CMCSA", "CTAS", "DASH", "INTU", "SNPS",
    "MDLZ", "ROST", "AEP", "HON", "ORLY", "REGN", "WBD", "NXPI", "PCAR", "HONA",
    "MPWR", "BKR", "LITE", "ALAB", "FAST", "FANG", "EA", "TER", "PYPL", "XEL",
    "ODFL", "EXC", "CCEP", "ADSK", "FER", "IDXX", "TTWO", "MCHP", "AXON", "NBIS",
    "TRI", "KDP", "RKLB", "PAYX", "CRWV", "ALNY", "ROP", "WDAY", "MSTR", "KHC",
]
_SPY_100 = [
    "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "AVGO", "META", "TSLA", "BRK-B",
    "LLY", "MU", "WMT", "JPM", "AMD", "V", "XOM", "JNJ", "INTC", "MA",
    "ABBV", "CSCO", "BAC", "AMAT", "COST", "CAT", "UNH", "LRCX", "CVX", "GE",
    "ORCL", "KO", "PG", "HD", "MS", "PLTR", "GS", "MRK", "PM", "NFLX",
    "PANW", "GEV", "KLAC", "WFC", "RTX", "DELL", "TXN", "AXP", "LIN", "C",
    "ANET", "SNDK", "TMUS", "CRWD", "IBM", "TMO", "AMGN", "MCD", "PEP", "APH",
    "NEE", "VZ", "ADI", "QCOM", "UNP", "STX", "SCHW", "ABT", "WELL", "TJX",
    "MRVL", "BA", "DIS", "GILD", "BLK", "WDC", "DE", "ETN", "BX", "T",
    "UBER", "DHR", "PFE", "APP", "BKNG", "CRM", "PLD", "COP", "CVS", "CB",
    "SPGI", "GLW", "COF", "BMY", "MO", "ISRG", "VRTX", "SYK", "PGR", "PH",
]

#: max symbols in a scan (bounds scan time / rate-limits). Weight-ordered union +
#: manual tickers; manual names are never dropped by the cap.
_UNIVERSE_CAP = 170

ET_OPEN = 9 * 60 + 30
ET_CLOSE = 16 * 60

#: a setup is "current" only if it triggered within this many hourly bars of the
#: latest bar. Beyond this it's STALE — the move has usually already played out — so
#: it's retired to the scanner's `history` (with its resolved outcome), NOT shown as
#: a live signal. Tightened from 7 (~a full session — too loose, surfaced played-out
#: setups) to 3 so "current" means the last few hours.
_FRESH_BARS = 3


# ── universe ─────────────────────────────────────────────────────────────────

def _norm(sym: str) -> str:
    """Normalize a ticker for yfinance (upper, `.`→`-`, strip)."""
    return str(sym or "").strip().upper().replace(".", "-")


def manual_tickers(store) -> list[str]:
    """The user-added ad-hoc tickers (persisted in a scanner_universe row keyed
    'manual'). Always merged into the universe and never dropped by the cap."""
    row = store.load_scanner_universe("manual") if hasattr(store, "load_scanner_universe") else None
    return list((row or {}).get("symbols") or [])


def add_manual_ticker(store, sym: str) -> list[str]:
    """Add a ticker to the manual list (deduped). Returns the new list."""
    s = _norm(sym)
    cur = manual_tickers(store)
    if s and s not in cur:
        cur.append(s)
        store.save_scanner_universe(cur, "manual", "manual")
    return cur


def remove_manual_ticker(store, sym: str) -> list[str]:
    """Remove a ticker from the manual list. Returns the new list."""
    s = _norm(sym)
    cur = [x for x in manual_tickers(store) if x != s]
    store.save_scanner_universe(cur, "manual", "manual")
    return cur


def resolve_universe(store, refresh: bool = False, set_key: str = "default",
                     cap: int = _UNIVERSE_CAP) -> dict:
    """The deduped, weight-ordered scanner universe: the pinned QQQ-100 + SPY-100
    constituents (highest-weight first) ∪ the user's manual tickers, capped at
    ``cap``. MANUAL tickers are always included (never dropped by the cap). Cached
    so a scan doesn't recompute; ``refresh=True`` recomputes. Returns
    {symbols, source, fetched_at, from_cache, manual}."""
    manual = [_norm(s) for s in manual_tickers(store)]
    if not refresh:
        cached = store.load_scanner_universe(set_key) if hasattr(store, "load_scanner_universe") else None
        if cached and cached.get("symbols"):
            return {**cached, "manual": manual, "from_cache": True}
    # weight-ordered union: QQQ then SPY (dedupe preserves the higher-weight slot),
    # capped; then manual names appended (always kept).
    seen: dict[str, None] = {}
    for sym in _QQQ_100 + _SPY_100:
        seen.setdefault(_norm(sym), None)
    ranked = list(seen.keys())[:max(0, int(cap))]
    for m in manual:
        if m and m not in ranked:
            ranked.append(m)
    source = "qqq100+spy100"
    if hasattr(store, "save_scanner_universe"):
        store.save_scanner_universe(ranked, source, set_key)
    row = store.load_scanner_universe(set_key) if hasattr(store, "load_scanner_universe") else None
    return {**(row or {"symbols": ranked, "source": source, "fetched_at": None}),
            "manual": manual, "from_cache": False}


# ── hourly bar seeding ───────────────────────────────────────────────────────

def _rth_hourly(symbol: str, lookback_days: int = 10):
    """Recent RTH 60m bars for ``symbol`` as one compact OHLC dict, or None. Fetches
    the whole window in one call (yfinance serves 60m directly). RTH-filtered in ET."""
    try:
        import yfinance as yf
        from zoneinfo import ZoneInfo
        h = yf.Ticker(symbol).history(period=f"{max(5, lookback_days)}d", interval="60m")
        if h.empty:
            return None
        if h.index.tz is None:
            h.index = h.index.tz_localize("UTC")
        h.index = h.index.tz_convert(ZoneInfo("America/New_York"))
        mins = h.index.hour * 60 + h.index.minute
        h = h[(mins >= ET_OPEN) & (mins < ET_CLOSE)]
        if h.empty:
            return None
        return {
            "ts": [t.isoformat() for t in h.index],
            "open": [float(v) for v in h["Open"]],
            "high": [float(v) for v in h["High"]],
            "low": [float(v) for v in h["Low"]],
            "close": [float(v) for v in h["Close"]],
            "volume": [float(v) for v in h.get("Volume", h["Close"] * 0)],
        }
    except Exception as e:  # noqa: BLE001
        log.warning("60m fetch failed for %s: %s", symbol, e)
        return None


#: inter-fetch delay + retries to stay under yfinance's rate limit on a big universe.
_FETCH_DELAY_S = 0.4
_FETCH_RETRIES = 2


def _rth_hourly_retry(symbol: str, lookback_days: int):
    """`_rth_hourly` with a couple of retries + a short backoff — a transient
    rate-limit/network blip on one symbol shouldn't drop it from the scan."""
    import time
    for attempt in range(_FETCH_RETRIES + 1):
        ohlc = _rth_hourly(symbol, lookback_days)
        if ohlc and ohlc.get("ts"):
            return ohlc
        if attempt < _FETCH_RETRIES:
            time.sleep(0.6 * (attempt + 1))
    return None


def seed_hourly(store, symbols: list[str], lookback_days: int = 10, progress=None) -> dict:
    """Fetch + store recent 60m bars for each symbol (interval='60m'), THROTTLED for
    a large universe (small inter-fetch delay + retries). Splits the fetched series by
    session-day so it slots into the (symbol, day, '60m') key. Idempotent. ``progress``
    (optional) is called (done, total) after each symbol so a background scan can
    report progress. Returns a per-symbol summary."""
    import time
    fetched = 0
    empty = 0
    total = len(symbols)
    for i, sym in enumerate(symbols):
        ohlc = _rth_hourly_retry(sym, lookback_days)
        if not ohlc or not ohlc.get("ts"):
            empty += 1
        else:
            by_day: dict[str, dict] = {}
            for j, t in enumerate(ohlc["ts"]):
                day = t[:10]
                d = by_day.setdefault(day, {"ts": [], "open": [], "high": [],
                                            "low": [], "close": [], "volume": []})
                d["ts"].append(t)
                for k in ("open", "high", "low", "close", "volume"):
                    d[k].append(ohlc[k][j])
            for day, d in by_day.items():
                store.save_intraday_bars(sym, day, "60m", d)
            fetched += 1
        if progress:
            try:
                progress(i + 1, total)
            except Exception:  # noqa: BLE001 — progress reporting must never break the seed
                pass
        if i + 1 < total:
            time.sleep(_FETCH_DELAY_S)
    return {"symbols": total, "fetched": fetched, "no_data": empty}


def load_hourly_series(store, symbol: str, days: int = 15) -> dict | None:
    """Concatenate the stored 60m sessions for ``symbol`` (up to the latest) into one
    continuous OHLC series for the detector. Reuses load_intraday_bars_range."""
    latest = store.latest_intraday_day(symbol, "60m") if hasattr(store, "latest_intraday_day") else None
    if not latest:
        return None
    return store.load_intraday_bars_range(symbol, latest, "60m", days=days)


# ── the scan engine (pluggable) ──────────────────────────────────────────────

def _resolve_outcome(hi, lo, ti, setup) -> dict:
    """Walk the bars AFTER a setup triggered — did price reach the runner target or
    the invalidation first? Returns {outcome, resolved_at_bar}. Used to grade a
    STALE setup for the history section so you see how it played out."""
    d = 1 if setup.get("dir") == "long" else -1
    invalid = setup.get("invalid")
    tgts = setup.get("targets") or []
    target = tgts[-1].get("price") if tgts else None
    for m in range(ti + 1, len(hi)):
        if invalid is not None and ((lo[m] <= invalid) if d > 0 else (hi[m] >= invalid)):
            return {"outcome": "invalidated", "resolved_bar": m}
        if target is not None and ((hi[m] >= target) if d > 0 else (lo[m] <= target)):
            return {"outcome": "target", "resolved_bar": m}
    return {"outcome": "open"}   # neither hit in the loaded window


def _scan_ict_htf(store, symbol: str) -> dict | None:
    """Run the A+/B hourly ICT setup detector for one symbol from its stored 60m
    bars. Returns the htf_setup dict + {symbol, as_of, bars}, or None if no data.
    A setup older than _FRESH_BARS is tagged ``stale`` and carries its resolved
    outcome (target / invalidated / open) so run_scan can retire it to history
    instead of surfacing a played-out signal as if it were live."""
    ser = load_hourly_series(store, symbol, days=15)
    if not ser or not ser.get("ts") or len(ser["ts"]) < 32:
        return None
    hi, lo, cl, op = ser["high"], ser["low"], ser["close"], ser["open"]
    obs = ict.active_obs(hi, lo, cl, op)
    last_hour = _dt.datetime.fromisoformat(ser["ts"][-1]).strftime("%H:%M")
    setup = dict(_htf.htf_setup(hi, lo, cl, op, last_hour, active_obs=obs))
    if setup.get("present") and setup.get("bars_ago", 0) > _FRESH_BARS:
        # STALE — not a live signal. Keep it, tag it, and resolve how it played out.
        ti = setup.get("trigger_i")
        outcome = _resolve_outcome(hi, lo, ti, setup) if ti is not None else {"outcome": "open"}
        setup["stale"] = True
        setup.update(outcome)
    setup.update({"symbol": symbol, "as_of": ser["ts"][-1], "bars": len(ser["ts"]),
                  "last_bar": ser["ts"][-1]})
    return setup


#: scanner registry — id → per-symbol detector. Add a scanner = add an entry.
SCANNERS = {"ict_htf": _scan_ict_htf}

#: tier sort weight (A+ first, then B, then present-no-tier).
_TIER_RANK = {"A+": 0, "B": 1}


import threading

#: guards against overlapping scans (a background refresh while one runs).
_SCAN_LOCK = threading.Lock()


def _save_progress(store, scanner: str, phase: str, done: int, total: int,
                   prev_hits: list | None = None) -> None:
    """Persist an in-progress status so the UI can poll a live progress bar. Keeps
    the prior scan's hits visible while a new scan runs."""
    if not hasattr(store, "save_scanner_result"):
        return
    prev = (store.load_scanner_result(scanner) or {}).get("result") or {}
    store.save_scanner_result(scanner, {
        **prev,
        "scanner": scanner,
        "status": "running",
        "progress": {"phase": phase, "done": done, "total": total},
        "hits": prev_hits if prev_hits is not None else prev.get("hits", []),
    })


def run_scan(store, scanner: str = "ict_htf", refresh_bars: bool = False,
             refresh_universe: bool = False, lookback_days: int = 10) -> dict:
    """Run ``scanner`` across the universe. When ``refresh_bars``, first seed fresh
    60m bars (throttled), reporting progress as it goes. Persists a running→complete
    status so a UI can poll. Deterministic — no LLM, no orders."""
    detector = SCANNERS.get(scanner)
    if detector is None:
        return {"scanner": scanner, "available": False, "status": "complete",
                "note": f"unknown scanner '{scanner}'"}
    uni = resolve_universe(store, refresh=refresh_universe)
    symbols = uni.get("symbols") or []
    total = len(symbols)
    seeded = None
    if refresh_bars:
        _save_progress(store, scanner, "seeding", 0, total)
        seeded = seed_hourly(store, symbols, lookback_days,
                             progress=lambda d, t: _save_progress(store, scanner, "seeding", d, t))

    _save_progress(store, scanner, "detecting", 0, total)
    hits, history, no_setup, no_data = [], [], [], []
    latest_bar = None
    for i, sym in enumerate(symbols):
        try:
            s = detector(store, sym)
        except Exception as e:  # noqa: BLE001 — one symbol must not break the scan
            log.warning("scan failed for %s: %s", sym, e)
            s = None
        if s is None:
            no_data.append(sym)
        elif s.get("present"):
            if s.get("last_bar") and (latest_bar is None or s["last_bar"] > latest_bar):
                latest_bar = s["last_bar"]
            # STALE setups are retired to history (with their outcome), not live hits
            (history if s.get("stale") else hits).append(s)
        else:
            no_setup.append(sym)
        if (i + 1) % 10 == 0 or i + 1 == total:
            _save_progress(store, scanner, "detecting", i + 1, total, prev_hits=hits)

    hits.sort(key=lambda h: (_TIER_RANK.get(h.get("tier"), 9),
                             h.get("as_of") or ""), reverse=False)
    history.sort(key=lambda h: h.get("as_of") or "", reverse=True)   # most-recent first
    result = {
        "scanner": scanner,
        "status": "complete",
        "ran_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        # the latest STORED bar the scan ran on — so the UI can flag when the data is
        # behind the live market (weekend / pre-market) instead of silently showing
        # setups as current.
        "data_through": latest_bar,
        "universe_source": uni.get("source"),
        "universe_n": total,
        "covered_n": total - len(no_data),
        "manual_tickers": uni.get("manual", []),
        "hits": hits,
        "history": history,
        "no_setup": sorted(no_setup),
        "no_data": sorted(no_data),
        "seeded": seeded,
    }
    if hasattr(store, "save_scanner_result"):
        store.save_scanner_result(scanner, result)
    # auto-log A+ setups as paper debit spreads (deduped). Best-effort — a logging
    # failure must never break a scan.
    try:
        n = arm_scanner_spreads(store, result)
        if n:
            log.info("scanner %s: logged %d new paper spread(s)", scanner, n)
    except Exception as e:  # noqa: BLE001
        log.warning("scanner-spread auto-log failed: %s", e)
    return result


def _alpaca_paper_creds() -> bool:
    """True when Alpaca PAPER submission is configured (paper keys + paper endpoint)."""
    import os
    if os.environ.get("ALPACA_PAPER", "1") == "0":
        return False   # endpoint is LIVE — never route scanner spreads there
    return bool(os.environ.get("ALPACA_API_KEY") and os.environ.get("ALPACA_SECRET_KEY"))


def _submit_paper_spread(spread: dict) -> dict | None:
    """Submit a debit spread to Alpaca PAPER (best-effort). Returns
    {entry_order_id, broker_status, alpaca_symbol} on a submit, or None on any
    failure (the caller then leaves the row as a yfinance-sim fallback)."""
    from . import scanner_spread as _sp
    try:
        from .brokers import alpaca_execution as _ax
        order = _sp.alpaca_order(spread)
        if order is None:
            return None
        res = _ax.submit_strategy_order(
            order, strategy="scanner-spread", live_eligible=False,
            caps={}, context={}, audit=lambda r: log.info("scanner-spread order: %s", r.get("mode")),
            paper=True)
        if res.get("mode") != "paper" or not res.get("order_id"):
            return None
        return {"entry_order_id": res["order_id"],
                "broker_status": (res.get("result") or {}).get("status") or "accepted",
                "alpaca_symbol": order["legs"][0]["symbol"]}
    except Exception as e:  # noqa: BLE001 — a broker failure must not break the scan
        log.warning("scanner-spread Alpaca-paper submit failed for %s: %s",
                    spread.get("underlying"), e)
        return None


def arm_scanner_spreads(store, scan_result: dict) -> int:
    """Log each A+ scanner hit as a paper DEBIT SPREAD, deduped by setup_key. When
    Alpaca PAPER is configured, SUBMIT the spread there (real fill) and tag the row
    broker='alpaca-paper' + entry_order_id; otherwise the row is a yfinance-sim
    fallback (broker=NULL). Mirrors signal_bot.arm_session. Returns the count logged."""
    if not getattr(store, "uses_sqlite", False):
        return 0
    from . import scanner_spread as _sp
    known = store.paper_setup_keys()
    # setup_key embeds the hit's as_of, so every re-scan mints a NEW key — the
    # July dupes (XEL ×3, MELI/CRM/ABBV ×2) were the same strikes re-armed by
    # later scans. One open position per (underlying, strikes); re-entry is
    # allowed once the old one closes.
    open_now = {(r.get("underlying") or r.get("symbol"),
                 r.get("long_strike"), r.get("short_strike"))
                for r in store.load_paper_trades(status="open", book="scanner-spread")}
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    use_alpaca = _alpaca_paper_creds()
    logged = 0
    for hit in scan_result.get("hits") or []:
        if hit.get("tier") != "A+":
            continue
        spread = _sp.spread_from_hit(hit, price_chain=True)
        if spread is None or spread["setup_key"] in known:
            continue
        pos_key = (spread["underlying"], spread["long_strike"], spread["short_strike"])
        if pos_key in open_now:
            continue
        broker_fields = _submit_paper_spread(spread) if use_alpaca else None
        row = {
            **spread,
            "opened_at": now,
            "session": (hit.get("as_of") or "")[:10] or None,
            "source": "scanner-auto",
            "status": "open",
            "filled_at": now,
            "opened_price_src": f"scanner A+ setup · debit {spread.get('debit_src', 'modeled')}",
        }
        if broker_fields:
            # real Alpaca-paper order: pending its fill (the reconcile loop confirms).
            row.update({"broker": "alpaca-paper", "fill_status": "pending", **broker_fields})
        else:
            # sim fallback: treated as filled immediately (the yfinance settler owns it).
            row["fill_status"] = "filled"
        store.record_paper_trade(row)
        known.add(spread["setup_key"])
        open_now.add(pos_key)
        logged += 1
    return logged


def start_background_scan(store, scanner: str = "ict_htf",
                          refresh_universe: bool = False) -> dict:
    """Kick off a throttled full scan in a background thread and return immediately.
    A module-level lock rejects an overlapping scan. The UI polls GET /api/scanner for
    the running→complete status. Returns {status: started|already_running}."""
    if not _SCAN_LOCK.acquire(blocking=False):
        return {"status": "already_running"}

    def _worker():
        try:
            run_scan(store, scanner, refresh_bars=True, refresh_universe=refresh_universe)
        except Exception as e:  # noqa: BLE001
            log.warning("background scan failed: %s", e)
            try:
                _save_progress(store, scanner, "error", 0, 0)
            except Exception:  # noqa: BLE001
                pass
        finally:
            _SCAN_LOCK.release()

    threading.Thread(target=_worker, name=f"scan-{scanner}", daemon=True).start()
    return {"status": "started"}


def scan_alerts(prev: dict | None, curr: dict) -> list[str]:
    """The FRESH-A+ diff for the hourly cron: symbols that are A+ now and were NOT
    A+ in the prior stored scan (dedup key = symbol+dir). Returns alert lines. Only
    A+ alerts — B/none are surfaced in the UI but never paged."""
    def _aplus(res):
        return {(h["symbol"], h.get("dir")): h
                for h in (res or {}).get("hits", []) if h.get("tier") == "A+"}
    before = _aplus(prev)
    now = _aplus(curr)
    fresh = [h for k, h in now.items() if k not in before]
    lines = []
    for h in sorted(fresh, key=lambda x: x["symbol"]):
        z = h.get("entry_zone") or []
        zone = f"{z[0]}–{z[1]}" if len(z) == 2 else "?"
        lines.append(
            f"⚡ A+ ICT setup · {h['symbol']} · {str(h.get('dir','')).upper()} · "
            f"zone {zone} · invalid {h.get('invalid')} · {h.get('reason','')}")
    return lines


def cron_run(store, scanner: str = "ict_htf") -> dict:
    """The hourly-cron entrypoint: read the prior scan, run a fresh one (seeding
    bars), and Telegram any FRESH A+. Reuses signal_bot.send_telegram. Returns a
    summary. Quiet by design — only fresh A+ pages."""
    prev = store.load_scanner_result(scanner)
    prev_result = (prev or {}).get("result")
    curr = run_scan(store, scanner, refresh_bars=True)
    alerts = scan_alerts(prev_result, curr)
    sent = 0
    if alerts:
        try:
            from . import signal_bot
            if signal_bot.telegram_configured(store):
                header = f"🔭 ICT Scanner — {len(alerts)} fresh A+ setup(s):"
                signal_bot.send_telegram(header + "\n" + "\n".join(alerts), store)
                sent = len(alerts)
        except Exception as e:  # noqa: BLE001 — alert failure must not fail the scan
            log.warning("scanner alert send failed: %s", e)
    return {"scanner": scanner, "hits": len(curr.get("hits", [])),
            "fresh_aplus": len(alerts), "alerts_sent": sent,
            "covered_n": curr.get("covered_n"), "universe_n": curr.get("universe_n")}


def main(argv=None) -> int:
    """CLI: `python -m vantage_server.scanner [--scanner ict_htf]` — one cron pass."""
    import argparse
    from .store import Store, resolve_data_dir
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(prog="vantage_server.scanner")
    ap.add_argument("--scanner", default="ict_htf")
    ap.add_argument("--data-dir", default=None)
    args = ap.parse_args(argv)
    store = Store(resolve_data_dir(args.data_dir))
    summary = cron_run(store, args.scanner)
    log.info("scanner %s", summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
