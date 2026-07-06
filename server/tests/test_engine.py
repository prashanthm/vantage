"""Unit tests for every engine function (fixture dataset, deterministic)."""
from __future__ import annotations

import pytest

from vantage_server import engine
from vantage_server.models import Lot


# ---------------------------------------------------------------- date math

class TestDaysAgo:
    """util.jsx daysAgo parity: floor((TODAY - date@noon)/24h), TODAY=Jul 5 09:30 ET."""

    def test_recent_buy(self, today):
        # Jul 1 noon -> Jul 5 09:30 is 3d 21.5h -> floor 3
        assert engine.days_ago(today, "2026-07-01") == 3

    def test_thirty_calendar_days(self, today):
        # Jun 5 noon -> Jul 5 09:30 is 29d 21.5h -> 29 (inside window)
        assert engine.days_ago(today, "2026-06-05") == 29

    def test_window_edge_matches_util_jsx(self, today):
        # Jun 4 is 31 calendar days back but util.jsx's floor makes it 30 —
        # still <= WASH_WINDOW_DAYS. This is the deliberate noon-anchor quirk.
        assert engine.days_ago(today, "2026-06-04") == 30
        assert engine.days_ago(today, "2026-06-03") == 31

    def test_future_date_negative(self, today):
        assert engine.days_ago(today, "2026-07-08") < 0


def test_fmt_date():
    assert engine.fmt_date("2026-07-01") == "Jul 1"
    assert engine.fmt_date("2026-12-25") == "Dec 25"


def test_add_days_iso():
    assert engine.add_days_iso("2026-07-01", 31) == "2026-08-01"
    assert engine.add_days_iso("2026-06-30", 31) == "2026-07-31"


def test_next_day_of_month(today):
    # today is Jul 5; dom=1 already passed -> Aug 1
    assert engine.next_day_of_month(today, 1).isoformat() == "2026-08-01"
    # dom=15 still ahead -> Jul 15
    assert engine.next_day_of_month(today, 15).isoformat() == "2026-07-15"
    # dom > 28 clamps to 28 (tlh_monitor-style safety)
    assert engine.next_day_of_month(today, 31).isoformat() == "2026-07-28"


# ------------------------------------------------------------ lot valuation

def test_lot_value_cost_unrealized(quotes):
    lot = Lot(account="fid-taxable", symbol="IWM", date="2026-02-12",
              shares=45, cost_per_share=331.20)
    assert engine.lot_value(lot, quotes) == pytest.approx(45 * 297.58)
    assert engine.lot_cost(lot) == pytest.approx(45 * 331.20)
    assert engine.lot_unrealized(lot, quotes) == pytest.approx(-1512.90)


def test_select_lots(dataset):
    assert len(engine.select_lots(dataset.lots, "all")) == 18
    assert len(engine.select_lots(dataset.lots, None)) == 18
    fid = engine.select_lots(dataset.lots, "fid-taxable")
    assert len(fid) == 7
    assert all(l.account == "fid-taxable" for l in fid)
    assert engine.select_lots(dataset.lots, "no-such-account") == []


def test_account_value(dataset, quotes):
    assert engine.account_value(dataset.lots, quotes, "schwab-roth") == pytest.approx(44093.04)


# ------------------------------------------------------------------- wash

def test_wash_family():
    assert engine.wash_family("VOO") == ("VOO", "SPY", "IVV")
    assert engine.wash_family("SPY") == ("VOO", "SPY", "IVV")
    assert engine.wash_family("QQQM") == ("QQQ", "QQQM")
    assert engine.wash_family("IWM") == ("IWM",)  # no family -> itself


def _wash(dataset, today, sym, **over):
    kwargs = dict(
        accounts=dataset.accounts,
        recent_buys=dataset.recent_buys,
        auto_buys=dataset.auto_buys,
        today=today,
    )
    kwargs.update(over)
    return engine.wash_status(sym, **kwargs)


class TestWashStatus:
    def test_blocked_by_recent_buy(self, dataset, today):
        ws = _wash(dataset, today, "VOO")
        assert ws.blocked
        assert "Robo bought VOO on Jul 1" in ws.reason
        assert ws.clears_on_date == "2026-08-01"
        assert ws.clears_on == "Aug 1"
        assert ws.future_risk is not None and ws.future_risk.symbol == "VOO"

    def test_family_member_blocks_sibling(self, dataset, today):
        # No SPY was bought anywhere — the VOO buy blocks SPY via the S&P family.
        ws = _wash(dataset, today, "SPY")
        assert ws.blocked and "VOO" in ws.reason

    def test_blocked_by_future_auto_buy(self, dataset, today):
        # Strip the recent buys: VOO must still block on the scheduled monthly
        # auto-buy (look-forward: a repurchase within 30d after the sale washes it).
        ws = _wash(dataset, today, "VOO", recent_buys=())
        assert ws.blocked
        assert "auto-buys VOO monthly (next: Aug 1)" in ws.reason
        assert ws.clears_on == "auto-buy paused"
        assert ws.clears_on_date is None

    def test_cadence_only_auto_buy_does_not_trigger_future_branch(self, dataset, today):
        # VTI's auto-buy has no day_of_month (biweekly cadence) — util.jsx only
        # blocks the future branch on dayOfMonth != null.
        ws = _wash(dataset, today, "VTI", recent_buys=())
        assert not ws.blocked

    def test_clear_symbol(self, dataset, today):
        for sym in ("IWM", "TSLA", "BND"):
            ws = _wash(dataset, today, sym)
            assert not ws.blocked
            assert ws.reason is None

    def test_recent_buy_outside_window_ignored(self, dataset, today):
        from vantage_server.models import RecentBuy
        old = (RecentBuy(account="wf-robo", symbol="IWM", date="2026-05-01", note="old"),)
        ws = _wash(dataset, today, "IWM", recent_buys=old)
        assert not ws.blocked


# --------------------------------------------------------------- positions

def test_overlap_for(dataset):
    ov = engine.overlap_for("VOO", dataset.lots)
    assert ov is not None
    assert ov.label == "US large blend"
    assert ov.symbols == ("VOO", "SPY", "VTI")  # IVV not held anywhere
    growth = engine.overlap_for("SCHG", dataset.lots)
    assert growth is not None and growth.symbols == ("QQQ", "SCHG")
    # IWM's small-cap group has only one member held -> no overlap
    assert engine.overlap_for("IWM", dataset.lots) is None
    assert engine.overlap_for("NVDA", dataset.lots) is None


def test_positions_grouping_and_sorting(dataset, quotes):
    pos = engine.positions(dataset.lots, quotes, "all")
    assert [p.symbol for p in pos[:3]] == ["VTI", "VOO", "BND"]
    values = [p.value for p in pos]
    assert values == sorted(values, reverse=True)
    voo = next(p for p in pos if p.symbol == "VOO")
    assert voo.shares == pytest.approx(60.4)
    assert voo.accounts == ("fid-taxable", "wf-robo")
    assert len(voo.lots) == 3
    assert voo.day_pl == pytest.approx(voo.value * -0.12 / 100)


def test_positions_weights_sum_to_100(dataset, quotes):
    pos = engine.positions(dataset.lots, quotes, "all")
    assert sum(p.weight for p in pos) == pytest.approx(100.0)


def test_positions_single_account_overlap_still_cross_account(dataset, quotes):
    # 401(k) holds VTI only among the large-blend group, but overlap is computed
    # over the FULL portfolio -> still flagged.
    pos = engine.positions(dataset.lots, quotes, "vg-401k")
    vti = next(p for p in pos if p.symbol == "VTI")
    assert vti.overlap is not None and vti.overlap.label == "US large blend"
    assert vti.weight == pytest.approx(59481.00 / 88471.50 * 100)


def test_positions_empty_scope(dataset, quotes):
    assert engine.positions(dataset.lots, quotes, "no-such-account") == []


def test_allocation_per_account(dataset, quotes):
    alloc = engine.allocation(dataset.lots, quotes, "schwab-roth")
    assert alloc.total == pytest.approx(44093.04)
    assert alloc.by_class["usEquity"] == pytest.approx(18762.00 + 13406.04)
    assert alloc.by_class["intlEquity"] == pytest.approx(10725.00)
    assert alloc.by_class["bonds"] == 0.0
    assert alloc.by_class["cash"] == pytest.approx(1200.0)


def test_allocation_tolerates_arbitrary_asset_classes():
    """Imported real portfolios carry quote entries with classes beyond the
    SPA's four (options marks, CRYPTO/FUTURES sleeves) — allocation must add
    them as new keys, never KeyError, while the four known classes are always
    present (zero when unheld)."""
    from vantage_server.models import Lot, Quote
    lots = [
        Lot(account="a", symbol="SOXL 2026-07-10 178C", date="2026-07-02",
            shares=1, cost_per_share=1982.0),
        Lot(account="a", symbol="CRYPTO", date="2026-07-05",
            shares=20723.17, cost_per_share=1),
        Lot(account="a", symbol="FUTURES", date="2026-07-05",
            shares=318.5, cost_per_share=1),
    ]
    q = {
        "SOXL 2026-07-10 178C": Quote(symbol="SOXL 2026-07-10 178C", name="x",
                                      price=2195.0, day_pct=0, asset_class="options"),
        "CRYPTO": Quote(symbol="CRYPTO", name="c", price=1, day_pct=0,
                        asset_class="crypto"),
        "FUTURES": Quote(symbol="FUTURES", name="f", price=1, day_pct=0,
                         asset_class="other"),
    }
    alloc = engine.allocation(lots, q)
    assert alloc.by_class["options"] == pytest.approx(2195.0)
    assert alloc.by_class["crypto"] == pytest.approx(20723.17)
    assert alloc.by_class["other"] == pytest.approx(318.5)
    # the four SPA classes stay present so the client never misses a key
    assert alloc.by_class["usEquity"] == 0.0
    assert alloc.by_class["cash"] == 0.0
    assert alloc.total == pytest.approx(2195.0 + 20723.17 + 318.5)


# --------------------------------------------------------------------- TLH

def _tlh(dataset, quotes, today, **over):
    kwargs = dict(
        accounts=dataset.accounts,
        recent_buys=dataset.recent_buys,
        auto_buys=dataset.auto_buys,
        partner_map=dataset.partner_map,
        today=today,
    )
    kwargs.update(over)
    return engine.tlh_candidates(dataset.lots, quotes, **kwargs)


class TestTlhCandidates:
    def test_gains_and_cash_skipped(self, dataset, quotes, today):
        cands = _tlh(dataset, quotes, today)
        symbols = {(c.lot.account, c.lot.symbol) for c in cands}
        assert ("fid-taxable", "NVDA") not in symbols  # gain
        assert all(c.lot.symbol != "CASH" for c in cands)
        assert all(c.unrealized < 0 for c in cands)

    def test_sorted_deepest_loss_first(self, dataset, quotes, today):
        cands = _tlh(dataset, quotes, today)
        unrls = [c.unrealized for c in cands]
        assert unrls == sorted(unrls)

    def test_non_taxable_is_na(self, dataset, quotes, today):
        cands = _tlh(dataset, quotes, today)
        bnd_401k = next(c for c in cands if c.lot.account == "vg-401k")
        assert bnd_401k.status == "na"
        assert bnd_401k.wash is None and bnd_401k.replacement is None

    def test_or_threshold_combinator(self, dataset, quotes, today):
        # util.jsx semantics: EITHER threshold qualifies. The Fidelity VOO lot
        # is -$267.60 / -3.16%: with usd threshold raised to 1000 it still
        # qualifies via pct (3.16 >= 3). tlh_monitor's AND would drop it.
        cands = _tlh(dataset, quotes, today, threshold_usd=1000.0)
        voo = next(c for c in cands if c.lot.symbol == "VOO")
        assert voo.status == "blocked"  # past threshold via pct, then wash-blocked

    def test_below_threshold(self, dataset, quotes, today):
        cands = _tlh(dataset, quotes, today, threshold_usd=300.0, threshold_pct=5.0)
        voo = next(c for c in cands if c.lot.symbol == "VOO")
        assert voo.status == "below"  # 267.60 < 300 and 3.16% < 5%
        tsla = next(c for c in cands if c.lot.symbol == "TSLA")
        assert tsla.status == "clear"  # 289.50 < 300 but 10.92% >= 5%

    def test_replacement_from_partner_map(self, dataset, quotes, today):
        cands = _tlh(dataset, quotes, today)
        iwm = next(c for c in cands if c.lot.symbol == "IWM")
        assert iwm.status == "clear" and iwm.replacement == "IJR"
        tsla = next(c for c in cands if c.lot.symbol == "TSLA")
        assert tsla.status == "clear" and tsla.replacement is None  # no partner

    def test_wash_blocked_candidate_carries_wash_detail(self, dataset, quotes, today):
        cands = _tlh(dataset, quotes, today)
        voo = next(c for c in cands if c.lot.symbol == "VOO")
        assert voo.status == "blocked"
        assert voo.wash is not None and voo.wash.blocked
        assert voo.replacement == "VTI"
