// Mortgage rates from central banks, replacing the "policy rate + 2pp" proxy where available.
//  - ECB MFI interest rate statistics (MIR): new-business loans to households for house purchase,
//    annualised agreed rate, by euro-area member (and Bulgaria). ECB Data Portal, free reuse with attribution.
//  - Bank of England: quoted 2-year fixed mortgage rate, 75% LTV (IUMBV34). Open Government Licence.
// The RBA (F5) and RBNZ (B20) tables refuse automated requests (HTTP 403), so Australia and
// New Zealand keep the proxy; Canada (Bank of Canada) and the US (Freddie Mac) come from their adapters.
import { csvObjects, fetchText, num, withAnnual } from './util.js';

export const ECB_SOURCE = 'ECB MFI interest rate statistics, new loans to households for house purchase (annualised agreed rate)';
export const BOE_SOURCE = 'Bank of England, quoted 2-year fixed mortgage rate, 75% LTV (IUMBV34)';

export const MORTGAGE_INDICATORS = [
  { key: 'MORTGAGE_RATE', label: 'Mortgage rate', unit: '%', source: 'National central bank / agency', frequency: 'M' },
];

export function parseEcbMir(csv, iso2ToIso3) {
  const out = [];
  for (const r of csvObjects(csv)) {
    const iso3 = iso2ToIso3.get(r.REF_AREA);
    const value = num(r.OBS_VALUE);
    if (!iso3 || !Number.isFinite(value) || !/^\d{4}-\d{2}$/.test(r.TIME_PERIOD)) continue;
    out.push({ country: iso3, indicator: 'MORTGAGE_RATE', region: '', period: r.TIME_PERIOD, frequency: 'M', value, source: ECB_SOURCE });
  }
  return out;
}

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
// "31 Jan 2024,4.71" → 2024-01
export function parseBoe(csv, series = 'IUMBV34') {
  const out = [];
  for (const r of csvObjects(csv)) {
    const m = String(r.DATE || '').match(/^\d{1,2} (\w{3}) (\d{4})$/);
    const value = num(r[series]);
    if (!m || !MONTHS[m[1]] || !Number.isFinite(value)) continue;
    out.push({ country: 'GBR', indicator: 'MORTGAGE_RATE', region: '', period: `${m[2]}-${MONTHS[m[1]]}`, frequency: 'M', value, source: BOE_SOURCE });
  }
  return out;
}

export async function fetchMortgageRates(iso2ToIso3, { log = () => {} } = {}) {
  const rows = [];
  try {
    rows.push(...parseEcbMir(await fetchText('https://data-api.ecb.europa.eu/service/data/MIR/M..B.A2C.A.R.A.2250.EUR.N?format=csvdata&detail=dataonly&startPeriod=2003-01', { retries: 4, backoffMs: 10_000 }), iso2ToIso3));
  } catch (error) { log(`  ECB MIR failed: ${error.message}`); }
  try {
    rows.push(...parseBoe(await fetchText('https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/1995&Dateto=now&SeriesCodes=IUMBV34&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N', { retries: 4, backoffMs: 10_000})));
  } catch (error) { log(`  Bank of England failed: ${error.message}`); }
  return withAnnual(rows);
}
