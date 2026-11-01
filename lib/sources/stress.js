// Mortgage-stress inputs: OECD monthly harmonised unemployment, OECD average annual
// wages at constant prices, and BIS household debt service ratios.
import { annualAverage, csvObjects, fetchText, num } from './util.js';

const OECD = 'https://sdmx.oecd.org/public/rest/data';
const UNE_URL = `${OECD}/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/.UNE_LF_M.PT_LF_SUB._Z.Y._T.Y_GE15._Z.M?startPeriod=2000-01&format=csv`;
const WAGE_URL = `${OECD}/OECD.ELS.SAE,DSD_EARNINGS@AV_AN_WAGE,1.0/.WG..A.Q.MEAN._Z?startPeriod=1990&format=csv`;
const DSR_URL = 'https://stats.bis.org/api/v1/data/WS_DSR/Q..H?format=csv';

export const STRESS_INDICATORS = [
  { key: 'UNEMPLOYMENT_M', label: 'Unemployment rate (monthly, harmonised)', unit: '% of labour force', source: 'OECD harmonised unemployment', frequency: 'M' },
  { key: 'REAL_WAGE', label: 'Average annual wage, constant prices', unit: 'local currency, constant prices', source: 'OECD average annual wages', frequency: 'A' },
  { key: 'DSR_HH', label: 'Household debt service ratio', unit: '% of disposable income', source: 'BIS debt service ratios', frequency: 'Q' },
];

// Seasonally adjusted, total, 15+; aggregates (EA, EU, OECD, G7) are dropped by validIso3.
export function parseOecdUnemployment(text, validIso3) {
  const monthly = [];
  for (const r of csvObjects(text)) {
    const value = num(r.OBS_VALUE);
    if (!validIso3.has(r.REF_AREA) || !Number.isFinite(value) || !/^\d{4}-\d{2}$/.test(r.TIME_PERIOD)) continue;
    monthly.push({ country: r.REF_AREA, indicator: 'UNEMPLOYMENT_M', period: r.TIME_PERIOD, frequency: 'M', value, source: 'OECD harmonised unemployment' });
  }
  return monthly;
}

// PRICE_BASE Q = constant prices; V (current prices) and USD PPP rows are skipped.
export function parseOecdWages(text, validIso3) {
  const out = [];
  for (const r of csvObjects(text)) {
    const value = num(r.OBS_VALUE);
    if (!validIso3.has(r.REF_AREA) || r.MEASURE !== 'WG' || r.PRICE_BASE !== 'Q' || String(r.UNIT_MEASURE).startsWith('USD_PPP') || !Number.isFinite(value)) continue;
    out.push({ country: r.REF_AREA, indicator: 'REAL_WAGE', period: String(r.TIME_PERIOD), frequency: 'A', value, source: 'OECD average annual wages' });
  }
  return out;
}

export function parseBisDsr(text, iso2ToIso3) {
  const byCountry = new Map();
  for (const r of csvObjects(text)) {
    const iso3 = iso2ToIso3.get(r.BORROWERS_CTY);
    const value = num(r.OBS_VALUE);
    if (!iso3 || r.DSR_BORROWERS !== 'H' || !Number.isFinite(value)) continue;
    (byCountry.get(iso3) || byCountry.set(iso3, []).get(iso3)).push({ period: r.TIME_PERIOD, value });
  }
  const rows = [];
  for (const [iso3, list] of byCountry) {
    for (const p of list) rows.push({ country: iso3, indicator: 'DSR_HH', period: p.period, frequency: 'Q', value: p.value, source: 'BIS debt service ratios' });
    for (const a of annualAverage(list)) rows.push({ country: iso3, indicator: 'DSR_HH', period: a.period, frequency: 'A', value: a.value, source: 'BIS debt service ratios' });
  }
  return rows;
}

export async function fetchStress(validIso3, iso2ToIso3) {
  // The OECD API rejects bursts of parallel requests, so these run one after another;
  // a failed source is logged and skipped, and the coverage gates catch a real outage.
  const get = async (label, url) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await fetchText(url, { timeoutMs: 240_000 }); }
      catch (error) {
        if (attempt === 2) { console.log(`\n  ${label} failed: ${error.message}`); return ''; }
        await new Promise(r => setTimeout(r, 15_000 * (attempt + 1)));
      }
    }
  };
  const une = await get('OECD unemployment', UNE_URL);
  const wages = await get('OECD wages', WAGE_URL);
  const dsr = await get('BIS debt service', DSR_URL);
  const monthly = une ? parseOecdUnemployment(une, validIso3) : [];
  const byCountry = new Map();
  for (const m of monthly) (byCountry.get(m.country) || byCountry.set(m.country, []).get(m.country)).push(m);
  const annual = [...byCountry].flatMap(([iso3, list]) => annualAverage(list).map(a => ({ country: iso3, indicator: 'UNEMPLOYMENT_M', period: a.period, frequency: 'A', value: a.value, source: 'OECD harmonised unemployment' })));
  return [...monthly, ...annual, ...(wages ? parseOecdWages(wages, validIso3) : []), ...(dsr ? parseBisDsr(dsr, iso2ToIso3) : [])];
}
