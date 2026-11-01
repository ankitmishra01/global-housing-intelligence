// Builds the annual country panel the projection engine trains on.
// panel[iso3][key][year] = value (actual observations only); forecasts[iso3][key][year] for IMF WEO years.
import { finite } from './stats.js';

export function buildPanel(rows) {
  const panel = {}, forecasts = {}, monthly = {};
  const types = {};
  for (const r of rows) {
    if (r.region) continue;
    if (r.dwelling_type) {
      if (r.frequency === 'A' && (r.indicator === 'TYPE_PRICE_INDEX' || r.indicator === 'TYPE_PRICE_LEVEL')) {
        const t = ((types[r.country] ||= {})[r.dwelling_type] ||= {});
        ((t[r.indicator] ||= { source: r.source, values: {} }).values)[Number(r.period)] = r.value;
      }
      continue;
    }
    if (r.frequency === 'M') { if (r.indicator === 'POLICY_RATE' || r.indicator === 'MORTGAGE_RATE') (((monthly[r.country] ||= {})[r.indicator] ||= {}))[r.period] = r.value; continue; }
    if (r.frequency === 'Q') { if (r.indicator === 'REAL_PRICE' || r.indicator === 'NOMINAL_PRICE') (((monthly[r.country] ||= {})[`${r.indicator}_Q`] ||= {}))[r.period] = r.value; continue; }
    if (r.frequency !== 'A') continue;
    const target = r.status === 'forecast' ? forecasts : panel;
    (((target[r.country] ||= {})[r.indicator] ||= {}))[Number(r.period)] = r.value;
  }
  for (const [iso3, byType] of Object.entries(types)) {
    const c = (panel[iso3] ||= {});
    c.TYPE_NOM = {}; c.TYPE_SOURCE = {};
    // Prefer the longer of the BIS index and the national level series for each type.
    for (const [type, bySource] of Object.entries(byType)) {
      const best = Object.values(bySource).sort((a, b) => Object.keys(b.values).length - Object.keys(a.values).length)[0];
      c.TYPE_NOM[type] = best.values; c.TYPE_SOURCE[type] = best.source;
    }
  }
  for (const iso3 of Object.keys(panel)) deriveSeries(panel[iso3], forecasts[iso3] || {});
  return { panel, forecasts, monthly };
}

// PRICE / NPRICE: BIS when present, else OECD; never mixed within one country.
// REAL_RENT: OECD rent index deflated by a CPI level chained from IMF inflation.
export function deriveSeries(c) {
  const bis = Object.keys(c.REAL_PRICE || {}).length, oecd = Object.keys(c.OECD_REAL_PRICE || {}).length;
  if (bis || oecd) {
    const useBis = bis >= oecd || bis >= 15;
    c.PRICE = { ...(useBis ? c.REAL_PRICE : c.OECD_REAL_PRICE) };
    c.NPRICE = { ...(useBis ? c.NOMINAL_PRICE : c.OECD_NOMINAL_PRICE) || {} };
    c.PRICE_SOURCE = useBis ? 'BIS' : 'OECD';
  }
  // IMF WEO history starts in 1980; earlier years fall back to World Bank CPI inflation.
  if (c.CPI_INFLATION_WB) {
    c.INFLATION ||= {};
    for (const [y, v] of Object.entries(c.CPI_INFLATION_WB)) if (!finite(c.INFLATION[y])) c.INFLATION[y] = v;
  }
  if (c.INFLATION) {
    const years = Object.keys(c.INFLATION).map(Number).sort((a, b) => a - b);
    const cpi = {}; let level = 100;
    for (const y of years) { level *= 1 + c.INFLATION[y] / 100; cpi[y] = level; }
    c.CPI = cpi;
  }
  if (c.TYPE_NOM && c.CPI) {
    c.TYPE_REAL = {};
    for (const [type, series] of Object.entries(c.TYPE_NOM)) {
      c.TYPE_REAL[type] = {};
      for (const [y, v] of Object.entries(series)) if (finite(c.CPI[y])) c.TYPE_REAL[type][y] = (100 * v) / c.CPI[y];
    }
  }
  if (c.RENT && c.CPI) {
    c.REAL_RENT = {};
    for (const [y, v] of Object.entries(c.RENT)) if (finite(c.CPI[y])) c.REAL_RENT[y] = (100 * v) / c.CPI[y];
  }
}

export const lastYear = series => {
  const ys = Object.keys(series || {}).map(Number).filter(y => finite(series[y]));
  return ys.length ? Math.max(...ys) : null;
};

export function valueAtOrBefore(series, year, maxLag = 3) {
  if (!series) return null;
  for (let y = year; y >= year - maxLag; y--) if (finite(series[y])) return series[y];
  return null;
}

export const logGrowth = (series, from, to) =>
  finite(series?.[from]) && finite(series?.[to]) && series[from] > 0 && series[to] > 0 ? 100 * Math.log(series[to] / series[from]) : null;

// Latest monthly value and the value 12 months earlier, for the toggle base and rate trend.
export function latestMonthly(series) {
  const keys = Object.keys(series || {}).sort();
  if (!keys.length) return null;
  const last = keys[keys.length - 1];
  const [y, m] = last.split('-').map(Number);
  const yearAgo = `${y - 1}-${String(m).padStart(2, '0')}`;
  return { period: last, value: series[last], yearAgo: finite(series[yearAgo]) ? series[yearAgo] : null };
}
