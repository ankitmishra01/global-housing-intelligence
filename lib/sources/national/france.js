// France: INSEE indices des prix des logements anciens (BDM, dataflow IPLA-IPLNA-2015), quarterly,
// base 2015 = 100, raw (non seasonally adjusted) series. Licence Ouverte / Etalab 2.0.
// National apartments/houses go to TYPE_PRICE_INDEX; départements, Paris and agglomerations to
// REGION_PRICE_INDEX with dwelling type.
import { fetchText, withAnnual } from '../util.js';

export const FRANCE_SOURCE = 'INSEE, indices des prix des logements anciens (Licence Ouverte)';
const TYPES = { Appartements: 'condo', Maisons: 'house', Ensemble: '' };
const NATIONAL = /^(France métropolitaine|France \(hors Mayotte\)|France)$/;

// Title: "Indice des prix des logements anciens - <zone> - <type> - Base 100 ... - Série brute"
export function parseInseeIpla(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Series ([^>]*)>([\s\S]*?)<\/Series>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    if (attrs.CORRECTION !== 'BRUT' || attrs.NATURE !== 'INDICE') continue;
    const parts = (attrs.TITLE_FR || '').split(' - ').map(s => s.trim());
    if (parts.length < 4) continue;
    const zone = parts[1].replace(/^Île-de-France\s*:\s*/, '').replace(/^Agglomération de\s+/, '');
    const type = TYPES[parts[2]];
    if (type === undefined) continue;
    const national = NATIONAL.test(zone);
    if (national && type === '') continue; // the national headline comes from the BIS
    for (const o of m[2].matchAll(/<Obs TIME_PERIOD="(\d{4}-Q\d)" OBS_VALUE="([\d.]+)"/g)) {
      out.push({ country: 'FRA', indicator: national ? 'TYPE_PRICE_INDEX' : 'REGION_PRICE_INDEX', region: national ? '' : zone, dwelling_type: type, period: o[1], frequency: 'Q', value: Number(o[2]), source: FRANCE_SOURCE });
    }
  }
  return out;
}

export async function fetchFrance() {
  return withAnnual(parseInseeIpla(await fetchText('https://bdm.insee.fr/series/sdmx/data/IPLA-IPLNA-2015?startPeriod=1996-Q1', { timeoutMs: 180_000 })));
}
