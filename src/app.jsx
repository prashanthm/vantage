// Vantage — cross-account portfolio & market intelligence prototype.
// v2: sidebar navigation + hash-routed views (one job per screen).
import {
  ACCOUNTS, MARKET, LOTS, TICKER_STRIP, AI_INSIGHTS, AI_PICKS, SIGNALS, SECTORS,
  NOTIFICATIONS_SEED, NOTIF_TYPES, CHAT_RULES, ALLOCATION_TARGETS, ASSET_CLASSES,
} from "./data.js";
import {
  usd, signUsd, signPct, cls, dirCls, daysAgo, fmtDate, lotValue, lotUnrl, acctOf,
  positions, tlhCandidates, allocation, accountValue,
  loadSettings, SETTINGS_KEY, StatTile, heatTint,
} from "./util.jsx";
import { ChartsView } from "./charts.jsx";
import { OptionsView } from "./options.jsx";

const { useState, useMemo, useEffect, useRef } = React;
const { Navbar, Button, Modal, FormField, SecurityCard, FAQItem } = window.LookeyDS;

/* ---------------- navigation ---------------- */
const NAV = [
  { group: "Portfolio", items: [
    { id: "overview", label: "Overview", icon: "◫" },
    { id: "holdings", label: "Holdings", icon: "▤" },
    { id: "tax", label: "Tax Center", icon: "🌾" },
    { id: "recs", label: "Recommendations", icon: "✦" },
  ]},
  { group: "Intelligence", items: [
    { id: "markets", label: "Market Intel", icon: "📈" },
    { id: "options", label: "Options Intel", icon: "◎" },
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
  const go = (r) => { window.location.hash = `/${r}`; window.scrollTo({ top: 0 }); };
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

  const tlh = useMemo(() => tlhCandidates(settings), [settings]);
  const unread = notifs.filter((n) => !n.read && settings.notifPrefs[n.type]).length;

  const saveSettings = (next) => {
    setSettings(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
  };

  const viewProps = { accountId, setAccountId, symbol, setSymbol, settings, tlh, go, setAnalysisSym, setNotifOpen };

  return (
    <div>
      <div className="vg-compliance">
        AI-generated analysis · Demo with simulated data · Educational purposes only — not financial, investment, or tax advice
      </div>

      <Navbar
        brand="Vant" brandAccent="age"
        links={[
          { label: "Portfolio", href: "#/overview" },
          { label: "Markets", href: "#/markets" },
          { label: "Options", href: "#/options" },
          { label: "Charts", href: "#/charts" },
        ]}
        cta={<Button variant="primary" onClick={() => setSettingsOpen(true)}>Settings</Button>}
      />

      <div className="vg-ticker">
        {TICKER_STRIP.map((t) => (
          <span className="vg-tick" key={t.sym}>
            <b>{t.label}</b> {t.price}
            <span className={dirCls(t.pct)}>{signPct(t.pct)}</span>
          </span>
        ))}
      </div>

      <div className="vg-shell">
        <div className="vg-main">
          {/* -------- sidebar -------- */}
          <aside className="vg-side">
            <nav className="vg-card" style={{ padding: 12 }}>
              {NAV.map((g) => (
                <div key={g.group}>
                  <div className="vg-kicker" style={{ margin: "10px 8px 4px" }}>{g.group}</div>
                  {g.items.map((it) => (
                    <button key={it.id} className={cls("vg-navitem", route === it.id && "sel")} onClick={() => go(it.id)}>
                      <span className="ic">{it.icon}</span> {it.label}
                      {it.id === "tax" && tlh.some((c) => c.status === "clear") && <span className="vg-navdot" />}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <div className="vg-card" style={{ padding: 14 }}>
              <div className="vg-kicker">Account scope</div>
              <button className={cls("vg-acct", accountId === "all" && "sel")} onClick={() => setAccountId("all")}>
                <div>
                  <div>All accounts</div>
                  <div className="meta">{ACCOUNTS.length} linked</div>
                </div>
                <span className="bal">{usd(LOTS.reduce((s, l) => s + lotValue(l), 0))}</span>
              </button>
              {ACCOUNTS.map((a) => (
                <button key={a.id} className={cls("vg-acct", accountId === a.id && "sel")} onClick={() => setAccountId(a.id)}>
                  <div>
                    <div>{a.short}</div>
                    <div className="meta">{a.type}</div>
                  </div>
                  <span className="bal">{usd(accountValue(a.id))}</span>
                </button>
              ))}
              <p className="vg-note" style={{ marginTop: 10 }}>
                Read-only aggregation (demo). Vantage never holds funds or places orders.
              </p>
            </div>
          </aside>

          {/* -------- routed view -------- */}
          <main>
            {route === "overview" && <OverviewView {...viewProps} notifs={notifs} />}
            {route === "holdings" && <HoldingsView {...viewProps} />}
            {route === "tax" && <TaxView {...viewProps} />}
            {route === "recs" && <RecsView {...viewProps} />}
            {route === "markets" && <MarketsView {...viewProps} />}
            {route === "options" && <OptionsView setSymbol={setSymbol} go={go} />}
            {route === "charts" && <ChartsView symbol={symbol} setSymbol={setSymbol} />}
          </main>
        </div>

        <p className="vg-note" style={{ textAlign: "center", marginTop: 40 }}>
          Vantage prototype · built on the Lookey design system · simulated data · AI analysis is educational only —
          not financial, investment, or tax advice.
        </p>
      </div>

      <div className="vg-fabs">
        <button className="vg-fab" aria-label="Notifications" onClick={() => setNotifOpen(true)}>
          🔔{unread > 0 && <span className="cnt">{unread}</span>}
        </button>
        <button className="vg-fab" aria-label="Vantage AI chat" onClick={() => setChatOpen(true)}>💬</button>
      </div>

      {notifOpen && (
        <NotifPanel notifs={notifs} setNotifs={setNotifs} settings={settings} saveSettings={saveSettings}
          onClose={() => setNotifOpen(false)} />
      )}
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      {settingsOpen && (
        <SettingsModal settings={settings} onSave={(s) => { saveSettings(s); setSettingsOpen(false); }}
          onClose={() => setSettingsOpen(false)} />
      )}
      {analysisSym && <AnalysisModal stock={analysisSym} onClose={() => setAnalysisSym(null)} />}
    </div>
  );
}

/* ================= Overview ================= */
function OverviewView({ accountId, settings, tlh, go, notifs, setNotifOpen }) {
  const pos = useMemo(() => positions(accountId), [accountId]);
  const alloc = useMemo(() => allocation(accountId), [accountId]);
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
function HoldingsView({ accountId, setAnalysisSym }) {
  const [expanded, setExpanded] = useState({});
  const pos = useMemo(() => positions(accountId), [accountId]);
  const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Holdings</h2>
      <p className="vg-sub">
        {acctLabel} · {pos.filter((p) => p.symbol !== "CASH").length} positions · click a row for per-lot detail
      </p>
      <div className="vg-card vg-tablewrap" style={{ padding: "8px 12px" }}>
        <table className="vg-table">
          <thead>
            <tr>
              <th>Symbol</th><th>Accounts</th><th className="num">Value</th>
              <th className="num">Day</th><th className="num">Unrealized</th>
              <th className="num">Weight</th><th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((p) => (
              <React.Fragment key={p.symbol}>
                <tr className="click" onClick={() => setExpanded((e) => ({ ...e, [p.symbol]: !e[p.symbol] }))}>
                  <td>
                    <b>{p.symbol === "CASH" ? "Cash" : p.symbol}</b>
                    <div className="vg-note">{MARKET[p.symbol].name}</div>
                  </td>
                  <td>
                    {[...p.accounts].map((id) => <span className="vg-chip" key={id}>{acctOf(id).short}</span>)}
                  </td>
                  <td className="num">{usd(p.value)}</td>
                  <td className={cls("num", dirCls(p.dayPl))}>{p.symbol === "CASH" ? "—" : signUsd(p.dayPl)}</td>
                  <td className={cls("num", dirCls(p.unrl))}>{p.symbol === "CASH" ? "—" : signUsd(p.unrl)}</td>
                  <td className="num">{p.weight.toFixed(1)}%</td>
                  <td>
                    {p.overlap && accountId === "all" && (
                      <span className="vg-badge info" title={`Held as ${p.overlap.symbols.join(", ")}`}>
                        Overlap: {p.overlap.label}
                      </span>
                    )}
                    {p.symbol !== "CASH" && p.weight > 7 && MARKET[p.symbol].name.indexOf("ETF") === -1 && (
                      <span className="vg-badge warn">Concentrated</span>
                    )}
                  </td>
                </tr>
                {expanded[p.symbol] && p.lots.map((l, i) => (
                  <tr className="vg-subrow" key={i}>
                    <td style={{ paddingLeft: 26 }}>lot · {fmtDate(l.date)}</td>
                    <td>{acctOf(l.account).short}</td>
                    <td className="num">{usd(lotValue(l))}</td>
                    <td className="num">{l.symbol === "CASH" ? "—" : `${l.shares} sh @ ${usd(l.costPerShare, 2)}`}</td>
                    <td className={cls("num", dirCls(lotUnrl(l)))}>{l.symbol === "CASH" ? "—" : signUsd(lotUnrl(l))}</td>
                    <td className="num" colSpan={2}>{l.symbol === "CASH" ? "" : `${daysAgo(l.date) > 365 ? "long-term" : "short-term"}`}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
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
function RecsView({ settings, go }) {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Recommendations</h2>
      <p className="vg-sub">Ranked by estimated annual impact · generated from cross-account analysis</p>
      <div className="vg-grid2">
        <SecurityCard accent="teal" title={`Harvest IWM loss → ≈ ${usd(1513 * settings.taxRate / 100)} benefit`}>
          Fidelity IWM lot is −$1,513. No conflicting buys in any account. Sell IWM, buy IJR to keep small-cap
          exposure with a different index.
        </SecurityCard>
        <SecurityCard accent="orange" title="Pause Jul VOO auto-buy before harvesting">
          The VOO loss in Fidelity (−$268) is washed by Wealthfront's monthly auto-invest. Pausing one cycle
          opens a clean 31-day window.
        </SecurityCard>
        <SecurityCard accent="red" title="Concentration: NVDA is 7.9% of portfolio">
          Largest single-stock risk. Gain goes long-term Aug 15 — trimming after that date cuts the tax cost of
          de-risking roughly in half.
        </SecurityCard>
        <SecurityCard accent="purple" title="Same exposure held 3 ways">
          VOO, SPY and VTI overlap (US large blend, 54% combined). Standardize one fund per account to simplify
          rebalancing and future TLH pairs.
        </SecurityCard>
        <SecurityCard accent="blue" title="Rebalance with contributions, not sales">
          US equity is +8 pts over target. Redirect 401(k) payroll buys to BND — drift closes in ~5 months with
          zero tax cost.
        </SecurityCard>
        <SecurityCard accent="cyan" title={`Cash drag: ${usd(10500)} idle`}>
          Combined sweep cash earns ~0.4%. A money-market fund adds ≈ $430/yr at current rates without losing
          liquidity.
        </SecurityCard>
      </div>
      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-spread">
          <div>
            <div className="vg-kicker" style={{ marginBottom: 2 }}>Options income</div>
            <span className="vg-note">3 executable ideas on your book (≈ 4–11% annualized) — see Options Intelligence.</span>
          </div>
          <button className="vg-linkbtn" onClick={() => go("options")}>Open Options Intel →</button>
        </div>
      </div>
    </div>
  );
}

/* ================= Market Intel ================= */
function MarketsView({ symbol, setSymbol, setAnalysisSym, go }) {
  const [signalsTab, setSignalsTab] = useState("active");
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

      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-spread">
          <div className="vg-kicker" style={{ marginBottom: 0 }}>AI pattern signals</div>
          <div className="vg-pills">
            <button className={cls("vg-pill", signalsTab === "active" && "sel")} onClick={() => setSignalsTab("active")}>
              Active ({SIGNALS.filter((s) => s.status === "active").length})
            </button>
            <button className={cls("vg-pill", signalsTab === "past" && "sel")} onClick={() => setSignalsTab("past")}>
              Past ({SIGNALS.filter((s) => s.status !== "active").length})
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
              {SIGNALS.filter((s) => (signalsTab === "active" ? s.status === "active" : s.status !== "active")).map((s) => (
                <tr key={s.id}>
                  <td><b>{s.sym}</b><div className="vg-note">{s.time}</div></td>
                  <td>{s.pattern}</td>
                  <td className="num">{s.entry.toFixed(2)}</td>
                  <td className="num">{s.target.toFixed(2)}</td>
                  <td className="num">{s.stop.toFixed(2)}</td>
                  <td className={cls("num", dirCls(s.movePct))}>{signPct(s.movePct, 1)}</td>
                  <td className="num">{s.conf}%</td>
                  <td>
                    {s.status === "active" && <span className="vg-badge good">● Active</span>}
                    {s.status === "hit-target" && <span className="vg-badge info">✓ Hit target</span>}
                    {s.status === "stopped" && <span className="vg-badge bad">✕ Stopped</span>}
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

function ChatPanel({ onClose }) {
  const [msgs, setMsgs] = useState([
    { who: "ai", text: "Hi — I'm Vantage AI. I can see across all 4 of your linked accounts. Ask me about harvesting, wash sales, overlap, or your allocation." },
  ]);
  const [draft, setDraft] = useState("");
  const bodyRef = useRef(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setMsgs((m) => [...m, { who: "me", text }]);
    const rule = CHAT_RULES.find((r) => r.match.test(text));
    setTimeout(() => setMsgs((m) => [...m, { who: "ai", text: rule.reply }]), 450);
  };

  return (
    <div>
      <div className="vg-scrim" onClick={onClose} />
      <div className="vg-panel">
        <div className="vg-panel-head">
          <h3>Vantage AI</h3>
          <button className="vg-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="vg-panel-body" ref={bodyRef}>
          {msgs.map((m, i) => <div key={i} className={cls("vg-msg", m.who)}>{m.text}</div>)}
        </div>
        <div className="vg-chatform">
          <FormField placeholder="Ask about your portfolio…" value={draft}
            onChange={(e) => setDraft(e.target.value)} id="chat-input" />
          <Button variant="primary" onClick={send}>Send</Button>
        </div>
        <p className="vg-note" style={{ padding: "0 16px 12px", margin: 0 }}>
          Demo assistant with canned responses · educational only.
        </p>
      </div>
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
