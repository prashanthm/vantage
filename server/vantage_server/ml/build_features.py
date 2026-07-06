"""Feature + condition-bucket build CLI — fetch/persist around the pure engines.

Reconstructs labeled round-trips (like build_roundtrips), computes ENTRY-CONDITION
features (features.py) with per-trip no-leakage bar slicing, groups them into
Bayesian CONDITION BUCKETS with credible intervals (buckets.py), flags the
statistically-defensible NOTABLE buckets, and writes it all to
<data_dir>/ml/trade_stats.json:

    {"as_of", "account", "baseline_win_rate", "featured": [...],
     "buckets": [...], "notable": [...]}

THE KNOWN-GAP FIX. Closed round-trips reference underlyings that have no
bars/<UND>.json (bars files exist only for currently-held tickers). Without
bars, no entry-time features compute. Before featurizing, this CLI ENSURES bars
exist for every round-trip underlying: it fetches (READ-ONLY, deep backfill via
bars.backfill_bars) any missing symbol and writes bars/<UND>.json — the same
read-only broker fetch snapshot_bars uses. So entry features compute for closed
trades, not just held ones.

Like build_roundtrips/snapshot_bars, this is OUTSIDE the read-only service
surface: only this operator-run command writes. The write MERGES by account and
BACKS UP the previous trade_stats.json first.

    python -m vantage_server.ml.build_features --account rh-margin --broker-account <N>
    # skip the broker fetch entirely (reuse the already-built roundtrips.json):
    python -m vantage_server.ml.build_features --account rh-margin --from-roundtrips
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path

from . import buckets as buckets_engine
from . import fetch_earnings as earnings_engine
from . import features as features_engine
from . import roundtrips as engine
from . import sentiment as sentiment_engine
from . import sentiment_eval as sentiment_eval_engine
from .. import bars as bars_engine
from ..bars_view import BarsNotFound, load_bars_file
from ..brokers import CONNECTIONS, BrokerConnectionError, get_connection
from ..snapshot_bars import _underlying as _chartable_underlying, write_bars

# Cash-settled index roots have no fetchable equity historical instrument at the
# broker — their options trade (SPXW etc.) but there's no chart to backfill.
# Skip them silently up front instead of failing a backfill every run.
_NO_HISTORY_SYMBOLS = frozenset({"SPX", "SPXW", "NDX", "NDXP", "RUT", "VIX", "XSP"})
from ..store import Store, StoreError, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2


class BuildError(ValueError):
    """A build precondition failed (unknown account/broker, no history)."""


def trade_stats_path(data_dir: str | Path) -> Path:
    return Path(data_dir) / "ml" / "trade_stats.json"


# --------------------------------------------------- display-symbol resolver

def _round2(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def build_display_symbol_resolver(orders: list[dict]):
    """A ``(rt_dict) -> option display symbol | None`` resolver from raw orders.

    The persisted round-trip carries only the UNDERLYING; the strike/expiry/right
    for DTE + moneyness live in the opening ORDER's display symbol. Robinhood
    order rows here carry no order_id, so we key each filled option BUY by
    (underlying, open date, per-contract entry price = price×100) — verified to
    UNIQUELY identify the contract across this account's history. A round-trip
    resolves to the display symbol whose key matches its (symbol, open_date,
    entry_price). Returns None for equities or an unmatched option."""
    index: dict[tuple, str] = {}
    for o in orders:
        if str(o.get("kind") or "") != "option":
            continue
        if str(o.get("side") or "").lower() != "buy":
            continue
        if str(o.get("state") or "").lower() != "filled":
            continue
        sym = str(o.get("symbol") or "")
        und = engine._underlying(sym)
        date = str(o.get("date") or "")[:10]
        per_contract = _round2(o.get("price"))
        per_contract = round(per_contract * engine._MULTIPLIER, 2) if per_contract is not None else None
        index.setdefault((und, date, per_contract), sym)

    def resolve(rt: dict) -> str | None:
        if str(rt.get("kind") or "") != "option":
            return None
        key = (
            str(rt.get("symbol") or "").upper(),
            str(rt.get("open_date") or "")[:10],
            _round2(rt.get("entry_price")),
        )
        return index.get(key)

    return resolve


# --------------------------------------------------------- bars gap fix

def ensure_bars(
    data_dir: str | Path, underlyings: set[str], *, fetch, as_of: str,
    dry_run: bool = False,
) -> tuple[list[str], list[str]]:
    """Ensure a bars/<UND>.json exists for every chartable underlying.

    For each underlying with NO bars file, deep-backfill it (READ-ONLY, the same
    broker fetch snapshot_bars --backfill uses) and write bars/<UND>.json marked
    backfilled. Symbols that already have a file are left untouched. Non-chartable
    sleeve symbols (CASH/CRYPTO/FUTURES) and blanks are skipped. Returns
    (fetched, skipped) symbol lists. On dry-run, reports what WOULD be fetched
    and writes nothing."""
    have: list[str] = []
    missing: list[str] = []
    for sym in sorted(underlyings):
        chartable = _chartable_underlying(sym)
        if chartable is None or chartable in _NO_HISTORY_SYMBOLS:
            continue
        try:
            load_bars_file(data_dir, chartable)
            have.append(chartable)
        except BarsNotFound:
            missing.append(chartable)

    fetched: list[str] = []
    for sym in missing:
        if dry_run:
            fetched.append(sym)
            continue
        try:
            snapshot = bars_engine.backfill_bars([sym], fetch=fetch)
        except BrokerConnectionError as e:
            print(f"warning: {sym}: backfill failed ({e}) — skipping", file=sys.stderr)
            continue
        series = snapshot.get(sym, {"daily": [], "weekly": [], "monthly": []})
        if not series["daily"]:
            print(f"warning: {sym}: no bars returned — skipping", file=sys.stderr)
            continue
        write_bars(data_dir, sym, series, as_of=as_of, lookback_days=0,
                   backfilled=True)
        fetched.append(sym)
    return fetched, sorted(set(have))


def _bars_bundle_for(data_dir: str | Path, underlyings: set[str]) -> dict[str, dict]:
    """{underlying: {"daily", "weekly", "monthly"}} for every underlying with a
    bars file. Missing/malformed files are simply absent (features for that
    symbol then degrade to None, never fabricated)."""
    out: dict[str, dict] = {}
    for sym in sorted(underlyings):
        chartable = _chartable_underlying(sym)
        if chartable is None:
            continue
        try:
            data = load_bars_file(data_dir, chartable)
        except BarsNotFound:
            continue
        out[chartable] = {
            "daily": data.get("daily") or [],
            "weekly": data.get("weekly") or [],
            "monthly": data.get("monthly") or [],
        }
    return out


# ------------------------------------------------------------- sentiment gate

def _golden_path() -> Path:
    """The bundled golden set (tests/fixtures/sentiment_golden.jsonl)."""
    return (Path(__file__).resolve().parents[2]
            / "tests" / "fixtures" / "sentiment_golden.jsonl")


def _choose_scorer(golden: list[dict]) -> tuple[object | None, dict | None]:
    """Pick the best scorer that CLEARS THE GATE, else None.

    Preference: OllamaScorer (if Ollama is reachable AND it passes the golden
    gate) > LexiconScorer (if IT passes) > None (sentiment skipped). Returns
    (scorer|None, eval_result|None). Never raises — an unreachable Ollama is
    caught and the lexicon is tried instead."""
    # 1) try Ollama, but only trust it if it clears the same gate
    try:
        ollama = sentiment_engine.OllamaScorer()
        ev = sentiment_eval_engine.evaluate_scorer(ollama, golden)
        if ev["passed"]:
            return ollama, ev
    except Exception:  # noqa: BLE001 — Ollama down / model missing: fall back
        pass
    # 2) deterministic lexicon fallback
    lex = sentiment_engine.LexiconScorer()
    ev = sentiment_eval_engine.evaluate_scorer(lex, golden)
    if ev["passed"]:
        return lex, ev
    return None, ev


def _add_sentiment(
    data_dir: str | Path, featured: list[dict], underlyings: set[str], *,
    as_of: str, source=None,
) -> dict:
    """Score headline sentiment per symbol and fold it into featured trips.

    Runs the gate first: a scorer's ``sentiment_band`` reaches the features ONLY
    when the scorer cleared the golden accuracy bar. Headlines come from a real
    zero-credential source (Yahoo RSS) by default, degrading to no headlines if
    unreachable; ``source`` can inject a FixtureHeadlineSource for tests.

    Returns a report dict {trusted, method, accuracy, passed, n_scored}. On
    every scored trip, features["sentiment_band"]/["sentiment_score"] are set
    (band None when there were no headlines) plus ["sentiment_estimated"]=True
    and ["sentiment_method"]. When no scorer passes the gate, nothing is added
    and trusted is False."""
    try:
        golden = sentiment_eval_engine.load_golden(_golden_path())
    except OSError:
        golden = []
    scorer, ev = _choose_scorer(golden)
    if scorer is None:
        print("sentiment: NO scorer cleared the gate "
              f"(best acc={ev['accuracy'] if ev else 'n/a'} "
              f"< {sentiment_eval_engine.GATE_MIN_ACCURACY}) — skipping sentiment")
        return {"trusted": False, "method": None,
                "accuracy": ev["accuracy"] if ev else None, "passed": False,
                "n_scored": 0}

    src = source or sentiment_engine.YahooRSSHeadlineSource()
    # score each underlying once, then map onto its trips
    band_by_symbol: dict[str, dict] = {}
    for sym in sorted(underlyings):
        if not sym:
            continue
        heads = src.headlines(sym, as_of)
        band_by_symbol[sym] = sentiment_engine.score_headlines(heads, scorer=scorer)

    n_scored = 0
    for f in featured:
        sym = str(f.get("symbol") or "").upper()
        agg = band_by_symbol.get(sym)
        feats = f.setdefault("features", {})
        feats["sentiment_estimated"] = True
        feats["sentiment_method"] = scorer.method
        if agg and agg["n_headlines"] > 0:
            feats["sentiment_band"] = agg["band"]
            feats["sentiment_score"] = agg["score"]
            n_scored += 1
        else:
            feats["sentiment_band"] = None
            feats["sentiment_score"] = None

    print(f"sentiment: {scorer.method} cleared gate "
          f"(acc={ev['accuracy']} >= {sentiment_eval_engine.GATE_MIN_ACCURACY}); "
          f"scored {n_scored} trip(s), flagged estimated=true")
    return {"trusted": True, "method": scorer.method, "accuracy": ev["accuracy"],
            "passed": True, "n_scored": n_scored}


# ------------------------------------------------------------- persist

def write_trade_stats(
    data_dir: str | Path, account: str, *, baseline_win_rate: float | None,
    featured: list[dict], buckets: list[dict], notable: list[dict], as_of: str,
    now: _dt.datetime | None = None,
) -> tuple[Path, Path | None]:
    """Write ml/trade_stats.json, MERGING by account and backing up first.

    THIS account's featured trips/buckets/notable are replaced; every other
    account's are kept (each featured row is tagged with ``account``; buckets and
    notable are stored per-account under ``by_account``). The previous file is
    ALWAYS backed up (trade_stats.json.bak-<ISO>). Returns (path, backup | None).

    File shape (top-level = the built account for convenience; ``by_account``
    holds every account's blocks so a multi-account file stays whole):
        {as_of, account, baseline_win_rate, featured, buckets, notable,
         by_account: {<acct>: {baseline_win_rate, featured, buckets, notable}}}"""
    now = now or _dt.datetime.now()

    store = Store(data_dir)
    if store.uses_sqlite:
        store.put_trade_stats(
            account, baseline_win_rate=baseline_win_rate, featured=featured,
            buckets=buckets, notable=notable, as_of=as_of)
        return Path(data_dir) / "vantage.db", None

    ml_dir = Path(data_dir) / "ml"
    ml_dir.mkdir(parents=True, exist_ok=True)
    path = ml_dir / "trade_stats.json"

    by_account: dict[str, dict] = {}
    backup: Path | None = None
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("by_account"), dict):
                by_account = {k: v for k, v in data["by_account"].items()
                              if isinstance(v, dict)}
        except (json.JSONDecodeError, OSError):
            by_account = {}
        stamp = now.isoformat(timespec="seconds").replace(":", "-")
        backup = path.with_name(f"trade_stats.json.bak-{stamp}")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")

    tagged_featured = [{**f, "account": account} for f in featured]
    by_account[account] = {
        "baseline_win_rate": baseline_win_rate,
        "featured": tagged_featured,
        "buckets": buckets,
        "notable": notable,
    }

    payload = {
        "as_of": as_of,
        "account": account,
        "baseline_win_rate": baseline_win_rate,
        "featured": tagged_featured,
        "buckets": buckets,
        "notable": notable,
        "by_account": by_account,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path, backup


# ------------------------------------------------------------- CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.ml.build_features",
        description="Build entry-condition features + Bayesian condition buckets "
                    "from labeled round-trips (read-only fetch, operator-side write).",
    )
    p.add_argument("--account", required=True,
                   help="Vantage account id to build stats for (e.g. rh-margin)")
    p.add_argument("--broker", default="robinhood",
                   help=f"broker connection ({', '.join(sorted(CONNECTIONS)) or 'none'})")
    p.add_argument("--broker-account", dest="broker_account", metavar="N",
                   help="broker-side account number for the realized-P/L fetch "
                        "(required unless --from-roundtrips)")
    p.add_argument("--from-roundtrips", action="store_true",
                   help="reuse the already-built ml/roundtrips.json instead of "
                        "re-fetching realized-P/L history from the broker (still "
                        "needs the broker for missing-bars backfill unless "
                        "--no-backfill)")
    p.add_argument("--no-backfill", action="store_true",
                   help="do NOT fetch bars for underlyings that lack a bars file "
                        "(features for those symbols degrade to null)")
    p.add_argument("--no-earnings", action="store_true",
                   help="do NOT fetch/use earnings dates (earnings features "
                        "degrade to null). Earnings are ON by default — "
                        "deterministic and free.")
    p.add_argument("--refresh-earnings", action="store_true",
                   help="re-fetch earnings even when a cache file exists")
    p.add_argument("--with-sentiment", action="store_true",
                   help="ALSO build headline sentiment (OFF by default). Uses "
                        "Ollama when up AND it clears the accuracy gate, else the "
                        "deterministic lexicon if IT clears the gate, else skips "
                        "sentiment entirely. Never blocks the build. Sentiment "
                        "features are always flagged estimated=true.")
    p.add_argument("--account-value", type=float, dest="account_value",
                   help="account value for the size tertile feature (optional)")
    p.add_argument("--limit", type=int, default=500,
                   help="max realized-P/L close rows to fetch (default 500)")
    p.add_argument("--min-n", type=int, default=3,
                   help="minimum trips for a bucket to be statistically notable "
                        "(default 3)")
    p.add_argument("--as-of", help="ISO date to stamp the build (default: today)")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--dry-run", action="store_true",
                   help="build and print the summary, write nothing")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        return _run(args)
    except (BuildError, StoreError) as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_USER_ERROR


def _load_roundtrip_rows(store: Store, account: str) -> list[dict]:
    data = store.load_roundtrips()
    rows = [r for r in data["roundtrips"] if r.get("account") == account]
    if not rows:
        raise BuildError(
            f"no round-trips for account '{account}' in ml/roundtrips.json — "
            "build them first (build_roundtrips) or drop --from-roundtrips")
    return rows


def _run(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args.data_dir)
    as_of = args.as_of or _dt.date.today().isoformat()

    if args.broker not in CONNECTIONS:
        raise BuildError(
            f"unknown broker {args.broker!r} (have: "
            f"{', '.join(sorted(CONNECTIONS)) or 'none'})")

    store = Store(data_dir)
    all_history = store.load_history()
    orders = [r for r in all_history if r.get("account") == args.account]

    # --- obtain round-trips (as dicts) ---------------------------------
    if args.from_roundtrips:
        rt_rows = _load_roundtrip_rows(store, args.account)
    else:
        if not args.broker_account:
            raise BuildError(
                "--broker-account is required (or pass --from-roundtrips to reuse "
                "the already-built ml/roundtrips.json)")
        if not orders:
            raise BuildError(
                f"no order history for account '{args.account}' in "
                f"{data_dir / 'history.json'} — import it first")
        conn = get_connection(args.broker)()
        fetch_pnl = getattr(conn, "fetch_pnl_trade_history", None)
        if fetch_pnl is None:
            raise BuildError(
                f"{args.broker}: connection has no realized-P/L history capability")
        try:
            pnl_history = fetch_pnl(args.broker_account, limit=args.limit)
        except BrokerConnectionError as e:
            raise BuildError(f"{args.broker}: {e}") from e
        bars_by_symbol = None  # excursion not needed for features; skip here
        trips = engine.reconstruct(orders, pnl_history, bars_by_symbol=bars_by_symbol)
        from dataclasses import asdict
        rt_rows = [{**asdict(t), "account": args.account} for t in trips]

    # --- ensure bars for every underlying (the known-gap fix) ----------
    underlyings = {str(r.get("symbol") or "").upper() for r in rt_rows}
    underlyings.discard("")
    fetch_hist = None
    if not args.no_backfill:
        conn = get_connection(args.broker)()
        fetch_hist = getattr(conn, "fetch_historicals", None)
        if fetch_hist is None:
            print(f"warning: {args.broker}: no historicals capability — "
                  "cannot backfill missing bars", file=sys.stderr)
    if fetch_hist is not None:
        fetched, have = ensure_bars(
            data_dir, underlyings, fetch=fetch_hist, as_of=as_of,
            dry_run=args.dry_run)
        if fetched:
            print(f"backfilled bars for {len(fetched)} underlying(s): "
                  f"{', '.join(fetched)}")
    else:
        have = sorted(u for u in underlyings
                      if _chartable_underlying(u) is not None)

    # --- earnings dates (deterministic, free — ON by default) ----------
    # Earnings fetch is INDEPENDENT of --no-backfill (that flag only governs the
    # bars backfill): earnings are the primary event feature and are fetched
    # unless --no-earnings or --dry-run. A missing broker capability or a fetch
    # error degrades to cached/empty — never blocks the build.
    earnings_by_symbol: dict[str, list[str]] = {}
    if not args.no_earnings:
        fetch_earn = None
        if not args.dry_run:
            conn = get_connection(args.broker)()
            fetch_earn = getattr(conn, "fetch_earnings", None)
            if fetch_earn is None:
                print(f"warning: {args.broker}: no earnings capability — "
                      "using cached earnings only", file=sys.stderr)
        earnings_by_symbol = earnings_engine.load_earnings_by_symbol(
            data_dir, underlyings, fetch=fetch_earn, as_of=as_of,
            refresh=args.refresh_earnings)
        n_with = sum(1 for v in earnings_by_symbol.values() if v)
        print(f"earnings dates for {n_with}/{len(earnings_by_symbol)} underlying(s)")

    # --- features (no-leakage slicing) ---------------------------------
    bundle = _bars_bundle_for(data_dir, underlyings)
    resolver = build_display_symbol_resolver(orders)
    featured = features_engine.features_for_all(
        rt_rows,
        bars_by_symbol=bundle,
        display_symbol_by_trip=resolver,
        earnings_by_symbol=earnings_by_symbol or None,
        account_value=args.account_value,
    )

    # --- sentiment (OPTIONAL, eval-gated — OFF by default) -------------
    dimensions = buckets_engine.DEFAULT_DIMENSIONS
    sentiment_info: dict | None = None
    if args.with_sentiment:
        sentiment_info = _add_sentiment(
            data_dir, featured, underlyings, as_of=as_of)
        if sentiment_info.get("trusted"):
            dimensions = dimensions + buckets_engine.SENTIMENT_DIMENSIONS

    # --- buckets + notable ---------------------------------------------
    baseline = buckets_engine.baseline_win_rate(featured)
    buckets = buckets_engine.condition_buckets(featured, dimensions=dimensions)
    notable = buckets_engine.notable_buckets(
        buckets, baseline=baseline, min_n=args.min_n)

    with_bars = sum(1 for f in featured
                    if (f["features"].get("daily_trend") is not None))
    print(f"featurized {len(featured)} round-trip(s) for {args.account} "
          f"({with_bars} with entry-time bars)")
    print(f"  baseline_win_rate={baseline}  buckets={len(buckets)}  "
          f"notable={len(notable)} (min_n={args.min_n})")
    for nb in notable:
        tag = "" if nb.get("significant") else "  [n<min, not significant]"
        print(f"  {nb['kind'].upper():4s} {nb['dimension']}={nb['value']}: "
              f"n={nb['n']} win_rate={nb['win_rate']} "
              f"CI[{nb['ci_low']:.2f},{nb['ci_high']:.2f}] "
              f"edge={nb['edge']:+.3f}{tag}")

    if args.dry_run:
        print(f"[dry-run] would write {trade_stats_path(data_dir)}; nothing written")
        return EXIT_OK

    path, backup = write_trade_stats(
        data_dir, args.account, baseline_win_rate=baseline,
        featured=featured, buckets=buckets, notable=notable, as_of=as_of)
    print(f"wrote {path}"
          + (f" (backup: {backup})" if backup else " (no previous file to back up)"))
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
