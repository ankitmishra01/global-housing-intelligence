// Shared helpers for source adapters. Pure functions are exported for tests.

export async function fetchText(url, { retries = 3, timeoutMs = 120_000, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'global-housing-intelligence/0.1', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}

export async function fetchBuffer(url, { timeoutMs = 180_000 } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// RFC 4180 CSV parser (quoted fields, embedded commas/newlines, BOM).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function csvObjects(text) {
  const [header, ...rows] = parseCsv(text);
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const num = v => (v === '' || v == null ? NaN : Number(v));
export const finite = v => typeof v === 'number' && Number.isFinite(v);

// Quarterly or monthly periods to calendar-year averages, complete years only.
// 2025-Q1..Q4 -> 2025; 2025-01..12 -> 2025. Partial years bias the latest reading.
export function annualAverage(points, { allowPartialMonthly = false } = {}) {
  const byYear = new Map();
  for (const { period, value } of points) {
    if (!finite(value)) continue;
    const year = Number(String(period).slice(0, 4));
    (byYear.get(year) || byYear.set(year, []).get(year)).push({ period, value });
  }
  const out = [];
  for (const [year, list] of byYear) {
    const sample = String(list[0].period);
    const expected = /-Q\d$/.test(sample) ? 4 : /^\d{4}-\d{2}$/.test(sample) ? 12 : /^\d{4}-W?\d{2}-\d{2}$/.test(sample) ? 50 : 1;
    if (list.length < expected && !(allowPartialMonthly && expected === 12 && list.length >= 9)) continue;
    out.push({ period: String(year), value: list.reduce((s, p) => s + p.value, 0) / list.length });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export function latestPoint(points) {
  return points.filter(p => finite(p.value)).sort((a, b) => String(a.period).localeCompare(String(b.period))).pop() || null;
}

export { num };
