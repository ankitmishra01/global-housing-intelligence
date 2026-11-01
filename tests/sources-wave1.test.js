import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsonStatRows, normalisePeriod, withAnnual } from '../lib/sources/util.js';
import { parseEcbMir, parseBoe } from '../lib/sources/mortgage.js';
import { parseStatCanVector, parseOecdHouseholdIncome, parseWorldBankPopulation } from '../lib/sources/income.js';
import { parseInseeIpla } from '../lib/sources/national/france.js';
import { parseIneIpv } from '../lib/sources/national/spain.js';
import { parseHpm09, parseHpm05 } from '../lib/sources/national/ireland.js';
import { parseCbsNational, parseCbsRegional } from '../lib/sources/national/netherlands.js';
import { parseScb } from '../lib/sources/national/sweden.js';
import { parseSsb } from '../lib/sources/national/norway.js';
import { parseSgs } from '../lib/sources/national/brazil.js';
import { parseUkHpi } from '../lib/sources/national/united-kingdom.js';
import { householdIncome } from '../lib/engine/affordability.js';

const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('normalisePeriod handles SCB, CBS, CSO and SDMX formats', () => {
  assert.equal(normalisePeriod('2026K3'), '2026-Q3');
  assert.equal(normalisePeriod('2026MM07'), '2026-07');
  assert.equal(normalisePeriod('2026KW02'), '2026-Q2');
  assert.equal(normalisePeriod('202608'), '2026-08');
  assert.equal(normalisePeriod('2025JJ00'), '2025');
});

test('withAnnual sums sales counts but averages indexes, complete years only', () => {
  const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
  const rows = [...months.map(p => ({ country: 'X', indicator: 'SALES_COUNT', period: p, frequency: 'M', value: 100 })),
    ...months.map(p => ({ country: 'X', indicator: 'REGION_PRICE_INDEX', region: 'R', period: p, frequency: 'M', value: 110 })),
    { country: 'X', indicator: 'SALES_COUNT', period: '2026-01', frequency: 'M', value: 90 }];
  const annual = withAnnual(rows).filter(r => r.frequency === 'A');
  assert.equal(annual.find(r => r.indicator === 'SALES_COUNT').value, 1200);
  assert.equal(annual.find(r => r.indicator === 'REGION_PRICE_INDEX').value, 110);
  assert.equal(annual.filter(r => r.period === '2026').length, 0);
});

test('parseEcbMir maps euro members and skips the euro-area aggregate', () => {
  const csv = 'KEY,FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE\nMIR.M.DE,M,DE,2026-08,4.01\nMIR.M.U2,M,U2,2026-08,3.6\nMIR.M.FR,M,FR,2026-08,';
  const rows = parseEcbMir(csv, new Map([['DE', 'DEU'], ['FR', 'FRA']]));
  assert.deepEqual(rows.map(r => [r.country, r.period, r.value]), [['DEU', '2026-08', 4.01]]);
});

test('parseBoe reads the IADB CSV date format', () => {
  const rows = parseBoe('DATE,IUMBV34\n31 Jan 2026,3.93\n28 Feb 2026,3.97\n31 Mar 2026,');
  assert.deepEqual(rows.map(r => [r.period, r.value]), [['2026-01', 3.93], ['2026-02', 3.97]]);
});

test('income parsers and householdIncome preference order', () => {
  const sc = parseStatCanVector([{ object: { vectorDataPoint: [{ refPer: '2024-01-01', value: 86000 }] } }]);
  assert.equal(sc[0].period, '2024');
  const pop = parseWorldBankPopulation([{}, [{ countryiso3code: 'GBR', date: '2024', value: 69000000 }]]);
  const oecd = parseOecdHouseholdIncome('REF_AREA,TIME_PERIOD,OBS_VALUE,UNIT_MULT\nGBR,2024,1800000,6\nEA20,2024,9000000,6', pop, new Set(['GBR']));
  assert.equal(oecd.length, 1);
  assert.ok(Math.abs(oecd[0].value - (1.8e12 / 69e6) * 2.4) < 1);
  assert.match(householdIncome({ MEDIAN_HH_INCOME: { 2024: 86000 }, HH_INCOME_OECD: { 2024: 90000 } }).basis, /median/);
  assert.match(householdIncome({ HH_INCOME_OECD: { 2024: 90000 }, GDP_PC_LCU: { 2024: 50000 } }).basis, /OECD national accounts/);
  assert.match(householdIncome({ GDP_PC_LCU: { 2024: 50000 } }).basis, /proxy/);
});

test('parseInseeIpla keeps raw series, maps types and leaves the national headline to the BIS', () => {
  const rows = parseInseeIpla(fixture('insee-ipla.xml'));
  assert.ok(rows.every(r => r.country === 'FRA'));
  assert.equal(rows.filter(r => r.region === 'Paris' && r.dwelling_type === 'condo').length, 2);
  assert.equal(rows.find(r => r.indicator === 'TYPE_PRICE_INDEX').dwelling_type, 'house');
  assert.ok(rows.some(r => r.region === 'Seine-et-Marne' && r.dwelling_type === ''));
  assert.ok(!rows.some(r => r.value === 135.0 || r.value === 130.0));
});

test('parseIneIpv maps regions and new/second-hand', () => {
  const rows = parseIneIpv([
    { Nombre: 'Madrid, Comunidad de. General. Índice. ', Data: [{ Anyo: 2026, FK_Periodo: 20, Valor: 112.1 }] },
    { Nombre: 'Nacional. Vivienda nueva. Índice. ', Data: [{ Anyo: 2026, FK_Periodo: 19, Valor: 109.0 }] },
    { Nombre: 'Nacional. General. Índice. ', Data: [{ Anyo: 2026, FK_Periodo: 20, Valor: 111.1 }] },
    { Nombre: 'Madrid, Comunidad de. General. Variación anual. ', Data: [{ Anyo: 2026, FK_Periodo: 20, Valor: 12 }] },
  ]);
  assert.deepEqual(rows.map(r => [r.region, r.dwelling_type, r.period, r.value]), [['Madrid, Comunidad de', '', '2026-Q2', 112.1], ['', 'new_build', '2026-Q1', 109.0]]);
});

test('jsonStatRows decodes row-major values; parseHpm09 maps CSO regions and types', () => {
  const d = JSON.parse(fixture('cso-hpm09.json'));
  assert.equal(jsonStatRows(d).length, 12);
  const rows = parseHpm09(d);
  assert.deepEqual(rows.map(r => [r.indicator, r.region, r.dwelling_type, r.period, r.value]), [
    ['TYPE_PRICE_INDEX', '', 'house', '2026-07', 195.2], ['REGION_PRICE_INDEX', 'Dublin', 'condo', '2026-07', 180.3],
    ['TYPE_PRICE_INDEX', '', 'house', '2026-08', 196.0], ['REGION_PRICE_INDEX', 'Dublin', 'condo', '2026-08', 181.0]]);
});

test('parseHpm05 keeps the all/all/executions volume and median', () => {
  const d = { id: ['STATISTIC', 'TLIST(M1)', 'TYPE', 'FILING'], size: [2, 1, 2, 2], dimension: {
    STATISTIC: { category: { index: ['V', 'M'], label: { V: 'Volume of Sales', M: 'Median Price' } } },
    'TLIST(M1)': { category: { index: ['202606'], label: { 202606: '2026 June' } } },
    TYPE: { category: { index: ['-', '1'], label: { '-': 'All Dwelling Types', 1: 'Apartment' } } },
    FILING: { category: { index: ['01', '02'], label: { '01': 'Filings', '02': 'Executions' } } } },
    value: [4200, 4136, 900, 880, 400000, 410000, 300000, 310000] };
  assert.deepEqual(parseHpm05(d).map(r => [r.indicator, r.value]), [['SALES_COUNT', 4136], ['MEDIAN_PRICE', 410000]]);
});

test('CBS parsers read monthly national and quarterly regional rows', () => {
  const nat = parseCbsNational([{ Perioden: '2026MM09', VerkochteWoningen_4: 18000, GemiddeldeVerkoopprijs_7: 480000 }, { Perioden: '2026KW03', VerkochteWoningen_4: 54000 }]);
  assert.deepEqual(nat.map(r => [r.indicator, r.period]), [['SALES_COUNT', '2026-09'], ['AVG_PRICE', '2026-09']]);
  const reg = parseCbsRegional([{ RegioS: 'GM0363', Perioden: '2026KW03', PrijsindexVerkoopprijzen_1: 150.2, GemiddeldeVerkoopprijs_7: 650000, VerkochteWoningen_4: null }], { GM0363: 'Amsterdam' });
  assert.deepEqual(reg.map(r => [r.indicator, r.region, r.period]), [['REGION_PRICE_INDEX', 'Amsterdam', '2026-Q3'], ['AVG_PRICE', 'Amsterdam', '2026-Q3']]);
});

test('parseScb and parseSsb map regions and dwelling types', () => {
  const swe = parseScb({ data: [{ key: ['00', '2026K3'], values: ['986'] }, { key: ['0010', '2026K3'], values: ['1500'] }, { key: ['XX', '2026K3'], values: ['1'] }] });
  assert.deepEqual(swe.map(r => [r.indicator, r.region, r.period]), [['TYPE_PRICE_INDEX', '', '2026-Q3'], ['REGION_PRICE_INDEX', 'Greater Stockholm', '2026-Q3']]);
  const ssb = parseSsb({ id: ['Region', 'Boligtype', 'ContentsCode', 'Tid'], size: [2, 2, 1, 1], dimension: {
    Region: { category: { index: { TOTAL: 0, '001': 1 }, label: { TOTAL: 'The whole country', '001': 'Oslo including Bærum' } } },
    Boligtype: { category: { index: { '00': 0, '03': 1 }, label: { '00': 'Total', '03': 'Multi-dwelling' } } },
    ContentsCode: { category: { index: { Boligindeks: 0 } } }, Tid: { category: { index: { '2026K2': 0 } } } }, value: [150, 160, 170, 180] });
  assert.deepEqual(ssb.map(r => [r.indicator, r.region, r.dwelling_type, r.value]), [['TYPE_PRICE_INDEX', '', 'condo', 160], ['REGION_PRICE_INDEX', 'Oslo including Bærum', '', 170], ['REGION_PRICE_INDEX', 'Oslo including Bærum', 'condo', 180]]);
});

test('parseSgs reads BCB dates', () => {
  assert.deepEqual(parseSgs([{ data: '01/08/2026', valor: '796.75' }]).map(r => [r.period, r.value]), [['2026-08', 796.75]]);
});

test('parseUkHpi reads the Land Registry sales volume column', () => {
  const csv = 'Name,Period,Sales volume,Average price All property types,Average price Detached houses\nUnited Kingdom,2026-03,70000,268000,430000';
  const rows = parseUkHpi(csv, '');
  assert.equal(rows.find(r => r.indicator === 'SALES_COUNT').value, 70000);
  assert.equal(rows.find(r => r.indicator === 'AVG_PRICE').value, 268000);
});
