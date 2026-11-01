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
import { fetchStress, STRESS_INDICATORS } from '../lib/sources/stress.js';
import { fetchNational, NATIONAL_ADAPTERS, NATIONAL_INDICATORS } from '../lib/sources/national/index.js';
import { fetchMortgageRates, MORTGAGE_INDICATORS } from '../lib/sources/mortgage.js';
import { fetchIncome, INCOME_INDICATORS } from '../lib/sources/income.js';
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

// Flaky upstreams (the OECD SDMX API throws intermittent 500s): if a source still fails after its
// own retries, reuse the rows already in Turso for its indicators so a refresh never fails or
// silently drops a series. The report lists the source as carried forward.
const carriedForward = [];
async function stepOrCarry(label, fn, indicators) {
  try { return await step(label, fn); }
  catch (error) {
    console.log(`  ${label} FAILED (${error.message}); carrying forward stored rows`);
    const db = connect();
    const { rows } = await db.execute({ sql: `SELECT country, indicator, region, dwelling_type, period, frequency, value, status, source FROM observations WHERE indicator IN (${indicators.map(() => '?').join(',')})`, args: indicators });
    carriedForward.push({ source: label, error: String(error.message), rows: rows.length });
    return rows.map(r => ({ ...r, value: Number(r.value) }));
  }
}

async function main() {
  const countries = await step('World Bank country registry', loadCountries);
  const validIso3 = new Set(countries.map(c => c.iso3));
  const byIso2 = iso2Map(countries);

  const raw = [
    ...await step('BIS property prices, credit, policy rates', () => fetchBis(byIso2)),
    ...await step('BIS prices by dwelling type', () => fetchBisDwellingTypes(byIso2)),
    ...await stepOrCarry('OECD analytical house prices', () => fetchOecd(validIso3), OECD_INDICATORS.map(i => i.key)),
    ...await step('IMF World Economic Outlook', () => fetchImf(validIso3)),
    ...await step('World Bank housing drivers', () => fetchWorldBank(validIso3)),
    ...await stepOrCarry('OECD unemployment and wages, BIS debt service', () => fetchStress(validIso3, byIso2), STRESS_INDICATORS.map(i => i.key)),
    // Mortgage rates and household income are best-effort: a failed source is logged, never fatal.
    ...await step('Mortgage rates (ECB MIR, Bank of England)', () => fetchMortgageRates(byIso2, { log: console.log })),
    ...await step('Household income (Statistics Canada, OECD national accounts)', () => fetchIncome(validIso3, { log: console.log })),
  ];
  console.log('National housing agencies:');
  const national = await fetchNational();
  raw.push(...national.rows);

  const { rows, rejected } = validateRows(raw.filter(r => validIso3.has(r.country)));
  const coverage = coverageReport(rows);
  const gateFailures = Object.entries(COVERAGE_GATES).filter(([key, min]) => (coverage[key]?.countries || 0) < min).map(([key, min]) => `${key}: ${coverage[key]?.countries || 0} countries < ${min}`);

  const report_types = typeCoverage(rows);
  const has = (iso3, indicator) => coverage[indicator]?.list.includes(iso3);
  const countryRows = countries.map(c => {
    const hasPrice = has(c.iso3, 'REAL_PRICE') || has(c.iso3, 'OECD_REAL_PRICE') || (report_types.all || []).includes(c.iso3);
    return { iso3: c.iso3, iso2: c.iso2, name: c.name, region: c.region, income_group: c.incomeGroup, tier: hasPrice ? 1 : 2, has_price: hasPrice ? 1 : 0,
      has_rent: has(c.iso3, 'RENT') ? 1 : 0, has_national: NATIONAL_ADAPTERS.some(a => a.iso3 === c.iso3) ? 1 : 0, updated_at: RUN_AT };
  });

  const report = {
    runAt: RUN_AT, dryRun: DRY_RUN, observations: rows.length, rejected: rejected.length, rejectedSample: rejected.slice(0, 25),
    rejectedByReason: rejected.reduce((acc, r) => { const k = `${r.country} ${r.indicator}: ${r.reason}`; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
    tier1: countryRows.filter(c => c.tier === 1).length, withRent: countryRows.filter(c => c.has_rent).length, totalCountries: countryRows.length,
    nationalFailures: national.failures, carriedForward, gateFailures, dwellingTypes: typeCoverage(rows),
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
  const indicators = [...BIS_INDICATORS, ...OECD_INDICATORS, ...IMF_INDICATORS, ...WB_INDICATORS, ...STRESS_INDICATORS, ...NATIONAL_INDICATORS, ...MORTGAGE_INDICATORS, ...INCOME_INDICATORS]
    .filter((item, i, all) => all.findIndex(o => o.key === item.key) === i);
  await upsertRows(db, 'indicators', ['key', 'label', 'unit', 'source', 'frequency'], indicators);
  await upsertRows(db, 'countries', Object.keys(countryRows[0]), countryRows);
  const obs = rows.map(r => ({ ...r, region: r.region || '', dwelling_type: r.dwelling_type || '', status: r.status || 'actual', vintage: VINTAGE, fetched_at: RUN_AT }));
  // Replace each refreshed series wholesale (per country) so revised or withdrawn points do not
  // linger, while a source that failed this run keeps its previous rows for other countries.
  const series = [...new Set(obs.map(r => `${r.country}|${r.indicator}|${r.frequency}`))];
  const deletes = series.map(s => { const [country, indicator, frequency] = s.split('|'); return { sql: 'DELETE FROM observations WHERE country = ? AND indicator = ? AND frequency = ?', args: [country, indicator, frequency] }; });
  for (let i = 0; i < deletes.length; i += 200) await db.batch(deletes.slice(i, i + 200), 'write');
  const t = Date.now();
  await upsertRows(db, 'observations', ['country', 'indicator', 'region', 'dwelling_type', 'period', 'frequency', 'value', 'status', 'source', 'vintage', 'fetched_at'], obs);
  console.log(`Wrote ${obs.length} observations in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  await upsertRows(db, 'seed_runs', ['run_at', 'observations', 'rejected', 'tier1', 'carried_forward', 'national_failures', 'gate_failures'], [{
    run_at: RUN_AT, observations: obs.length, rejected: rejected.length, tier1: report.tier1,
    carried_forward: JSON.stringify(carriedForward), national_failures: JSON.stringify(national.failures), gate_failures: JSON.stringify(gateFailures),
  }]);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
