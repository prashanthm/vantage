"""Native Vantage GEX: pure BS-gamma math, internal consistency, store round-trip."""
from __future__ import annotations

from vantage_server import gex


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _book(spot=6000.0):
    """A small synthetic option book straddling spot: call OI concentrated above,
    put OI below — so walls land on opposite sides and net is positive."""
    b = []
    for k in range(5800, 6210, 50):
        b.append({"strike": float(k), "iv": 0.15, "t": 7 / 365, "oi": 2000.0, "is_call": True})
        b.append({"strike": float(k), "iv": 0.15, "t": 7 / 365, "oi": 1500.0, "is_call": False})
    return b


# ------------------------------------------------------------ pure math

def test_bs_gamma_peaks_atm_and_zero_on_bad_input():
    atm = gex.bs_gamma(6000, 6000, 0.15, 0.02)
    otm = gex.bs_gamma(6000, 6600, 0.15, 0.02)
    assert atm > otm > 0
    assert gex.bs_gamma(6000, 6000, 0, 0.02) == 0.0   # zero IV → 0, no crash


def test_contract_gex_sign_convention():
    # calls contribute +GEX, puts −GEX (the standard assumption)
    call = gex.contract_gex(6000, 6000, 0.15, 0.02, 1000, True)
    put = gex.contract_gex(6000, 6000, 0.15, 0.02, 1000, False)
    assert call > 0 and put < 0 and abs(call) == abs(put)


def test_regime_derived_from_net_sign():
    # a call-heavy book → positive net → 'positive' regime (cannot contradict)
    snap = gex.compute_gex(_book(), 6000.0)
    assert snap["regime"] == "positive"
    assert snap["net_gex"] >= 0
    assert "dampens" in snap["regime_text"]


def test_walls_on_opposite_sides_of_spot():
    snap = gex.compute_gex(_book(), 6000.0)
    cw, pw = snap["call_wall"], snap["put_wall"]
    assert cw is not None and pw is not None
    assert cw >= 6000.0 >= pw          # constrained opposite sides by construction


def test_max_pain_is_a_traded_strike():
    snap = gex.compute_gex(_book(), 6000.0)
    strikes = {c["strike"] for c in _book()}
    assert snap["max_pain"] in strikes


def test_narrative_matches_regime():
    snap = gex.compute_gex(_book(), 6000.0)
    snap["narrative"] = gex.build_narrative(snap)
    joined = " ".join(snap["narrative"]).lower()
    assert "long gamma" in joined and "mean-reversion" in joined


# ------------------------------------------------------------ store round-trip

def test_store_snapshot_and_history_round_trip(tmp_path):
    store = _sqlite_store(tmp_path)
    snap = gex.compute_gex(_book(), 6000.0)
    snap.update({"date": "2026-07-10", "symbol": "^SPX", "source": "test"})
    store.put_gex_snapshot(snap)
    store.record_gex_history(snap)
    loaded = store.load_gex_snapshot()
    assert loaded["spot"] == snap["spot"] and loaded["regime"] == snap["regime"]
    hist = store.load_gex_history()
    assert len(hist) == 1 and hist[0]["date"] == "2026-07-10"
    # idempotent per date
    store.record_gex_history(snap)
    assert len(store.load_gex_history()) == 1


def test_bridge_prefers_native_gex(tmp_path):
    from vantage_server import sentinel_bridge as sb
    store = _sqlite_store(tmp_path)
    snap = gex.compute_gex(_book(), 6000.0)
    snap.update({"date": "2026-07-10", "symbol": "^SPX", "source": "native"})
    store.put_gex_snapshot(snap)
    g = sb.gex_snapshot(store)
    assert g["available"] is True and g["source"] == "native"
    assert g["gamma_flip"] == snap["gamma_flip"]
