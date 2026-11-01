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
  const quarterly = parseAbs(await fetchText('https://data.api.abs.gov.au/rest/data/ABS,RES_DWELL_ST,1.0.0/?startPeriod=2005&format=csv'));
  const byRegion = new Map();
  for (const q of quarterly) byRegion.set(q.region, [...(byRegion.get(q.region) || []), q]);
  const annual = [...byRegion].flatMap(([region, list]) => annualAverage(list).map(a => ({ country: 'AUS', indicator: 'AVG_PRICE', region, period: a.period, frequency: 'A', value: a.value, source: SOURCE })));
  return [...quarterly, ...annual];
}
