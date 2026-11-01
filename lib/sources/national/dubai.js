// Dubai (UAE): Dubai Real Estate Data (dubairealestatedata.com), built on Dubai Land Department
// open data via Dubai Pulse. Published under CC BY 4.0 for reuse with attribution; the site
// publishes markdown and JSON mirrors without sign-in for exactly this kind of use.
// Rows are regional (region 'Dubai'), because Dubai is one emirate, not the whole UAE.
import { annualAverage, fetchJson, fetchText } from '../util.js';

const BASE = 'https://www.dubairealestatedata.com';
export const DUBAI_ATTRIBUTION = 'Dubai Real Estate Data (dubairealestatedata.com), based on Dubai Land Department open data (CC BY 4.0)';

export const DUBAI_INDICATORS = [
  { key: 'SALES_COUNT', label: 'Registered residential sales', unit: 'transactions', source: 'National land registry', frequency: 'M' },
  { key: 'MEDIAN_PSF', label: 'Median price per square foot', unit: 'local currency per sq ft', source: 'National land registry', frequency: 'M' },
  { key: 'DLD_PRICE_INDEX', label: 'Dubai Land Department residential sales price index', unit: 'index', source: 'Dubai Land Department', frequency: 'Q' },
  { key: 'GROSS_YIELD', label: 'Gross rental yield', unit: '%', source: 'National land registry', frequency: 'A' },
];

const row = (indicator, period, frequency, value, extra = {}) => ({ country: 'ARE', region: 'Dubai', dwelling_type: '', indicator, period, frequency, value, source: DUBAI_ATTRIBUTION, ...extra });
const aed = s => Number(String(s).replace(/AED|,|\s/g, ''));

// "| 2025-10 | 19,419 | AED 1,688 | 1,378–2,223 |" → monthly sales and median AED/sqft.
export function parseMarketMd(md) {
  const out = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*(\d{4}-\d{2})\s*\|\s*([\d,]+)\s*\|\s*AED\s*([\d,]+)\s*\|/);
    if (!m) continue;
    out.push(row('SALES_COUNT', m[1], 'M', aed(m[2])), row('MEDIAN_PSF', m[1], 'M', aed(m[3])));
  }
  return out;
}

export function parseMarketJson(d) {
  const out = [];
  const idx = d?.dldPriceIndex;
  if (idx?.quarterStart && Number.isFinite(idx.value)) {
    const [y, m] = idx.quarterStart.split('-').map(Number);
    out.push(row('DLD_PRICE_INDEX', `${y}-Q${Math.ceil(m / 3)}`, 'Q', idx.value));
  }
  return out;
}

// Headline new-contract apartment rent (annual AED) → AVG_RENT per month; citywide gross yields.
export function parseRentsYields(rentsMd, yieldsMd) {
  const out = [];
  const rent = rentsMd.match(/Median annual rent, NEW apartment contracts:\s*AED\s*([\d,]+)\s*\(12M to (\d{1,2}) (\w{3}) (\d{4})/);
  if (rent) out.push(row('AVG_RENT', rent[4], 'A', aed(rent[1]) / 12, { dwelling_type: 'condo', source: `${DUBAI_ATTRIBUTION}; new Ejari apartment contracts, 12 months to ${rent[2]} ${rent[3]} ${rent[4]}` }));
  const year = rent?.[4];
  for (const [label, type] of [['villas', 'house'], ['apartments', 'condo']]) {
    const y = yieldsMd.match(new RegExp(`Citywide gross yield, ${label}:\\s*([\\d.]+)%`));
    if (y && year) out.push(row('GROSS_YIELD', year, 'A', Number(y[1]), { dwelling_type: type }));
  }
  return out;
}

export async function fetchDubai() {
  const [md, json, rents, yields] = await Promise.all([
    fetchText(`${BASE}/market.md`), fetchJson(`${BASE}/data/market.json`), fetchText(`${BASE}/rents.md`), fetchText(`${BASE}/yields.md`),
  ]);
  const monthly = parseMarketMd(md);
  const annual = [];
  for (const indicator of ['SALES_COUNT', 'MEDIAN_PSF']) {
    const pts = monthly.filter(r => r.indicator === indicator).map(r => ({ period: r.period, value: r.value }));
    // Sales are summed over complete years; the price per sqft is the mean of monthly medians.
    for (const a of annualAverage(pts)) annual.push(row(indicator, a.period, 'A', indicator === 'SALES_COUNT' ? a.value * 12 : a.value));
  }
  return [...monthly, ...annual, ...parseMarketJson(json), ...parseRentsYields(rents, yields)];
}
