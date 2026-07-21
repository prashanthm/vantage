// JournalView — trading journal: a month CALENDAR of trading days (each cell
// color-coded by how last night's forecast scored against the session), and a
// DETAIL panel for the selected day: forecast vs. actual tiles, the level-by-
// level verdicts, your reference chart, and the "what I did" log.
//
// Each day's entry freezes a playbook forecast (the PRIOR session's — last
// night's levels) and scores it against real SPX price action (yfinance 15m bars,
// full session): which levels held/broke, was the regime call right. The chart
// image is reference only — never analyzed. Journal/analysis only — no orders
// (ADR-010).
import { cls, SymbolSwitcher, LoadBar } from "./util.jsx";
import { MiraRender, SwotRender, parseMira } from "./mira-render.jsx";
import { collectTurn } from "./use_stream_turn.js";
import {
  useLive, getJournal, uploadJournal, deleteJournal,
  saveJournalEntry, ensureTodayJournal, journalImageUrl,
  getSessionActivity, getTradeDna, getDayPnl, saveTradeAnalysis,
  getJournalAnalysisBundle, saveJournalAnalysis, getJournalAnalyses,
  getDayReviewBundle, getAnalyzedKeys, saveDayReview, getDayReviews,
} from "./live.js";

const { useState, useRef, useEffect, useMemo } = React;

const pct = (v) => (v == null ? "—" : `${Math.round(100 * v)}%`);
const VERDICT_TONE = { held: "good", broken: "bad", tested: "warn", untested: "plain" };
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

// the structured trade-action fields, in display order
const ENTRY_FIELDS = [
  ["action", "Action taken", "e.g. bought 7550C, sold half at 7575"],
  ["entry", "Entry", "price / time / size you got in"],
  ["exit", "Exit", "price / time you got out"],
  ["result", "Result", "P&L, win/loss, R multiple"],
  ["lesson", "Lesson", "what to repeat or avoid next time"],
  ["notes", "Notes", "anything else"],
];

const dayOf = (s) => (s && s.created_at ? s.created_at.slice(0, 10) : "");
// the TRADING day (ET), not the UTC date — after 8pm ET the UTC date rolls to
// tomorrow and the journal would select a day that doesn't exist yet ("Setting
// up today's entry…" forever). en-CA locale formats as YYYY-MM-DD.
const todayISO = () => new Intl.DateTimeFormat("en-CA",
  { timeZone: "America/New_York" }).format(new Date());

// a day's overall tone from its scorecard: good (regime right + levels ok),
// bad (regime wrong or levels poor), warn (mixed), or null (not scored).
function dayTone(snap) {
  const sc = snap && snap.scorecard;
  if (!sc) return null;
  const regimeOk = sc.regime ? sc.regime.correct : null;
  const lvl = sc.level_accuracy;
  if (regimeOk === true && (lvl == null || lvl >= 0.5)) return "good";
  if (regimeOk === false || (lvl != null && lvl < 0.34)) return "bad";
  return "warn";
}

export function JournalView({ refreshNonce, tab: routeTab, onTab }) {
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState("");
  const [sym, setSym] = useState("SPX");     // SPX | QQQ | IWM
  // tab is ROUTED (#/journal/analysis) when the parent passes tab+onTab; falls
  // back to local state where JournalView renders without routing (Home debrief).
  const [localTab, setLocalTab] = useState("days");
  const tab = routeTab || localTab;          // days | analysis
  const setTab = onTab || setLocalTab;
  const [selDay, setSelDay] = useState(todayISO());
  // which month the calendar is showing: {y, m} (m 0-based)
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const jv = useLive(() => getJournal(sym), null, [refreshNonce, nonce, sym]);
  const d = jv.data;
  const reload = () => setNonce((n) => n + 1);

  // On open (and whenever the underlying changes), ensure that underlying's entry
  // for today exists (auto-created, last night's forecast) + re-score, then
  // reload. Idempotent — one entry per underlying per day (backend).
  const ensuredRef = useRef({});
  useEffect(() => {
    if (ensuredRef.current[sym]) return;
    ensuredRef.current[sym] = true;
    (async () => { await ensureTodayJournal(sym); reload(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);

  const snaps = (d && d.snapshots) || [];
  const acc = (d && d.accuracy) || {};

  // index snapshots by day for O(1) calendar + detail lookup
  const byDay = useMemo(() => {
    const m = {};
    for (const s of snaps) { const k = dayOf(s); if (k && !m[k]) m[k] = s; }
    return m;
  }, [snaps]);
  const selSnap = byDay[selDay] || null;

  const doDelete = async (id) => { setBusy(`del${id}`); await deleteJournal(id); setBusy(""); reload(); };
  const doSaveEntry = async (id, entry) => {
    setBusy(`entry${id}`); await saveJournalEntry(id, entry); setBusy(""); reload();
  };
  // attach a reference chart to the selected day's entry
  const doAttach = async (fileOrBlob) => {
    if (!fileOrBlob || !selSnap) return;
    setBusy("upload");
    await uploadJournal(fileOrBlob, "", "prior", selSnap.id);
    setBusy(""); reload();
  };

  if (d && d.available === false) {
    return (
      <div className="vg-pane-body">
        <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Trading journal</h2>
        <p className="vg-note">{d.note || "Journal needs the SQLite backend + a generated playbook."}</p>
      </div>
    );
  }

  return (
    <div className="vg-pane-body vg-jr vg-loadhost">
      {jv.loading && <LoadBar />}
      {/* compact header: title + view tabs + underlying + jump-to-month */}
      <div className="vg-jr-topbar">
        <div className="vg-row" style={{ gap: 12, alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Trading journal</h2>
          <div className="vg-seg">
            <button className={cls("vg-seg-btn", tab === "days" && "on")} onClick={() => setTab("days")}>Days</button>
            <button className={cls("vg-seg-btn", tab === "analysis" && "on")} onClick={() => setTab("analysis")}>Analysis</button>
          </div>
        </div>
        <div className="vg-row" style={{ gap: 10, alignItems: "center" }}>
          {tab === "days" && <MonthJump view={view} setView={setView} byDay={byDay}
            selDay={selDay} onSelect={setSelDay} />}
        </div>
      </div>

      {tab === "analysis" ? (
        <JournalAnalysisPanel sym={sym} />
      ) : (<>
      {/* the day STRIP — recent trading days, newest right; the whole calendar
          shrunk to one scannable row so the trades get the pane. P&L sums ALL
          tickers (the strip is the whole book, not one underlying). */}
      <DayStrip byDay={byDay} selDay={selDay} onSelect={setSelDay} sym={undefined} />

      {/* THE HERO: the selected day's trades */}
      {selSnap ? (
        <DayDetail key={selSnap.id} s={selSnap} busy={busy}
          onDelete={doDelete} onSaveEntry={doSaveEntry} onAttach={doAttach} />
      ) : (
        <div className="vg-note" style={{ padding: "20px 2px" }}>
          {selDay === todayISO()
            ? (d ? "Setting up today's entry — it freezes last night's forecast and scores it against today's SPX price…" : "loading…")
            : `No journal entry for ${selDay}.`}
        </div>
      )}
      </>)}
    </div>
  );
}

// ── day strip: the calendar, shrunk to one scannable row ─────────────────────
//
// The full month grid dominated the screen and pushed the trades — the actual
// subject — below the fold. The strip is the daily navigator: recent trading
// days as small pills (weekday · date · a score dot), newest on the right,
// horizontally scrollable. Jumping far back is the MonthJump popover, not the
// default view.
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DayStrip({ byDay, selDay, onSelect, sym }) {
  const stripRef = useRef(null);
  const [pnl, setPnl] = useState({});     // {day: {realized, trades}}
  // the last ~14 WEEKDAYS up to today (journaled or not — an untraded day is
  // still a day you can open), newest last
  const days = useMemo(() => {
    const out = [];
    const d = new Date();
    while (out.length < 14) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      }
      d.setDate(d.getDate() - 1);
    }
    return out;
  }, []);
  // one cheap call fetches per-day realized P&L for the whole strip
  useEffect(() => {
    let live = true;
    (async () => {
      const v = await getDayPnl(days, sym);   // undefined → all tickers
      if (live && v && v.pnl) setPnl(v.pnl);
    })();
    return () => { live = false; };
  }, [days.join(","), sym]);
  // keep the selected pill in view
  useEffect(() => {
    const el = stripRef.current && stripRef.current.querySelector(".vg-daystrip-pill.sel");
    if (el) el.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selDay]);

  const money = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n) >= 1000 ? (Math.abs(n) / 1000).toFixed(1) + "k" : Math.abs(n).toFixed(0)}`;
  const today = todayISO();
  return (
    <div className="vg-daystrip" ref={stripRef}>
      {days.map((iso) => {
        const snap = byDay[iso];
        const tone = snap ? dayTone(snap) : null;
        const p = pnl[iso];
        const [y, m, dd] = iso.split("-");
        const wd = WD[new Date(Number(y), Number(m) - 1, Number(dd)).getDay()];
        const traded = p && p.trades > 0;
        return (
          <button key={iso}
            className={cls("vg-daystrip-pill", iso === selDay && "sel", iso === today && "today",
                           traded && (p.realized >= 0 ? "up" : "down"))}
            onClick={() => onSelect(iso)}>
            <span className="vg-daystrip-wd">{iso === today ? "Today" : wd}</span>
            <span className="vg-daystrip-date">{MONTHS[Number(m) - 1].slice(0, 3)} {Number(dd)}</span>
            {traded
              ? <span className={cls("vg-daystrip-pnl", p.realized >= 0 ? "vg-up" : "vg-down")}>{money(p.realized)}</span>
              : <span className={cls("vg-daystrip-dot", tone || "empty")} />}
          </button>
        );
      })}
    </div>
  );
}

// Jump to any past day via the full month grid — opened on demand, not the
// default screen.
function MonthJump({ view, setView, byDay, selDay, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="vg-monthjump">
      <button className="vg-btn-sm" onClick={() => setOpen(!open)}
        title="Jump to a past day">📅 {MONTHS[view.m].slice(0, 3)}</button>
      {open && (
        <>
          <div className="vg-monthjump-backdrop" onClick={() => setOpen(false)} />
          <div className="vg-monthjump-pop">
            <Calendar view={view} setView={setView} byDay={byDay}
              selDay={selDay} onSelect={(d) => { onSelect(d); setOpen(false); }} />
          </div>
        </>
      )}
    </div>
  );
}

// ── month calendar (now inside the jump popover) ─────────────────────────────

function Calendar({ view, setView, byDay, selDay, onSelect }) {
  const { y, m } = view;
  const first = new Date(y, m, 1);
  const startDow = first.getDay();               // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayISO();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, iso, snap: byDay[iso] });
  }

  const step = (delta) => {
    let nm = m + delta, ny = y;
    if (nm < 0) { nm = 11; ny -= 1; }
    if (nm > 11) { nm = 0; ny += 1; }
    setView({ y: ny, m: nm });
  };

  return (
    <div>
      <div className="vg-cal-head">
        <div className="vg-cal-title">{MONTHS[m]} {y}</div>
        <div className="vg-cal-nav">
          <button className="vg-btn-sm" onClick={() => step(-1)} title="previous month">‹</button>
          <button className="vg-btn-sm" onClick={() => setView({ y: new Date().getFullYear(), m: new Date().getMonth() })} title="this month">Today</button>
          <button className="vg-btn-sm" onClick={() => step(1)} title="next month">›</button>
        </div>
      </div>
      <div className="vg-cal-grid">
        {DOW.map((d, i) => <div key={`dow${i}`} className="vg-cal-dow">{d}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={`e${i}`} className="vg-cal-cell empty" />;
          const tone = c.snap ? dayTone(c.snap) : null;
          const has = !!c.snap;
          return (
            <div key={c.iso}
              className={cls("vg-cal-cell", has && "has", tone,
                c.iso === selDay && has && "sel", c.iso === today && "today")}
              onClick={has ? () => onSelect(c.iso) : undefined}
              title={has ? `${c.iso} — ${tone || "not scored"}` : c.iso}>
              <span className="vg-cal-day">{c.day}</span>
              {has && <span className={cls("vg-cal-dot", tone || "none")} />}
            </div>
          );
        })}
      </div>
      <div className="vg-cal-legend">
        <span className="lg"><span className="vg-cal-dot good" /> forecast held</span>
        <span className="lg"><span className="vg-cal-dot warn" /> mixed</span>
        <span className="lg"><span className="vg-cal-dot bad" /> missed</span>
        <span className="lg"><span className="vg-cal-dot none" /> not scored</span>
      </div>
    </div>
  );
}

// ── one day's detail ─────────────────────────────────────────────────────────

function DayDetail({ s, busy, onDelete, onSaveEntry, onAttach }) {
  const [entry, setEntry] = useState(s.entry || {});
  // per-TRADE thinking, keyed by the trade's identity. Persisted with the entry
  // as `trades` (a JSON map) so each decision keeps its own why.
  const [thoughts, setThoughts] = useState(() => {
    try { return JSON.parse((s.entry || {}).trades || "{}"); } catch (e) { return {}; }
  });
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setEntry(s.entry || {});
    try { setThoughts(JSON.parse((s.entry || {}).trades || "{}")); } catch (e) { setThoughts({}); }
  }, [s.id, JSON.stringify(s.entry || {})]);

  const set = (k, v) => setEntry((e) => ({ ...e, [k]: v }));
  const setThought = (key, v) => setThoughts((t) => ({ ...t, [key]: v }));
  const save = async () => {
    const clean = {};
    for (const [k] of ENTRY_FIELDS) { const v = (entry[k] || "").trim(); if (v) clean[k] = v; }
    const kept = Object.fromEntries(Object.entries(thoughts).filter(([, v]) => (v || "").trim()));
    if (Object.keys(kept).length) clean.trades = JSON.stringify(kept);
    await onSaveEntry(s.id, clean);
  };
  const dirty = useMemo(() => {
    const cur = {}; for (const [k] of ENTRY_FIELDS) { const v = (entry[k] || "").trim(); if (v) cur[k] = v; }
    return JSON.stringify(cur) !== JSON.stringify(s.entry || {});
  }, [entry, s.entry]);

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) onAttach(f);
  };

  const sc = s.scorecard;
  const f = s.forecast || {};
  const dayLabel = dayOf(s);
  const kindLabel = s.forecast_kind === "live" ? "today's live forecast" : "last night's forecast";

  return (
    <div className="vg-jr-detail">
      {/* the day, in one line — heavy on the date, light on chrome */}
      <div className="vg-jr-dayhead">
        <div>
          <div className="vg-jr-dayname">{dayLabel === todayISO() ? "Today" : dayLabel}</div>
          <span className="vg-note" style={{ fontSize: 13 }}>
            {s.session ? `${s.session} playbook · ` : ""}vs. {kindLabel}
            {sc && sc.regime && <> · <span className={sc.regime.correct ? "vg-up" : "vg-down"}>
              {sc.regime.correct ? "forecast held ✓" : "forecast missed ✗"}</span></>}
          </span>
        </div>
        <button className="vg-linkbtn" disabled={busy === `del${s.id}`} onClick={() => onDelete(s.id)}>
          {busy === `del${s.id}` ? "…" : "delete"}
        </button>
      </div>

      {/* THE HERO: every decision, correlated to the forecast, annotated */}
      <TradesPanel snap={s} thoughts={thoughts} onThought={setThought} />

      {/* the forecast context — secondary, collapsed below the trades */}
      <details className="vg-jr-forecast">
        <summary className="vg-note" style={{ cursor: "pointer", fontWeight: 600, marginTop: 14 }}>
          Forecast vs. actual{sc && sc.level_accuracy != null ? ` · levels ${pct(sc.level_accuracy)}` : ""}
          {sc && sc.regime ? ` · ${sc.regime.outcome} (${sc.regime.moved_pct}%)` : ""}
        </summary>
        <div className="vg-jr-tiles" style={{ marginTop: 10 }}>
          <div className="vg-jr-tile">
            <h4>The forecast</h4>
            {f.plan
              ? <div className="big">{f.gamma} gamma</div>
              : <div className="big" style={{ fontWeight: 400 }}>No forecast frozen</div>}
            {f.plan && <div className="sub">{f.plan}</div>}
            {f.spot != null && <div className="sub">spot at forecast: {Math.round(f.spot)}
              {f.gamma_flip != null ? ` · flip ${Math.round(f.gamma_flip)}` : ""}</div>}
          </div>
          <div className="vg-jr-tile">
            <h4>Actual</h4>
            {sc ? (
              <div className="sub">
                price {sc.price_low}–{sc.price_high} (last {sc.price_last})
                {sc.regime && <> · {sc.regime.outcome} ({sc.regime.moved_pct}% move)</>}
                {sc.level_accuracy != null && <> · levels {pct(sc.level_accuracy)}</>}
              </div>
            ) : (
              <div className="sub">Not scored yet — scores against today's session once bars print.</div>
            )}
          </div>
        </div>
        {(f.levels || []).length > 0 && (
          <div className="vg-jr-tile" style={{ marginTop: 8 }}>
            <h4>Levels — forecast vs. actual</h4>
            <LevelTable forecast={f} scorecard={sc} />
          </div>
        )}
      </details>

      {/* the day's overall reflection */}
      <div className="vg-jr-form" style={{ marginTop: 14 }}>
        <h4 style={{ margin: 0 }}>My journal — the day overall</h4>
        {ENTRY_FIELDS.map(([k, label, ph]) => (
          <div key={k} className="vg-jr-field">
            <label>{label}</label>
            {k === "notes"
              ? <textarea rows={2} placeholder={ph} value={entry[k] || ""}
                  onChange={(e) => set(k, e.target.value)} />
              : <input placeholder={ph} value={entry[k] || ""}
                  onChange={(e) => set(k, e.target.value)} />}
          </div>
        ))}
        <div className="vg-row" style={{ gap: 8, marginTop: 4, alignItems: "center" }}>
          <button className="vg-btn-sm" disabled={busy === `entry${s.id}` || !dirty} onClick={save}>
            {busy === `entry${s.id}` ? "Saving…" : "Save"}
          </button>
          {dirty && <span className="vg-note" style={{ fontSize: 12 }}>unsaved changes</span>}
        </div>
      </div>

      {/* reference chart — moved to the bottom; secondary to the trade log */}
      <div style={{ marginTop: 14 }}>
        {s.image_path ? (
          <div className="vg-jr-chart">
            <img src={journalImageUrl(s.id)} alt="reference chart"
              onError={(e) => { e.target.style.display = "none"; }} />
            <div className="vg-row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span className="vg-note" style={{ fontSize: 12 }}>reference chart · never analyzed</span>
              <button className="vg-linkbtn" onClick={() => fileRef.current && fileRef.current.click()}>replace</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={(e) => onAttach(e.target.files && e.target.files[0])} />
          </div>
        ) : (
          <div className={cls("vg-jr-drop", drag && "drag")} style={{ padding: "12px" }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)} onDrop={onDrop}
            onClick={() => fileRef.current && fileRef.current.click()}>
            <span className="vg-note" style={{ fontSize: 13 }}>
              {busy === "upload" ? "Saving…" : "📎 Attach a reference chart — drop, paste (⌘V), or click (never analyzed)"}
            </span>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={(e) => onAttach(e.target.files && e.target.files[0])} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── per-level table: forecast level ⇄ what price actually did ────────────────

const VERDICT_LABEL = {
  held: "held", broken: "broke", tested: "tested", untested: "untested",
};

// A plain-English "what price did" line for one level given the session range.
function actualForLevel(lv, verdict, sc) {
  if (!sc) return "not scored yet";
  const p = lv.price, hi = sc.price_high, lo = sc.price_low, last = sc.price_last;
  if (p == null || hi == null) return "—";
  if (verdict === "untested") {
    // how far price got from it, on the side that matters
    const gap = lv.role === "resistance" ? p - hi : lo - p;
    const g = Math.max(0, Math.round(gap));
    return g > 0 ? `price stayed ${g} pts away — never reached` : "not reached";
  }
  if (verdict === "broken") {
    return lv.role === "resistance"
      ? `price pushed to ${hi} and closed above (${last})`
      : `price fell to ${lo} and closed below (${last})`;
  }
  if (verdict === "held") {
    return lv.role === "resistance"
      ? `tested (high ${hi}) but capped — closed back at ${last}`
      : `tested (low ${lo}) but held — closed back at ${last}`;
  }
  // tested (pivot/flip, or touched without a clean hold/break call)
  return `price reached it (range ${lo}–${hi})`;
}

function LevelTable({ forecast, scorecard }) {
  const verdictByKey = {};
  for (const l of (scorecard && scorecard.levels) || []) verdictByKey[l.key] = l.verdict;
  // sort levels high → low so the ladder reads like a chart (resistance on top)
  const rows = [...(forecast.levels || [])].sort((a, b) => (b.price || 0) - (a.price || 0));

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="vg-lvltbl">
        <thead>
          <tr>
            <th>Level</th><th>Role</th><th>Forecast expectation</th>
            <th>Outcome</th><th>What price did</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lv) => {
            const v = verdictByKey[lv.key] || (scorecard ? "untested" : null);
            const muted = v === "untested" || v == null;
            return (
              <tr key={lv.key} className={muted ? "muted" : ""}>
                <td className="lvl-price">
                  <b>{Math.round(lv.price)}</b>
                  <span className="vg-note" style={{ marginLeft: 4, fontSize: 12 }}>{lv.key}</span>
                </td>
                <td>{lv.role}{lv.confluence ? " ✦" : ""}{lv.durable ? " ★" : ""}</td>
                <td className="lvl-expect">{lv.expect || lv.label || "—"}</td>
                <td>
                  {v ? <span className={cls("vg-badge", VERDICT_TONE[v] || "plain")}
                    style={{ minWidth: 52, textAlign: "center", display: "inline-block" }}>
                    {VERDICT_LABEL[v] || v}</span>
                    : <span className="vg-note">—</span>}
                </td>
                <td className="lvl-actual vg-note">{actualForLevel(lv, v, scorecard)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, tone }) {
  return (
    <div className="vg-pb-tile">
      <div className="vg-note" style={{ fontSize: 12 }}>{label}</div>
      <div className={cls("vg-pb-tileval", tone)}>{value}</div>
    </div>
  );
}

// ── Trades: the day's DECISIONS ──────────────────────────────────────────────
//
// THE meat of the journal. Each trade is a decision unit (a spread is one
// trade), pinned to the SPX price at the MINUTE it was submitted, correlated
// to the forecast levels + GEX anchors, and left open for the operator to say
// WHY they took it and WHICH level they were trading. Expiries settled against
// the SPX print; the money no fill shows.
const STATUS_TONE = {
  closed: "plain", open: "warn",
  expired_worthless: "bad", expired_settled: "good", expired_unpriced: "warn",
};
// chip grammar: STATES are UPPERCASE (outcomes stay lowercase + glyph — see
// scanner). One visual language for "what is this row's state" across screens.
const STATUS_LABEL = {
  closed: "CLOSED", open: "OPEN",
  expired_worthless: "EXPIRED · $0", expired_settled: "EXPIRED ITM",
  expired_unpriced: "EXPIRED",
};
const money = (n) => (n == null ? "—"
  : `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const fmtLvl = (v) => (v == null ? "—" : Number(v).toFixed(v >= 100 ? 0 : 2));

function TradesPanel({ snap, thoughts, onThought }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);          // expanded trade key
  const [batch, setBatch] = useState(null);        // {done, total, running} for Analyze-today
  const [tk, setTk] = useState("all");             // ticker filter (all | SPX | MU | …)
  const [daySyn, setDaySyn] = useState(null);      // {loading|text|data|error} — the book-level synthesis

  const day = String(snap.created_at || "").slice(0, 10);
  const load = async () => {
    setBusy(true);
    // ALL tickers — the journal is every trade; the filter is client-side
    const v = await getSessionActivity(day, undefined);
    setBusy(false);
    setData(v && v.available ? v : { empty: true });
  };
  // Analyze-today: run + record the Mira desk review for each CLOSED trade
  // that lacks one. Idempotent — analyzeTradeOnce skips already-analyzed
  // trades; open positions are never analyzed (an unfinished decision). Uses
  // each trade's operator note + AUTO-tagged levels (the same at-level
  // inference the card shows), so the read is grounded even without manual tags.
  const analyzeToday = async () => {
    const trades = (data && data.trades) || [];
    const completed = trades
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.status !== "open");     // completed decisions only
    if (!completed.length) return;
    // skip trades already analyzed — BEFORE the per-trade DNA rebuild (the slow
    // part). The server's analysis trade_key is `${opened_at||index}|${label}`.
    let analyzed = new Set();
    try {
      const ak = await getAnalyzedKeys(day);
      if (ak && ak.available) analyzed = new Set(ak.keys || []);
    } catch (e) { /* no keys → analyze all (correct, just slower) */ }
    const targets = completed.filter(({ t, i }) =>
      !analyzed.has(`${t.opened_at || i}|${t.label}`));
    if (!targets.length) {   // everything already reviewed — go straight to synthesis
      await synthesizeDay();
      return;
    }
    setBatch({ done: 0, total: targets.length, running: true });
    let done = 0;
    for (const { t, i } of targets) {
      const key = `${t.account || ""}|${t.opened_at || i}|${t.label}`;   // match the row key
      const operator = operatorFor(t, (thoughts && thoughts[key]) || "");
      try {
        // each trade analyzed under ITS OWN ticker; index is into the full list
        await analyzeTradeOnce(day, i, t.ticker || "SPX", operator);
      } catch (e) { /* one failure never blocks the rest */ }
      done += 1;
      setBatch({ done, total: targets.length, running: done < targets.length });
    }
    setBatch({ done, total: targets.length, running: false });
    await load();   // re-pull so the freshly-saved reads show on the cards
    await synthesizeDay();   // then the book-level read ON TOP of the per-trade reads
  };

  // The DAY SYNTHESIS: one pass over the whole book (direction / time /
  // allocation) that a per-trade loop can't see. Reads the deterministic bundle
  // (which includes the per-trade reads just saved), streams Mira, and PERSISTS
  // the result (day_review table) — history accrues per day, newest shown.
  const synthesizeDay = async () => {
    setDaySyn({ loading: true, text: "" });
    try {
      const res = await getDayReviewBundle(day, "SPX");
      if (!res || !res.available || !res.prompt) {
        setDaySyn({ error: (res && res.note) || "no completed trades to synthesize" });
        return;
      }
      const { text, data: sdata, error } = await collectTurn(res.prompt, `day-${day}`, {
        onToken: (t) => setDaySyn({ loading: true, text: t }),
      });
      if (error && !text) { setDaySyn({ error }); return; }
      setDaySyn({ text, data: sdata });
      if (text.trim()) {
        const b = res.bundle || {};
        saveDayReview({ day, underlying: "SPX", narrative: text,
          metrics: { net_pnl: b.net_pnl, counts: b.counts, metrics: b.metrics } })
          .then(() => loadDayReviews()).catch(() => {});
      }
    } catch (e) {
      setDaySyn({ error: String((e && e.message) || e) });
    }
  };

  // stored syntheses for the selected day (newest first) — the card shows the
  // latest on open (no regeneration needed) + a history picker when there are
  // several. `synHist` holds the list; `synPick` an explicit older selection.
  const [synHist, setSynHist] = useState([]);
  const [synPick, setSynPick] = useState(null);
  const loadDayReviews = async () => {
    try {
      const r = await getDayReviews(day);
      setSynHist((r && r.available && r.reviews) || []);
    } catch (e) { /* history is a nicety — never blocks the journal */ }
  };
  useEffect(() => { setSynPick(null); setDaySyn(null); loadDayReviews(); }, [day]);

  // auto-load the day's trades on open (and when the day/underlying changes) —
  // this is a trade log; it should show the trades, not a button to fetch them.
  // A manual ⟳ stays for a mid-session re-pull.
  useEffect(() => {
    setData(null); setOpen(null); setTk("all");
    let live = true;
    (async () => {
      setBusy(true);
      const v = await getSessionActivity(day, undefined);
      if (live) { setData(v && v.available ? v : { empty: true }); setBusy(false); }
    })();
    return () => { live = false; };
  }, [snap.id, day]);

  if (!data) {
    return (
      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-spread">
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>My trades — what I actually did</h3>
            <p className="vg-note" style={{ marginTop: 4, fontSize: 13 }}>
              Every decision reconstructed from your broker fills — pinned to the underlying's
              price at the minute you submitted it, correlated to the levels you forecast,
              expiries settled against the print.
            </p>
          </div>
          <span className="vg-note">{busy ? "Loading your trades…" : ""}</span>
        </div>
      </div>
    );
  }
  if (data.empty) {
    return <div className="vg-card" style={{ marginTop: 14 }}>
      <p className="vg-note">No trades on {day}.</p></div>;
  }

  const s = data.summary || {};
  const tickers = data.tickers || [];
  // client-side ticker filter over the full list; keep original indices so the
  // DNA/analyze endpoint (which indexes into the FULL day) stays correct
  const rows = (data.trades || [])
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => tk === "all" || t.ticker === tk);
  const allLevels = [
    ...(data.forecast_levels || []).map((z) => ({ ...z, source: "confluence" })),
    ...(data.gex_anchors || []).map((a) => ({ price: a.price, role: a.label, kinds: [a.label], source: "gex" })),
    ...(data.durable_levels || []).map((d) => ({ price: d.price, role: d.label, kinds: [d.label], source: "durable" })),
  ].sort((a, b) => (b.price || 0) - (a.price || 0));

  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread">
        <h3 style={{ margin: 0, fontSize: 16 }}>My trades — {rows.length}{tk !== "all" ? ` of ${s.trades}` : ""} decisions
          <span className="vg-note" style={{ fontSize: 13, fontWeight: 400 }}>
            {" "}· click a trade to correlate it to the plan
          </span>
        </h3>
        <div className="vg-row" style={{ gap: 6, alignItems: "center" }}>
          {tickers.length > 1 && (
            <select className="vg-ticker-filter" value={tk} onChange={(e) => setTk(e.target.value)}
              title="Filter by ticker">
              <option value="all">All tickers</option>
              {tickers.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          <button className="vg-btn-sm vg-btn-primary" disabled={busy || (batch && batch.running) || (daySyn && daySyn.loading)}
            onClick={analyzeToday}
            title="Desk-review every closed trade, then a book-level day synthesis (direction / time / allocation)">
            {batch && batch.running
              ? <><span className="vg-spin" aria-hidden="true">⟳</span> Analyzing {batch.done}/{batch.total}…</>
              : daySyn && daySyn.loading
                ? <><span className="vg-spin" aria-hidden="true">⟳</span> Day synthesis…</>
                : "Analyze today"}
          </button>
          <button className="vg-btn-sm" onClick={load} disabled={busy}>{busy ? "…" : "⟳"}</button>
        </div>
      </div>
      {batch && !batch.running && batch.total > 0 && !daySyn && (
        <p className="vg-note" style={{ margin: "4px 0 0", fontSize: 12, color: "var(--vg-up)" }}>
          ✓ analyzed {batch.total} trade{batch.total === 1 ? "" : "s"} (already-analyzed ones skipped)
        </p>
      )}

      {/* the BOOK-level read, on top of the per-trade cards. Shows the LIVE
          stream while generating, else the picked/latest STORED synthesis —
          the read survives sessions and accrues history per day. */}
      {(() => {
        const live = daySyn && (daySyn.loading || daySyn.data || daySyn.text || daySyn.error);
        const stored = !live && (synPick || synHist[0]);
        if (!live && !stored) return null;
        return (
          <div className="vg-card vg-day-syn" style={{ margin: "10px 0 0" }}>
            <div className="vg-spread" style={{ alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14, letterSpacing: "0.03em" }}>
                Day synthesis <span className="vg-note" style={{ fontWeight: 400 }}>— the book, not the trades</span>
              </h4>
              {live && daySyn.loading && <span className="vg-spin" aria-hidden="true">⟳</span>}
              {stored && (
                <span className="vg-row" style={{ gap: 8, alignItems: "baseline" }}>
                  {synHist.length > 1 && (
                    <select className="vg-rp-runpick" value={(synPick || synHist[0]).id}
                      onChange={(e) => setSynPick(synHist.find((h) => String(h.id) === e.target.value) || null)}>
                      {synHist.map((h, i) => (
                        <option key={h.id} value={h.id}>
                          {String(h.generated_at || "").slice(11, 16)}{i === 0 ? " (latest)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="vg-note" style={{ fontSize: "var(--vg-text-xs)" }}>
                    saved {String(stored.generated_at || "").slice(0, 16).replace("T", " ")}
                  </span>
                </span>
              )}
            </div>
            {live
              ? (daySyn.error
                ? <p className="vg-note" style={{ marginTop: 6 }}>{daySyn.error}</p>
                : (daySyn.data || daySyn.text)
                  ? <div style={{ marginTop: 8 }}><MiraRender data={daySyn.data} text={daySyn.text} /></div>
                  : <p className="vg-note" style={{ marginTop: 6 }}>Reading the day…</p>)
              : <div style={{ marginTop: 8 }}><MiraRender data={parseMira(stored.narrative)} text={stored.narrative} /></div>}
          </div>
        );
      })()}

      {/* the day, reconciled — including the money no fill showed */}
      <div className="vg-row" style={{ gap: 20, margin: "10px 0", flexWrap: "wrap", fontSize: 14 }}>
        <span>P&L <b className={s.realized >= 0 ? "vg-up" : "vg-down"}>{money(s.realized)}</b></span>
        <span className="vg-note">fills {money(s.realized_from_fills)}</span>
        {s.expired > 0 && <span className="vg-note">expiry {money(s.realized_from_expiry)} · {s.expired_worthless} worthless <b className="vg-down">{money(s.expired_loss)}</b></span>}
        <span className="vg-note">{s.winners}W / {s.losers}L</span>
        {s.win_rate != null && (
          <span className="vg-note">win rate <b>{Math.round(s.win_rate * 100)}%</b></span>
        )}
        {s.profit_factor != null && (
          <span className="vg-note">profit factor{" "}
            <b className={s.profit_factor >= 1 ? "vg-up" : "vg-down"}>{s.profit_factor.toFixed(2)}</b></span>
        )}
        {s.settle_price && <span className="vg-note">SPX settled {fmtLvl(s.settle_price)}</span>}
        {s.level_discipline != null && (
          <span className="vg-note">entered at level <b>{Math.round(s.level_discipline * 100)}%</b></span>
        )}
        {s.exit_discipline != null && (
          <span className="vg-note">exited at level <b>{Math.round(s.exit_discipline * 100)}%</b></span>
        )}
        {s.level_to_level > 0 && (
          <span className="vg-note"><b>{s.level_to_level}</b> level-to-level</span>
        )}
      </div>

      {/* the trade log — a row per decision, expandable. rows are the ticker-
          filtered view; `i` is the ORIGINAL index into the full day (the DNA/
          analyze endpoint indexes into that), so filtering never mis-targets. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(({ t, i }) => {
          // include the ACCOUNT so the key is unique AND stable: two per-account
          // trades can share opened_at + label (a strike traded in both RH
          // accounts), which collided the React key and left a stale row on
          // filter. Account is stable across reloads, so persisted thoughts
          // still reattach (unlike a positional index).
          const key = `${t.account || ""}|${t.opened_at || i}|${t.label}`;
          return (
            <TradeCard key={key} t={t} tkey={key} tradeIndex={i}
              day={day} underlying={t.ticker || "SPX"}
              expanded={open === key} onToggle={() => setOpen(open === key ? null : key)}
              thought={(thoughts && thoughts[key]) || ""} onThought={(v) => onThought(key, v)}
              allLevels={allLevels} />
          );
        })}
      </div>
      <p className="vg-note" style={{ fontSize: 12, marginTop: 8 }}>
        Price is the 1-minute print at submission, per the trade's own ticker. Tag the level
        you were trading — the broker says WHAT you did; only you can say WHY. Saves with the entry.
      </p>
    </div>
  );
}

// The operator's intent for a trade: the free-text WHY plus the entry/exit
// level TAGS — the operator's own tag when set, else AUTO-correlated to the
// nearest level the trade was AT (within tolerance; open-space stays blank).
// Shared by the card and the batch analyzer so both ground the read the same.
// ── Journal Analysis: the compounding aggregate self-assessment ──────────────
// Picks a window (tagged daily/weekly/monthly), pulls the deterministic bundle
// (scores + pattern census + citations + the PRIOR analysis), streams Mira's
// journal_analyst for the SWOT + read, stores it so knowledge compounds, and
// shows the score trend + recommendation status vs the prior run.
const REC_TONE = { improving: "good", worse: "bad", flat: "plain", new: "plain" };
const SCORE_TONE = (s) => (s >= 70 ? "good" : s >= 45 ? "warn" : "bad");
const RUBRIC_LABELS = {
  entry_discipline: "Entry discipline", exit_discipline: "Exit discipline",
  risk_sizing: "Risk & sizing", plan_adherence: "Plan adherence",
  emotional_control: "Emotional control",
};


// The saved detail of ONE stored analysis — scorecard (scores + patterns) then
// the SWOT (structured grid or prose fallback). Rendered INSIDE an expanded
// history row. Pure from the stored row `h`; no Mira call.
function AnalysisDetail({ h }) {
  const recs = (h.recommendations && h.recommendations.length)
    ? h.recommendations
    : Object.entries(h.scores || {}).map(([dim, score]) => ({
        dimension: dim, label: RUBRIC_LABELS[dim] || dim, score,
        status: "new", delta: null,
      }));
  return (
    <div className="vg-ja-detail">
      <div className="vg-spread">
        <div className="vg-kicker" style={{ margin: 0 }}>Scorecard</div>
        <span className="vg-note" style={{ fontSize: 13 }}>
          {h.trades} trades · net <b className={h.net_pnl >= 0 ? "vg-up" : "vg-down"}>{money(h.net_pnl)}</b> · rubric v{h.rubric_version}
        </span>
      </div>
      <div className="vg-scores">
        {recs.map((r) => (
          <div key={r.dimension} className="vg-score">
            <div className="vg-spread" style={{ alignItems: "baseline" }}>
              <span style={{ fontSize: 14 }}>{r.label}</span>
              <span className="vg-row" style={{ gap: 6, alignItems: "baseline" }}>
                <b className={cls("vg-score-n", `vg-${SCORE_TONE(r.score)}`)}>{r.score}</b>
                {r.delta != null
                  ? <span className={cls("vg-badge", REC_TONE[r.status])} style={{ fontSize: 12 }}>
                      {r.delta > 0 ? "▲" : r.delta < 0 ? "▼" : "—"}{Math.abs(r.delta)} · {r.status}</span>
                  : <span className="vg-badge plain" style={{ fontSize: 12 }}>baseline</span>}
              </span>
            </div>
            <div className="vg-score-track"><div className={cls("vg-score-fill", `bg-${SCORE_TONE(r.score)}`)} style={{ width: `${r.score}%` }} /></div>
          </div>
        ))}
      </div>
      {(h.patterns || []).length > 0 && (<>
        <div className="vg-kicker" style={{ marginTop: 16 }}>Recurring patterns</div>
        <table className="vg-mini" style={{ marginTop: 4 }}><tbody>
          {h.patterns.map((p, i) => (
            <tr key={i}>
              <td style={{ width: 26, textAlign: "right", color: "var(--vg-down)", fontWeight: 700 }}>{p.count}×</td>
              <td>{p.pattern}<span className="vg-note" style={{ fontSize: 12 }}> · {(p.cites || []).length} trades</span></td>
            </tr>
          ))}
        </tbody></table>
      </>)}
      <div className="vg-kicker" style={{ marginTop: 16 }}>SWOT &amp; read</div>
      {h.swot ? <SwotRender swot={h.swot} />
        : <div className="vg-dna-read" style={{ marginTop: 8 }}>{h.narrative || "(no narrative saved)"}</div>}
    </div>
  );
}

function JournalAnalysisPanel({ sym }) {
  const [win, setWin] = useState(() => {
    const to = todayISO();
    const from = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    return { from, to, period: "weekly" };
  });
  const [bundle, setBundle] = useState(null);
  const [read, setRead] = useState(null);      // {loading|text|error}
  const [saved, setSaved] = useState(false);
  const [hist, setHist] = useState(null);
  const abortRef = useRef(null);

  const [openId, setOpenId] = useState(null);   // expanded history row (like a trade card)

  // Toggle a stored analysis open/closed — click the row to expand its saved
  // detail inline, click again (or its header) to collapse. Same feel as the
  // trade cards.
  const toggleStored = (h) => setOpenId((cur) => (cur === h.id ? null : h.id));

  const loadHist = async () => {
    const h = await getJournalAnalyses(sym);
    const list = h && h.available ? (h.analyses || []) : [];
    setHist(list);
    return list;
  };
  useEffect(() => {
    setBundle(null); setRead(null); setSaved(false); setOpenId(null);
    loadHist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);

  // Generate: pull the bundle, stream Mira, then store the run (compounding).
  const generate = async () => {
    setRead({ loading: true }); setSaved(false);
    const res = await getJournalAnalysisBundle(win.from, win.to, sym);
    if (!res || !res.available || !res.bundle) {
      setRead({ error: (res && res.note) || "couldn't build the bundle" }); return;
    }
    setBundle(res.bundle);
    setRead({ text: "" });
    // Render via the shared generic renderer; a malformed/absent JSON → parseMira
    // returns null and MiraRender shows prose — the operator always gets a result.
    const { text, data, error } = await collectTurn(res.prompt, `journal-${win.from}-${win.to}`, {
      onToken: (t) => setRead({ text: t }),
      setAbort: (fn) => { abortRef.current = fn; },
    });
    if (error && !text) { setRead({ error }); return; }
    setRead({ text, data, mode: data ? "structured" : "prose" });
    if (text.trim()) {
      const b = res.bundle;
      saveJournalAnalysis({
        period: win.period, window_from: win.from, window_to: win.to,
        underlying: sym, rubric_version: b.rubric_version,
        trades: b.trades, net_pnl: b.net_pnl, scores: b.scores,
        patterns: b.patterns, recommendations: b.recommendations,
        swot: swot || null, narrative: text,
      }).then((r) => {
        setSaved(true);
        // the run is now a saved history row — clear the live view and expand
        // the fresh row inline (so there's one place it lives).
        loadHist().then(() => {
          setRead(null); setBundle(null);
          if (r && r.id) setOpenId(r.id);
        });
      });
    }
  };
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);

  const b = bundle;
  const busy = read && read.loading;
  const streaming = read && read.text != null && !saved && !read.error;

  return (
    <div className="vg-ja vg-loadhost">
      {(busy || streaming) && <LoadBar />}
      {/* window + period picker */}
      <div className="vg-card" style={{ marginTop: 12 }}>
        <div className="vg-spread" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div className="vg-row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="vg-trade-field"><label>From</label>
              <input type="date" value={win.from} max={win.to}
                onChange={(e) => setWin({ ...win, from: e.target.value })} /></div>
            <div className="vg-trade-field"><label>To</label>
              <input type="date" value={win.to} min={win.from} max={todayISO()}
                onChange={(e) => setWin({ ...win, to: e.target.value })} /></div>
            <div className="vg-trade-field"><label>Tag this run</label>
              <select value={win.period} onChange={(e) => setWin({ ...win, period: e.target.value })}>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
                <option value="on-demand">on-demand</option>
              </select></div>
            <div className="vg-row" style={{ gap: 4 }}>
              {[["1D", 0], ["7D", 6], ["30D", 29]].map(([lab, back]) => (
                <button key={lab} className="vg-btn-sm" onClick={() => setWin({
                  ...win, from: new Date(Date.now() - back * 864e5).toISOString().slice(0, 10), to: todayISO(),
                  period: back === 0 ? "daily" : back === 6 ? "weekly" : "monthly",
                })}>{lab}</button>
              ))}
            </div>
          </div>
          <button className="vg-btn vg-btn-primary" disabled={busy || streaming} onClick={generate}>
            {busy || streaming
              ? <><span className="vg-spin" aria-hidden="true">⟳</span> Analyzing…</>
              : "Generate analysis"}
          </button>
        </div>
        <p className="vg-note" style={{ marginTop: 8, fontSize: 13 }}>
          Scores the window against a rubric, aggregates every recorded trade review into a SWOT,
          and builds on the last analysis so your self-knowledge compounds. Analyze trades first (Days → Analyze today).
        </p>
      </div>

      {/* the LIVE run only — the deterministic scorecard + patterns while a
          fresh analysis streams. Stored analyses expand inline in the history
          below, so this shows only during generate. */}
      {b && read && (
        <div className="vg-card" style={{ marginTop: 12 }}>
          <div className="vg-spread">
            <div className="vg-kicker" style={{ margin: 0 }}>Scorecard · {b.window_from} → {b.window_to}</div>
            <span className="vg-note" style={{ fontSize: 13 }}>
              {b.trades} trades{b.analyzed != null ? ` · ${b.analyzed} reviewed` : ""} · net <b className={b.net_pnl >= 0 ? "vg-up" : "vg-down"}>{money(b.net_pnl)}</b>
              {b.overall && b.overall.win_rate != null && <> · win rate <b>{Math.round(b.overall.win_rate * 100)}%</b></>}
              {b.overall && b.overall.profit_factor != null && (
                <> · PF <b className={b.overall.profit_factor >= 1 ? "vg-up" : "vg-down"}>{b.overall.profit_factor.toFixed(2)}</b></>
              )}
              {" "}· rubric v{b.rubric_version}
            </span>
          </div>
          <div className="vg-scores">
            {b.recommendations.map((r) => (
              <div key={r.dimension} className="vg-score">
                <div className="vg-spread" style={{ alignItems: "baseline" }}>
                  <span style={{ fontSize: 14 }}>{r.label}</span>
                  <span className="vg-row" style={{ gap: 6, alignItems: "baseline" }}>
                    <b className={cls("vg-score-n", `vg-${SCORE_TONE(r.score)}`)}>{r.score}</b>
                    {r.delta != null && (
                      <span className={cls("vg-badge", REC_TONE[r.status])} style={{ fontSize: 12 }}>
                        {r.delta > 0 ? "▲" : r.delta < 0 ? "▼" : "—"}{Math.abs(r.delta)} · {r.status}
                      </span>
                    )}
                    {r.delta == null && <span className="vg-badge plain" style={{ fontSize: 12 }}>baseline</span>}
                  </span>
                </div>
                <div className="vg-score-track"><div className={cls("vg-score-fill", `bg-${SCORE_TONE(r.score)}`)} style={{ width: `${r.score}%` }} /></div>
              </div>
            ))}
          </div>
          {/* pattern census with citations */}
          <div className="vg-kicker" style={{ marginTop: 16 }}>Recurring patterns</div>
          <table className="vg-mini" style={{ marginTop: 4 }}><tbody>
            {b.patterns.map((p, i) => (
              <tr key={i}>
                <td style={{ width: 26, textAlign: "right", color: "var(--vg-down)", fontWeight: 700 }}>{p.count}×</td>
                <td>{p.pattern}<span className="vg-note" style={{ fontSize: 12 }}> · {p.cites.length} trades</span></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      {/* Mira's SWOT + read. Structured JSON can't render mid-stream, so while
          streaming we show a writing state; on `done` we parse+validate and
          render the SWOT grid, or fall back to the prose read. */}
      {read && (read.text != null || read.error || read.loading) && (
        <div className="vg-card" style={{ marginTop: 12 }}>
          <div className="vg-spread">
            <div className="vg-kicker" style={{ margin: 0 }}>
              SWOT &amp; read {saved && <span className="vg-up" style={{ fontSize: 12 }}>✓ saved</span>}
            </div>
            {read.mode === "prose" && (
              <span className="vg-note" style={{ fontSize: 12 }} title="the model's output wasn't structured JSON — showing the prose read">
                prose fallback
              </span>
            )}
          </div>
          {read.loading && <p className="vg-note" style={{ marginTop: 8 }}>Aggregating your reviews and scoring the window…</p>}
          {read.error && <p className="vg-note" style={{ marginTop: 8, color: "var(--vg-down)" }}>{read.error}</p>}
          {/* streaming (text arriving, not yet parsed) → writing state */}
          {read.text != null && read.mode == null && !read.error && (
            <p className="vg-note" style={{ marginTop: 8 }}>
              <span className="vg-spin" aria-hidden="true">⟳</span> Mira is writing the desk review…
            </p>
          )}
          {/* done → generic structured render (SWOT is one section kind), or prose */}
          {(read.data || read.text) && <MiraRender data={read.data} text={read.text} />}
        </div>
      )}

      {/* the analyses (the compounding record). Each row expands inline on
          click to its saved detail (scorecard + SWOT) — same feel as a trade
          card; click the header again to collapse. */}
      {hist && hist.length > 0 && (
        <div className="vg-card" style={{ marginTop: 12 }}>
          <div className="vg-kicker">Analyses · click a row to open · knowledge compounds</div>
          {/* flex rows (not a table) so an expanded row's rich detail fills the
              panel width instead of fighting table column widths (which clipped
              the content on the left). */}
          <div className="vg-ja-list" style={{ marginTop: 6 }}>
            <div className="vg-ja-hrow vg-ja-head vg-note">
              <span className="c-win">window</span>
              <span className="c-tag">tag</span>
              <span className="c-sc">entry</span><span className="c-sc">exit</span>
              <span className="c-sc">risk</span><span className="c-sc">plan</span>
              <span className="c-net">net</span>
            </div>
            {hist.map((h) => {
              const s = h.scores || {};
              const isOpen = openId === h.id;
              return (
                <div key={h.id} className="vg-ja-item">
                  <div className={cls("vg-ja-hrow", "vg-ja-row", isOpen && "open")}
                    onClick={() => toggleStored(h)}
                    title={isOpen ? "Collapse" : "Expand this analysis"}>
                    <span className="c-win">{isOpen ? "▾ " : "▸ "}{h.window_from} → {h.window_to}</span>
                    <span className="c-tag"><span className="vg-badge plain" style={{ fontSize: 12 }}>{h.period}</span></span>
                    <span className={cls("c-sc", `vg-${SCORE_TONE(s.entry_discipline || 0)}`)}>{s.entry_discipline ?? "—"}</span>
                    <span className={cls("c-sc", `vg-${SCORE_TONE(s.exit_discipline || 0)}`)}>{s.exit_discipline ?? "—"}</span>
                    <span className={cls("c-sc", `vg-${SCORE_TONE(s.risk_sizing || 0)}`)}>{s.risk_sizing ?? "—"}</span>
                    <span className={cls("c-sc", `vg-${SCORE_TONE(s.plan_adherence || 0)}`)}>{s.plan_adherence ?? "—"}</span>
                    <span className={cls("c-net", h.net_pnl >= 0 ? "vg-up" : "vg-down")}>{money(h.net_pnl)}</span>
                  </div>
                  {isOpen && <AnalysisDetail h={h} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function operatorFor(t, thought) {
  const m = (thought || "").match(/^@([\d.]*)(?:\/([\d.]*))?\|/) || [];
  const why = (thought || "").replace(/^@[\d.]*(?:\/[\d.]*)?\|/, "");
  const corr = t.correlation, exitCorr = t.exit_correlation;
  const nearest = corr && corr.nearest, exitNearest = exitCorr && exitCorr.nearest;
  const autoEntry = (corr && corr.at_level && nearest) ? String(nearest.level) : null;
  const autoExit = (exitCorr && exitCorr.at_level && exitNearest) ? String(exitNearest.level) : null;
  return {
    why,
    entryTag: m[1] || autoEntry, exitTag: m[2] || autoExit,
    entryTagAuto: !m[1] && !!autoEntry, exitTagAuto: !m[2] && !!autoExit,
  };
}

function TradeCard({ t, tkey, tradeIndex, day, underlying, expanded, onToggle, thought, onThought, allLevels }) {
  const corr = t.correlation;
  const nearest = corr && corr.nearest;
  const exitCorr = t.exit_correlation;
  const exitNearest = exitCorr && exitCorr.nearest;
  const long = String(t.strategy).includes("call");
  // persisted as "@<entry>[/<exit>]|<why>" — entry level, optional exit level,
  // then the free-text thinking. Parse the three back out (raw, for the setters).
  const m = thought.match(/^@([\d.]*)(?:\/([\d.]*))?\|/) || [];
  // the operator's intent, with auto-correlation applied (shared with the batch)
  const op = operatorFor(t, thought);
  const why = op.why;
  const tag = op.entryTag, exitTag = op.exitTag;
  const tagAuto = op.entryTagAuto, exitTagAuto = op.exitTagAuto;
  // Setters persist the RAW operator tags (m[1]/m[2]), never the auto-filled
  // ones — editing the WHY must not silently commit a system-inferred level.
  const rawTag = m[1] || null, rawExit = m[2] || null;
  const encode = (e, x, w) => {
    if (!e && !x) return w;
    return `@${e || ""}${x ? `/${x}` : ""}|${w}`;
  };
  const setTag = (level) => onThought(encode(level, rawExit, why));
  const setExitTag = (level) => onThought(encode(rawTag, level, why));
  const setWhy = (v) => onThought(encode(rawTag, rawExit, v));

  return (
    <div className={cls("vg-trade", expanded && "open")}>
      {/* collapsed summary row */}
      <div className="vg-trade-row" onClick={onToggle}>
        <span className="vg-trade-time">{t.opened_et || (t.opened_at || "").slice(11, 16) || "—"}</span>
        <span className="vg-trade-name">
          {t.ticker && (
            <span className="vg-badge accent vg-ticker-badge" title={`ticker: ${t.ticker}`}>{t.ticker}</span>
          )}
          <b className={long ? "vg-up" : "vg-down"}>{t.label}</b>
          {t.account_label && (
            <span className="vg-badge plain" style={{ marginLeft: 6, fontSize: 12 }}
              title={`account: ${t.account_label}`}>{t.account_label}</span>
          )}
        </span>
        <span className="vg-trade-spx">{t.ticker || "SPX"} {fmtLvl(t.spot_at_entry)}</span>
        <span>
          {nearest
            ? <span className={cls("vg-badge", corr.at_level ? "good" : "plain")}
                title={`entry: ${nearest.role || ""} ${(nearest.kinds || []).join(" + ")}`}>
                {corr.at_level ? "✓ " : ""}{fmtLvl(nearest.level)}
              </span>
            : <span className="vg-note">—</span>}
          {exitNearest && (
            <span className="vg-note" style={{ margin: "0 3px" }}>→</span>
          )}
          {exitNearest && (
            <span className={cls("vg-badge", t.exit_correlation.at_level ? "good" : "plain")}
              title={`exit: ${exitNearest.role || ""} ${(exitNearest.kinds || []).join(" + ")}`}>
              {t.exit_correlation.at_level ? "✓ " : ""}{fmtLvl(exitNearest.level)}
            </span>
          )}
        </span>
        {t.status === "open"
          ? <span className="vg-trade-pnl vg-note" title="open position — no realized P&L yet">open</span>
          : <span className={cls("vg-trade-pnl", t.realized >= 0 ? "vg-up" : "vg-down")}>{money(t.realized)}</span>}
        <span className={cls("vg-badge", STATUS_TONE[t.status] || "plain")}>{STATUS_LABEL[t.status] || t.status}</span>
        <span className="vg-trade-caret">{expanded ? "▾" : "▸"}</span>
      </div>

      {/* expanded detail — the correlation + your thinking */}
      {expanded && (
        <div className="vg-trade-detail">
          <div className="vg-trade-grid">
            {/* the order, as facts */}
            <div>
              <div className="vg-kicker">The order</div>
              <table className="vg-mini"><tbody>
                <tr><td>strategy</td><td>{t.strategy}</td></tr>
                {t.legs.map((l, i) => (
                  <tr key={i}><td>{l.side}</td>
                    <td>{l.qty} × {(l.symbol || "").replace(/^\S+\s\S+\s/, "")} @ {l.price}</td></tr>
                ))}
                <tr><td>opened</td><td>{t.opened_et ? `${t.opened_et} ET` : "—"}</td></tr>
                {t.closed_at && <tr><td>closed</td><td>{t.closed_et ? `${t.closed_et} ET` : "—"}</td></tr>}
                <tr><td>cost</td><td>{money(t.cost)}</td></tr>
                {t.proceeds ? <tr><td>proceeds</td><td>{money(t.proceeds)}</td></tr> : null}
                {t.settlement != null && <tr><td>settlement</td><td>{money(t.settlement)} @ SPX {fmtLvl(t.settle_price)}</td></tr>}
                {t.status === "open"
                  ? <tr><td><b>status</b></td><td><b>open</b> <span className="vg-note">· {money(t.cost_basis)} in, no realized P&amp;L yet</span></td></tr>
                  : <tr><td><b>realized</b></td><td><b className={t.realized >= 0 ? "vg-up" : "vg-down"}>{money(t.realized)}</b></td></tr>}
              </tbody></table>
              <FillLadder fills={t.fills} scale={t.scale} />
            </div>

            {/* the correlation to the plan — ENTRY and EXIT */}
            <div>
              {/* the arc: where price was in vs. out */}
              <div className="vg-kicker">The arc</div>
              <div style={{ fontSize: 14, margin: "2px 0 10px", fontVariantNumeric: "tabular-nums" }}>
                in <b>{fmtLvl(t.spot_at_entry)}</b>
                {nearest && <span className={cls("vg-badge", corr.at_level ? "good" : "plain")} style={{ marginLeft: 4 }}>{fmtLvl(nearest.level)}</span>}
                <span className="vg-note" style={{ margin: "0 6px" }}>→</span>
                out <b>{fmtLvl(t.spot_at_exit)}</b>
                {exitNearest && <span className={cls("vg-badge", exitCorr.at_level ? "good" : "plain")} style={{ marginLeft: 4 }}>{fmtLvl(exitNearest.level)}</span>}
                {t.spot_at_entry != null && t.spot_at_exit != null && (
                  <span className="vg-note"> · {(t.spot_at_exit - t.spot_at_entry) >= 0 ? "+" : ""}{(t.spot_at_exit - t.spot_at_entry).toFixed(1)}pt {t.ticker || "SPX"}
                    {String(t.status).startsWith("expired") ? " (settlement)" : ""}</span>
                )}
              </div>

              <CorrTable title={`Entry · ${t.ticker || "SPX"} ${fmtLvl(t.spot_at_entry)}`} corr={corr} openSpace="entry was in open space" />
              <div style={{ marginTop: 8 }}>
                <CorrTable title={`Exit · ${t.ticker || "SPX"} ${fmtLvl(t.spot_at_exit)}${String(t.status).startsWith("expired") ? " (settled)" : ""}`}
                  corr={exitCorr} openSpace="exit was in open space" />
              </div>

              {/* TAG the levels you were actually trading — in and out */}
              <div className="vg-row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <div className="vg-trade-field" style={{ flex: 1, minWidth: 150 }}>
                  <label>Level I entered on {tagAuto && <span className="vg-note" style={{ fontWeight: 400 }}>· auto</span>}</label>
                  <select value={tag || ""} onChange={(e) => setTag(e.target.value || null)}>
                    <option value="">— none / open space —</option>
                    {allLevels.map((l, i) => (
                      <option key={i} value={l.price}>
                        {fmtLvl(l.price)} · {l.role}{(l.kinds || []).length ? ` (${l.kinds.join(" + ")})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="vg-trade-field" style={{ flex: 1, minWidth: 150 }}>
                  <label>Level I exited on {exitTagAuto && <span className="vg-note" style={{ fontWeight: 400 }}>· auto</span>}</label>
                  <select value={exitTag || ""} onChange={(e) => setExitTag(e.target.value || null)}>
                    <option value="">— none / open space —</option>
                    {allLevels.map((l, i) => (
                      <option key={i} value={l.price}>
                        {fmtLvl(l.price)} · {l.role}{(l.kinds || []).length ? ` (${l.kinds.join(" + ")})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* the thinking behind the decision */}
          <div className="vg-trade-field" style={{ marginTop: 10 }}>
            <label>My thinking — why did I take this trade?</label>
            <textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)}
              placeholder="the read, the trigger, what I was expecting — the WHY the broker can't record" />
          </div>

          {/* step 2: the full DNA read by Mira (news + sentiment + the tape) */}
          <AnalyzeTrade day={day} tradeIndex={tradeIndex} underlying={underlying}
            why={why} entryTag={tag} exitTag={exitTag} label={t.label} />
        </div>
      )}
    </div>
  );
}

// ── Analyze this trade: Vantage DNA → Mira trade-analyst ──────────────────────
//
// Step 2 of the two-step flow. Pulls the full DNA from Vantage (price action,
// volume, technicals, level correlation), wraps it in a trade-analyst brief
// that ALSO asks Mira to weigh news + sentiment for the underlying, and streams
// Run ONE trade's analysis end to end (DNA → prompt → model stream → save) as
// a promise, for the batch "Analyze today" runner. Resolves {status:'saved'|
// 'skipped'|'empty'|'error'}. onChunk is optional (live streaming into a UI).
// Skips a trade that already has a stored analysis unless force is set.
async function analyzeTradeOnce(day, tradeIndex, underlying, operator, { force = false, onChunk } = {}) {
  const res = await getTradeDna(day, tradeIndex, underlying);
  if (!res || !res.available || !res.dna) return { status: "error", note: (res && res.note) || "no DNA" };
  if (!force && res.stored && (res.stored.analysis || "").trim()) return { status: "skipped" };
  const prompt = buildAnalystPrompt(res.dna, operator || {}, res.playbook_session);
  const { text, error } = await collectTurn(prompt, `trade-${day}-${tradeIndex}`, { onToken: onChunk });
  if (error && !text) return { status: "error", note: error };
  if (text.trim() && res.trade_key) {
    saveTradeAnalysis({ day, trade_key: res.trade_key, underlying,
      label: res.dna.label, dna: res.dna, analysis: text });
    return { status: "saved" };
  }
  return { status: "empty" };
}

// the read. The "entire DNA of the trade" in one place.
function AnalyzeTrade({ day, tradeIndex, underlying, why, entryTag, exitTag, label }) {
  const [state, setState] = useState(null);   // null | "loading" | "streaming" | {text} | {error}
  const abortRef = useRef(null);
  const readRef = useRef(null);
  // a run is in flight while we're building the DNA ("loading") or the model is
  // still streaming with nothing rendered yet ("streaming") — used to disable
  // the button and show a spinner so a click is never mistaken for "did nothing".
  const busy = state === "loading" || state === "streaming";

  const run = async () => {
    setState("loading");
    const res = await getTradeDna(day, tradeIndex, underlying);
    if (!res || !res.available || !res.dna) {
      setState({ error: (res && res.note) || "couldn't build the trade DNA" });
      return;
    }
    const prompt = buildAnalystPrompt(res.dna, { why, entryTag, exitTag }, res.playbook_session);
    setState("streaming");
    const { text, error } = await collectTurn(prompt, `trade-${day}-${tradeIndex}`, {
      onToken: (t) => setState({ text: t }),
      setAbort: (fn) => { abortRef.current = fn; },
    });
    if (error && !text) { setState({ error }); return; }
    // The trade-analyst routes and the supervisor synthesizes with the model, so
    // `text` is a real prose review. Freeze it + the DNA into the record (survives
    // 1m bars ageing out).
    if (text.trim() && res.trade_key) {
      saveTradeAnalysis({
        day, trade_key: res.trade_key, underlying, label: res.dna.label,
        dna: res.dna, analysis: text,
      });
    }
    setState({ text, dna: res.dna, saved: !!text.trim() });
    // pull the finished read into view — it renders below the fold, so completion
    // was invisible if the operator had scrolled away.
    setTimeout(() => readRef.current &&
      readRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };

  // show a previously-saved read on open, so the record persists across sessions
  useEffect(() => {
    let live = true;
    (async () => {
      const res = await getTradeDna(day, tradeIndex, underlying);
      if (live && res && res.stored) {
        setState({ text: res.stored.analysis || "",
                   dna: (res.stored.dna && res.stored.dna.label) ? res.stored.dna : res.dna,
                   saved: true, analyzedAt: res.stored.analyzed_at });
      }
    })();
    return () => { live = false; if (abortRef.current) abortRef.current(); };
  }, [day, tradeIndex, underlying]);

  return (
    <div className="vg-loadhost" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--vg-hairline)" }}>
      {busy && <LoadBar />}
      <div className="vg-spread">
        <div className="vg-kicker" style={{ margin: 0 }}>The DNA — Mira's read</div>
        {busy ? (
          <button className="vg-btn-sm" disabled aria-busy="true"
            style={{ opacity: 0.7, cursor: "wait" }}>
            <span className="vg-spin" aria-hidden="true">⟳</span> Analyzing…
          </button>
        ) : (typeof state === "object" && state && state.text != null) ? (
          <button className="vg-btn-sm" onClick={run}>↻ Re-analyze</button>
        ) : (
          <button className="vg-btn-sm" onClick={run}>🧬 Analyze this trade</button>
        )}
      </div>
      {busy && (
        <p className="vg-note" style={{ marginTop: 8 }}>
          {state === "loading"
            ? "Building the DNA (price action · volume · technicals · levels) and reading news + sentiment…"
            : "Mira is writing the desk review…"}
        </p>
      )}
      {typeof state === "object" && state && state.error &&
        <p className="vg-note" style={{ marginTop: 8, color: "var(--vg-down)" }}>{state.error}</p>}
      {typeof state === "object" && state && state.text != null && (
        <div ref={readRef}>
        {/* the model's read — structured (generic sections) when it returned JSON,
            else clean prose. Same renderer as the journal analysis. */}
        {state.text.trim() && (
          <div style={{ marginTop: 8 }}><MiraRender text={state.text} /></div>
        )}
        {/* the structured DNA read — always shown; this IS the full picture */}
        {state.dna && <DnaReadout dna={state.dna} />}
        {state.modelUnavailable && (
          <p className="vg-note" style={{ fontSize: 12, marginTop: 6 }}>
            The narrative read is pending Mira's turn-path model synthesis; the full
            structured DNA above is the complete record.
          </p>
        )}
        {state.saved && (
          <p className="vg-note" style={{ fontSize: 12, marginTop: 4 }}>
            ✓ saved to this trade's record{state.analyzedAt ? ` · ${String(state.analyzedAt).slice(0, 16).replace("T", " ")}` : ""}
          </p>
        )}
        </div>
      )}
    </div>
  );
}

// The DNA as a structured read — the full picture in plain English, deterministic.
// This is what "the entire DNA of the trade" means: every fact, judged.
function DnaReadout({ dna }) {
  const e = dna.entry, x = dna.exit;
  const et = e.technicals || {}, xt = x.technicals || {};
  const eq = e.quality || {}, xq = x.quality || {};
  const en = e.correlation && e.correlation.nearest;
  const xn = x.correlation && x.correlation.nearest;
  const pts = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}pt`);
  const call = String(dna.strategy).includes("call");
  // read the fill quality in words
  const entryRead = eq.pre_move == null ? "" :
    (eq.pre_move < 0 ? `price pulled back ${pts(eq.pre_move)} into the fill (bought the dip)`
     : `price ran ${pts(eq.pre_move)} into the fill (bought strength)`)
    + (eq.post_move != null ? `, then moved ${pts(eq.post_move)} in your favor` : "");
  const exitRead = xq.pre_move == null ? "" :
    (xq.pre_move > 0 ? `price spiked ${pts(xq.pre_move)} into the exit (sold into strength)`
     : `price was falling ${pts(xq.pre_move)} into the exit`)
    + (xq.post_move != null ? `, then went ${pts(xq.post_move)} after` : "");
  return (
    <div style={{ marginTop: 8 }}>
      <table className="vg-mini" style={{ maxWidth: 560 }}><tbody>
        <tr><td style={{ width: 70 }}><b>Timeframe</b></td>
          <td>{dna.timeframe} · {dna.bar_interval} bars{dna.coarse ? " (1m unavailable — coarse)" : ""}</td></tr>
        <tr><td><b>Entry</b></td>
          <td>{dna.underlying || "SPX"} <b>{e.spot}</b>{en ? <> — {en.at_level || (e.correlation && e.correlation.at_level) ? "at " : "near "}
            the <b>{en.level}</b> {en.role} ({(en.kinds || []).join(" + ")}), {pts(en.distance)} away</> : ""}.
            {" "}{entryRead}.</td></tr>
        <tr><td /><td className="vg-note">VWAP {et.vwap} ({et.vs_vwap >= 0 ? "+" : ""}{et.vs_vwap} vs price)
          {et.rsi != null ? ` · RSI ${Math.round(et.rsi)}` : ""} · rel-vol {et.rel_volume}× · ATR {et.atr}</td></tr>
        <tr><td><b>Exit</b></td>
          <td>{dna.underlying || "SPX"} <b>{x.spot}</b>{x.is_settlement ? " (expiry settlement)" : ""}{xn ? <> — {(x.correlation && x.correlation.at_level) ? "at " : "near "}
            the <b>{xn.level}</b> {xn.role} ({(xn.kinds || []).join(" + ")}), {pts(xn.distance)} away</> : ""}.
            {" "}{exitRead}.</td></tr>
        <tr><td /><td className="vg-note">VWAP {xt.vwap} ({xt.vs_vwap >= 0 ? "+" : ""}{xt.vs_vwap} vs price)
          {xt.rsi != null ? ` · RSI ${Math.round(xt.rsi)}${xt.rsi >= 70 ? " (extended)" : ""}` : ""} · rel-vol {xt.rel_volume}× · ATR {xt.atr}</td></tr>
        <tr><td><b>Result</b></td>
          {dna.realized == null
            ? <td><b>open</b> <span className="vg-note">· no realized P&amp;L yet</span></td>
            : <td><b className={dna.realized >= 0 ? "vg-up" : "vg-down"}>{dna.realized >= 0 ? "+" : "−"}${Math.abs(dna.realized).toLocaleString()}</b>
              {" "}· {dna.status.replace("_", " ")}</td>}</tr>
      </tbody></table>
    </div>
  );
}

// Turn the structured DNA into an analyst brief. Deliberately framed as a
// self-contained REVIEW (not "analyze <ticker>") so Mira's supervisor routes
// it to the direct model turn rather than the equity fan-out — the DNA is the
// full payload, so the read should reason over THAT, not re-fetch facets.
function buildAnalystPrompt(dna, operator, session) {
  const j = (o) => JSON.stringify(o);
  const e = dna.entry, x = dna.exit;
  const { why, entryTag, exitTag } = operator || {};
  const win = (w) => (w || []).map((b) =>
    `  ${b.time}  O${b.open} H${b.high} L${b.low} C${b.close}  vol ${b.volume}${b.at_fill ? "  «FILL»" : ""}`).join("\n");
  // Routes to Mira's trade_analyst specialist ("review this trade" keywords);
  // the supervisor synthesizes the read with the model (Option A). The DNA is
  // inlined ONCE below (single source of truth).
  const operatorBlock = [];
  if (why) operatorBlock.push(`- Their stated reasoning: "${why}"`);
  if (entryTag) operatorBlock.push(`- They say they entered on the ${entryTag} level.`);
  if (exitTag) operatorBlock.push(`- They say they exited on the ${exitTag} level.`);

  return [
    `Review this options trade AND critique the operator's own reasoning against the tape, the technicals, and best practice. Be a demanding desk mentor — validate what was sound, call out what was wrong or lucky. All the DNA is below; use ONLY these numbers.`,
    ``,
    `TRADE: ${dna.label} (${dna.strategy}), a ${dna.timeframe} on ${dna.underlying}. Opened ${dna.opened_at}, closed ${dna.closed_at}. Realized P&L $${dna.realized}.`,
    dna.coarse ? `Note: price action is 15-minute bars (1-minute unavailable this far back).` : ``,
    dna.scale ? `THIS WAS A SCALED POSITION (${dna.scale.peak_contracts}× peak): ${dna.scale.entries} entries at avg $${dna.scale.avg_entry}, ${dna.scale.exits} exits at avg $${dna.scale.avg_exit}${dna.scale.add_behavior ? `, ${dna.scale.add_behavior}` : ""}${dna.scale.exit_style ? `, ${dna.scale.exit_style}` : ""}. The full fill ladder (time/side/price/running position): ${j(dna.fills)}. JUDGE THE SCALING — adding on strength vs averaging down, laddering the exit vs one-shot, and whether the geometry was disciplined or hope.` : ``,
    ``,
    `THE FORECAST for the session (levels the operator planned around): ${j(dna.forecast_levels)}. GEX anchors: ${j(dna.gex_anchors)}.`,
    ``,
    `ENTRY at ${dna.underlying} ${e.spot}. Nearest forecast level: ${j(e.correlation && e.correlation.nearest)}. Technicals at entry: ${j(e.technicals)}. Fill-quality read: ${j(e.quality)}.`,
    `Price action around the entry:`,
    win(e.window),
    ``,
    `EXIT at ${dna.underlying} ${x.spot}${x.is_settlement ? " (this was the expiry settlement, not a sell)" : ""}. Nearest forecast level: ${j(x.correlation && x.correlation.nearest)}. Technicals at exit: ${j(x.technicals)}. Fill-quality read: ${j(x.quality)}.`,
    `Price action around the exit:`,
    win(x.window),
    ``,
    dna.news ? `NEWS & SENTIMENT for ${dna.news.symbol} that session (sentiment is an ESTIMATED lexicon lean over headlines, not ground truth — cite it as such): ${j(dna.news)}.` : `No news available for the session.`,
    ``,
    operatorBlock.length
      ? `THE OPERATOR'S OWN VIEW — critique this directly against the data above:\n${operatorBlock.join("\n")}`
      : `The operator left no note on their thinking — flag that journaling the WHY would let this review critique the reasoning, not just the result.`,
    ``,
    `Write a tight desk review, specific with the numbers:`,
    `1. ENTRY quality — bought strength or caught a knife? At a real level? What did volume/VWAP say?`,
    `2. EXIT quality — sold a spike or gave it back? At a level? Extended (VWAP/RSI)?`,
    `3. RESPECT THE PLAN — enter/exit at forecast levels, in line with the tape?`,
    `4. CRITIQUE THE OPERATOR'S REASONING — does their stated why (and the levels they claim they traded) hold up against what the tape and technicals actually did? Were they right for the right reasons, right for the wrong reasons, or wrong? If their tagged level doesn't match the DNA's nearest level, say so.`,
    `5. NEWS/SENTIMENT — did the session's news context support or undercut this trade? Any risk they ignored?`,
    `6. One concrete LESSON — the single most useful thing to do differently.`,
    `Be direct and demanding. No disclaimers.`,
    ``,
    `Return ONLY a JSON object (no prose outside it, no code fences) in this shape:`,
    `{"headline":"<one-line verdict on the trade>","sections":[`,
    `  {"kind":"keyvals","title":"Entry & exit","rows":[{"k":"Entry","v":"<quality read, cite the numbers>","tone":"good|bad|warn"},{"k":"Exit","v":"<quality read>","tone":"good|bad|warn"}]},`,
    `  {"kind":"list","title":"Plan & reasoning","items":[{"point":"<did they respect forecast levels / the tape>"},{"point":"<critique of their stated why vs the data>"}]},`,
    `  {"kind":"callout","title":"News read","text":"<did session news support or undercut this>","tone":"good|bad|warn"},`,
    `  {"kind":"donext","items":[{"title":"<the one lesson>","detail":"<how to apply it>"}]}`,
    `]}`,
    `Every claim must use the numbers above. If you can't produce valid JSON, write the review as plain prose instead.`,
  ].filter((l) => l !== ``).join("\n");
}

// One side of the correlation (entry or exit): the levels near this SPX print.
function CorrTable({ title, corr, openSpace }) {
  const nearest = corr && corr.nearest;
  return (
    <div>
      <div className="vg-kicker" style={{ fontSize: 12 }}>{title}</div>
      {corr && corr.nearby && corr.nearby.length ? (
        <table className="vg-mini"><tbody>
          {corr.nearby.map((c, i) => (
            <tr key={i} className={c.level === nearest.level ? "vg-hl" : ""}>
              <td>{fmtLvl(c.level)}</td>
              <td>{c.role} {(c.kinds || []).length ? `· ${c.kinds.join(" + ")}` : ""}
                <span className="vg-note"> [{c.source}]</span></td>
              <td style={{ textAlign: "right" }}>{c.distance > 0 ? "+" : ""}{c.distance}pt</td>
            </tr>
          ))}
        </tbody></table>
      ) : (
        <p className="vg-note" style={{ fontSize: 13, margin: "2px 0" }}>No forecast level within range — {openSpace}.</p>
      )}
    </div>
  );
}

// The scale-in / scale-out geometry a single grouped line hides. Only shown
// when the trade was actually laddered (>2 fills) — a plain in/out trade's
// leg list already says it all. No per-fill P&L: Robinhood records no lot
// linkage, so the averages are blended (honest), never invented per-lot.
function FillLadder({ fills, scale }) {
  const [open, setOpen] = useState(false);
  if (!scale || !fills || fills.length <= 2) return null;
  const svg = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
  return (
    <div style={{ marginTop: 8 }}>
      <div className="vg-kicker" style={{ fontSize: 12 }}>The ladder — {scale.peak_contracts}× peak</div>
      <p className="vg-note" style={{ fontSize: 13, margin: "2px 0 4px" }}>
        {scale.entries} {scale.entries === 1 ? "entry" : "entries"} @ avg {svg(scale.avg_entry)}
        {" → "}{scale.exits} {scale.exits === 1 ? "exit" : "exits"} @ avg {svg(scale.avg_exit)}
        {scale.add_behavior ? <span> · <b>{scale.add_behavior}</b></span> : null}
        {scale.exit_style ? <span> · {scale.exit_style}</span> : null}
      </p>
      <button className="vg-btn-sm" onClick={() => setOpen((v) => !v)}>
        {open ? "▾ hide fills" : `▸ show all ${fills.length} fills`}
      </button>
      {open && (
        <table className="vg-mini" style={{ marginTop: 4 }}><tbody>
          <tr><td colSpan={5} className="vg-note" style={{ fontSize: 12, paddingBottom: 2 }}>times in ET (market hours)</td></tr>
          {fills.map((r, i) => (
            <tr key={i}>
              <td>{r.at_et || (r.at || "").slice(11, 16)}</td>
              <td className={r.side === "buy" ? "vg-up" : "vg-down"}>{r.side}</td>
              <td style={{ textAlign: "right" }}>{r.qty}×</td>
              <td style={{ textAlign: "right" }}>{svg(r.price)}</td>
              <td className="vg-note" style={{ textAlign: "right" }}>→ {r.running} held</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}
