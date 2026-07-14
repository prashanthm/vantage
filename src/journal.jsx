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
  getSessionActivity,
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
      <div className="vg-pb-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Trading journal
            <span className="vg-note" style={{ fontSize: 12, fontWeight: 400 }}> · last night's forecast vs. today · what I did</span>
          </h2>
          <div className="vg-row" style={{ gap: 10, marginTop: 6, alignItems: "center" }}>
            <SymbolSwitcher value={sym} onChange={setSym} />
            <span className="vg-note">
              {d ? `${snaps.length} ${sym} day${snaps.length === 1 ? "" : "s"} journaled` : "loading…"}
            </span>
          </div>
        </div>
        {acc.n_scored > 0 && (
          <div className="vg-pb-levels">
            <Tile label="Level accuracy" value={pct(acc.avg_level_accuracy)} tone={acc.avg_level_accuracy >= 0.5 ? "good" : "bad"} />
            <Tile label="Regime calls right" value={pct(acc.regime_hit_rate)} tone={acc.regime_hit_rate >= 0.5 ? "good" : "bad"} />
            <Tile label="Scored" value={acc.n_scored} />
          </div>
        )}
      </div>

      {/* month calendar — click a day to open its detail below */}
      <div className="vg-card">
        <Calendar view={view} setView={setView} byDay={byDay}
          selDay={selDay} onSelect={setSelDay} />
      </div>

      {/* selected day's detail */}
      {selSnap ? (
        <DayDetail key={selSnap.id} s={selSnap} busy={busy}
          onDelete={doDelete} onSaveEntry={doSaveEntry} onAttach={doAttach} />
      ) : (
        <div className="vg-note" style={{ padding: "4px 2px" }}>
          {selDay === todayISO()
            ? (d ? "Setting up today's entry — it freezes last night's forecast and scores it against today's SPX price…" : "loading…")
            : `No journal entry for ${selDay}.`}
        </div>
      )}

      <div className="vg-pb-caveats">
        <div>Each day freezes a playbook forecast (prior session by default); scoring compares its levels to actual SPX price action over the session.</div>
        <div>Journal / analysis only. Places no orders (ADR-010). Not financial advice.</div>
      </div>
    </div>
  );
}

// ── month calendar ───────────────────────────────────────────────────────────

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
      <div className="vg-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="vg-kicker" style={{ margin: 0 }}>
          {dayLabel}{s.session ? ` · ${s.session} playbook` : ""}
          <span className="vg-note" style={{ fontSize: 11, marginLeft: 6, fontWeight: 400 }}>vs. {kindLabel}</span>
        </div>
        <button className="vg-linkbtn" disabled={busy === `del${s.id}`} onClick={() => onDelete(s.id)}>
          {busy === `del${s.id}` ? "…" : "delete"}
        </button>
      </div>

      {/* forecast | actual, side by side */}
      <div className="vg-jr-tiles">
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
            <>
              <div className="big">
                {sc.regime
                  ? <span className={sc.regime.correct ? "up" : "down"}>{sc.regime.correct ? "✓ forecast held" : "✗ forecast missed"}</span>
                  : "session read"}
              </div>
              <div className="sub">
                price {sc.price_low}–{sc.price_high} (last {sc.price_last})
                {sc.regime && <> · {sc.regime.outcome} ({sc.regime.moved_pct}% move)</>}
                {sc.level_accuracy != null && <> · levels {pct(sc.level_accuracy)}</>}
              </div>
            </>
          ) : (
            <div className="sub">Not scored yet — scores against today's session once bars print.</div>
          )}
        </div>
      </div>

      {/* per-level table: each forecasted level vs. what price did */}
      {(f.levels || []).length > 0 && (
        <div className="vg-jr-tile">
          <h4>Levels — forecast vs. actual</h4>
          <LevelTable forecast={f} scorecard={sc} />
        </div>
      )}

      {/* THE MEAT: every decision, correlated to the forecast, annotated */}
      <TradesPanel snap={s} thoughts={thoughts} onThought={setThought} />

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
  useEffect(() => { setData(null); setOpen(null); }, [snap.id]);

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
          <button className="vg-btn-sm" onClick={load} disabled={busy}>
            {busy ? "Pulling…" : "⟳ Pull my trades"}
          </button>
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
          <span className="vg-note">level discipline <b>{Math.round(s.level_discipline * 100)}%</b></span>
        )}
      </div>

      {/* the trade log — a row per decision, expandable */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(data.trades || []).map((t, i) => {
          const key = `${t.opened_at || i}|${t.label}`;
          return (
            <TradeCard key={key} t={t} tkey={key}
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

function TradeCard({ t, tkey, expanded, onToggle, thought, onThought, allLevels }) {
  const corr = t.correlation;
  const nearest = corr && corr.nearest;
  const long = String(t.strategy).includes("call");
  // the tagged level (persisted with the thought as "@<price>|<why>") — parse it
  const tag = (thought.match(/^@([\d.]+)\|/) || [])[1] || null;
  const why = thought.replace(/^@[\d.]+\|/, "");
  const setTag = (level) => onThought(level ? `@${level}|${why}` : why);
  const setWhy = (v) => onThought(tag ? `@${tag}|${v}` : v);

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
                title={`${nearest.role || ""} ${(nearest.kinds || []).join(" + ")}`}>
                {corr.at_level ? "✓ " : ""}{fmtLvl(nearest.level)}
              </span>
            : <span className="vg-note">—</span>}
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

            {/* the correlation to the plan */}
            <div>
              <div className="vg-kicker">SPX {fmtLvl(t.spot_at_entry)} at entry vs. the forecast</div>
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
                <p className="vg-note">No forecast level within range — this entry was in open space.</p>
              )}

              {/* TAG which level you were actually trading */}
              <div className="vg-trade-field" style={{ marginTop: 10 }}>
                <label>Level I was trading</label>
                <select value={tag || ""} onChange={(e) => setTag(e.target.value || null)}>
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

          {/* the thinking behind the decision */}
          <div className="vg-trade-field" style={{ marginTop: 10 }}>
            <label>My thinking — why did I take this trade?</label>
            <textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)}
              placeholder="the read, the trigger, what I was expecting — the WHY the broker can't record" />
          </div>
        </div>
      )}
    </div>
  );
}
