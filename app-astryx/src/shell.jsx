// The Astryx app shell (W0): AppShell + SideNav + hash router + ⌘K palette.
// Nav mirrors the audit's target IA — Desk / Book / Review. Pages migrate in
// waves; until a surface lands here its nav item deep-links into the legacy
// shell, so the operator always has ONE nav that reaches everything.
import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { Text } from "@astryxdesign/core/Text";
import { links } from "./links.js";

// One entry per surface. `page` = migrated (renders in-shell); `href` = still
// legacy. Waves flip entries from href to page — the nav never changes shape.
export const SURFACES = [
  { group: "Desk", id: "cockpit", label: "Cockpit", page: true },
  { group: "Desk", id: "plan", label: "Daily plan", page: true },
  { group: "Desk", id: "scanner", label: "Scanner", page: true },
  { group: "Desk", id: "chart", label: "Chart", href: links.chart("SPX") },
  { group: "Book", id: "book", label: "Book", page: true },
  { group: "Book", id: "dashboard", label: "Dashboard (legacy)", href: `/#/dashboard` },
  { group: "Book", id: "options", label: "Options", href: `/#/options` },
  { group: "Book", id: "tax", label: "Tax", href: `/#/tax` },
  { group: "Review", id: "journal", label: "Trading Journal", page: true },
  { group: "Review", id: "performance", label: "Performance", page: true },
  { group: "Review", id: "strategies", label: "Strategies", href: `/#/strategies` },
];

function useHashPage(fallback = "cockpit") {
  const read = () => {
    const h = (location.hash || "").replace(/^#\/?/, "");
    const id = h.split("/")[0];
    return SURFACES.some((s) => s.page && s.id === id) ? id : fallback;
  };
  const [page, setPage] = useState(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return page;
}

function paletteSource() {
  const items = SURFACES.map((s) => ({
    id: s.id, label: `${s.group} · ${s.label}`,
    auxiliaryData: s,
  }));
  return {
    search: (q) => items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())),
    bootstrap: () => items,
  };
}

export function Shell({ children }) {
  const page = useHashPage();
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const on = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const goTo = useCallback((id) => {
    const s = SURFACES.find((x) => x.id === id);
    if (!s) return;
    setCmdOpen(false);
    if (s.page) location.hash = `#/${s.id}`;
    else location.href = s.href;
  }, []);

  const groups = ["Desk", "Book", "Review"];
  return (
    <>
      <AppShell
        variant="elevated"
        sideNav={
          <SideNav header={<SideNavHeading heading="Vantage" headingHref="/next/" />}>
            {groups.map((g) => (
              <SideNavSection key={g} heading={g}>
                {SURFACES.filter((s) => s.group === g).map((s) => (
                  <SideNavItem key={s.id} label={s.label}
                    isSelected={s.page && page === s.id}
                    href={s.page ? `#/${s.id}` : s.href} />
                ))}
              </SideNavSection>
            ))}
            <SideNavSection heading="Legacy">
              <SideNavItem label="Old shell →" href={links.legacyHome()} />
            </SideNavSection>
          </SideNav>
        }>
        {children(page)}
      </AppShell>
      <CommandPalette
        isOpen={cmdOpen}
        onOpenChange={setCmdOpen}
        searchSource={paletteSource()}
        onValueChange={goTo}
        label="Jump to a surface"
        footer={<Text type="supporting" color="secondary">⌘K anywhere · Esc to close</Text>}
      />
    </>
  );
}
