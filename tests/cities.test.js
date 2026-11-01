import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canadaPlace, chooseGeos, parseCanadaCmaStarts, parseCanadaNhpi } from '../lib/sources/national/canada.js';
import { usMetroName, parseFhfaMetro, parseCaseShiller, parseZillowMetros, QUARTERLY_FROM } from '../lib/sources/national/united-states-cities.js';
import { parseAbsCities } from '../lib/sources/national/australia.js';
import { parseUkHpi } from '../lib/sources/national/united-kingdom.js';
import { salesSeries } from '../lib/engine/events.js';

test('Canadian place names: provinces drop out, whole CMAs beat parts and exclusions', () => {
  assert.equal(canadaPlace('Ontario'), null);
  assert.deepEqual(canadaPlace('Toronto, Ontario'), { name: 'Toronto', rank: 0 });
  assert.equal(canadaPlace('Saint John, Fredericton, and Moncton, New Brunswick').name, 'Saint John, Fredericton, and Moncton');
  const names = chooseGeos([{ GEO: 'Ottawa-Gatineau, Ontario part, Ontario/Quebec' }, { GEO: 'Ottawa-Gatineau, Ontario/Quebec' }, { GEO: 'Montréal excluding Saint-Jérôme, Quebec' }]);
  assert.deepEqual([...names], [['Ottawa-Gatineau, Ontario/Quebec', 'Ottawa-Gatineau'], ['Montréal excluding Saint-Jérôme, Quebec', 'Montréal']]);
});

test('Canada CMA starts by dwelling type and NHPI by city', () => {
  const starts = ['REF_DATE,GEO,Housing estimates,Type of unit,VALUE', '2025,"Toronto, Ontario",Housing starts,Total units,26087', '2025,"Toronto, Ontario",Housing starts,Row units,3716', '2025,"Toronto, Ontario",Housing completions,Total units,1', '2025,Census metropolitan areas,Housing starts,Total units,9'].join('\n');
  assert.deepEqual(parseCanadaCmaStarts(starts).map(r => [r.region, r.dwelling_type, r.value]), [['Toronto', '', 26087], ['Toronto', 'townhouse', 3716]]);
  const nhpi = ['REF_DATE,GEO,New housing price indexes,VALUE', '2026-09,Canada,Total (house and land),124.1', '2026-09,"Calgary, Alberta",Total (house and land),130.2', '2026-09,Alberta,Total (house and land),128'].join('\n');
  assert.deepEqual(parseCanadaNhpi(nhpi).map(r => [r.region, r.value]), [['', 124.1], ['Calgary', 130.2]]);
});

test('US metro names use the principal city and keep the state for shared names', () => {
  assert.equal(usMetroName('New York-Jersey City-White Plains, NY-NJ (MSAD)'), 'New York');
  assert.equal(usMetroName('Portland-Vancouver-Hillsboro, OR-WA'), 'Portland, OR');
  assert.equal(usMetroName('Dallas, TX'), 'Dallas');
});

test('FHFA metro CSV: annual full history, quarterly only from the cut-off', () => {
  const csv = ['"Abilene, TX",10180,1975,1,-,-', '"Abilene, TX",10180,2009,1,100,( 1)', '"Abilene, TX",10180,2009,2,101,( 1)', '"Abilene, TX",10180,2009,3,102,( 1)', '"Abilene, TX",10180,2009,4,103,( 1)', '"Abilene, TX",10180,2026,1,345.67,( 5.88)'].join('\n');
  const rows = parseFhfaMetro(csv);
  assert.ok(rows.every(r => r.region === 'Abilene'));
  assert.deepEqual(rows.filter(r => r.frequency === 'Q').map(r => r.period), ['2026-Q1']);
  assert.ok(QUARTERLY_FROM > '2009-Q4');
  assert.deepEqual(rows.filter(r => r.frequency === 'A').map(r => [r.period, r.value]), [['2009', 101.5]]);
});

test('Case-Shiller and Zillow metro parsers', () => {
  const cs = parseCaseShiller('observation_date,NYXRSA\n2025-12-01,350\n2026-01-01,352', 'NYXRSA');
  assert.ok(cs.every(r => r.region === 'New York' && r.indicator === 'CASE_SHILLER_INDEX'));
  const z = ['RegionID,SizeRank,RegionName,RegionType,StateName,2025-12-31,2026-01-31', '1,0,United States,country,,300000,301000', '2,1,"New York, NY",msa,NY,690000,693000', '3,500,"Tiny, KS",msa,KS,100000,101000'].join('\n');
  const rows = parseZillowMetros(z, { indicator: 'AVG_PRICE', top: 150 });
  assert.deepEqual([...new Set(rows.map(r => r.region))], ['New York']);
});

test('ABS capital cities: sales by type plus a total, prices scaled by the unit multiplier', () => {
  const csv = ['DATAFLOW,MEASURE,REGION,FREQ,TIME_PERIOD,OBS_VALUE,UNIT_MEASURE,UNIT_MULT', 'x,1,1GSYD,Q,2026-Q1,8932,NUM,0', 'x,2,1GSYD,Q,2026-Q1,9891,NUM,0', 'x,3,1GSYD,Q,2026-Q1,1550,AUD,3', 'x,1,1RNSW,Q,2026-Q1,5,NUM,0'].join('\n');
  const rows = parseAbsCities(csv);
  assert.equal(rows.find(r => r.indicator === 'MEDIAN_PRICE').value, 1550000);
  assert.equal(rows.find(r => r.indicator === 'SALES_COUNT' && r.dwelling_type === '').value, 18823);
  assert.ok(rows.every(r => r.region === 'Sydney'));
});

test('Land Registry CSV parses with Welsh column names', () => {
  const csv = '"Name","URI","Region GSS code","Period","Sales volume","Reporting period","Pris cyfartalog Pob math o eiddo","Pris cyfartalog Tai ar wahân","Pris cyfartalog Tai pâr","Pris cyfartalog Tai teras","Pris cyfartalog Fflatiau a fflatiau deulawr","Pivotable date"\nManceinion,u,E08000003,2026-08,,monthly,256760,485089,334231,259816,199005,2026-08-01';
  const rows = parseUkHpi(csv, 'Manchester');
  assert.equal(rows.find(r => r.indicator === 'AVG_PRICE').value, 256760);
  assert.equal(rows.find(r => r.dwelling_type === 'condo').value, 199005);
});

test('City sales never stand in for a national sales series, except the Dubai proxy', () => {
  const rows = [
    { country: 'AUS', region: 'Sydney', frequency: 'Q', period: '2026-Q1', value: 100 },
    { country: 'GBR', region: '', frequency: 'M', period: '2026-01', value: 50000 },
    { country: 'GBR', region: 'Manchester', frequency: 'M', period: '2026-01', value: 400 },
    { country: 'ARE', region: 'Dubai', frequency: 'M', period: '2026-01', value: 15000 },
  ];
  const s = salesSeries(rows);
  assert.equal(s.AUS, undefined);
  assert.equal(s.GBR.region, '');
  assert.equal(s.ARE.region, 'Dubai');
});
