"""Pine export of the 0DTE SPX playbook: confluence zones, table, arrows, theme."""
from __future__ import annotations

from vantage_server.playbook_pine import build_playbook_pine


def _scaffold():
    """A scaffold shaped like build_playbook's output — with confluence + table."""
    return {
        "symbol": "SPX", "session": "2026-07-08", "generated_for": "2026-07-07",
        "regime": {"gamma": "positive", "spot": 7503.9, "vix": 16.0},
        "level_ladder": [
            {"price": 7550.0, "kind": "GEX call wall (resistance)", "source": "GEX"},
            {"price": 7500.0, "kind": "max pain (pin)", "source": "GEX"},
            {"price": 7496.3, "kind": "fib 78.6%", "source": "chart"},
            {"price": 7481.0, "kind": "gamma flip (regime line)", "source": "GEX"},
            {"price": 7453.0, "kind": "fib 61.8%", "source": "chart"},
            {"price": 7450.0, "kind": "GEX put wall (support)", "source": "GEX"},
        ],
        "confluence": [
            {"lo": 7496.3, "hi": 7500.0, "price": 7498.0, "role": "resistance",
             "kinds": ["max pain", "fib 78.6%"], "dims": ["max_pain", "fib"], "strength": 2},
            {"lo": 7450.0, "hi": 7453.0, "price": 7451.5, "role": "support",
             "kinds": ["put wall", "fib 61.8%"], "dims": ["gex_wall", "fib"], "strength": 2},
        ],
        "durable": [
            {"price": 7451.5, "lo": 7450.0, "hi": 7453.0, "sessions": 5, "respected": 4,
             "first_seen": "2026-06-26", "last_seen": "2026-07-07",
             "dims": ["support"], "kind": "support (3x tested)", "role": "support",
             "durable": True},
        ],
        "table": {
            "read": "above flip 7481 = mean-reversion; buy dips to 7450-7453; fade rips to 7498",
            "regime_line": "gamma positive · VIX 16",
            "volume_note": "expanding on the push — buyers confirming",
            "structure_note": "higher highs + higher lows; broke UP through 7490 (bullish BOS)",
            "rows": [
                {"key": "A", "price": 7498.0, "label": "max pain + fib 78.6% ✦", "expect": "fade zone",
                 "role": "resistance", "confluence": True, "durable": False, "sessions": 0},
                {"key": "B", "price": 7481.0, "label": "gamma flip", "expect": "regime line", "role": "pivot",
                 "confluence": False, "durable": False, "sessions": 0},
                {"key": "C", "price": 7451.5, "label": "put wall + fib 61.8% ✦ ★5d", "expect": "dip-buy zone",
                 "role": "support", "confluence": True, "durable": True, "sessions": 5},
            ],
        },
        "setups": [
            {"trigger": "above flip", "levels": {"put_wall": 7450.0, "call_wall": 7550.0, "flip": 7481.0}},
        ],
    }


# ------------------------------------------------------------ skeleton / syntax

def test_pine_is_valid_v5_skeleton():
    s = build_playbook_pine(_scaffold())
    assert s.startswith("//@version=5")
    assert 'indicator("SPX 0DTE Playbook — 2026-07-08"' in s
    assert "overlay=true" in s
    assert "if barstate.islastconfirmedhistory" in s


def test_no_double_color_new():
    s = build_playbook_pine(_scaffold())
    assert "color.new(color.new" not in s
    assert "color.new((isDark ? color.new" not in s


def test_balanced_parens_and_quotes():
    s = build_playbook_pine(_scaffold())
    for i, l in enumerate(s.split("\n"), 1):
        st = l.strip()
        if not st or st.startswith("//"):
            continue
        assert st.count("(") == st.count(")"), f"L{i} parens: {st[:60]}"
        assert st.count('"') % 2 == 0, f"L{i} quotes: {st[:60]}"


# ------------------------------------------------------------ declutter: confluence only + table

def test_confluence_zones_and_row_markers():
    s = build_playbook_pine(_scaffold())
    # one shaded box per confluence zone (2 here); no per-level meaning SENTENCES
    assert s.count("box.new(") == 2
    assert "dealer gamma peaks" not in s          # no meaning-sentence wall on chart
    # EVERY table row gets a line + a letter marker (3 rows) PLUS the 4 GEX lines
    # (call wall / put wall / gamma flip / max pain) each get a line + label.
    assert s.count("line.new(") == 3 + 4
    assert s.count("label.new(") == 3 + 4
    # the letter keys are drawn on the chart
    for key in ("\"A\"", "\"B\"", "\"C\""):
        assert key in s, f"missing letter marker {key}"


def test_gex_levels_drawn_as_labeled_lines_with_price():
    s = build_playbook_pine(_scaffold())
    assert "showGex = input.bool(true" in s
    assert "if showGex" in s
    # each GEX level has a name+price label
    assert "Call wall 7550" in s
    assert "Put wall 7450" in s
    assert "Gamma flip 7481" in s
    assert "Max pain 7500" in s
    # the GEX section header comment is present
    assert "dealer-gamma (GEX) levels" in s


def test_on_chart_table_4col_with_letters_and_readable_font():
    s = build_playbook_pine(_scaffold())
    assert "table.new(position.top_right, 4," in s   # 4 columns (key added)
    assert s.count("table.cell(") >= 10              # header+read+3 rows×4 cols+vol+caveat
    assert "Plan: above flip 7481" in s
    assert "Volume: expanding on the push" in s
    assert "not financial advice" in s.lower()
    # readable font, not tiny
    assert "size=size.normal" in s
    assert "text_size=size.tiny" not in s


def test_coexist_mode_input_suppresses_boxes_and_tint():
    s = build_playbook_pine(_scaffold())
    assert "coexist = input.bool(false" in s
    # boxes + regime tint are gated off in coexist mode; table/letters are not
    assert "input.bool(true, \"Confluence zones (boxes)\") and not coexist" in s
    assert "input.bool(true, \"Regime tint\") and not coexist" in s
    assert "and not coexist" not in s.split("showTable")[1].split("\n")[0]


def test_durable_level_gets_star_marker_and_structure_row():
    s = build_playbook_pine(_scaffold())
    # the durable row (C, sessions=5) draws a ★ marker + heavier line
    assert '"C★"' in s
    assert "width=2" in s
    # structure read is surfaced as a table row
    assert "Trend: higher highs + higher lows" in s
    # the caveat explains the ★ (plain language)
    assert "has held for many days" in s


def test_confluence_keyed_arrows():
    s = build_playbook_pine(_scaffold())
    # SELL (resistance zone) + BUY (support zone; durable 7451.5 dedups into it) + BREAK
    assert s.count("plotshape(") == 3
    assert s.count("alertcondition(") == 3
    # SELL keyed to the resistance confluence zone (7498), tagged (tag 1)
    assert "lvlSell1 = 7498.0" in s and "high >= lvlSell1 and close < lvlSell1" in s
    # BUY keyed to the support confluence zone (7451.5), tagged (tag 2)
    assert "lvlBuy2 = 7451.5" in s and "low <= lvlBuy2 and close > lvlBuy2" in s
    assert "text=\"BUY\"" in s and "text=\"SELL\"" in s
    # BREAK is the gamma-flip regime break
    assert "momoBreak = showArrows and confirmed and close < flipLevel and wasAbove" in s
    # confirmation filter (not every bar)
    assert "confirmed = barstate.isconfirmed" in s
    assert "var bool armedSell1" in s and "var bool armedBuy2" in s


def test_durable_level_gets_its_own_fade_arrow():
    # a durable support level NOT coinciding with a confluence zone gets its own
    # tagged BUY★ arrow (arrows key off memory levels too).
    sc = _scaffold()
    sc["durable"] = [
        {"price": 7405.0, "lo": 7404.0, "hi": 7406.0, "sessions": 9, "respected": 6,
         "first_seen": "2026-06-10", "last_seen": "2026-07-07", "dims": ["support"],
         "kind": "durable support", "role": "support", "durable": True},
    ]
    s = build_playbook_pine(sc)
    assert "text=\"BUY★\"" in s                      # durable marker
    assert "lvlBuy" in s and "7405.0" in s
    assert "durable support (9d)" in s               # labeled with session count


def test_faint_regime_tint():
    s = build_playbook_pine(_scaffold())
    assert "flipLevel = 7481.0" in s
    assert "bgcolor(showRegime and aboveFlip ? color.new(color.green, 96)" in s


# ------------------------------------------------------------ theme-aware colors

def test_theme_input_and_conditional_colors():
    s = build_playbook_pine(_scaffold())
    assert 'input.string("Auto", "Theme", options=["Auto", "Dark", "Light"])' in s
    assert "chart.bg_color == color.white" in s   # Auto detection
    assert "isDark ?" in s                          # colors swap by theme
    # table bg + text swap with theme
    assert "tblBg = isDark ?" in s and "tblTx = isDark ?" in s


# ------------------------------------------------------------ caveats / stamp / edges

def test_loud_caveats_in_header():
    s = build_playbook_pine(_scaffold())
    assert "NOT FINANCIAL ADVICE" in s
    assert "0DTE" in s and "BLIND" in s
    assert "ADR-008" in s
    assert "CONDITIONAL" in s


def test_generated_stamp_and_session():
    s = build_playbook_pine(_scaffold())
    assert "2026-07-08 session" in s
    assert "from 2026-07-07" in s
    assert "Dealer gamma: positive" in s


def test_empty_scaffold_yields_empty():
    assert build_playbook_pine({"level_ladder": [], "confluence": []}) == ""


def test_no_confluence_still_renders_table_and_arrows():
    # a scaffold with levels but no ≥2-dim confluence still produces a valid script
    sc = _scaffold(); sc["confluence"] = []
    sc["table"]["rows"] = [{"price": 7481.0, "label": "gamma flip", "expect": "regime line",
                            "role": "pivot", "confluence": False}]
    s = build_playbook_pine(sc)
    assert s.startswith("//@version=5")
    assert "box.new(" not in s                    # no confluence zones to draw
    assert "table.new(" in s                       # table still present
    assert "flipLevel = 7481.0" in s               # regime + BREAK still work


def test_table_text_sanitized():
    sc = _scaffold()
    sc["table"]["read"] = 'a "quoted" read'
    s = build_playbook_pine(sc)
    assert '"quoted"' not in s                      # inner quotes stripped
