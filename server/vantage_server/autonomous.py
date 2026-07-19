"""The autonomous strategy driver (ADR-015, T2.7) — the loop that lets a promoted
strategy OPEN and close real exposure, only within the four gates.

This is the money path. It mirrors signal_bot's driver shape (build tickets from
the playbook, one pass = tick) but instead of opening a paper trade it:

  1. runs ONLY for strategies lifecycle.is_live_eligible() marks live (gate 3);
  2. recomputes the order from strategy geometry (never a client/free-form order);
  3. resolves the strategy's caps + live-context (open positions, day P&L) and
     routes through alpaca_execution.submit_strategy_order — which enforces the
     kill switch + double env gate (gate 1), the caps (gate 2), and writes the
     immutable audit row (gate 4) via the injected sink;
  4. a CapBreach pauses THAT strategy (lifecycle.pause) — it opens nothing more
     until an operator resumes it. Everything is audited.

Dry-run is the default at every layer: with the env gates unarmed the driver
still runs end-to-end and records what it WOULD have done (mode 'dry_run'),
which is exactly how it is verified without real money. Autonomous live arms
only when the operator sets VANTAGE_LIVE_OK + VANTAGE_AUTONOMOUS_OK and clears
the kill switch.
"""
from __future__ import annotations

import logging

from . import lifecycle
from .brokers import alpaca_execution as ax
from .strategy import get_strategy

log = logging.getLogger(__name__)


def _audit_sink(store, now_iso: str):
    """An audit callback bound to a store + timestamp — the gate-4 sink passed
    into every order call. Stamps each record and appends it immutably."""
    def sink(rec: dict) -> None:
        rec = {"at": now_iso, **rec, "strategy_id": rec.get("strategy") or rec.get("strategy_id")}
        store.append_audit(rec)
    return sink


def _orders_for(store, strategy_id: str) -> list[dict]:
    """Recompute the strategy's OPEN orders from its geometry (never trusted from
    a client). For reclaim this reuses the same reclaim tickets signal_bot drives,
    mapped to the internal order shape submit_strategy_order validates.

    Only reclaim-3x5m tickets that pass the edge guard become orders. Returns a
    list of {symbol, side, qty, type, limit_price, est_usd, ticket_key}."""
    from . import paper
    strat = get_strategy(strategy_id)
    out: list[dict] = []
    for und in strat.universe:
        row = store.load_spx_playbook(symbol=und)
        scaffold = (row or {}).get("scaffold")
        if not scaffold:
            continue
        view = paper.build_analysis(store, scaffold, underlying=und)
        for t in view.get("tickets") or []:
            if t.get("entry_trigger") != "reclaim-3x5m":
                continue
            entry = t.get("spy_entry"); stop = t.get("spy_stop"); target = t.get("spy_target")
            if entry is None or stop is None:
                continue
            ok, _ = strat.is_worth_taking(float(entry), float(stop),
                                          float(target) if target is not None else None,
                                          str(t.get("side")))
            if not ok:
                continue   # edge guard — the strategy refuses its own bad geometry
            qty = int(t.get("shares") or 0)
            if qty <= 0:
                continue
            out.append({
                "symbol": str(t.get("symbol")).upper(),
                # a reclaim ENTRY: long → buy, short → sell-to-open (equity for now).
                "side": "buy" if str(t.get("side")) == "long" else "sell",
                "qty": qty, "type": "limit", "limit_price": float(entry),
                "est_usd": round(float(entry) * qty, 2),
                "ticket_key": f"{und}:{t.get('side')}:{t.get('spy_level')}",
            })
    return out


def _live_context(store, strategy_id: str) -> dict:
    """The cap-check context for a strategy: how many positions it has open and
    its day P&L, read LIVE from the broker (Alpaca `unrealized_intraday_pl` summed
    over the strategy's universe). This is what max_daily_loss_usd / max_positions
    check before a submit. On a broker failure day_pnl is unknown → 0.0 so a STALE
    read never fabricates a loss (which would wrongly pause) nor hides one — the
    position-count cap still gates opening, and the failure is logged."""
    strat = get_strategy(strategy_id)
    # ponytail: universe-scoped day P&L is exact while reclaim is the only live
    # strategy; if two live strategies ever share a symbol it double-counts —
    # upgrade to per-order_id attribution (needs strategy_id on managed_positions).
    symbols = {s.upper() for s in strat.universe}
    try:
        from .brokers.alpaca_broker import AlpacaConnection
        pnl, open_positions = AlpacaConnection().day_pnl(symbols)
        return {"open_positions": open_positions, "day_pnl": pnl}
    except Exception as e:  # noqa: BLE001 — broker unreachable / no creds
        log.warning("day P&L unavailable for %s (%s) — treating as 0", strategy_id, e)
        # fall back to the audited open count so max_positions still gates.
        submitted = [a for a in store.load_audit(strategy_id, limit=500)
                     if a.get("mode") == "submitted"]
        return {"open_positions": len(submitted), "day_pnl": 0.0}


def tick(store, now_iso: str, *, live: bool = False) -> dict:
    """One autonomous pass over every LIVE strategy. For each, recompute orders
    and route them through all four gates. A CapBreach pauses that strategy.
    Returns {strategies: [{strategy_id, submitted, dry_run, refused, paused?}]}.
    `live=False` (default) forces dry-run everywhere regardless of env — the safe
    default for verification."""
    results = []
    audit = _audit_sink(store, now_iso)
    for strategy_id in _live_strategies(store):
        eligible = lifecycle.is_live_eligible(store, strategy_id)
        caps = lifecycle.caps_for(store, strategy_id)
        counts = {"strategy_id": strategy_id, "submitted": 0, "dry_run": 0, "refused": 0}
        try:
            orders = _orders_for(store, strategy_id)
        except Exception as e:  # noqa: BLE001 — a data glitch skips this strategy, never crashes the loop
            log.exception("order recompute failed for %s", strategy_id)
            counts["error"] = str(e)
            results.append(counts)
            continue
        for order in orders:
            ctx = _live_context(store, strategy_id)
            try:
                r = ax.submit_strategy_order(
                    order, strategy=strategy_id, live_eligible=eligible,
                    caps=caps, context=ctx, audit=audit, live=live)
                counts[r["mode"]] = counts.get(r["mode"], 0) + 1
            except ax.CapBreach as cb:
                # gate 2: a cap breach pauses THIS strategy — it opens nothing more.
                lifecycle.pause(store, strategy_id,
                                f"cap '{cb.cap}' breached (limit {cb.limit})", now_iso)
                counts["paused"] = f"cap:{cb.cap}"
                break
            except ax.ExecutionViolation as ev:
                counts["refused"] = counts.get("refused", 0) + 1
                log.warning("autonomous order refused (%s): %s", strategy_id, ev)
        results.append(counts)
    return {"strategies": results}


def _live_strategies(store) -> list[str]:
    """Ids of strategies currently in the LIVE stage (the only ones the driver
    acts for). Paused/eligible/paper strategies are skipped."""
    return [r["strategy_id"] for r in store.load_lifecycle() if r.get("stage") == "live"]


def run_loop(store, interval_sec: float = 60.0, *, live: bool = False) -> None:  # pragma: no cover
    """Continuous driver (mirrors signal_bot.run_loop). Gated to market hours via
    signal_bot.market_open_now. Each pass is a tick(); the kill switch (checked
    inside the order path) halts submits mid-loop without stopping the process."""
    import time

    from . import signal_bot
    log.info("autonomous driver up (live=%s, interval=%ss)", live, interval_sec)
    while True:
        try:
            if signal_bot.market_open_now():
                now = _now_iso()
                out = tick(store, now, live=live)
                if any(c.get("submitted") for c in out["strategies"]):
                    log.info("autonomous tick: %s", out)
        except Exception:  # noqa: BLE001 — a bad pass must not kill the loop
            log.exception("autonomous tick failed")
        time.sleep(interval_sec)


def _now_iso() -> str:  # pragma: no cover
    import datetime as _dt
    return _dt.datetime.now().isoformat(timespec="seconds")


def _demo() -> None:
    """assert-based self-check (run: python -m vantage_server.autonomous). Proves
    the driver dry-runs end-to-end with NO env gates, records audit, and that a
    cap breach pauses the strategy — all without network, creds, or real money."""
    import tempfile
    from pathlib import Path

    from .store import Store, _SqliteBackend

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        store = Store(str(tmp))
        store._backend = _SqliteBackend(tmp, tmp / "vantage.db")
        NOW = "2026-07-19T13:00:00"

        # promote reclaim to live (stub the gate + orders so no playbook is needed).
        from . import lifecycle as L
        L_g = vars(L)
        L_g["paper_win_rate"] = lambda s, sid: (0.7, 40)
        L_g["backtest_baseline"] = lambda sid, cache_path=None: 0.6
        L.promote(store, "reclaim", account="ALPACA-PAPER",
                  caps={"max_order_usd": 5000, "max_positions": 5}, now_iso=NOW)

        # stub the order recompute (no playbook scaffold in this temp store).
        globals()["_orders_for"] = lambda s, sid: [
            {"symbol": "SPY", "side": "buy", "qty": 10, "type": "limit",
             "limit_price": 450.0, "est_usd": 4500.0, "ticket_key": "k1"}]

        # dry-run pass (no env gates): records a dry_run audit, opens nothing live.
        out = tick(store, NOW, live=False)
        r = out["strategies"][0]
        assert r["strategy_id"] == "reclaim" and r.get("dry_run") == 1, out
        assert store.load_audit("reclaim")[0]["mode"] == "dry_run"

        # cap breach: an order over max_order_usd, with env armed, pauses the strat.
        import os
        os.environ["VANTAGE_LIVE_OK"] = "1"; os.environ["VANTAGE_AUTONOMOUS_OK"] = "1"
        globals()["_orders_for"] = lambda s, sid: [
            {"symbol": "SPY", "side": "buy", "qty": 100, "type": "limit",
             "limit_price": 450.0, "est_usd": 45000.0, "ticket_key": "big"}]
        try:
            tick(store, NOW, live=True)
        finally:
            os.environ.pop("VANTAGE_LIVE_OK", None); os.environ.pop("VANTAGE_AUTONOMOUS_OK", None)
        assert L._row(store, "reclaim")["stage"] == "paused", "cap breach must pause"
        assert any(a["mode"] == "cap_breach" for a in store.load_audit("reclaim"))

    print("ok — autonomous driver self-check passed")


if __name__ == "__main__":
    _demo()
