// Vantage — cross-account portfolio & market intelligence prototype.
// v2: sidebar navigation + hash-routed views (one job per screen).
import {
  ACCOUNTS, MARKET, LOTS, TICKER_STRIP, AI_INSIGHTS, AI_PICKS, SIGNALS, SECTORS,
  NOTIFICATIONS_SEED, NOTIF_TYPES, CHAT_RULES, ALLOCATION_TARGETS, ASSET_CLASSES,
} from "./data.js";
import {
  usd, signUsd, signPct, cls, dirCls, daysAgo, fmtDate, lotValue, lotUnrl, acctOf, registerAccounts,
  positions, tlhCandidates, allocation, accountValue, isOptionSym, isSleeveSym, underlyingOf,
  loadSettings, SETTINGS_KEY, StatTile, heatTint, syncedAgo,
} from "./util.jsx";
import { ChartsView, ChartsRail } from "./charts.jsx";
import { OptionsView } from "./options.jsx";
import { TradeAnalyticsView } from "./trades.jsx";
import * as live from "./live.js";
import { useLive, mapPositions, mapTlh, mapAllocation, mapSignals, mapHistory, mapAnalysis } from "./live.js";

const { useState, useMemo, useEffect, useRef } = React;
const { Navbar, Button, Modal, FormField, SecurityCard, FAQItem } = window.LookeyDS;

/* ---------------- navigation ---------------- */
const NAV = [
  { group: "Portfolio", items: [
    { id: "overview", label: "Overview", icon: "◫" },
    { id: "holdings", label: "Holdings", icon: "▤" },
    { id: "activity", label: "Activity", icon: "⇅" },
    { id: "tax", label: "Tax Center", icon: "🌾" },
    { id: "recs", label: "Recommendations", icon: "✦" },
  ]},
  { group: "Intelligence", items: [
    { id: "markets", label: "Market Intel", icon: "📈" },
    { id: "options", label: "Options Intel", icon: "◎" },
    { id: "trades", label: "Trade Analytics", icon: "🧮" },
    { id: "charts", label: "AI Charts", icon: "📊" },
  ]},
];
const ROUTES = NAV.flatMap((g) => g.items.map((i) => i.id));

function useHashRoute() {
  const initial = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    return ROUTES.includes(h) ? h : "overview";
  };
  const [route, setRoute] = useState(initial);
  useEffect(() => {
    const onHash = () => setRoute(initial());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (r) => {
    window.location.hash = `/${r}`;
    // Panels scroll independently now — reset the center canvas, not the window.
    const center = document.getElementById("vg-center");
    if (center) center.scrollTo({ top: 0 });
  };
  return [route, go];
}

/* ---------------- app shell ---------------- */
function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [accountId, setAccountId] = useState(settings.defaultAccount);
  const [symbol, setSymbol] = useState("SPY");
  const [route, go] = useHashRoute();
  const [notifs, setNotifs] = useState(NOTIFICATIONS_SEED);
  const [notifOpen, setNotifOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analysisSym, setAnalysisSym] = useState(null);
  // NotebookLM-style collapsible side panels (component state; default from viewport).
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 860);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth >= 1100);
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

  // TLH: fixture math is the fallback; the backend engine takes over when live.
  const tlhFixture = useMemo(() => tlhCandidates(settings), [settings]);
  const tlh = useLive(() => live.tlh(settings).then(mapTlh), tlhFixture, [settings]).data;

  // Account scope rail: live /api/accounts (includes imported accounts like
  // Robinhood) with the fixture registry as the offline fallback.
  // Demo accounts show only until live data resolves (or on a cold start with
  // no backend). Once the account fetch has succeeded once, a later failure is
  // an outage and the rail blanks (useLive blankOnOutage) — no fake accounts.
  const acctFixture = useMemo(
    () => ACCOUNTS.map((a) => ({ id: a.id, short: a.short, type: a.type, value: accountValue(a.id) })),
    [],
  );
  const scopeLive = useLive(
    () => live.accounts().then((p) => {
      if (!p || !p.accounts) return null;
      registerAccounts(p.accounts);
      return p.accounts.map((a) => ({
        id: a.id, short: a.short, type: a.type, value: a.value,
        lastSynced: a.last_synced, broker: a.broker, refreshable: a.refreshable,
      }));
    }),
    acctFixture,
    [settings, refreshNonce], // re-fetch the rail after a refresh completes
    { blankOnOutage: true },
  );
  const scopeAccounts = scopeLive.data;
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

  const viewProps = { accountId, setAccountId, symbol, setSymbol, settings, tlh, go, setAnalysisSym, setNotifOpen, refreshNonce };
  const hasChartRail = route === "charts";

  return (
    <div className="vg-app">
      <div className="vg-compliance">
        AI-generated analysis · Educational purposes only — not financial, investment, or tax advice
      </div>

      <Navbar
        brand="Vant" brandAccent="age"
        links={[]}
        cta={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 18 }}>
            <LiveStatusDots settings={settings} />
            <Button variant="primary" onClick={() => setSettingsOpen(true)}>Settings</Button>
          </span>
        }
      />

      <div className="vg-ticker">
        {TICKER_STRIP.map((t) => (
          <span className="vg-tick" key={t.sym}>
            <b>{t.label}</b> {t.price}
            <span className={dirCls(t.pct)}>{signPct(t.pct)}</span>
          </span>
        ))}
      </div>

      <div className="vg-studio">
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
                <div className="vg-scope-head">
                  <div className="vg-kicker">Account scope</div>
                  {/* Global refresh: re-pull every API-broker account. */}
                  <button
                    className={cls("vg-refresh", refreshing.all && "spinning")}
                    title="Refresh all accounts (re-pull holdings + transactions)"
                    aria-label="Refresh all accounts"
                    disabled={!!refreshing.all}
                    onClick={onRefreshAll}
                  >
                    <span className="ic">⟳</span>
                  </button>
                </div>
                <button className={cls("vg-acct", accountId === "all" && "sel")} onClick={() => setAccountId("all")}>
                  <div>
                    <div>All accounts</div>
                    <div className="meta">{scopeAccounts.length} linked</div>
                  </div>
                  <span className="bal">{usd(scopeAccounts.reduce((s, a) => s + a.value, 0))}</span>
                </button>
                {scopeAccounts.map((a) => {
                  // refreshable === false -> a CSV-only broker (no live API): the
                  // ⟳ is disabled and honest ("re-import CSV to refresh").
                  const csvOnly = a.refreshable === false;
                  const pending = !!refreshing[a.id];
                  return (
                    <div key={a.id} className={cls("vg-acct", accountId === a.id && "sel")} style={{ cursor: "default" }}>
                      <button
                        onClick={() => setAccountId(a.id)}
                        style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0 }}
                        title={`Scope to ${a.short}`}
                      >
                        <div>{a.short}</div>
                        <div className="meta">{a.type}</div>
                        {a.lastSynced !== undefined && (
                          <div className="synced">synced {syncedAgo(a.lastSynced)}</div>
                        )}
                      </button>
                      <span className="bal">{usd(a.value)}</span>
                      <span className="actions">
                        <button
                          className={cls("vg-refresh", pending && "spinning")}
                          title={csvOnly
                            ? "re-import CSV to refresh — no live API"
                            : `Refresh ${a.short} (re-pull holdings + transactions)`}
                          aria-label={`Refresh ${a.short}`}
                          disabled={pending || csvOnly}
                          onClick={(e) => { e.stopPropagation(); if (!csvOnly) onRefreshAccount(a.id); }}
                        >
                          <span className="ic">⟳</span>
                        </button>
                      </span>
                    </div>
                  );
                })}
                {refreshNote && (
                  <p className={cls("vg-note")} style={{ marginTop: 8, padding: "0 4px", color: refreshNote.tone === "warn" ? "var(--color-grey)" : undefined }}>
                    {refreshNote.text}
                  </p>
                )}
                {scopeAccounts.length === 0 && scopeOutage && (
                  <p className="vg-note" style={{ marginTop: 8, padding: "0 4px" }}>
                    Backend unreachable — no accounts to show. Start the Vantage server, or import a broker.
                  </p>
                )}
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
          {route === "overview" && <OverviewView {...viewProps} notifs={notifs} />}
          {route === "holdings" && <HoldingsView {...viewProps} />}
          {route === "activity" && <ActivityView {...viewProps} />}
          {route === "tax" && <TaxView {...viewProps} />}
          {route === "recs" && <RecsView {...viewProps} />}
          {route === "markets" && <MarketsView {...viewProps} />}
          {route === "options" && <OptionsView accountId={accountId} setSymbol={setSymbol} go={go} />}
          {route === "trades" && <TradeAnalyticsView {...viewProps} />}
          {route === "charts" && <ChartsView symbol={symbol} setSymbol={setSymbol} />}
        </main>

        {/* -------- right pane: contextual AI rail (charts) or docked chat -------- */}
        <aside className={cls("vg-pane", "vg-pane-right", !rightOpen && "clps")}>
          <div className="vg-pane-top">
            <button className="vg-collapse" title={rightOpen ? "Collapse panel" : "Expand panel"}
              aria-label={rightOpen ? "Collapse AI panel" : "Expand AI panel"}
              onClick={() => setRightOpen(!rightOpen)}>
              {rightOpen ? "»" : "«"}
            </button>
            {rightOpen && (
              <span className="vg-kicker" style={{ marginBottom: 0 }}>
                {hasChartRail ? "AI insights" : "Vantage AI"}
              </span>
            )}
          </div>
          {!rightOpen && <span className="vg-sparkle" aria-hidden="true">✦</span>}
          {rightOpen && (hasChartRail
            ? <div className="vg-pane-body vg-rail"><ChartsRail symbol={symbol} /></div>
            : <ChatPanel docked settings={settings} />)}
        </aside>
      </div>

      <div className="vg-fabs">
        <button className="vg-fab" aria-label="Notifications" onClick={() => setNotifOpen(true)}>
          🔔{unread > 0 && <span className="cnt">{unread}</span>}
        </button>
        {(hasChartRail || !rightOpen) && (
          <button className="vg-fab" aria-label="Vantage AI chat" onClick={() => setChatOpen(true)}>💬</button>
        )}
      </div>

      {notifOpen && (
        <NotifPanel notifs={notifs} setNotifs={setNotifs} settings={settings} saveSettings={saveSettings}
          onClose={() => setNotifOpen(false)} />
      )}
      {chatOpen && <ChatPanel settings={settings} onClose={() => setChatOpen(false)} />}
      {settingsOpen && (
        <SettingsModal settings={settings} onSave={(s) => { saveSettings(s); setSettingsOpen(false); }}
          onClose={() => setSettingsOpen(false)} />
      )}
      {analysisSym && <AnalysisModal stock={analysisSym} onClose={() => setAnalysisSym(null)} />}
    </div>
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
    display: "inline-block", width: 8, height: 8, borderRadius: "50%", marginRight: 5,
    background: ok ? "var(--vg-success-deep)" : "var(--color-grey)",
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
function OverviewView({ accountId, settings, tlh, go, notifs, setNotifOpen, refreshNonce }) {
  const posFixture = useMemo(() => positions(accountId), [accountId]);
  const pos = useLive(() => live.positions(accountId).then(mapPositions), posFixture, [accountId, settings, refreshNonce], { blankOnOutage: true }).data;
  const allocFixture = useMemo(() => allocation(accountId), [accountId]);
  const alloc = useLive(() => live.allocation(accountId).then(mapAllocation), allocFixture, [accountId, settings, refreshNonce]).data;
  const totalValue = alloc.total;
  const dayPl = pos.reduce((s, p) => s + p.dayPl, 0);
  const unrlPl = pos.reduce((s, p) => s + p.unrl, 0);
  const harvestable = tlh.filter((c) => c.status === "clear");
  const harvestableLoss = harvestable.reduce((s, c) => s + -c.unrl, 0);
  const estBenefit = harvestableLoss * (settings.taxRate / 100);
  const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;
  const recent = notifs.slice(0, 3);

  return (
    <div>
      <div className="vg-spread">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Overview</h2>
          <p className="vg-sub">{acctLabel} · marked to last close</p>
        </div>
      </div>
      <div className="vg-stats">
        <StatTile label="Total value" value={usd(totalValue)} />
        <StatTile label="Day P/L" value={signUsd(dayPl)} deltaDir={dirCls(dayPl)}
          delta={signPct((dayPl / (totalValue - dayPl)) * 100)} />
        <StatTile label="Unrealized P/L" value={signUsd(unrlPl)} deltaDir={dirCls(unrlPl)}
          delta={signPct((unrlPl / (totalValue - unrlPl)) * 100)} />
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

      <div className="vg-grid2" style={{ marginTop: 14 }}>
        <div className="vg-card">
          <div className="vg-spread">
            <div className="vg-kicker" style={{ marginBottom: 0 }}>Top actions</div>
            <button className="vg-linkbtn" onClick={() => go("recs")}>All recommendations →</button>
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <SecurityCard accent="teal" title={`Harvest IWM → ≈ ${usd(1513 * settings.taxRate / 100)} benefit`}>
              Clear in all 4 accounts. Replace with IJR to keep exposure.
            </SecurityCard>
            <SecurityCard accent="orange" title="Pause Jul VOO auto-buy">
              Wealthfront's auto-invest is washing the Fidelity VOO loss.
            </SecurityCard>
          </div>
        </div>
        <div className="vg-card">
          <div className="vg-spread">
            <div className="vg-kicker" style={{ marginBottom: 0 }}>Latest alerts</div>
            <button className="vg-linkbtn" onClick={() => setNotifOpen(true)}>Open inbox →</button>
          </div>
          <div style={{ marginTop: 10 }}>
            {recent.map((n) => (
              <div key={n.id} className={cls("vg-notif", !n.read && "unread")} style={{ cursor: "default" }}>
                {!n.read && <span className="vg-dot" />}
                <div>
                  <div className="t">{NOTIF_TYPES[n.type].icon} {n.title}</div>
                  <div className="when">{n.time} · {NOTIF_TYPES[n.type].label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
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

function HoldingsView({ accountId, settings, go, setSymbol, refreshNonce }) {
  const [expanded, setExpanded] = useState({});
  const [sortKey, setSortKey] = useState("value");
  const [recFilter, setRecFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all"); // all | equity | option | losers
  const [query, setQuery] = useState("");

  const posFixture = useMemo(() => positions(accountId), [accountId]);
  const pos = useLive(() => live.positions(accountId).then(mapPositions), posFixture, [accountId, settings, refreshNonce], { blankOnOutage: true }).data;
  // Journal decisions indexed by underlying — an option contract inherits its
  // underlying's read; a plain ticker maps to its own decision.
  const analysis = useLive(() => live.getAnalysis().then(mapAnalysis), null, [settings]).data;
  const byUnderlying = useMemo(() => {
    const m = {};
    for (const d of (analysis?.decisions || [])) m[underlyingOf(d.symbol)] = d;
    return m;
  }, [analysis]);

  const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;

  const rows = useMemo(() => {
    const withRec = pos
      .filter((p) => p.symbol !== "CASH")
      .map((p) => ({ ...p, _rec: byUnderlying[underlyingOf(p.symbol)] || null }));
    const q = query.trim().toUpperCase();
    const filtered = withRec.filter((p) => {
      if (q && !p.symbol.toUpperCase().includes(q)) return false;
      if (kindFilter === "option" && !isOptionSym(p.symbol)) return false;
      if (kindFilter === "equity" && (isOptionSym(p.symbol) || isSleeveSym(p.symbol))) return false;
      if (kindFilter === "losers" && !(p.unrl < 0)) return false;
      if (recFilter === "actionable" && (REC_ORDER[p._rec?.recommendation] ?? 9) > 1) return false;
      if (recFilter !== "all" && recFilter !== "actionable" && p._rec?.recommendation !== recFilter) return false;
      return true;
    });
    const s = HOLD_SORTS[sortKey] || HOLD_SORTS.value;
    return filtered.sort((a, b) => {
      const ka = s.key(a), kb = s.key(b);
      const cmp = typeof ka === "string" ? ka.localeCompare(kb) : ka - kb;
      return cmp * s.dir;
    });
  }, [pos, byUnderlying, query, kindFilter, recFilter, sortKey]);

  const openChart = (sym) => { if (setSymbol) setSymbol(underlyingOf(sym)); if (go) go("charts"); };
  const actionable = rows.filter((p) => (REC_ORDER[p._rec?.recommendation] ?? 9) <= 1).length;

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Holdings</h2>
      <p className="vg-sub">
        {acctLabel} · {rows.length} shown{analysis ? ` · ${actionable} actionable` : ""} · click a row for per-lot detail
      </p>

      <div className="vg-spread" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div className="vg-pills">
          {[["all", "All"], ["equity", "Equities"], ["option", "Options"], ["losers", "Losers"]].map(([k, l]) => (
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
            {rows.map((p) => {
              const opt = isOptionSym(p.symbol);
              const sleeve = p.symbol === "CRYPTO" || p.symbol === "FUTURES";
              const noDay = (opt || sleeve) && !p.dayPl;
              return (
              <React.Fragment key={p.symbol}>
                <tr className="click" onClick={() => setExpanded((e) => ({ ...e, [p.symbol]: !e[p.symbol] }))}>
                  <td>
                    <b>{p.symbol}</b>
                    {opt && <span className="vg-chip" style={{ marginLeft: 6 }} title="option contract">OPT</span>}
                    {p.overlap && accountId === "all" && (
                      <span className="vg-badge info" style={{ marginLeft: 6 }} title={`Held as ${p.overlap.symbols.join(", ")}`}>Overlap</span>
                    )}
                    {!sleeve && p.weight > 7 && ((MARKET[p.symbol] || {}).name || "").indexOf("ETF") === -1 && (
                      <span className="vg-badge warn" style={{ marginLeft: 6 }}>Concentrated</span>
                    )}
                    <div className="vg-note">
                      {(MARKET[p.symbol] || {}).name || (sleeve ? "sleeve — value via Robinhood portfolio" : "")}
                    </div>
                  </td>
                  <td className="num">{usd(p.value)}</td>
                  <td className={cls("num", dirCls(p.dayPl))}>{noDay ? "—" : signUsd(p.dayPl)}</td>
                  <td className={cls("num", dirCls(p.unrl))}>{signUsd(p.unrl)}</td>
                  <td className="num">{p.weight.toFixed(1)}%</td>
                  <td>{sleeve ? <span className="vg-note">—</span> : <HoldingRec d={p._rec} onOpen={openChart} />}</td>
                </tr>
                {expanded[p.symbol] && p.lots.map((l, i) => (
                  <tr className="vg-subrow" key={i}>
                    <td style={{ paddingLeft: 26 }}>lot · {fmtDate(l.date)}</td>
                    <td className="num">{usd(lotValue(l))}</td>
                    <td className="num">{`${l.shares} sh @ ${usd(l.costPerShare, 2)}`}</td>
                    <td className={cls("num", dirCls(lotUnrl(l)))}>{signUsd(lotUnrl(l))}</td>
                    <td className="num" colSpan={2}>{daysAgo(l.date) > 365 ? "long-term" : "short-term"}</td>
                  </tr>
                ))}
              </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="vg-note" style={{ padding: 16 }}>No holdings match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
function TaxView({ settings, tlh }) {
  const [washFaqOpen, setWashFaqOpen] = useState(false);
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Tax Center — loss harvesting</h2>
      <p className="vg-sub">
        Every lot marked to last close · wash-sale window checked across <b>all {ACCOUNTS.length} accounts</b> ·
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
  const jump = (sym) => { setSymbol(sym); go("charts"); };

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

/* ================= Market Intel ================= */
function MarketsView({ symbol, setSymbol, setAnalysisSym, go, settings }) {
  const [signalsTab, setSignalsTab] = useState("active");
  // Mira advisor report (live) replaces the fixture "AI picks" panel when available.
  const miraOn = settings.aiBackend === "mira";
  const insights = useLive(() => (miraOn ? live.getInsights() : null), null, [settings]);
  const report = insights.data;
  // Signals: backend-graded when live (statuses computed from quotes, never
  // authored), fixture rows otherwise. "Past" = resolved (hit target / stopped);
  // everything else — active and unquoted — stays on the Active tab.
  const signals = useLive(() => live.getSignals().then(mapSignals), SIGNALS, [settings]).data;
  const isPastSignal = (s) => s.status === "hit-target" || s.status === "stopped";
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Market intelligence</h2>
      <p className="vg-sub">AI-generated market read · educational only, not trade recommendations</p>

      <div className="vg-card">
        <div className="vg-spread">
          <div className="vg-pills">
            {Object.keys(AI_INSIGHTS).map((s) => (
              <button key={s} className={cls("vg-pill", symbol === s && "sel")} onClick={() => setSymbol(s)}>{s}</button>
            ))}
          </div>
          <div className="vg-row">
            <span className={cls("vg-bias", AI_INSIGHTS[symbol].bias)}>{AI_INSIGHTS[symbol].bias}</span>
            <button className="vg-linkbtn" onClick={() => go("charts")}>Open on AI Charts →</button>
          </div>
        </div>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: "14px 0" }}>{AI_INSIGHTS[symbol].summary}</p>
        <div className="vg-grid2">
          <div>
            <div className="vg-spread" style={{ fontSize: 12.5, color: "var(--color-grey)" }}>
              <span>Momentum</span><span>{AI_INSIGHTS[symbol].momentum}/100</span>
            </div>
            <div className="vg-meter"><span style={{ width: `${AI_INSIGHTS[symbol].momentum}%` }} /></div>
          </div>
          <div>
            <div className="vg-spread" style={{ fontSize: 12.5, color: "var(--color-grey)" }}>
              <span>Sentiment</span><span>{AI_INSIGHTS[symbol].sentiment}/100</span>
            </div>
            <div className="vg-meter"><span style={{ width: `${AI_INSIGHTS[symbol].sentiment}%`, background: "var(--color-secondary)" }} /></div>
          </div>
        </div>
      </div>

      {report ? (
        <div className="vg-card" style={{ marginTop: 14 }}>
          <div className="vg-spread">
            <div className="vg-kicker" style={{ marginBottom: 0 }}>Mira advisor insights</div>
            <span className="vg-row">
              <span className="vg-badge good">● live</span>
              {report.confidence != null && <span className="vg-note">confidence {report.confidence}</span>}
            </span>
          </div>
          {report.summary && <p style={{ fontSize: 14, lineHeight: 1.55, margin: "12px 0" }}>{report.summary}</p>}
          {Array.isArray(report.observations) && report.observations.length > 0 && (
            <div className="vg-tablewrap">
              <table className="vg-table">
                <tbody>
                  {report.observations.map((o, i) => (
                    <tr key={i}>
                      <td style={{ width: 140 }}><b>{o.topic}</b></td>
                      <td>
                        {o.detail}
                        {o.evidence && <div className="vg-note">{o.evidence}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.caveats && (Array.isArray(report.caveats) ? report.caveats.length > 0 : true) && (
            <p className="vg-note" style={{ marginTop: 8 }}>
              {Array.isArray(report.caveats) ? report.caveats.join(" · ") : String(report.caveats)}
            </p>
          )}
        </div>
      ) : (
        <div className="vg-card" style={{ marginTop: 14 }}>
          <div className="vg-kicker">Today's AI picks</div>
          <div className="vg-tablewrap">
            <table className="vg-table">
              <tbody>
                {AI_PICKS.map((p) => (
                  <tr key={p.sym} className="click" onClick={() => AI_INSIGHTS[p.sym] && setSymbol(p.sym)}>
                    <td style={{ width: 70 }}><b>{p.sym}</b></td>
                    <td><span className={cls("vg-bias", p.stance)} style={{ fontSize: 12 }}>{p.stance}</span></td>
                    <td className="vg-note">{p.note}</td>
                    <td className="num" style={{ width: 90 }}>{p.conf}% conf</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="vg-card" style={{ marginTop: 14 }}>
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

      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-spread" style={{ marginBottom: 12 }}>
          <div className="vg-kicker" style={{ marginBottom: 0 }}>Sector heatmap — S&P 100, 1-day change</div>
          <span className="vg-note">green = up · red = down · click a stock for detail</span>
        </div>
        <div className="vg-heat">
          {SECTORS.map((sec) => (
            <div className="vg-heat-sector" key={sec.name}>
              <h4>
                {sec.name}
                <span style={{ color: sec.pct >= 0 ? "var(--vg-success-deep)" : "var(--vg-danger)" }}>
                  {signPct(sec.pct)}
                </span>
              </h4>
              <div className="vg-heat-tiles">
                {sec.stocks.map((st) => (
                  <button key={st.sym} className="vg-heat-tile" style={{ background: heatTint(st.pct) }}
                    onClick={() => setAnalysisSym(st)}>
                    <div className="s">{st.sym}</div>
                    <div className="p">{signPct(st.pct)}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
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
  const cannedReply = (text) => CHAT_RULES.find((r) => r.match.test(text)).reply;

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
              {m.text || (m.pending ? "…" : "")}
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

function SettingsModal({ settings, onSave, onClose }) {
  const [draft, setDraft] = useState(settings);
  return (
    <Modal title="Settings" open onClose={onClose}>
      <FormField as="select" label="Default view" id="set-acct" value={draft.defaultAccount}
        onChange={(e) => setDraft({ ...draft, defaultAccount: e.target.value })}>
        <option value="all">All accounts</option>
        {ACCOUNTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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

function AnalysisModal({ stock, onClose }) {
  const insight = AI_INSIGHTS[stock.sym];
  const held = LOTS.filter((l) => l.symbol === stock.sym);
  const [why, setWhy] = useState(false);
  return (
    <Modal title={`${stock.sym} — analysis`} open onClose={onClose}>
      <div className="vg-row" style={{ marginBottom: 12 }}>
        <span className={cls("vg-badge", stock.pct >= 0 ? "good" : "bad")}>{signPct(stock.pct)} today</span>
        {insight && <span className={cls("vg-bias", insight.bias)} style={{ fontSize: 12 }}>{insight.bias}</span>}
        {held.length > 0
          ? <span className="vg-badge info">You hold this in {[...new Set(held.map((l) => acctOf(l.account).short))].join(", ")}</span>
          : <span className="vg-badge plain">Not held</span>}
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.5 }}>
        {insight ? insight.summary : `No AI note for ${stock.sym} in this demo — showing market context only. Sector move ${signPct(stock.pct)} on the day.`}
      </p>
      <FAQItem question="How is this rating generated?" open={why} onToggle={() => setWhy(!why)}>
        In the real product this blends trend, momentum, volume and options-flow features into a single bias score.
        In this prototype it is illustrative mock data — educational only, never trading advice.
      </FAQItem>
    </Modal>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
