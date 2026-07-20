// Vantage — cross-account portfolio & market intelligence prototype.
// v2: sidebar navigation + hash-routed views (one job per screen).
import {
  NOTIF_TYPES, ALLOCATION_TARGETS, ASSET_CLASSES,
} from "./data.js";
import {
  usd, money, moneyByCcy, signUsd, signMoney, signPct, cls, dirCls, daysAgo, fmtDate, lotValue, lotUnrl, acctOf, registerAccounts,
  isOptionSym, isSleeveSym, underlyingOf,
  loadSettings, SETTINGS_KEY, StatTile, syncedAgo,
  useTheme, THEME_ICON, LoadBar,
} from "./util.jsx";
import { MiraRender } from "./mira-render.jsx";
import { NotebookPanel } from "./notebook.jsx";
import { PortfolioView } from "./portfolio_view.jsx";
import { OptionsView } from "./options.jsx";
import { PlaybookView } from "./playbook.jsx";
import { ScannerView } from "./scanner.jsx";
import { InstrumentChartCard } from "./chart_core.jsx";
import { ReplayPanel } from "./chart_replay_panel.jsx";
import { StrategiesView } from "./strategies_view.jsx";
import { ScannerSpreadBook } from "./paper.jsx";
import { TodayView } from "./today.jsx";
import { FuturesView } from "./futures.jsx";
import { JournalView } from "./journal.jsx";
import { TradeAnalyticsView } from "./trades.jsx";
import * as live from "./live.js";
import { useLive, mapPositions, mapTlh, mapAllocation, mapSignals, mapHistory, mapAnalysis } from "./live.js";

const { useState, useMemo, useEffect, useRef, useCallback } = React;
const { Navbar, Button, Modal, FormField, SecurityCard, FAQItem } = window.LookeyDS;

// Empty allocation shape (matches mapAllocation) — the no-demo fallback for the
// allocation fetch so the Dashboard renders an empty bar, never fixture weights.
const EMPTY_ALLOC = { byClass: { usEquity: 0, intlEquity: 0, bonds: 0, cash: 0 }, total: 0 };

/* ---------------- navigation ---------------- */
const NAV = [
  { group: "Portfolio", items: [
    { id: "portfolio", label: "Portfolio", icon: "🧭" },
    { id: "dashboard", label: "Dashboard", icon: "◫" },
    { id: "holdings", label: "Positions", icon: "▤" },
    { id: "tax", label: "Tax", icon: "🌾" },
  ]},
  { group: "Intelligence", items: [
    // Chart is the chart-first canvas — any instrument, our DNA layers, Mira's read.
    { id: "ic", label: "Chart", icon: "📈" },
    // Today is the trading half's front door: signals + why + honest record +
    // machine health, one screen (see claudedocs/goals/ux-feature-value).
    { id: "today", label: "Today", icon: "🎯" },
    { id: "options", label: "Options", icon: "◎" },
    { id: "playbook", label: "Daily plan", icon: "📐" },
    { id: "scanner", label: "Scanner", icon: "🔭" },
    { id: "strategies", label: "Strategies", icon: "🤖" },
    { id: "journal", label: "Trading Journal", icon: "📓" },
    { id: "futures", label: "Futures", icon: "📉" },
    { id: "trades", label: "Performance", icon: "🧮" },
  ]},
];
// Nav lists the five top-level views. These extra routes stay reachable as
// drill-downs (via row jumps / links) but are intentionally off the nav so the
// sidebar reads as a strategist's brief, not an operations console:
//   charts   — opened from a Positions row or an Action ("view chart")
//   activity — per-position transactions, reached from a holding
//   recs     — the full decision journal, reached from the Dashboard Actions "All →"
//   markets  — live pattern signals, reached from Market read links
// `paper` is a reachable drilldown route → the Strategies Track-record tab. (The
// signalbot/exits tabs + views were retired in the pipeline-only refactor.)
const DRILLDOWN_ROUTES = ["activity", "recs", "markets", "paper"];
const ROUTES = [...NAV.flatMap((g) => g.items.map((i) => i.id)), ...DRILLDOWN_ROUTES];

// Parses `#/route` and `#/route/param` (e.g. #/ic/NVDA → route "ic", param "NVDA").
// Deep-linkable: bookmark or share a specific symbol's chart. `param` is the raw
// second segment (uppercased for tickers); routes with no param get param=null.
function useHashRoute() {
  const parse = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const [r, ...rest] = h.split("/");
    const route = ROUTES.includes(r) ? r : "dashboard";
    const param = rest.length ? decodeURIComponent(rest.join("/")) : null;
    return { route, param };
  };
  const [state, setState] = useState(parse);
  useEffect(() => {
    const onHash = () => setState(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // go("ic", "NVDA") → #/ic/NVDA ; go("holdings") → #/holdings
  const go = (r, param) => {
    window.location.hash = param ? `/${r}/${encodeURIComponent(param)}` : `/${r}`;
    const center = document.getElementById("vg-center");
    if (center) center.scrollTo({ top: 0 });
  };
  return [state.route, go, state.param];
}

/* ---------------- app shell ---------------- */
function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [accountId, setAccountId] = useState(settings.defaultAccount);
  const [symbol, setSymbol] = useState("SPY");
  const [route, go, routeParam] = useHashRoute();
  const [notifs, setNotifs] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // NotebookLM-style collapsible side panels (component state; default from viewport).
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 860);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth >= 1100);
  // Focus mode: collapse BOTH panes so the chart owns the whole viewport. Remembers
  // the panes' prior open-state to restore on exit. Toggled by a button + the F key.
  const [focus, setFocus] = useState(false);
  const focusPrev = useRef({ left: true, right: true });
  const enterFocus = useCallback(() => {
    focusPrev.current = { left: leftOpen, right: rightOpen };
    setLeftOpen(false); setRightOpen(false); setFocus(true);
  }, [leftOpen, rightOpen]);
  const exitFocus = useCallback(() => {
    setLeftOpen(focusPrev.current.left); setRightOpen(focusPrev.current.right); setFocus(false);
  }, []);
  const toggleFocus = useCallback(() => { focus ? exitFocus() : enterFocus(); }, [focus, enterFocus, exitFocus]);
  // keyboard: F toggles focus mode, Esc exits it — but never while typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFocus(); }
      else if (e.key === "Escape" && focus) { e.preventDefault(); exitFocus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocus, exitFocus, focus]);
  // Resizable right pane: user-dragged width persisted to localStorage. Clamped
  // to a sane range; the .clps collapse rule (48px) still wins when collapsed.
  // Max is ~half the viewport (the Replay panel + comparison table want room).
  const RIGHT_MIN = 300;
  const rightMax = () => Math.min(1100, Math.round(window.innerWidth * 0.5));
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = Number(localStorage.getItem("vantage.rightWidth"));
    return saved >= RIGHT_MIN ? Math.min(saved, rightMax()) : 360;
  });
  const [resizing, setResizing] = useState(false);
  const startResize = (e) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startW = rightWidth;
    const onMove = (ev) => {
      // dragging left (smaller clientX) widens the right pane
      const next = Math.min(rightMax(), Math.max(RIGHT_MIN, startW + (startX - ev.clientX)));
      setRightWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      try { localStorage.setItem("vantage.rightWidth", String(rightWidthRef.current)); } catch (_) {}
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  // Keep a ref of the latest width so the mouseup closure persists the final value.
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;
  // Refresh wiring: a monotonically-bumped nonce that live-data fetchers depend
  // on, so a completed refresh re-pulls positions/rail without a page reload.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState({}); // {accountId|"all": true}
  const [refreshNote, setRefreshNote] = useState(null); // {tone, text} | null

  // Auto-collapse (never auto-expand) when the viewport shrinks past a breakpoint.
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mqRight = window.matchMedia("(max-width: 1099px)");
    const mqLeft = window.matchMedia("(max-width: 859px)");
    if (!mqRight.addEventListener) return undefined; // very old MediaQueryList API
    const onRight = (e) => { if (e.matches) setRightOpen(false); };
    const onLeft = (e) => { if (e.matches) setLeftOpen(false); };
    mqRight.addEventListener("change", onRight);
    mqLeft.addEventListener("change", onLeft);
    return () => { mqRight.removeEventListener("change", onRight); mqLeft.removeEventListener("change", onLeft); };
  }, []);

  // TLH candidates come only from the live engine — no demo fallback. Empty
  // until the backend responds (the Tax view shows an honest empty state).
  const tlh = useLive(() => live.tlh(settings).then(mapTlh), [], [settings], { blankOnOutage: true }).data;

  // Account scope rail: live /api/accounts only. No demo accounts — empty until
  // the backend responds, and blanks on a later outage (blankOnOutage).
  const scopeLive = useLive(
    () => live.accounts().then((p) => {
      if (!p || !p.accounts) return null;
      registerAccounts(p.accounts);
      return p.accounts.map((a) => ({
        id: a.id, short: a.short, type: a.type, value: a.value,
        currency: a.currency || "USD",
        lastSynced: a.last_synced, broker: a.broker, refreshable: a.refreshable,
        has_holdings: a.has_holdings, has_transactions: a.has_transactions,
      }));
    }),
    [],
    [settings, refreshNonce], // re-fetch the rail after a refresh completes
    { blankOnOutage: true },
  );
  const scopeAccounts = scopeLive.data;

  // Top market strip: live index band only (no demo ticker). Empty until the
  // quote feed responds; blanks on outage.
  const marketBand = useLive(() => live.quotes().then(live.mapMarketBand), null, [settings, refreshNonce]).data;
  const scopeOutage = scopeLive.outage;
  const unread = notifs.filter((n) => !n.read && settings.notifPrefs[n.type]).length;

  // -- refresh handlers: the ONLY writes the SPA issues. Read broker tools
  // only (the backend enforces it); any failure degrades to a quiet note and
  // never throws. On success we bump refreshNonce so the rail + positions
  // re-fetch without a page reload.
  const summarizeRefresh = (payload) => {
    if (!payload || !payload.results) {
      return { tone: "warn", text: "Refresh failed — backend unreachable." };
    }
    const parts = [];
    let anyError = false;
    for (const r of payload.results) {
      if (r.errors && r.errors.length) { anyError = true; parts.push(`${r.account}: ${r.errors[0]}`); continue; }
      if (r.csv_only) { parts.push(`${r.account}: ${r.message}`); continue; }
      const label = r.broker ? r.broker[0].toUpperCase() + r.broker.slice(1) : r.account;
      parts.push(`${label}: ${r.positions} positions, ${r.new_transactions} new transactions`);
    }
    return { tone: anyError ? "warn" : "ok", text: parts.join(" · ") || "Nothing to refresh." };
  };
  const runRefresh = async (key, fetcher) => {
    setRefreshing((s) => ({ ...s, [key]: true }));
    setRefreshNote(null);
    const payload = await fetcher();
    setRefreshing((s) => { const n = { ...s }; delete n[key]; return n; });
    setRefreshNote(summarizeRefresh(payload));
    if (payload && payload.results) setRefreshNonce((n) => n + 1); // re-pull live data
  };
  const onRefreshAccount = (id) => runRefresh(id, () => live.refreshAccount(id));
  const onRefreshAll = () => runRefresh("all", () => live.refreshAll());

  const saveSettings = (next) => {
    setSettings(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
  };

  const viewProps = { accountId, setAccountId, symbol, setSymbol, settings, tlh, go, setNotifOpen, refreshNonce };
  // The Dashboard "Accounts today" section reuses the live account rail + its
  // refresh handlers so "how is each account doing" is answered in the brief,
  // not only in the scope selector.
  const dashProps = { scopeAccounts, scopeOutage, refreshing, refreshNote, onRefreshAccount, onRefreshAll };
  // Replay (chart-first): the run selection + which call is highlighted are shared
  // between the chart overlay (center) and the ReplayPanel (right pane). `replayOn`
  // makes the right pane show the panel and the chart draw the run's markers.
  const [replayOn, setReplayOn] = useState(false);
  const [replayRunId, setReplayRunId] = useState(null);
  const [activeCallId, setActiveCallId] = useState(null);
  // "Forecast now" from the chart shares the Replay panel: bumping this counter
  // tells the panel to auto-fire a fresh forward forecast (see ReplayPanel).
  const [forecastNowSignal, setForecastNowSignal] = useState(0);
  // bumped by the panel once a forecast is saved → the chart re-fetches its latest
  // forecast and enables the Forecast layer so the projected path draws.
  const [forecastSavedNonce, setForecastSavedNonce] = useState(0);
  // the Replay panel takes over the right pane on the chart route when active.
  const showReplayPanel = route === "ic" && replayOn;
  // the chart-first route: the instrument the chart is showing (URL param → SPX).
  const icSymbol = route === "ic" ? (routeParam || "SPX").toUpperCase() : null;
  // keep the shared `symbol` in sync with the chart route so the right-pane
  // Notebook reads THIS chart's instrument (Mira reading the chart in front of you).
  useEffect(() => { if (icSymbol) setSymbol(icSymbol); }, [icSymbol]);
  // reset the replay selection when leaving the chart route or changing instrument —
  // a run is symbol+day specific, so it shouldn't linger onto another chart.
  useEffect(() => {
    if (route !== "ic") { setReplayOn(false); setReplayRunId(null); setActiveCallId(null); }
  }, [route]);
  useEffect(() => { setReplayRunId(null); setActiveCallId(null); }, [icSymbol]);

  return (
    <div className="vg-app">
      <div className="vg-compliance">
        AI-generated analysis · Educational purposes only — not financial, investment, or tax advice
      </div>

      {/* terminal topbar: brand · market segments · status · theme · settings */}
      <div className="vg-topbar">
        <div className="brand">Vantage</div>
        <div className="vg-ticker" style={{ flex: 1, borderBottom: "none" }}>
          {marketBand && marketBand.indexes.map((t) => (
            <span className="vg-tick" key={t.sym}>
              <span className="vg-note" style={{ textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10 }}>{t.label}</span>
              <b>{t.price != null ? t.price.toFixed(2) : "—"}</b>
              <span className={dirCls(t.dayPct)}>{signPct(t.dayPct)}</span>
            </span>
          ))}
        </div>
        <span style={{ padding: "0 14px" }}><LiveStatusDots settings={settings} /></span>
        <div className="tools">
          <button className="tbtn vg-topbar-bell" onClick={() => setNotifOpen(true)}
            aria-label="Notifications">🔔{unread > 0 && <span className="vg-bell-cnt">{unread}</span>}</button>
          <button className={cls("tbtn", focus && "on")} onClick={toggleFocus}
            title={focus ? "Exit focus (Esc)" : "Focus chart — hide panels (F)"}
            aria-label="Toggle focus mode">{focus ? "⤢ Exit" : "⤢ Focus"}</button>
          <ThemeButton />
          <button className="tbtn" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </div>

      <div className={cls("vg-studio", (leftOpen || rightOpen) && "drawer-open")}>
        {/* mobile-only backdrop: tapping it closes whichever drawer is open. A real
            element (not a ::after) so the tap has a reliable target. CSS hides it
            >820px and when no drawer is open. */}
        <div className="vg-mob-backdrop" onClick={() => { setLeftOpen(false); setRightOpen(false); }}
          aria-hidden="true" />
        {/* -------- left pane: nav + account scope -------- */}
        <aside className={cls("vg-pane", "vg-pane-left", !leftOpen && "clps")}>
          <div className="vg-pane-top">
            {leftOpen && <span className="vg-kicker" style={{ marginBottom: 0 }}>Workspace</span>}
            <button className="vg-collapse" title={leftOpen ? "Collapse panel" : "Expand panel"}
              aria-label={leftOpen ? "Collapse navigation panel" : "Expand navigation panel"}
              onClick={() => setLeftOpen(!leftOpen)}>
              {leftOpen ? "«" : "»"}
            </button>
          </div>
          <div className="vg-pane-body">
            <nav>
              {NAV.map((g) => (
                <div key={g.group}>
                  {leftOpen && <div className="vg-kicker" style={{ margin: "10px 8px 4px" }}>{g.group}</div>}
                  {g.items.map((it) => (
                    <button key={it.id} title={it.label}
                      className={cls("vg-navitem", route === it.id && "sel")} onClick={() => go(it.id)}>
                      <span className="ic">{it.icon}</span>
                      {leftOpen && <>
                        {it.label}
                        {it.id === "tax" && tlh.some((c) => c.status === "clear") && <span className="vg-navdot" />}
                      </>}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            {leftOpen && (
              <div>
                <div className="vg-divider" />
                {/* The account list + scope selector now live in Portfolio (the
                    "Accounts" card manages linking/importing/scoping). The scope
                    chip below shows the current scope + a jump there. */}
                <button className="vg-scope-chip" onClick={() => go("portfolio")}
                  title="Manage accounts + scope in Portfolio">
                  <span className="vg-kicker" style={{ margin: 0 }}>Scope</span>
                  <span className="bal">{accountId === "all" ? "All accounts"
                    : (scopeAccounts.find((a) => a.id === accountId)?.short || accountId)}</span>
                  <span className="vg-note">accounts →</span>
                </button>
                <p className="vg-note" style={{ marginTop: 10, padding: "0 4px" }}>
                  Read-only aggregation. Vantage never holds funds or places orders.
                </p>
                <p className="vg-note" style={{ marginTop: 8, padding: "0 4px" }}>
                  Vantage · built on the Lookey design system · AI analysis is educational
                  only — not financial, investment, or tax advice.
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* -------- center pane: routed view -------- */}
        <main id="vg-center" className="vg-pane vg-pane-center">
          {route === "portfolio" && (
            <PortfolioView accountId={accountId} setAccountId={setAccountId}
              scopeAccounts={scopeAccounts} refreshing={refreshing}
              onRefreshAccount={onRefreshAccount} onRefreshAll={onRefreshAll}
              onAccountsChanged={() => setRefreshNonce((n) => n + 1)} />)}
          {route === "dashboard" && <DashboardView {...viewProps} {...dashProps} notifs={notifs} />}
          {route === "holdings" && <HoldingsView {...viewProps} />}
          {route === "activity" && <ActivityView {...viewProps} />}
          {route === "tax" && <TaxView {...viewProps} />}
          {route === "recs" && <RecsView {...viewProps} />}
          {route === "markets" && <MarketsView {...viewProps} />}
          {route === "options" && <OptionsView accountId={accountId} setSymbol={setSymbol} go={go} />}
          {route === "today" && <TodayView refreshNonce={refreshNonce} />}
          {route === "playbook" && <PlaybookView refreshNonce={refreshNonce} />}
          {route === "scanner" && <ScannerView onOpenSymbol={(sym) => { setSymbol(sym); go("ic", sym); }} />}
          {route === "strategies" && (
            <StrategiesView tab={routeParam} refreshNonce={refreshNonce}
              onTab={(k) => go("strategies", k === "lifecycle" ? "" : k)} />)}
          {/* legacy #paper hash → the Strategies Track-record tab (signalbot/exits
              tabs were retired; their views are gone). */}
          {route === "paper" && (
            <StrategiesView tab={route} refreshNonce={refreshNonce}
              onTab={(k) => go("strategies", k === "lifecycle" ? "" : k)} />)}
          {route === "journal" && <JournalView refreshNonce={refreshNonce} />}
          {route === "futures" && <FuturesView refreshNonce={refreshNonce} />}
          {route === "trades" && <TradeAnalyticsView {...viewProps} />}
          {route === "ic" && (
            <div className="vg-ic-route">
              <InstrumentChartCard symbol={icSymbol} height="100%"
                replayActive={replayOn} replayRunId={replayRunId}
                forecastNonce={forecastSavedNonce}
                activeCallId={activeCallId} setActiveCallId={setActiveCallId}
                onOpenSymbol={(s) => go("ic", s)}
                onReplayToggle={() => {
                  const next = !replayOn;
                  setReplayOn(next);
                  if (next) setRightOpen(true);          // reveal the panel
                  else { setReplayRunId(null); setActiveCallId(null); }
                }}
                onForecastNow={() => {
                  // open the Replay panel and tell it to auto-run a live forecast
                  setReplayOn(true); setRightOpen(true);
                  setForecastNowSignal((n) => n + 1);
                }} />
            </div>)}
        </main>

        {/* -------- right pane: per-ticker Notebook (default) / chart rail / chat -------- */}
        <aside className={cls("vg-pane", "vg-pane-right", !rightOpen && "clps", resizing && "resizing")}
          style={rightOpen ? { width: rightWidth } : undefined}>
          {rightOpen && (
            <div className="vg-resize-handle" onMouseDown={startResize}
              title="Drag to resize" role="separator" aria-orientation="vertical"
              aria-label="Resize notebook panel" />
          )}
          <div className="vg-pane-top">
            <button className="vg-collapse" title={rightOpen ? "Collapse panel" : "Expand panel"}
              aria-label={rightOpen ? "Collapse notebook panel" : "Expand notebook panel"}
              onClick={() => setRightOpen(!rightOpen)}>
              {rightOpen ? "»" : "«"}
            </button>
            {rightOpen && (
              <span className="vg-kicker" style={{ marginBottom: 0 }}>
                {showReplayPanel ? "⟲ Replay" : symbol ? "Notebook" : "Vantage AI"}
              </span>
            )}
            {rightOpen && showReplayPanel && (
              <button className="vg-linkbtn" style={{ marginLeft: "auto" }}
                title="Back to the Notebook"
                onClick={() => { setReplayOn(false); setReplayRunId(null); setActiveCallId(null); }}>
                notebook →</button>
            )}
          </div>
          {!rightOpen && <span className="vg-sparkle" aria-hidden="true">✦</span>}
          {rightOpen && (showReplayPanel
            ? <ReplayPanel symbol={icSymbol} runId={replayRunId} setRunId={setReplayRunId}
                activeCallId={activeCallId} setActiveCallId={setActiveCallId}
                forecastSignal={forecastNowSignal}
                onForecastSaved={() => setForecastSavedNonce((n) => n + 1)} />
            : symbol
              ? <NotebookPanel symbol={symbol} accountId={accountId} refreshNonce={refreshNonce} />
              : <ChatPanel docked settings={settings} />)}
        </aside>
      </div>
      {/* mobile-only drawer handles (CSS hides them >820px). Each opens its drawer
          and closes the other, so only one overlay shows at a time. Hidden in focus. */}
      {!focus && (
        <div className="vg-mob-handles">
          <button className="vg-mob-handle"
            onClick={() => { setLeftOpen(!leftOpen); setRightOpen(false); }}>
            ☰ Menu
          </button>
          <button className="vg-mob-handle"
            onClick={() => { setRightOpen(!rightOpen); setLeftOpen(false); }}>
            ✦ Mira
          </button>
        </div>
      )}

      <div className="vg-fabs">
        <button className="vg-fab" aria-label="Notifications" onClick={() => setNotifOpen(true)}>
          🔔{unread > 0 && <span className="cnt">{unread}</span>}
        </button>
        {!rightOpen && (
          <button className="vg-fab" aria-label="Vantage AI chat" onClick={() => setChatOpen(true)}>💬</button>
        )}
      </div>

      {notifOpen && (
        <NotifPanel notifs={notifs} setNotifs={setNotifs} settings={settings} saveSettings={saveSettings}
          onClose={() => setNotifOpen(false)} />
      )}
      {chatOpen && <ChatPanel settings={settings} onClose={() => setChatOpen(false)} />}
      {settingsOpen && (
        <SettingsModal settings={settings} accounts={scopeAccounts} onSave={(s) => { saveSettings(s); setSettingsOpen(false); }}
          onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

/* ---------------- theme toggle (system → dark → light) ---------------- */
function ThemeButton() {
  const [theme, cycle] = useTheme();
  const label = theme === "system" ? "System theme" : theme === "dark" ? "Dark theme" : "Light theme";
  return (
    <button className="tbtn" onClick={cycle} title={`${label} — click to switch`}
      aria-label={`Theme: ${theme}. Click to switch.`}>
      {THEME_ICON[theme]} {theme}
    </button>
  );
}

/* ---------------- live/demo status dots (Phase V4) ---------------- */
function LiveStatusDots({ settings }) {
  const [st, setSt] = useState({ backend: null, mira: null });
  useEffect(() => {
    let alive = true;
    live.health().then((h) => { if (alive) setSt((s) => ({ ...s, backend: h })); });
    if (settings.aiBackend === "mira") {
      live.miraHealth().then((h) => { if (alive) setSt((s) => ({ ...s, mira: h })); });
    }
    return () => { alive = false; };
  }, [settings]);
  const dot = (ok) => ({
    display: "inline-block", width: 7, height: 7, borderRadius: "50%", marginRight: 5,
    background: ok ? "var(--vg-up)" : "var(--vg-faint)",
  });
  const aiOff = settings.aiBackend !== "mira";
  return (
    <span className="vg-note" style={{ display: "inline-flex", gap: 14, alignItems: "center", whiteSpace: "nowrap" }}>
      <span title={st.backend
        ? `Backend live at ${settings.backendUrl} — quotes: ${st.backend.source}${st.backend.stale ? " (stale)" : ""}, as of ${st.backend.as_of}`
        : `Backend unreachable at ${settings.backendUrl} — showing demo fixtures`}>
        <span style={dot(st.backend)} />data {st.backend ? "live" : "demo"}
      </span>
      <span title={aiOff
        ? "AI backend set to Off in Settings — canned demo replies"
        : st.mira ? `Mira reachable at ${settings.miraUrl}` : `Mira unreachable at ${settings.miraUrl} — canned demo replies`}>
        <span style={dot(!aiOff && st.mira)} />AI {aiOff ? "off" : st.mira ? "live" : "demo"}
      </span>
    </span>
  );
}

/* ================= Overview ================= */
// Build the prioritized Action Queue from live sources — the answer to
// "what needs me today?". Three real inputs, one sorted list:
//   • decision journal (/api/analysis): CLOSE_AND_BOOK_LOSS, HOLD_AND_SELL_CALL
//   • TLH engine: harvest-ready (clear) loss lots past threshold
//   • allocation drift: any asset class ≥3pts off target (all-accounts scope)
// MONITOR/below-threshold/na items are NOT actions and never appear here.
// Each action carries an urgency weight (lower = more urgent) and a jump target.
function buildActionQueue({ decisions, tlh, alloc, totalValue, accountId, settings, go, setSymbol }) {
  const jumpChart = (sym) => { const u = underlyingOf(sym); setSymbol(u); go("ic", u); };
  const out = [];

  for (const d of decisions) {
    if (d.recommendation === "CLOSE_AND_BOOK_LOSS") {
      out.push({
        key: `close-${d.symbol}`, weight: 0, tone: "bad", chip: "CLOSE & BOOK LOSS",
        title: `${d.symbol} — ${recDetail(d)}`, sub: d.rationale || "", onJump: () => jumpChart(d.symbol),
      });
    } else if (d.recommendation === "HOLD_AND_SELL_CALL") {
      out.push({
        key: `call-${d.symbol}`, weight: 1, tone: "info", chip: "SELL CALL",
        title: `${d.symbol} — ${recDetail(d)}`, sub: d.rationale || "", onJump: () => jumpChart(d.symbol),
      });
    }
  }

  // Harvest-ready TLH lots the journal didn't already flag as CLOSE (dedupe by symbol).
  const closeSyms = new Set(out.filter((a) => a.key.startsWith("close-")).map((a) => a.key.slice(6)));
  const bySym = {};
  for (const c of tlh) {
    if (c.status !== "clear" || closeSyms.has(c.lot.symbol)) continue;
    const g = (bySym[c.lot.symbol] ||= { sym: c.lot.symbol, loss: 0, replacement: c.replacement });
    g.loss += -c.unrl;
  }
  for (const g of Object.values(bySym)) {
    const benefit = g.loss * (settings.taxRate / 100);
    out.push({
      key: `harvest-${g.sym}`, weight: 2, tone: "good", chip: "HARVEST",
      title: `${g.sym} — harvest ${usd(g.loss)} loss ≈ ${usd(benefit)} benefit`,
      sub: g.replacement ? `Replace with ${g.replacement} to hold exposure and avoid a wash.` : "Wash-clear in taxable accounts.",
      onJump: () => go("tax"),
    });
  }

  // Allocation drift (portfolio-level only, like the legend badges).
  if (accountId === "all" && totalValue > 0) {
    for (const [k, m] of Object.entries(ASSET_CLASSES)) {
      const pct = (alloc.byClass[k] / totalValue) * 100;
      const drift = pct - ALLOCATION_TARGETS[k];
      if (Math.abs(drift) >= 3) {
        out.push({
          key: `drift-${k}`, weight: 3, tone: drift > 0 ? "warn" : "info", chip: "REBALANCE",
          title: `${m.label} ${signPct(drift, 1)} vs target (${pct.toFixed(1)}% / ${ALLOCATION_TARGETS[k]}%)`,
          sub: drift > 0 ? "Overweight — trim on the next contribution." : "Underweight — direct new cash here.",
          onJump: () => go("holdings"),
        });
      }
    }
  }

  return out.sort((a, b) => a.weight - b.weight);
}

function DashboardView({
  accountId, setAccountId, settings, tlh, go, setSymbol, refreshNonce,
  scopeAccounts, scopeOutage, refreshing, refreshNote, onRefreshAccount, onRefreshAll,
}) {
  // Live engine only — empty fallbacks, no demo. blankOnOutage keeps the app
  // honest: an outage shows an empty book, never fabricated positions.
  const posLive = useLive(() => live.positions(accountId).then(mapPositions), [], [accountId, settings, refreshNonce], { blankOnOutage: true });
  const allocLive = useLive(() => live.allocation(accountId).then(mapAllocation), EMPTY_ALLOC, [accountId, settings, refreshNonce], { blankOnOutage: true });
  const pos = posLive.data;
  const alloc = allocLive.data;
  const dashLoading = posLive.loading || allocLive.loading;   // any primary account fetch in flight

  // Q1 — market today: live index band + Mira's market read (both may be null → fallbacks).
  const band = useLive(() => live.quotes().then(live.mapMarketBand), null, [settings, refreshNonce]).data;
  const miraOn = settings.aiBackend === "mira";
  const report = useLive(() => (miraOn ? live.getInsights().then(live.mapInsights) : null), null, [settings]).data;

  // Q4 — actions: the live decision journal drives the queue.
  const analysis = useLive(() => live.getAnalysis().then(mapAnalysis), null, [settings, refreshNonce]).data;
  const decisions = (analysis && analysis.decisions) || [];

  const totalValue = alloc.total;  // USD base (allocation.total is USD-only)
  const byCurrency = alloc.byCurrency || { USD: totalValue };
  const isMixed = Object.keys(byCurrency).filter((k) => byCurrency[k] !== 0).length > 1;
  // P/L grouped by the position's currency — never summed across currencies.
  const dayPlByCcy = pos.reduce((m, p) => { const c = p.currency || "USD"; m[c] = (m[c] || 0) + p.dayPl; return m; }, {});
  const unrlPlByCcy = pos.reduce((m, p) => { const c = p.currency || "USD"; m[c] = (m[c] || 0) + p.unrl; return m; }, {});
  const dayPl = dayPlByCcy.USD || 0;   // USD-scope for the delta % (US book)
  const unrlPl = unrlPlByCcy.USD || 0;
  const harvestable = tlh.filter((c) => c.status === "clear");  // TLH is US-only (gated server-side)
  const harvestableLoss = harvestable.reduce((s, c) => s + -c.unrl, 0);
  const estBenefit = harvestableLoss * (settings.taxRate / 100);
  const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;

  const actions = buildActionQueue({ decisions, tlh, alloc, totalValue, accountId, settings, go, setSymbol });

  return (
    <div className="vg-loadhost">
      {dashLoading && <LoadBar />}
      <div className="vg-spread">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Dashboard</h2>
          <p className="vg-sub">{acctLabel} · your morning brief · marked to last close</p>
        </div>
      </div>

      {/* ---------- Q1 · How is the market doing today? ---------- */}
      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-spread">
          <div className="vg-kicker" style={{ marginBottom: 0 }}>Market today</div>
          {band && (
            <span className="vg-note">
              {band.source === "fixture" ? "demo feed" : band.source}{band.stale ? " · stale" : ""}
              {band.asOf ? ` · ${band.asOf}` : ""}
            </span>
          )}
        </div>
        {band ? (
          <>
            <div className="vg-marketband" style={{ marginTop: 12 }}>
              {band.indexes.map((ix) => (
                <div className="vg-idx" key={ix.sym}>
                  <div className="vg-idx-name">{ix.label}</div>
                  <div className="vg-idx-price">{ix.price != null ? ix.price.toFixed(2) : "—"}</div>
                  <div className={cls("vg-idx-pct", dirCls(ix.dayPct))}>{signPct(ix.dayPct)}</div>
                </div>
              ))}
            </div>
            <p className="vg-note" style={{ marginTop: 10 }}>{band.regime}.</p>
          </>
        ) : (
          <p className="vg-note" style={{ marginTop: 12 }}>
            Market data unavailable — start the backend to see live index levels.
          </p>
        )}
        {report && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--color-border, #e5e7eb)", paddingTop: 12 }}>
            <div className="vg-spread">
              <div className="vg-kicker" style={{ marginBottom: 0 }}>Mira advisor read</div>
              <span className="vg-row">
                <span className="vg-badge good">● live</span>
                {report.confidence && <span className="vg-note">confidence {report.confidence}</span>}
              </span>
            </div>
            {report.summary && <p style={{ fontSize: 14, lineHeight: 1.55, margin: "10px 0" }}>{report.summary}</p>}
            {report.observations.length > 0 && (
              <div className="vg-advisor-reads">
                {report.observations.map((o, i) => (
                  <div key={i} className="vg-advisor-read">
                    <div className="vg-advisor-topic">{o.topic}</div>
                    <div className="vg-advisor-detail">
                      {o.detail}
                      {o.source && <span className="vg-advisor-src">{o.source}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {report.suggestions.length > 0 && (
              <ul className="vg-suggestions" style={{ marginTop: 10 }}>
                {report.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
            {report.caveats && <p className="vg-note" style={{ marginTop: 8 }}>{report.caveats}</p>}
          </div>
        )}
      </div>

      {/* ---------- Q2 · How is my portfolio doing today? ---------- */}
      <div className="vg-kicker" style={{ margin: "20px 2px 6px" }}>Portfolio today</div>
      <div className="vg-stats">
        <StatTile label="Total value" value={isMixed ? moneyByCcy(byCurrency) : usd(totalValue)} />
        <StatTile label="Day P/L" value={isMixed ? Object.keys(dayPlByCcy).sort().map((c)=>signMoney(dayPlByCcy[c],c)).join(" · ") : signUsd(dayPl)} deltaDir={dirCls(dayPl)}
          delta={totalValue ? signPct((dayPl / (totalValue - dayPl)) * 100) : ""} />
        <StatTile label="Unrealized P/L" value={isMixed ? Object.keys(unrlPlByCcy).sort().map((c)=>signMoney(unrlPlByCcy[c],c)).join(" · ") : signUsd(unrlPl)} deltaDir={dirCls(unrlPl)}
          delta={totalValue ? signPct((unrlPl / (totalValue - unrlPl)) * 100) : ""} />
        <StatTile label="Harvestable losses" value={usd(harvestableLoss)}
          note={`≈ ${usd(estBenefit)} est. benefit at ${settings.taxRate}%`} />
      </div>

      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-spread">
          <strong style={{ fontSize: 14.5 }}>Allocation by asset class</strong>
          <span className="vg-note">target 70 / 10 / 15 / 5</span>
        </div>
        <div className="vg-allocbar" style={{ marginTop: 12 }} role="img" aria-label="Asset allocation">
          {Object.entries(ASSET_CLASSES).map(([k, m]) => {
            const pct = totalValue ? (alloc.byClass[k] / totalValue) * 100 : 0;
            return pct > 0 && <span key={k} style={{ width: `${pct}%`, background: m.color }} title={`${m.label} ${pct.toFixed(1)}%`} />;
          })}
        </div>
        <div className="vg-legend">
          {Object.entries(ASSET_CLASSES).map(([k, m]) => {
            const pct = totalValue ? (alloc.byClass[k] / totalValue) * 100 : 0;
            const drift = pct - ALLOCATION_TARGETS[k];
            return (
              <span key={k}>
                <span className="sw" style={{ background: m.color }} />
                {m.label} <span className="num">{pct.toFixed(1)}%</span>{" "}
                {accountId === "all" && Math.abs(drift) >= 3 && (
                  <span className={cls("vg-badge", drift > 0 ? "warn" : "info")}>{signPct(drift, 1)} vs target</span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* ---------- Q3 · How are my accounts doing today? ---------- */}
      <div className="vg-spread" style={{ margin: "20px 2px 6px" }}>
        <div className="vg-kicker" style={{ marginBottom: 0 }}>Accounts today</div>
        <button className={cls("vg-refresh", refreshing.all && "spinning")} title="Refresh all accounts"
          aria-label="Refresh all accounts" disabled={!!refreshing.all} onClick={onRefreshAll}>
          <span className="ic">⟳</span> <span style={{ fontSize: 12 }}>refresh all</span>
        </button>
      </div>
      {scopeAccounts.length === 0 ? (
        <div className="vg-card">
          <p className="vg-note" style={{ margin: 0 }}>
            {scopeOutage ? "Backend unreachable — no accounts to show." : "No linked accounts yet — import a broker."}
          </p>
        </div>
      ) : (
        <div className="vg-acctgrid">
          {scopeAccounts.map((a) => {
            const csvOnly = a.refreshable === false;
            const pending = !!refreshing[a.id];
            return (
              <div key={a.id} className={cls("vg-acctcard", accountId === a.id && "sel")}>
                <button className="vg-acctcard-main" onClick={() => setAccountId(a.id)} title={`Scope to ${a.short}`}>
                  <div className="vg-acctcard-name">{a.short}</div>
                  <div className="vg-acctcard-val">{money(a.value, a.currency || "USD")}</div>
                  <div className="vg-note">{a.type}{a.lastSynced !== undefined ? ` · synced ${syncedAgo(a.lastSynced)}` : ""}</div>
                </button>
                <button className={cls("vg-refresh", pending && "spinning")}
                  title={csvOnly ? "re-import CSV to refresh — no live API" : `Refresh ${a.short}`}
                  aria-label={`Refresh ${a.short}`} disabled={pending || csvOnly}
                  onClick={(e) => { e.stopPropagation(); if (!csvOnly) onRefreshAccount(a.id); }}>
                  <span className="ic">⟳</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {refreshNote && (
        <p className="vg-note" style={{ marginTop: 8, color: refreshNote.tone === "warn" ? "var(--color-grey)" : undefined }}>
          {refreshNote.text}
        </p>
      )}

      {/* ---------- Q4 · Are there any actions I need to take? ---------- */}
      <div className="vg-spread" style={{ margin: "20px 2px 6px" }}>
        <div className="vg-kicker" style={{ marginBottom: 0 }}>Actions{actions.length ? ` (${actions.length})` : ""}</div>
        <button className="vg-linkbtn" onClick={() => go("recs")}>All recommendations →</button>
      </div>
      {actions.length === 0 ? (
        <div className="vg-card">
          <p className="vg-note" style={{ margin: 0 }}>
            {analysis
              ? "Nothing needs you today — no close, covered-call, harvest, or rebalance actions. Monitoring the rest."
              : "The decision journal is empty or the backend is unreachable. Run the nightly analysis and confirm the backend URL in Settings."}
          </p>
        </div>
      ) : (
        <div className="vg-actionq">
          {actions.map((a) => (
            <div key={a.key} className="vg-action" onClick={a.onJump} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") a.onJump(); }}>
              <span className={cls("vg-badge", a.tone)} style={{ flexShrink: 0 }}>{a.chip}</span>
              <div style={{ minWidth: 0 }}>
                <div className="vg-action-title">{a.title}</div>
                {a.sub && <div className="vg-note">{a.sub}</div>}
              </div>
              <span className="vg-action-go" aria-hidden="true">→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= Holdings ================= */
// Compact recommendation for a Holdings row — the same chip vocabulary as the
// Recommendations view, plus a one-line detail; clicking jumps to AI Charts.
function HoldingRec({ d, onOpen }) {
  if (!d) return <span className="vg-note">—</span>;
  const rec = REC_CHIP[d.recommendation] || { cls: "plain", text: d.recommendation };
  const a = d.action || {};
  let detail = "";
  if (d.recommendation === "HOLD_AND_SELL_CALL" && a.suggestedStrike != null) {
    detail = `sell ${Number(a.suggestedStrike).toFixed(2)}C ~${usd(a.estCredit || 0)}`;
  } else if (d.recommendation === "CLOSE_AND_BOOK_LOSS" && a.unrealizedLoss != null) {
    detail = `book ${signUsd(a.unrealizedLoss)}`;
  } else if (d.recommendation === "HOLD_WASH_BLOCKED") {
    detail = a.washClearsOn ? `clears ${a.washClearsOn}` : "wash-blocked";
  }
  return (
    <span title={d.rationale || ""}
      onClick={(e) => { e.stopPropagation(); onOpen && onOpen(d.symbol); }}
      style={{ cursor: onOpen ? "pointer" : "default" }}>
      <span className={cls("vg-badge", rec.cls)}>{rec.text}</span>
      {detail && <span className="vg-note" style={{ marginLeft: 6 }}>{detail}</span>}
    </span>
  );
}

const HOLD_SORTS = {
  action: { label: "Action priority", key: (p) => REC_ORDER[p._rec?.recommendation] ?? 9, dir: 1 },
  value:  { label: "Value",           key: (p) => p.value,      dir: -1 },
  unrl:   { label: "Unrealized",      key: (p) => p.unrl,       dir: -1 },
  weight: { label: "Weight",          key: (p) => p.weight,     dir: -1 },
  day:    { label: "Day P/L",         key: (p) => p.dayPl || 0, dir: -1 },
  symbol: { label: "Symbol",          key: (p) => p.symbol,     dir: 1 },
};

// A short option-leg label from a position symbol ("PLTR 2026-10-16 120C" ->
// "$120C Oct 16") for the grouped leg sub-rows.
function optionLegLabel(sym) {
  // symbol shape: "UND YYYY-MM-DD STRIKE[C|P]"
  const m = /^(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)([CP])$/.exec(sym);
  if (!m) return sym;
  const [, , exp, strike, cp] = m;
  return `$${Number(strike).toFixed(0)}${cp} ${fmtDate(exp)}`;
}
// Match key for pairing an option position row to its leg-action:
// "strike|expiration|optiontype" (no side — the position symbol lacks it).
function optionMatchKeyFrom(strike, expiration, optionType) {
  return `${Number(strike)}|${expiration}|${(optionType || "").toLowerCase()}`;
}
function optionMatchKey(sym) {
  const m = /^(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)([CP])$/.exec(sym);
  if (!m) return sym.toUpperCase();
  const [, , exp, strike, cp] = m;
  return optionMatchKeyFrom(strike, exp, cp === "C" ? "call" : "put");
}

function HoldingsView({ accountId, settings, go, setSymbol, refreshNonce }) {
  const [expanded, setExpanded] = useState({});   // keyed by underlying group id
  const [sortKey, setSortKey] = useState("value");
  const [recFilter, setRecFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all"); // all | equity | option | losers
  const [query, setQuery] = useState("");

  const pos = useLive(() => live.positions(accountId).then(mapPositions), [], [accountId, settings, refreshNonce], { blankOnOutage: true }).data;
  // Journal decisions indexed by underlying — the group inherits its underlying's
  // read; each option leg gets its own leg-action from decision.legActions.
  const analysis = useLive(() => live.getAnalysis().then(mapAnalysis), null, [settings, refreshNonce]).data;
  const byUnderlying = useMemo(() => {
    const m = {};
    for (const d of (analysis?.decisions || [])) m[underlyingOf(d.symbol)] = d;
    return m;
  }, [analysis]);

  const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;

  // Group flat positions by underlying: each group = the equity position (if any)
  // + every option-contract position for that ticker. Combined totals on the
  // header; per-leg actions matched from the decision's legActions.
  const groups = useMemo(() => {
    const by = {};
    for (const p of pos) {
      if (p.symbol === "CASH") continue;
      const key = underlyingOf(p.symbol);
      const g = (by[key] ||= { key, equity: null, options: [], sleeve: null,
                               value: 0, dayPl: 0, unrl: 0, weight: 0,
                               currency: p.currency || "USD" });
      if (isOptionSym(p.symbol)) g.options.push(p);
      else if (p.symbol === "CRYPTO" || p.symbol === "FUTURES") g.sleeve = p;
      else g.equity = p;
      g.value += p.value || 0;
      g.dayPl += p.dayPl || 0;
      g.unrl += p.unrl || 0;
      g.weight += p.weight || 0;
    }
    let list = Object.values(by).map((g) => {
      const rec = byUnderlying[g.key] || null;
      // index leg actions by occSymbol AND by strike|exp|type (the position
      // symbol carries no long/short, so the fallback key omits side).
      const legActs = {};
      for (const a of (rec?.legActions || [])) {
        if (a.occSymbol) legActs[a.occSymbol.toUpperCase()] = a;
        legActs[optionMatchKeyFrom(a.strike, a.expiration, a.optionType)] = a;
      }
      return { ...g, _rec: rec, _legActs: legActs };
    });

    const q = query.trim().toUpperCase();
    list = list.filter((g) => {
      if (q && !g.key.includes(q)) return false;
      if (kindFilter === "equity" && !g.equity) return false;
      if (kindFilter === "option" && g.options.length === 0) return false;
      if (kindFilter === "losers" && !(g.unrl < 0)) return false;
      if (recFilter === "actionable" && (REC_ORDER[g._rec?.recommendation] ?? 9) > 1) return false;
      if (recFilter !== "all" && recFilter !== "actionable" && g._rec?.recommendation !== recFilter) return false;
      return true;
    });
    // Sort groups by the same keys (they expose value/unrl/weight/dayPl/symbol).
    const s = HOLD_SORTS[sortKey] || HOLD_SORTS.value;
    const keyFor = (g) => {
      if (sortKey === "symbol") return g.key;
      if (sortKey === "action") return REC_ORDER[g._rec?.recommendation] ?? 9;
      if (sortKey === "unrl") return g.unrl;
      if (sortKey === "weight") return g.weight;
      if (sortKey === "day") return g.dayPl;
      return g.value;
    };
    return list.sort((a, b) => {
      const ka = keyFor(a), kb = keyFor(b);
      const cmp = typeof ka === "string" ? ka.localeCompare(kb) : ka - kb;
      return cmp * s.dir;
    });
  }, [pos, byUnderlying, query, kindFilter, recFilter, sortKey]);

  const openChart = (sym) => { const u = underlyingOf(sym); if (setSymbol) setSymbol(u); if (go) go("ic", u); };
  const actionable = groups.filter((g) => (REC_ORDER[g._rec?.recommendation] ?? 9) <= 1).length;

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Holdings</h2>
      <p className="vg-sub">
        {acctLabel} · {groups.length} ticker{groups.length === 1 ? "" : "s"}{analysis ? ` · ${actionable} actionable` : ""} · grouped by symbol · click to expand
      </p>

      <div className="vg-spread" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div className="vg-pills">
          {[["all", "All"], ["equity", "Has equity"], ["option", "Has options"], ["losers", "Losers"]].map(([k, l]) => (
            <button key={k} className={cls("vg-pill", kindFilter === k && "sel")} onClick={() => setKindFilter(k)}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="vg-select" value={recFilter} onChange={(e) => setRecFilter(e.target.value)} title="Filter by recommendation">
            <option value="all">Any recommendation</option>
            <option value="actionable">Actionable only</option>
            <option value="HOLD_AND_SELL_CALL">Hold &amp; sell call</option>
            <option value="CLOSE_AND_BOOK_LOSS">Close &amp; book loss</option>
            <option value="MONITOR">Monitor</option>
          </select>
          <select className="vg-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)} title="Sort by">
            {Object.entries(HOLD_SORTS).map(([k, s]) => <option key={k} value={k}>Sort: {s.label}</option>)}
          </select>
          <input className="vg-input" placeholder="Search symbol…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 130 }} />
        </div>
      </div>

      <div className="vg-card vg-tablewrap" style={{ padding: "8px 12px" }}>
        <table className="vg-table">
          <thead>
            <tr>
              <th>Symbol</th><th className="num">Value</th>
              <th className="num">Day</th><th className="num">Unrealized</th>
              <th className="num">Weight</th><th>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = !!expanded[g.key];
              const sleeve = !!g.sleeve && !g.equity && g.options.length === 0;
              const nOpts = g.options.length;
              return (
              <React.Fragment key={g.key}>
                <tr className="click vg-grouprow"
                  title={sleeve ? undefined : `Open ${g.key} chart`}
                  onClick={() => { if (!sleeve) openChart(g.key); }}>
                  <td>
                    {/* the caret owns expand (row-click now opens the chart) */}
                    <span className="vg-caret" title={isOpen ? "collapse" : "expand lots"}
                      onClick={(e) => { e.stopPropagation();
                        setExpanded((x) => ({ ...x, [g.key]: !x[g.key] })); }}>
                      {isOpen ? "▾" : "▸"}</span>
                    <b>{g.key}</b>
                    {nOpts > 0 && <span className="vg-chip" style={{ marginLeft: 6 }} title={`${nOpts} option leg(s)`}>{nOpts} OPT</span>}
                    {g.equity && g.equity.overlap && accountId === "all" && (
                      <span className="vg-badge info" style={{ marginLeft: 6 }} title={`Held as ${g.equity.overlap.symbols.join(", ")}`}>Overlap</span>
                    )}
                    {g.equity && g.equity.weight > 7 && (
                      <span className="vg-badge warn" style={{ marginLeft: 6 }}>Concentrated</span>
                    )}
                    {sleeve && <div className="vg-note">sleeve — value via broker portfolio</div>}
                  </td>
                  <td className="num">{money(g.value, g.currency)}</td>
                  <td className={cls("num", dirCls(g.dayPl))}>{g.dayPl ? signMoney(g.dayPl, g.currency) : "—"}</td>
                  <td className={cls("num", dirCls(g.unrl))}>{signMoney(g.unrl, g.currency)}</td>
                  <td className="num">{g.weight.toFixed(1)}%</td>
                  <td>{sleeve ? <span className="vg-note">—</span> : <HoldingRec d={g._rec} onOpen={openChart} />}</td>
                </tr>
                {isOpen && g.equity && (
                  <>
                    <tr className="vg-subrow vg-subhead"><td colSpan={6} style={{ paddingLeft: 26 }}>Equity · {g.equity.shares} sh</td></tr>
                    {g.equity.lots.map((l, i) => (
                      <tr className="vg-subrow" key={`eq-${i}`}>
                        <td style={{ paddingLeft: 34 }}>lot · {fmtDate(l.date)}</td>
                        <td className="num">{usd(lotValue(l))}</td>
                        <td className="num">{`${l.shares} sh @ ${usd(l.costPerShare, 2)}`}</td>
                        <td className={cls("num", dirCls(lotUnrl(l)))}>{signUsd(lotUnrl(l))}</td>
                        <td className="num" colSpan={2}>{daysAgo(l.date) > 365 ? "long-term" : "short-term"}</td>
                      </tr>
                    ))}
                  </>
                )}
                {isOpen && nOpts > 0 && (
                  <>
                    <tr className="vg-subrow vg-subhead"><td colSpan={6} style={{ paddingLeft: 26 }}>Options · {nOpts} leg(s)</td></tr>
                    {g.options.map((p) => {
                      const a = g._legActs[p.symbol.toUpperCase()] || g._legActs[optionMatchKey(p.symbol)] || null;
                      return (
                        <tr className="vg-subrow vg-legrow" key={p.symbol}>
                          <td style={{ paddingLeft: 34 }}>{optionLegLabel(p.symbol)}</td>
                          <td className="num">{usd(p.value)}</td>
                          <td className="num">—</td>
                          <td className={cls("num", dirCls(p.unrl))}>{signUsd(p.unrl)}</td>
                          <td className="num"></td>
                          <td><LegActionChip a={a} /></td>
                        </tr>
                      );
                    })}
                  </>
                )}
              </React.Fragment>
              );
            })}
            {groups.length === 0 && (
              <tr><td colSpan={6} className="vg-note" style={{ padding: 16 }}>No holdings match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {/* paper trades live here too — always visible on the Positions page, whether
          or not a scanner setup has fired. Open positions + closed track record. */}
      <ScannerSpreadBook refreshNonce={refreshNonce} alwaysShow />
    </div>
  );
}

/* ================= Activity ================= */
// Transaction history has NO fixture dataset: it exists only after a broker
// import with --with-history, so offline/empty renders an instructional card.
const ACTIVITY_PAGE = 50;
const ACTIVITY_KINDS = [
  { id: "all", label: "All" },
  { id: "equity", label: "Equities" },
  { id: "option", label: "Options" },
];

// Compact event timestamp: "Jul 2" + "2:31 PM" (raw string if unparseable).
function fmtWhen(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return { day: iso ? String(iso) : "—", time: "" };
  return {
    day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

function ActivityView({ accountId, settings, refreshNonce }) {
  const [kind, setKind] = useState("all");
  const [shown, setShown] = useState(ACTIVITY_PAGE);
  // No fixture fallback — null (backend down / endpoint 404) stays null.
  const rows = useLive(
    () => live.getHistory(accountId).then(mapHistory),
    null,
    [accountId, settings, refreshNonce],
  ).data;
  useEffect(() => { setShown(ACTIVITY_PAGE); }, [accountId, kind]);
  const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;
  const all = rows || [];
  const filtered = kind === "all" ? all : all.filter((r) => r.kind === kind);
  const visible = filtered.slice(0, shown);
  const signedAmt = (n) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n), 2)}`;

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Activity</h2>
      <p className="vg-sub">{acctLabel} · imported broker transaction history · newest first</p>

      {all.length === 0 ? (
        <div className="vg-card">
          <div className="vg-kicker">No activity imported yet</div>
          <p className="vg-note" style={{ margin: "6px 0 0", maxWidth: 560 }}>
            Transaction history arrives with a broker import — run the importer with <b>--with-history</b> and
            this view fills in. There is no demo fixture for account history, so it stays empty offline.
          </p>
          <pre style={{
            background: "var(--color-light)", border: "1px solid var(--color-border)", borderRadius: 8,
            padding: "10px 12px", margin: "10px 0 0", fontSize: 12, lineHeight: 1.5, overflowX: "auto",
          }}>
            <code>{"cd server\n.venv/bin/python -m vantage_server.importer \\\n    --broker robinhood --account rh-margin --with-history"}</code>
          </pre>
        </div>
      ) : (
        <>
          <div className="vg-card vg-tablewrap" style={{ padding: "8px 12px" }}>
            <div className="vg-spread" style={{ padding: "6px 4px 8px" }}>
              <div className="vg-pills">
                {ACTIVITY_KINDS.map((f) => (
                  <button key={f.id} className={cls("vg-pill", kind === f.id && "sel")}
                    onClick={() => setKind(f.id)}>{f.label}</button>
                ))}
              </div>
              <span className="vg-note">{filtered.length === all.length
                ? `${all.length} events`
                : `${filtered.length} of ${all.length} events`}</span>
            </div>
            <table className="vg-table">
              <thead>
                <tr>
                  <th>Date</th><th>Account</th><th>Symbol</th><th>Side</th>
                  <th className="num">Qty</th><th className="num">Price</th>
                  <th className="num">Amount</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const w = fmtWhen(r.date);
                  return (
                    <tr key={i} style={r.state === "cancelled" ? { opacity: 0.55 } : undefined}>
                      <td>{w.day}{w.time && <div className="vg-note">{w.time}</div>}</td>
                      <td><span className="vg-chip">{acctOf(r.account).short}</span></td>
                      <td>
                        <b>{r.symbol || "—"}</b>
                        {r.kind === "option" && (
                          <span className="vg-chip" style={{ marginLeft: 6 }} title="option contract">OPT</span>
                        )}
                        {r.description && <div className="vg-note">{r.description}</div>}
                      </td>
                      <td>
                        {r.side === "buy" && <span className="vg-badge good">Buy</span>}
                        {r.side === "sell" && <span className="vg-badge bad">Sell</span>}
                        {r.side !== "buy" && r.side !== "sell" && <span className="vg-note">—</span>}
                      </td>
                      <td className="num">{r.qty != null ? r.qty : "—"}</td>
                      <td className="num">{r.price != null ? usd(r.price, 2) : "—"}</td>
                      <td className={cls("num", dirCls(r.amount || 0))}>
                        {r.amount != null ? signedAmt(r.amount) : "—"}
                      </td>
                      <td>
                        {r.state === "filled" && <span style={{ fontSize: 12.5 }}>filled</span>}
                        {r.state === "open" && <span className="vg-badge info">open</span>}
                        {r.state === "cancelled" && <span className="vg-badge plain">cancelled</span>}
                        {r.state && !["filled", "open", "cancelled"].includes(r.state) && (
                          <span className="vg-badge plain">{r.state}</span>
                        )}
                        {!r.state && <span className="vg-note">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > shown && (
            <div style={{ textAlign: "center", marginTop: 10 }}>
              <button className="vg-linkbtn" onClick={() => setShown(shown + ACTIVITY_PAGE)}>
                Show {Math.min(ACTIVITY_PAGE, filtered.length - shown)} more · {filtered.length - shown} remaining
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ================= Tax Center ================= */
// Realized capital gains for the year (FIFO lot-matched equity history): ST/LT split,
// estimated tax, and an honest "cost basis unknown" bucket for pre-import sells.
function RealizedGainsCard({ accountId }) {
  const g = useLive(() => live.taxGains(accountId || "all"), null, [accountId]).data;
  if (!g) return null;
  const st = g.short_term || {}, lt = g.long_term || {}, cu = g.cost_unknown || {};
  return (
    <div className="vg-card vg-pf-card" style={{ marginBottom: 16 }}>
      <div className="vg-pf-head">
        <span className="vg-pf-title">Realized gains · {g.year}</span>
        <span className={cls("vg-badge", g.total_gain >= 0 ? "good" : "bad")}>{signUsd(g.total_gain)}</span>
      </div>
      <div className="vg-pf-stats">
        <StatTile label="Short-term" value={signUsd(st.gain)} deltaDir={dirCls(st.gain)} note={`${st.n || 0} lots · taxed as income`} />
        <StatTile label="Long-term" value={signUsd(lt.gain)} deltaDir={dirCls(lt.gain)} note={`${lt.n || 0} lots · held >1yr`} />
        <StatTile label="Est. tax owed" value={usd(g.estimated_tax)} note={`${Math.round((g.st_rate || 0) * 100)}% ST / ${Math.round((g.lt_rate || 0) * 100)}% LT`} />
      </div>
      {cu.proceeds > 0 && (
        <p className="vg-note vg-pf-note">
          {usd(cu.proceeds)} of sells have no imported buy history — cost basis unknown, gain not computed
          ({(cu.rows || []).map((r) => r.symbol).slice(0, 6).join(", ")}).
        </p>)}
    </div>);
}

function TaxView({ settings, tlh, accountId }) {
  const [washFaqOpen, setWashFaqOpen] = useState(false);
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Tax Center — realized gains & loss harvesting</h2>
      <RealizedGainsCard accountId={accountId} />
      <p className="vg-sub">
        Every lot marked to last close · wash-sale window checked across <b>all linked accounts</b> ·
        threshold {usd(settings.thresholdUsd)} or {settings.thresholdPct}% · decision-support only, no orders placed
      </p>
      <div className="vg-card vg-tablewrap" style={{ padding: "8px 12px" }}>
        <table className="vg-table">
          <thead>
            <tr><th>Lot</th><th>Account</th><th className="num">Unrealized</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {tlh.map((c, i) => (
              <tr key={i}>
                <td>
                  <b>{c.lot.symbol}</b> · {c.lot.shares} sh @ {usd(c.lot.costPerShare, 2)}
                  <div className="vg-note">bought {fmtDate(c.lot.date)}</div>
                </td>
                <td><span className="vg-chip">{c.acct.short}</span></td>
                <td className="num down">{signUsd(c.unrl)} <span className="vg-note">({signPct(-c.lossPct)})</span></td>
                <td>
                  {c.status === "clear" && <span className="vg-badge good">✓ Clear to harvest</span>}
                  {c.status === "blocked" && <span className="vg-badge bad">✕ Wash-sale blocked</span>}
                  {c.status === "below" && <span className="vg-badge plain">Below threshold</span>}
                  {c.status === "na" && <span className="vg-badge plain">N/A — tax-advantaged</span>}
                  {c.status === "blocked" && (
                    <div className="vg-note" style={{ maxWidth: 320, marginTop: 4 }}>
                      {c.wash.reason}. Clears {c.wash.clearsOn === "auto-buy paused" ? "once the auto-buy is paused" : c.wash.clearsOn}.
                    </div>
                  )}
                </td>
                <td>
                  {c.status === "clear" && (c.replacement
                    ? <span>Sell → buy <b>{c.replacement}</b> <div className="vg-note">different index, near-identical exposure</div></span>
                    : <span>Sell, wait 31 days to rebuy<div className="vg-note">no like-exposure partner for single stock</div></span>)}
                  {c.status === "blocked" && c.wash.futureRisk && (
                    <span className="vg-note">Pause {c.wash.futureRisk.symbol} auto-buy to open a window</span>
                  )}
                  {(c.status === "below" || c.status === "na") && <span className="vg-note">Monitor</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="vg-card" style={{ marginTop: 14 }}>
        <FAQItem
          question="Why does a buy in my IRA block a harvest in my brokerage account?"
          open={washFaqOpen} onToggle={() => setWashFaqOpen(!washFaqOpen)}
        >
          The IRS wash-sale rule disallows a loss if you buy a substantially identical security within 30 days
          before or after the sale — in any of your accounts, including IRAs (Rev. Rul. 2008-5) and a spouse's
          accounts. Single-account tools miss this; Vantage checks every linked account plus scheduled
          auto-invests before calling a loss harvestable. Estimated benefit assumes your {settings.taxRate}%
          marginal rate — change it in Settings.
        </FAQItem>
      </div>
    </div>
  );
}

/* ================= Recommendations ================= */

// conviction.label -> chip class/text; recommendation -> chip class/text.
const CONVICTION_CHIP = {
  strong:   { cls: "good",  text: "STRONG" },
  neutral:  { cls: "plain", text: "NEUTRAL" },
  weak:     { cls: "warn",  text: "WEAK" },
  freefall: { cls: "bad",   text: "FREEFALL" },
};
const REC_CHIP = {
  HOLD_AND_SELL_CALL:  { cls: "info", text: "HOLD & SELL CALL" },
  CLOSE_AND_BOOK_LOSS: { cls: "bad",  text: "CLOSE & BOOK LOSS" },
  HOLD_WASH_BLOCKED:   { cls: "warn", text: "HOLD — WASH BLOCKED" },
  MONITOR:             { cls: "plain", text: "MONITOR" },
};
// actionable-first sort weight.
const REC_ORDER = { CLOSE_AND_BOOK_LOSS: 0, HOLD_AND_SELL_CALL: 1, HOLD_WASH_BLOCKED: 2, MONITOR: 3 };

// Per-option-leg strategist action chips (from decision.legActions).
const LEG_ACTION_CHIP = {
  DEFEND:       { cls: "bad",   text: "DEFEND" },
  CLOSE_LEG:    { cls: "bad",   text: "CLOSE" },
  TAKE_PROFIT:  { cls: "good",  text: "TAKE PROFIT" },
  ROLL_UP:      { cls: "info",  text: "ROLL UP" },
  ROLL_DOWN:    { cls: "warn",  text: "ROLL DOWN" },
  ROLL_OUT:     { cls: "warn",  text: "ROLL OUT" },
  LET_EXPIRE:   { cls: "plain", text: "LET EXPIRE" },
  HOLD_LEG:     { cls: "plain", text: "HOLD" },
};

// One option leg's action chip + one-line detail (strike/expiry/DTE + target).
function LegActionChip({ a }) {
  if (!a) return <span className="vg-note">—</span>;
  const chip = LEG_ACTION_CHIP[a.action] || { cls: "plain", text: a.action };
  let detail = `${a.dte}DTE · ${a.moneyness}`;
  if (a.target && a.target.strike != null) detail += ` → $${Number(a.target.strike).toFixed(0)}`;
  else if (a.target && a.target.expiry) detail += ` → ${a.target.expiry}`;
  return (
    <span title={a.rationale || ""}>
      <span className={cls("vg-badge", chip.cls)}>{chip.text}</span>
      <span className="vg-note" style={{ marginLeft: 6 }}>{detail}</span>
    </span>
  );
}

// The one-line "key detail" per recommendation, read from the persisted action.
function recDetail(d) {
  const a = d.action;
  if (!a) return d.rationale || "";
  if (a.kind === "sell_call" && a.suggestedStrike != null) {
    const strike = Number(a.suggestedStrike).toFixed(2);
    const credit = a.estCredit != null ? `~$${Math.round(a.estCredit)}` : "";
    const basis = (a.currentNetCost != null && a.projectedNetCost != null)
      ? `, basis $${Math.round(a.currentNetCost)}→$${Math.round(a.projectedNetCost)}` : "";
    return `sell ${strike}C ${credit}${basis}`;
  }
  if (a.kind === "close") {
    const loss = a.unrealizedLoss != null ? `book $${Math.round(Math.abs(a.unrealizedLoss))}` : "book loss";
    const weeks = a.weeksToOffset != null ? `, ${a.weeksToOffset}wk to offset` : "";
    const wash = a.washBlocked ? " · WASH BLOCKED" : "";
    return `${loss}${weeks}${wash}`;
  }
  return d.rationale || "";
}

function tfTrend(perTf, name) {
  const tf = perTf && perTf[name];
  if (!tf || !tf.trend) return `${name}: —`;
  return `${name}: ${tf.trend.direction} (${tf.trend.structure})`;
}

function RecRow({ d, onJump }) {
  const [open, setOpen] = useState(false);
  const conv = CONVICTION_CHIP[d.conviction.label] || CONVICTION_CHIP.neutral;
  const rec = REC_CHIP[d.recommendation] || { cls: "plain", text: d.recommendation };
  const ev = d.evidence || {};
  return (
    <>
      <tr className="vg-recrow" style={{ cursor: "pointer" }}>
        <td onClick={() => onJump(d.symbol)}><b>{d.symbol}</b></td>
        <td><span className={cls("vg-badge", conv.cls)}>{conv.text}</span></td>
        <td><span className={cls("vg-badge", rec.cls)}>{rec.text}</span></td>
        <td style={{ fontSize: 13 }}>{recDetail(d)}</td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <button className="vg-linkbtn" onClick={() => setOpen(!open)}>{open ? "hide" : "evidence"}</button>
          {" · "}
          <button className="vg-linkbtn" onClick={() => onJump(d.symbol)}>chart →</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: "var(--color-light)", padding: "12px 14px" }}>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 8px" }}>{d.rationale}</p>
              <div className="vg-row" style={{ gap: 18, flexWrap: "wrap", color: "var(--color-grey)" }}>
                <span>{tfTrend(ev.perTf, "daily")}</span>
                <span>{tfTrend(ev.perTf, "weekly")}</span>
                <span>{tfTrend(ev.perTf, "monthly")}</span>
              </div>
              <div className="vg-row" style={{ gap: 18, flexWrap: "wrap", marginTop: 6, color: "var(--color-grey)" }}>
                {ev.nearestSupport && <span>nearest support {Number(ev.nearestSupport.price).toFixed(2)} (str {ev.nearestSupport.strength})</span>}
                {ev.nearestResistance && <span>nearest resistance {Number(ev.nearestResistance.price).toFixed(2)} (str {ev.nearestResistance.strength})</span>}
                <span>broke support w/ momentum: {ev.brokeSupportWithMomentum ? "yes" : "no"}</span>
                <span>rule: {d.rule}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RecsView({ settings, setSymbol, go }) {
  const analysis = useLive(() => live.getAnalysis().then(mapAnalysis), null, [settings]);
  const data = analysis.data;
  const decisions = (data && data.decisions) || [];
  // Actionable first (CLOSE, HOLD_AND_SELL_CALL), then wash-blocked, then MONITOR.
  const sorted = [...decisions].sort((a, b) => {
    const wa = REC_ORDER[a.recommendation] ?? 9, wb = REC_ORDER[b.recommendation] ?? 9;
    if (wa !== wb) return wa - wb;
    return a.symbol.localeCompare(b.symbol);
  });
  const jump = (sym) => { const u = underlyingOf(sym); setSymbol(u); go("ic", u); };

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Recommendations</h2>
      <p className="vg-sub">
        Persisted decision journal{data && data.asOf ? ` · as of ${data.asOf}` : ""} · actionable first · educational only, not advice
      </p>

      {sorted.length === 0 ? (
        <div className="vg-card" style={{ marginTop: 8 }}>
          <div className="vg-kicker">No analysis available</div>
          <p className="vg-note" style={{ margin: "6px 0 0" }}>
            The decision journal is empty or the backend is unreachable. Run the nightly analysis
            (<code>python -m vantage_server.analyze</code>) and confirm the backend URL in Settings.
          </p>
        </div>
      ) : (
        <div className="vg-card" style={{ marginTop: 8, padding: 0, overflowX: "auto" }}>
          <table className="vg-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, color: "var(--color-grey)" }}>
                <th style={{ padding: "10px 14px" }}>Symbol</th>
                <th style={{ padding: "10px 14px" }}>Conviction</th>
                <th style={{ padding: "10px 14px" }}>Recommendation</th>
                <th style={{ padding: "10px 14px" }}>Detail</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => <RecRow key={d.symbol} d={d} onJump={jump} />)}
            </tbody>
          </table>
        </div>
      )}

      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-spread">
          <div>
            <div className="vg-kicker" style={{ marginBottom: 2 }}>Options income</div>
            <span className="vg-note">Executable covered-call ideas on your book — see Options Intelligence.</span>
          </div>
          <button className="vg-linkbtn" onClick={() => go("options")}>Open Options Intel →</button>
        </div>
      </div>
    </div>
  );
}

/* ================= Market Intel (drill-down: live pattern signals) =========
 * Off the top-level nav — reached from the Dashboard market read. The advisor
 * read and the market band live on the Dashboard now; the fixture heatmap,
 * fixture per-symbol meters, and "AI picks" are cut. What remains is the one
 * genuinely live, book-relevant surface: backend-graded pattern signals. */
function MarketsView({ setSymbol, go, settings }) {
  const [signalsTab, setSignalsTab] = useState("active");
  // Signals: backend-graded when live (statuses computed from quotes, never
  // authored), fixture rows otherwise. "Past" = resolved (hit target / stopped);
  // everything else — active and unquoted — stays on the Active tab.
  const signals = useLive(() => live.getSignals().then(mapSignals), [], [settings], { blankOnOutage: true }).data;
  const isPastSignal = (s) => s.status === "hit-target" || s.status === "stopped";
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Pattern signals</h2>
      <p className="vg-sub">
        Backend-graded technical signals · statuses computed from live quotes, never authored · educational only
      </p>

      <div className="vg-card" style={{ marginTop: 8 }}>
        <div className="vg-spread">
          <div className="vg-kicker" style={{ marginBottom: 0 }}>AI pattern signals</div>
          <div className="vg-pills">
            <button className={cls("vg-pill", signalsTab === "active" && "sel")} onClick={() => setSignalsTab("active")}>
              Active ({signals.filter((s) => !isPastSignal(s)).length})
            </button>
            <button className={cls("vg-pill", signalsTab === "past" && "sel")} onClick={() => setSignalsTab("past")}>
              Past ({signals.filter(isPastSignal).length})
            </button>
          </div>
        </div>
        <div className="vg-tablewrap" style={{ marginTop: 10 }}>
          <table className="vg-table">
            <thead>
              <tr>
                <th>Ticker</th><th>Pattern</th><th className="num">Entry</th><th className="num">Target</th>
                <th className="num">Stop</th><th className="num">Move</th><th className="num">Conf</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {signals.filter((s) => (signalsTab === "active" ? !isPastSignal(s) : isPastSignal(s))).map((s) => (
                <tr key={s.id}>
                  <td><b>{s.sym}</b><div className="vg-note">{s.time}</div></td>
                  <td>{s.pattern}</td>
                  <td className="num">{s.entry.toFixed(2)}</td>
                  <td className="num">{s.target.toFixed(2)}</td>
                  <td className="num">{s.stop.toFixed(2)}</td>
                  <td className={cls("num", dirCls(s.movePct || 0))}>{s.movePct != null ? signPct(s.movePct, 1) : "—"}</td>
                  <td className="num">{s.conf != null ? `${s.conf}%` : "—"}</td>
                  <td>
                    {s.status === "active" && <span className="vg-badge good">● Active</span>}
                    {s.status === "hit-target" && <span className="vg-badge info">✓ Hit target</span>}
                    {s.status === "stopped" && <span className="vg-badge bad">✕ Stopped</span>}
                    {s.status === "unquoted" && (
                      <span className="vg-badge plain"
                        title="no quote for this symbol — statuses are computed, never authored">◌ Unquoted</span>
                    )}
                    {s.grade && (
                      <span className="vg-chip" style={{ marginLeft: 6 }}
                        title={s.pnlPct != null ? `progress grade ${s.grade} · P/L ${signPct(s.pnlPct, 1)}` : `progress grade ${s.grade}`}>
                        {s.grade}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ================= panels & modals (unchanged behavior) ================= */
function NotifPanel({ notifs, setNotifs, settings, saveSettings, onClose }) {
  const visible = notifs.filter((n) => settings.notifPrefs[n.type]);
  return (
    <div>
      <div className="vg-scrim" onClick={onClose} />
      <div className="vg-panel">
        <div className="vg-panel-head">
          <h3>Notifications</h3>
          <div className="vg-row">
            <button className="vg-linkbtn" onClick={() => setNotifs(notifs.map((n) => ({ ...n, read: true })))}>
              Mark all read
            </button>
            <button className="vg-x" aria-label="Close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="vg-panel-body">
          {visible.map((n) => (
            <div key={n.id} className={cls("vg-notif", !n.read && "unread")}
              onClick={() => setNotifs(notifs.map((x) => (x.id === n.id ? { ...x, read: true } : x)))}>
              {!n.read && <span className="vg-dot" />}
              <div>
                <div className="t">{NOTIF_TYPES[n.type].icon} {n.title}</div>
                <div className="b">{n.body}</div>
                <div className="when">{n.time} · {NOTIF_TYPES[n.type].label}</div>
              </div>
            </div>
          ))}
          {visible.length === 0 && <p className="vg-note">All notification types are muted in preferences below.</p>}
          <div style={{ borderTop: "1px solid var(--color-border)", marginTop: 16, paddingTop: 12 }}>
            <div className="vg-kicker">Preferences</div>
            {Object.entries(NOTIF_TYPES).map(([k, m]) => (
              <label className="vg-toggle" key={k}>
                <input type="checkbox" checked={settings.notifPrefs[k]}
                  onChange={(e) => saveSettings({ ...settings, notifPrefs: { ...settings.notifPrefs, [k]: e.target.checked } })} />
                {m.icon} {m.label}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Renders either as the classic slide-over (with scrim + close) or docked
// inside the right studio pane (`docked` — no scrim, no close button).
function ChatPanel({ settings, onClose, docked }) {
  const useMira = settings.aiBackend === "mira";
  const [msgs, setMsgs] = useState([
    { who: "ai", text: "Hi — I'm Vantage AI. I can see across all 4 of your linked accounts. Ask me about harvesting, wash sales, overlap, or your allocation." },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const abortRef = useRef(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs]);
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);

  // Replace the last (streaming) assistant message via an updater.
  const patchLast = (fn) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));
  // No demo replies: when the AI backend is off/unreachable, say so plainly
  // rather than fabricate portfolio numbers.
  const cannedReply = () =>
    "The AI advisor is offline. Start Mira (and the backend) to ask grounded questions about your book — I won't invent numbers.";

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");

    if (!useMira) {
      // aiBackend === "off": original canned behavior, unchanged.
      setMsgs((m) => [...m, { who: "me", text }]);
      setTimeout(() => setMsgs((m) => [...m, { who: "ai", text: cannedReply(text) }]), 450);
      return;
    }

    setMsgs((m) => [...m, { who: "me", text }, { who: "ai", text: "", plan: [], pending: true }]);
    setBusy(true);
    let gotText = false;
    abortRef.current = live.streamTurn(text, live.threadId(), (evt) => {
      if (evt.kind === "plan_step") {
        patchLast((l) => ({ ...l, plan: [...(l.plan || []), evt.phase ? `${evt.step} (${evt.phase})` : String(evt.step)] }));
      } else if (evt.kind === "token") {
        gotText = true;
        patchLast((l) => ({ ...l, text: l.text + (evt.text || "") }));
      } else if (evt.kind === "done") {
        setBusy(false);
        // The done event carries the turn's correlation_id — it unlocks the
        // "explain" affordance (GET /explain grounding trace) on this reply.
        patchLast((l) => ({ ...l, pending: false, corr: evt.correlation_id || null }));
      } else if (evt.kind === "error") {
        // Mira unreachable or errored: fall back to the canned rule for this message.
        setBusy(false);
        patchLast((l) => (gotText
          ? { ...l, pending: false, offline: true }
          : { ...l, text: cannedReply(text), plan: [], pending: false, offline: true }));
      }
    });
  };

  // Toggle the inline grounding trace under one Mira reply; fetch it lazily
  // the first time (getExplanation returns null on 404/503/unreachable).
  const toggleExplain = (i) => {
    const m = msgs[i];
    const opening = !m.explainOpen;
    setMsgs((ms) => ms.map((x, j) => (j === i ? { ...x, explainOpen: opening } : x)));
    if (opening && m.explain === undefined && m.corr) {
      live.getExplanation(m.corr).then((payload) => {
        const rec = payload && Array.isArray(payload.records) && payload.records.length ? payload.records[0] : null;
        setMsgs((ms) => ms.map((x, j) => (j === i ? { ...x, explain: rec } : x)));
      });
    }
  };

  const inner = (
    <>
      {!docked && (
        <div className="vg-panel-head">
          <h3>Vantage AI</h3>
          <button className="vg-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
      )}
      <div className="vg-panel-body" ref={bodyRef}>
          {msgs.map((m, i) => (
            <div key={i} className={cls("vg-msg", m.who)}>
              {m.plan && m.plan.length > 0 && (
                <div style={{ fontSize: 11.5, opacity: 0.65, marginBottom: 6 }}>
                  {m.plan.map((s, j) => <div key={j}>· {s}</div>)}
                </div>
              )}
              {m.who === "ai" && !m.pending && m.text
                ? <MiraRender text={m.text} />
                : (m.text || (m.pending ? "…" : ""))}
              {m.offline && (
                <div className="vg-note" style={{ marginTop: 6 }}>offline — canned reply</div>
              )}
              {m.who === "ai" && m.corr && (
                <div style={{ marginTop: 6 }}>
                  <button className="vg-linkbtn" style={{ fontSize: 11.5 }} onClick={() => toggleExplain(i)}>
                    {m.explainOpen ? "hide explanation" : "explain"}
                  </button>
                  {m.explainOpen && <ExplainBlock explain={m.explain} />}
                </div>
              )}
            </div>
          ))}
        </div>
      <div className="vg-chatform">
        <FormField placeholder="Ask about your portfolio…" value={draft}
          onChange={(e) => setDraft(e.target.value)} id={docked ? "chat-input-dock" : "chat-input"} />
        <Button variant="primary" onClick={send}>Send</Button>
      </div>
      <p className="vg-note" style={{ padding: "0 16px 12px", margin: 0 }}>
        {useMira
          ? "Mira AI assistant — canned demo replies when offline · educational only."
          : "Demo assistant with canned responses · educational only."}
      </p>
    </>
  );

  if (docked) return <div className="vg-chatdock">{inner}</div>;
  return (
    <div>
      <div className="vg-scrim" onClick={onClose} />
      <div className="vg-panel">{inner}</div>
    </div>
  );
}

// Inline grounding trace for one Mira reply: claims with sources, grounded
// ratio from the uncertainty block, and plan-step count. `explain` is
// undefined while loading, null when no trace is available.
function ExplainBlock({ explain }) {
  if (explain === undefined) return <div className="vg-note" style={{ marginTop: 4 }}>loading trace…</div>;
  if (!explain) return <div className="vg-note" style={{ marginTop: 4 }}>no trace available</div>;
  const claims = Array.isArray(explain.claims) ? explain.claims : [];
  const steps = Array.isArray(explain.plan_steps) ? explain.plan_steps.length : 0;
  const u = explain.uncertainty || {};
  const ratio = typeof u.grounded_ratio === "number" ? u.grounded_ratio : null;
  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--color-border)", fontSize: 12, lineHeight: 1.5 }}>
      <div className="vg-note" style={{ fontSize: 11.5, marginBottom: 4 }}>
        {ratio != null && <>grounded {Math.round(ratio * 100)}% · </>}
        {steps} plan step{steps === 1 ? "" : "s"} · {claims.length} claim{claims.length === 1 ? "" : "s"}
      </div>
      {claims.map((c, i) => (
        <div key={i}>
          · {c.statement}{" "}
          <span className="vg-note">({c.source_type}:{c.source_id})</span>
        </div>
      ))}
    </div>
  );
}

function AccountsSettings() {
  const live_ = live;
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const blank = { id: "", name: "", currency: "USD", jurisdiction: "US", taxable: true, broker: "" };
  const [form, setForm] = useState(blank);

  const load = async () => {
    try {
      const p = await live_.accounts();
      setRows((p && p.accounts) || []);
    } catch { setRows([]); }
  };
  useEffect(() => { load(); }, []);

  const startAdd = () => { setForm(blank); setEditId(null); setAdding(true); setErr(""); };
  const startEdit = (a) => {
    setForm({ id: a.id, name: a.name || a.short || a.id, currency: a.currency || "USD",
              jurisdiction: a.jurisdiction || "US", taxable: a.taxable !== false,
              broker: a.broker || "" });
    setEditId(a.id); setAdding(true); setErr("");
  };
  const save = async () => {
    setErr(""); setBusy("save");
    try {
      if (editId) {
        await live_.editAccount(editId, { name: form.name, currency: form.currency,
          jurisdiction: form.jurisdiction, taxable: form.taxable, broker: form.broker });
      } else {
        if (!form.id.trim() || !form.name.trim()) { setErr("id and name are required"); setBusy(""); return; }
        const r = await live_.createAccount(form);
        if (r && r.error) { setErr(r.error); setBusy(""); return; }
      }
      setAdding(false); await load();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy("");
  };
  const remove = async (id) => {
    if (!window.confirm(`Remove account "${id}" and its lots? This cannot be undone.`)) return;
    setBusy("del:" + id);
    try { await live_.deleteAccount(id); await load(); } catch (e) { setErr(String(e.message || e)); }
    setBusy("");
  };
  const sync = async (id) => {
    setBusy("sync:" + id); setErr("");
    try {
      const r = await live_.syncAccount(id);
      const res = (r && r.results && r.results[0]) || {};
      if (res.errors && res.errors.length) setErr(`${id}: ${res.errors.join("; ")}`);
      await load();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy("");
  };
  const authOk = (st) => !!st && /valid|present|grant/i.test(st);
  const reauth = async (id) => {
    setBusy("auth:" + id); setErr("");
    try {
      const r = await live_.kiteLoginUrl();
      if (r && r.error) { setErr(r.error); setBusy(""); return; }
      // Open Kite login; the backend catches the redirect and saves the token.
      const win = window.open(r.login_url, "kite-auth", "width=480,height=640");
      // Poll the LIVE status until it flips (the accounts endpoint can take
      // ~15s cold, so accounts() now has a 30s timeout — a short poll would
      // otherwise abort every fetch and never see the grant).
      let tries = 0;
      const timer = setInterval(async () => {
        tries += 1;
        const p2 = await live_.accounts().catch(() => null);
        if (p2 && p2.accounts) {
          setRows(p2.accounts);  // re-render with fresh status
          const a = p2.accounts.find((x) => x.id === id);
          if (authOk(a && a.auth_status)) { clearInterval(timer); setBusy(""); return; }
        }
        // Stop once the popup is closed AND we've had a chance to read status,
        // or after ~2 min.
        if ((win && win.closed && tries > 1) || tries > 40) {
          clearInterval(timer); setBusy("");
        }
      }, 3000);
    } catch (e) { setErr(String(e.message || e)); setBusy(""); }
  };

  if (rows === null) return <p className="vg-note">Loading accounts…</p>;

  return (
    <div>
      <table className="vg-table" style={{ width: "100%", fontSize: 13 }}>
        <thead><tr>
          <th style={{ textAlign: "left" }}>Account</th>
          <th style={{ textAlign: "left" }}>Broker</th>
          <th>Ccy</th><th>Juris.</th>
          <th style={{ textAlign: "left" }}>Status</th>
          <th></th>
        </tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td><b>{a.short || a.id}</b> <span className="vg-note">{a.id}</span></td>
              <td>{a.broker || <span className="vg-note">manual</span>}</td>
              <td className="num">{a.currency || "USD"}</td>
              <td className="num">{a.jurisdiction || "US"}</td>
              <td>{a.auth_status
                ? <span className={authOk(a.auth_status) ? "vg-pos" : "vg-neg"}>{a.auth_status}</span>
                : <span className="vg-note">—</span>}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {a.broker === "zerodha" && (
                  <button className="vg-linkbtn" disabled={busy === "auth:" + a.id}
                    onClick={() => reauth(a.id)}>{busy === "auth:" + a.id ? "authorizing…" : "Re-authenticate"}</button>
                )}
                {a.refreshable && (
                  <button className="vg-linkbtn" disabled={busy === "sync:" + a.id}
                    onClick={() => sync(a.id)}>{busy === "sync:" + a.id ? "syncing…" : "Sync"}</button>
                )}
                <button className="vg-linkbtn" onClick={() => startEdit(a)}>Edit</button>
                <button className="vg-linkbtn vg-neg" disabled={busy === "del:" + a.id}
                  onClick={() => remove(a.id)}>Remove</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="vg-note">No accounts yet.</td></tr>}
        </tbody>
      </table>

      {rows.some((a) => a.auth_hint) && (
        <div className="vg-note" style={{ marginTop: 8, fontSize: 12 }}>
          API brokers need a one-time host-side auth (your secret never enters the browser). Run:
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
            {[...new Set(rows.filter((a) => a.auth_hint).map((a) => a.auth_hint))].map((h) => (
              <li key={h}><code style={{ fontSize: 11 }}>{h}</code></li>
            ))}
          </ul>
        </div>
      )}

      {!adding && (
        <div style={{ marginTop: 12 }}>
          <Button variant="outline" onClick={startAdd}>+ Add account</Button>
        </div>
      )}

      {adding && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border, #ddd)", borderRadius: 8 }}>
          <div className="vg-kicker">{editId ? `Edit ${editId}` : "New account"}</div>
          {!editId && (
            <FormField label="Account id (short, unique)" id="acc-id" value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value.trim() })} />
          )}
          <FormField label="Display name" id="acc-name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <FormField as="select" label="Currency" id="acc-ccy" value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {["USD", "INR", "GBP", "EUR", "CAD", "HKD", "JPY", "AUD"].map((c) => <option key={c} value={c}>{c}</option>)}
          </FormField>
          <FormField as="select" label="Tax jurisdiction" id="acc-juris" value={form.jurisdiction}
            onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}>
            {["US", "IN", "GB", "CA", "HK", "JP", "AU", "EU"].map((c) => <option key={c} value={c}>{c}</option>)}
          </FormField>
          <FormField as="select" label="Broker (live sync; manual = CSV/none)" id="acc-broker" value={form.broker}
            onChange={(e) => setForm({ ...form, broker: e.target.value })}>
            <option value="">manual</option>
            <option value="zerodha">Zerodha (Kite)</option>
            <option value="robinhood">Robinhood</option>
          </FormField>
          <label className="vg-check" style={{ display: "block", margin: "8px 0" }}>
            <input type="checkbox" checked={form.taxable}
              onChange={(e) => setForm({ ...form, taxable: e.target.checked })} /> Taxable account
          </label>
          {err && <div className="vg-neg" style={{ fontSize: 12, marginBottom: 8 }}>{err}</div>}
          <div className="vg-row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy === "save"} onClick={save}>
              {busy === "save" ? "Saving…" : (editId ? "Save changes" : "Create account")}
            </Button>
          </div>
        </div>
      )}
      {err && !adding && <div className="vg-neg" style={{ fontSize: 12, marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function SettingsModal({ settings, accounts = [], onSave, onClose }) {
  const [draft, setDraft] = useState(settings);
  return (
    <Modal title="Settings" open onClose={onClose}>
      <div className="vg-kicker">Accounts</div>
      <AccountsSettings />
      <div className="vg-kicker" style={{ marginTop: 16 }}>Preferences</div>
      <FormField as="select" label="Default view" id="set-acct" value={draft.defaultAccount}
        onChange={(e) => setDraft({ ...draft, defaultAccount: e.target.value })}>
        <option value="all">All accounts</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.short || a.id}</option>)}
      </FormField>
      <FormField label="Harvest threshold ($ loss per lot)" type="number" id="set-usd"
        value={String(draft.thresholdUsd)}
        onChange={(e) => setDraft({ ...draft, thresholdUsd: Number(e.target.value) || 0 })} />
      <FormField label="Harvest threshold (% loss)" type="number" id="set-pct"
        value={String(draft.thresholdPct)}
        onChange={(e) => setDraft({ ...draft, thresholdPct: Number(e.target.value) || 0 })} />
      <FormField label="Marginal tax rate (%) — used for benefit estimates" type="number" id="set-tax"
        value={String(draft.taxRate)}
        onChange={(e) => setDraft({ ...draft, taxRate: Number(e.target.value) || 0 })} />
      <div className="vg-kicker" style={{ marginTop: 16 }}>Mira / AI</div>
      <FormField as="select" label="AI assistant" id="set-ai" value={draft.aiBackend}
        onChange={(e) => setDraft({ ...draft, aiBackend: e.target.value })}>
        <option value="mira">Mira (live when reachable, canned fallback)</option>
        <option value="off">Off — canned demo replies only</option>
      </FormField>
      <FormField label="Mira URL" id="set-mira-url" value={draft.miraUrl}
        onChange={(e) => setDraft({ ...draft, miraUrl: e.target.value.trim() })} />
      <div className="vg-kicker" style={{ marginTop: 16 }}>Backend</div>
      <FormField label="Backend URL (portfolio API)" id="set-backend-url" value={draft.backendUrl}
        onChange={(e) => setDraft({ ...draft, backendUrl: e.target.value.trim() })} />
      <div className="vg-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(draft)}>Save</Button>
      </div>
    </Modal>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
