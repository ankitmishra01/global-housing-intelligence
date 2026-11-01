// Canada: CMHC Rental Market Survey and Starts and Completions Survey (published by
// Statistics Canada), Statistics Canada New Housing Price Index, Bank of Canada
// 5-year conventional mortgage rate.
import { inflateRawSync } from 'node:zlib';
import { annualAverage, csvObjects, fetchBuffer, fetchJson, num } from '../util.js';

const STATCAN = id => `https://www150.statcan.gc.ca/n1/tbl/csv/${id}-eng.zip`;
const CMHC = 'CMHC (Statistics Canada)';

// Major metros, kept for callers that want the headline nine (the parsers now read every centre).
export const CANADA_CITIES = ['Toronto, Ontario', 'Vancouver, British Columbia', 'Montréal, Quebec', 'Calgary, Alberta', 'Edmonton, Alberta', 'Ottawa-Gatineau, Ontario part, Ontario/Quebec', 'Québec, Quebec', 'Winnipeg, Manitoba', 'Halifax, Nova Scotia'];

// City name from a StatCan GEO such as "Toronto, Ontario" or "Ottawa-Gatineau, Ontario part,
// Ontario/Quebec". Provinces and Canada have no comma and return null. Whole-CMA rows beat
// "excluding" variants, which beat the Ontario part, which beats the Quebec part.
export function canadaPlace(geo) {
  const parts = String(geo || '').split(', ');
  if (parts.length < 2) return null;
  let name = parts.slice(0, -1).join(', ');
  let rank = 0;
  if (/ excluding /.test(name)) { name = name.replace(/ excluding .*/, ''); rank = 1; }
  if (/, Ontario part$/.test(name)) { name = name.replace(/, Ontario part$/, ''); rank = 2; }
  if (/, Quebec part$/.test(name)) { name = name.replace(/, Quebec part$/, ''); rank = 3; }
  return { name, rank };
}

// Map each GEO in a table to its city name, keeping only the best-ranked GEO per city.
export function chooseGeos(rows) {
  const best = new Map();
  for (const geo of new Set(rows.map(r => r.GEO))) {
    const place = canadaPlace(geo);
    if (!place) continue;
    const cur = best.get(place.name);
    if (!cur || place.rank < cur.rank) best.set(place.name, { geo, rank: place.rank });
  }
  return new Map([...best].map(([name, v]) => [v.geo, name]));
}

export const CANADA_INDICATORS = [
  { key: 'AVG_RENT_2BR', label: 'Average rent, two-bedroom apartment', unit: 'local currency per month', source: 'CMHC Rental Market Survey', frequency: 'A' },
  { key: 'AVG_RENT_1BR', label: 'Average rent, one-bedroom apartment', unit: 'local currency per month', source: 'CMHC Rental Market Survey', frequency: 'A' },
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

// CMHC Rental Market Survey, every centre of 10,000+ (about 240): two- and one-bedroom rents in
// purpose-built apartment structures.
const RENT_UNITS = { 'Two bedroom units': 'AVG_RENT_2BR', 'One bedroom units': 'AVG_RENT_1BR' };
export function parseCanadaRents(csv) {
  const rows = csvObjects(csv).filter(r => r['Type of structure']?.startsWith('Row and apartment') && RENT_UNITS[r['Type of unit']]);
  const names = chooseGeos(rows);
  const out = [];
  for (const r of rows) {
    const value = num(r.VALUE), name = names.get(r.GEO);
    // CMHC writes 0 for suppressed or not-yet-surveyed centres.
    if (!Number.isFinite(value) || value <= 0 || !name) continue;
    out.push(row(RENT_UNITS[r['Type of unit']], name, r.REF_DATE.slice(0, 4), 'A', value, 'CMHC Rental Market Survey (Statistics Canada table 34-10-0133, Open Government Licence)'));
  }
  return out;
}

// Vacancy for every census metropolitan area, plus the all-CMA national row.
export function parseCanadaVacancy(csv) {
  const rows = csvObjects(csv);
  const names = chooseGeos(rows);
  const out = [];
  for (const r of rows) {
    const value = num(r.VALUE);
    if (!Number.isFinite(value)) continue;
    const region = r.GEO === 'Census metropolitan areas' ? '' : names.get(r.GEO);
    if (region == null) continue;
    out.push(row('VACANCY_RATE', region, r.REF_DATE.slice(0, 4), 'A', value, 'CMHC Rental Market Survey (Statistics Canada table 34-10-0127, Open Government Licence)'));
  }
  return out;
}

// CMHC starts by CMA (table 34-10-0134, annual), total and by dwelling type.
const START_TYPES = { 'Total units': '', 'Single-detached units': 'detached', 'Semi-detached units': 'semi_detached', 'Row units': 'townhouse', 'Apartment and other unit types': 'condo' };
export function parseCanadaCmaStarts(csv) {
  const rows = csvObjects(csv).filter(r => r['Housing estimates'] === 'Housing starts' && r['Type of unit'] in START_TYPES);
  const names = chooseGeos(rows);
  const out = [];
  for (const r of rows) {
    const value = num(r.VALUE), name = names.get(r.GEO);
    if (!Number.isFinite(value) || !name) continue;
    out.push({ ...row('HOUSING_STARTS', name, r.REF_DATE.slice(0, 4), 'A', value, 'CMHC Starts and Completions Survey (Statistics Canada table 34-10-0134, Open Government Licence)'), dwelling_type: START_TYPES[r['Type of unit']] });
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
  // Annual total from complete years of unadjusted starts. Table 34-10-0135 was monthly and is
  // now quarterly (periods 01, 04, 07, 10), so a year is complete with 12 months or 4 quarters.
  const byYear = new Map();
  for (const m of monthly) { const y = m.period.slice(0, 4); byYear.set(y, [...(byYear.get(y) || []), m]); }
  const complete = v => v.length === 12 || (v.length === 4 && v.every(m => ['01', '04', '07', '10'].includes(m.period.slice(5, 7))));
  return [...byYear].filter(([, v]) => complete(v)).map(([y, v]) => row('HOUSING_STARTS', '', y, 'A', v.reduce((s, x) => s + x.value, 0), 'CMHC Starts and Completions Survey'));
}

// New Housing Price Index (house and land): Canada plus about 27 CMAs. City rows keep monthly
// data from 2011 (annual for the full history) to keep the table compact.
export const CITY_MONTHLY_FROM = '2011-01';
export function parseCanadaNhpi(csv) {
  const rows = csvObjects(csv).filter(r => r['New housing price indexes'] === 'Total (house and land)');
  const names = chooseGeos(rows);
  const out = [];
  for (const r of rows) {
    const value = num(r.VALUE);
    if (!Number.isFinite(value)) continue;
    const region = r.GEO === 'Canada' ? '' : names.get(r.GEO);
    if (region == null) continue;
    out.push(row('NEW_HOUSING_PRICE', region, r.REF_DATE, 'M', value, 'Statistics Canada New Housing Price Index (table 18-10-0205, Open Government Licence)'));
  }
  return out;
}


export async function fetchCanada() {
  const table = async id => unzipEntry(await fetchBuffer(STATCAN(id)), `${id}.csv`);
  const [rents, vacancy, starts, nhpi, cmaStarts] = await Promise.all([table('34100133'), table('34100127'), table('34100135'), table('18100205'), table('34100134')]);
  const boc = await fetchJson('https://www.bankofcanada.ca/valet/observations/V80691335/json?start_date=1990-01-01');
  const weekly = (boc.observations || []).map(o => ({ period: o.d, value: num(o.V80691335?.v) })).filter(p => Number.isFinite(p.value));
  const monthly = new Map();
  for (const w of weekly) { const m = w.period.slice(0, 7); monthly.set(m, [...(monthly.get(m) || []), w.value]); }
  const mortgage = [...monthly].map(([period, v]) => row('MORTGAGE_RATE', '', period, 'M', v.reduce((s, x) => s + x, 0) / v.length, 'Bank of Canada, 5-year conventional mortgage'));
  const nhpiRows = parseCanadaNhpi(nhpi);
  const nhpiByRegion = new Map();
  for (const r of nhpiRows) nhpiByRegion.set(r.region, [...(nhpiByRegion.get(r.region) || []), r]);
  const nhpiOut = [...nhpiByRegion].flatMap(([region, list]) => [
    ...list.filter(r => !region || r.period >= CITY_MONTHLY_FROM),
    ...annualAverage(list).map(a => row('NEW_HOUSING_PRICE', region, a.period, 'A', a.value, list[0].source)),
  ]);
  return [
    ...parseCanadaRents(rents), ...parseCanadaVacancy(vacancy), ...parseCanadaStarts(starts), ...parseCanadaCmaStarts(cmaStarts),
    ...nhpiOut, ...mortgage,
  ].map(r => ({ ...r, source: r.source || CMHC }));
}
