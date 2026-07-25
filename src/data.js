// Vantage config constants. This file used to carry the demo-era fixture
// dataset (fabricated accounts, lots, signals, canned chat); all of it was
// dead code — the SPA is live-only with honest empty states — and was deleted
// in the IA streamline. Only the three real config exports remain.

export const NOTIF_TYPES = {
  tlh:    { label: "Tax-loss harvesting", accent: "teal",   icon: "🌾" },
  wash:   { label: "Wash-sale warnings",  accent: "orange", icon: "⚠️" },
  price:  { label: "Price & AI alerts",   accent: "blue",   icon: "📈" },
  drift:  { label: "Allocation drift",    accent: "purple", icon: "⚖️" },
  system: { label: "Account sync",        accent: "cyan",   icon: "🔄" },
};

export const ALLOCATION_TARGETS = { usEquity: 70, intlEquity: 10, bonds: 15, cash: 5 };

export const ASSET_CLASSES = {
  usEquity:   { label: "US Equity",     color: "#2e68fd" },
  intlEquity: { label: "International", color: "#0d9488" },
  bonds:      { label: "Bonds",         color: "#932cfa" },
  cash:       { label: "Cash",          color: "#ca8a04" },
};
