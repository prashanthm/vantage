"""Level-cross alerts — the TradingView core loop (level → alert → act) on
Vantage's OWN computed levels, pushed through the Telegram bot that already
runs. An alert is armed on a price with the side recorded (price was above or
below at arm time); it fires ONCE when the last 1-minute print crosses to the
other side, then keeps its fired stamp for the record.

Storage is the meta kv (JSON list under ``level_alerts``) — a handful of rows,
no schema migration. Ticked by the signal-bot poll (60s during RTH)."""
from __future__ import annotations

import datetime as _dt
import json
import uuid

from .store import Store

_KEY = "level_alerts"


def _load(store: Store) -> list[dict]:
    try:
        v = json.loads(store.get_meta(_KEY) or "[]")
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def _save(store: Store, alerts: list[dict]) -> None:
    store.set_meta(_KEY, json.dumps(alerts))


def _last_price(store: Store, symbol: str) -> float | None:
    """The freshest 1-minute close we hold for ``symbol`` (the intraday
    refresh keeps SPX/QQQ/IWM current during RTH)."""
    day = store.latest_intraday_day(symbol, "1m")
    if not day:
        return None
    bars = store.load_intraday_bars(symbol, day, "1m")
    if not bars:
        return None
    try:
        return float(bars[-1]["close"])
    except (KeyError, TypeError, ValueError):
        return None


def list_alerts(store: Store) -> list[dict]:
    return _load(store)


def add_alert(store: Store, symbol: str, price: float, note: str = "") -> dict:
    symbol = symbol.upper()
    last = _last_price(store, symbol)
    alert = {
        "id": uuid.uuid4().hex[:8],
        "symbol": symbol,
        "price": round(float(price), 2),
        "note": (note or "")[:120],
        # the side price was on when armed — the cross that fires is TO the
        # other side, so re-arming at the same level after a fire works
        "side": ("below" if last is not None and last < float(price) else "above"),
        "armed_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "fired_at": None,
    }
    alerts = _load(store)
    # one live alert per (symbol, price): re-arming replaces a fired twin
    alerts = [a for a in alerts
              if not (a["symbol"] == symbol and a["price"] == alert["price"])]
    alerts.append(alert)
    _save(store, alerts)
    return alert


def remove_alert(store: Store, alert_id: str) -> bool:
    alerts = _load(store)
    kept = [a for a in alerts if a.get("id") != alert_id]
    _save(store, kept)
    return len(kept) != len(alerts)


def tick(store: Store) -> list[dict]:
    """Fire any armed alert whose level was crossed since arming. Returns the
    fired alerts (already stamped + persisted); Telegram send is best-effort."""
    from .signal_bot import send_telegram, telegram_configured
    alerts = _load(store)
    fired = []
    dirty = False
    for a in alerts:
        if a.get("fired_at"):
            continue
        last = _last_price(store, a["symbol"])
        if last is None:
            continue
        crossed = (last >= a["price"]) if a.get("side") == "below" else (last <= a["price"])
        if not crossed:
            continue
        a["fired_at"] = _dt.datetime.now(_dt.timezone.utc).isoformat()
        a["fired_price"] = round(last, 2)
        fired.append(a)
        dirty = True
        if telegram_configured(store):
            arrow = "▲" if a.get("side") == "below" else "▼"
            note = f" — {a['note']}" if a.get("note") else ""
            send_telegram(
                f"🔔 {a['symbol']} {arrow} crossed {a['price']}{note} · last {last:.2f}",
                store)
    if dirty:
        _save(store, alerts)
    return fired
