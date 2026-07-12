"""Render the 0DTE SPX playbook scaffold as a TradingView Pine v5 indicator.

The playbook's levels (GEX walls/flip/max-pain, fib grid, volume PoC, S/R shelves,
round numbers) and its conditional setups are computed nightly in Python
(``spx_playbook.build_playbook``) — Pine cannot compute GEX/fib/PoC (no
options-chain / swing / volume access). So this bakes those numbers into a
copy-paste Pine script that:

  1. draws every ladder level as a labeled horizontal line (static, once),
  2. shades the setup zones as boxes (the iron-condor range put→call wall, the
     momentum-target zone flip→put wall),
  3. colors the background by the LIVE regime (the one thing Pine computes: is
     ``close`` above or below the baked gamma flip?) and plots CONDITIONAL
     buy/sell arrows keyed to the setups' own flip/wall crosses.

The arrows are conditional context — they mark WHICH branch of the playbook is
firing (fade the wall while above the flip; go with momentum on a flip break),
not a naive "buy now". The header carries a loud disclaimer, the GEX
0DTE-blindness caveat, and the generated-at stamp so a stale paste is obvious.
This places no orders (ADR-010); it is decision-support, not a signal (ADR-008).

Style mirrors Sentinel's ``zone_intel.build_pine`` (line/label/box string
assembly) but reads the Vantage scaffold. Sentinel is never touched.
"""
from __future__ import annotations

from typing import Any

# level kind (substring, lowercased) -> (base pine color, line style). First match
# wins. Colors are BASE color constants (not color.new(...)) so labels/lines can
# wrap them in color.new(col, transp) without double-wrapping (invalid Pine).
_LEVEL_STYLE: list[tuple[str, str, str]] = [
    ("call wall", "color.red", "line.style_solid"),
    ("put wall", "color.green", "line.style_solid"),
    ("resistance", "color.red", "line.style_solid"),
    ("support", "color.green", "line.style_solid"),
    ("flip", "color.yellow", "line.style_dashed"),
    ("pin", "color.gray", "line.style_dotted"),
    ("pain", "color.gray", "line.style_dotted"),
    ("fib", "color.blue", "line.style_dashed"),
    ("poc", "color.purple", "line.style_solid"),
    ("round", "color.fuchsia", "line.style_dotted"),
]


def _level_style(kind: str) -> tuple[str, str]:
    k = (kind or "").lower()
    for needle, col, style in _LEVEL_STYLE:
        if needle in k:
            return col, style
    return "color.gray", "line.style_solid"


# level kind (substring) -> the "what this level means" one-liner shown as the
# label's second line. Plain-English, so the chart teaches as it marks.
_LEVEL_MEANING: list[tuple[str, str]] = [
    ("call wall", "dealer gamma peaks — rallies stall here, fade toward it"),
    ("put wall", "dealer gamma floor — dips get bought here, fade toward it"),
    ("flip", "regime line — above = mean-reversion, below = momentum"),
    ("pain", "max pain — where most options expire worthless, a pin magnet"),
    ("poc", "volume point of control — price accepts here, chops"),
    ("fib", "fibonacci retrace of the recent swing — reaction level"),
    ("resistance", "prior swing high — supply, more tests = stronger"),
    ("support", "prior swing low — demand, more tests = stronger"),
    ("round", "round number — order/option strikes cluster, a magnet"),
]


def _level_meaning(kind: str) -> str:
    k = (kind or "").lower()
    for needle, text in _LEVEL_MEANING:
        if needle in k:
            return text
    return ""


def _sanitize(text: str) -> str:
    """Pine string-literal safety: strip quotes/newlines from a label."""
    return str(text or "").replace('"', "'").replace("\n", " ").strip()


def _short_kind(kind: str) -> str:
    """A compact label tag so stacked levels don't overprint. Drops the verbose
    parenthetical ('resistance (3x tested)' -> 'resistance 3x')."""
    k = kind or ""
    import re
    k = re.sub(r"\((\d+)x tested\)", r"\1x", k)   # '(3x tested)' -> '3x'
    k = k.replace(" (regime line)", "").replace(" (magnet)", "").replace(" (pin)", "")
    k = k.replace("GEX ", "").replace(" (resistance)", "").replace(" (support)", "")
    return _sanitize(k).strip()


def _pine_level(price: float, kind: str, rank: int = 0, label_text: str | None = None) -> list[str]:
    """One level: a thin ray + a TWO-LINE label at normal size — the level name +
    price on line 1, a plain-English 'what this means' note on line 2. Offset to
    the right by ``rank`` so any still-close levels fan out. ``label_text``
    overrides the auto name (used for merged clusters)."""
    col, style = _level_style(kind)
    name = f"{label_text or _short_kind(kind)} {price:.0f}"
    meaning = _level_meaning(kind)
    # Pine label supports \n for multi-line; a literal backslash-n in the string.
    text = f"{name}\\n{meaning}" if meaning else name
    xoff = 14 + (rank % 5) * 9
    return [
        (f"    line.new(bar_index - 40, {price:.1f}, bar_index + 5, {price:.1f}, "
         f"extend=extend.left, color=color.new({col}, 25), width=1, style={style})"),
        (f"    label.new(bar_index + {xoff}, {price:.1f}, \"{_sanitize(text)}\", "
         f"style=label.style_label_left, color=color.new({col}, 82), "
         f"textcolor={col}, size=size.normal)"),
    ]


# ── theme-aware colors (legible on BOTH dark and light backgrounds) ──────────
# Pine can't read the chart bg reliably, so we bake a per-role color PAIR
# (dark-bg color, light-bg color) and emit `isDark ? <dark> : <light>`. `isDark`
# is resolved once in the script from the theme input (Auto uses chart.bg_color).
# Hues are mid-tone/high-contrast so nothing washes out either way.
_ROLE_COLORS = {
    #  role         dark-bg hex   light-bg hex
    "support":   ("#26A69A", "#1B7A70"),
    "resistance":("#EF5350", "#C62828"),
    "pivot":     ("#FFB300", "#B8860B"),
    "flip":      ("#FDD835", "#B8860B"),
    "wall_up":   ("#EF5350", "#C62828"),
    "wall_dn":   ("#26A69A", "#1B7A70"),
    "poc":       ("#AB47BC", "#7B1FA2"),
    "neutral":   ("#B0BEC5", "#455A64"),
}


def _role_col(role: str) -> str:
    """Emit a theme-conditional BARE color expression for a role (a hex on each
    branch, NOT wrapped in color.new) so callers can apply transparency exactly
    once via color.new(<this>, t) without an invalid double-wrap."""
    d, l = _ROLE_COLORS.get(role, _ROLE_COLORS["neutral"])
    return f"(isDark ? #{d.lstrip('#')} : #{l.lstrip('#')})"


def _pine_conf_box(z: dict) -> list[str]:
    """A confluence zone as a faint shaded box (lo–hi) + one short tag. Theme-safe
    fill/border. role → color."""
    role = z.get("role", "pivot")
    col = _role_col("support" if role == "support" else
                    "resistance" if role == "resistance" else "pivot")
    lo, hi = float(z["lo"]), float(z["hi"])
    # give a 1-tick minimum height so a zero-width zone still shows a band
    if hi - lo < 0.25:
        hi = lo + 0.25
    tag = _sanitize(" + ".join(z.get("kinds", [])[:3]) + f"  {z['price']:.0f}")
    return [
        f"    box.new(bar_index - 40, {hi:.1f}, bar_index + 5, {lo:.1f}, "
        f"border_color=color.new({col}, 55), bgcolor=color.new({col}, 88), "
        f"extend=extend.left, text=\"{tag}\", text_size=size.small, "
        f"text_color={col}, text_halign=text.align_right, text_valign=text.align_top)",
    ]


def _key_levels(scaffold: dict) -> dict[str, float | None]:
    """Pull flip / put_wall / call_wall off the setups (authoritative) or the ladder."""
    out: dict[str, float | None] = {"flip": None, "put_wall": None, "call_wall": None}
    for su in scaffold.get("setups") or []:
        for k, v in (su.get("levels") or {}).items():
            if k in out and out[k] is None and v is not None:
                out[k] = float(v)
    if any(v is None for v in out.values()):
        for r in scaffold.get("level_ladder") or []:
            k = (r.get("kind") or "").lower()
            if out["flip"] is None and "flip" in k:
                out["flip"] = float(r["price"])
            elif out["call_wall"] is None and "call wall" in k:
                out["call_wall"] = float(r["price"])
            elif out["put_wall"] is None and "put wall" in k:
                out["put_wall"] = float(r["price"])
    return out


def _pine_table(scaffold: dict, session: str, sym: str = "SPX") -> list[str]:
    """Emit a compact corner TABLE (theme-aware) that replaces the label wall:
    a header + one-line read, a row per key level (price · label · expect),
    a volume row, and a caveat footer. Drawn once at the last bar."""
    tbl = scaffold.get("table") or {}
    rows = tbl.get("rows") or []
    reg = scaffold.get("regime") or {}
    struct_note = _sanitize(tbl.get("structure_note") or "")
    # rows + header + read + volume + caveat (+ structure row when present)
    n = len(rows) + 4 + (1 if struct_note else 0)
    hdr = _sanitize(f"{sym} 0DTE · {session}"
                    + (f" · {tbl.get('regime_line')}" if tbl.get("regime_line") else ""))
    read = _sanitize("Plan: " + (tbl.get("read") or "n/a"))
    vol = _sanitize("Volume: " + (tbl.get("volume_note") or "n/a"))
    struct = _sanitize("Trend: " + struct_note) if struct_note else ""
    cav = "★ = has held for many days · a guide, not a trade signal · not financial advice"

    # 4 columns: key(A/B/C) · price · label · expect. Readable font (normal).
    out = [
        "    // theme-aware table colors",
        "    tblBg = isDark ? color.new(#0d1117, 4) : color.new(#f4f6f8, 3)",
        "    tblTx = isDark ? color.new(#e6edf3, 0) : color.new(#1b2733, 0)",
        "    tblHd = isDark ? color.new(#1f6feb, 0) : color.new(#0b4fa8, 0)",
        f"    var table pb = table.new(position.top_right, 4, {n}, "
        "bgcolor=tblBg, border_width=1, border_color=color.new(color.gray, 60), frame_width=1)",
        "    table.clear(pb, 0, 0, 3, " + str(n - 1) + ")",
        # header (row 0) + read (row 1) span all 4 columns
        f"    table.cell(pb, 0, 0, \"{hdr}\", text_color=tblHd, text_size=size.normal, "
        "text_halign=text.align_left)",
        "    table.merge_cells(pb, 0, 0, 3, 0)",
        f"    table.cell(pb, 0, 1, \"{read}\", text_color=tblTx, text_size=size.small, "
        "text_halign=text.align_left)",
        "    table.merge_cells(pb, 0, 1, 3, 1)",
    ]
    for i, r in enumerate(rows):
        rr = 2 + i
        role = r.get("role", "pivot")
        col = _role_col("support" if role == "support" else
                        "resistance" if role == "resistance" else "pivot")
        key = _sanitize(str(r.get("key", "")))
        star = "✦ " if r.get("confluence") else ""
        price = f"{float(r['price']):.0f}"
        lab = _sanitize(star + str(r.get("label", "")))
        exp = _sanitize(str(r.get("expect", "")))
        out += [
            f"    table.cell(pb, 0, {rr}, \"{key}\", text_color={col}, "
            "text_size=size.normal, text_halign=text.align_center)",
            f"    table.cell(pb, 1, {rr}, \"{price}\", text_color={col}, "
            "text_size=size.normal, text_halign=text.align_right)",
            f"    table.cell(pb, 2, {rr}, \"{lab}\", text_color=tblTx, "
            "text_size=size.normal, text_halign=text.align_left)",
            f"    table.cell(pb, 3, {rr}, \"{exp}\", text_color=tblTx, "
            "text_size=size.normal, text_halign=text.align_left)",
        ]
    vr = 2 + len(rows)
    if struct:
        out += [
            f"    table.cell(pb, 0, {vr}, \"{struct}\", text_color=tblTx, "
            "text_size=size.small, text_halign=text.align_left)",
            f"    table.merge_cells(pb, 0, {vr}, 3, {vr})",
        ]
        vr += 1
    out += [
        f"    table.cell(pb, 0, {vr}, \"{vol}\", text_color=tblTx, text_size=size.small, "
        "text_halign=text.align_left)",
        f"    table.merge_cells(pb, 0, {vr}, 3, {vr})",
        f"    table.cell(pb, 0, {vr + 1}, \"{cav}\", "
        "text_color=color.new(color.gray, 20), text_size=size.small, text_halign=text.align_left)",
        f"    table.merge_cells(pb, 0, {vr + 1}, 3, {vr + 1})",
    ]
    return out


# the 4 dealer-gamma (GEX) levels, in a stable draw order with a plain label and
# a distinct color role. These are the options-positioning levels — the thing that
# makes the SPX playbook special — so they get their own dedicated labeled lines.
_GEX_SPEC = [
    ("call wall", "Call wall", "wall_up"),      # resistance-ish (red)
    ("put wall", "Put wall", "wall_dn"),         # support-ish (green)
    ("flip", "Gamma flip", "flip"),              # regime line (amber)
    ("pain", "Max pain", "poc"),                 # magnet (purple)
]


def _gex_levels(scaffold: dict) -> list[tuple[float, str, str]]:
    """Pull the GEX levels off the ladder as (price, plain-label, color-role),
    in _GEX_SPEC order. Only levels sourced from GEX are included."""
    out: list[tuple[float, str, str]] = []
    ladder = scaffold.get("level_ladder") or []
    for needle, label, role in _GEX_SPEC:
        for r in ladder:
            if r.get("source") != "GEX":
                continue
            if needle in (r.get("kind") or "").lower():
                out.append((float(r["price"]), label, role))
                break
    return out


def _pine_gex_lines(scaffold: dict) -> list[str]:
    """Dedicated labeled lines for the dealer-gamma (GEX) levels — each a bold
    horizontal ray + a right-edge label showing NAME + PRICE (e.g. 'Call wall
    7577'), colored distinctly so the options levels stand out from the rest."""
    levels = _gex_levels(scaffold)
    if not levels:
        return []
    out: list[str] = ["    // --- dealer-gamma (GEX) levels: labeled lines w/ price ---"]
    for price, label, role in levels:
        col = _role_col(role)
        txt = _sanitize(f"{label} {price:.0f}")
        out += [
            f"    line.new(bar_index - 40, {price:.1f}, bar_index + 3, {price:.1f}, "
            f"extend=extend.left, color=color.new({col}, 20), width=2, "
            "style=line.style_solid)",
            f"    label.new(bar_index + 40, {price:.1f}, \"{txt}\", "
            f"style=label.style_label_left, color=color.new({col}, 15), "
            "textcolor=color.white, size=size.small)",
        ]
    return out


def _pine_row_markers(rows: list[dict]) -> list[str]:
    """Draw EVERY table row on the chart: a thin theme-colored line at its price
    + a boxed letter (A/B/C…) at the right edge, so each table row maps to a
    visible chart mark. This brings back the levels the confluence-only view
    dropped — the user reads 'gamma flip = C' and finds C on the chart."""
    out: list[str] = ["    // per-row level lines + letter markers (table keys)"]
    for r in rows:
        price = float(r["price"])
        role = r.get("role", "pivot")
        col = _role_col("support" if role == "support" else
                        "resistance" if role == "resistance" else "pivot")
        key = _sanitize(str(r.get("key", "")))
        conf = r.get("confluence")
        durable = r.get("durable")
        # confluence rows already have a shaded box → solid line; durable (memory)
        # rows get a heavier solid line + a ★ on the marker; lone levels dotted.
        style = "line.style_solid" if (conf or durable) else "line.style_dotted"
        width = 2 if durable else 1
        mark = f"{key}★" if durable else key
        out += [
            f"    line.new(bar_index - 40, {price:.1f}, bar_index + 3, {price:.1f}, "
            f"extend=extend.left, color=color.new({col}, {35 if durable else 45}), "
            f"width={width}, style={style})",
            f"    label.new(bar_index + 3, {price:.1f}, \"{mark}\", "
            f"style=label.style_label_left, color=color.new({col}, 0), "
            f"textcolor=color.white, size=size.normal)",
        ]
    return out


def _pine_fade_arrow(price: float, role: str, tag: str, label: str,
                     durable: bool = False, sym: str = "SPX") -> list[str]:
    """One 'fade the level' arrow gated by the VALIDATED reclaim discipline
    (strategy-winrate + reclaim-interval goals): after price tags the level,
    the arrow fires only on the Nth consecutive close back through it
    (``confirmCloses`` input, default 3 — set the chart to 5m to match the
    validated '3 consecutive 5m closes'). confirmCloses=1 reproduces the old
    single-bar behavior. Each arrow keeps its own tag/streak/armed state
    (unique ``tag`` so identifiers don't collide)."""
    p = f"{price:.1f}"
    size = "size.normal" if durable else "size.small"
    if role == "support":
        col = "(isDark ? #26A69A : #1B7A70)"
        txt = f"BUY{'★' if durable else ''}"
        return [
            f"lvlBuy{tag} = {p}",
            f"var bool armedBuy{tag} = true",
            f"var bool tagBuy{tag} = false",
            f"var int nBuy{tag} = 0",
            f"if confirmed",
            f"    if low <= lvlBuy{tag}",
            f"        tagBuy{tag} := true",
            f"        nBuy{tag} := close > lvlBuy{tag} ? 1 : 0",
            f"    else",
            f"        nBuy{tag} := tagBuy{tag} ? nBuy{tag} + 1 : 0",
            f"buyTrig{tag} = showArrows and confirmed and tagBuy{tag} and nBuy{tag} >= confirmCloses",
            f"fadeBuy{tag} = buyTrig{tag} and armedBuy{tag}",
            f"if fadeBuy{tag}",
            f"    tagBuy{tag} := false",
            f"    nBuy{tag} := 0",
            f"armedBuy{tag} := confirmed ? (fadeBuy{tag} ? false : "
            f"(low > lvlBuy{tag} * 1.001 ? true : armedBuy{tag})) : armedBuy{tag}",
            f"plotshape(fadeBuy{tag}, title=\"{_sanitize(label)}\", location=location.belowbar, "
            f"style=shape.triangleup, color={col}, size={size}, text=\"{txt}\")",
            f"alertcondition(fadeBuy{tag}, title=\"{_sanitize(label)}\", "
            f"message=\"{sym} reclaimed {_sanitize(label)} — reclaim entry confirmed.\")",
        ]
    # resistance / pivot → SELL
    col = "(isDark ? #EF5350 : #C62828)"
    txt = f"SELL{'★' if durable else ''}"
    return [
        f"lvlSell{tag} = {p}",
        f"var bool armedSell{tag} = true",
        f"var bool tagSell{tag} = false",
        f"var int nSell{tag} = 0",
        f"if confirmed",
        f"    if high >= lvlSell{tag}",
        f"        tagSell{tag} := true",
        f"        nSell{tag} := close < lvlSell{tag} ? 1 : 0",
        f"    else",
        f"        nSell{tag} := tagSell{tag} ? nSell{tag} + 1 : 0",
        f"sellTrig{tag} = showArrows and confirmed and tagSell{tag} and nSell{tag} >= confirmCloses",
        f"fadeSell{tag} = sellTrig{tag} and armedSell{tag}",
        f"if fadeSell{tag}",
        f"    tagSell{tag} := false",
        f"    nSell{tag} := 0",
        f"armedSell{tag} := confirmed ? (fadeSell{tag} ? false : "
        f"(high < lvlSell{tag} * 0.999 ? true : armedSell{tag})) : armedSell{tag}",
        f"plotshape(fadeSell{tag}, title=\"{_sanitize(label)}\", location=location.abovebar, "
        f"style=shape.triangledown, color={col}, size={size}, text=\"{txt}\")",
        f"alertcondition(fadeSell{tag}, title=\"{_sanitize(label)}\", "
        f"message=\"{sym} lost {_sanitize(label)} — reclaim-short confirmed.\")",
    ]


def build_playbook_pine(scaffold: dict[str, Any]) -> str:
    """Render the scaffold to a Pine v5 indicator string. Draws ONLY confluence
    zones (declutter) + an on-chart table + confluence-keyed arrows + a faint
    theme-aware regime tint. Empty when there are no levels."""
    ladder = scaffold.get("level_ladder") or []
    confluence = scaffold.get("confluence") or []
    durable = scaffold.get("durable") or []
    if not ladder and not confluence:
        return ""

    session = _sanitize(scaffold.get("session") or "next session")
    sym = _sanitize(str(scaffold.get("symbol") or "SPX").upper())
    reg = scaffold.get("regime") or {}
    gen = _sanitize(scaffold.get("generated_for") or "")
    gamma = _sanitize(reg.get("gamma") or "n/a")
    kl = _key_levels(scaffold)
    flip, put_w, call_w = kl["flip"], kl["put_wall"], kl["call_wall"]

    # nearest support/resistance confluence zones — the fade-arrow anchors
    spot = reg.get("spot")
    sup_zone = next((z for z in confluence if z.get("role") == "support"), None)
    res_zone = next((z for z in confluence if z.get("role") == "resistance"), None)

    header = [
        "//@version=5",
        f"indicator(\"{sym} 0DTE Playbook — {session}\", overlay=true, "
        "max_boxes_count=200, max_lines_count=200, max_labels_count=200)",
        "",
        f"// Generated by Vantage for the {session} session (from {gen}). "
        f"Dealer gamma: {gamma}.",
        "// Confluence zones (≥2 dimensions stacking: GEX wall / gamma flip / fib / "
        "PoC / S-R) are",
        "// baked from Python (Pine can't compute GEX/fib/PoC). The chart shows ONLY "
        "those zones + a",
        "// corner table; the regime tint + arrows update live off price vs the gamma flip.",
        "//",
        "// ⚠️ NOT FINANCIAL ADVICE. Arrows are CONDITIONAL context (fade a confluence "
        "zone; go with",
        "//    momentum on a flip break), not a guaranteed buy/sell. The GEX read is "
        "OI-based and BLIND",
        "//    to 0DTE flow. Context, not a signal (ADR-008). "
        f"Apply on a {sym} chart.",
        "",
        "// ── theme (Auto uses the chart background; override with the input) ──",
        "themeIn = input.string(\"Auto\", \"Theme\", options=[\"Auto\", \"Dark\", \"Light\"])",
        "isDark = themeIn == \"Dark\" ? true : themeIn == \"Light\" ? false : "
        "(chart.bg_color == color.white ? false : true)",
        "coexist = input.bool(false, \"Coexist mode (with LuxAlgo etc.)\", "
        "tooltip=\"On: suppress our shaded boxes so they don't collide with another "
        "indicator's zones — keep the table + letter lines only.\")",
        "showZones = input.bool(true, \"Confluence zones (boxes)\") and not coexist",
        "showLevels = input.bool(true, \"Level lines + letter keys\")",
        "showGex = input.bool(true, \"Dealer-gamma (GEX) levels\")",
        "showTable = input.bool(true, \"Levels table\")",
        "showArrows = input.bool(true, \"Buy/Sell/Break arrows\")",
        "confirmCloses = input.int(3, \"Reclaim confirmation closes\", minval=1, maxval=5, "
        "tooltip=\"Consecutive closes back through a level required before an arrow fires — "
        "the validated reclaim discipline (3 consecutive 5m closes; set the chart to 5m to "
        "match). 1 = legacy single-bar behavior.\")",
        "showRegime = input.bool(true, \"Regime tint\") and not coexist",
        "",
    ]

    # --- live regime tint + confluence-keyed arrows ---
    live: list[str] = ["confirmed = barstate.isconfirmed"]
    if flip is not None:
        live += [
            f"flipLevel = {flip:.1f}",
            "aboveFlip = close > flipLevel",
            "bgcolor(showRegime and aboveFlip ? color.new(color.green, 96) : "
            "showRegime ? color.new(color.red, 96) : na)",
        ]
    else:
        live += ["aboveFlip = true"]

    # Strict fade arrows at (a) the nearest support/resistance CONFLUENCE zones and
    # (b) each DURABLE memory level (deduped by price). Each gets a unique tag so
    # its armed-latch identifiers don't collide. Support→BUY, resistance→SELL.
    anchors: list[tuple[float, str, str, bool]] = []   # (price, role, label, durable)
    if res_zone is not None:
        anchors.append((float(res_zone["price"]), "resistance",
                        "fade resistance zone", False))
    if sup_zone is not None:
        anchors.append((float(sup_zone["price"]), "support",
                        "bounce support zone", False))
    for z in durable:
        role = z.get("role")
        if role not in ("support", "resistance"):
            continue
        anchors.append((float(z["price"]), role,
                        f"durable {role} ({z.get('sessions', 0)}d)", True))
    seen_prices: set = set()
    tagn = 0
    for price, role, label, is_dur in anchors:
        k = round(price)
        if k in seen_prices:      # a durable level coinciding with a confluence zone — skip dup
            continue
        seen_prices.add(k)
        tagn += 1
        live += _pine_fade_arrow(price, role, str(tagn), label, durable=is_dur, sym=sym)
    # BREAK — regime flip below the gamma flip
    if flip is not None:
        live += [
            "var bool wasAbove = true",
            "momoBreak = showArrows and confirmed and close < flipLevel and wasAbove",
            "wasAbove := confirmed ? close > flipLevel : wasAbove",
            "plotshape(momoBreak, title=\"flip break (momentum)\", location=location.abovebar, "
            "style=shape.xcross, color=(isDark ? #FFB300 : #B8860B), size=size.tiny, text=\"BREAK\")",
            "alertcondition(momoBreak, title=\"Gamma flip break\", "
            f"message=\"{sym} broke below the gamma flip — momentum regime.\")",
        ]
    live.append("")

    table_rows = (scaffold.get("table") or {}).get("rows") or []

    # --- draw confluence zones + per-row level markers + the table (last bar) ---
    once: list[str] = ["if barstate.islastconfirmedhistory"]
    once.append("    // --- confluence zones (shaded boxes where ≥2 dims stack) ---")
    if confluence:
        once.append("    if showZones")
        for z in confluence:
            once += ["    " + ln for ln in _pine_conf_box(z)]
    # every table row gets a line + letter marker so the table maps 1:1 to the chart
    if table_rows:
        once.append("    if showLevels")
        once += ["    " + ln for ln in _pine_row_markers(table_rows)]
    # dealer-gamma (GEX) levels as their own bold labeled lines with the price
    gex_lines = _pine_gex_lines(scaffold)
    if gex_lines:
        once.append("    if showGex")
        once += ["    " + ln for ln in gex_lines]
    once.append("    // --- levels table ---")
    once.append("    if showTable")
    once += ["    " + ln for ln in _pine_table(scaffold, session, sym)]

    return "\n".join(header + live + once) + "\n"


__all__ = ["build_playbook_pine"]
