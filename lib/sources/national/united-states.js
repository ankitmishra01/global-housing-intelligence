// United States: official series republished by FRED (no API key needed for fredgraph.csv).
import { annualAverage, csvObjects, fetchText, num } from '../util.js';

export const US_SERIES = {
  MSPUS: { indicator: 'MEDIAN_PRICE', frequency: 'Q', source: 'US Census Bureau / HUD, median sales price of houses sold' },
  CUSR0000SEHA: { indicator: 'RENT_CPI', frequency: 'M', source: 'US Bureau of Labor Statistics, CPI rent of primary residence' },
  MORTGAGE30US: { indicator: 'MORTGAGE_RATE', frequency: 'W', source: 'Freddie Mac, 30-year fixed mortgage rate' },
  HOUST: { indicator: 'HOUSING_STARTS', frequency: 'M', source: 'US Census Bureau, housing starts (SAAR, thousands)' },
  RRVRUSQ156N: { indicator: 'VACANCY_RATE', frequency: 'Q', source: 'US Census Bureau, rental vacancy rate' },
};

export const US_INDICATORS = [
  { key: 'MEDIAN_PRICE', label: 'Median sales price', unit: 'local currency', source: 'National housing agency', frequency: 'Q' },
  { key: 'RENT_CPI', label: 'Rent component of CPI', unit: 'index', source: 'National statistics office', frequency: 'M' },
];

export function parseFred(csv, seriesId) {
  const meta = US_SERIES[seriesId];
  const points = [];
  for (const r of csvObjects(csv)) {
    const date = r.observation_date || r.DATE;
    const value = num(r[seriesId]);
    if (!date || !Number.isFinite(value)) continue;
    const [y, m] = date.split('-');
    const period = meta.frequency === 'Q' ? `${y}-Q${Math.ceil(Number(m) / 3)}` : `${y}-${m}`;
    points.push({ period, value });
  }
  // Weekly mortgage rates become monthly means.
  if (meta.frequency === 'W') {
    const byMonth = new Map();
    for (const p of points) byMonth.set(p.period, [...(byMonth.get(p.period) || []), p.value]);
    return { frequency: 'M', points: [...byMonth].map(([period, v]) => ({ period, value: v.reduce((s, x) => s + x, 0) / v.length })) };
  }
  return { frequency: meta.frequency, points };
}

export async function fetchUnitedStates() {
  const rows = [];
  for (const [id, meta] of Object.entries(US_SERIES)) {
    const { frequency, points } = parseFred(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`), id);
    const scale = id === 'HOUST' ? 1000 : 1;
    for (const p of points) rows.push({ country: 'USA', indicator: meta.indicator, region: '', period: p.period, frequency, value: p.value * scale, source: meta.source });
    for (const a of annualAverage(points)) rows.push({ country: 'USA', indicator: meta.indicator, region: '', period: a.period, frequency: 'A', value: a.value * scale, source: meta.source });
  }
  return rows;
}
