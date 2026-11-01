// Brazil: Banco Central do Brasil SGS series 21340, IVG-R (residential real estate collateral value
// index), monthly, March 2001 = 100. BCB open data.
import { fetchJson, withAnnual } from '../util.js';

export const BRAZIL_SOURCE = 'Banco Central do Brasil, IVG-R residential collateral value index (SGS 21340)';

export const BRAZIL_INDICATORS = [
  { key: 'NATIONAL_PRICE_INDEX', label: 'House price index (national source)', unit: 'index', source: 'National statistics office / central bank', frequency: 'M' },
];

// [{ data: "01/08/2026", valor: "796.75" }]
export function parseSgs(rows) {
  return rows.map(r => {
    const [, mm, yyyy] = String(r.data).split('/');
    return { country: 'BRA', indicator: 'NATIONAL_PRICE_INDEX', region: '', dwelling_type: '', period: `${yyyy}-${mm}`, frequency: 'M', value: Number(r.valor), source: BRAZIL_SOURCE };
  }).filter(r => /^\d{4}-\d{2}$/.test(r.period) && Number.isFinite(r.value));
}

export async function fetchBrazil() {
  return withAnnual(parseSgs(await fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.21340/dados?formato=json&dataInicial=01/01/2001')));
}
