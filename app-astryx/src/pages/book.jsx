// Book (W3) — ONE holdings surface. The audit found three tables rendering
// the same positions feed (Dashboard, Positions, Portfolio); this page is
// their consolidation target: Positions = the canon table, Analyzer = the
// currency-correct roll-up. The legacy Dashboard keeps its actions queue
// until its own wave — linked, not re-rendered.
import { useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { Spinner } from "@astryxdesign/core/Spinner";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Ledger } from "../templates.jsx";
import { links } from "../links.js";
import { backend, getJson } from "../api.js";

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

function PositionsTab({ rows }) {
  const sorted = rows.slice().sort((a, b) => (b.value || 0) - (a.value || 0));
  const [open, setOpen] = useState(null);      // symbol whose lots are expanded
  return (
    <Section>
      <VStack gap={2} padding={3} className="vg-dense">
        <HStack gap={2} align="center" justify="between">
          <Text type="label" color="secondary">
            Every position, every account · values in each holding&apos;s own currency
          </Text>
          <Link href={links.positions()}>lots &amp; tax detail (legacy) →</Link>
        </HStack>
        <Table data={sorted.map((r, i) => ({ id: i, ...r }))} idKey="id" density="compact" hasHover columns={[
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
          { key: "shares", header: "Qty", width: pixel(80), renderCell: (r) =>
            <Text type="body">{r.shares != null ? Number(r.shares).toLocaleString() : "—"}</Text> },
          { key: "value", header: "Value", width: proportional(1), renderCell: (r) =>
            <Text type="body" weight="semibold">{fx(r.value, r.currency)}</Text> },
          { key: "day_pl", header: "Day", width: proportional(1), renderCell: (r) =>
            <Text type="body" color={(r.day_pl || 0) >= 0 ? "success" : "error"}>
              {signed(r.day_pl, r.currency)}</Text> },
          { key: "unrealized", header: "Unrealized", width: proportional(1), renderCell: (r) =>
            <Text type="body" color={(r.unrealized || 0) >= 0 ? "success" : "error"}>
              {signed(r.unrealized, r.currency)}</Text> },
          { key: "weight", header: "Weight", width: pixel(130), renderCell: (r) =>
            <HStack gap={1} align="center" style={{ whiteSpace: "nowrap" }}>
              <Text type="body">{pctW(r.weight)}</Text>
              {r.weight != null && r.weight >= 20 && <Badge variant="warning" label="heavy" />}
            </HStack> },
        ]} />
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
  const [tab, setTab] = useState("positions");
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
