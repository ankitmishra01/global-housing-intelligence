#!/usr/bin/env node
// Production health probe: countries API coverage and projection run age.
// Run: PRODUCTION_URL=https://... node sync/probe.js
const BASE = (process.env.PRODUCTION_URL || 'https://global-housing-intelligence.vercel.app').replace(/\/$/, '');
const MAX_RUN_AGE_DAYS = 40;
const MIN_COUNTRIES = 150;

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

// Accepts either a bare array or an object wrapping one.
const listOf = j => (Array.isArray(j) ? j : j.countries || j.data || j.rows || []);

// Run ids look like run_YYYYMMDDHHMM; fall back to any ISO date in the payload.
export function runDate(payload) {
  const text = JSON.stringify(payload);
  const id = text.match(/run_(\d{4})(\d{2})(\d{2})/);
  if (id) return new Date(`${id[1]}-${id[2]}-${id[3]}T00:00:00Z`);
  const iso = text.match(/"(?:created_at|createdAt|generated_at)"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  return iso ? new Date(`${iso[1]}T00:00:00Z`) : null;
}

async function main() {
  const failures = [];
  try {
    const n = listOf(await getJson('/api/v1/countries')).length;
    console.log(`countries: ${n}`);
    if (n < MIN_COUNTRIES) failures.push(`only ${n} countries (< ${MIN_COUNTRIES})`);
  } catch (e) { failures.push(`countries: ${e.message}`); }
  try {
    const date = runDate(await getJson('/api/v1/projections?c=USA'));
    if (!date) failures.push('projections: no run id or date in response');
    else {
      const age = (Date.now() - date.getTime()) / 86_400_000;
      console.log(`latest run: ${date.toISOString().slice(0, 10)} (${age.toFixed(1)} days old)`);
      if (age > MAX_RUN_AGE_DAYS) failures.push(`latest run is ${age.toFixed(0)} days old (> ${MAX_RUN_AGE_DAYS})`);
    }
  } catch (e) { failures.push(`projections: ${e.message}`); }
  if (failures.length) { console.log(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1); }
  console.log('OK');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
