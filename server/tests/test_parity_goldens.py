"""PARITY GOLDENS — expected values hand-traced from src/util.jsx over src/data.js.

The fixture dataset in server/data/ mirrors src/data.js exactly, so the engine
must reproduce the same numbers the SPA renders. Every expected value below is
derived by hand from the mock dataset; the derivation is shown next to each
assertion.

Prices (src/data.js MARKET): VOO 683.20, SPY 744.78, VTI 330.45, QQQ 625.40,
SCHG 32.05, IWM 297.58, NVDA 194.83, AAPL 308.63, TSLA 393.45, BND 74.20,
VXUS 71.50, CASH 1. Frozen TODAY = 2026-07-05T09:30-04:00.
"""
from __future__ import annotations

import pytest

from vantage_server import engine

approx = pytest.approx


# ------------------------------------------------------- account values
# fid-taxable:  VOO 40*683.20=27,328.00 + VOO 12*683.20=8,198.40
#             + NVDA 60*194.83=11,689.80 + IWM 45*297.58=13,391.10
#             + AAPL 25*308.63=7,715.75 + BND 120*74.20=8,904.00 + CASH 6,400
#             = 83,627.05
# schwab-roth:  QQQ 30*625.40=18,762.00 + SPY 18*744.78=13,406.04
#             + VXUS 150*71.50=10,725.00 + CASH 1,200 = 44,093.04
# vg-401k:      VTI 180*330.45=59,481.00 + SCHG 210*32.05=6,730.50
#             + BND 300*74.20=22,260.00 = 88,471.50
# wf-robo:      VOO 8.4*683.20=5,738.88 + VTI 22*330.45=7,269.90
#             + TSLA 6*393.45=2,360.70 + CASH 2,900 = 18,269.48
# consolidated: 83,627.05 + 44,093.04 + 88,471.50 + 18,269.48 = 234,461.07

ACCOUNT_VALUES = {
    "fid-taxable": 83_627.05,
    "schwab-roth": 44_093.04,
    "vg-401k": 88_471.50,
    "wf-robo": 18_269.48,
}
CONSOLIDATED_TOTAL = 234_461.07


def test_account_values(dataset, quotes):
    for acct_id, expected in ACCOUNT_VALUES.items():
        assert engine.account_value(dataset.lots, quotes, acct_id) == approx(expected)


def test_consolidated_total(dataset, quotes):
    pos = engine.positions(dataset.lots, quotes, "all")
    assert sum(p.value for p in pos) == approx(CONSOLIDATED_TOTAL)
    assert sum(ACCOUNT_VALUES.values()) == approx(CONSOLIDATED_TOTAL)


def test_per_account_positions_totals(dataset, quotes):
    for acct_id, expected in ACCOUNT_VALUES.items():
        pos = engine.positions(dataset.lots, quotes, acct_id)
        assert sum(p.value for p in pos) == approx(expected)


# --------------------------------------------------- consolidated positions
# VOO consolidated: shares 40+12+8.4=60.4
#   value 27,328.00+8,198.40+5,738.88 = 41,265.28
#   cost  40*640=25,600 + 12*705.50=8,466 + 8.4*668.30=5,613.72 = 39,679.72
#   unrl  41,265.28-39,679.72 = 1,585.56;  weight 41,265.28/234,461.07 = 17.6001%
# VTI consolidated: 180+22=202 sh; value 59,481.00+7,269.90=66,750.90;
#   cost 54,450.00+6,949.80=61,399.80; unrl +5,351.10 (largest position)
# NVDA: value 11,689.80; cost 60*121.40=7,284.00; unrl +4,405.80
#   (matches the SPA notification "NVDA ... $4,406 unrealized gain")
# Value ordering: VTI 66,750.90 > VOO 41,265.28 > BND 31,164.00 > QQQ 18,762.00
#   > SPY 13,406.04 > IWM 13,391.10 > NVDA 11,689.80 > VXUS 10,725.00
#   > CASH 10,500 > AAPL 7,715.75 > SCHG 6,730.50 > TSLA 2,360.70

def test_consolidated_position_order(dataset, quotes):
    pos = engine.positions(dataset.lots, quotes, "all")
    assert [p.symbol for p in pos] == [
        "VTI", "VOO", "BND", "QQQ", "SPY", "IWM",
        "NVDA", "VXUS", "CASH", "AAPL", "SCHG", "TSLA",
    ]


def test_voo_consolidated_golden(dataset, quotes):
    voo = next(p for p in engine.positions(dataset.lots, quotes, "all") if p.symbol == "VOO")
    assert voo.shares == approx(60.4)
    assert voo.value == approx(41_265.28)
    assert voo.cost == approx(39_679.72)
    assert voo.unrealized == approx(1_585.56)
    assert voo.weight == approx(17.6001, abs=1e-3)
    assert voo.overlap is not None and voo.overlap.symbols == ("VOO", "SPY", "VTI")


def test_vti_and_nvda_goldens(dataset, quotes):
    pos = {p.symbol: p for p in engine.positions(dataset.lots, quotes, "all")}
    assert pos["VTI"].value == approx(66_750.90)
    assert pos["VTI"].unrealized == approx(5_351.10)
    assert pos["NVDA"].unrealized == approx(4_405.80)
    # BND consolidated: 420 sh, value 31,164.00, cost 9,072+23,040=32,112 -> -948.00
    assert pos["BND"].unrealized == approx(-948.00)


# ----------------------------------------------------------- wash goldens
# RECENT_BUYS: VOO Jul 1 (Robo), QQQ Jun 18 (Roth), VTI Jun 30 (401(k)) —
# all within 30 days of the frozen Jul 5 TODAY.
# Blocked:  VOO (bought Jul 1; clears Jul 1+31d = Aug 1)
#           SPY (family sibling of VOO — S&P 500 family)
#           QQQ (bought Jun 18; clears Jun 18+31d = Jul 19)
#           VTI (bought Jun 30; clears Jun 30+31d = Jul 31)
# Wash-safe: IWM, TSLA, NVDA, AAPL, BND, SCHG, VXUS (no family buys, no
#           day-of-month auto-buys).

def test_wash_blocked_symbol(dataset, today):
    ws = engine.wash_status("VOO", accounts=dataset.accounts,
                            recent_buys=dataset.recent_buys,
                            auto_buys=dataset.auto_buys, today=today)
    assert ws.blocked
    assert ws.clears_on_date == "2026-08-01" and ws.clears_on == "Aug 1"
    ws_spy = engine.wash_status("SPY", accounts=dataset.accounts,
                                recent_buys=dataset.recent_buys,
                                auto_buys=dataset.auto_buys, today=today)
    assert ws_spy.blocked  # cross-symbol via the S&P 500 family
    ws_vti = engine.wash_status("VTI", accounts=dataset.accounts,
                                recent_buys=dataset.recent_buys,
                                auto_buys=dataset.auto_buys, today=today)
    assert ws_vti.blocked and ws_vti.clears_on_date == "2026-07-31"


def test_wash_safe_symbol(dataset, today):
    for sym in ("IWM", "TSLA"):
        ws = engine.wash_status(sym, accounts=dataset.accounts,
                                recent_buys=dataset.recent_buys,
                                auto_buys=dataset.auto_buys, today=today)
        assert not ws.blocked


# ------------------------------------------------------------ TLH goldens
# Loss lots (all others have gains and are skipped; CASH skipped):
#   IWM  fid  45 sh @331.20 -> 13,391.10-14,904.00 = -1,512.90  (-10.1510%)
#   BND  401k 300 @76.80    -> 22,260.00-23,040.00 =   -780.00  (-3.3854%)
#   TSLA robo 6 @441.70     ->  2,360.70- 2,650.20 =   -289.50  (-10.9237%)
#   VOO  fid  12 @705.50    ->  8,198.40- 8,466.00 =   -267.60  (-3.1609%)
#   BND  fid  120 @75.60    ->  8,904.00- 9,072.00 =   -168.00  (-1.8519%)
# At default thresholds ($200 OR 3%):
#   IWM  -> past threshold, wash-safe        -> clear,   replacement IJR
#   BND-401k -> loss in 401(k), not taxable  -> na
#   TSLA -> past threshold, wash-safe        -> clear,   no partner (None)
#   VOO  -> past threshold, VOO wash-blocked -> blocked, replacement VTI
#   BND-fid -> 168 < 200 and 1.85% < 3%      -> below
# Sorted by unrealized ascending (deepest loss first).

def test_tlh_candidate_set_at_default_thresholds(dataset, quotes, today):
    cands = engine.tlh_candidates(
        dataset.lots, quotes,
        accounts=dataset.accounts, recent_buys=dataset.recent_buys,
        auto_buys=dataset.auto_buys, partner_map=dataset.partner_map,
        today=today,
    )
    rows = [(c.lot.symbol, c.lot.account, c.status) for c in cands]
    assert rows == [
        ("IWM", "fid-taxable", "clear"),
        ("BND", "vg-401k", "na"),
        ("TSLA", "wf-robo", "clear"),
        ("VOO", "fid-taxable", "blocked"),
        ("BND", "fid-taxable", "below"),
    ]
    by_key = {(c.lot.symbol, c.lot.account): c for c in cands}
    iwm = by_key[("IWM", "fid-taxable")]
    assert iwm.unrealized == approx(-1_512.90)
    assert iwm.loss_pct == approx(10.1510, abs=1e-3)
    assert iwm.replacement == "IJR"
    tsla = by_key[("TSLA", "wf-robo")]
    assert tsla.unrealized == approx(-289.50)
    assert tsla.replacement is None
    voo = by_key[("VOO", "fid-taxable")]
    assert voo.unrealized == approx(-267.60)
    assert voo.replacement == "VTI"
    assert voo.wash is not None and voo.wash.clears_on_date == "2026-08-01"


# ----------------------------------------------------- allocation goldens
# usEquity  = VOO 41,265.28 + SPY 13,406.04 + VTI 66,750.90 + QQQ 18,762.00
#           + SCHG 6,730.50 + IWM 13,391.10 + NVDA 11,689.80 + AAPL 7,715.75
#           + TSLA 2,360.70 = 182,072.07              -> 77.6556%
# intlEquity = VXUS 10,725.00                          ->  4.5743%
# bonds      = BND 8,904.00 + 22,260.00 = 31,164.00    -> 13.2918%
# cash       = 6,400 + 1,200 + 2,900 = 10,500          ->  4.4784%

def test_consolidated_allocation_golden(dataset, quotes):
    alloc = engine.allocation(dataset.lots, quotes, "all")
    assert alloc.total == approx(CONSOLIDATED_TOTAL)
    assert alloc.by_class["usEquity"] == approx(182_072.07)
    assert alloc.by_class["intlEquity"] == approx(10_725.00)
    assert alloc.by_class["bonds"] == approx(31_164.00)
    assert alloc.by_class["cash"] == approx(10_500.00)
    pct = {k: v / alloc.total * 100 for k, v in alloc.by_class.items()}
    assert pct["usEquity"] == approx(77.6556, abs=1e-3)
    assert pct["intlEquity"] == approx(4.5743, abs=1e-3)
    assert pct["bonds"] == approx(13.2918, abs=1e-3)
    assert pct["cash"] == approx(4.4784, abs=1e-3)
