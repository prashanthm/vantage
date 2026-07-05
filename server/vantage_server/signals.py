"""Signals — deterministic, compute-on-read grading of trade signals.

The seed file <data_dir>/signals.json carries only the AUTHORED facts of each
signal (symbol, pattern, entry/target/stop, confidence, creation time). Status
is NEVER authored: it is computed here, on read, from the current quote
snapshot — so a signal's fate always reflects the same prices every other
number in the product reflects.

Direction is implied by geometry: target > entry is a long signal, target <
entry is a short. Grading rules (pure function `grade_signal`, deterministic):

  status, with quote price q:
    hit_target   (target > entry and q >= target) or (target < entry and q <= target)
    stopped      (stop  < entry and q <= stop)   or (stop  > entry and q >= stop)
    open         otherwise
    unquoted     no quote for the symbol — pnl_pct and progress_grade are None

  pnl_pct — signed by direction so positive always means favorable:
    long   (q - entry) / entry * 100
    short  (entry - q) / entry * 100

  progress_grade — how much of the entry→target move is captured
  (progress = (q - entry) / (target - entry)) versus how far toward the stop
  the price has slipped (adverse = (q - entry) / (stop - entry)):
    A   progress >= 0.75          (three quarters of the move captured or better)
    B   progress >= 0.50
    C   progress >= 0             (>= 25% of the move, or merely flat-positive)
    D   progress <  0 and adverse < 0.5   (negative but above halfway-to-stop)
    F   adverse >= 0.5            (at/below halfway-to-stop; includes stopped)

  The bands are ordered checks, so a hit-target signal grades A (progress >=
  1) and a stopped signal grades F (adverse >= 1) by construction.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .models import Quote
from .store import StoreError, resolve_data_dir

SIGNALS_FILENAME = "signals.json"

_NUM = (int, float)


@dataclass(frozen=True)
class Signal:
    """An authored signal: facts only — no status field exists on purpose."""
    id: int
    sym: str
    pattern: str
    entry: float
    target: float
    stop: float
    move_pct: float | None = None
    conf: float | None = None
    created_at: str = ""

    @property
    def direction(self) -> str:
        return "long" if self.target > self.entry else "short"


@dataclass(frozen=True)
class GradedSignal:
    """A signal plus everything computed from the current quote."""
    signal: Signal
    direction: str
    status: str                 # open | hit_target | stopped | unquoted
    price: float | None         # the quote the grade was computed from
    pnl_pct: float | None       # signed by direction: positive == favorable
    progress_grade: str | None  # A..F (None when unquoted)


# ------------------------------------------------------------------ loading

def load_signals(data_dir: str | os.PathLike[str] | None = None) -> tuple[Signal, ...]:
    """Load <data_dir>/signals.json. The file is OPTIONAL (older data dirs
    predate signals): absent file -> empty tuple; malformed file -> StoreError."""
    path = Path(resolve_data_dir(data_dir)) / SIGNALS_FILENAME
    if not path.is_file():
        return ()
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise StoreError(f"{path}: invalid JSON ({e})") from e
    if not isinstance(rows, list):
        raise StoreError(f"{path}: top level must be a JSON array")
    out: list[Signal] = []
    for r in rows:
        if not isinstance(r, dict):
            raise StoreError(f"{path}: every signal must be an object, got {r!r}")
        if "status" in r:
            raise StoreError(
                f"{path}: signal {r.get('id')!r} carries an authored 'status' — "
                "status is computed from quotes, never authored"
            )
        for key, kind in (("id", int), ("sym", str), ("pattern", str),
                          ("entry", _NUM), ("target", _NUM), ("stop", _NUM)):
            if key not in r or not isinstance(r[key], kind):
                raise StoreError(f"{path}: signal needs {key} ({kind}) in {r!r}")
        entry, target, stop = float(r["entry"]), float(r["target"]), float(r["stop"])
        if target == entry or stop == entry:
            raise StoreError(f"{path}: signal {r['id']} needs target != entry and stop != entry")
        out.append(Signal(
            id=r["id"],
            sym=str(r["sym"]).upper(),
            pattern=r["pattern"],
            entry=entry,
            target=target,
            stop=stop,
            move_pct=float(r["move_pct"]) if isinstance(r.get("move_pct"), _NUM) else None,
            conf=float(r["conf"]) if isinstance(r.get("conf"), _NUM) else None,
            created_at=str(r.get("time", "")),
        ))
    return tuple(out)


# ------------------------------------------------------------------ grading

def grade_signal(signal: Signal, quotes: dict[str, Quote]) -> GradedSignal:
    """Pure grading of one signal against a quote table (rules in module doc)."""
    direction = signal.direction
    quote = quotes.get(signal.sym)
    if quote is None:
        return GradedSignal(signal=signal, direction=direction, status="unquoted",
                            price=None, pnl_pct=None, progress_grade=None)
    q = quote.price
    entry, target, stop = signal.entry, signal.target, signal.stop

    if (target > entry and q >= target) or (target < entry and q <= target):
        status = "hit_target"
    elif (stop < entry and q <= stop) or (stop > entry and q >= stop):
        status = "stopped"
    else:
        status = "open"

    pnl_pct = ((q - entry) if direction == "long" else (entry - q)) / entry * 100

    progress = (q - entry) / (target - entry)   # fraction of the move captured
    adverse = (q - entry) / (stop - entry)      # fraction of the way to the stop
    if progress >= 0.75:
        grade = "A"
    elif progress >= 0.5:
        grade = "B"
    elif progress >= 0:
        grade = "C"
    elif adverse < 0.5:
        grade = "D"
    else:
        grade = "F"

    return GradedSignal(signal=signal, direction=direction, status=status,
                        price=q, pnl_pct=round(pnl_pct, 4), progress_grade=grade)


def grade_signals(signals: tuple[Signal, ...] | list[Signal],
                  quotes: dict[str, Quote]) -> list[GradedSignal]:
    """Grade every signal, preserving seed order. Pure — no I/O."""
    return [grade_signal(s, quotes) for s in signals]
