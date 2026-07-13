"""The managed-exit monitor (ADR-010 v3): pending-entry adoption, the
broker-resident-stop invariant (re-arm before anything else), ladder target
swap, trailing ratchet (favorable-only, threshold-gated), manual-close
adoption, the live gate (observe-only without VANTAGE_LIVE_OK=1), and the
store's identity-field immutability. Fully offline: broker calls stubbed."""
from __future__ import annotations

import datetime as _dt

import pytest

from vantage_server import execution_monitor as mon
from vantage_server.brokers import robinhood_execution as rexec


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _row(**over):
    base = {
        "opened_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "account_number": "ACCT1", "symbol": "SPY", "side": "long",
        "qty": 5.0, "entry_order_id": "entry1", "entry_price": 100.0,
        "initial_stop": 99.8, "stop_price": 99.8, "stop_order_id": "stop1",
        "exit_policy": "trailing", "target_price": None, "high_water": 100.0,
        "status": "active", "last_checked": None, "note": "t",
    }
    base.update(over)
    return base


class Broker:
    """Scriptable stand-in for the rexec/quote surface the monitor uses."""

    def __init__(self, monkeypatch, *, orders=None, price=None, pos_qty=5.0):
        self.orders = orders or {}          # order_id -> state row
        self.price = price
        self.pos_qty = pos_qty
        self.placed: list[dict] = []
        self.cancelled: list[str] = []
        monkeypatch.setattr(rexec, "order_status",
                            lambda acct, oid: self.orders.get(oid))
        monkeypatch.setattr(rexec, "place_exit_order", self._place)
        monkeypatch.setattr(rexec, "cancel_order", self._cancel)
        monkeypatch.setattr(mon, "last_price", lambda sym: self.price)
        monkeypatch.setattr(mon, "position_qty",
                            lambda acct, sym: self.pos_qty)

    def _place(self, acct, sym, side, qty, *, order_type,
               limit_price=None, stop_price=None, dry_run=True):
        self.placed.append({"symbol": sym, "position_side": side, "qty": qty,
                            "type": order_type, "limit_price": limit_price,
                            "stop_price": stop_price, "dry_run": dry_run})
        return {"success": True, "order_id": f"ord_{len(self.placed)}",
                "status": "queued", "message": "", "side": side,
                "type": order_type, "quantity": qty}

    def _cancel(self, acct, oid, *, dry_run=True):
        self.cancelled.append(oid)
        return True


@pytest.fixture()
def live(monkeypatch):
    monkeypatch.setenv(rexec.LIVE_ENV, "1")


# ------------------------------------------------------ pending entry

def test_pending_entry_fill_activates_and_rests_stop(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    pid = store.record_managed_position(_row(
        status="pending_entry", entry_price=None, stop_price=None,
        stop_order_id=None, high_water=None))
    broker = Broker(monkeypatch, orders={"entry1": {
        "id": "entry1", "state": "filled", "average_price": "100.10",
        "cumulative_quantity": "5"}})
    acts = mon.tick(store)
    assert any(a["action"] == "entry_filled" for a in acts)
    assert broker.placed[0]["type"] == "stop_market"
    assert broker.placed[0]["stop_price"] == 99.8
    row = store.load_managed_positions()[0]
    assert row["status"] == "active" and row["entry_price"] == 100.10
    assert row["stop_order_id"] == "ord_1" and row["high_water"] == 100.10
    assert row["id"] == pid


def test_pending_entry_rejected_closes_row(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(status="pending_entry",
                                       stop_order_id=None, stop_price=None))
    Broker(monkeypatch, orders={"entry1": {"id": "entry1", "state": "rejected"}})
    mon.tick(store)
    row = store.load_managed_positions()[0]
    assert row["status"] == "closed" and row["exit_reason"] == "never_filled"


def test_pending_entry_expires_and_cancels(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    old = (_dt.datetime.now(_dt.timezone.utc)
           - _dt.timedelta(hours=49)).isoformat()
    store.record_managed_position(_row(status="pending_entry", opened_at=old,
                                       stop_order_id=None, stop_price=None))
    broker = Broker(monkeypatch, orders={"entry1": {"id": "entry1",
                                                    "state": "confirmed"}})
    mon.tick(store)
    assert broker.cancelled == ["entry1"]
    assert store.load_managed_positions()[0]["status"] == "closed"


# ------------------------------------------------------ active: exits

def test_stop_fill_closes_row_with_reason_stop(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row())
    Broker(monkeypatch, orders={"stop1": {
        "id": "stop1", "state": "filled", "average_price": "99.78"}})
    mon.tick(store)
    row = store.load_managed_positions()[0]
    assert row["status"] == "closed"
    assert row["exit_reason"] == "stop" and row["exit_price"] == 99.78


def test_ratcheted_trailing_stop_fill_is_reason_trail(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(stop_price=100.6))  # above initial 99.8
    Broker(monkeypatch, orders={"stop1": {
        "id": "stop1", "state": "filled", "average_price": "100.58"}})
    mon.tick(store)
    assert store.load_managed_positions()[0]["exit_reason"] == "trail"


def test_flat_at_broker_adopts_and_cancels_orphan(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row())
    broker = Broker(monkeypatch,
                    orders={"stop1": {"id": "stop1", "state": "confirmed"}},
                    pos_qty=0.0)
    mon.tick(store)
    assert broker.cancelled == ["stop1"]
    assert store.load_managed_positions()[0]["exit_reason"] == "adopted_flat"


def test_missing_stop_is_rearmed_first(tmp_path, monkeypatch, live):
    """The invariant: no resting protection → re-arm before any policy."""
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(stop_order_id=None))
    broker = Broker(monkeypatch, price=100.0)
    acts = mon.tick(store)
    assert any(a["action"] == "stop_rearmed" for a in acts)
    assert broker.placed[0]["type"] == "stop_market"
    assert store.load_managed_positions()[0]["stop_order_id"] == "ord_1"


# ------------------------------------------------------ trailing policy

def test_trailing_ratchets_on_new_high(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row())  # entry 100, stop 99.8, trail 0.2
    broker = Broker(monkeypatch, price=100.5,
                    orders={"stop1": {"id": "stop1", "state": "confirmed"}})
    acts = mon.tick(store)
    assert any(a["action"] == "ratchet" for a in acts)
    assert broker.cancelled == ["stop1"]
    row = store.load_managed_positions()[0]
    assert row["high_water"] == 100.5 and row["stop_price"] == 100.3


def test_trailing_never_ratchets_down_or_on_noise(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(high_water=100.5, stop_price=100.3))
    broker = Broker(monkeypatch, price=99.9,   # pullback
                    orders={"stop1": {"id": "stop1", "state": "confirmed"}})
    acts = mon.tick(store)
    assert not any(a["action"] == "ratchet" for a in acts)
    assert broker.cancelled == []
    assert store.load_managed_positions()[0]["stop_price"] == 100.3


def test_trailing_short_ratchets_downward(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(side="short", initial_stop=100.2,
                                       stop_price=100.2, high_water=100.0))
    broker = Broker(monkeypatch, price=99.5,
                    orders={"stop1": {"id": "stop1", "state": "confirmed"}})
    mon.tick(store)
    row = store.load_managed_positions()[0]
    assert row["high_water"] == 99.5 and row["stop_price"] == 99.7
    assert broker.placed[0]["position_side"] == "short"


# ------------------------------------------------------ ladder policy

def test_ladder_swaps_stop_for_target_sell(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(exit_policy="ladder", target_price=101.0))
    broker = Broker(monkeypatch, price=101.05,
                    orders={"stop1": {"id": "stop1", "state": "confirmed"}})
    acts = mon.tick(store)
    assert any(a["action"] == "target_swap" for a in acts)
    assert broker.cancelled == ["stop1"]
    assert broker.placed[0] == {
        "symbol": "SPY", "position_side": "long", "qty": 5, "type": "limit",
        "limit_price": 101.0, "stop_price": None, "dry_run": False}
    row = store.load_managed_positions()[0]
    assert row["stop_price"] is None          # marks the target leg
    assert row["stop_order_id"] == "ord_1"


def test_ladder_target_fill_closes_with_reason_target(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(exit_policy="ladder", stop_price=None,
                                       target_price=101.0))
    Broker(monkeypatch, orders={"stop1": {
        "id": "stop1", "state": "filled", "average_price": "101.0"}})
    mon.tick(store)
    assert store.load_managed_positions()[0]["exit_reason"] == "target"


def test_ladder_below_target_does_nothing(tmp_path, monkeypatch, live):
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(exit_policy="ladder", target_price=101.0))
    broker = Broker(monkeypatch, price=100.4,
                    orders={"stop1": {"id": "stop1", "state": "confirmed"}})
    mon.tick(store)
    assert broker.cancelled == [] and broker.placed == []


# ------------------------------------------------------ the live gate

def test_gate_off_observes_but_never_orders(tmp_path, monkeypatch):
    monkeypatch.delenv(rexec.LIVE_ENV, raising=False)
    store = _sqlite_store(tmp_path)
    store.record_managed_position(_row(exit_policy="trailing"))
    broker = Broker(monkeypatch, price=100.5,
                    orders={"stop1": {"id": "stop1", "state": "confirmed"}})
    acts = mon.tick(store)
    assert any(a["action"] == "ratchet_observed" for a in acts)
    assert broker.cancelled == [] and broker.placed == []
    # heartbeat still updates so the operator can see it is watching
    assert store.load_managed_positions()[0]["last_checked"]


# ------------------------------------------------------ store immutability

def test_identity_fields_are_immutable(tmp_path):
    store = _sqlite_store(tmp_path)
    pid = store.record_managed_position(_row())
    with pytest.raises(ValueError, match="immutable"):
        store.update_managed_position(pid, symbol="TSLA")
    with pytest.raises(ValueError, match="immutable"):
        store.update_managed_position(pid, qty=500)
    assert store.update_managed_position(pid, stop_price=99.9)
