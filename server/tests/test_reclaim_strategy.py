"""The reclaim spec is the single source of truth; Pine can't drift from it."""
from __future__ import annotations

from vantage_server import reclaim_pine, reclaim_strategy as spec


# ── spec geometry ────────────────────────────────────────────────────────────


def test_stop_is_pad_beyond_the_level():
    assert spec.stop_for(100.0, "long") == 100.0 * (1 - spec.STOP_PAD_PCT / 100)
    assert spec.stop_for(100.0, "short") == 100.0 * (1 + spec.STOP_PAD_PCT / 100)


def test_target_is_next_opposing_level():
    sups = [90.0, 95.0]
    ress = [105.0, 110.0]
    # long at 95 support -> next resistance above (105)
    assert spec.target_for(95.0, "long", sups, ress) == 105.0
    # short at 105 resistance -> next support below (95)
    assert spec.target_for(105.0, "short", sups, ress) == 95.0
    # open-ended when no opposing level
    assert spec.target_for(95.0, "long", sups, [90.0]) is None


def test_risk_reward():
    assert spec.risk_reward(entry=100.0, stop=99.8, target=100.6) == 3.0
    assert spec.risk_reward(entry=100.0, stop=99.8, target=None) is None


def test_target_ladder_next_n_opposing_levels():
    sups = [88.0, 92.0, 95.0]
    ress = [105.0, 110.0, 120.0, 130.0]
    # long at 95 -> next 3 resistances above, nearest first
    assert spec.target_ladder(95.0, "long", sups, ress, count=3) == [105.0, 110.0, 120.0]
    # short at 105 -> next supports below, nearest first (descending)
    assert spec.target_ladder(105.0, "short", sups, ress, count=3) == [95.0, 92.0, 88.0]
    # T1 always equals the single-target function
    assert spec.target_ladder(95.0, "long", sups, ress)[0] == spec.target_for(95.0, "long", sups, ress)
    # runs out gracefully — fewer than count, never invented
    assert spec.target_ladder(95.0, "long", sups, [105.0], count=3) == [105.0]
    assert spec.target_ladder(95.0, "long", sups, [], count=3) == []


# ── Pine artifacts carry the spec's numbers (no drift) ───────────────────────


def test_strategy_and_indicator_seed_defaults_from_the_spec():
    for build in (reclaim_pine.build_reclaim_strategy, reclaim_pine.build_reclaim_indicator):
        s = build()
        # the reclaim-closes input default IS the spec constant
        assert f'input.int({spec.RECLAIM_CLOSES}, "Reclaim confirmation closes"' in s
        # the stop pad default IS the spec constant
        assert f'input.float({spec.STOP_PAD_PCT}, "Stop pad' in s


def test_strategy_is_a_backtestable_strategy():
    s = reclaim_pine.build_reclaim_strategy()
    assert s.startswith("//@version=5")
    assert 'strategy("Reclaim Strategy"' in s
    assert "strategy.entry(\"Long\"" in s and "strategy.exit(\"Long X\"" in s
    assert "strategy.entry(\"Short\"" in s


def test_indicator_draws_entry_stop_target_and_alerts():
    s = reclaim_pine.build_reclaim_indicator()
    assert 'indicator("Reclaim Strategy (signals)"' in s
    assert "longStop" in s and "longTarget" in s        # stop + target computed
    assert "line.new(" in s and "label.new(" in s        # drawn on the chart
    assert "alertcondition(longSignal" in s and "alertcondition(shortSignal" in s
    assert 'text="BUY"' in s and 'text="SELL"' in s


def test_both_are_self_contained_no_vantage_reference():
    for build in (reclaim_pine.build_reclaim_strategy, reclaim_pine.build_reclaim_indicator):
        s = build()
        # live pivots present — the script computes its own levels when no GEX
        # list is pasted, so it runs standalone on any symbol.
        assert "ta.pivothigh" in s and "ta.pivotlow" in s
        # no Vantage runtime dependency; the ONLY request.security is the HTF
        # pivot lookup on the SAME symbol (chart data, still self-contained).
        assert "vantage" not in s.lower()
        for i, chunk in enumerate(s.split("request.security(")):
            if i:  # every call targets the chart's own symbol
                assert chunk.startswith("syminfo.tickerid")
        # GEX levels only ever enter via the manual text input, never a fetch
        assert 'input.text_area("", "GEX' in s


def test_confluence_gate_ships_at_the_backtested_value():
    # BACKTESTED (goals/reclaim-confirmations): 2 stacked dims is the validated
    # bar; 3 starved the edge; volume confirmation was REJECTED outright.
    assert spec.MIN_CONFLUENCE == 2
    for build in (reclaim_pine.build_reclaim_strategy, reclaim_pine.build_reclaim_indicator):
        s = build()
        # default seeded from the spec (drift-proof)
        assert f'input.int({spec.MIN_CONFLUENCE}, "Min stacked dimensions' in s
        # the dimensions: fib / round / prior-day / daily MA / second-TF pivot
        assert "f_confluence(" in s and "f_qualified(" in s
        for dim in ('" + round"', '" + fib "', '" + prior day"', '" + daily MA"', '" pivot"'):
            assert dim in s
        # a level needs pivot + (minDims-1) extra dims to trade
        assert "if 1 + cn >= minDims" in s
        # stack tolerance mirrors the champion's zone-clustering tolerance —
        # a tighter width starved the gate into printing NO levels at all
        assert f'input.float({spec.CONF_TOL_PCT}, "Stack tolerance' in s
        assert "price * confTol / 100" in s
        # volume confirmation was disproven — no volume-based CODE may exist
        # (comments documenting the rejection are fine)
        code = "\n".join(ln for ln in s.splitlines()
                         if not ln.strip().startswith("//"))
        assert "volume" not in code.lower()


def test_levels_come_from_htf_analysis():
    # live-pivot mode derives levels from a HIGHER timeframe's pivots (default
    # 1h) while trading the chart TF — structure, not chart-TF noise. A repeated
    # gaps_off value is only a NEW pivot when it CHANGES.
    for build in (reclaim_pine.build_reclaim_strategy, reclaim_pine.build_reclaim_indicator):
        s = build()
        assert 'input.timeframe("60", "Level timeframe (HTF analysis)"' in s
        assert "lookahead=barmerge.lookahead_off" in s     # no future leak
        # pivothigh is na except on pivot bars, and na comparisons are falsy —
        # without fixnan + an na-safe guard the change-guard drops EVERY pivot
        # (the "no levels printed" bug). Both securities must use the idiom.
        assert "fixnan(ta.pivothigh(pivotLen, pivotLen))" in s
        assert "pvH = not na(pvHr) and (na(pvHr[1]) or pvHr != pvHr[1]) ? pvHr : na" in s
        assert "pvH2 = not na(pvH2r) and (na(pvH2r[1]) or pvH2r != pvH2r[1]) ? pvH2r : na" in s


def test_array_loops_are_guarded_against_empty():
    # Pine's `for 0 to size-1` runs descending on an empty array (size 0 -> 0..-1)
    # and calls array.get(arr, 0) out of bounds. Every such loop must be wrapped
    # in `if array.size(arr) > 0`.
    for build in (reclaim_pine.build_reclaim_strategy, reclaim_pine.build_reclaim_indicator):
        lines = build().splitlines()
        for i, ln in enumerate(lines):
            if "for i = 0 to array.size(arr) - 1" in ln:
                guard = lines[i - 1]
                assert "array.size(arr) > 0" in guard, f"unguarded loop near: {ln!r}"


def test_indicator_shows_detail_on_latest_signal_only():
    # readability fix: one reused drawing set, deleted+redrawn each signal, so
    # only the current trade shows the full box; history stays as bare arrows.
    s = reclaim_pine.build_reclaim_indicator()
    assert "var line   acEntry" in s            # persistent handle, not per-bar
    assert "line.delete(acEntry)" in s          # prior drawing erased on new signal
    assert "acEntry :=" in s                    # handle reassigned, not re-created fresh each time
    assert 'input.bool(true, "Show entry/stop/target on the latest signal"' in s
    # Pine forbids reassigning a global var inside a function — the active-trade
    # draw must run inline in global scope, not in an f_draw() helper.
    assert "f_drawActive" not in s
    assert "if sig and showActive" in s


def test_indicator_resolves_a_dead_trade():
    # a stopped-out (or target-hit) setup must not keep posing as active: the
    # first confirmed touch of stop/T1 grays the drawing, stamps the label, and
    # adds a Status row to the ticket. Stop wins a same-bar tie (conservative).
    s = reclaim_pine.build_reclaim_indicator()
    assert "var int   acDir  = 0" in s                 # persistent trade state
    assert "stopHit = acDir == 1 ? low <= acStopP : high >= acStopP" in s
    assert 'outcome = stopHit ? "STOPPED" : "T1 HIT"' in s
    assert "label.set_text(acLabel" in s               # outcome stamped on label
    assert "line.set_color(acEntry, color.new(color.gray" in s
    assert 'f_ticketRow(9, "Status", outcome' in s     # ticket Status row
    assert "bar_index > acBar" in s                    # signal bar itself excluded
    assert "acDone := false" in s                      # new signal resets state


def test_indicator_draws_the_watched_levels_playbook_style():
    # the playbook presentation: full-width lines with a letter chip per level
    # (A = highest) and a top-right table mapping letter → price → the level's
    # story (baked GEX label, or pivot durability). Redrawn on the last bar.
    s = reclaim_pine.build_reclaim_indicator()
    assert 'input.bool(true, "Draw the S/R levels being watched"' in s
    assert 'input.bool(true, "Level table (top right)"' in s
    assert "if barstate.islast" in s
    assert "var line[] lvlLines" in s and "array.clear(lvlLines)" in s
    # letters assigned top-down over the WATCHED sets (GEX or durable pivots)
    assert 'str.split("A,B,C,' in s
    assert "array.copy(resSet)" in s and "array.copy(supSet)" in s
    assert "array.sort(resTmp, order.descending)" in s
    # clutter cap: nearest levels kept, sparse side donates budget to the other
    assert 'input.int(8, "Max levels drawn (nearest kept)"' in s
    assert "resKeep = math.min(nRes, half + math.max(0, half - nSup))" in s
    assert "extend=extend.both" in s          # full-width, like the playbook levels
    assert "table.new(position.top_right, 2, 27" in s
    assert "f_levelName(" in s                 # each row carries the level's story
    assert "x tested" in s                     # pivot durability readout
    # an empty level set explains itself instead of a silently bare chart
    assert "if li == 0 and showLevelTable" in s
    assert "lower Min touches / Min stacked dims" in s


def test_prefill_carries_level_labels():
    # price|label entries so the chart can say WHAT each line is, not just where
    s = reclaim_pine.build_reclaim_indicator_for("SPX", _SCAFFOLD)
    assert "7548|fib 61.8% + call wall" in s
    assert "7500|max pain" in s and "7450|put wall" in s
    # bare numbers still parse (labels optional) — the parser splits on "|"
    assert 'str.split(array.get(parts, i), "|")' in s


def test_indicator_fires_auto_alerts_on_filtered_signals():
    s = reclaim_pine.build_reclaim_indicator()
    # auto alert() with the actual prices, gated on the (durable-filtered) signal
    assert "if longSignal and alertOn" in s and "if shortSignal and alertOn" in s
    assert "alert(f_alertMsg(true), alert.freq_once_per_bar_close)" in s
    assert "syminfo.ticker" in s              # message carries the symbol
    assert 'input.bool(true, "Fire auto-alerts on signals"' in s
    # a single "any signal" condition so one alert covers both directions
    assert 'alertcondition(longSignal or shortSignal, title="Reclaim signal (any)"' in s
    # per-side conditions kept, with the reclaim-closes count substituted
    assert '"Reclaim BUY"' in s and '"Reclaim SELL"' in s
    assert "%d" not in s                       # count substituted, no literal %d
    # TradingView placeholders survive (tail is .replace()-processed, not .format())
    assert "{{ticker}}" in s and "{{interval}}" in s


def test_tables_are_readable_and_theme_aware():
    s = reclaim_pine.build_reclaim_indicator()
    # theme-aware bg so text never floats transparent over candles (the
    # unreadable-white complaint); fg color adapts to light/dark theme.
    # NOTE: text.format_bold is NOT used — it fails to compile on the user's
    # TradingView ("Undeclared identifier 'text'"); size + bg carry the fix.
    assert "text_formatting" not in s
    assert "bgcolor=color.new(chart.bg_color, 15)" in s
    assert "text_color=chart.fg_color" in s          # adapts to light/dark theme
    # level table bumped small -> normal; no tiny text remains on labels
    assert "size=size.tiny" not in s


def test_indicator_has_bottom_trade_ticket_table():
    s = reclaim_pine.build_reclaim_indicator()
    # a persistent bottom table with entry/stop/targets, size.normal, toggleable
    assert "table.new(position.bottom_center" in s
    assert "size.normal" in s
    assert 'input.bool(true, "Show trade ticket table (bottom)"' in s
    for row in ('"Side"', '"Entry"', '"Stop"', '"Risk"'):
        assert row in s
    # T-rows are added per target
    assert '"T" + str.tostring(i + 1)' in s
    # the strategy uses TradingView's native panel — no overlay table
    assert "table.new" not in reclaim_pine.build_reclaim_strategy()


def test_indicator_lines_extend_right_and_ladder_targets():
    s = reclaim_pine.build_reclaim_indicator()
    # entry/stop/target lines extend right (run forward until next signal)
    assert "extend=extend.right" in s
    # T1/T2/T3 ladder seeded from the spec's TARGET_COUNT
    assert f'input.int({spec.TARGET_COUNT}, "Targets' in s
    assert "f_ladder(" in s                      # collects the next N opposing levels
    assert '"T" + str.tostring(i + 1)' in s      # labeled T1/T2/T3
    # target lines are tracked in an array so they all clear on the next signal
    assert "var line[] acTgtLines" in s and "array.clear(acTgtLines)" in s
    # arrows still mark every signal regardless of the detail box
    assert 'text="BUY"' in s and 'text="SELL"' in s


def test_durable_filter_defaults_seed_from_spec():
    for build in (reclaim_pine.build_reclaim_strategy, reclaim_pine.build_reclaim_indicator):
        s = build()
        assert f'input.int({spec.MIN_TOUCHES}, "Min touches' in s
        assert f'input.float({spec.MIN_GAP_PCT}, "Min % gap' in s
        assert f'input.float({spec.MIN_RR}, "Min R:R' in s


def test_durable_filter_gates_live_pivots_only():
    s = reclaim_pine.build_reclaim_indicator()
    # levels carry a touch count; only the durable subset feeds live-pivot mode
    assert "var int[]   supHits" in s and "var int[]   resHits" in s
    assert "f_qualified(sups, supHits)" in s and "f_qualified(ress, resHits)" in s
    # GEX mode bypasses the filter (already-durable levels)
    assert "supSet = useGex ? f_gexSide(true) : f_qualified(sups, supHits)" in s
    # distinct-visit touch counting (not once per consolidating bar)
    assert "inPrev = low[1] <= lv and high[1] >= lv" in s
    # spacing + R:R gates are ANDed into the signal conditions
    assert "and f_rrOk(longEntry, longStop, longTarget) and f_gapOk(longEntry)" in s
    assert "and f_rrOk(shortEntry, shortStop, shortTarget) and f_gapOk(shortEntry)" in s
    # spacing memory updates on every fired signal
    assert "lastSig := longEntry" in s and "lastSig := shortEntry" in s


def test_indicator_has_optional_gex_levels_input():
    # paste GEX levels -> trade ONLY those; blank -> live pivots (any symbol)
    s = reclaim_pine.build_reclaim_indicator()
    assert 'input.text_area("", "GEX / key levels' in s
    assert "f_parseLevels(" in s                 # parses the pasted list
    assert "useGex = array.size(gexLevels) > 0" in s
    # when GEX is on, the S/R sets come from the pasted list, not pivots
    assert "supSet = useGex ? f_gexSide(true) : f_qualified(sups, supHits)" in s
    assert "resSet = useGex ? f_gexSide(false) : f_qualified(ress, resHits)" in s
    # pivots are NOT accumulated in GEX mode
    assert "if not useGex and not na(pvH)" in s
    # entry/target geometry reads the selected set, not the raw pivot arrays
    assert "longTarget = f_nearestAbove(resSet)" in s
    assert "src = isLong ? resSet : supSet" in s


def test_both_scripts_share_the_gex_capable_core():
    # _core() is shared, so the strategy also gains GEX-mode level selection
    strat = reclaim_pine.build_reclaim_strategy()
    assert "supSet = useGex ?" in strat and "input.text_area" in strat


_SCAFFOLD = {"level_ladder": [
    {"price": 7548.0, "kind": "fib 61.8% + call wall", "source": "GEX"},
    {"price": 7529.0, "kind": "volume PoC (magnet)", "source": "chart"},
    {"price": 7517.0, "kind": "support (9x tested)", "source": "chart"},
    {"price": 7500.0, "kind": "max pain", "source": "GEX"},
    {"price": 7481.0, "kind": "gamma flip", "source": "GEX"},
    {"price": 7450.0, "kind": "put wall", "source": "GEX"},
    {"price": 7511.0, "kind": "fib 38.2%", "source": "chart"},        # excluded
    {"price": 7600.0, "kind": "round number", "source": "psych"},     # excluded
]}


def test_prefill_prefers_the_curated_playbook_table():
    # the playbook table is the already-balanced ~10-level mix (GEX + confluence
    # + durable keys) — the prefill must use IT, not re-derive from the raw
    # ladder (that's what cluttered the chart).
    sc = {
        "table": {"rows": [
            {"price": 7620.7, "label": "durable resistance ★21d", "role": "resistance"},
            {"price": 7555.1, "label": "round number + resistance (2x) ✦", "role": "resistance"},
            {"price": 7520.4, "label": "gamma flip + fib 78.6% ✦ ★10d", "role": "support"},
        ]},
        # a noisy ladder that must be IGNORED when the curated table exists
        "level_ladder": [{"price": p, "kind": "support (2x tested)", "source": "chart"}
                         for p in (7400.0, 7410.0, 7420.0, 7430.0, 7440.0)],
    }
    entries = reclaim_pine.gex_level_entries(sc)
    assert [p for p, _ in entries] == [7620.7, 7555.1, 7520.4]   # table only
    assert entries[0][1] == "durable resistance ★21d"            # rich label kept
    # and the baked default carries the curated labels
    s = reclaim_pine.build_reclaim_indicator_for("SPX", sc)
    assert "7620.7|durable resistance ★21d" in s
    assert "7400" not in s.split("gexInput")[1].split("\n")[0]   # ladder noise absent


def test_gex_levels_from_scaffold_keeps_durable_drops_transient():
    lv = reclaim_pine.gex_levels_from_scaffold(_SCAFFOLD)
    # GEX shelves + max-pain + tested S/R + volume PoC, high->low
    assert lv == [7548.0, 7529.0, 7517.0, 7500.0, 7481.0, 7450.0]
    # bare fib / round number are NOT baked in (too transient)
    assert 7511.0 not in lv and 7600.0 not in lv
    # no scaffold / no options gamma -> empty (falls back to pivots)
    assert reclaim_pine.gex_levels_from_scaffold({}) == []


def test_prefilled_indicator_bakes_levels_into_the_input():
    s = reclaim_pine.build_reclaim_indicator_for("SPX", _SCAFFOLD)
    # symbol-specific title
    assert 'indicator("Reclaim Strategy — SPX (GEX)"' in s
    # the durable levels are the input default, so it trades them on load
    # (price|label entries; prices are what the reclaim trades)
    assert 'input.text_area("7548|' in s
    for p in ("7548|", "7529|", "7517|", "7500|", "7481|", "7450|"):
        assert p in s
    # still the SAME gex-capable core (parse + useGex switch), not a fork
    assert "useGex = array.size(gexLevels) > 0" in s and "f_parseLevels(" in s


def test_prefilled_falls_back_to_pivots_without_gex():
    # a symbol with no options gamma: empty default -> generic live-pivot script
    s = reclaim_pine.build_reclaim_indicator_for("AAPL", {})
    assert 'input.text_area("", "GEX' in s
    assert "no GEX levels were available" in s          # honest header note
    # same gex-capable core + indicator tail as the generic build (not a fork)
    assert reclaim_pine._core("") in s
    assert reclaim_pine._indicator_tail() in s


def test_generic_indicator_unchanged_when_gex_default_blank():
    # the no-arg generic builder is exactly build_reclaim_indicator("")
    assert reclaim_pine.build_reclaim_indicator() == reclaim_pine.build_reclaim_indicator("")


def test_prefill_title_is_sanitized():
    # a messy symbol can't break the Pine indicator() string
    s = reclaim_pine.build_reclaim_indicator_for('SP"X', _SCAFFOLD)
    decl = [ln for ln in s.splitlines() if ln.startswith("indicator(")][0]
    assert decl.count('"') % 2 == 0        # balanced quotes, no stray "
    assert "SPX" in decl


def test_paper_uses_the_shared_spec():
    from vantage_server import paper
    # paper's constants ARE the spec's (imported, not redefined)
    assert paper.RECLAIM_CLOSES == spec.RECLAIM_CLOSES
    assert paper.STOP_PAD_PCT == spec.STOP_PAD_PCT
    assert paper.PENDING_EXPIRE_HOURS == spec.PENDING_EXPIRE_HOURS
