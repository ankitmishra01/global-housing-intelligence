// Country registry: every World Bank economy (aggregates removed), keyed by ISO3,
// plus the ISO2 lookup the BIS and OECD adapters need.
import { fetchJson } from './sources/util.js';

// Euro area members and the year they joined; the BIS reports their policy rate as XM.
export const EURO_AREA = {
  AUT: 1999, BEL: 1999, DEU: 1999, ESP: 1999, FIN: 1999, FRA: 1999, IRL: 1999, ITA: 1999, LUX: 1999, NLD: 1999, PRT: 1999,
  GRC: 2001, SVN: 2007, CYP: 2008, MLT: 2008, SVK: 2009, EST: 2011, LVA: 2014, LTU: 2015, HRV: 2023,
};

export async function loadCountries() {
  const payload = await fetchJson('https://api.worldbank.org/v2/country?format=json&per_page=400');
  return countriesFromWorldBank(payload[1]);
}

export function countriesFromWorldBank(list) {
  return list
    .filter(c => c.region?.id && c.region.id !== 'NA' && /^[A-Z]{3}$/.test(c.id))
    .map(c => ({ iso3: c.id, iso2: c.iso2Code, name: c.name.trim(), region: c.region.value.trim(), incomeGroup: c.incomeLevel?.value?.trim() || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function iso2Map(countries) {
  return new Map(countries.map(c => [c.iso2, c.iso3]));
}
