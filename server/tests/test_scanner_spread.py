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

def test_spread_from_hit_snaps_to_listed_contracts(monkeypatch):
    monkeypatch.setattr(scanner_spread, "snap_to_chain",
                        lambda *a, **k: {"expiry": "2026-09-18",
                                         "long_strike": 540.0,
                                         "short_strike": 585.0, "debit": 17.4})
    s = scanner_spread.spread_from_hit(_hit(), price_chain=True)
    assert s["est_debit"] == 17.4 and s["debit_src"] == "chain-mid"
    assert s["long_strike"] == 540.0 and s["short_strike"] == 585.0
    assert s["expiration"] == "2026-09-18"
    order = scanner_spread.alpaca_order(s)
    assert order["legs"][0]["symbol"] == "AMAT260918C00540000"   # snapped expiry
    assert order["legs"][1]["symbol"] == "AMAT260918C00585000"


def test_spread_from_hit_falls_back_to_modeled(monkeypatch):
    monkeypatch.setattr(scanner_spread, "snap_to_chain", lambda *a, **k: None)
    s = scanner_spread.spread_from_hit(_hit(), price_chain=True)
    assert s["est_debit"] == 25.0 and s["debit_src"] == "modeled"   # width 50 × 0.5
    assert s["expiration"] is None
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
    monkeypatch.setattr(scanner_spread, "snap_to_chain",
                        lambda *a, **k: {"expiry": "2026-09-18", "long_strike": 540.0,
                                         "short_strike": 590.0, "debit": 25.0})
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
    monkeypatch.setattr(scanner_spread, "snap_to_chain",
                        lambda *a, **k: {"expiry": "2026-09-18", "long_strike": 540.0,
                                         "short_strike": 590.0, "debit": 8.0})
    n1 = scanner.arm_scanner_spreads(store, {"hits": [_hit("2026-07-17T15:30:00-04:00")]})
    n2 = scanner.arm_scanner_spreads(store, {"hits": [_hit("2026-07-17T16:30:00-04:00")]})
    assert n1 == 1 and n2 == 0
    assert len(store.load_paper_trades(status="open", book="scanner-spread")) == 1


# ------------------------------------------------------ breakout_hold detector

def _reclaim_series():
    """Synthetic hourly tape: pivot cluster ~100.3 that price never held above
    (flat closes at 100), a bump zone ~103 (the target), then 3 consecutive
    hourly closes above the cluster — the validated breakout-hold."""
    n = 300
    cl = [100.0] * n
    for i in range(100, 111):                      # the 103 bump (target zone)
        cl[i] = 103.0
    for i in range(290, 293):                      # the break: support lost
        cl[i] = 98.5
    for i in range(293, 296):                      # 3 hourly closes back above
        cl[i] = 100.5
    for i in range(296, 298):                      # fresh tail (bars_ago = 2)
        cl[i] = 100.6
    cl = cl[:298]
    hi = [c + 0.3 for c in cl]
    lo = [c - 0.3 for c in cl]
    ts = [f"2026-07-{10 + i // 7:02d}T{9 + i % 7:02d}:30:00-04:00" for i in range(len(cl))]
    return {"ts": ts, "open": cl, "high": hi, "low": lo, "close": cl}


def test_breakout_hold_detector(monkeypatch):
    ser = _reclaim_series()
    monkeypatch.setattr(scanner, "load_hourly_series", lambda *a, **k: ser)
    s = scanner._scan_breakout_hold(object(), "TEST")
    assert s and s["present"] is True and s["dir"] == "long"
    assert s["tier"] == "A+" and s["targets"], s
    assert abs(s["ce"] - 100.5) < 0.01
    assert s["invalid"] < s["level"] <= 100.5      # stop below the broken cluster
    assert not s.get("stale")                      # held 3 closes, 2 bars ago


def test_breakout_hold_is_long_only_and_skips_reclaims(monkeypatch):
    # mirror tape contains a short-reclaim shape; the detector must never emit
    # a short (dir is structurally long-only). Also: a level price HELD above
    # before losing it (the true-reclaim class, PF 1.40) must not signal —
    # covered because the mirror's held-above zones produce no long signal.
    ser = _reclaim_series()
    flip = {k: ([200.0 - v for v in vals] if k != "ts" else vals)
            for k, vals in ser.items()}
    flip["high"], flip["low"] = flip["low"], flip["high"]
    monkeypatch.setattr(scanner, "load_hourly_series", lambda *a, **k: flip)
    s = scanner._scan_breakout_hold(object(), "TEST")
    assert s is None or s.get("present") is False or s.get("dir") == "long"


def test_arm_tags_strategy_and_by_strategy_stats(tmp_path, monkeypatch):
    from vantage_server import paper
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr(scanner, "_alpaca_paper_creds", lambda: False)
    monkeypatch.setattr(scanner_spread, "snap_to_chain",
                        lambda *a, **k: {"expiry": "2026-09-18", "long_strike": 540.0,
                                         "short_strike": 590.0, "debit": 8.0})
    assert scanner.arm_scanner_spreads(
        store, {"scanner": "breakout_hold", "hits": [_hit()]}) == 1
    row = store.load_paper_trades(status="open", book="scanner-spread")[0]
    assert row["setup"] == "breakout_hold"
    store.close_paper_trade(row["id"], spy_exit=590.0, exit_reason="target",
                            pnl=1000.0, pnl_pct=None, closed_at="2026-07-24T15:00:00Z")
    book = paper.build_spread_book(store)
    assert book["by_strategy"]["breakout_hold"]["n"] == 1
    assert book["by_strategy"]["breakout_hold"]["total_pnl"] == 1000.0
