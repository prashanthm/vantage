// Book (W3) — ONE holdings surface. The audit found three tables rendering
// the same positions feed (Dashboard, Positions, Portfolio); this page is
// their consolidation target: Positions = the canon table, Analyzer = the
// currency-correct roll-up. The legacy Dashboard keeps its actions queue
// until its own wave — linked, not re-rendered.
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Table, proportional, pixel, useTableSortable } from "@astryxdesign/core/Table";
import { Spinner } from "@astryxdesign/core/Spinner";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Ledger } from "../templates.jsx";
import { links } from "../links.js";
import { backend, getJson, pref, setPref } from "../api.js";

// currency-aware: the book spans USD and INR — a number without its currency
// is a lie, so every cell formats in the row's own currency.
const fx = (v, cur = "USD") => (v == null ? "—"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD",
      maximumFractionDigits: 0 }).format(v));
const signed = (v, cur) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${fx(v, cur)}`);
const pctW = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);

function Tile({ label, value, tone }) {
  return (
    <Section>
      <VStack gap={0} padding={3}>
        <Text type="supporting" color="secondary">{label}</Text>
        <Text type="large" weight="semibold"
          color={tone === "good" ? "success" : tone === "bad" ? "error" : "primary"}>{value}</Text>
      </VStack>
    </Section>
  );
}

const inputStyle = {
  font: "inherit", padding: "5px 9px", borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-background-surface)", color: "var(--color-text-primary)",
};

function PositionsTab({ rows }) {
  const [open, setOpen] = useState(null);      // symbol whose lots are expanded
  const [q, setQ] = useState("");
  const [acct, setAcctRaw] = useState(() => pref("book.acct", "all"));
  const setAcct = (v) => { setAcctRaw(v); setPref("book.acct", v); };
  // header-click sorting via the design system's own plugin; we own the state
  // and apply it ourselves so sorting NEVER compares across currencies
  const [sort, setSortRaw] = useState(() => pref("book.sort", [{ sortKey: "value", direction: "descending" }]));
  const setSort = (v) => { setSortRaw(v); setPref("book.sort", v); };
  const sortPlugin = useTableSortable({ sort, onSortChange: setSort });
  const accounts = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.accounts || []))).sort(), [rows]);
  const shown = rows.filter((r) =>
    (!q || String(r.symbol || "").toUpperCase().includes(q.toUpperCase()))
    && (acct === "all" || (r.accounts || []).includes(acct)));
  // group by CURRENCY BOOK — a nominal-value sort across ₹ and $ is a lie
  const books = useMemo(() => {
    const m = {};
    for (const r of shown) (m[r.currency || "USD"] = m[r.currency || "USD"] || []).push(r);
    const s0 = sort[0] || { sortKey: "value", direction: "descending" };
    const dir = s0.direction === "ascending" ? 1 : -1;
    for (const code of Object.keys(m))
      m[code].sort((a, b) => dir * (((a[s0.sortKey] ?? 0) < (b[s0.sortKey] ?? 0)) ? -1
        : ((a[s0.sortKey] ?? 0) > (b[s0.sortKey] ?? 0)) ? 1 : 0));
    return Object.entries(m).sort(([a], [b]) => (a === "USD" ? -1 : b === "USD" ? 1 : a < b ? -1 : 1));
  }, [shown, sort]);
  return (
    <VStack gap={3}>
      <HStack gap={2} align="center" justify="between" wrap="wrap">
        <HStack gap={1} align="center" wrap="wrap">
          <input style={inputStyle} value={q} placeholder="ticker…" aria-label="Filter by ticker"
            onChange={(e) => setQ(e.target.value)} />
          <select style={inputStyle} value={acct} onChange={(e) => setAcct(e.target.value)}
            aria-label="Filter by account">
            <option value="all">all accounts</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <Text type="supporting" color="secondary">
            {shown.length}{shown.length !== rows.length ? ` of ${rows.length}` : ""} positions · click a column to sort (within each book)
          </Text>
        </HStack>
        <Link href={links.positions()}>lots &amp; tax detail (legacy) →</Link>
      </HStack>
      {books.map(([code, list]) => (
        <BookTable key={code} code={code} list={list} open={open} setOpen={setOpen}
          sortPlugin={sortPlugin} />
      ))}
      {!books.length && <Text type="supporting" color="secondary">No positions match.</Text>}
    </VStack>
  );
}

function BookTable({ code, list, open, setOpen, sortPlugin }) {
  const total = list.reduce((s, r) => s + (r.value || 0), 0);
  const day = list.reduce((s, r) => s + (r.day_pl || 0), 0);
  return (
    <Section>
      <VStack gap={2} padding={3} className="vg-dense">
        <HStack gap={2} align="baseline" wrap="wrap">
          <Text type="label">{code} book</Text>
          <Text type="supporting" color="secondary">{list.length} positions · {fx(total, code)}</Text>
          <Text type="supporting" weight="semibold" color={day >= 0 ? "success" : "error"}>
            day {signed(day, code)}
          </Text>
        </HStack>
        <div className="vg-sticky-head">
        <Table data={list.map((r, i) => ({ id: `${code}${i}`, ...r }))} idKey="id"
          density="compact" hasHover plugins={{ sort: sortPlugin }} columns={[
          { key: "symbol", header: "Symbol", width: proportional(1.6), renderCell: (r) => (
            <VStack gap={0}>
              <HStack gap={1} align="center">
                <Link href={links.chart(r.symbol)}>{r.symbol}</Link>
                {(r.lots || []).length > 0 && (
                  <span style={{ cursor: "pointer" }} role="button" tabIndex={0}
                    aria-label={`toggle ${r.symbol} lots`}
                    onClick={() => setOpen(open === r.symbol ? null : r.symbol)}
                    onKeyDown={(e) => e.key === "Enter" && setOpen(open === r.symbol ? null : r.symbol)}>
                    <Text type="supporting" color="secondary">
                      {open === r.symbol ? "▾" : "▸"} {(r.lots || []).length} lot{(r.lots || []).length === 1 ? "" : "s"}
                    </Text>
                  </span>
                )}
              </HStack>
              <Text type="supporting" color="secondary">{(r.accounts || []).join(" · ")}</Text>
              {open === r.symbol && (r.lots || []).map((l, i) => (
                <Text key={i} type="supporting" color="secondary">
                  {l.account} · {l.date || "?"} · {Number(l.shares).toLocaleString()} @ {fx(l.cost_per_share, r.currency)}
                </Text>
              ))}
            </VStack>
          )},
          { key: "shares", header: "Qty", width: pixel(80), sortable: true, align: "end", renderCell: (r) =>
            <Text type="body">{r.shares != null ? Number(r.shares).toLocaleString() : "—"}</Text> },
          { key: "value", header: "Value", width: proportional(1), sortable: true, align: "end", renderCell: (r) =>
            <Text type="body" weight="semibold">{fx(r.value, r.currency)}</Text> },
          { key: "day_pl", header: "Day", width: proportional(1), sortable: true, align: "end", renderCell: (r) =>
            <Text type="body" color={(r.day_pl || 0) >= 0 ? "success" : "error"}>
              {signed(r.day_pl, r.currency)}</Text> },
          { key: "unrealized", header: "Unrealized", width: proportional(1), sortable: true, align: "end", renderCell: (r) =>
            <Text type="body" color={(r.unrealized || 0) >= 0 ? "success" : "error"}>
              {signed(r.unrealized, r.currency)}</Text> },
          { key: "weight", header: "Weight", width: pixel(130), sortable: true, align: "end", renderCell: (r) =>
            <HStack gap={1} align="center" justify="end" style={{ whiteSpace: "nowrap" }}>
              <Text type="body">{pctW(r.weight)}</Text>
              {r.weight != null && r.weight >= 20 && <Badge variant="warning" label="heavy" />}
            </HStack> },
        ]} />
        </div>
      </VStack>
    </Section>
  );
}

function AnalyzerTab({ snap }) {
  if (!snap) return <Text type="supporting" color="secondary">No analyzer snapshot.</Text>;
  const cur = snap.by_currency || {};
  return (
    <VStack gap={3}>
      <div className="vg-cols wide">
      {Object.entries(cur).map(([code, c]) => {
        const div = c.diversification || {};
        const sectors = Object.entries(div.by_sector || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
        // winners_losers is a global {winners_pct, losers_pct} — rows carry
        // their currency; filter to this book's
        const gwl = snap.winners_losers || {};
        const wl = {
          winners: (gwl.winners_pct || []).filter((w) => (w.currency || "USD") === code),
          losers: (gwl.losers_pct || []).filter((w) => (w.currency || "USD") === code),
        };
        return (
          <Section key={code}>
            <VStack gap={2} padding={3}>
              <HStack gap={2} align="center" justify="between">
                <Text type="label" color="secondary">{code} book · {fx(div.total, code)}</Text>
                <Link href={`/#/portfolio`}>full analyzer (legacy) →</Link>
              </HStack>
              <HStack gap={1} wrap="wrap">
                {sectors.map(([name, w]) => (
                  <Badge key={name} variant={w >= 30 ? "warning" : "neutral"} label={`${name} ${pctW(w)}`} />
                ))}
              </HStack>
              {(wl.winners || []).length > 0 && (
                <HStack gap={1} wrap="wrap" align="center">
                  <Text type="supporting" color="secondary">winners:</Text>
                  {(wl.winners || []).slice(0, 4).map((w, i) => (
                    <Badge key={i} variant="success" label={`${w.symbol} ${signed(w.unrealized, code)}`} />
                  ))}
                </HStack>
              )}
              {(wl.losers || []).length > 0 && (
                <HStack gap={1} wrap="wrap" align="center">
                  <Text type="supporting" color="secondary">losers:</Text>
                  {(wl.losers || []).slice(0, 4).map((w, i) => (
                    <Badge key={i} variant="error" label={`${w.symbol} ${signed(w.unrealized, code)}`} />
                  ))}
                </HStack>
              )}
            </VStack>
          </Section>
        );
      })}
      </div>
      {(snap.rebalance || []).length > 0 && (
        <Section>
          <VStack gap={2} padding={3}>
            <Text type="label" color="secondary">Rebalance notes</Text>
            {(snap.rebalance || []).map((r, i) => (
              <Text key={i} type="supporting">{typeof r === "string" ? r : JSON.stringify(r)}</Text>
            ))}
          </VStack>
        </Section>
      )}
    </VStack>
  );
}

export function BookPage() {
  const [tab, setTabRaw] = useState(() => pref("book.tab", "positions"));
  const setTab = (v) => { setTabRaw(v); setPref("book.tab", v); };
  const [pos, setPos] = useState(null);
  const [alloc, setAlloc] = useState(null);
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let dead = false;
    Promise.allSettled([
      getJson(`${backend()}/api/positions?account=all`),
      getJson(`${backend()}/api/allocation?account=all`),
      getJson(`${backend()}/api/portfolio/snapshot`),
    ]).then(([a, b, c]) => {
      if (dead) return;
      if (a.status === "fulfilled") setPos(a.value.positions || []);
      if (b.status === "fulfilled") setAlloc(b.value);
      if (c.status === "fulfilled") setSnap(c.value);
      setLoading(false);
    });
    return () => { dead = true; };
  }, []);
  const rows = pos || [];
  const dayUsd = rows.filter((r) => (r.currency || "USD") === "USD")
    .reduce((s, r) => s + (r.day_pl || 0), 0);
  return (
    <Ledger
      band={
        <HStack gap={3} align="center" justify="between" wrap="wrap">
          <VStack gap={0}>
            <Heading level={1}>Book</Heading>
            <Text type="supporting" color="secondary">
              every account, one table · <Link href="/#/dashboard">actions &amp; market read (legacy Dashboard) →</Link>
            </Text>
          </VStack>
          <HStack gap={2} align="center" wrap="wrap">
            {alloc && alloc.total != null && <Tile label="Total (USD base)" value={fx(alloc.total, "USD")} />}
            {rows.length > 0 && <Tile label="Day (USD book)" value={signed(dayUsd, "USD")}
              tone={dayUsd >= 0 ? "good" : "bad"} />}
            <SegmentedControl value={tab} onChange={setTab} label="Book view">
              <SegmentedControlItem value="positions" label="Positions" />
              <SegmentedControlItem value="analyzer" label="Analyzer" />
            </SegmentedControl>
          </HStack>
        </HStack>
      }>
      {loading
        ? <HStack gap={2} align="center"><Spinner size="sm" /><Text type="supporting" color="secondary">Loading the book…</Text></HStack>
        : tab === "positions" ? <PositionsTab rows={rows} /> : <AnalyzerTab snap={snap} />}
    </Ledger>
  );
}
