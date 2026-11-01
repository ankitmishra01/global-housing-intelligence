#!/usr/bin/env node
// Housing data pipeline: fetch BIS, OECD, IMF, World Bank and national agency data for
// every economy, validate, and write to Turso.
// Run:      node sync/seed.js
// Dry run:  node sync/seed.js --dry-run   (no writes; validates and writes sync/report.json)
import fs from 'node:fs';
import { connect, upsertRows } from '../lib/db.js';
import { migrate } from '../db/migrate.js';
import { loadCountries, iso2Map } from '../lib/registry.js';
import { fetchBis, fetchBisDwellingTypes, BIS_INDICATORS } from '../lib/sources/bis.js';
import { fetchOecd, OECD_INDICATORS } from '../lib/sources/oecd.js';
import { fetchWorldBank, WB_INDICATORS } from '../lib/sources/worldbank.js';
import { fetchImf, IMF_INDICATORS } from '../lib/sources/imf.js';
import { fetchNational, NATIONAL_ADAPTERS, NATIONAL_INDICATORS } from '../lib/sources/national/index.js';
import { validateRows, coverageReport, typeCoverage, COVERAGE_GATES } from '../lib/validate.js';

const DRY_RUN = process.argv.includes('--dry-run');
const RUN_AT = new Date().toISOString();
const VINTAGE = RUN_AT.slice(0, 10);

async function step(label, fn) {
  const t = Date.now();
  process.stdout.write(`${label}... `);
  const out = await fn();
  console.log(`${Array.isArray(out) ? out.length + ' rows ' : ''}(${((Date.now() - t) / 1000).toFixed(1)}s)`);
  return out;
}

async function main() {
  const countries = await step('World Bank country registry', loadCountries);
  const validIso3 = new Set(countries.map(c => c.iso3));
  const byIso2 = iso2Map(countries);

  const raw = [
    ...await step('BIS property prices, credit, policy rates', () => fetchBis(byIso2)),
    ...await step('BIS prices by dwelling type', () => fetchBisDwellingTypes(byIso2)),
    ...await step('OECD analytical house prices', () => fetchOecd(validIso3)),
    ...await step('IMF World Economic Outlook', () => fetchImf(validIso3)),
    ...await step('World Bank housing drivers', () => fetchWorldBank(validIso3)),
  ];
  console.log('National housing agencies:');
  const national = await fetchNational();
  raw.push(...national.rows);

  const { rows, rejected } = validateRows(raw.filter(r => validIso3.has(r.country)));
  const coverage = coverageReport(rows);
  const gateFailures = Object.entries(COVERAGE_GATES).filter(([key, min]) => (coverage[key]?.countries || 0) < min).map(([key, min]) => `${key}: ${coverage[key]?.countries || 0} countries < ${min}`);

  const has = (iso3, indicator) => coverage[indicator]?.list.includes(iso3);
  const countryRows = countries.map(c => {
    const hasPrice = has(c.iso3, 'REAL_PRICE') || has(c.iso3, 'OECD_REAL_PRICE');
    return { iso3: c.iso3, iso2: c.iso2, name: c.name, region: c.region, income_group: c.incomeGroup, tier: hasPrice ? 1 : 2, has_price: hasPrice ? 1 : 0,
      has_rent: has(c.iso3, 'RENT') ? 1 : 0, has_national: NATIONAL_ADAPTERS.some(a => a.iso3 === c.iso3) ? 1 : 0, updated_at: RUN_AT };
  });

  const report = {
    runAt: RUN_AT, dryRun: DRY_RUN, observations: rows.length, rejected: rejected.length, rejectedSample: rejected.slice(0, 25),
    tier1: countryRows.filter(c => c.tier === 1).length, withRent: countryRows.filter(c => c.has_rent).length, totalCountries: countryRows.length,
    nationalFailures: national.failures, gateFailures, dwellingTypes: typeCoverage(rows),
    coverage: Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, { countries: v.countries, rows: v.rows, latest: v.latest }])),
  };
  fs.writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(`\n${rows.length} observations valid, ${rejected.length} rejected. Tier 1: ${report.tier1} economies (${report.withRent} with rents) of ${report.totalCountries}.`);
  for (const [k, v] of Object.entries(report.coverage)) console.log(`  ${k.padEnd(20)} ${String(v.countries).padStart(4)} countries  latest ${v.latest}`);
  for (const [t, list] of Object.entries(report.dwellingTypes)) console.log(`  type ${t.padEnd(15)} ${String(list.length).padStart(4)} countries`);
  if (gateFailures.length) { console.error(`\nCoverage gate failed:\n  ${gateFailures.join('\n  ')}`); process.exit(1); }
  if (DRY_RUN) { console.log('\nDry run: nothing written. Report in sync/report.json'); return; }

  const db = connect();
  await migrate(db);
  const indicators = [...BIS_INDICATORS, ...OECD_INDICATORS, ...IMF_INDICATORS, ...WB_INDICATORS, ...NATIONAL_INDICATORS];
  await upsertRows(db, 'indicators', ['key', 'label', 'unit', 'source', 'frequency'], indicators);
  await upsertRows(db, 'countries', Object.keys(countryRows[0]), countryRows);
  const obs = rows.map(r => ({ ...r, region: r.region || '', dwelling_type: r.dwelling_type || '', status: r.status || 'actual', vintage: VINTAGE, fetched_at: RUN_AT }));
  // Replace each refreshed series wholesale so revised or withdrawn points do not linger.
  const series = [...new Set(obs.map(r => `${r.indicator}|${r.frequency}`))];
  await db.batch(series.map(s => { const [indicator, frequency] = s.split('|'); return { sql: 'DELETE FROM observations WHERE indicator = ? AND frequency = ?', args: [indicator, frequency] }; }), 'write');
  const t = Date.now();
  await upsertRows(db, 'observations', ['country', 'indicator', 'region', 'dwelling_type', 'period', 'frequency', 'value', 'status', 'source', 'vintage', 'fetched_at'], obs);
  console.log(`Wrote ${obs.length} observations in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
