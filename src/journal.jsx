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
import { cls, SymbolSwitcher } from "./util.jsx";
import {
  useLive, getJournal, uploadJournal, deleteJournal,
  saveJournalEntry, ensureTodayJournal, journalImageUrl,
  getSessionActivity, getTradeDna, saveTradeAnalysis, streamTurn,
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
const todayISO = () => new Date().toISOString().slice(0, 10);

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

export function JournalView({ refreshNonce }) {
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState("");
  const [sym, setSym] = useState("SPX");     // SPX | QQQ | IWM
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
    <div className="vg-pane-body vg-jr">
      {/* compact header: title + underlying + jump-to-month — one line */}
      <div className="vg-jr-topbar">
        <h2 style={{ margin: 0, fontSize: 18 }}>Trading journal</h2>
        <div className="vg-row" style={{ gap: 10, alignItems: "center" }}>
          <SymbolSwitcher value={sym} onChange={setSym} />
          <MonthJump view={view} setView={setView} byDay={byDay}
            selDay={selDay} onSelect={setSelDay} />
        </div>
      </div>

      {/* the day STRIP — recent trading days, newest right; the whole calendar
          shrunk to one scannable row so the trades get the pane */}
      <DayStrip byDay={byDay} selDay={selDay} onSelect={setSelDay} />

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

function DayStrip({ byDay, selDay, onSelect }) {
  const stripRef = useRef(null);
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
  // keep the selected pill in view
  useEffect(() => {
    const el = stripRef.current && stripRef.current.querySelector(".vg-daystrip-pill.sel");
    if (el) el.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selDay]);

  const today = todayISO();
  return (
    <div className="vg-daystrip" ref={stripRef}>
      {days.map((iso) => {
        const snap = byDay[iso];
        const tone = snap ? dayTone(snap) : null;
        const [y, m, dd] = iso.split("-");
        const wd = WD[new Date(Number(y), Number(m) - 1, Number(dd)).getDay()];
        return (
          <button key={iso}
            className={cls("vg-daystrip-pill", iso === selDay && "sel", iso === today && "today")}
            onClick={() => onSelect(iso)}>
            <span className="vg-daystrip-wd">{iso === today ? "Today" : wd}</span>
            <span className="vg-daystrip-date">{MONTHS[Number(m) - 1].slice(0, 3)} {Number(dd)}</span>
            <span className={cls("vg-daystrip-dot", tone || "empty")} />
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
          <span className="vg-note" style={{ fontSize: 12 }}>
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
          {dirty && <span className="vg-note" style={{ fontSize: 11 }}>unsaved changes</span>}
        </div>
      </div>

      {/* reference chart — moved to the bottom; secondary to the trade log */}
      <div style={{ marginTop: 14 }}>
        {s.image_path ? (
          <div className="vg-jr-chart">
            <img src={journalImageUrl(s.id)} alt="reference chart"
              onError={(e) => { e.target.style.display = "none"; }} />
            <div className="vg-row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span className="vg-note" style={{ fontSize: 11 }}>reference chart · never analyzed</span>
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
            <span className="vg-note" style={{ fontSize: 12 }}>
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
                  <span className="vg-note" style={{ marginLeft: 4, fontSize: 10 }}>{lv.key}</span>
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
      <div className="vg-note" style={{ fontSize: 11 }}>{label}</div>
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
const STATUS_LABEL = {
  closed: "closed", open: "still open",
  expired_worthless: "expired worthless", expired_settled: "expired ITM",
  expired_unpriced: "expired (unpriced)",
};
const money = (n) => (n == null ? "—"
  : `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const fmtLvl = (v) => (v == null ? "—" : Number(v).toFixed(v >= 100 ? 0 : 2));

function TradesPanel({ snap, thoughts, onThought }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);          // expanded trade key

  const day = String(snap.created_at || "").slice(0, 10);
  const load = async () => {
    setBusy(true);
    const v = await getSessionActivity(day, snap.symbol || "SPX");
    setBusy(false);
    setData(v && v.available ? v : { empty: true });
  };
  // auto-load the day's trades on open (and when the day/underlying changes) —
  // this is a trade log; it should show the trades, not a button to fetch them.
  // A manual ⟳ stays for a mid-session re-pull.
  useEffect(() => {
    setData(null); setOpen(null);
    let live = true;
    (async () => {
      setBusy(true);
      const v = await getSessionActivity(day, snap.symbol || "SPX");
      if (live) { setData(v && v.available ? v : { empty: true }); setBusy(false); }
    })();
    return () => { live = false; };
  }, [snap.id, day, snap.symbol]);

  if (!data) {
    return (
      <div className="vg-card" style={{ marginTop: 14 }}>
        <div className="vg-spread">
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>My trades — what I actually did</h3>
            <p className="vg-note" style={{ marginTop: 4, fontSize: 12 }}>
              Every decision reconstructed from your broker fills — pinned to the SPX price
              at the minute you submitted it, correlated to the levels you forecast, expiries
              settled against the SPX print.
            </p>
          </div>
          <span className="vg-note">{busy ? "Loading your trades…" : ""}</span>
        </div>
      </div>
    );
  }
  if (data.empty) {
    return <div className="vg-card" style={{ marginTop: 14 }}>
      <p className="vg-note">No {snap.symbol || "SPX"} trades on {day}.</p></div>;
  }

  const s = data.summary || {};
  const allLevels = [
    ...(data.forecast_levels || []).map((z) => ({ ...z, source: "confluence" })),
    ...(data.gex_anchors || []).map((a) => ({ price: a.price, role: a.label, kinds: [a.label], source: "gex" })),
  ];

  return (
    <div className="vg-card" style={{ marginTop: 14 }}>
      <div className="vg-spread">
        <h3 style={{ margin: 0, fontSize: 16 }}>My trades — {s.trades} decisions
          <span className="vg-note" style={{ fontSize: 12, fontWeight: 400 }}>
            {" "}· click a trade to correlate it to the plan
          </span>
        </h3>
        <button className="vg-btn-sm" onClick={load} disabled={busy}>{busy ? "…" : "⟳"}</button>
      </div>

      {/* the day, reconciled — including the money no fill showed */}
      <div className="vg-row" style={{ gap: 20, margin: "10px 0", flexWrap: "wrap", fontSize: 13 }}>
        <span>P&L <b className={s.realized >= 0 ? "vg-up" : "vg-down"}>{money(s.realized)}</b></span>
        <span className="vg-note">fills {money(s.realized_from_fills)}</span>
        {s.expired > 0 && <span className="vg-note">expiry {money(s.realized_from_expiry)} · {s.expired_worthless} worthless <b className="vg-down">{money(s.expired_loss)}</b></span>}
        <span className="vg-note">{s.winners}W / {s.losers}L</span>
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

      {/* the trade log — a row per decision, expandable */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(data.trades || []).map((t, i) => {
          const key = `${t.opened_at || i}|${t.label}`;
          return (
            <TradeCard key={key} t={t} tkey={key} tradeIndex={i}
              day={day} underlying={snap.symbol || "SPX"}
              expanded={open === key} onToggle={() => setOpen(open === key ? null : key)}
              thought={(thoughts && thoughts[key]) || ""} onThought={(v) => onThought(key, v)}
              allLevels={allLevels} />
          );
        })}
      </div>
      <p className="vg-note" style={{ fontSize: 11, marginTop: 8 }}>
        SPX price is the 1-minute print at submission. Tag the level you were trading —
        the broker says WHAT you did; only you can say WHY. Everything saves with the entry.
      </p>
    </div>
  );
}

function TradeCard({ t, tkey, tradeIndex, day, underlying, expanded, onToggle, thought, onThought, allLevels }) {
  const corr = t.correlation;
  const nearest = corr && corr.nearest;
  const exitCorr = t.exit_correlation;
  const exitNearest = exitCorr && exitCorr.nearest;
  const long = String(t.strategy).includes("call");
  // persisted as "@<entry>[/<exit>]|<why>" — entry level, optional exit level,
  // then the free-text thinking. Parse the three back out.
  const m = thought.match(/^@([\d.]*)(?:\/([\d.]*))?\|/) || [];
  const tag = m[1] || null;
  const exitTag = m[2] || null;
  const why = thought.replace(/^@[\d.]*(?:\/[\d.]*)?\|/, "");
  const encode = (e, x, w) => {
    if (!e && !x) return w;
    return `@${e || ""}${x ? `/${x}` : ""}|${w}`;
  };
  const setTag = (level) => onThought(encode(level, exitTag, why));
  const setExitTag = (level) => onThought(encode(tag, level, why));
  const setWhy = (v) => onThought(encode(tag, exitTag, v));

  return (
    <div className={cls("vg-trade", expanded && "open")}>
      {/* collapsed summary row */}
      <div className="vg-trade-row" onClick={onToggle}>
        <span className="vg-trade-time">{(t.opened_at || "").slice(11, 16) || "—"}</span>
        <span className="vg-trade-name">
          <b className={long ? "vg-up" : "vg-down"}>{t.label}</b>
        </span>
        <span className="vg-trade-spx">SPX {fmtLvl(t.spot_at_entry)}</span>
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
        <span className={cls("vg-trade-pnl", t.realized >= 0 ? "vg-up" : "vg-down")}>{money(t.realized)}</span>
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
                <tr><td>opened</td><td>{(t.opened_at || "—").replace("T", " ")} ET</td></tr>
                {t.closed_at && <tr><td>closed</td><td>{t.closed_at.replace("T", " ")} ET</td></tr>}
                <tr><td>cost</td><td>{money(t.cost)}</td></tr>
                {t.proceeds ? <tr><td>proceeds</td><td>{money(t.proceeds)}</td></tr> : null}
                {t.settlement != null && <tr><td>settlement</td><td>{money(t.settlement)} @ SPX {fmtLvl(t.settle_price)}</td></tr>}
                <tr><td><b>realized</b></td><td><b className={t.realized >= 0 ? "vg-up" : "vg-down"}>{money(t.realized)}</b></td></tr>
              </tbody></table>
            </div>

            {/* the correlation to the plan — ENTRY and EXIT */}
            <div>
              {/* the arc: where price was in vs. out */}
              <div className="vg-kicker">The arc</div>
              <div style={{ fontSize: 13, margin: "2px 0 10px", fontVariantNumeric: "tabular-nums" }}>
                in <b>{fmtLvl(t.spot_at_entry)}</b>
                {nearest && <span className={cls("vg-badge", corr.at_level ? "good" : "plain")} style={{ marginLeft: 4 }}>{fmtLvl(nearest.level)}</span>}
                <span className="vg-note" style={{ margin: "0 6px" }}>→</span>
                out <b>{fmtLvl(t.spot_at_exit)}</b>
                {exitNearest && <span className={cls("vg-badge", exitCorr.at_level ? "good" : "plain")} style={{ marginLeft: 4 }}>{fmtLvl(exitNearest.level)}</span>}
                {t.spot_at_entry != null && t.spot_at_exit != null && (
                  <span className="vg-note"> · {(t.spot_at_exit - t.spot_at_entry) >= 0 ? "+" : ""}{(t.spot_at_exit - t.spot_at_entry).toFixed(1)}pt SPX
                    {String(t.status).startsWith("expired") ? " (settlement)" : ""}</span>
                )}
              </div>

              <CorrTable title={`Entry · SPX ${fmtLvl(t.spot_at_entry)}`} corr={corr} openSpace="entry was in open space" />
              <div style={{ marginTop: 8 }}>
                <CorrTable title={`Exit · SPX ${fmtLvl(t.spot_at_exit)}${String(t.status).startsWith("expired") ? " (settled)" : ""}`}
                  corr={exitCorr} openSpace="exit was in open space" />
              </div>

              {/* TAG the levels you were actually trading — in and out */}
              <div className="vg-row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <div className="vg-trade-field" style={{ flex: 1, minWidth: 150 }}>
                  <label>Level I entered on</label>
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
                  <label>Level I exited on</label>
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
            why={why} label={t.label} />
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
// the read. The "entire DNA of the trade" in one place.
function AnalyzeTrade({ day, tradeIndex, underlying, why, label }) {
  const [state, setState] = useState(null);   // null | "loading" | {text} | {error}
  const abortRef = useRef(null);

  const run = async () => {
    setState("loading");
    const res = await getTradeDna(day, tradeIndex, underlying);
    if (!res || !res.available || !res.dna) {
      setState({ error: (res && res.note) || "couldn't build the trade DNA" });
      return;
    }
    const prompt = buildAnalystPrompt(res.dna, why, res.playbook_session, day, tradeIndex, underlying);
    let text = "";
    setState({ text: "" });
    abortRef.current = streamTurn(prompt, `trade-${day}-${tradeIndex}`, (evt) => {
      if (evt.kind === "error") { setState({ error: evt.message || "Mira error" }); return; }
      if (evt.kind === "done") {
        abortRef.current = null;
        // The trade-analyst routes and the supervisor synthesizes with the
        // model, so `text` is a real prose review. Freeze it + the DNA into
        // the record (survives 1m bars ageing out).
        if (text.trim() && res.trade_key) {
          saveTradeAnalysis({
            day, trade_key: res.trade_key, underlying, label: res.dna.label,
            dna: res.dna, analysis: text,
          });
        }
        setState({ text, dna: res.dna, saved: !!text.trim() });
        return;
      }
      const chunk = evt.text || evt.delta || evt.content || "";
      if (chunk) { text += chunk; setState({ text, dna: res.dna }); }
    });
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
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--vg-hairline)" }}>
      <div className="vg-spread">
        <div className="vg-kicker" style={{ margin: 0 }}>The DNA — Mira's read</div>
        {(!state || state.error) && (
          <button className="vg-btn-sm" onClick={run}>🧬 Analyze this trade</button>
        )}
        {state && state.text != null && (
          <button className="vg-btn-sm" onClick={run}>↻ Re-analyze</button>
        )}
      </div>
      {state === "loading" && (
        <p className="vg-note" style={{ marginTop: 8 }}>
          Building the DNA (price action · volume · technicals · levels) and reading news + sentiment…
        </p>
      )}
      {state && state.error && <p className="vg-note" style={{ marginTop: 8, color: "var(--vg-down)" }}>{state.error}</p>}
      {state && state.text != null && (
        <>
        {/* the model's narrative read, when the direct path produced one */}
        {state.text.trim() && (
          <div className="vg-dna-read" style={{ marginTop: 8 }}>{state.text}</div>
        )}
        {/* the structured DNA read — always shown; this IS the full picture */}
        {state.dna && <DnaReadout dna={state.dna} />}
        {state.modelUnavailable && (
          <p className="vg-note" style={{ fontSize: 11, marginTop: 6 }}>
            The narrative read is pending Mira's turn-path model synthesis; the full
            structured DNA above is the complete record.
          </p>
        )}
        {state.saved && (
          <p className="vg-note" style={{ fontSize: 11, marginTop: 4 }}>
            ✓ saved to this trade's record{state.analyzedAt ? ` · ${String(state.analyzedAt).slice(0, 16).replace("T", " ")}` : ""}
          </p>
        )}
        </>
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
          <td>SPX <b>{e.spot}</b>{en ? <> — {en.at_level || (e.correlation && e.correlation.at_level) ? "at " : "near "}
            the <b>{en.level}</b> {en.role} ({(en.kinds || []).join(" + ")}), {pts(en.distance)} away</> : ""}.
            {" "}{entryRead}.</td></tr>
        <tr><td /><td className="vg-note">VWAP {et.vwap} ({et.vs_vwap >= 0 ? "+" : ""}{et.vs_vwap} vs price)
          {et.rsi != null ? ` · RSI ${Math.round(et.rsi)}` : ""} · rel-vol {et.rel_volume}× · ATR {et.atr}</td></tr>
        <tr><td><b>Exit</b></td>
          <td>SPX <b>{x.spot}</b>{x.is_settlement ? " (expiry settlement)" : ""}{xn ? <> — {(x.correlation && x.correlation.at_level) ? "at " : "near "}
            the <b>{xn.level}</b> {xn.role} ({(xn.kinds || []).join(" + ")}), {pts(xn.distance)} away</> : ""}.
            {" "}{exitRead}.</td></tr>
        <tr><td /><td className="vg-note">VWAP {xt.vwap} ({xt.vs_vwap >= 0 ? "+" : ""}{xt.vs_vwap} vs price)
          {xt.rsi != null ? ` · RSI ${Math.round(xt.rsi)}${xt.rsi >= 70 ? " (extended)" : ""}` : ""} · rel-vol {xt.rel_volume}× · ATR {xt.atr}</td></tr>
        <tr><td><b>Result</b></td>
          <td><b className={dna.realized >= 0 ? "vg-up" : "vg-down"}>{dna.realized >= 0 ? "+" : "−"}${Math.abs(dna.realized).toLocaleString()}</b>
            {" "}· {dna.status.replace("_", " ")}</td></tr>
      </tbody></table>
    </div>
  );
}

// Turn the structured DNA into an analyst brief. Deliberately framed as a
// self-contained REVIEW (not "analyze <ticker>") so Mira's supervisor routes
// it to the direct model turn rather than the equity fan-out — the DNA is the
// full payload, so the read should reason over THAT, not re-fetch facets.
function buildAnalystPrompt(dna, why, session, day, tradeIndex, underlying) {
  const j = (o) => JSON.stringify(o);
  const e = dna.entry, x = dna.exit;
  const win = (w) => (w || []).map((b) =>
    `  ${b.time}  O${b.open} H${b.high} L${b.low} C${b.close}  vol ${b.volume}${b.at_fill ? "  «FILL»" : ""}`).join("\n");
  // Routes to Mira's trade_analyst specialist ("review this trade" keywords);
  // the supervisor synthesizes the read with the model (Option A). The DNA is
  // inlined ONCE below (single source of truth — no TRADE_REF re-fetch, which
  // gave the model two framings of the same trade and muddled the numbers).
  return [
    `Review this options trade and grade the decision quality — entry, exit, and whether it respected the plan. All the DNA is below; be specific with the numbers and use ONLY these numbers.`,
    ``,
    `TRADE: ${dna.label} (${dna.strategy}), a ${dna.timeframe} on ${dna.underlying}. Opened ${dna.opened_at}, closed ${dna.closed_at}. Realized P&L $${dna.realized}.`,
    dna.coarse ? `Note: price action is 15-minute bars (1-minute unavailable this far back).` : ``,
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
    why ? `The operator's own note on why they took it: "${why}"` : `The operator left no note on their thinking.`,
    ``,
    `Write a tight desk review, specific with the numbers:`,
    `1. ENTRY quality — did they buy into strength or catch a falling knife? Was it at a real level? What did volume say?`,
    `2. EXIT quality — did they sell into a spike or give the move back? Did it hit a level? Was it extended (VWAP/RSI)?`,
    `3. Did the trade RESPECT THE PLAN — enter and exit at forecast levels, in line with the tape?`,
    `4. Based on the price action and the broad ${dna.underlying} tape that session, does the market context support this trade, and what would you flag about news/sentiment risk for a ${dna.day} 0DTE?`,
    `5. One concrete LESSON.`,
    `Be direct. No disclaimers.`,
  ].filter((l) => l !== ``).join("\n");
}

// One side of the correlation (entry or exit): the levels near this SPX print.
function CorrTable({ title, corr, openSpace }) {
  const nearest = corr && corr.nearest;
  return (
    <div>
      <div className="vg-kicker" style={{ fontSize: 10 }}>{title}</div>
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
        <p className="vg-note" style={{ fontSize: 12, margin: "2px 0" }}>No forecast level within range — {openSpace}.</p>
      )}
    </div>
  );
}
