// Seeded daily OHLCV generator — deterministic series that ends exactly at endPrice.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

// Gaussian via Box-Muller.
function gauss(rnd) {
  const u = Math.max(rnd(), 1e-9), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * n daily bars ending at endDate/endPrice. markers: [{ago,type,label}] get volume spikes.
 * Returns [{date, o, h, l, c, v, marker?}] oldest→newest.
 */
export function genOHLC(sym, endPrice, { vol, drift }, endDate, markers = [], n = 120) {
  const rnd = mulberry32(seedOf(sym));
  const rets = Array.from({ length: n - 1 }, () => drift + vol * gauss(rnd));
  // closes: walk backwards from endPrice so the last close is exact
  const closes = new Array(n);
  closes[n - 1] = endPrice;
  for (let i = n - 2; i >= 0; i--) closes[i] = closes[i + 1] / Math.exp(rets[i]);
  // trading dates: walk back skipping weekends
  const dates = new Array(n);
  const d = new Date(endDate);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  for (let i = n - 1; i >= 0; i--) {
    dates[i] = new Date(d);
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  }
  const markAt = new Map(markers.map((m) => [n - 1 - m.ago, m]));
  return closes.map((c, i) => {
    const o = i === 0 ? c * (1 - vol / 2) : closes[i - 1];
    const wickH = Math.abs(vol * gauss(rnd)) * 0.7, wickL = Math.abs(vol * gauss(rnd)) * 0.7;
    const h = Math.max(o, c) * (1 + wickH), l = Math.min(o, c) * (1 - wickL);
    const marker = markAt.get(i);
    const v = Math.round((0.8 + rnd() * 0.7 + (marker ? 1.1 : 0) + Math.abs(c / o - 1) * 60) * 100) / 100;
    return { date: dates[i], o, h, l, c, v, marker };
  });
}
