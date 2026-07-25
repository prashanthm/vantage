"""Strategy lifecycle stage machine (ADR-015): paper -> eligible -> live -> paused.

Ties the pieces together WITHOUT re-implementing any of them:
  * win-rate: reused from the paper track record (signal_bot.performance / paper).
  * baseline: computed from the frozen backtest cache with the strategy's own
    champion params (strategy.champion_params()).
  * promotion gate: paper win-rate beats the frozen baseline over a min sample.
  * gates 2/3/4 (caps, live-eligible, audit): enforced in brokers/alpaca_execution.

This module owns the STATE (persisted in strategy_lifecycle) and the TRANSITIONS
(measure -> eligible, operator promote -> live, cap/kill -> paused). It never
places an order itself — the autonomous driver (T2.7) calls submit_strategy_order
with the eligibility + caps this module resolves.

The gate is deliberately conservative: promotion is only ENABLED here; the actual
promote is an explicit operator action (promote()). Nothing auto-promotes.
"""
from __future__ import annotations

from .strategy import get_strategy

#: Minimum closed paper trades before a win-rate is trustworthy enough to gate on.
#: Below this the strategy stays 'paper' regardless of the rate (small-sample noise).
DEFAULT_MIN_SAMPLE = 20

STAGES = ("paper", "eligible", "live", "paused")


def paper_win_rate(store, strategy_id: str) -> tuple[float | None, int]:
    """The live-paper win-rate for a strategy + its sample size, from the paper
    track record. Two books, dispatched on the strategy's ``paper_book``:
      * scanner families → the scanner spread book's by-strategy stats
        (money-at-risk closes only — $0 no-fills never grade the gate);
      * reclaim (default) → signal_bot.performance (auto signals ARE the paper
        trades); reuse it rather than recompute. Returns (rate, n)."""
    try:
        if getattr(get_strategy(strategy_id), "paper_book", None) == "scanner":
            from . import paper
            s = (paper.build_spread_book(store).get("by_strategy") or {}) \
                .get(strategy_id) or {}
            return s.get("win_rate"), int(s.get("n") or 0)
        from . import signal_bot
        perf = signal_bot.performance(store)
        s = perf.get("summary", {})
        return s.get("paper_win_rate"), int(s.get("paper_closed") or 0)
    except Exception:  # noqa: BLE001 — no paper data yet → (None, 0), never crash
        return None, 0


def backtest_baseline(strategy_id: str, cache_path: str | None = None) -> float | None:
    """This strategy's frozen backtest baseline win-rate: run the harness on the
    frozen cache with the strategy's champion params, read overall win_rate. The
    'beat the backtest' bar the paper win-rate must clear. Returns None when the
    frozen cache isn't available (gate can't pass → stays paper, never fabricated).
    Scanner families carry their baseline as a FROZEN CONSTANT instead (the
    pre-registered backtest record, provenance in strategy.py docstrings)."""
    from pathlib import Path

    from . import backtest
    strat = get_strategy(strategy_id)
    frozen = getattr(strat, "frozen_baseline_win_rate", None)
    if frozen is not None:
        return frozen
    path = cache_path or str(Path(backtest.__file__).parent.parent
                             / "backtest_data" / "bars_frozen.json")
    if not Path(path).exists():
        return None
    try:
        bars = backtest.load_bars(path)
        result = backtest.run_backtest(bars, strat.champion_params())
        return result["metrics"]["overall"].get("win_rate")
    except Exception:  # noqa: BLE001 — a broken cache → no baseline, not a crash
        return None


def evaluate_gate(store, strategy_id: str, *, min_sample: int = DEFAULT_MIN_SAMPLE,
                  cache_path: str | None = None) -> dict:
    """Measure the promotion gate for a strategy (does NOT change stage — pure).
    Returns {paper_win_rate, paper_n, baseline_win_rate, min_sample, passes,
    reason}. `passes` is True only when the sample is big enough AND the paper
    win-rate meets/beats the frozen baseline."""
    rate, n = paper_win_rate(store, strategy_id)
    baseline = backtest_baseline(strategy_id, cache_path)
    passes = False
    if rate is None or n < min_sample:
        reason = f"insufficient sample ({n}/{min_sample} closed paper trades)"
    elif baseline is None:
        reason = "no frozen backtest baseline available (freeze the cache first)"
    elif rate < baseline:
        reason = f"paper win-rate {rate:.3f} below backtest baseline {baseline:.3f}"
    else:
        passes = True
        reason = f"paper {rate:.3f} ≥ baseline {baseline:.3f} over {n} trades"
    return {"paper_win_rate": rate, "paper_n": n, "baseline_win_rate": baseline,
            "min_sample": min_sample, "passes": passes, "reason": reason}


def refresh_stage(store, strategy_id: str, now_iso: str, *,
                  min_sample: int = DEFAULT_MIN_SAMPLE,
                  cache_path: str | None = None) -> dict:
    """Advance a NON-live strategy between paper<->eligible based on the gate, and
    persist the measured numbers. Never auto-promotes to live and never touches a
    live/paused strategy's stage (only promote()/pause() move those). Returns the
    (possibly updated) lifecycle row."""
    row = _row(store, strategy_id)
    stage = row["stage"]
    gate = evaluate_gate(store, strategy_id, min_sample=min_sample, cache_path=cache_path)

    fields = {"paper_win_rate": gate["paper_win_rate"], "paper_n": gate["paper_n"],
              "baseline_win_rate": gate["baseline_win_rate"], "updated_at": now_iso}
    if stage in ("paper", "eligible"):
        # gate result flips paper<->eligible; live/paused are left alone.
        fields["stage"] = "eligible" if gate["passes"] else "paper"
    store.upsert_lifecycle(strategy_id, **fields)
    return _row(store, strategy_id)


def promote(store, strategy_id: str, *, account: str, caps: dict, now_iso: str,
            min_sample: int = DEFAULT_MIN_SAMPLE, cache_path: str | None = None) -> dict:
    """Operator-initiated promotion to LIVE (ADR-015 gate 3). Refuses unless the
    strategy is currently ELIGIBLE (the gate passes) — passing the gate only
    ENABLES this; promotion is never automatic. Sets the live account + caps.
    Caps are validated (positive limits). Returns the live lifecycle row."""
    gate = evaluate_gate(store, strategy_id, min_sample=min_sample, cache_path=cache_path)
    if not gate["passes"]:
        raise ValueError(f"cannot promote '{strategy_id}' — gate not passed: {gate['reason']}")
    if not account:
        raise ValueError("a live account is required to promote")
    _validate_caps(caps)
    store.upsert_lifecycle(
        strategy_id, stage="live", live_account=account, caps=caps,
        baseline_win_rate=gate["baseline_win_rate"], paper_win_rate=gate["paper_win_rate"],
        paper_n=gate["paper_n"], promoted_at=now_iso, paused_reason=None, updated_at=now_iso)
    return _row(store, strategy_id)


def pause(store, strategy_id: str, reason: str, now_iso: str) -> dict:
    """Move a strategy to PAUSED (a cap breach, the kill switch, or the operator).
    A paused strategy stops opening exposure; resting protective stops remain at
    the broker. Reversible via resume()."""
    store.upsert_lifecycle(strategy_id, stage="paused", paused_reason=reason,
                           updated_at=now_iso)
    return _row(store, strategy_id)


def resume(store, strategy_id: str, now_iso: str) -> dict:
    """Un-pause a strategy back to LIVE (operator action — only a promoted
    strategy can be resumed; a never-promoted one has no live account)."""
    row = _row(store, strategy_id)
    if not row.get("live_account"):
        raise ValueError(f"'{strategy_id}' was never promoted — cannot resume to live")
    store.upsert_lifecycle(strategy_id, stage="live", paused_reason=None, updated_at=now_iso)
    return _row(store, strategy_id)


def is_live_eligible(store, strategy_id: str) -> bool:
    """True only when the strategy is currently in the LIVE stage — the flag the
    order path checks (gate 3). Paused/eligible/paper are all NOT live-eligible."""
    return _row(store, strategy_id)["stage"] == "live"


def caps_for(store, strategy_id: str) -> dict:
    """The strategy's persisted caps (empty dict if none / not live)."""
    return _row(store, strategy_id).get("caps") or {}


def _row(store, strategy_id: str) -> dict:
    """The lifecycle row, materializing a default 'paper' row for a known but
    not-yet-persisted strategy (so a fresh strategy reads as 'paper')."""
    get_strategy(strategy_id)   # validates the id
    rows = store.load_lifecycle(strategy_id)
    if rows:
        return rows[0]
    return {"strategy_id": strategy_id, "stage": "paper", "caps": {},
            "live_account": None, "paper_win_rate": None, "paper_n": 0,
            "baseline_win_rate": None, "promoted_at": None, "paused_reason": None}


def _validate_caps(caps: dict) -> None:
    """Caps must be positive when present (a zero/negative cap would either block
    everything or, worse, read as 'no cap' — refuse the ambiguity)."""
    for k in ("max_order_usd", "max_positions", "max_daily_loss_usd"):
        if k in caps and caps[k] is not None and float(caps[k]) <= 0:
            raise ValueError(f"cap '{k}' must be positive, got {caps[k]}")


def _demo() -> None:
    """assert-based self-check (run: python -m vantage_server.lifecycle). Uses an
    in-memory SQLite store; stubs the win-rate so no paper/backtest data is needed."""
    import tempfile
    from pathlib import Path

    from .store import Store, _SqliteBackend

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        store = Store(str(tmp))
        store._backend = _SqliteBackend(tmp, tmp / "vantage.db")   # schema auto-inits
        NOW = "2026-07-19T12:00:00"

        # a fresh strategy reads as 'paper' with no persisted row.
        assert _row(store, "reclaim")["stage"] == "paper"
        assert is_live_eligible(store, "reclaim") is False

        # stub the gate inputs (module globals evaluate_gate looks up at call time)
        # so no real paper/backtest data is needed for the state-machine check.
        g_orig = (globals()["paper_win_rate"], globals()["backtest_baseline"])
        globals()["paper_win_rate"] = lambda s, sid: (0.7, 40)          # rate, n
        globals()["backtest_baseline"] = lambda sid, cache_path=None: 0.6  # baseline

        g = evaluate_gate(store, "reclaim")
        assert g["passes"] and "≥ baseline" in g["reason"], g

        r = refresh_stage(store, "reclaim", NOW)
        assert r["stage"] == "eligible", r          # gate passes → eligible, NOT live

        # cannot submit live while merely eligible (gate 3 lives in the order path,
        # but is_live_eligible must be False until promoted).
        assert is_live_eligible(store, "reclaim") is False

        # operator promote → live, with caps.
        caps = {"max_order_usd": 5000, "max_positions": 3, "max_daily_loss_usd": 1000}
        r = promote(store, "reclaim", account="ALPACA-PAPER", caps=caps, now_iso=NOW)
        assert r["stage"] == "live" and r["live_account"] == "ALPACA-PAPER"
        assert is_live_eligible(store, "reclaim") is True
        assert caps_for(store, "reclaim")["max_order_usd"] == 5000

        # a failing gate must refuse promotion.
        globals()["backtest_baseline"] = lambda sid, cache_path=None: 0.9  # baseline > paper
        try:
            promote(store, "reclaim", account="X", caps=caps, now_iso=NOW)
            raise AssertionError("promoted despite failing gate")
        except ValueError:
            pass

        # pause (cap breach) → paused, then resume → live.
        pause(store, "reclaim", "max_daily_loss_usd breach", NOW)
        assert _row(store, "reclaim")["stage"] == "paused"
        assert is_live_eligible(store, "reclaim") is False   # paused ≠ live-eligible
        resume(store, "reclaim", NOW)
        assert _row(store, "reclaim")["stage"] == "live"

        # restore the real gate fns.
        globals()["paper_win_rate"], globals()["backtest_baseline"] = g_orig

        # audit log append + read back.
        store.append_audit({"at": NOW, "strategy_id": "reclaim", "mode": "dry_run",
                            "reason": "test", "order": {"symbol": "SPY"}, "gates": {}})
        trail = store.load_audit("reclaim")
        assert len(trail) == 1 and trail[0]["order"]["symbol"] == "SPY"

    print("ok — lifecycle stage-machine + gate self-check passed")


if __name__ == "__main__":
    _demo()
