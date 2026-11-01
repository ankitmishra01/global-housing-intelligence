// National housing agencies. Each adapter returns observation rows for its country,
// including city/regional rows (region != '') where the agency publishes them.
// International sources give comparability; these add local-currency levels,
// vacancy, construction and mortgage rates that BIS/OECD do not carry.
import { fetchCanada, CANADA_INDICATORS } from './canada.js';
import { fetchUnitedStates, US_INDICATORS } from './united-states.js';
import { fetchUnitedKingdom, UK_INDICATORS } from './united-kingdom.js';
import { fetchAustralia, AUSTRALIA_INDICATORS } from './australia.js';
import { fetchZillow, ZILLOW_INDICATORS } from './zillow.js';

export const NATIONAL_ADAPTERS = [
  { iso3: 'CAN', agencies: 'CMHC via Statistics Canada, Bank of Canada', fetch: fetchCanada },
  { iso3: 'USA', agencies: 'Census Bureau, BLS, Freddie Mac, HUD via FRED', fetch: fetchUnitedStates },
  { iso3: 'USA', agencies: 'Zillow Research (condo vs single-family values, market rents)', fetch: fetchZillow },
  { iso3: 'GBR', agencies: 'HM Land Registry UK House Price Index', fetch: fetchUnitedKingdom },
  { iso3: 'AUS', agencies: 'Australian Bureau of Statistics', fetch: fetchAustralia },
];

export const NATIONAL_INDICATORS = [...CANADA_INDICATORS, ...US_INDICATORS, ...UK_INDICATORS, ...AUSTRALIA_INDICATORS, ...ZILLOW_INDICATORS]
  .filter((item, i, all) => all.findIndex(o => o.key === item.key) === i);

export async function fetchNational({ log = console.log } = {}) {
  const rows = [], failures = [];
  for (const adapter of NATIONAL_ADAPTERS) {
    try {
      const out = await adapter.fetch();
      rows.push(...out);
      log(`  national ${adapter.iso3}: ${out.length} rows (${adapter.agencies})`);
    } catch (error) {
      failures.push({ iso3: adapter.iso3, error: String(error.message || error) });
      log(`  national ${adapter.iso3}: FAILED ${error.message}`);
    }
  }
  return { rows, failures };
}
