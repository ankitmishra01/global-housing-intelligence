// Netherlands: CBS StatLine (OData). 85773NED existing owner-occupied dwellings, monthly price index,
// number sold and average price; 85792NED the same by province and the four largest cities
// (quarterly). CBS open data are published under CC BY 4.0.
import { fetchJson, normalisePeriod, withAnnual } from '../util.js';

export const NETHERLANDS_SOURCE = 'CBS (Statistics Netherlands), existing owner-occupied dwellings (CC BY 4.0)';
const ODATA = (table, query) => `https://opendata.cbs.nl/ODataApi/odata/${table}/TypedDataSet?${query}`;

export function parseCbsNational(rows) {
  const out = [];
  for (const r of rows) {
    if (!/MM\d{2}$/.test(r.Perioden)) continue;
    const period = normalisePeriod(r.Perioden), base = { country: 'NLD', region: '', dwelling_type: '', period, frequency: 'M', source: NETHERLANDS_SOURCE };
    if (Number.isFinite(r.VerkochteWoningen_4)) out.push({ ...base, indicator: 'SALES_COUNT', value: r.VerkochteWoningen_4 });
    if (Number.isFinite(r.GemiddeldeVerkoopprijs_7)) out.push({ ...base, indicator: 'AVG_PRICE', value: r.GemiddeldeVerkoopprijs_7 });
  }
  return out;
}

// regions: { key: title } for provinces (PV) and G4 cities (GM); quarterly rows only.
export function parseCbsRegional(rows, regions) {
  const out = [];
  for (const r of rows) {
    const region = regions[r.RegioS?.trim()];
    if (!region || !/KW0\d$/.test(r.Perioden)) continue;
    const period = normalisePeriod(r.Perioden), base = { country: 'NLD', region, dwelling_type: '', period, frequency: 'Q', source: NETHERLANDS_SOURCE };
    if (Number.isFinite(r.PrijsindexVerkoopprijzen_1)) out.push({ ...base, indicator: 'REGION_PRICE_INDEX', value: r.PrijsindexVerkoopprijzen_1 });
    if (Number.isFinite(r.GemiddeldeVerkoopprijs_7)) out.push({ ...base, indicator: 'AVG_PRICE', value: r.GemiddeldeVerkoopprijs_7 });
    if (Number.isFinite(r.VerkochteWoningen_4)) out.push({ ...base, indicator: 'SALES_COUNT', value: r.VerkochteWoningen_4 });
  }
  return out;
}

export async function fetchNetherlands() {
  const national = (await fetchJson(ODATA('85773NED', '$format=json'))).value;
  const regionList = (await fetchJson('https://opendata.cbs.nl/ODataApi/odata/85792NED/RegioS?$format=json')).value;
  const regions = Object.fromEntries(regionList.filter(x => /^(PV|GM)/.test(x.Key.trim())).map(x => [x.Key.trim(), x.Title.replace(/\s*\((PV|gemeente)\)\s*$/, '').trim()]));
  const regional = [];
  for (const key of Object.keys(regions)) {
    const filter = encodeURIComponent(`RegioS eq '${key.padEnd(6)}'`);
    regional.push(...(await fetchJson(ODATA('85792NED', `$format=json&$filter=${filter}`))).value);
  }
  return withAnnual([...parseCbsNational(national), ...parseCbsRegional(regional, regions)]);
}
