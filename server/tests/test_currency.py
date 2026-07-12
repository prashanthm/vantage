"""Multi-currency: seam correctness + US behavior preservation."""
from __future__ import annotations

from vantage_server import engine
from vantage_server.models import Account, Lot, Quote


def _acct(id, ccy="USD", juris="US", taxable=True):
    return Account(id=id, name=id, short=id, type="brokerage", taxable=taxable,
                   last_sync="never", currency=ccy, jurisdiction=juris)


def _q(sym, price, ccy="USD"):
    return Quote(symbol=sym, name=sym, price=price, day_pct=0.0,
                 asset_class="usEquity" if ccy == "USD" else "intlEquity", currency=ccy)


def test_single_currency_book_unchanged():
    # A pure-USD book: value_by_currency has one key = the old total.
    accts = [_acct("us")]
    lots = [Lot("us", "AAA", "2026-01-01", 10, 100.0),
            Lot("us", "BBB", "2026-01-01", 5, 200.0)]
    quotes = {"AAA": _q("AAA", 120), "BBB": _q("BBB", 210)}
    by = engine.value_by_currency(lots, quotes, accts)
    assert by == {"USD": 10 * 120 + 5 * 210}


def test_never_cross_sums_currencies():
    accts = [_acct("us"), _acct("in", ccy="INR", juris="IN")]
    lots = [Lot("us", "AAA", "2026-01-01", 10, 100.0),
            Lot("in", "RELIANCE.NS", "2026-01-01", 20, 1000.0)]
    quotes = {"AAA": _q("AAA", 120), "RELIANCE.NS": _q("RELIANCE.NS", 1500, "INR")}
    by = engine.value_by_currency(lots, quotes, accts)
    assert by == {"USD": 1200.0, "INR": 30000.0}  # separate, never added


def test_position_weight_is_own_currency_relative():
    accts = [_acct("us"), _acct("in", ccy="INR", juris="IN")]
    lots = [Lot("us", "AAA", "2026-01-01", 10, 100.0),   # $1200
            Lot("in", "RIL.NS", "2026-01-01", 20, 1000.0)]  # ₹30000
    quotes = {"AAA": _q("AAA", 120), "RIL.NS": _q("RIL.NS", 1500, "INR")}
    pos = engine.positions(lots, quotes, "all", accounts=accts)
    by_sym = {p.symbol: p for p in pos}
    # each is 100% of ITS currency's scope (only holding in that currency)
    assert by_sym["AAA"].weight == 100.0 and by_sym["AAA"].currency == "USD"
    assert by_sym["RIL.NS"].weight == 100.0 and by_sym["RIL.NS"].currency == "INR"


def test_allocation_by_class_is_usd_only_plus_currency_map():
    accts = [_acct("us"), _acct("in", ccy="INR", juris="IN")]
    lots = [Lot("us", "AAA", "2026-01-01", 10, 100.0),
            Lot("in", "RIL.NS", "2026-01-01", 20, 1000.0)]
    quotes = {"AAA": _q("AAA", 120), "RIL.NS": _q("RIL.NS", 1500, "INR")}
    alloc = engine.allocation(lots, quotes, "all", accounts=accts)
    assert alloc.total == 1200.0                    # USD only — never mixed
    assert alloc.by_currency == {"USD": 1200.0, "INR": 30000.0}


def test_tlh_gated_for_non_us_account():
    import datetime as dt
    accts = [_acct("in", ccy="INR", juris="IN")]
    lots = [Lot("in", "RIL.NS", "2026-01-01", 20, 2000.0)]  # loss at 1500
    quotes = {"RIL.NS": _q("RIL.NS", 1500, "INR")}
    cands = engine.tlh_candidates(lots, quotes, accounts=accts, recent_buys=[],
                                  auto_buys=[], partner_map={}, today=dt.datetime(2026, 7, 12))
    assert len(cands) == 1 and cands[0].status == "na"  # no US TLH on IN account


def test_wash_status_na_for_non_us_holding():
    import datetime as dt
    accts = [_acct("in", ccy="INR", juris="IN")]
    lots = [Lot("in", "RIL.NS", "2026-01-01", 20, 2000.0)]
    ws = engine.wash_status("RIL.NS", accounts=accts, recent_buys=[], auto_buys=[],
                            today=dt.datetime(2026, 7, 12), lots=lots)
    assert ws.blocked is False and "non-US" in (ws.reason or "")
