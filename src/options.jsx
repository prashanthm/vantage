// Options Intelligence view — strategy roll-up, IV context, income ideas, flow.
import { cls, usd, signUsd } from "./util.jsx";
import { useLive, getStrategies, mapStrategies, mapByTicker } from "./live.js";

const { useState, useEffect } = React;
const { SecurityCard, FAQItem } = window.LookeyDS;

/* ---------------- strategy roll-up helpers ---------------- */
const STRAT_PAGE = 40;

// Display label rule: prefer the geometric `structure` name over the raw
// broker `name` — closed 3+ leg orders arrive as name="custom" while structure
// carries the real name ("long call butterfly"). Falls back gracefully.
const stratLabel = (s) => s.structure || s.name || "strategy";

// Small kind chip: SPREAD / BUTTERFLY / CONDOR / COMPLEX / SINGLE.
const KIND_CHIP = {
  single: "SINGLE",
  vertical: "SPREAD",
  butterfly: "BUTTERFLY",
  iron_condor: "CONDOR",
  "multi-leg": "COMPLEX",
  complex: "COMPLEX",
};
const kindChip = (kind) => KIND_CHIP[kind] || (kind ? String(kind).toUpperCase() : "STRATEGY");
// Butterflies / condors get a subtle info tint; everything else the plain chip.
const kindChipCls = (kind) =>
  kind === "butterfly" || kind === "iron_condor" ? "info" : "plain";

// "Jul 17" short expiration (raw string if unparseable).
const shortExp = (iso) => {
  const d = new Date((iso || "") + "T12:00:00");
  return isNaN(d) ? String(iso || "—") : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
// Event day+time from an ISO timestamp: { day, time }.
const stratWhen = (iso) => {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return { day: iso ? String(iso) : "—", time: "" };
  return {
    day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
};

// One leg line: "±contracts UND exp strikeC|P" with a long/short chip + avg→mark.
function StrategyLeg({ leg, underlying, expiration }) {
  const n = leg.contracts != null ? leg.contracts : (leg.ratio != null ? leg.ratio : 1);
  const dir = leg.side === "sell" ? "−" : "+";
  const oc = leg.optionType === "put" ? "P" : "C";
  const isShort = leg.positionType === "short" || leg.side === "sell";
  const parts = [];
  if (underlying) parts.push(underlying);
  if (expiration) parts.push(shortExp(expiration));
  return (
    <div className="vg-note" style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
      <span className={cls("vg-badge", isShort ? "bad" : "good")} style={{ minWidth: 44, textAlign: "center" }}>
        {isShort ? "short" : "long"}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {dir}{Math.abs(n)} {parts.join(" ")} {leg.strike != null ? leg.strike : "?"}{oc}
      </span>
      {(leg.avgPrice != null || leg.mark != null) && (
        <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
          {leg.avgPrice != null ? usd(leg.avgPrice, 2) : "—"} → {leg.mark != null ? usd(leg.mark, 2) : "—"}
        </span>
      )}
    </div>
  );
}

// One chronological leg line for a per-ticker book: "date · ±contracts ·
// strikeC|P · expiry · avg→mark" with a long/short chip.
function TickerLeg({ leg }) {
  const n = leg.contracts != null ? leg.contracts : 1;
  const dir = leg.side === "sell" ? "−" : "+";
  const oc = leg.optionType === "put" ? "P" : "C";
  const isShort = leg.positionType === "short" || leg.side === "sell";
  const opened = leg.openedAt ? shortExp(leg.openedAt) : "—";
  return (
    <div className="vg-note" style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
      <span className={cls("vg-badge", isShort ? "bad" : "good")} style={{ minWidth: 44, textAlign: "center" }}>
        {isShort ? "short" : "long"}
      </span>
      <span style={{ minWidth: 52, fontVariantNumeric: "tabular-nums" }}>{opened}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {dir}{Math.abs(n)} {leg.strike != null ? leg.strike : "?"}{oc} · {leg.expiration ? shortExp(leg.expiration) : "—"}
      </span>
      {(leg.avgPrice != null || leg.mark != null) && (
        <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
          {leg.avgPrice != null ? usd(leg.avgPrice, 2) : "—"} → {leg.mark != null ? usd(leg.mark, 2) : "—"}
        </span>
      )}
    </div>
  );
}

function TickerRow({ s, expanded, onToggle }) {
  const legs = s.legs || [];
  const isDiagonal = s.spansExpiries && s.hasShort;
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }} title="Show legs">
        <td>
          <span style={{ marginRight: 6, color: "var(--color-grey)" }}>{expanded ? "▾" : "▸"}</span>
          <b>{s.underlying || "—"}</b>
        </td>
        <td>
          {s.legCount != null ? s.legCount : legs.length}
          {isDiagonal && <span className="vg-badge warn" style={{ marginLeft: 6 }}>DIAGONAL</span>}
        </td>
        <td className="num">{s.netCost != null ? usd(s.netCost) : "—"}</td>
        <td className="num">{s.currentValue != null ? usd(s.currentValue) : "—"}</td>
        <td className={cls("num", s.unrealized == null ? "" : s.unrealized >= 0 ? "up" : "down")}>
          {s.unrealized != null ? signUsd(s.unrealized) : "—"}
        </td>
        <td>
          {shortExp(s.firstOpened)} → {shortExp(s.lastOpened)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ background: "var(--color-light)", padding: "6px 12px" }}>
            {legs.length
              ? legs.map((leg, i) => <TickerLeg key={i} leg={leg} />)
              : <span className="vg-note">no leg detail</span>}
          </td>
        </tr>
      )}
    </>
  );
}

function OpenStrategyRow({ s, expanded, onToggle }) {
  const legs = s.legs || [];
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }} title="Show legs">
        <td>
          <span style={{ marginRight: 6, color: "var(--color-grey)" }}>{expanded ? "▾" : "▸"}</span>
          <b>{stratLabel(s)}</b>
          <span className={cls("vg-badge", kindChipCls(s.kind))} style={{ marginLeft: 6 }}>{kindChip(s.kind)}</span>
        </td>
        <td>{s.underlying || "—"}</td>
        <td>{shortExp(s.expiration)}{s.dte != null && <div className="vg-note">{s.dte}d</div>}</td>
        <td className="num">{s.netCost != null ? usd(s.netCost) : "—"}</td>
        <td className="num">{s.currentValue != null ? usd(s.currentValue) : "—"}</td>
        <td className={cls("num", s.unrealized == null ? "" : s.unrealized >= 0 ? "up" : "down")}>
          {s.unrealized != null ? signUsd(s.unrealized) : "—"}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ background: "var(--color-light)", padding: "6px 12px" }}>
            {legs.length
              ? legs.map((leg, i) => <StrategyLeg key={i} leg={leg} underlying={s.underlying} expiration={s.expiration} />)
              : <span className="vg-note">no leg detail</span>}
          </td>
        </tr>
      )}
    </>
  );
}

function ClosedStrategyRow({ s, expanded, onToggle }) {
  const legs = s.legs || [];
  const w = stratWhen(s.timestamp);
  const dimmed = s.state === "cancelled";
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", opacity: dimmed ? 0.55 : 1 }} title="Show legs">
        <td>
          <span style={{ marginRight: 6, color: "var(--color-grey)" }}>{expanded ? "▾" : "▸"}</span>
          <b>{stratLabel(s)}</b>
          <span className={cls("vg-badge", kindChipCls(s.kind))} style={{ marginLeft: 6 }}>{kindChip(s.kind)}</span>
        </td>
        <td>{s.underlying || "—"}</td>
        <td>
          {s.direction === "credit" && <span className="vg-badge good">credit</span>}
          {s.direction === "debit" && <span className="vg-badge plain">debit</span>}
          {s.direction !== "credit" && s.direction !== "debit" && <span className="vg-note">—</span>}
        </td>
        <td className={cls("num", s.cash == null ? "" : s.cash >= 0 ? "up" : "down")}>
          {s.cash != null ? signUsd(s.cash) : "—"}
        </td>
        <td>
          {s.state === "filled" && <span style={{ fontSize: 13 }}>filled</span>}
          {s.state === "cancelled" && <span className="vg-badge plain">cancelled</span>}
          {s.state === "rejected" && <span className="vg-badge bad">rejected</span>}
          {s.state && !["filled", "cancelled", "rejected"].includes(s.state) && (
            <span className="vg-badge plain">{s.state}</span>
          )}
          {!s.state && <span className="vg-note">—</span>}
        </td>
        <td>{w.day}{w.time && <div className="vg-note">{w.time}</div>}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ background: "var(--color-light)", padding: "6px 12px" }}>
            {legs.length
              ? legs.map((leg, i) => <StrategyLeg key={i} leg={leg} underlying={s.underlying} />)
              : <span className="vg-note">no leg detail</span>}
          </td>
        </tr>
      )}
    </>
  );
}

function StrategiesSection({ accountId }) {
  const [tab, setTab] = useState("open"); // "open" | "history" | "ticker"
  const [shown, setShown] = useState(STRAT_PAGE);
  const [open, setOpen] = useState({}); // expanded row keys
  // No fixture fallback — null (backend down / endpoint 404) stays null and
  // drives the empty state, matching the Activity view's live-only contract.
  const strat = useLive(
    () => getStrategies(accountId).then(mapStrategies),
    null,
    [accountId],
  ).data;
  const byTickerData = useLive(
    () => getStrategies(accountId, undefined, "ticker").then(mapByTicker),
    null,
    [accountId],
  ).data;
  useEffect(() => { setShown(STRAT_PAGE); setOpen({}); }, [accountId, tab]);

  const openRows = (strat && strat.open) || [];
  const closedRows = (strat && strat.closed) || [];
  const tickerRows = (byTickerData && byTickerData.byTicker) || [];
  const hasAny = openRows.length > 0 || closedRows.length > 0 || tickerRows.length > 0;
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="vg-spread" style={{ marginBottom: 2 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Strategies</h3>
        <span className="vg-note">grouped option legs · net of shorts · marks live</span>
      </div>

      {!hasAny ? (
        <div className="vg-card" style={{ marginTop: 6 }}>
          <div className="vg-kicker">No option strategies</div>
          <p className="vg-note" style={{ margin: "6px 0 0", maxWidth: 560 }}>
            Multi-leg option positions and closed spread orders arrive with a broker import — run the importer
            with <b>--breakout</b> to group individual legs into strategies. There is no demo fixture, so this
            stays empty offline.
          </p>
        </div>
      ) : (
        <>
          <div className="vg-card vg-tablewrap" style={{ padding: "8px 12px", marginTop: 6 }}>
            <div className="vg-spread" style={{ padding: "6px 4px 8px" }}>
              <div className="vg-pills">
                <button className={cls("vg-pill", tab === "open" && "sel")} onClick={() => setTab("open")}>
                  Open{openRows.length ? ` · ${openRows.length}` : ""}
                </button>
                <button className={cls("vg-pill", tab === "history" && "sel")} onClick={() => setTab("history")}>
                  History{closedRows.length ? ` · ${closedRows.length}` : ""}
                </button>
                <button className={cls("vg-pill", tab === "ticker" && "sel")} onClick={() => setTab("ticker")}>
                  By ticker{tickerRows.length ? ` · ${tickerRows.length}` : ""}
                </button>
              </div>
            </div>

            {tab === "ticker" ? (
              tickerRows.length === 0 ? (
                <p className="vg-note" style={{ padding: "4px" }}>No ticker books.</p>
              ) : (
                <table className="vg-table">
                  <thead>
                    <tr>
                      <th>Ticker</th><th>Legs</th>
                      <th className="num">Net cost</th><th className="num">Current</th>
                      <th className="num">Unrealized</th><th>First → last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickerRows.map((s, i) => (
                      <TickerRow key={i} s={s} expanded={!!open[`t${i}`]} onToggle={() => toggle(`t${i}`)} />
                    ))}
                  </tbody>
                </table>
              )
            ) : tab === "open" ? (
              openRows.length === 0 ? (
                <p className="vg-note" style={{ padding: "4px" }}>No open strategies.</p>
              ) : (
                <table className="vg-table">
                  <thead>
                    <tr>
                      <th>Strategy</th><th>Underlying</th><th>Exp</th>
                      <th className="num">Net cost</th><th className="num">Current</th><th className="num">Unrealized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openRows.map((s, i) => (
                      <OpenStrategyRow key={i} s={s} expanded={!!open[`o${i}`]} onToggle={() => toggle(`o${i}`)} />
                    ))}
                  </tbody>
                </table>
              )
            ) : (
              closedRows.length === 0 ? (
                <p className="vg-note" style={{ padding: "4px" }}>No closed strategies.</p>
              ) : (
                <table className="vg-table">
                  <thead>
                    <tr>
                      <th>Strategy</th><th>Underlying</th><th>Direction</th>
                      <th className="num">Net</th><th>State</th><th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedRows.slice(0, shown).map((s, i) => (
                      <ClosedStrategyRow key={i} s={s} expanded={!!open[`c${i}`]} onToggle={() => toggle(`c${i}`)} />
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
          {tab === "history" && closedRows.length > shown && (
            <div style={{ textAlign: "center", marginTop: 10 }}>
              <button className="vg-linkbtn" onClick={() => setShown(shown + STRAT_PAGE)}>
                Show {Math.min(STRAT_PAGE, closedRows.length - shown)} more · {closedRows.length - shown} remaining
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function OptionsView({ accountId = "all" }) {
  const [faq, setFaq] = useState(false);
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19 }}>Options</h2>
      <p className="vg-sub">
        Your live option strategies — open positions and closed spreads, rolled up by structure and ticker · educational only
      </p>

      <StrategiesSection accountId={accountId} />

      {/* Covered-call income ideas come from the live decision journal
          (HOLD_AND_SELL_CALL), surfaced in the Dashboard Action Queue — not a
          mock premium table. The fixture IV tiles, income ideas, and unusual
          flow were removed as decorative demo data. */}
      <div className="vg-grid2" style={{ margin: "20px 0" }}>
        <SecurityCard accent="teal" title="Covered-call ideas live in your Actions">
          The nightly engine flags HOLD &amp; SELL CALL against real lots, with a suggested strike, credit, and basis
          reduction. Those appear in the Dashboard Action Queue — cross-checked against your Tax Center for wash risk.
        </SecurityCard>
        <SecurityCard accent="orange" title="Approval levels differ per account">
          Roth allows covered calls and CSPs at most brokers; 401(k)s rarely allow options at all. The engine only
          suggests calls on lots in accounts where they're actually executable.
        </SecurityCard>
      </div>

      <div className="vg-card">
        <FAQItem question="How are covered-call ideas generated?" open={faq} onToggle={() => setFaq(!faq)}>
          The nightly analysis looks for lots of 100+ shares held at a loss or near breakeven, targets a strike above
          cost basis at the next monthly expiry, estimates the credit, and only recommends the call when it isn't
          wash-blocked. Results are persisted to the decision journal — educational only, not advice.
        </FAQItem>
      </div>
    </div>
  );
}
