// National housing agencies. Each adapter returns observation rows for its country,
// including city/regional rows (region != '') where the agency publishes them.
// International sources give comparability; these add local-currency levels,
// vacancy, construction and mortgage rates that BIS/OECD do not carry.
import { fetchCanada, CANADA_INDICATORS } from './canada.js';
import { fetchUnitedStates, US_INDICATORS } from './united-states.js';
import { fetchUnitedKingdom, UK_INDICATORS } from './united-kingdom.js';
import { fetchAustralia, AUSTRALIA_INDICATORS } from './australia.js';
import { fetchZillow, ZILLOW_INDICATORS } from './zillow.js';
import { fetchDubai, DUBAI_INDICATORS } from './dubai.js';
import { fetchFrance } from './france.js';
import { fetchSpain } from './spain.js';
import { fetchIreland } from './ireland.js';
import { fetchNetherlands } from './netherlands.js';
import { fetchSweden } from './sweden.js';
import { fetchNorway } from './norway.js';
import { fetchBrazil, BRAZIL_INDICATORS } from './brazil.js';
import { fetchUnitedStatesCities, US_CITY_INDICATORS } from './united-states-cities.js';

export const NATIONAL_ADAPTERS = [
  { iso3: 'CAN', agencies: 'CMHC via Statistics Canada, Bank of Canada', fetch: fetchCanada },
  { iso3: 'USA', agencies: 'Census Bureau, BLS, Freddie Mac, HUD via FRED', fetch: fetchUnitedStates },
  { iso3: 'USA', agencies: 'Zillow Research (condo vs single-family values, market rents)', fetch: fetchZillow },
  { iso3: 'USA', agencies: 'Metros: FHFA HPI, S&P CoreLogic Case-Shiller via FRED, Zillow Research', fetch: fetchUnitedStatesCities },
  { iso3: 'GBR', agencies: 'HM Land Registry UK House Price Index', fetch: fetchUnitedKingdom },
  { iso3: 'AUS', agencies: 'Australian Bureau of Statistics', fetch: fetchAustralia },
  { iso3: 'ARE', agencies: 'Dubai Real Estate Data, based on Dubai Land Department open data (CC BY 4.0)', fetch: fetchDubai },
  { iso3: 'FRA', agencies: 'INSEE (Licence Ouverte)', fetch: fetchFrance },
  { iso3: 'ESP', agencies: 'INE', fetch: fetchSpain },
  { iso3: 'IRL', agencies: 'CSO Ireland (CC BY 4.0)', fetch: fetchIreland },
  { iso3: 'NLD', agencies: 'CBS Statistics Netherlands (CC BY 4.0)', fetch: fetchNetherlands },
  { iso3: 'SWE', agencies: 'Statistics Sweden (CC0)', fetch: fetchSweden },
  { iso3: 'NOR', agencies: 'Statistics Norway (CC BY 4.0)', fetch: fetchNorway },
  { iso3: 'BRA', agencies: 'Banco Central do Brasil', fetch: fetchBrazil },
];

export const REGIONAL_INDICATORS = [
  { key: 'REGION_PRICE_INDEX', label: 'House price index, region or city', unit: 'index', source: 'National statistics office', frequency: 'Q' },
  { key: 'SALES_COUNT', label: 'Registered residential sales', unit: 'transactions', source: 'National land registry / statistics office', frequency: 'M' },
  { key: 'MEDIAN_PRICE', label: 'Median sales price', unit: 'local currency', source: 'National housing agency', frequency: 'M' },
  { key: 'AVG_PRICE', label: 'Average house price', unit: 'local currency', source: 'National housing agency', frequency: 'M' },
  { key: 'TYPE_PRICE_INDEX', label: 'Residential price index by dwelling type', unit: 'index', source: 'National statistics office', frequency: 'Q' },
];

export const NATIONAL_INDICATORS = [...CANADA_INDICATORS, ...US_INDICATORS, ...UK_INDICATORS, ...AUSTRALIA_INDICATORS, ...ZILLOW_INDICATORS, ...DUBAI_INDICATORS, ...BRAZIL_INDICATORS, ...US_CITY_INDICATORS, ...REGIONAL_INDICATORS]
  .filter((item, i, all) => all.findIndex(o => o.key === item.key) === i);

export async function fetchNational({ log = console.log } = {}) {
  const rows = [], failures = [];
  for (const adapter of NATIONAL_ADAPTERS) {
    try {
      const out = await adapter.fetch();
      for (const r of out) rows.push(r); // spread would overflow the call stack on large city panels
      log(`  national ${adapter.iso3}: ${out.length} rows (${adapter.agencies})`);
    } catch (error) {
      failures.push({ iso3: adapter.iso3, error: String(error.message || error) });
      log(`  national ${adapter.iso3}: FAILED ${error.message}`);
    }
  }
  return { rows, failures };
}
