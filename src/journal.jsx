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
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { setEntry(s.entry || {}); }, [s.id, JSON.stringify(s.entry || {})]);

  const set = (k, v) => setEntry((e) => ({ ...e, [k]: v }));
  const save = async () => {
    const clean = {};
    for (const [k] of ENTRY_FIELDS) { const v = (entry[k] || "").trim(); if (v) clean[k] = v; }
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

      {/* chart (left) + journal (right) */}
      <div className="vg-jr-lower">
        {/* chart / drop-zone */}
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
          <div className={cls("vg-jr-drop", drag && "drag")}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)} onDrop={onDrop}
            onClick={() => fileRef.current && fileRef.current.click()}>
            <div style={{ fontSize: 13 }}>
              {busy === "upload" ? "Saving…" : "Drop your chart here, paste (⌘V), or click"}
            </div>
            <div className="vg-note" style={{ fontSize: 11, marginTop: 4 }}>
              Reference only — never analyzed.
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={(e) => onAttach(e.target.files && e.target.files[0])} />
          </div>
        )}

        {/* journal entry form */}
        <div className="vg-jr-form">
          <div className="vg-spread">
            <h4 style={{ margin: 0 }}>My journal — what I did</h4>
            <PullTrades snap={s} onPull={(fields) => {
              // the FACTS come from the broker's own fills; you write the
              // judgment (lesson / notes)
              Object.entries(fields).forEach(([k, v]) => set(k, v));
            }} />
          </div>
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

// "Pull my trades" — the factual half of a journal entry, straight from the
// broker's own fills (already synced into the store; no broker call, no
// typing). It fills action/entry/exit/result; the operator still writes the
// lesson. Deliberately does NOT overwrite lesson/notes — judgment is yours.
function PullTrades({ snap, onPull }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const pull = async () => {
    setBusy(true); setNote(null);
    const day = String(snap.created_at || "").slice(0, 10);
    const v = await getSessionActivity(day, snap.symbol || "SPX");
    setBusy(false);
    if (!v || !v.available) {
      setNote(`no ${snap.symbol || "SPX"} fills found on ${day}`);
      return;
    }
    const rts = v.roundtrips || [];
    const winners = rts.filter((r) => r.realized > 0);
    const losers = rts.filter((r) => r.realized < 0);
    const money = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    onPull({
      action: `${v.fills} fills across ${v.contracts} contracts`
        + (rts.length ? ` — ${rts.slice(0, 3).map((r) => r.symbol.replace(/^\S+\s\S+\s/, "")).join(", ")}${rts.length > 3 ? "…" : ""}` : ""),
      entry: rts.filter((r) => r.avg_buy != null).slice(0, 3)
        .map((r) => `${r.symbol.replace(/^\S+\s\S+\s/, "")} @ ${r.avg_buy}`).join(" · "),
      exit: rts.filter((r) => r.avg_sell != null).slice(0, 3)
        .map((r) => `${r.symbol.replace(/^\S+\s\S+\s/, "")} @ ${r.avg_sell}`).join(" · "),
      result: `realized ${money(v.realized)} · ${winners.length}W/${losers.length}L`
        + (v.open_at_close ? ` · ${v.open_at_close} still open at close` : ""),
    });
    setNote(`pulled ${v.fills} fills · realized ${money(v.realized)}`);
  };

  return (
    <div className="vg-row" style={{ gap: 8, alignItems: "center" }}>
      {note && <span className="vg-note" style={{ fontSize: 11 }}>{note}</span>}
      <button className="vg-btn-sm" onClick={pull} disabled={busy}
        title="Reconstruct what you actually traded from your broker fills — no typing">
        {busy ? "Pulling…" : "⟳ Pull my trades"}
      </button>
    </div>
  );
}
