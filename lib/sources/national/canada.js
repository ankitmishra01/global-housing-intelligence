// Canada: CMHC Rental Market Survey and Starts and Completions Survey (published by
// Statistics Canada), Statistics Canada New Housing Price Index and Canadian Housing Statistics
// Program assessment values, Bank of Canada 5-year conventional mortgage rate.
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
  { key: 'ASSESSED_VALUE', label: 'Median assessed value of residential property', unit: 'local currency', source: 'Statistics Canada, Canadian Housing Statistics Program', frequency: 'A' },
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

// Canadian Housing Statistics Program (CHSP): median assessment value of residential properties
// by CMA and property type. Tables 46-10-0093 (2022 on) and 46-10-0053 (2018-2022, inactive);
// the newer table wins where they overlap. CHSP has no Quebec. Ontario CMAs are skipped by
// default: MPAC assessments are still at the January 1, 2016 valuation date, so they are far
// below market. Values are assessments (each province's roll and valuation date), not sale prices.
export const CHSP_VALUE_TABLES = ['46100053', '46100093'];
const CHSP_TYPES = { 'Total, all property types': '', 'Single-detached house': 'detached', 'Semi-detached house': 'semi_detached', 'Row house': 'townhouse', 'Condominium apartment': 'condo' };
const CHSP_SOURCE = id => `Statistics Canada Canadian Housing Statistics Program, median assessment value (table ${id.slice(0, 2)}-${id.slice(2, 4)}-${id.slice(4)}, Open Government Licence)`;
const CMA_GEO = /, Census metropolitan area \(CMA\)( – provincial part)?$/;

// DGUID ends in the CMA code (S0503535 Toronto) or the provincial-part code (S050535505
// Ottawa-Gatineau, Ontario part). Ontario CMA codes start with 5; Ontario parts with 35.
export function isOntarioCma(dguid) {
  const code = String(dguid || '').match(/S050[35](\d+)$/)?.[1];
  return !!code && (code.length === 3 ? code[0] === '5' : code.startsWith('35'));
}

// "Ottawa - Gatineau (Ontario part), Census metropolitan area (CMA)" -> "Ottawa-Gatineau, Ontario part, CMA",
// the shape canadaPlace reads, so names match the other StatCan tables.
const chspGeo = geo => `${geo.replace(CMA_GEO, '').replace(/ - /g, '-').replace(/ \((\w+) part\)$/, ', $1 part')}, CMA`;

// Accepts the table CSV or rows in the same shape (fetchCanadaAssessedValues builds them from WDS).
export function parseCanadaAssessedValues(input, { table = '46100093', includeOntario = false } = {}) {
  const rows = (typeof input === 'string' ? csvObjects(input) : input)
    .filter(r => r.Estimates === 'Median assessment value' && r['Property type'] in CHSP_TYPES && CMA_GEO.test(r.GEO)
      && r['Period of construction'] === 'Total, all periods of construction' && r['Property use'] === 'Total, all property use categories'
      && r['Ownership type'] === 'Total, all ownership types' && (includeOntario || !isOntarioCma(r.DGUID)))
    .map(r => ({ ...r, GEO: chspGeo(r.GEO) }));
  const names = chooseGeos(rows);
  const out = [];
  for (const r of rows) {
    const value = num(r.VALUE), name = names.get(r.GEO);
    if (!Number.isFinite(value) || value <= 0 || !name) continue;
    out.push({ ...row('ASSESSED_VALUE', name, String(r.REF_DATE).slice(0, 4), 'A', value, CHSP_SOURCE(table)), dwelling_type: CHSP_TYPES[r['Property type']] });
  }
  return out;
}

// The CHSP CSVs are about 600 MB zipped (every municipality), so read only the CMA series
// through the WDS API: metadata for the member ids, then the latest periods per coordinate
// (geo.type.period.use.ownership.estimate; estimate 5 = median assessment value).
const WDS = 'https://www150.statcan.gc.ca/t1/wds/rest';
const postJson = (path, body) => fetchJson(`${WDS}/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export async function fetchCanadaAssessedValues({ includeOntario = false } = {}) {
  const byKey = new Map();
  for (const table of CHSP_VALUE_TABLES) {
    const [meta] = await postJson('getCubeMetadata', [{ productId: Number(table) }]);
    if (meta.status !== 'SUCCESS') throw new Error(`CHSP ${table} metadata: ${meta.status}`);
    const dims = meta.object.dimension;
    const types = new Map(dims[1].member.filter(m => m.memberNameEn in CHSP_TYPES).map(m => [m.memberId, m.memberNameEn]));
    const geos = new Map(dims[0].member.filter(m => CMA_GEO.test(m.memberNameEn)).map(m => [m.memberId, m]));
    const wanted = [];
    for (const g of geos.keys()) for (const t of types.keys()) wanted.push({ productId: Number(table), coordinate: `${g}.${t}.1.1.1.5.0.0.0.0`, latestN: 20 });
    const rows = [];
    for (let i = 0; i < wanted.length; i += 100) {
      for (const res of await postJson('getDataFromCubePidCoordAndLatestNPeriods', wanted.slice(i, i + 100))) {
        if (res.status !== 'SUCCESS') continue;
        const [g, t] = res.object.coordinate.split('.').map(Number), geo = geos.get(g);
        for (const p of res.object.vectorDataPoint || []) {
          if (p.value == null) continue;
          rows.push({
            REF_DATE: p.refPer.slice(0, 4), GEO: geo.memberNameEn, DGUID: `${geo.vintage}S050${geo.geoLevel - 500}${geo.classificationCode}`,
            'Property type': types.get(t), 'Period of construction': 'Total, all periods of construction', 'Property use': 'Total, all property use categories',
            'Ownership type': 'Total, all ownership types', Estimates: 'Median assessment value', VALUE: String(p.value * 10 ** (p.scalarFactorCode || 0)),
          });
        }
      }
    }
    // Later tables in CHSP_VALUE_TABLES replace earlier ones for the same city, type and year.
    for (const r of parseCanadaAssessedValues(rows, { table, includeOntario })) byKey.set(`${r.region}|${r.dwelling_type}|${r.period}`, r);
  }
  return [...byKey.values()];
}

export async function fetchCanada() {
  const table = async id => unzipEntry(await fetchBuffer(STATCAN(id)), `${id}.csv`);
  const [rents, vacancy, starts, nhpi, cmaStarts] = await Promise.all([table('34100133'), table('34100127'), table('34100135'), table('18100205'), table('34100134')]);
  const boc = await fetchJson('https://www.bankofcanada.ca/valet/observations/V80691335/json?start_date=1990-01-01');
  const weekly = (boc.observations || []).map(o => ({ period: o.d, value: num(o.V80691335?.v) })).filter(p => Number.isFinite(p.value));
  const monthly = new Map();
  for (const w of weekly) { const m = w.period.slice(0, 7); monthly.set(m, [...(monthly.get(m) || []), w.value]); }
  const mortgage = [...monthly].map(([period, v]) => row('MORTGAGE_RATE', '', period, 'M', v.reduce((s, x) => s + x, 0) / v.length, 'Bank of Canada, 5-year conventional mortgage'));
  // CHSP assessment values are a supplement: a WDS outage must not drop the CMHC tables.
  const assessed = await fetchCanadaAssessedValues().catch(error => { console.warn(`  CHSP assessment values failed: ${error.message}`); return []; });
  const nhpiRows = parseCanadaNhpi(nhpi);
  const nhpiByRegion = new Map();
  for (const r of nhpiRows) nhpiByRegion.set(r.region, [...(nhpiByRegion.get(r.region) || []), r]);
  const nhpiOut = [...nhpiByRegion].flatMap(([region, list]) => [
    ...list.filter(r => !region || r.period >= CITY_MONTHLY_FROM),
    ...annualAverage(list).map(a => row('NEW_HOUSING_PRICE', region, a.period, 'A', a.value, list[0].source)),
  ]);
  return [
    ...parseCanadaRents(rents), ...parseCanadaVacancy(vacancy), ...parseCanadaStarts(starts), ...parseCanadaCmaStarts(cmaStarts),
    ...nhpiOut, ...mortgage, ...assessed,
  ].map(r => ({ ...r, source: r.source || CMHC }));
}
