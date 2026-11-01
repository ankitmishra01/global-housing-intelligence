// Spain: INE Índice de Precios de Vivienda (IPV), base 2025, table 80270, quarterly, national and by
// autonomous community, general / new / second-hand. INE reuse terms allow reuse with attribution.
import { fetchJson, withAnnual } from '../util.js';

export const SPAIN_SOURCE = 'INE, Índice de Precios de Vivienda (base 2025)';
const KIND = { General: '', 'Vivienda nueva': 'new_build', 'Vivienda segunda mano': 'existing' };
const QUARTER = { 19: 1, 20: 2, 21: 3, 22: 4 };

// Series names: "<Region>. <General|Vivienda nueva|Vivienda segunda mano>. Índice."
export function parseIneIpv(series) {
  const out = [];
  for (const s of series) {
    const parts = s.Nombre.split('.').map(p => p.trim()).filter(Boolean);
    if (parts.length < 3 || parts[2] !== 'Índice') continue;
    const kind = KIND[parts[1]];
    if (kind === undefined) continue;
    const national = parts[0] === 'Nacional';
    if (national && kind === '') continue; // national headline comes from the BIS
    for (const d of s.Data || []) {
      const q = QUARTER[d.FK_Periodo];
      if (!q || d.Valor == null) continue;
      out.push({ country: 'ESP', indicator: 'REGION_PRICE_INDEX', region: national ? '' : parts[0], dwelling_type: kind, period: `${d.Anyo}-Q${q}`, frequency: 'Q', value: Number(d.Valor), source: SPAIN_SOURCE });
    }
  }
  return out;
}

export async function fetchSpain() {
  return withAnnual(parseIneIpv(await fetchJson('https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/80270?nult=200', { timeoutMs: 180_000 })));
}
