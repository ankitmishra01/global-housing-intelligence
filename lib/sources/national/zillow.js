// United States by dwelling type: Zillow Research ZHVI (typical home value, condo/co-op vs
// single-family) and ZORI (typical observed market rent), national rows. Free public CSVs,
// attributed to Zillow Research on every page that shows them.
import { annualAverage, parseCsv, fetchText } from '../util.js';

const BASE = 'https://files.zillowstatic.com/research/public_csvs';
const SOURCE = 'Zillow Research (ZHVI / ZORI)';
const FILES = {
  condo: `${BASE}/zhvi/Metro_zhvi_uc_condo_tier_0.33_0.67_sm_sa_month.csv`,
  house: `${BASE}/zhvi/Metro_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv`,
  rent: `${BASE}/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv`,
};

export const ZILLOW_INDICATORS = [
  { key: 'AVG_RENT', label: 'Typical market rent', unit: 'local currency per month', source: 'National housing agency / research', frequency: 'M' },
];

// National row only (RegionType 'country'); columns after the metadata are month-end dates.
export function parseZillowNational(csv) {
  const [header, ...rows] = parseCsv(csv);
  const national = rows.find(r => r[header.indexOf('RegionType')] === 'country');
  if (!national) return [];
  return header.map((h, i) => ({ h, v: Number(national[i]) }))
    .filter(({ h, v }) => /^\d{4}-\d{2}-\d{2}$/.test(h) && national[header.indexOf(h)] !== '' && Number.isFinite(v))
    .map(({ h, v }) => ({ period: h.slice(0, 7), value: v }));
}

export async function fetchZillow() {
  const rows = [];
  for (const [kind, url] of Object.entries(FILES)) {
    const monthly = parseZillowNational(await fetchText(url, { timeoutMs: 180_000 }));
    const base = kind === 'rent' ? { indicator: 'AVG_RENT', dwelling_type: '' } : { indicator: 'TYPE_PRICE_LEVEL', dwelling_type: kind };
    for (const p of monthly) rows.push({ country: 'USA', region: '', ...base, period: p.period, frequency: 'M', value: p.value, source: SOURCE });
    for (const a of annualAverage(monthly)) rows.push({ country: 'USA', region: '', ...base, period: a.period, frequency: 'A', value: a.value, source: SOURCE });
  }
  return rows;
}
