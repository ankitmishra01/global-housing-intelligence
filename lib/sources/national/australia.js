// Australia: ABS Residential Dwellings, mean price of residential dwellings (AUD),
// national and by state capital region.
import { annualAverage, csvObjects, fetchText, num } from '../util.js';

const SOURCE = 'Australian Bureau of Statistics, Residential Dwellings';
const STATES = { AUS: '', 1: 'New South Wales', 2: 'Victoria', 3: 'Queensland', 4: 'South Australia', 5: 'Western Australia', 6: 'Tasmania', 7: 'Northern Territory', 8: 'Australian Capital Territory' };

export const AUSTRALIA_INDICATORS = [
  { key: 'AVG_PRICE', label: 'Average house price', unit: 'local currency', source: 'National housing agency', frequency: 'Q' },
];

export function parseAbs(csv) {
  const out = [];
  for (const r of csvObjects(csv)) {
    if (String(r.MEASURE) !== '5' || !(r.REGION in STATES)) continue;
    const value = num(r.OBS_VALUE) * 10 ** (num(r.UNIT_MULT) || 0);
    if (!Number.isFinite(value)) continue;
    out.push({ country: 'AUS', indicator: 'AVG_PRICE', region: STATES[r.REGION], period: r.TIME_PERIOD, frequency: 'Q', value, source: SOURCE });
  }
  return out;
}

export async function fetchAustralia() {
  let cities = [];
  try { cities = await fetchAustraliaCities(); } catch (error) { console.log(`  AUS capital cities failed: ${error.message}`); }
  const quarterly = parseAbs(await fetchText('https://data.api.abs.gov.au/rest/data/ABS,RES_DWELL_ST,1.0.0/?startPeriod=2005&format=csv'));
  const byRegion = new Map();
  for (const q of quarterly) byRegion.set(q.region, [...(byRegion.get(q.region) || []), q]);
  const annual = [...byRegion].flatMap(([region, list]) => annualAverage(list).map(a => ({ country: 'AUS', indicator: 'AVG_PRICE', region, period: a.period, frequency: 'A', value: a.value, source: SOURCE })));
  return [...quarterly, ...annual, ...cities];
}

// ABS Residential Dwellings by Greater Capital City (RES_DWELL): established house and attached
// dwelling transfers (sales counts) and their median prices, quarterly from 2002.
const CAPITALS = { '1GSYD': 'Sydney', '2GMEL': 'Melbourne', '3GBRI': 'Brisbane', '4GADE': 'Adelaide', '5GPER': 'Perth', '6GHOB': 'Hobart', '7GDAR': 'Darwin', '8ACTE': 'Canberra' };
const CITY_MEASURES = { 1: ['SALES_COUNT', 'house'], 2: ['SALES_COUNT', 'condo'], 3: ['MEDIAN_PRICE', 'house'], 4: ['MEDIAN_PRICE', 'condo'] };
const CITY_SOURCE = 'Australian Bureau of Statistics, Residential Dwellings by Greater Capital City (CC BY 4.0)';

export function parseAbsCities(csv) {
  const out = [];
  for (const r of csvObjects(csv)) {
    const region = CAPITALS[r.REGION], spec = CITY_MEASURES[String(r.MEASURE)];
    if (!region || !spec) continue;
    const value = num(r.OBS_VALUE) * 10 ** (num(r.UNIT_MULT) || 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({ country: 'AUS', indicator: spec[0], region, dwelling_type: spec[1], period: r.TIME_PERIOD, frequency: 'Q', value, source: CITY_SOURCE });
  }
  // Total sales per city = houses + attached dwellings, for quarters that have both.
  const totals = new Map();
  for (const r of out.filter(x => x.indicator === 'SALES_COUNT')) {
    const k = `${r.region}|${r.period}`;
    const t = totals.get(k) || { ...r, dwelling_type: '', value: 0, n: 0 };
    t.value += r.value; t.n += 1; totals.set(k, t);
  }
  out.push(...[...totals.values()].filter(t => t.n === 2).map(({ n, ...t }) => t));
  return out;
}

export async function fetchAustraliaCities() {
  const quarterly = parseAbsCities(await fetchText('https://data.api.abs.gov.au/rest/data/ABS,RES_DWELL,1.0.0/?format=csv'));
  const groups = new Map();
  for (const q of quarterly) { const k = `${q.indicator}|${q.region}|${q.dwelling_type}`; groups.set(k, [...(groups.get(k) || []), q]); }
  const annual = [...groups.values()].flatMap(list => annualAverage(list).map(a => ({ ...list[0], period: a.period, frequency: 'A', value: list[0].indicator === 'SALES_COUNT' ? a.value * 4 : a.value })));
  return [...quarterly, ...annual];
}
