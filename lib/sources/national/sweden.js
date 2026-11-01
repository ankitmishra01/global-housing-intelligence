// Sweden: Statistics Sweden (SCB) real estate price index for one- and two-dwelling buildings,
// quarterly, by region (table BO0501A/FastpiPSRegKv, 1981 = 100). SCB open data, CC0.
import { fetchText, normalisePeriod, withAnnual } from '../util.js';

export const SWEDEN_SOURCE = 'Statistics Sweden (SCB), real estate price index for one- and two-dwelling buildings (CC0)';
const URL = 'https://api.scb.se/OV0104/v1/doris/en/ssd/BO/BO0501/BO0501A/FastpiPSRegKv';
export const SWEDEN_REGIONS = { '00': '', '0010': 'Greater Stockholm', '0020': 'Greater Gothenburg', '0030': 'Greater Malmö', RIKS1: 'Stockholm county', RIKS2: 'Eastern Central Sweden', RIKS3: 'Småland with the islands', RIKS4: 'South Sweden', RIKS5: 'West Sweden', RIKS6: 'Northern Central Sweden', RIKS7: 'Central Norrland', RIKS8: 'Upper Norrland' };

export function parseScb(json) {
  const out = [];
  for (const row of json.data || []) {
    const [region, time] = row.key;
    const value = Number(row.values[0]);
    if (!(region in SWEDEN_REGIONS) || !Number.isFinite(value)) continue;
    // The national series is a house (one- and two-dwelling buildings) index.
    out.push({ country: 'SWE', indicator: region === '00' ? 'TYPE_PRICE_INDEX' : 'REGION_PRICE_INDEX', region: SWEDEN_REGIONS[region], dwelling_type: 'house', period: normalisePeriod(time), frequency: 'Q', value, source: SWEDEN_SOURCE });
  }
  return out;
}

export async function fetchSweden() {
  const body = JSON.stringify({ query: [{ code: 'Region', selection: { filter: 'item', values: Object.keys(SWEDEN_REGIONS) } }, { code: 'ContentsCode', selection: { filter: 'item', values: ['BO0501K2'] } }], response: { format: 'json' } });
  return withAnnual(parseScb(JSON.parse(await fetchText(URL, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }))));
}
