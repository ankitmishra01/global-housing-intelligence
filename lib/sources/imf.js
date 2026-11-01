// IMF World Economic Outlook via the DataMapper API: history plus forecasts ~5 years out.
// Years from the current calendar year onward are WEO projections and are stored as status 'forecast'.
import { fetchJson } from './util.js';

const SOURCE = 'IMF World Economic Outlook';
const SERIES = { INFLATION: 'PCPIPCH', GDP_GROWTH: 'NGDP_RPCH' };

export const IMF_INDICATORS = [
  { key: 'INFLATION', label: 'Consumer price inflation', unit: '% per year', source: SOURCE, frequency: 'A' },
  { key: 'GDP_GROWTH', label: 'Real GDP growth', unit: '% per year', source: SOURCE, frequency: 'A' },
];

export function parseImf(payload, code, indicator, validIso3, currentYear = new Date().getUTCFullYear()) {
  const rows = [];
  for (const [iso3, series] of Object.entries(payload?.values?.[code] || {})) {
    if (!validIso3.has(iso3)) continue;
    for (const [year, value] of Object.entries(series)) {
      if (value == null || !Number.isFinite(Number(value))) continue;
      rows.push({ country: iso3, indicator, period: year, frequency: 'A', value: Number(value), status: Number(year) >= currentYear ? 'forecast' : 'actual', source: SOURCE });
    }
  }
  return rows;
}

export async function fetchImf(validIso3) {
  const out = [];
  for (const [indicator, code] of Object.entries(SERIES)) {
    out.push(...parseImf(await fetchJson(`https://www.imf.org/external/datamapper/api/v1/${code}`), code, indicator, validIso3));
  }
  return out;
}
