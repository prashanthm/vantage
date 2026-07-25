// The LINK CONTRACT (audit deficit 2): a fact is rendered fully once, and
// linked everywhere else. Every surface builds its cross-links from these
// canonical builders — never a hand-typed href. While a canon still lives in
// the legacy shell its builder points at the legacy route; when that surface
// migrates, ONLY this file changes and every link in the app follows.

const LEGACY = "/#";          // the buildless shell (hash routes)
const NEXT = "/next/#";       // this shell

export const links = {
  // the chart is the canon for anything priced: levels, positions, hits
  chart: (symbol = "SPX") => `${LEGACY}/ic/${encodeURIComponent(symbol)}`,
  // a forecast's canon is its grading surface (chart replay)
  forecastGrading: (symbol = "SPX") => `${LEGACY}/ic/${encodeURIComponent(symbol)}`,
  // a trade review's canon is its editable Journal card
  journalDay: () => `${LEGACY}/journal`,
  journalAnalysis: () => `${LEGACY}/journal/analysis`,
  // the plan of record
  dailyPlan: () => `${LEGACY}/playbook`,
  scanner: () => `${LEGACY}/scanner`,
  // a scoreboard cell's canon is the filtered trade list behind the number
  trackRecordReal: () => `${LEGACY}/trades`,
  trackRecordPaper: () => `${LEGACY}/strategies/paper`,
  // the book
  positions: () => `${LEGACY}/holdings`,
  // in-shell pages (grown wave by wave)
  cockpit: () => `${NEXT}/cockpit`,
  legacyHome: () => `${LEGACY}/home`,
};
