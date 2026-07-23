"""Scanner debit spreads: real-debit pricing, fill-based P&L, open-position dedup."""
from __future__ import annotations

from vantage_server import scanner, scanner_exec, scanner_spread


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _hit(as_of="2026-07-17T15:30:00-04:00"):
    return {"present": True, "tier": "A+", "symbol": "AMAT", "dir": "long",
            "ce": 540.0, "invalid": 537.8, "as_of": as_of,
            "targets": [{"r": 1, "price": 542}, {"r": 6.6, "price": 591.09}]}


# ------------------------------------------------------ debit pricing

def test_spread_from_hit_prices_from_chain_when_available(monkeypatch):
    monkeypatch.setattr(scanner_spread, "chain_debit",
                        lambda *a, **k: 17.4)
    s = scanner_spread.spread_from_hit(_hit(), price_chain=True)
    assert s["est_debit"] == 17.4 and s["debit_src"] == "chain-mid"


def test_spread_from_hit_falls_back_to_modeled(monkeypatch):
    monkeypatch.setattr(scanner_spread, "chain_debit", lambda *a, **k: None)
    s = scanner_spread.spread_from_hit(_hit(), price_chain=True)
    assert s["est_debit"] == 25.0 and s["debit_src"] == "modeled"   # width 50 × 0.5
    # default (pure) path never calls the chain
    s2 = scanner_spread.spread_from_hit(_hit())
    assert s2["est_debit"] == 25.0 and s2["debit_src"] == "modeled"


def test_spread_pnl_prefers_real_fill_debit():
    row = {"est_debit": 2.5, "filled_avg": 1.8, "contracts": 4,
           "long_strike": 540.0, "short_strike": 545.0}
    # win: (width − real debit) = (5 − 1.8) × 4 × 100
    assert scanner_exec._spread_pnl(row, "target") == 1280.0
    # loss: −real debit
    assert scanner_exec._spread_pnl(row, "invalidation") == -720.0
    row.pop("filled_avg")
    assert scanner_exec._spread_pnl(row, "invalidation") == -1000.0  # modeled fallback


# ------------------------------------------------------ broker close (mleg)

def test_occ_parse_roundtrip():
    import datetime as dt
    sym = scanner_spread.occ_symbol("AMAT", dt.date(2026, 8, 21), "C", 540.0)
    root, expiry, right, strike = scanner_exec.occ_parse(sym)
    assert (root, expiry, right, strike) == ("AMAT", dt.date(2026, 8, 21), "C", 540.0)
    assert scanner_exec.occ_parse("SPY") is None
    assert scanner_exec.occ_parse("") is None


def test_place_close_sends_both_legs_to_close(monkeypatch):
    """The close must be the SAME mleg structure reversed — a single-leg close
    (the old behavior) left the short leg naked at the broker."""
    calls = {}

    class _FakeAx:
        @staticmethod
        def place_exit(side, symbol, qty, **kw):
            calls.update(side=side, symbol=symbol, qty=qty, **kw)
            return {"order_id": "x1"}

    row = {"id": 7, "structure": "debit_call_spread", "underlying": "AMAT",
           "contracts": 4, "short_strike": 590.0,
           "alpaca_symbol": "AMAT260821C00540000"}
    scanner_exec._place_close(_FakeAx, row, lambda r: None)
    legs = calls["legs"]
    assert [l["position_intent"] for l in legs] == ["sell_to_close", "buy_to_close"]
    assert legs[0]["symbol"] == "AMAT260821C00540000"
    assert legs[1]["symbol"] == "AMAT260821C00590000"
    assert calls["side"] == "long" and calls["qty"] == 4 and calls["paper"] is True


def test_place_exit_legs_shape_and_tif():
    """Options exits: tif 'day' (Alpaca options rule — gtc 422s), mleg body with
    *_to_close intents only; equity exits keep gtc + reduce_only."""
    from vantage_server.brokers import alpaca_execution as ax
    legs = [{"symbol": "AMAT260821C00540000", "side": "sell",
             "position_intent": "sell_to_close", "ratio_qty": 1},
            {"symbol": "AMAT260821C00590000", "side": "buy",
             "position_intent": "buy_to_close", "ratio_qty": 1}]
    res = ax.place_exit("long", "AMAT", 4, strategy="scanner-spread",
                        audit=lambda r: None, legs=legs)     # no live/paper → dry_run
    assert res["mode"] == "dry_run"
    o = res["order"]
    assert o["time_in_force"] == "day" and o["legs"] == legs and not o["reduce_only"]
    body = ax._alpaca_body(o)
    assert body["order_class"] == "mleg" and "symbol" not in body
    assert [l["position_intent"] for l in body["legs"]] == ["sell_to_close", "buy_to_close"]
    # equity exit unchanged: gtc + reduce_only, no legs
    res_eq = ax.place_exit("long", "SPY", 10, strategy="x", audit=lambda r: None)
    assert res_eq["order"]["time_in_force"] == "gtc" and res_eq["order"]["reduce_only"]
    # a leg that could OPEN exposure is refused outright
    import pytest
    with pytest.raises(ax.ExecutionViolation):
        ax.place_exit("long", "AMAT", 4, strategy="x", audit=lambda r: None,
                      legs=[{"symbol": "AMAT260821C00540000", "side": "buy",
                             "position_intent": "buy_to_open", "ratio_qty": 1}])


# ------------------------------------------------------ dedup

def test_arm_gates_contract_risk(tmp_path, monkeypatch):
    """debit × 100 > MAX_CONTRACT_RISK → recorded as skipped (exit_reason=
    'contract_risk', $0), never opened. The ladder needs ×4 contracts, so
    over-risk setups are gated, not downsized. Skips don't grade the book."""
    from vantage_server import paper
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr(scanner, "_alpaca_paper_creds", lambda: False)
    # AMAT width-50 spread, chain says $25.00 debit → $2,500/contract > $1,000
    monkeypatch.setattr(scanner_spread, "chain_debit", lambda *a, **k: 25.0)
    assert scanner.arm_scanner_spreads(store, {"hits": [_hit()]}) == 0
    assert store.load_paper_trades(status="open", book="scanner-spread") == []
    closed = store.load_paper_trades(status="closed", book="scanner-spread")
    assert len(closed) == 1 and closed[0]["exit_reason"] == "contract_risk"
    assert closed[0]["pnl"] == 0.0
    book = paper.build_spread_book(store)
    assert book["stats"] == {"n": 0}          # skips never grade the book
    assert len(book["closed"]) == 1           # but stay visible in the record


def test_arm_dedupes_same_strikes_across_rescans(tmp_path, monkeypatch):
    """Re-scans mint new setup_keys (as_of differs) — the same strikes must not
    open twice while a position is riding (the XEL×3 / MELI×2 July dupes)."""
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr(scanner, "_alpaca_paper_creds", lambda: False)
    # $8 debit = $800/contract — under the risk cap so the arm goes through
    monkeypatch.setattr(scanner_spread, "chain_debit", lambda *a, **k: 8.0)
    n1 = scanner.arm_scanner_spreads(store, {"hits": [_hit("2026-07-17T15:30:00-04:00")]})
    n2 = scanner.arm_scanner_spreads(store, {"hits": [_hit("2026-07-17T16:30:00-04:00")]})
    assert n1 == 1 and n2 == 0
    assert len(store.load_paper_trades(status="open", book="scanner-spread")) == 1
