// Household income for affordability ratios.
//  1. National median income where an open API exists: Statistics Canada table 11-10-0190
//     (median total income, economic families and persons not in an economic family, 2024
//     constant dollars; Open Government Licence – Canada). The US Census median comes from FRED
//     in the US adapter. The ONS and ABS medians are only published as spreadsheets/releases
//     without an open API, so the UK and Australia use the OECD figure below.
//  2. OECD national accounts: net disposable income of households and NPISH (B6N, sector S1M,
//     current prices, national currency) ÷ population (World Bank) × average household size.
//     This is a MEAN, not a median, and includes NPISH; the basis string says so.
import { csvObjects, fetchJson, fetchText, num } from './util.js';

export const STATCAN_INCOME_SOURCE = 'Statistics Canada table 11-10-0190, median total income of economic families and persons not in an economic family (2024 constant dollars)';
export const OECD_INCOME_SOURCE = 'OECD national accounts (households and NPISH net disposable income) ÷ World Bank population × average household size';

export const INCOME_INDICATORS = [
  { key: 'MEDIAN_HH_INCOME', label: 'Median household income', unit: 'local currency per year', source: 'National statistics office', frequency: 'A' },
  { key: 'HH_INCOME_OECD', label: 'Mean disposable income per household (national accounts)', unit: 'local currency per year', source: OECD_INCOME_SOURCE, frequency: 'A' },
];

// Approximate average household size (persons per household), UN DESA Database on Household
// Size and Composition, latest available year per country. Used only to turn per-capita
// national-accounts income into a per-household figure.
export const HOUSEHOLD_SIZE = {
  AUS: 2.5, AUT: 2.2, BEL: 2.3, BGR: 2.4, BRA: 3.0, CAN: 2.4, CHE: 2.2, CHL: 3.1, CHN: 2.6, COL: 3.1, CRI: 3.2, CZE: 2.4,
  DEU: 2.0, DNK: 2.0, ESP: 2.5, EST: 2.2, FIN: 2.0, FRA: 2.2, GBR: 2.4, GRC: 2.5, HRV: 2.7, HUN: 2.3, IRL: 2.7, ISL: 2.4,
  ISR: 3.1, ITA: 2.3, JPN: 2.3, KOR: 2.3, LTU: 2.2, LUX: 2.4, LVA: 2.3, MEX: 3.5, NLD: 2.1, NOR: 2.1, NZL: 2.6, POL: 2.6,
  PRT: 2.5, ROU: 2.6, RUS: 2.5, SVK: 2.8, SVN: 2.4, SWE: 2.0, TUR: 3.2, USA: 2.5, ZAF: 3.3,
};

export function parseStatCanVector(json, { country = 'CAN', indicator = 'MEDIAN_HH_INCOME', source = STATCAN_INCOME_SOURCE } = {}) {
  const points = json?.[0]?.object?.vectorDataPoint || [];
  return points.filter(p => Number.isFinite(Number(p.value))).map(p => ({ country, indicator, region: '', period: String(p.refPer).slice(0, 4), frequency: 'A', value: Number(p.value), source }));
}

// csv: OECD DF_TABLE13_BAL rows (REF_AREA, TIME_PERIOD, OBS_VALUE, UNIT_MULT); population: { ISO3: { year: pop } }
export function parseOecdHouseholdIncome(csv, population, validIso3) {
  const out = [];
  for (const r of csvObjects(csv)) {
    const iso3 = r.REF_AREA, size = HOUSEHOLD_SIZE[iso3];
    const total = num(r.OBS_VALUE) * 10 ** (num(r.UNIT_MULT) || 0);
    const pop = population[iso3]?.[r.TIME_PERIOD];
    if (!validIso3.has(iso3) || !size || !Number.isFinite(total) || !Number.isFinite(pop) || pop <= 0) continue;
    out.push({ country: iso3, indicator: 'HH_INCOME_OECD', region: '', period: String(r.TIME_PERIOD), frequency: 'A', value: (total / pop) * size, source: `${OECD_INCOME_SOURCE} (${size} persons)` });
  }
  return out;
}

export function parseWorldBankPopulation(payload) {
  const out = {};
  for (const r of payload?.[1] || []) if (r.value != null) (out[r.countryiso3code] ||= {})[r.date] = Number(r.value);
  return out;
}

export async function fetchIncome(validIso3, { log = () => {} } = {}) {
  const rows = [];
  try {
    const json = await fetchJson('https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ vectorId: 96411931, latestN: 60 }]),
    });
    rows.push(...parseStatCanVector(json));
  } catch (error) { log(`  Statistics Canada income failed: ${error.message}`); }
  try {
    const pop = parseWorldBankPopulation(await fetchJson('https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=20000&date=2000:2030'));
    const csv = await fetchText('https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NASEC10@DF_TABLE13_BAL,1.1/A..S1M.S1.B.B6N._Z._Z.XDC.S.V.N.?startPeriod=2005&format=csv', { timeoutMs: 240_000, retries: 5, backoffMs: 15_000 });
    rows.push(...parseOecdHouseholdIncome(csv, pop, validIso3));
  } catch (error) { log(`  OECD household income failed: ${error.message}`); }
  return rows;
}
