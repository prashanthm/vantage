// NotebookPanel — the persistent per-ticker "notebook" in the right pane.
// For the selected symbol it pulls together, from live data only:
//   • Position & P&L   — shares, cost basis, value, unrealized (live price)
//   • Valuation        — fundamentals (yfinance), technical (S/R vs price)
//   • AI recommendation — the nightly journal decision (one advice source)
//   • My plan          — thesis / target / stop / notes (persisted)
//   • Journal          — auto snapshots + manual notes (persisted, accrues)
// The chart is NOT here — it opens as its own AI Charts view via "view chart".
import {
  usd, signUsd, signPct, cls, dirCls, fmtDate, acctOf, underlyingOf, StatTile,
} from "./util.jsx";
import * as live from "./live.js";
import { useLive, mapBarsOverlay, mapPositions, mapNotebook } from "./live.js";
import { ConvictionBadge } from "./charts.jsx";

const { useState, useMemo, useEffect } = React;

// per-leg action chip vocabulary (mirrors app.jsx LEG_ACTION_CHIP).
const LEG_TONE = { DEFEND: "bad", CLOSE_LEG: "bad", TAKE_PROFIT: "good", ROLL_UP: "info",
  ROLL_DOWN: "warn", ROLL_OUT: "warn", LET_EXPIRE: "plain", HOLD_LEG: "plain" };
const LEG_TEXT = { DEFEND: "DEFEND", CLOSE_LEG: "CLOSE", TAKE_PROFIT: "TAKE PROFIT",
  ROLL_UP: "ROLL UP", ROLL_DOWN: "ROLL DOWN", ROLL_OUT: "ROLL OUT", LET_EXPIRE: "LET EXPIRE",
  HOLD_LEG: "HOLD" };

// ------- small helpers -------
const fmtBig = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return usd(n);
};
const fmtWhen = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const pct1 = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const pct0 = (x) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);

const numOrNull = (s) => {
  const t = String(s).trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// Nearest resistance/support from the daily levels, relative to price.
function nearest(levels, price) {
  const daily = (levels && levels.daily) || {};
  const res = (daily.resistance || []).filter((l) => l.price > price).sort((a, b) => a.price - b.price)[0] || null;
  const sup = (daily.support || []).filter((l) => l.price < price).sort((a, b) => b.price - a.price)[0] || null;
  return { res, sup };
}

export function NotebookPanel({ symbol, accountId = "all", refreshNonce }) {
  const sym = underlyingOf(symbol);

  // Live position + technicals + recommendation in one overlay fetch.
  const overlay = useLive(() => live.getBarsOverlay(sym).then(mapBarsOverlay), null, [sym, refreshNonce]).data;
  // Positions (for shares + which accounts hold it) — filter to this underlying.
  const positions = useLive(() => live.positions("all").then(mapPositions), [], [refreshNonce], { blankOnOutage: true }).data;
  // Persisted side: plan + journal + fundamentals.
  const nb = useLive(() => live.getNotebook(sym).then(mapNotebook), null, [sym, refreshNonce]);
  const notebook = nb.data;

  // Local reload nonce so a save re-pulls the notebook without a full app refresh.
  const [saveNonce, setSaveNonce] = useState(0);
  const nbReload = useLive(() => live.getNotebook(sym).then(mapNotebook), null, [sym, saveNonce]);
  const nbData = nbReload.data || notebook;

  const held = useMemo(
    () => positions.filter((p) => underlyingOf(p.symbol) === sym),
    [positions, sym],
  );
  const shares = held.reduce((s, p) => s + (p.shares || 0), 0);
  const cost = held.reduce((s, p) => s + (p.cost || 0), 0);
  const heldAccounts = [...new Set(held.flatMap((p) => p.accounts || []))];
  const price = overlay ? overlay.currentPrice : null;
  const value = price != null && shares ? price * shares : held.reduce((s, p) => s + (p.value || 0), 0);
  const unrl = price != null && shares ? value - cost : held.reduce((s, p) => s + (p.unrl || 0), 0);
  const avgCost = shares ? cost / shares : (overlay && overlay.costBasis && overlay.costBasis.equity
    ? overlay.costBasis.equity.avgCost : null);
  const isHeld = shares > 0 || held.length > 0;

  const f = notebookOr(nbData, "fundamentals");
  const g = notebookOr(nbData, "growth");
  const ex = notebookOr(nbData, "expectations");
  const rs = notebookOr(nbData, "relativeStrength");
  const rr = notebookOr(nbData, "riskReward");
  const news = notebookOr(nbData, "news");
  const decision = overlay ? overlay.analysis : null;
  const { res, sup } = price != null ? nearest(overlay && overlay.levels, price) : { res: null, sup: null };

  const hasLegs = decision && decision.legActions && decision.legActions.length > 0;

  return (
    <div className="vg-pane-body vg-notebook">
      {/* ---- Pinned summary header: sym · name · price · P&L · rec badge ---- */}
      <div className="vg-nb-head">
        <div className="vg-nb-headmain">
          <div className="vg-nb-sym">{sym}</div>
          <div className="vg-note vg-nb-subtitle">
            {f && f.name ? f.name : ""}{isHeld && heldAccounts.length
              ? `${f && f.name ? " · " : ""}held in ${heldAccounts.map((id) => acctOf(id).short).join(", ")}`
              : (isHeld ? "" : " · not held")}
          </div>
          {decision && (
            <div style={{ marginTop: 6 }}><ConvictionBadge analysis={decision} /></div>
          )}
        </div>
        <div className="vg-nb-headright">
          {price != null && <div className="vg-nb-price">{usd(price, 2)}</div>}
          {isHeld && (
            <div className={cls("vg-nb-pnl", dirCls(unrl))}>
              {signUsd(unrl)}{cost ? ` · ${signPct((unrl / cost) * 100)}` : ""}
            </div>
          )}
          {price != null && overlay && overlay.lastClose != null && overlay.lastClose !== price && (
            <div className="vg-note">close {usd(overlay.lastClose, 2)}</div>
          )}
        </div>
      </div>

      {/* ---- Chat is the primary surface: fills the pane, input pinned ---- */}
      <AskCard sym={sym} price={price} unrl={unrl} isHeld={isHeld}
        decision={decision} shares={shares} hasLegs={hasLegs} />

      {/* ---- Data on demand: collapsible sections below the chat ---- */}
      <div className="vg-nb-details">
        <Section title="Position & P&L"
          summary={isHeld ? `${shares ? shares.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"} sh · ${usd(value)} · ${signUsd(unrl)}` : "not held"}>
          {isHeld ? (
            <div className="vg-nb-stats">
              <StatTile label="Shares" value={shares ? shares.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"} />
              <StatTile label="Avg cost" value={avgCost != null ? usd(avgCost, 2) : "—"} />
              <StatTile label="Value" value={usd(value)} />
              <StatTile label="Unrealized" value={signUsd(unrl)} deltaDir={dirCls(unrl)}
                delta={cost ? signPct((unrl / cost) * 100) : undefined} />
            </div>
          ) : (
            <p className="vg-note" style={{ margin: 0 }}>Not held in any linked account.</p>
          )}
        </Section>

        <Section title="AI recommendation"
          summary={decision ? decision.recommendation : "not journaled"}>
          {decision ? (
            <>
              {decision.rationale && <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 0" }}>{decision.rationale}</p>}
              {hasLegs && (
                <div style={{ marginTop: 12 }}>
                  <div className="vg-note" style={{ fontWeight: 600, marginBottom: 6 }}>Option legs</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {decision.legActions.map((a, i) => (
                      <div key={i} className="vg-nb-leg">
                        <div className="vg-row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <span className={cls("vg-badge", LEG_TONE[a.action] || "plain")}>{LEG_TEXT[a.action] || a.action}</span>
                          <span style={{ fontSize: 13 }}>
                            {a.side} ${Number(a.strike).toFixed(0)}{(a.optionType || "")[0].toUpperCase()} · {a.dte}DTE · {a.moneyness}
                          </span>
                        </div>
                        {a.rationale && <div className="vg-note" style={{ marginTop: 3 }}>{a.rationale}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="vg-note" style={{ margin: 0 }}>
              Not in the latest decision journal. Run the nightly analysis to include {sym}.
            </p>
          )}
        </Section>

        <Section title="Valuation"
          summary={f && f.pe != null ? `P/E ${f.pe.toFixed(1)}` : (price != null ? "levels" : "—")}>
          {price != null ? (
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              {res
                ? <div>Nearest resistance <b>{usd(res.price, 2)}</b> (str {res.strength}) — {signPct(((res.price - price) / price) * 100, 1)} away</div>
                : <div className="vg-note">No resistance above current price.</div>}
              {sup && <div>Nearest support <b>{usd(sup.price, 2)}</b> (str {sup.strength}) — {signPct(((sup.price - price) / price) * 100, 1)} away</div>}
            </div>
          ) : <p className="vg-note" style={{ margin: 0 }}>Technical levels unavailable (no bars).</p>}

          {f && (
            <div className="vg-nb-fund" style={{ marginTop: 10 }}>
              {f.market_cap != null && <span><span className="vg-note">Mkt cap</span> {fmtBig(f.market_cap)}</span>}
              {f.pe != null && <span><span className="vg-note">P/E</span> {f.pe.toFixed(1)}</span>}
              {f.target_mean != null && (
                <span><span className="vg-note">Target</span> {usd(f.target_mean, 2)}
                  {price != null && ` (${signPct(((f.target_mean - price) / price) * 100, 0)})`}</span>
              )}
              {f.week52_low != null && f.week52_high != null && (
                <span><span className="vg-note">52w</span> {usd(f.week52_low, 0)}–{usd(f.week52_high, 0)}</span>
              )}
              {f.forward_pe != null && <span><span className="vg-note">Fwd P/E</span> {f.forward_pe.toFixed(1)}</span>}
              {f.dividend_yield != null && <span><span className="vg-note">Yield</span> {f.dividend_yield.toFixed(2)}%</span>}
              {f.beta != null && <span><span className="vg-note">Beta</span> {f.beta.toFixed(2)}</span>}
            </div>
          )}

          {g && (
            <div className="vg-nb-fund" style={{ marginTop: 10 }}>
              {g.revenue_yoy != null &&
                <span><span className="vg-note">Rev YoY</span> {pct0(g.revenue_yoy)}</span>}
              {g.gross_margin != null &&
                <span><span className="vg-note">Gross mgn</span> {pct0(g.gross_margin)}</span>}
              {g.fcf_margin != null &&
                <span><span className="vg-note">FCF mgn</span> {pct0(g.fcf_margin)}</span>}
              {g.rule_of_40 != null &&
                <span><span className={g.rule_of_40 >= 40 ? "vg-pos" : "vg-neg"}>Rule of 40</span> {g.rule_of_40.toFixed(0)}</span>}
              {g.sbc_pct_revenue != null &&
                <span><span className="vg-note">SBC/rev</span> {pct0(g.sbc_pct_revenue)}</span>}
            </div>
          )}

          {ex && ex.implied && ex.implied.status === "ok" && ex.implied.fcf_growth_10y != null && (
            <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
              <span className="vg-note">Market implies</span>{" "}
              <b>{pct0(ex.implied.fcf_growth_10y)}</b> FCF growth/yr for 10y
              {ex.assumptions && ` (r ${pct0(ex.assumptions.discount_rate)}, term ${pct1(ex.assumptions.terminal_growth)})`}
              {g && g.growth && g.revenue_yoy != null && (
                <span className="vg-note"> — vs {pct0(g.revenue_yoy)} actual rev growth</span>
              )}
            </div>
          )}
          {ex && ex.implied && ex.implied.status === "negative_fcf" && (
            <div className="vg-note" style={{ fontSize: 12, marginTop: 8 }}>
              Implied growth undefined (negative FCF).
            </div>
          )}

          {rs && rs.idio_r_1m != null && (
            <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
              <span className="vg-note">1m move</span>{" "}
              <b className={rs.r_1m >= 0 ? "vg-pos" : "vg-neg"}>{signPct(rs.r_1m * 100, 1)}</b>
              {rs.beta_spy != null && <span className="vg-note"> · β {rs.beta_spy.toFixed(2)}</span>}
              {" · "}
              <span className="vg-note">idiosyncratic</span>{" "}
              <b className={rs.idio_r_1m >= 0 ? "vg-pos" : "vg-neg"}>{signPct(rs.idio_r_1m * 100, 1)}</b>
              {rs.sector_etf && rs.sector_r_1m != null &&
                <span className="vg-note"> (sector {rs.sector_etf} {signPct(rs.sector_r_1m * 100, 1)})</span>}
            </div>
          )}
        </Section>

        {/* ---- News + headline sentiment lean (from the analyze/news pipeline) ---- */}
        <NewsSection news={news} />

        <Section title="My plan"
          summary={rr && rr.rr_ratio != null ? `R:R ${rr.rr_ratio.toFixed(2)}` : (nbData && nbData.plan && nbData.plan.thesis ? "set" : "empty")} plain>
          {rr && rr.status === "ok" && rr.rr_ratio != null && (
            <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
              <span className="vg-note">Risk/reward</span>{" "}
              <b>{rr.rr_ratio.toFixed(2)}:1</b>
              {rr.direction === "short" && <span className="vg-note"> (short)</span>}
              {" · "}<span className="vg-pos">+{usd(rr.upside, 2)}</span> to target
              {" / "}<span className="vg-neg">−{usd(rr.downside, 2)}</span> to stop
              {rr.upside_pct != null && <span className="vg-note"> ({signPct(rr.upside_pct, 0)} / {signPct(-rr.downside_pct, 0)})</span>}
            </div>
          )}
          {rr && (rr.status === "stop_breached" || rr.status === "target_reached") && (
            <div className="vg-note" style={{ fontSize: 12, marginBottom: 8 }}>
              Plan {rr.status === "stop_breached" ? "stop breached" : "target reached"} at current price.
            </div>
          )}
          <PlanCard sym={sym} plan={nbData ? nbData.plan : null} price={price}
            onSaved={() => setSaveNonce((n) => n + 1)} embedded />
        </Section>

        <Section title="Journal"
          summary={nbData && nbData.journal && nbData.journal.length ? `${nbData.journal.length} entr${nbData.journal.length === 1 ? "y" : "ies"}` : "empty"} plain>
          <JournalCard sym={sym} journal={nbData ? nbData.journal : []}
            onAdded={() => setSaveNonce((n) => n + 1)} embedded />
        </Section>
      </div>
    </div>
  );
}

// A collapsible data section (details/summary). Collapsed by default; the compact
// summary stays visible so the pane reads as a scannable dashboard until the user
// opens a section. `plain` drops the inner card chrome (for cards that bring their
// own).
function Section({ title, summary, children, plain, open = false }) {
  return (
    <details className="vg-nb-section" open={open}>
      <summary className="vg-nb-summary">
        <span className="vg-nb-sumtitle">{title}</span>
        {summary != null && <span className="vg-note vg-nb-sumval">{summary}</span>}
      </summary>
      <div className={plain ? "vg-nb-secbody plain" : "vg-nb-secbody"}>{children}</div>
    </details>
  );
}

// News section: recent headlines as a compact cited list + the sentiment lean
// (clearly labeled estimated — a headline lean, never ground truth).
function NewsSection({ news }) {
  const items = news && news.items ? news.items : [];
  const band = news && news.sentiment ? news.sentiment.band : null;
  const tone = band === "positive" ? "good" : band === "negative" ? "bad" : "plain";
  return (
    <Section title="News"
      summary={items.length ? `${items.length}${band ? ` · ${band}` : ""}` : "none"}>
      {items.length === 0 ? (
        <p className="vg-note" style={{ margin: 0 }}>No recent headlines from the configured sources.</p>
      ) : (
        <>
          {band && (
            <div className="vg-row" style={{ gap: 6, marginBottom: 8, alignItems: "center" }}>
              <span className={cls("vg-badge", tone)}>{band}</span>
              <span className="vg-note">headline lean (estimated, not fact)</span>
            </div>
          )}
          <div className="vg-nb-news">
            {items.slice(0, 8).map((it, i) => (
              <div key={i} className="vg-nb-newsitem">
                {it.url
                  ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="vg-nb-newstitle">{it.title}</a>
                  : <span className="vg-nb-newstitle">{it.title}</span>}
                <div className="vg-note">
                  {it.publisher}{it.publisher && it.published ? " · " : ""}{fmtWhen(it.published)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

function notebookOr(nb, key) {
  return nb && nb[key] ? nb[key] : null;
}

// ------------------------------------------------- My plan card
function PlanCard({ sym, plan, price, onSaved, embedded }) {
  const [thesis, setThesis] = useState("");
  const [target, setTarget] = useState("");
  const [stop, setStop] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);

  // Re-seed the form when the symbol's plan changes.
  useEffect(() => {
    setThesis(plan ? plan.thesis || "" : "");
    setTarget(plan && plan.target != null ? String(plan.target) : "");
    setStop(plan && plan.stop != null ? String(plan.stop) : "");
    setNotes(plan ? plan.notes || "" : "");
    setNote(null);
  }, [sym, plan]);

  const save = async () => {
    setSaving(true); setNote(null);
    const res = await live.postPlan(sym, {
      thesis, notes, target: numOrNull(target), stop: numOrNull(stop),
    });
    setSaving(false);
    if (res && res.plan) { setNote({ tone: "ok", text: "Saved." }); onSaved && onSaved(); }
    else setNote({ tone: "warn", text: "Save failed — backend unreachable." });
  };

  const t = numOrNull(target), s = numOrNull(stop);
  return (
    <div className={embedded ? "" : "vg-card"}>
      {!embedded && <div className="vg-kicker">My plan</div>}
      <textarea className="vg-nb-input" rows={2} placeholder="Thesis — why I hold this…"
        value={thesis} onChange={(e) => setThesis(e.target.value)} />
      <div className="vg-nb-row2">
        <label className="vg-nb-field">
          <span className="vg-note">Target</span>
          <input className="vg-nb-input" inputMode="decimal" placeholder="—"
            value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="vg-nb-field">
          <span className="vg-note">Stop</span>
          <input className="vg-nb-input" inputMode="decimal" placeholder="—"
            value={stop} onChange={(e) => setStop(e.target.value)} />
        </label>
      </div>
      {price != null && (t != null || s != null) && (
        <div className="vg-note" style={{ marginTop: 4 }}>
          {t != null && <>target {signPct(((t - price) / price) * 100, 0)} away{s != null ? " · " : ""}</>}
          {s != null && <>stop {signPct(((s - price) / price) * 100, 0)} away</>}
        </div>
      )}
      <textarea className="vg-nb-input" rows={2} placeholder="Notes / plan / reminders…"
        value={notes} onChange={(e) => setNotes(e.target.value)} style={{ marginTop: 6 }} />
      <div className="vg-row" style={{ marginTop: 6, justifyContent: "space-between" }}>
        <button className="vg-btn-sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save plan"}</button>
        {note && <span className="vg-note" style={{ color: note.tone === "warn" ? "var(--color-grey)" : undefined }}>{note.text}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------- Journal card
function JournalCard({ sym, journal, onAdded, embedded }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const res = await live.postNote(sym, text);
    setBusy(false);
    if (res) { setDraft(""); onAdded && onAdded(); }
  };

  return (
    <div className={embedded ? "" : "vg-card"}>
      {!embedded && <div className="vg-kicker">Journal</div>}
      <div className="vg-row" style={{ gap: 6, marginTop: 0 }}>
        <input className="vg-nb-input" placeholder="Add a note…" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} style={{ flex: 1 }} />
        <button className="vg-btn-sm" disabled={busy || !draft.trim()} onClick={add}>Add</button>
      </div>
      <div className="vg-nb-journal" style={{ marginTop: 8 }}>
        {journal.length === 0 && <p className="vg-note" style={{ margin: 0 }}>No entries yet. Snapshots accrue nightly; add your own notes anytime.</p>}
        {journal.map((j) => (
          <div key={j.id} className="vg-nb-entry">
            <div className="vg-nb-when">{fmtWhen(j.createdAt)}</div>
            <div className="vg-nb-body">
              {j.kind === "note"
                ? <span>{j.payload.text}</span>
                : <span className="vg-note">
                    {j.payload.price != null ? usd(j.payload.price, 2) : "—"}
                    {j.payload.unrl != null && <> · unrl {signUsd(j.payload.unrl)}</>}
                    {j.payload.recommendation && <> · {j.payload.recommendation}</>}
                  </span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------- Ask Mira (symbol-aware chat)
// A per-ticker chat wired to Mira. Facet chips fire scoped questions through the
// /analyze multi-facet graph (fan-out + LLM synthesis) for a grounded, multi-facet
// answer; free-text does the same, falling back to the /turn stream if analyze is
// unavailable. The conversation uses a symbol-scoped thread so context persists
// per ticker.

// Frame a user question so Mira ALWAYS routes it to the grounded advisor (not
// the generic LLM) and grounds in THIS ticker. Mira's supervisor routes by
// exact keyword match, so the frame must carry strong advisor keywords
// ("recommendation", "holdings", "positions", "action") plus the uppercase
// symbol (the advisor extracts the ticker by regex). We also inline the
// notebook's already-known context (held shares, current recommendation) so the
// answer reflects the real position even before the tool result lands — this is
// why a plain "what should I do about it?" now produces a grounded reply instead
// of a generic essay that asks the user for their position.
function framePrompt(sym, text, ctx) {
  const t = text.trim();
  const facts = [];
  if (ctx) {
    if (ctx.isHeld && ctx.shares) facts.push(`hold ${Math.round(ctx.shares)} shares`);
    else if (!ctx.isHeld) facts.push("not currently held");
    if (ctx.price != null) facts.push(`price $${Number(ctx.price).toFixed(2)}`);
    if (ctx.recommendation) facts.push(`engine recommendation ${ctx.recommendation}`);
    if (ctx.unrl != null && ctx.isHeld) facts.push(`unrealized ${ctx.unrl >= 0 ? "+" : ""}$${Math.round(ctx.unrl)}`);
  }
  const ctxLine = facts.length ? ` (my ${sym}: ${facts.join(", ")})` : "";
  // Lead with advisor keywords + symbol so routing is deterministic; append the
  // user's own question and the grounded context line.
  return `${sym} holdings recommendation and position actions${ctxLine}. ${t}`;
}

// Mira's advisor synthesis arrives as "[advisor] {json tool-result}". Render it
// readably instead of dumping raw JSON: pull the human-relevant fields and cite
// the provenance source, mirroring the Dashboard's mapInsights treatment. Text
// that isn't an advisor JSON envelope (a general LLM reply) passes through.
function formatReply(text) {
  if (!text) return text;
  const m = /^\[[a-z_:]+\]\s*(\{[\s\S]*\})\s*$/i.exec(text.trim());
  if (!m) return text; // not a structured advisor reply — show as-is
  let obj;
  try { obj = JSON.parse(m[1]); } catch { return text; }
  const src = obj.provenance && obj.provenance.source_id
    ? String(obj.provenance.source_id).split("#")[1] || obj.provenance.source_id : null;
  const parts = [];
  const sym = obj.symbol ? String(obj.symbol) : null;
  // recommendation / position_actions shape
  if (obj.recommendation) parts.push(`Recommendation: ${obj.recommendation}`);
  if (Array.isArray(obj.actions)) {
    if (obj.actions.length === 0 && sym) parts.push(`No open actions for ${sym} — monitoring.`);
    for (const a of obj.actions) {
      parts.push(`${a.action || a.recommendation || "action"}${a.detail ? ` — ${a.detail}` : ""}`);
    }
  }
  // wash shape: count blocked
  if (obj.wash && typeof obj.wash === "object") {
    const syms = Object.values(obj.wash);
    const blocked = syms.filter((w) => w && w.blocked).length;
    parts.push(`${blocked} of ${syms.length} symbol(s) wash-blocked${sym ? ` (checked for ${sym})` : ""}.`);
  }
  // tlh shape
  if (obj.candidates && Array.isArray(obj.candidates)) {
    parts.push(`${obj.candidates.length} tax-loss-harvest candidate(s).`);
  }
  // allocation shape
  if (obj.by_class && typeof obj.by_class === "object") {
    const a = Object.entries(obj.by_class)
      .map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(1) : v}%`).join(", ");
    parts.push(`Allocation: ${a}`);
  }
  if (parts.length === 0) {
    // unknown grounded shape — summarize the top scalar fields, not the blob
    const scalars = Object.entries(obj)
      .filter(([k, v]) => v != null && (typeof v === "string" || typeof v === "number") && k !== "as_of" && k !== "source")
      .slice(0, 4).map(([k, v]) => `${k}: ${v}`);
    parts.push(scalars.length ? scalars.join(" · ") : "Grounded in the Vantage engine.");
  }
  return { text: parts.join("\n"), source: src, asOf: obj.as_of };
}

// Facet chips make the multi-facet analysis graph discoverable. Each fires a
// scoped question through Mira's /analyze flow (fan-out + LLM synthesis), so a
// tap yields a grounded, multi-facet answer instead of a single-tool reply.
const FACET_CHIPS = [
  { key: "full", label: "Full analysis", q: "What should I do about {S}?" },
  { key: "technical", label: "Technical", q: "Give me the technical / market read on {S}." },
  { key: "fundamental", label: "Fundamental", q: "How is {S} valued fundamentally?" },
  { key: "news", label: "News", q: "What's the recent news and sentiment on {S}?" },
  { key: "options", label: "Options", q: "What should I do with my {S} options?" },
];

function AskCard({ sym, price, unrl, isHeld, decision, shares, hasLegs }) {
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = React.useRef(null);
  const abortRef = React.useRef(null);

  // Reset the conversation when the ticker changes.
  useEffect(() => {
    setMsgs([]); setDraft(""); setBusy(false);
    if (abortRef.current) { abortRef.current(); abortRef.current = null; }
  }, [sym]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs]);
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);

  const patchLast = (fn) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));

  // The multi-facet path: /analyze fans across technical/fundamental/news/advisor
  // and returns ONE synthesized answer (non-streaming). Used by the facet chips
  // and as the default for free-text (falls back to /turn streaming if analyze is
  // unavailable so a running-but-old Mira still answers).
  const analyze = async (text) => {
    if (!text.trim() || busy) return;
    setDraft("");
    setMsgs((m) => [...m, { who: "me", text }, { who: "ai", text: "", plan: [], pending: true, mode: "analyze" }]);
    setBusy(true);
    const res = await live.analyzeSymbol(sym, text);
    setBusy(false);
    if (res && res.synthesis) {
      patchLast((l) => ({ ...l, text: res.synthesis, pending: false, corr: res.correlationId,
                          facets: res.facets || [] }));
    } else {
      // analyze unreachable/failed — fall back to the grounded /turn stream.
      patchLast((l) => ({ ...l, pending: false, text: "" }));
      streamTurnFallback(text);
    }
  };

  // Grounded single-tool fallback over /turn (kept from the prior notebook chat).
  const streamTurnFallback = (text) => {
    const prompt = framePrompt(sym, text, {
      price, unrl, isHeld, shares,
      recommendation: decision ? decision.recommendation : null,
    });
    setBusy(true);
    let gotText = false;
    abortRef.current = live.streamTurn(prompt, live.symbolThreadId(sym), (evt) => {
      if (evt.kind === "plan_step") {
        patchLast((l) => ({ ...l, plan: [...(l.plan || []), evt.phase ? `${evt.step} (${evt.phase})` : String(evt.step)] }));
      } else if (evt.kind === "token") {
        gotText = true;
        patchLast((l) => ({ ...l, text: l.text + (evt.text || "") }));
      } else if (evt.kind === "done") {
        setBusy(false);
        patchLast((l) => ({ ...l, pending: false, corr: evt.correlation_id || null }));
      } else if (evt.kind === "error") {
        setBusy(false);
        patchLast((l) => (gotText
          ? { ...l, pending: false, offline: true }
          : { ...l, text: "Mira is unreachable — start it to ask grounded questions about this ticker.", plan: [], pending: false, offline: true }));
      }
    });
  };

  const ask = (raw) => analyze((raw != null ? raw : draft).trim());

  return (
    <div className="vg-nb-ask">
      {msgs.length === 0 ? (
        <div className="vg-nb-empty">
          <p className="vg-note" style={{ margin: "0 0 10px" }}>
            Ask Mira about {sym}
            {isHeld ? ` — your ${shares ? `${Math.round(shares)}-share ` : ""}position` : ""}
            {price != null ? ` at ${usd(price, 2)}` : ""}. Every answer is a multi-facet read
            (technical · fundamental · news · position), grounded in the Vantage engine.
          </p>
          <div className="vg-nb-facets">
            {FACET_CHIPS.filter((c) => c.key !== "options" || hasLegs).map((c) => (
              <button key={c.key} className="vg-facet-chip" onClick={() => ask(c.q.replace("{S}", sym))}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="vg-nb-chat" ref={bodyRef}>
          {msgs.map((m, i) => {
            // Analyze answers are already prose; /turn answers may be advisor JSON.
            const fmt = m.who === "ai" && !m.pending && m.mode !== "analyze" ? formatReply(m.text) : null;
            const body = fmt && typeof fmt === "object" ? fmt.text : (fmt || m.text);
            return (
              <div key={i} className={cls("vg-msg", m.who)}>
                {m.plan && m.plan.length > 0 && m.pending && (
                  <div className="vg-msg-plan">{m.plan.map((s, j) => <div key={j}>· {s}</div>)}</div>
                )}
                {m.pending && m.mode === "analyze" && (
                  <div className="vg-msg-plan">· fanning across technical · fundamental · news · position…</div>
                )}
                <span style={{ whiteSpace: "pre-wrap" }}>{body || (m.pending ? "…" : "")}</span>
                {m.facets && m.facets.length > 0 && (
                  <div className="vg-nb-facetline">
                    {m.facets.map((fc, j) => (
                      <span key={j} className={cls("vg-facet-tag", fc.error ? "bad" : "ok")}>{fc.domain}</span>
                    ))}
                  </div>
                )}
                {fmt && typeof fmt === "object" && fmt.source && (
                  <div className="vg-note" style={{ marginTop: 4 }}>source: {fmt.source}</div>
                )}
                {m.offline && <div className="vg-note" style={{ marginTop: 4 }}>offline</div>}
                {m.who === "ai" && m.corr && <ExplainToggle corr={m.corr} />}
              </div>
            );
          })}
        </div>
      )}
      <div className="vg-nb-askbar">
        {msgs.length > 0 && (
          <div className="vg-nb-facets vg-nb-facets-inline">
            {FACET_CHIPS.filter((c) => c.key !== "options" || hasLegs).map((c) => (
              <button key={c.key} className="vg-facet-chip sm" disabled={busy}
                onClick={() => ask(c.q.replace("{S}", sym))}>{c.label}</button>
            ))}
          </div>
        )}
        <div className="vg-row" style={{ gap: 6 }}>
          <input className="vg-nb-input" placeholder={`Ask about ${sym}…`} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
            disabled={busy} style={{ flex: 1 }} />
          <button className="vg-btn-sm" disabled={busy || !draft.trim()} onClick={() => ask()}>
            {busy ? "…" : "Ask"}
          </button>
        </div>
        <p className="vg-note" style={{ margin: "6px 0 0" }}>Educational only — not financial advice.</p>
      </div>
    </div>
  );
}

// Inline "explain" affordance under a Mira reply: lazily fetches the grounding
// trace (claims + sources) for that turn's correlation id.
function ExplainToggle({ corr }) {
  const [open, setOpen] = useState(false);
  const [rec, setRec] = useState(undefined); // undefined=unfetched, null=none, obj=trace
  const toggle = () => {
    const opening = !open;
    setOpen(opening);
    if (opening && rec === undefined) {
      live.getExplanation(corr).then((payload) => {
        const r = payload && Array.isArray(payload.records) && payload.records.length ? payload.records[0] : null;
        setRec(r);
      });
    }
  };
  const claims = rec && Array.isArray(rec.claims) ? rec.claims : [];
  return (
    <div style={{ marginTop: 6 }}>
      <button className="vg-linkbtn" style={{ fontSize: 11.5 }} onClick={toggle}>
        {open ? "hide sources" : "sources"}
      </button>
      {open && (
        <div className="vg-msg-explain">
          {rec === undefined && <span className="vg-note">loading…</span>}
          {rec === null && <span className="vg-note">no trace available</span>}
          {claims.map((c, i) => (
            <div key={i}>· {c.statement} <span className="vg-note">({c.source_type}:{c.source_id})</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
