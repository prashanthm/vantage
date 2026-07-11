"""The tradeable underlyings the 0DTE playbook covers, and their per-symbol
knobs. One registry so the playbook, journal, and paper agree on what "QQQ" means
— which bars to fetch, which option chain feeds GEX, which proxy carries the
retail trade, and the price-scale constants that make zones cluster sensibly at
each instrument's price magnitude.

Index families (why futures ride the ETF playbook):
  SPX / SPY / ES   — S&P 500
  QQQ / NDX / NQ   — Nasdaq-100   (NQ future ≈ QQQ, no usable own chain)
  IWM / RUT / RTY  — Russell 2000 (RTY future ≈ IWM)

SPX keeps its historical quirk: price from the ^GSPC index (no volume), volume
from SPY, GEX from the ^SPX chain (SPY-proxy fallback), retail proxy SPY. The
ETFs are self-contained: their own bars carry volume, their own chain feeds GEX,
and they ARE their own retail proxy (ratio 1).
"""
from __future__ import annotations

#: canonical key -> per-underlying config.
#:  bar_symbol   : yfinance symbol for price bars (the playbook's price axis)
#:  gex_symbol   : yfinance symbol whose option chain feeds GEX
#:  proxy_symbol : what retail actually trades (SPY for SPX; the ETF itself else)
#:  self_proxy   : True when the underlying IS its own proxy (ratio 1, ETF)
#:  round_step   : psychological round-number spacing near spot (price scale)
#:  cluster_tol  : absolute pivot-cluster tolerance in the underlying's points
#:  label        : display label in setup/caveat text
UNDERLYINGS: dict[str, dict] = {
    "SPX": {"bar_symbol": "^GSPC", "gex_symbol": "^SPX", "proxy_symbol": "SPY",
            "self_proxy": False, "round_step": 50, "cluster_tol": 6.0, "label": "SPX"},
    "QQQ": {"bar_symbol": "QQQ", "gex_symbol": "QQQ", "proxy_symbol": "QQQ",
            "self_proxy": True, "round_step": 5, "cluster_tol": 0.6, "label": "QQQ"},
    "IWM": {"bar_symbol": "IWM", "gex_symbol": "IWM", "proxy_symbol": "IWM",
            "self_proxy": True, "round_step": 1, "cluster_tol": 0.25, "label": "IWM"},
}

#: the order the nightly + UI iterate underlyings (SPX first — the default view).
UNDERLYING_KEYS = ["SPX", "QQQ", "IWM"]


def get(underlying: str | None) -> dict:
    """Config for an underlying key (case-insensitive), defaulting to SPX. Unknown
    keys fall back to SPX so a bad param can never crash the pipeline."""
    return UNDERLYINGS.get((underlying or "SPX").upper(), UNDERLYINGS["SPX"])
