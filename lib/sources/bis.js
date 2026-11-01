// Bank for International Settlements SDMX API (stats.bis.org), CSV format.
// Residential property prices, household credit, credit gap, central bank policy rates.
import { annualAverage, csvObjects, fetchText, num } from './util.js';
import { EURO_AREA } from '../registry.js';

const BASE = 'https://stats.bis.org/api/v1/data';
const SOURCE = 'BIS';

export const BIS_INDICATORS = [
  { key: 'REAL_PRICE', label: 'Real residential property price index', unit: 'index, 2010 = 100', source: 'BIS selected residential property prices', frequency: 'Q' },
  { key: 'NOMINAL_PRICE', label: 'Nominal residential property price index', unit: 'index, 2010 = 100', source: 'BIS selected residential property prices', frequency: 'Q' },
  { key: 'HH_CREDIT', label: 'Household credit', unit: '% of GDP', source: 'BIS total credit statistics', frequency: 'Q' },
  { key: 'CREDIT_GAP', label: 'Credit-to-GDP gap', unit: 'percentage points', source: 'BIS credit-to-GDP gaps', frequency: 'Q' },
  { key: 'TYPE_PRICE_INDEX', label: 'Residential price index by dwelling type', unit: 'index', source: 'BIS detailed residential property prices', frequency: 'A' },
  { key: 'CITY_PRICE', label: 'Residential prices, city', unit: 'source units (often local currency per m²)', source: 'BIS detailed residential property prices', frequency: 'A' },
  { key: 'POLICY_RATE', label: 'Central bank policy rate', unit: '%', source: 'BIS central bank policy rates', frequency: 'M' },
];

// Parse one BIS CSV payload into {iso3, period, value} using the given area column.
export function parseBisCsv(text, areaColumn, iso2ToIso3) {
  const out = [];
  for (const r of csvObjects(text)) {
    const area = r[areaColumn];
    const value = num(r.OBS_VALUE);
    if (!Number.isFinite(value)) continue;
    const iso3 = area === 'XM' ? 'XM' : iso2ToIso3.get(area);
    if (!iso3) continue; // aggregates such as 5R or G2
    out.push({ iso3, period: r.TIME_PERIOD, value });
  }
  return out;
}

function group(points) {
  const map = new Map();
  for (const p of points) (map.get(p.iso3) || map.set(p.iso3, []).get(p.iso3)).push(p);
  return map;
}

function toRows(points, indicator, frequency, { annual = true } = {}) {
  const rows = [];
  for (const [iso3, list] of group(points)) {
    const source = list[0]?.proxy ? `${SOURCE} (US policy rate: currency pegged to the US dollar)` : SOURCE;
    for (const p of list) rows.push({ country: iso3, indicator, period: p.period, frequency, value: p.value, source });
    if (annual) for (const a of annualAverage(list)) rows.push({ country: iso3, indicator, period: a.period, frequency: 'A', value: a.value, source });
  }
  return rows;
}

// Gulf currencies pegged to the US dollar: their central banks move in step with the Fed, so
// where the BIS has no series of their own, the US policy rate stands in (labelled as such).
export const USD_PEGGED = ['ARE', 'SAU', 'QAT', 'BHR', 'OMN'];
export function addUsdPegProxies(points) {
  const own = new Set(points.map(p => p.iso3));
  const us = points.filter(p => p.iso3 === 'USA');
  return [...points, ...USD_PEGGED.filter(c => !own.has(c)).flatMap(iso3 => us.map(p => ({ ...p, iso3, proxy: 'USA' })))];
}

// Euro members inherit the XM (ECB) rate from their joining year onward.
export function expandEuroPolicy(points) {
  const xm = points.filter(p => p.iso3 === 'XM');
  const out = points.filter(p => p.iso3 !== 'XM' && !(EURO_AREA[p.iso3] && Number(p.period.slice(0, 4)) >= EURO_AREA[p.iso3]));
  for (const [iso3, joined] of Object.entries(EURO_AREA)) for (const p of xm) if (Number(p.period.slice(0, 4)) >= joined) out.push({ ...p, iso3 });
  return out;
}

export async function fetchBis(iso2ToIso3) {
  const get = path => fetchText(`${BASE}/${path}${path.includes('?') ? '&' : '?'}format=csv`);
  const [real, nominal, credit, gap, policy] = await Promise.all([
    get('WS_SPP/Q..R.628'),
    get('WS_SPP/Q..N.628'),
    get('WS_TC/Q..H.A.M.770.A'),
    get('WS_CREDIT_GAP/Q..P.A.C'),
    get('WS_CBPOL/M?startPeriod=1970-01'),
  ]);
  return [
    ...toRows(parseBisCsv(real, 'REF_AREA', iso2ToIso3), 'REAL_PRICE', 'Q'),
    ...toRows(parseBisCsv(nominal, 'REF_AREA', iso2ToIso3), 'NOMINAL_PRICE', 'Q'),
    ...toRows(parseBisCsv(credit, 'BORROWERS_CTY', iso2ToIso3), 'HH_CREDIT', 'Q'),
    ...toRows(parseBisCsv(gap, 'BORROWERS_CTY', iso2ToIso3), 'CREDIT_GAP', 'Q'),
    ...toRows(addUsdPegProxies(expandEuroPolicy(parseBisCsv(policy, 'REF_AREA', iso2ToIso3))), 'POLICY_RATE', 'M'),
  ];
}

// BIS detailed residential property prices (WS_DPP), whole-country coverage only,
// split by dwelling type. Several series can exist per country and type (different
// compilers, priced units or vintages); the one with the longest annual history wins.
export const BIS_DWELLING_TYPES = { 1: 'all', 2: 'house', 3: 'detached', 4: 'townhouse', 8: 'condo' };
// Type 'all' (all dwellings, whole country) is a fallback headline index for economies the
// selected-prices dataset (WS_SPP) omits, e.g. the UAE. City series of all dwellings become
// regional CITY_PRICE rows (their own units, often local currency per square metre).

// BIS unit codes (CL_BIS_UNIT) used by the detailed property price series, and priced-unit
// and vintage codes, so stored source labels read "index, 2010 = 100" instead of "(628)".
export const BIS_UNIT_LABELS = {
  348: 'index, 2000 = 100', 401: 'index, 1993 Q4 = 100', 628: 'index, 2010 = 100', 651: 'index, 2010 Q1 = 100', 655: 'index, 2011 = 100',
  667: 'index, 2006 Q1 = 100', 672: 'index, 1912 = 100', 676: 'index, March 2001 = 100', 718: 'index, 2010 Q2 to 2011 Q1 = 100',
  779: 'index, December 2009 = 100', 801: 'index, 2015 = 100', 818: 'index, 2014 Q1 = 100', 840: 'index, 2017 = 100', 854: 'index, 2018 = 100',
  871: 'index, 2019 = 100', 876: 'index, October 2017 = 414.5', 882: 'index, 2020 = 100', 910: 'index, August 2010 = 100', 921: 'index, 2022 = 100',
  923: 'index, 2023 = 100', 948: 'index, January 2024 = 100', 962: 'index, 2022 Q2 to 2023 Q1 = 100', 965: 'index, 2025 = 100', 974: 'index, June 2026 = 100',
};
const PRICED_UNIT = { 0: 'per dwelling', 1: 'per square metre', 2: 'per 4 square metres', 3: 'per cubic metre', 4: 'per building', 5: 'per property' };
const VINTAGE = { 1: 'existing dwellings', 2: 'new dwellings' };

export function bisUnitLabel(unit, pricedUnit) {
  if (BIS_UNIT_LABELS[unit]) return BIS_UNIT_LABELS[unit];
  if (/^[A-Z]{3}$/.test(unit || '')) return `${unit} ${PRICED_UNIT[pricedUnit] ?? ''}`.trim();
  return unit ? `unit ${unit}` : 'index';
}

// City/area names from BIS series titles ("Austria - Residential property price index, all dwellings, Vienna").
// Aggregates are labelled as aggregates, remainder areas name the country, and a "whole country"
// series is dropped (it duplicates the national headline). Returns null to drop.
export function bisRegionName(title) {
  const text = String(title || '');
  const country = text.split(' - ')[0].trim();
  const seg = text.split(/,|\.\s/).pop().replace(/\s+/g, ' ').trim();
  if (!seg || /^whole country$/i.test(seg)) return null;
  let m;
  if ((m = seg.match(/^(\d+) cities( \(discontinued\))?$/i))) return `${m[1]}-city aggregate${m[2] ?? ''}`;
  if ((m = seg.match(/^(?:whole country )?excluding (.+)$/i))) return `${country} excluding ${m[1]}`;
  if (/^rest of the country$/i.test(seg)) return `Rest of ${country}`;
  if (/^non-urban areas$/i.test(seg)) return `Non-urban ${country}`;
  if (/^big cities$/i.test(seg)) return 'Big cities aggregate';
  if (/^cities$/i.test(seg)) return 'Cities aggregate';
  if (/^metropolitan area$/i.test(seg)) return 'Metropolitan areas aggregate';
  if (/^capital area$/i.test(seg)) return country === 'Philippines' ? 'Metro Manila' : `${country} capital area`;
  return seg;
}

export function parseBisDwellingTypes(text, iso2ToIso3) {
  const series = new Map();
  for (const r of csvObjects(text)) {
    const type = BIS_DWELLING_TYPES[r.RE_TYPE];
    const iso3 = iso2ToIso3.get(r.REF_AREA);
    const value = num(r.OBS_VALUE);
    if (!type || !iso3 || !Number.isFinite(value)) continue;
    const city = r.COVERED_AREA !== '0';
    if (city && type !== 'all') continue;
    const region = city ? bisRegionName(r.TITLE_GRP) : '';
    if (city && !region) continue;
    const key = [iso3, type, region, r.FREQ, r.RE_VINTAGE, r.COMPILING_ORG, r.PRICED_UNIT, r.ADJUST_CODED].join('|');
    (series.get(key) || series.set(key, { iso3, type, region, unit: bisUnitLabel(r.UNIT_MEASURE, r.PRICED_UNIT), vintage: VINTAGE[r.RE_VINTAGE], points: [] }).get(key)).points.push({ period: r.TIME_PERIOD, value });
  }
  const best = new Map();
  for (const s of series.values()) {
    const annual = annualAverage(s.points);
    const id = `${s.iso3}|${s.type}|${s.region}`, current = best.get(id);
    const score = annual.length * 10000 + Number(annual.at(-1)?.period || 0);
    if (annual.length >= 5 && (!current || score > current.score)) best.set(id, { ...s, annual, score });
  }
  return [...best.values()].flatMap(s => s.annual.map(a => s.region
    ? { country: s.iso3, indicator: 'CITY_PRICE', region: s.region, dwelling_type: '', period: a.period, frequency: 'A', value: a.value, source: `BIS detailed residential property prices (${s.unit}${s.vintage ? `, ${s.vintage}` : ''})` }
    : { country: s.iso3, indicator: 'TYPE_PRICE_INDEX', dwelling_type: s.type, period: a.period, frequency: 'A', value: a.value, source: 'BIS detailed residential property prices' }));
}

export async function fetchBisDwellingTypes(iso2ToIso3) {
  const [types, cities] = await Promise.all([
    fetchText(`${BASE}/WS_DPP/..0.1+2+3+4+8?format=csv&startPeriod=1970`, { timeoutMs: 240_000 }),
    fetchText(`${BASE}/WS_DPP/...1?format=csv&startPeriod=1970`, { timeoutMs: 240_000 }),
  ]);
  // The second query repeats whole-country type-1 rows; parse once on the union, deduped by key.
  return parseBisDwellingTypes(types + '\n' + cities.split('\n').slice(1).join('\n'), iso2ToIso3);
}
