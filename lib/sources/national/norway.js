// Norway: Statistics Norway (SSB) table 07221, price index for existing dwellings by region and
// dwelling type, quarterly. SSB open data, CC BY 4.0.
import { fetchText, jsonStatRows, normalisePeriod, withAnnual } from '../util.js';

export const NORWAY_SOURCE = 'Statistics Norway (SSB), price index for existing dwellings, table 07221 (CC BY 4.0)';
const TYPE = { '00': '', '01': 'detached', '02': 'townhouse', '03': 'condo' };

export function parseSsb(d) {
  const out = [];
  for (const r of jsonStatRows(d)) {
    // SSB publishes 0 where a region/type series has not started yet; those are not observations.
    if (r.ContentsCode !== 'Boligindeks' || !(r.value > 0)) continue;
    const type = TYPE[r.Boligtype];
    if (type === undefined) continue;
    const national = r.Region === 'TOTAL';
    if (national && type === '') continue; // national headline comes from the BIS
    out.push({ country: 'NOR', indicator: national ? 'TYPE_PRICE_INDEX' : 'REGION_PRICE_INDEX', region: national ? '' : r.label.Region, dwelling_type: type, period: normalisePeriod(r.Tid), frequency: 'Q', value: r.value, source: NORWAY_SOURCE });
  }
  return out;
}

export async function fetchNorway() {
  // Unlisted variables collapse to their total, so region and dwelling type are selected explicitly.
  const body = JSON.stringify({ query: [
    { code: 'Region', selection: { filter: 'all', values: ['*'] } },
    { code: 'Boligtype', selection: { filter: 'item', values: Object.keys(TYPE) } },
    { code: 'ContentsCode', selection: { filter: 'item', values: ['Boligindeks'] } },
  ], response: { format: 'json-stat2' } });
  return withAnnual(parseSsb(JSON.parse(await fetchText('https://data.ssb.no/api/v0/en/table/07221', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }))));
}
