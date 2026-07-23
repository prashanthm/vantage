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


# ------------------------------------------------------ dedup

def test_arm_dedupes_same_strikes_across_rescans(tmp_path, monkeypatch):
    """Re-scans mint new setup_keys (as_of differs) — the same strikes must not
    open twice while a position is riding (the XEL×3 / MELI×2 July dupes)."""
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr(scanner, "_alpaca_paper_creds", lambda: False)
    monkeypatch.setattr(scanner_spread, "chain_debit", lambda *a, **k: None)
    n1 = scanner.arm_scanner_spreads(store, {"hits": [_hit("2026-07-17T15:30:00-04:00")]})
    n2 = scanner.arm_scanner_spreads(store, {"hits": [_hit("2026-07-17T16:30:00-04:00")]})
    assert n1 == 1 and n2 == 0
    assert len(store.load_paper_trades(status="open", book="scanner-spread")) == 1
