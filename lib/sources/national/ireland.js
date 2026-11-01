// Ireland: CSO PxStat. HPM09 Residential Property Price Index (monthly, national/Dublin/regions by
// type) and HPM05 market-based household purchases (monthly volume of sales and median price).
// CSO data are published under CC BY 4.0.
import { fetchJson, jsonStatRows, normalisePeriod, withAnnual } from '../util.js';

export const IRELAND_RPPI_SOURCE = 'CSO Ireland, Residential Property Price Index (CC BY 4.0)';
export const IRELAND_SALES_SOURCE = 'CSO Ireland, market-based household purchases of residential dwellings (CC BY 4.0)';
const API = id => `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/${id}/JSON-stat/2.0/en`;
const TYPE = { houses: 'house', apartments: 'condo', 'all residential properties': '' };

// Region labels: "National - houses", "Dublin City - houses", "Border - all residential properties"
export function parseHpm09(d) {
  const statDim = d.id.find(x => x === 'STATISTIC'), timeDim = d.id.find(x => x.startsWith('TLIST')), regDim = d.id.find(x => x !== statDim && x !== timeDim);
  const out = [];
  for (const r of jsonStatRows(d)) {
    if (r[statDim] !== 'HPM09C01') continue;
    const [place, typeLabel] = String(r.label[regDim]).split(/\s+-\s+/);
    const type = TYPE[(typeLabel || '').trim().toLowerCase()];
    if (type === undefined) continue;
    const national = place.trim() === 'National';
    if (national && type === '') continue; // national headline comes from the BIS
    out.push({ country: 'IRL', indicator: national ? 'TYPE_PRICE_INDEX' : 'REGION_PRICE_INDEX', region: national ? '' : place.trim(), dwelling_type: type, period: normalisePeriod(r[timeDim]), frequency: 'M', value: r.value, source: IRELAND_RPPI_SOURCE });
  }
  return out;
}

// Volume of sales and median price, all dwelling types and statuses, executions (completed sales).
export function parseHpm05(d) {
  const timeDim = d.id.find(x => x.startsWith('TLIST'));
  const others = d.id.filter(x => x !== 'STATISTIC' && x !== timeDim);
  const out = [];
  for (const r of jsonStatRows(d)) {
    const ok = others.every(dim => {
      const label = String(r.label[dim]);
      return /^All\b/i.test(label) || label === 'Executions';
    });
    if (!ok) continue;
    const label = r.label.STATISTIC;
    const indicator = label === 'Volume of Sales' ? 'SALES_COUNT' : label === 'Median Price' ? 'MEDIAN_PRICE' : null;
    if (!indicator) continue;
    out.push({ country: 'IRL', indicator, region: '', dwelling_type: '', period: normalisePeriod(r[timeDim]), frequency: 'M', value: r.value, source: IRELAND_SALES_SOURCE });
  }
  return out;
}

export async function fetchIreland() {
  const rppi = parseHpm09(await fetchJson(API('HPM09'), { timeoutMs: 180_000 }));
  const sales = parseHpm05(await fetchJson(API('HPM05'), { timeoutMs: 180_000 }));
  // The latest two months of registrations are still being filed; leave them out of volumes.
  const months = [...new Set(sales.map(r => r.period))].sort();
  const settled = new Set(months.slice(0, -2));
  return withAnnual([...rppi, ...sales.filter(r => r.indicator !== 'SALES_COUNT' || settled.has(r.period))]);
}
