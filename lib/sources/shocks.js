// Monetary-policy shock series for the causal rate effect.
// Jarociński, M. and Karadi, P. (2020), "Deconstructing Monetary Policy Surprises: The Role of
// Information Shocks", AEJ: Macroeconomics, doi:10.1257/mac.20180090. Updated monthly series
// published by the authors on GitHub (marekjarocinski/jkshocks_update_fed and _ecb); research
// data with no stated licence, used here with citation. MP_median is the pure monetary-policy
// shock (information effects removed), in % p.a. of the 1-year rate surprise.
import { csvObjects, fetchText, num } from './util.js';

const BASE = 'https://raw.githubusercontent.com/marekjarocinski';
export const SHOCK_SOURCES = {
  US: { url: `${BASE}/jkshocks_update_fed/main/shocks_fed_jk_m.csv`, label: 'Jarociński–Karadi (2020) Fed monetary-policy shocks, updated by the authors' },
  EA: { url: `${BASE}/jkshocks_update_ecb/main/shocks_ecb_mpd_me_m.csv`, label: 'Jarociński–Karadi (2020) ECB monetary-policy shocks, updated by the authors' },
};

// Monthly MP_median → quarterly sums keyed 'YYYY-Qn'. Months with no announcement are zero.
export function parseShocks(csv, column = 'MP_median') {
  const quarterly = {};
  for (const r of csvObjects(csv)) {
    const y = Number(r.year), m = Number(r.month), v = num(r[column]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(v)) continue;
    const key = `${y}-Q${Math.ceil(m / 3)}`;
    quarterly[key] = (quarterly[key] || 0) + v;
  }
  return quarterly;
}

export async function fetchShocks() {
  const out = {};
  for (const [area, s] of Object.entries(SHOCK_SOURCES)) out[area] = { quarterly: parseShocks(await fetchText(s.url)), source: s.label, url: s.url };
  return out;
}
