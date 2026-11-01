// Historical event library: how far real house prices and rents moved against the
// model after past shocks of each class. Used by the live layer to size the adjustment
// for an event detected today. Pure; records come from the projection backtests.
import { finite, mean } from './stats.js';

export const EVENT_CLASSES = {
  armed_conflict: { label: 'Armed conflict', description: 'War or sustained armed violence on the country\'s own territory.' },
  regional_conflict: { label: 'Regional conflict or unrest', description: 'War in a neighbouring country, or severe domestic unrest, without war at home.' },
  natural_disaster: { label: 'Natural disaster', description: 'Major earthquake, flood or cyclone with national economic impact.' },
  currency_crisis: { label: 'Currency or financial crisis', description: 'Sharp currency collapse, sovereign or banking crisis.' },
};

// Onset year = the year the shock hit. Episodes whose country lacks a price series at
// the needed years are skipped automatically.
export const EPISODES = [
  { country: 'KOR', year: 1997, class: 'currency_crisis', label: 'Asian financial crisis' },
  { country: 'THA', year: 1997, class: 'currency_crisis', label: 'Asian financial crisis (baht devaluation)' },
  { country: 'MYS', year: 1997, class: 'currency_crisis', label: 'Asian financial crisis' },
  { country: 'IDN', year: 1998, class: 'currency_crisis', label: 'Asian financial crisis (rupiah collapse)' },
  { country: 'HKG', year: 1997, class: 'currency_crisis', label: 'Asian financial crisis' },
  { country: 'RUS', year: 1998, class: 'currency_crisis', label: 'Russian default and rouble devaluation' },
  { country: 'TUR', year: 2001, class: 'currency_crisis', label: 'Turkish banking and lira crisis' },
  { country: 'ISL', year: 2008, class: 'currency_crisis', label: 'Icelandic banking collapse' },
  { country: 'IRL', year: 2008, class: 'currency_crisis', label: 'Irish banking crisis' },
  { country: 'GRC', year: 2010, class: 'currency_crisis', label: 'Greek sovereign debt crisis' },
  { country: 'PRT', year: 2011, class: 'currency_crisis', label: 'Portuguese sovereign debt crisis' },
  { country: 'ESP', year: 2012, class: 'currency_crisis', label: 'Spanish banking and debt crisis' },
  { country: 'CYP', year: 2013, class: 'currency_crisis', label: 'Cypriot banking crisis and bail-in' },
  { country: 'RUS', year: 2014, class: 'currency_crisis', label: 'Rouble crisis and sanctions after Crimea' },
  { country: 'BRA', year: 2015, class: 'currency_crisis', label: 'Brazilian recession and real depreciation' },
  { country: 'TUR', year: 2018, class: 'currency_crisis', label: 'Turkish lira crisis' },
  { country: 'TUR', year: 2021, class: 'currency_crisis', label: 'Turkish lira collapse' },
  { country: 'ARE', year: 2009, class: 'currency_crisis', label: 'Dubai World debt crisis' },
  { country: 'ARG', year: 2018, class: 'currency_crisis', label: 'Argentine peso crisis' },
  { country: 'ISR', year: 2006, class: 'armed_conflict', label: 'Second Lebanon War' },
  { country: 'ISR', year: 2014, class: 'armed_conflict', label: 'Gaza war' },
  { country: 'ISR', year: 2023, class: 'armed_conflict', label: 'Israel–Hamas war' },
  { country: 'RUS', year: 2022, class: 'armed_conflict', label: 'Invasion of Ukraine and sanctions' },
  { country: 'UKR', year: 2014, class: 'armed_conflict', label: 'War in eastern Ukraine' },
  { country: 'UKR', year: 2022, class: 'armed_conflict', label: 'Full-scale Russian invasion' },
  { country: 'COL', year: 1999, class: 'armed_conflict', label: 'Peak of armed conflict and recession' },
  { country: 'HKG', year: 2019, class: 'regional_conflict', label: 'Hong Kong protests' },
  { country: 'THA', year: 2014, class: 'regional_conflict', label: 'Thai political crisis and coup' },
  { country: 'POL', year: 2022, class: 'regional_conflict', label: 'War in neighbouring Ukraine' },
  { country: 'HUN', year: 2022, class: 'regional_conflict', label: 'War in neighbouring Ukraine' },
  { country: 'ROU', year: 2022, class: 'regional_conflict', label: 'War in neighbouring Ukraine' },
  { country: 'SVK', year: 2022, class: 'regional_conflict', label: 'War in neighbouring Ukraine' },
  { country: 'EST', year: 2022, class: 'regional_conflict', label: 'War in Ukraine, Russian border state' },
  { country: 'LVA', year: 2022, class: 'regional_conflict', label: 'War in Ukraine, Russian border state' },
  { country: 'LTU', year: 2022, class: 'regional_conflict', label: 'War in Ukraine, Russian border state' },
  { country: 'FIN', year: 2022, class: 'regional_conflict', label: 'War in Ukraine, Russian border state' },
  { country: 'JPN', year: 2011, class: 'natural_disaster', label: 'Tōhoku earthquake and tsunami' },
  { country: 'NZL', year: 2011, class: 'natural_disaster', label: 'Christchurch earthquake' },
  { country: 'CHL', year: 2010, class: 'natural_disaster', label: 'Maule earthquake' },
  { country: 'THA', year: 2011, class: 'natural_disaster', label: 'Thailand floods' },
  { country: 'MEX', year: 2017, class: 'natural_disaster', label: 'Puebla earthquake' },
  { country: 'ITA', year: 2009, class: 'natural_disaster', label: "L'Aquila earthquake" },
  { country: 'ITA', year: 2016, class: 'natural_disaster', label: 'Central Italy earthquakes' },
  { country: 'TUR', year: 2023, class: 'natural_disaster', label: 'Kahramanmaraş earthquakes' },
  { country: 'MAR', year: 2023, class: 'natural_disaster', label: 'Al Haouz earthquake' },
  { country: 'PHL', year: 2013, class: 'natural_disaster', label: 'Typhoon Haiyan' },
];

export const EVENT_TARGETS = ['real_price', 'real_rent'];
export const EVENT_HORIZONS = [1, 2, 3];

const sd = xs => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

// records: { real_price: { 1: [{unit, origin, actual, predicted}], ... }, real_rent: {...} }
// Residual for an episode = actual − shipped prediction from the forecast made at onset − 1.
export function estimateEventLibrary({ records, episodes = EPISODES, classes = Object.keys(EVENT_CLASSES) }) {
  const rows = [];
  for (const target of EVENT_TARGETS) for (const h of EVENT_HORIZONS) {
    const list = records?.[target]?.[h] || [];
    if (!list.length) continue;
    const index = new Map(list.map(r => [`${r.unit}|${r.origin}`, r]));
    const pooledSd = sd(list.map(r => r.actual - r.predicted).filter(finite)) || 1;
    const hits = episodes.map(e => {
      const r = index.get(`${e.country}|${e.year - 1}`);
      return r && finite(r.actual) && finite(r.predicted) ? { ...e, residual: +(r.actual - r.predicted).toFixed(3) } : null;
    }).filter(Boolean);
    const allResiduals = hits.map(x => x.residual);
    for (const cls of classes) {
      const own = hits.filter(x => x.class === cls);
      const pooled = own.length < 2;
      const used = pooled ? hits : own;
      const n = used.length;
      if (!n) continue;
      const res = pooled ? allResiduals : own.map(x => x.residual);
      const effect = mean(res) * (n / (n + 2));
      const se = n > 1 ? sd(res) / Math.sqrt(n) : pooledSd;
      rows.push({
        class: cls, target, horizon: h, effect: +effect.toFixed(3), se: +se.toFixed(3), n_episodes: own.length, pooled,
        episodes: JSON.stringify(own.map(({ country, year, label, residual }) => ({ country, year, label, residual }))
          .concat(pooled ? [{ note: `fewer than 2 episodes of this class with data; using the pooled mean of ${n} episodes across all classes` }] : [])),
      });
    }
  }
  return rows;
}

// ── Sales slumps (calibrated from land-registry sales counts) ──────────────────────────
// A slump starts in the first period where registered sales over the latest 3 months (or the
// latest quarter) fall 25% or more against the same months a year earlier; a new episode needs
// 24 months of separation. The class is calibrated the same way as the curated classes: the
// residual of the following 1-3 year real price growth against the shipped forecast made at the
// origin just before the episode (onset year - 1), shrunk by n/(n+2).
export const SLUMP_CLASS = 'transaction_slump';
export const SLUMP_THRESHOLD = -25;
export const SLUMP_GAP_MONTHS = 24;
// Base-effect guard: where two years of history exist, sales must also be at least 10% below
// two years earlier. This rejects reversals of one-off spikes, such as UK completions pulled
// forward by stamp-duty deadlines (2021 holiday end, April 2025 threshold change).
export const SLUMP_TWO_YEAR_MAX = -10;

// rows: SALES_COUNT observations {country, region, period, frequency, value}. One series per
// country: national rows ('' region) first, monthly before quarterly; otherwise the regional
// series with the most points (Dubai for the UAE).
export function salesSeries(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.frequency !== 'M' && r.frequency !== 'Q') continue;
    const key = `${r.country}|${r.region || ''}|${r.frequency}`;
    (groups.get(key) || groups.set(key, { country: r.country, region: r.region || '', freq: r.frequency, points: {} }).get(key)).points[r.period] = Number(r.value);
  }
  const out = {};
  for (const g of groups.values()) {
    const cur = out[g.country];
    const rank = s => (s.region === '' ? 2 : 0) + (s.freq === 'M' ? 1 : 0);
    const better = !cur || rank(g) > rank(cur) || (rank(g) === rank(cur) && Object.keys(g.points).length > Object.keys(cur.points).length);
    if (better) out[g.country] = g;
  }
  return out;
}

const prevYear = p => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
const monthsBetween = (a, b) => {
  const m = p => Number(p.slice(0, 4)) * 12 + (p.includes('-Q') ? (Number(p.slice(-1)) - 1) * 3 + 2 : Number(p.slice(5, 7)) - 1);
  return m(b) - m(a);
};

// Year-on-year change of 3-month (monthly) or 1-quarter (quarterly) registered sales.
export function salesYoY(series) {
  const periods = Object.keys(series.points).sort();
  const out = [];
  for (let i = 0; i < periods.length; i++) {
    const window = series.freq === 'M' ? periods.slice(Math.max(0, i - 2), i + 1) : [periods[i]];
    if (series.freq === 'M' && window.length < 3) continue;
    // Monthly windows must be three consecutive months.
    if (series.freq === 'M' && monthsBetween(window[0], window[2]) !== 2) continue;
    const prior = window.map(prevYear);
    if (!prior.every(p => finite(series.points[p]))) continue;
    const now = window.reduce((s, p) => s + series.points[p], 0), before = prior.reduce((s, p) => s + series.points[p], 0);
    const prior2 = prior.map(prevYear);
    const before2 = prior2.every(p => finite(series.points[p])) ? prior2.reduce((s, p) => s + series.points[p], 0) : null;
    if (before > 0) out.push({ period: periods[i], yoyPct: 100 * (now / before - 1), twoYearPct: before2 > 0 ? 100 * (now / before2 - 1) : null });
  }
  return out;
}

export const isSlump = (x, threshold = SLUMP_THRESHOLD) => x.yoyPct <= threshold && !(finite(x.twoYearPct) && x.twoYearPct > SLUMP_TWO_YEAR_MAX);

export function findSalesSlumpEpisodes(seriesByCountry, { threshold = SLUMP_THRESHOLD, gapMonths = SLUMP_GAP_MONTHS } = {}) {
  const episodes = [];
  for (const s of Object.values(seriesByCountry)) {
    let last = null;
    for (const x of salesYoY(s)) {
      const { period, yoyPct } = x;
      if (!isSlump(x, threshold)) continue;
      if (last && monthsBetween(last, period) < gapMonths) continue;
      last = period;
      episodes.push({ country: s.country, region: s.region, period, year: Number(period.slice(0, 4)), depth: +yoyPct.toFixed(1), twoYear: finite(x.twoYearPct) ? +x.twoYearPct.toFixed(1) : null, class: SLUMP_CLASS,
        label: `${s.region || s.country} registered sales ${yoyPct.toFixed(0)}% year on year (${period})` });
    }
  }
  return episodes.sort((a, b) => a.period.localeCompare(b.period));
}

// Event-library rows for the slump class. Countries whose series is too short to have a
// backtest origin before the episode simply contribute nothing (e.g. Dubai's 24 months).
export function estimateSlumpLibrary({ records, salesRows }) {
  const episodes = findSalesSlumpEpisodes(salesSeries(salesRows || []));
  const rows = estimateEventLibrary({ records, episodes, classes: [SLUMP_CLASS] }).map(r => ({ ...r, pooled: false }));
  return { rows, episodes };
}

// The live layer's rule: an effect counts if |effect| >= 1.64 se at some horizon.
export function slumpIsClear(rows, target = 'real_price') {
  return rows.some(r => r.class === SLUMP_CLASS && r.target === target && r.se > 0 && Math.abs(r.effect) >= 1.64 * r.se);
}
