// United Kingdom: HM Land Registry UK House Price Index, average price (GBP) for the UK
// and the four nations.
import { annualAverage, csvObjects, fetchText, num } from '../util.js';

const REGIONS = { 'united-kingdom': '', england: 'England', scotland: 'Scotland', wales: 'Wales', 'northern-ireland': 'Northern Ireland' };
const SOURCE = 'HM Land Registry UK House Price Index';

export const UK_INDICATORS = [
  { key: 'TYPE_PRICE_LEVEL', label: 'Average price by dwelling type', unit: 'local currency', source: 'National housing agency', frequency: 'M' },
  { key: 'AVG_PRICE', label: 'Average house price', unit: 'local currency', source: 'National housing agency', frequency: 'M' },
];

// Land Registry column -> dwelling type ('' is all property types).
const TYPES = { 'Average price All property types': '', 'Average price Detached houses': 'detached', 'Average price Semi-detached houses': 'semi_detached', 'Average price Terraced houses': 'townhouse', 'Average price Flats and maisonettes': 'condo' };

// Land Registry sales volumes for the latest months are incomplete (registration lag), so the
// newest SALES_LAG_MONTHS are dropped rather than read as a slump.
export const SALES_LAG_MONTHS = 3;

export function parseUkHpi(csv, region) {
  const out = [];
  for (const r of csvObjects(csv)) {
    if (!/^\d{4}-\d{2}$/.test(r.Period)) continue;
    const volume = num(r['Sales volume']);
    if (Number.isFinite(volume)) out.push({ country: 'GBR', indicator: 'SALES_COUNT', region, dwelling_type: '', period: r.Period, frequency: 'M', value: volume, source: `${SOURCE}, sales volume` });
    for (const [column, type] of Object.entries(TYPES)) {
      const value = num(r[column]);
      if (Number.isFinite(value)) out.push({ country: 'GBR', indicator: type ? 'TYPE_PRICE_LEVEL' : 'AVG_PRICE', region, dwelling_type: type, period: r.Period, frequency: 'M', value, source: SOURCE });
    }
  }
  return out;
}

export async function fetchUnitedKingdom() {
  const rows = [];
  for (const [slug, region] of Object.entries(REGIONS)) {
    const location = encodeURIComponent(`http://landregistry.data.gov.uk/id/region/${slug}`);
    const csv = await fetchText(`https://landregistry.data.gov.uk/app/ukhpi/download/new.csv?from=1995-01-01&location=${location}&thm%5B%5D=property_type&in%5B%5D=avg`);
    const parsed = parseUkHpi(csv, region);
    const salesMonths = [...new Set(parsed.filter(r => r.indicator === 'SALES_COUNT').map(r => r.period))].sort();
    const settled = new Set(salesMonths.slice(0, -SALES_LAG_MONTHS));
    const sales = parsed.filter(r => r.indicator === 'SALES_COUNT' && settled.has(r.period));
    const monthly = parsed.filter(r => r.indicator !== 'SALES_COUNT');
    rows.push(...monthly, ...sales);
    rows.push(...annualAverage(sales).map(a => ({ ...sales[0], period: a.period, frequency: 'A', value: a.value * 12 })));
    for (const type of Object.values(TYPES)) {
      const series = monthly.filter(r => r.dwelling_type === type);
      rows.push(...annualAverage(series).map(a => ({ ...series[0], period: a.period, frequency: 'A', value: a.value })));
    }
  }
  return rows;
}
