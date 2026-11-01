// Synthetic observation rows with a known data-generating process, for engine tests.
// Real house price growth next year = 1 - 1.5 × (real policy rate this year) + noise.
// Real rents follow a driftless random walk (pure noise: nothing should beat no-change).
import { mulberry32 } from '../lib/engine/stats.js';

export function syntheticRows({ countries = 32, from = 1970, to = 2025, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const normal = () => { const u = Math.max(rand(), 1e-12), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const rows = [];
  const push = (country, indicator, period, value, frequency = 'A', extra = {}) => rows.push({ country, indicator, region: '', dwelling_type: '', period: String(period), frequency, value, status: 'actual', source: 'synthetic', ...extra });
  for (let i = 0; i < countries; i++) {
    const iso3 = `C${String(i).padStart(2, '0')}`;
    let rate = 4 + normal(), price = 100, rent = 100, condo = 100, cpi = 100;
    for (let y = from; y <= to; y++) {
      const infl = 2 + 0.5 * normal();
      cpi *= 1 + infl / 100;
      const realRate = rate - infl;
      push(iso3, 'POLICY_RATE', y, rate);
      push(iso3, 'INFLATION', y, infl);
      push(iso3, 'GDP_PC_GROWTH', y, 1.5 + normal());
      push(iso3, 'REAL_PRICE', y, price);
      push(iso3, 'NOMINAL_PRICE', y, (price * cpi) / 100);
      push(iso3, 'RENT', y, (rent * cpi) / 100);
      if (i < 10) push(iso3, 'TYPE_PRICE_INDEX', y, (condo * cpi) / 100, 'A', { dwelling_type: 'condo' });
      if (y >= to - 1) for (let m = 1; m <= 12; m++) push(iso3, 'POLICY_RATE', `${y}-${String(m).padStart(2, '0')}`, rate + (m - 12) * 0.05, 'M');
      if (y === to) {
        push(iso3, 'INFLATION', y + 1, 2.1, 'A', { status: 'forecast' });
      }
      const g = 1 - 1.5 * realRate + 1.5 * normal();
      price *= Math.exp(g / 100);
      condo *= Math.exp((g + 0.5 * normal()) / 100);
      rent *= Math.exp((1.2 * normal()) / 100);
      rate = Math.max(0, 4 + 0.8 * (rate - 4) + 1.2 * normal());
    }
  }
  return rows;
}
