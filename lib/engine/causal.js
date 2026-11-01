// Causal rate effect: local projections (Jordà 2005) of cumulative real house price growth on
// identified monetary-policy shocks, scaled to a +1pp policy-rate move.
//
//   y_{i,t+h} - y_{i,t-1} = a_i + b_h * shock_t + Σ_{l=1..4} (c_l Δy_{i,t-l} + d_l shock_{t-l}) + e
//
// y = 100·ln(real price) (quarterly, BIS). Country fixed effects by within-demeaning; standard
// errors are Newey–West for one country and Driscoll–Kraay (Newey–West on cross-sectionally
// summed scores) for a panel, with lag h+1. The policy-rate response to the same shock gives
// the scaling: effect per +1pp = b_h / peak rate response.
import { solve, finite, mean } from './stats.js';

const LAGS = 4;

export const quarterKey = (y, q) => `${y}-Q${q}`;
export function quarterIndex(key) { const [y, q] = key.split('-Q').map(Number); return y * 4 + (q - 1); }
export function keyFromIndex(i) { return quarterKey(Math.floor(i / 4), (i % 4) + 1); }

// Monthly series → quarterly mean keyed 'YYYY-Qn' (needs ≥ 2 months in the quarter).
export function monthlyToQuarterly(monthly) {
  const acc = {};
  for (const [p, v] of Object.entries(monthly || {})) {
    if (!finite(v)) continue;
    const [y, m] = p.split('-').map(Number);
    const k = quarterKey(y, Math.ceil(m / 3));
    (acc[k] ||= []).push(v);
  }
  return Object.fromEntries(Object.entries(acc).filter(([, v]) => v.length >= 2).map(([k, v]) => [k, mean(v)]));
}

// Build LP samples for horizon h. series: {unitId: {quarterKey: level}}, transform 'log' (×100 ln)
// or 'level' (policy rate); shocks: {quarterKey: value}; window: [minIndex, maxIndex] per unit.
function lpSamples(series, shocks, h, { transform = 'log', windows = {} } = {}) {
  const out = [];
  for (const [unit, s] of Object.entries(series)) {
    const y = {};
    for (const [k, v] of Object.entries(s)) if (finite(v) && (transform !== 'log' || v > 0)) y[quarterIndex(k)] = transform === 'log' ? 100 * Math.log(v) : v;
    const idx = Object.keys(y).map(Number).sort((a, b) => a - b);
    const [lo, hi] = windows[unit] || [-Infinity, Infinity];
    for (const t of idx) {
      if (t < lo || t + h > hi) continue;
      const sh = shocks[keyFromIndex(t)];
      if (!finite(sh) || !finite(y[t + h]) || !finite(y[t - 1])) continue;
      const x = [sh];
      let ok = true;
      for (let l = 1; l <= LAGS; l++) {
        const d = finite(y[t - l]) && finite(y[t - l - 1]) ? y[t - l] - y[t - l - 1] : null;
        const sl = shocks[keyFromIndex(t - l)];
        if (d == null || !finite(sl)) { ok = false; break; }
        x.push(d, sl);
      }
      if (!ok) continue;
      out.push({ unit, t, y: y[t + h] - y[t - 1], x });
    }
  }
  return out;
}

// OLS with unit fixed effects (within transformation) and HAC / Driscoll–Kraay standard errors.
export function olsFE(samples, hacLag) {
  if (samples.length < 20) return null;
  const p = samples[0].x.length;
  const byUnit = new Map();
  for (const s of samples) (byUnit.get(s.unit) || byUnit.set(s.unit, []).get(s.unit)).push(s);
  const rows = [];
  for (const list of byUnit.values()) {
    const my = mean(list.map(s => s.y)), mx = Array.from({ length: p }, (_, j) => mean(list.map(s => s.x[j])));
    for (const s of list) rows.push({ t: s.t, y: s.y - my, x: s.x.map((v, j) => v - mx[j]) });
  }
  const XtX = Array.from({ length: p }, () => Array(p).fill(0)), Xty = Array(p).fill(0);
  for (const r of rows) for (let i = 0; i < p; i++) { Xty[i] += r.x[i] * r.y; for (let j = 0; j < p; j++) XtX[i][j] += r.x[i] * r.x[j]; }
  const beta = solve(XtX, Xty);
  // (X'X)^-1 by solving against unit vectors.
  const inv = Array.from({ length: p }, (_, j) => solve(XtX, Array.from({ length: p }, (_, i) => (i === j ? 1 : 0))));
  // Scores summed by time period (Driscoll–Kraay; reduces to Newey–West for one unit).
  const byT = new Map();
  for (const r of rows) {
    const e = r.y - r.x.reduce((s, v, j) => s + v * beta[j], 0);
    const g = byT.get(r.t) || Array(p).fill(0);
    for (let j = 0; j < p; j++) g[j] += r.x[j] * e;
    byT.set(r.t, g);
  }
  const ts = [...byT.keys()].sort((a, b) => a - b), G = ts.map(t => byT.get(t));
  const S = Array.from({ length: p }, () => Array(p).fill(0));
  for (let lag = 0; lag <= hacLag; lag++) {
    const w = lag === 0 ? 1 : 1 - lag / (hacLag + 1);
    for (let k = lag; k < G.length; k++) {
      if (ts[k] - ts[k - lag] !== lag) continue;
      for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) {
        const v = G[k][i] * G[k - lag][j];
        S[i][j] += lag === 0 ? v : w * (v + G[k - lag][i] * G[k][j]);
      }
    }
  }
  // V = inv · S · inv (inv is symmetric up to rounding; columns from solve()).
  const IS = inv.map(row => S[0].map((_, j) => row.reduce((s, v, k) => s + v * S[k][j], 0)));
  const V = IS.map(row => inv[0].map((_, j) => row.reduce((s, v, k) => s + v * inv[k][j], 0)));
  return { beta, se: Math.sqrt(Math.max(0, V[0][0])), n: rows.length, units: byUnit.size, periods: ts.length };
}

export function localProjection(series, shocks, horizons, opts = {}) {
  const out = {};
  for (const h of horizons) {
    const fit = olsFE(lpSamples(series, shocks, h, opts), h + 1);
    if (fit) out[h] = { coef: fit.beta[0], se: fit.se, n: fit.n, units: fit.units };
  }
  return out;
}

// Full causal estimate for one shock area. prices: {iso3: {quarterKey: real index}};
// rates: {iso3: {quarterKey: policy rate}}; windows: optional per-unit quarter-index bounds.
// Returns the price response per unit shock and per +1pp of policy rate, by year 1..10
// (cumulative to the end of year k = quarter 4k-1), holding the last estimable year.
export function causalRateEffect({ prices, rates, shocks, windows = {} }) {
  const qh = Array.from({ length: 40 }, (_, i) => i);
  const price = localProjection(prices, shocks, qh, { transform: 'log', windows });
  const rate = localProjection(rates, shocks, qh.slice(0, 9), { transform: 'level', windows });
  const peak = Object.entries(rate).filter(([, v]) => finite(v.coef)).sort((a, b) => Math.abs(b[1].coef) - Math.abs(a[1].coef))[0];
  const ratePeak = peak ? { quarter: Number(peak[0]), coef: peak[1].coef, se: peak[1].se } : null;
  const years = {};
  let last = null;
  for (let k = 1; k <= 10; k++) {
    const r = price[4 * k - 1];
    if (r && r.n >= 40) last = { ...r, year: k, held: false };
    if (last) years[k] = { ...last, held: last.year !== k, heldFrom: last.year };
  }
  const scale = ratePeak && Math.abs(ratePeak.coef) > 0.05 ? 1 / ratePeak.coef : null;
  const perPp = scale == null ? {} : Object.fromEntries(Object.entries(years).map(([k, v]) => [k, { coef: v.coef * scale, se: Math.abs(v.se * scale), held: v.held, heldFrom: v.heldFrom, n: v.n }]));
  return { quarterly: price, rate, ratePeak, years, perPp };
}
