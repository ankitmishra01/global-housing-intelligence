// Canada: CMHC Rental Market Survey and Starts and Completions Survey (published by
// Statistics Canada), Statistics Canada New Housing Price Index, Bank of Canada
// 5-year conventional mortgage rate.
import { inflateRawSync } from 'node:zlib';
import { annualAverage, csvObjects, fetchBuffer, fetchJson, num } from '../util.js';

const STATCAN = id => `https://www150.statcan.gc.ca/n1/tbl/csv/${id}-eng.zip`;
const CMHC = 'CMHC (Statistics Canada)';

// Major metros shown as city rows. Names match the GEO column in the StatCan tables.
export const CANADA_CITIES = ['Toronto, Ontario', 'Vancouver, British Columbia', 'Montréal, Quebec', 'Calgary, Alberta', 'Edmonton, Alberta', 'Ottawa-Gatineau, Ontario part, Ontario/Quebec', 'Québec, Quebec', 'Winnipeg, Manitoba', 'Halifax, Nova Scotia'];

export const CANADA_INDICATORS = [
  { key: 'AVG_RENT_2BR', label: 'Average rent, two-bedroom apartment', unit: 'local currency per month', source: 'CMHC Rental Market Survey', frequency: 'A' },
  { key: 'VACANCY_RATE', label: 'Rental vacancy rate', unit: '%', source: 'National housing agency', frequency: 'A' },
  { key: 'HOUSING_STARTS', label: 'Housing starts', unit: 'units per year', source: 'National housing agency', frequency: 'A' },
  { key: 'NEW_HOUSING_PRICE', label: 'New housing price index', unit: 'index', source: 'Statistics Canada', frequency: 'M' },
  { key: 'MORTGAGE_RATE', label: 'Mortgage rate', unit: '%', source: 'National central bank / agency', frequency: 'M' },
];

// Minimal ZIP reader: returns the first entry whose name ends with `suffix`.
// StatCan zips hold <id>.csv and <id>_MetaData.csv, deflate-compressed.
export function unzipEntry(buffer, suffix) {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(p + 10), compressed = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28), extraLen = buffer.readUInt16LE(p + 30), commentLen = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    if (name.endsWith(suffix) && !name.includes('MetaData')) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + compressed);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`No ${suffix} in zip`);
}

const row = (indicator, region, period, frequency, value, source) => ({ country: 'CAN', indicator, region, period, frequency, value, source });

export function parseCanadaRents(csv) {
  const out = [];
  for (const r of csvObjects(csv)) {
    if (r['Type of unit'] !== 'Two bedroom units' || !r['Type of structure']?.startsWith('Row and apartment')) continue;
    const value = num(r.VALUE);
    if (!Number.isFinite(value) || !CANADA_CITIES.includes(r.GEO)) continue;
    out.push(row('AVG_RENT_2BR', cityName(r.GEO), r.REF_DATE.slice(0, 4), 'A', value, 'CMHC Rental Market Survey'));
  }
  return out;
}

export function parseCanadaVacancy(csv) {
  const out = [];
  for (const r of csvObjects(csv)) {
    const value = num(r.VALUE);
    if (!Number.isFinite(value)) continue;
    const region = r.GEO === 'Census metropolitan areas' ? '' : CANADA_CITIES.includes(r.GEO) ? cityName(r.GEO) : null;
    if (region == null) continue;
    out.push(row('VACANCY_RATE', region, r.REF_DATE.slice(0, 4), 'A', value, 'CMHC Rental Market Survey'));
  }
  return out;
}

export function parseCanadaStarts(csv) {
  const monthly = [];
  for (const r of csvObjects(csv)) {
    if (r.GEO !== 'Canada' || r['Housing estimates'] !== 'Housing starts' || r['Type of unit'] !== 'Total units' || r['Seasonal adjustment'] !== 'Unadjusted') continue;
    const value = num(r.VALUE);
    if (Number.isFinite(value)) monthly.push({ period: r.REF_DATE, value });
  }
  // Annual total from complete years of monthly unadjusted starts.
  const byYear = new Map();
  for (const m of monthly) { const y = m.period.slice(0, 4); byYear.set(y, [...(byYear.get(y) || []), m.value]); }
  return [...byYear].filter(([, v]) => v.length === 12).map(([y, v]) => row('HOUSING_STARTS', '', y, 'A', v.reduce((s, x) => s + x, 0), 'CMHC Starts and Completions Survey'));
}

export function parseCanadaNhpi(csv) {
  const out = [];
  for (const r of csvObjects(csv)) {
    if (r.GEO !== 'Canada' || r['New housing price indexes'] !== 'Total (house and land)') continue;
    const value = num(r.VALUE);
    if (Number.isFinite(value)) out.push(row('NEW_HOUSING_PRICE', '', r.REF_DATE, 'M', value, 'Statistics Canada New Housing Price Index'));
  }
  return out;
}

const cityName = geo => geo.split(',')[0].replace(' part', '');

export async function fetchCanada() {
  const table = async id => unzipEntry(await fetchBuffer(STATCAN(id)), `${id}.csv`);
  const [rents, vacancy, starts, nhpi] = await Promise.all([table('34100133'), table('34100127'), table('34100135'), table('18100205')]);
  const boc = await fetchJson('https://www.bankofcanada.ca/valet/observations/V80691335/json?start_date=1990-01-01');
  const weekly = (boc.observations || []).map(o => ({ period: o.d, value: num(o.V80691335?.v) })).filter(p => Number.isFinite(p.value));
  const monthly = new Map();
  for (const w of weekly) { const m = w.period.slice(0, 7); monthly.set(m, [...(monthly.get(m) || []), w.value]); }
  const mortgage = [...monthly].map(([period, v]) => row('MORTGAGE_RATE', '', period, 'M', v.reduce((s, x) => s + x, 0) / v.length, 'Bank of Canada, 5-year conventional mortgage'));
  const nhpiRows = parseCanadaNhpi(nhpi);
  return [
    ...parseCanadaRents(rents), ...parseCanadaVacancy(vacancy), ...parseCanadaStarts(starts),
    ...nhpiRows, ...annualAverage(nhpiRows).map(a => row('NEW_HOUSING_PRICE', '', a.period, 'A', a.value, 'Statistics Canada New Housing Price Index')),
    ...mortgage,
  ].map(r => ({ ...r, source: r.source || CMHC }));
}
