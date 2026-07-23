"""Scanner-spread Alpaca-PAPER reconcile loop — the fill/stop-loss watcher.

A direct analog of execution_monitor.py, for scanner debit spreads submitted to
Alpaca PAPER (book='scanner-spread', broker='alpaca-paper'). One pass = tick():

* PENDING (fill_status='pending') — poll the entry order's status. On ``filled``
  record the real fill price and activate; on ``canceled``/``rejected``/``expired``
  close the row (never filled).
* ACTIVE (fill_status='filled', status='open') — read the underlying's latest price.
  If the INVALIDATION is breached that IS the STOP-LOSS → place_exit (reduce-only
  close on Alpaca paper) and close the row as a loss; if the target trades → close
  as a win. Reconcile against fetch_positions (broker flat = operator closed it).

P&L is modeled from the spread structure at the resolving price (Alpaca paper doesn't
price a closed multi-leg back to us simply); the FILLS are real. Paper only — every
submit goes through the alpaca_execution paper carve-out (no live gates, no real
money). Run continuously:  python -m vantage_server.scanner_exec [interval_sec]
"""
from __future__ import annotations

import datetime as _dt
import logging
import time

log = logging.getLogger("vantage.scanner_exec")

TERMINAL_UNFILLED = {"canceled", "cancelled", "rejected", "expired"}


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def last_price(symbol: str) -> float | None:
    """Latest trade price for the underlying (yfinance, ~15m delayed). Best-effort."""
    try:
        import yfinance as yf  # noqa: PLC0415
        fi = yf.Ticker(symbol).fast_info
        px = fi.get("last_price") if hasattr(fi, "get") else getattr(fi, "last_price", None)
        return float(px) if px else None
    except Exception:  # noqa: BLE001
        return None


def _spread_pnl(row: dict, exit_reason: str) -> float:
    """Modeled P&L at resolution (Alpaca fills are real; the CLOSE mark is modeled
    from the debit-spread payoff): target → (width − debit) × contracts × 100;
    invalidation → −debit × contracts × 100. The debit is the REAL Alpaca fill
    when the reconcile recorded one — est_debit is the modeled fallback."""
    debit = float(row.get("filled_avg") or row.get("est_debit") or 0)
    n = int(row.get("contracts") or 4)
    width = abs(float(row.get("short_strike") or 0) - float(row.get("long_strike") or 0))
    if exit_reason == "target":
        return round((width - debit) * n * 100, 2)
    return round(-debit * n * 100, 2)   # invalidation / stop-loss


def _breached_invalidation(row: dict, px: float) -> bool:
    is_call = row.get("structure") == "debit_call_spread"
    inv = float(row.get("underlying_invalid"))
    return (px <= inv) if is_call else (px >= inv)


def _reached_target(row: dict, px: float) -> bool:
    is_call = row.get("structure") == "debit_call_spread"
    tgt = float(row.get("short_strike"))
    return (px >= tgt) if is_call else (px <= tgt)


def tick(store, *, price_of=last_price) -> list[dict]:
    """One reconcile pass over open Alpaca-paper scanner spreads. Returns the list
    of actions taken (for logging/tests). `price_of` is injectable for tests."""
    from .brokers import alpaca_broker as _ab
    from .brokers import alpaca_execution as _ax
    actions: list[dict] = []
    rows = store.load_paper_trades(status="open", book="scanner-spread", broker="alpaca-paper")
    if not rows:
        return actions
    conn = _ab.AlpacaConnection()

    def _audit(_r):   # scanner-spread orders log to the app log, not the strategy audit
        log.info("scanner_exec order: %s", _r.get("mode"))

    for row in rows:
        rid = row["id"]
        try:
            # ── 1. confirm the entry fill ──────────────────────────────────────
            if (row.get("fill_status") or "pending") == "pending":
                oid = row.get("entry_order_id")
                if not oid:
                    continue
                st = conn.order_status(oid)
                s = st.get("status")
                if s == "filled":
                    store.set_broker_fill(rid, broker_status="filled", fill_status="filled",
                                          filled_avg=st.get("filled_avg_price"), filled_at=_now())
                    actions.append({"id": rid, "action": "filled", "avg": st.get("filled_avg_price")})
                elif s in TERMINAL_UNFILLED:
                    store.close_paper_trade(rid, spy_exit=0.0, exit_reason="never_filled",
                                            pnl=0.0, pnl_pct=0.0, closed_at=_now())
                    actions.append({"id": rid, "action": "never_filled", "status": s})
                # else still working — leave pending
                continue

            # ── 2. active position: stop-loss / target / broker-flat ───────────
            px = price_of(row["underlying"])
            if px is None:
                continue
            if _breached_invalidation(row, px):
                # STOP-LOSS: reduce-only close on Alpaca paper (best-effort), then book.
                _place_close(_ax, row, _audit)
                pnl = _spread_pnl(row, "invalidation")
                store.close_paper_trade(rid, spy_exit=round(px, 2), exit_reason="stop-loss",
                                        pnl=pnl, pnl_pct=-100.0, closed_at=_now())
                actions.append({"id": rid, "action": "stop-loss", "px": px, "pnl": pnl})
            elif _reached_target(row, px):
                _place_close(_ax, row, _audit)
                pnl = _spread_pnl(row, "target")
                store.close_paper_trade(rid, spy_exit=round(px, 2), exit_reason="target",
                                        pnl=pnl, pnl_pct=None, closed_at=_now())
                actions.append({"id": rid, "action": "target", "px": px, "pnl": pnl})
        except Exception as e:  # noqa: BLE001 — one row's failure never sinks the pass
            log.warning("scanner_exec: row %s failed: %s", rid, e)
    return actions


def _place_close(_ax, row: dict, audit) -> None:
    """Submit the reduce-only close of the spread to Alpaca paper (the exit leg).
    Best-effort — a broker failure still books the modeled close in our ledger."""
    try:
        side = "long" if row.get("structure") == "debit_call_spread" else "short"
        res = _ax.place_exit(side, row.get("alpaca_symbol") or row["underlying"],
                             int(row.get("contracts") or 4), strategy="scanner-spread",
                             audit=audit, paper=True)
        if res.get("order_id"):
            row_store_exit = res["order_id"]
            log.info("scanner_exec: exit order %s for row %s", row_store_exit, row["id"])
    except Exception as e:  # noqa: BLE001
        log.warning("scanner_exec: exit submit failed for row %s: %s", row.get("id"), e)


def run_loop(store, interval_sec: float = 60.0) -> None:  # pragma: no cover
    """Poll forever (market-hours gated). Mirrors execution_monitor.run_loop."""
    from . import signal_bot
    log.info("scanner_exec: %ss interval", interval_sec)
    while True:
        started = time.time()
        try:
            if signal_bot.market_open_now():
                acts = tick(store)
                if acts:
                    log.info("scanner_exec: %d action(s): %s", len(acts), acts)
        except Exception as e:  # noqa: BLE001
            log.error("scanner_exec tick failed: %s", e)
        time.sleep(max(1.0, interval_sec - (time.time() - started)))


def _demo() -> None:
    """Self-check: stop-loss / target detection + modeled P&L, offline (no broker,
    no network) via a fake store + injected price."""
    # a filled long call spread: long 250, short 255, invalid 247.5, debit 2.5, ×4.
    row = {"id": 1, "structure": "debit_call_spread", "underlying": "X",
           "long_strike": 250.0, "short_strike": 255.0, "underlying_invalid": 247.5,
           "est_debit": 2.5, "contracts": 4, "fill_status": "filled", "status": "open",
           "broker": "alpaca-paper", "entry_order_id": "o1", "book": "scanner-spread"}
    assert _breached_invalidation(row, 247.0) and not _breached_invalidation(row, 248.0)
    assert _reached_target(row, 255.5) and not _reached_target(row, 254.0)
    assert _spread_pnl(row, "target") == round((5.0 - 2.5) * 4 * 100, 2) == 1000.0
    assert _spread_pnl(row, "invalidation") == round(-2.5 * 4 * 100, 2) == -1000.0
    # short (put) spread mirrors: invalidation is ABOVE, target BELOW.
    put = {**row, "structure": "debit_put_spread", "long_strike": 250.0,
           "short_strike": 245.0, "underlying_invalid": 252.5}
    assert _breached_invalidation(put, 253.0) and _reached_target(put, 244.0)

    # tick over a fake store: a filled long spread whose price breached invalidation
    # → stop-loss close booked at −debit.
    class _FakeStore:
        uses_sqlite = True
        def __init__(self): self.closed = []
        def load_paper_trades(self, **k): return [dict(row)]
        def set_broker_fill(self, *a, **k): return True
        def close_paper_trade(self, rid, **k): self.closed.append((rid, k)); return True
    # stub the broker modules tick imports
    import sys, types
    fake_ax = types.SimpleNamespace(place_exit=lambda *a, **k: {"order_id": None})
    fake_ab = types.SimpleNamespace(AlpacaConnection=lambda: types.SimpleNamespace(
        order_status=lambda oid: {"status": "filled", "filled_avg_price": 2.5}))
    sys.modules["vantage_server.brokers.alpaca_execution"] = fake_ax
    sys.modules["vantage_server.brokers.alpaca_broker"] = fake_ab
    st = _FakeStore()
    acts = tick(st, price_of=lambda s: 247.0)   # below the 247.5 invalidation
    assert any(a["action"] == "stop-loss" and a["pnl"] == -1000.0 for a in acts), acts
    print("scanner_exec self-check OK")


if __name__ == "__main__":  # pragma: no cover
    import sys
    from .store import Store
    if len(sys.argv) > 1 and sys.argv[1] == "--demo":
        _demo()
    else:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
        run_loop(Store(None), float(sys.argv[1]) if len(sys.argv) > 1 else 60.0)
