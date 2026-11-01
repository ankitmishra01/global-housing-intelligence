// Rule-based housing risk flags. Thresholds are published on the methodology page.
import { finite } from './stats.js';
import { lastYear, logGrowth } from './panel.js';

export const FLAG_RULES = {
  PTI_HIGH: { label: 'Price-to-income more than 20% above its long-run average', threshold: 20 },
  PTR_HIGH: { label: 'Price-to-rent more than 20% above its long-run average', threshold: 20 },
  PRICES_HOT: { label: 'Real house prices up more than 10% in a year', threshold: 10 },
  CREDIT_GAP: { label: 'Credit-to-GDP gap above 10 percentage points', threshold: 10 },
  RENT_OUTPACING: { label: 'Real rents outgrew real GDP per head three years running', threshold: 0 },
};

// Latest year-on-year change in a quarterly index (2026-Q2 vs 2025-Q2).
export function quarterlyYoY(series) {
  const keys = Object.keys(series || {}).sort();
  const last = keys.at(-1);
  if (!last) return null;
  const prev = `${Number(last.slice(0, 4)) - 1}${last.slice(4)}`;
  return finite(series[prev]) ? { period: last, value: 100 * (series[last] / series[prev] - 1) } : null;
}

export function computeFlags(iso3, c, monthly = {}) {
  const flags = [];
  const latest = key => { const y = lastYear(c[key]); return y ? { year: y, value: c[key][y] } : null; };
  const push = (flag, value, asOf) => { if (finite(value) && value > FLAG_RULES[flag].threshold) flags.push({ country: iso3, flag, value: +value.toFixed(2), threshold: FLAG_RULES[flag].threshold, as_of: String(asOf) }); };

  const pti = latest('PTI_AVG'); if (pti) push('PTI_HIGH', pti.value - 100, pti.year);
  const ptr = latest('PTR_AVG'); if (ptr) push('PTR_HIGH', ptr.value - 100, ptr.year);
  const yoy = quarterlyYoY(monthly.REAL_PRICE_Q);
  if (yoy) push('PRICES_HOT', yoy.value, yoy.period);
  const gap = latest('CREDIT_GAP'); if (gap) push('CREDIT_GAP', gap.value, gap.year);

  const ry = lastYear(c.REAL_RENT);
  if (ry) {
    const excess = [0, 1, 2].map(k => { const r = logGrowth(c.REAL_RENT, ry - k - 1, ry - k), g = c.GDP_PC_GROWTH?.[ry - k]; return finite(r) && finite(g) ? r - g : null; });
    if (excess.every(v => finite(v) && v > 0)) push('RENT_OUTPACING', Math.min(...excess) + 1e-9, ry);
  }
  return flags;
}
