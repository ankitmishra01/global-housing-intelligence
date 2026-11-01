// United States metros: FHFA House Price Index (all transactions, every MSA and metro division),
// S&P CoreLogic Case-Shiller 20-city indexes (via FRED) and Zillow Research metro values and
// rents for the largest 150 metros. Region names use the principal city ("New York", "Dallas"),
// with the state added where several metros share a city name ("Portland, OR").
import { annualAverage, csvObjects, fetchText, num, parseCsv } from '../util.js';

const FHFA_URL = 'https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.csv';
const FHFA_SOURCE = 'FHFA House Price Index, all-transactions, metro (public domain, US government)';
const CS_SOURCE = 'S&P CoreLogic Case-Shiller Home Price Index, seasonally adjusted, via FRED (Federal Reserve Bank of St. Louis)';
const ZILLOW_SOURCE = 'Zillow Research (ZHVI / ZORI), metro';
const ZILLOW = 'https://files.zillowstatic.com/research/public_csvs';
// Native-frequency rows are kept from these dates; annual averages keep the full history.
export const QUARTERLY_FROM = '2010-Q1';
export const MONTHLY_FROM = '2016-01';
export const ZILLOW_TOP = 150;

// Principal cities that name more than one metro in the FHFA list; these keep their state.
export const DUPLICATE_CITIES = new Set(['Midland', 'Florence', 'Columbus', 'Jackson', 'Lafayette', 'Monroe', 'Albany', 'Rochester', 'Longview', 'Greenville', 'Charleston', 'Decatur', 'Burlington', 'Columbia', 'Lewiston', 'Fayetteville', 'Bloomington', 'Lake County', 'Portland', 'Jacksonville', 'Springfield', 'Wilmington', 'Cleveland', 'Gainesville', 'Athens', 'Kingston', 'Auburn', 'Salem', 'Lancaster', 'Lebanon', 'Manchester', 'Dover', 'Hanford', 'Hammond', 'Kokomo']);

// "New York-Newark-Jersey City, NY-NJ (MSAD)" → "New York"; "Portland, OR" → "Portland, OR".
export function usMetroName(raw) {
  const text = String(raw || '').replace(/\s*\(MSAD\)\s*$/, '').trim();
  const [cities, states = ''] = text.split(/,\s*/);
  const city = cities.split('-')[0].trim();
  const state = states.split('-')[0].trim().slice(0, 2);
  return DUPLICATE_CITIES.has(city) && state ? `${city}, ${state}` : city;
}

const row = (indicator, region, period, frequency, value, source, dwelling_type = '') => ({ country: 'USA', indicator, region, dwelling_type, period, frequency, value, source });

// FHFA metro CSV has no header: name, CBSA, year, quarter, index, standard error.
export function parseFhfaMetro(csv) {
  const byRegion = new Map();
  for (const r of parseCsv(csv)) {
    const [name, , year, qtr, index] = r;
    const value = num(index);
    if (!name || !Number.isFinite(value) || !/^\d{4}$/.test(year)) continue;
    const region = usMetroName(name);
    (byRegion.get(region) || byRegion.set(region, []).get(region)).push({ period: `${year}-Q${qtr}`, value });
  }
  const out = [];
  for (const [region, points] of byRegion) {
    for (const p of points) if (p.period >= QUARTERLY_FROM) out.push(row('REGION_PRICE_INDEX', region, p.period, 'Q', p.value, FHFA_SOURCE));
    for (const a of annualAverage(points)) out.push(row('REGION_PRICE_INDEX', region, a.period, 'A', a.value, FHFA_SOURCE));
  }
  return out;
}

export const CASE_SHILLER = {
  NYXRSA: 'New York', LXXRSA: 'Los Angeles', SFXRSA: 'San Francisco', CHXRSA: 'Chicago', BOXRSA: 'Boston', MIXRSA: 'Miami', SEXRSA: 'Seattle',
  DAXRSA: 'Dallas', DNXRSA: 'Denver', WDXRSA: 'Washington', ATXRSA: 'Atlanta', PHXRSA: 'Phoenix', LVXRSA: 'Las Vegas', SDXRSA: 'San Diego',
  POXRSA: 'Portland, OR', MNXRSA: 'Minneapolis', TPXRSA: 'Tampa', DEXRSA: 'Detroit', CEXRSA: 'Cleveland, OH', CRXRSA: 'Charlotte',
};

export function parseCaseShiller(csv, id) {
  const region = CASE_SHILLER[id];
  const points = csvObjects(csv).map(r => ({ period: (r.observation_date || r.DATE || '').slice(0, 7), value: num(r[id]) })).filter(p => /^\d{4}-\d{2}$/.test(p.period) && Number.isFinite(p.value));
  return [
    ...points.filter(p => p.period >= MONTHLY_FROM).map(p => row('CASE_SHILLER_INDEX', region, p.period, 'M', p.value, CS_SOURCE)),
    ...annualAverage(points).map(a => row('CASE_SHILLER_INDEX', region, a.period, 'A', a.value, CS_SOURCE)),
  ];
}

// Zillow metro CSV: RegionID, SizeRank, RegionName, RegionType, StateName, then month-end columns.
// Keeps the largest `top` metros (SizeRank 1..top; rank 0 is the national row).
export function parseZillowMetros(csv, { indicator, dwelling_type = '', top = ZILLOW_TOP }) {
  const [header, ...rows] = parseCsv(csv);
  const idx = name => header.indexOf(name);
  const dates = header.map((h, i) => [h, i]).filter(([h]) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  const out = [];
  for (const r of rows) {
    const rank = num(r[idx('SizeRank')]);
    if (r[idx('RegionType')] !== 'msa' || !Number.isFinite(rank) || rank < 1 || rank > top) continue;
    const region = usMetroName(r[idx('RegionName')]);
    const points = dates.map(([h, i]) => ({ period: h.slice(0, 7), value: r[i] === '' ? NaN : num(r[i]) })).filter(p => Number.isFinite(p.value));
    for (const p of points) if (p.period >= MONTHLY_FROM) out.push(row(indicator, region, p.period, 'M', p.value, ZILLOW_SOURCE, dwelling_type));
    for (const a of annualAverage(points)) out.push(row(indicator, region, a.period, 'A', a.value, ZILLOW_SOURCE, dwelling_type));
  }
  return out;
}

export const US_CITY_INDICATORS = [
  { key: 'CASE_SHILLER_INDEX', label: 'S&P CoreLogic Case-Shiller home price index', unit: 'index, Jan 2000 = 100', source: 'S&P CoreLogic via FRED', frequency: 'M' },
];

export async function fetchUnitedStatesCities({ log = () => {} } = {}) {
  const rows = [];
  try { rows.push(...parseFhfaMetro(await fetchText(FHFA_URL, { timeoutMs: 180_000 }))); } catch (e) { log(`  USA FHFA metro failed: ${e.message}`); }
  for (const id of Object.keys(CASE_SHILLER)) {
    try { rows.push(...parseCaseShiller(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`), id)); } catch (e) { log(`  USA Case-Shiller ${id} failed: ${e.message}`); }
  }
  const zillow = [
    [`${ZILLOW}/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`, { indicator: 'AVG_PRICE' }],
    [`${ZILLOW}/zhvi/Metro_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv`, { indicator: 'TYPE_PRICE_LEVEL', dwelling_type: 'house' }],
    [`${ZILLOW}/zhvi/Metro_zhvi_uc_condo_tier_0.33_0.67_sm_sa_month.csv`, { indicator: 'TYPE_PRICE_LEVEL', dwelling_type: 'condo' }],
    [`${ZILLOW}/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv`, { indicator: 'AVG_RENT' }],
  ];
  for (const [url, opts] of zillow) {
    try { rows.push(...parseZillowMetros(await fetchText(url, { timeoutMs: 180_000 }), opts)); } catch (e) { log(`  USA Zillow ${opts.indicator} failed: ${e.message}`); }
  }
  return rows;
}
