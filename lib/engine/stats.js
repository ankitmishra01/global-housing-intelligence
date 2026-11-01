// Statistical primitives, adapted from the G20 projection trainer. Zero dependencies.

export const finite = v => typeof v === 'number' && Number.isFinite(v);
export const round = (v, d = 2) => (finite(v) ? +v.toFixed(d) : null);
export const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export function quantile(values, q) {
  const a = values.filter(finite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
export const median = a => quantile(a, 0.5);

export function metric(pred, actual) {
  const e = pred.map((p, i) => p - actual[i]);
  return { mae: mean(e.map(Math.abs)), rmse: Math.sqrt(mean(e.map(v => v * v))) };
}

export function solve(A0, b0) {
  const A = A0.map(r => r.slice()), b = b0.slice(), n = b.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
    [A[c], A[pivot]] = [A[pivot], A[c]]; [b[c], b[pivot]] = [b[pivot], b[c]];
    const div = Math.abs(A[c][c]) < 1e-10 ? 1e-10 : A[c][c];
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = A[r][c] / div;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / (Math.abs(A[i][i]) < 1e-10 ? 1e-10 : A[i][i]));
}

// Ridge on standardised features; missing predictors are mean imputed (z = 0).
// `rawCoef` is the per-unit effect of each original feature, used for rate sensitivity.
// Features are winsorized at the 2.5th/97.5th percentiles of the training samples, in fitting
// and prediction, so a structurally extreme input (e.g. a valuation gap far outside anything in
// the training panel) cannot be extrapolated linearly into an implausible long-horizon path.
export const WINSOR_Q = 0.025;

export function fitRidge(samples, lambda = 4) {
  const p = samples[0].x.length;
  const lo = Array(p), hi = Array(p);
  for (let j = 0; j < p; j++) {
    const col = samples.map(s => s.x[j]).filter(finite);
    lo[j] = col.length ? quantile(col, WINSOR_Q) : -Infinity;
    hi[j] = col.length ? quantile(col, 1 - WINSOR_Q) : Infinity;
  }
  const clip = x => x.map((v, j) => (finite(v) ? Math.min(hi[j], Math.max(lo[j], v)) : v));
  samples = samples.map(s => ({ ...s, x: clip(s.x) }));
  const mu = Array(p).fill(0), sd = Array(p).fill(0), counts = Array(p).fill(0);
  for (const s of samples) for (let j = 0; j < p; j++) if (finite(s.x[j])) { mu[j] += s.x[j]; counts[j]++; }
  for (let j = 0; j < p; j++) mu[j] = counts[j] ? mu[j] / counts[j] : 0;
  for (const s of samples) for (let j = 0; j < p; j++) if (finite(s.x[j])) sd[j] += (s.x[j] - mu[j]) ** 2;
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j] / Math.max(1, counts[j])) || 1;
  const z = x => x.map((v, j) => (finite(v) ? (v - mu[j]) / sd[j] : 0));
  const d = p + 1, A = Array.from({ length: d }, () => Array(d).fill(0)), b = Array(d).fill(0);
  for (const s of samples) {
    const row = [...z(s.x), 1];
    for (let i = 0; i < d; i++) { b[i] += row[i] * s.y; for (let j = 0; j < d; j++) A[i][j] += row[i] * row[j]; }
  }
  for (let j = 0; j < p; j++) A[j][j] += lambda;
  const beta = solve(A, b);
  return { predict: x => beta[p] + z(clip(x)).reduce((s, v, j) => s + v * beta[j], 0), coef: beta.slice(0, p), rawCoef: beta.slice(0, p).map((c, j) => c / sd[j]), intercept: beta[p], bounds: { lo, hi } };
}

// Deterministic PRNG so bootstrap standard errors are reproducible run to run.
export function mulberry32(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function percentileRank(values, v) {
  const a = values.filter(finite);
  if (!a.length || !finite(v)) return null;
  const below = a.filter(x => x < v).length, equal = a.filter(x => x === v).length;
  return (100 * (below + 0.5 * equal)) / a.length;
}
