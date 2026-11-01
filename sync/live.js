#!/usr/bin/env node
// Daily live layer: current policy and mortgage rates, GDELT conflict signals, GDACS
// disasters and currency moves are turned into events. Rate moves since the projection
// origin and active events then shift the latest projection run automatically.
// Run:  node sync/live.js               (daily; catches up missing GDELT days)
//       node sync/live.js --backfill 90 (first run: build the 90-day conflict baseline)
// Also called by the Vercel cron route /api/cron/live.
import { connect, upsertRows } from '../lib/db.js';
import { migrate } from '../db/migrate.js';
import { fetchPolicyRates, fetchMortgageRates } from '../lib/live/rates.js';
import { fetchGdeltDay } from '../lib/live/gdelt.js';
import { fetchGdacs } from '../lib/live/gdacs.js';
import { fetchFx } from '../lib/live/fx.js';
import { detectEvents } from '../lib/live/detect.js';
import { countryShifts, HORIZONS, isSignificant } from '../lib/live/shifts.js';
import { runQuality } from './quality.js';
import { scoreAll, shiftComponents } from '../lib/engine/indexes.js';

const iso = d => d.toISOString().slice(0, 10);
const addDays = (date, n) => iso(new Date(Date.parse(date) + n * 864e5));
const pctFromLog = s => 100 * (Math.exp(s / 100) - 1);
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const CLASS_LABELS = { armed_conflict: 'Armed conflict', regional_conflict: 'Regional conflict spillover', natural_disaster: 'Natural disaster', currency_crisis: 'Currency crisis' };

async function all(db, sql, args = []) {
  return (await db.execute({ sql, args })).rows.map(r => ({ ...r }));
}

async function ingestGdelt(db, today, backfill, log) {
  const have = new Set((await all(db, "SELECT DISTINCT date FROM live_signals WHERE signal = 'conflict_mentions' AND date >= ?", [addDays(today, -120)])).map(r => r.date));
  const span = backfill ?? (have.size < 30 ? 90 : 5);
  const wanted = Array.from({ length: span }, (_, i) => addDays(today, -1 - i)).filter(d => !have.has(d));
  let fetched = 0;
  for (const date of wanted.reverse()) {
    try {
      const day = await fetchGdeltDay(date);
      if (!day) { log(`  GDELT ${date}: not published`); continue; }
      const rows = Object.entries(day).flatMap(([country, v]) => [
        { country, signal: 'conflict_mentions', date, value: v.conflict },
        { country, signal: 'all_mentions', date, value: v.all },
      ]);
      await upsertRows(db, 'live_signals', ['country', 'signal', 'date', 'value'], rows);
      fetched++;
      if (fetched % 10 === 0) log(`  GDELT ${fetched}/${wanted.length} days loaded (latest ${date})`);
    } catch (error) {
      log(`  GDELT ${date}: ${error.message}`);
    }
  }
  return { fetched, missing: wanted.length - fetched };
}

export async function runLive({ db = connect(), now = new Date(), log = console.log, backfill = null } = {}) {
  const started = Date.now();
  const today = iso(now);
  await migrate(db);

  const countries = await all(db, 'SELECT iso3, iso2, region, tier FROM countries');
  const byIso2 = new Map(countries.map(c => [c.iso2, c.iso3]));
  const regions = Object.fromEntries(countries.map(c => [c.iso3, c.region]));
  const valid = new Set(countries.map(c => c.iso3));

  // 1. Rates
  const policy = await fetchPolicyRates(byIso2, now).catch(e => { log(`  policy rates failed: ${e.message}`); return {}; });
  const mortgage = await fetchMortgageRates(now);
  await upsertRows(db, 'live_signals', ['country', 'signal', 'date', 'value'],
    Object.entries(policy).filter(([c]) => valid.has(c)).map(([country, p]) => ({ country, signal: 'policy_rate', date: p.date, value: p.value })));
  log(`Policy rates: ${Object.keys(policy).length} economies · mortgage rates: ${Object.keys(mortgage).join(', ') || 'none'}`);

  // 2. GDELT conflict signals
  const gdelt = await ingestGdelt(db, today, backfill, log);
  log(`GDELT: ${gdelt.fetched} new days loaded`);

  // 3. Disasters and currencies
  const disasters = await fetchGdacs(now).catch(e => { log(`  GDACS failed: ${e.message}`); return []; });
  const fx = await fetchFx(now).catch(e => { log(`  FX failed: ${e.message}`); return { moves: {} }; });
  if (fx.date) await upsertRows(db, 'live_signals', ['country', 'signal', 'date', 'value'],
    Object.entries(fx.moves).filter(([c]) => valid.has(c)).map(([country, m]) => ({ country, signal: 'fx_usd', date: fx.date, value: m.now })));
  log(`GDACS: ${disasters.length} qualifying alerts · FX: ${Object.keys(fx.moves).length} economies`);

  // 4. Detect events
  const sig = await all(db, "SELECT country, signal, date, value FROM live_signals WHERE signal IN ('conflict_mentions','all_mentions') AND date >= ? ORDER BY date", [addDays(today, -110)]);
  const histories = {};
  for (const r of sig) {
    const byDate = (histories[r.country] ||= new Map());
    const row = byDate.get(r.date) || byDate.set(r.date, { date: r.date, conflict: 0, all: 0 }).get(r.date);
    row[r.signal === 'conflict_mentions' ? 'conflict' : 'all'] = Number(r.value);
  }
  const historyArrays = Object.fromEntries(Object.entries(histories).filter(([c]) => valid.has(c)).map(([c, m]) => [c, [...m.values()].sort((a, b) => a.date.localeCompare(b.date))]));
  const previous = (await all(db, 'SELECT * FROM events')).map(e => ({ ...e, evidence: JSON.parse(e.evidence) }));
  const events = detectEvents({ today, histories: historyArrays, regions, disasters: disasters.filter(d => valid.has(d.iso3)), fxMoves: Object.fromEntries(Object.entries(fx.moves).filter(([c]) => valid.has(c))), previous });
  await upsertRows(db, 'events', ['id', 'country', 'class', 'status', 'onset', 'last_seen', 'intensity', 'metric', 'evidence', 'source', 'updated_at'],
    events.map(e => ({ ...e, evidence: JSON.stringify(e.evidence), updated_at: now.toISOString() })));
  const active = events.filter(e => e.status === 'active');

  // 5. Adjustments on top of the latest projection run
  const [run] = await all(db, 'SELECT id, summary FROM projection_runs ORDER BY created_at DESC LIMIT 1');
  if (!run) throw new Error('No projection run to adjust; run sync/train.js first');
  const summary = JSON.parse(run.summary);
  const contexts = (await all(db, 'SELECT * FROM country_context WHERE run_id = ?', [run.id])).map(c => ({ ...c, details: JSON.parse(c.details) }));
  const sens = (await all(db, 'SELECT target, horizon, coef, se, valid FROM rate_sensitivity WHERE run_id = ?', [run.id])).map(r => ({ ...r, coef: Number(r.coef), se: Number(r.se), valid: Number(r.valid) }));
  const library = (await all(db, 'SELECT class, target, horizon, effect, se, n_episodes FROM event_library WHERE run_id = ?', [run.id])).map(r => ({ ...r, effect: Number(r.effect), se: Number(r.se), n_episodes: Number(r.n_episodes) }));
  const targetRows = await all(db, 'SELECT DISTINCT country, target FROM projections WHERE run_id = ?', [run.id]);
  const targetsByCountry = {};
  for (const r of targetRows) (targetsByCountry[r.country] ||= []).push(r.target);
  const policyMonthly = await all(db, "SELECT country, period, value FROM observations WHERE indicator = 'POLICY_RATE' AND frequency = 'M' AND region = '' AND dwelling_type = ''");
  const prevState = Object.fromEntries((await all(db, 'SELECT * FROM live_state')).map(s => [s.country, s]));
  if (!library.length) log('  event_library is empty for the latest run: event shifts are zero until sync/train.js writes it');

  const adjustments = [], states = [], logs = [], componentsByCountry = {};
  for (const ctx of contexts) {
    const c = ctx.country;
    const originRates = policyMonthly.filter(r => r.country === c && String(r.period).startsWith(`${ctx.origin_year}-`)).map(r => Number(r.value));
    const originAvg = originRates.length ? originRates.reduce((s, v) => s + v, 0) / originRates.length : null;
    const now_ = policy[c];
    const delta = now_ && originAvg != null ? now_.value - originAvg : 0;
    const countryEvents = active.filter(e => e.country === c);
    const applying = countryEvents.filter(e => e.evidence?.applies);
    // Per-country rate sensitivities (scaled by household credit) when the run stored them.
    let countrySens = sens;
    try {
      const rs = (typeof ctx.details === 'string' ? JSON.parse(ctx.details) : ctx.details)?.rateSens;
      if (rs) countrySens = Object.entries(rs).filter(([, v]) => v && typeof v === 'object').flatMap(([target, byH]) => Object.entries(byH).map(([h, v]) => ({ target, horizon: Number(h), coef: Number(v.coef), se: Number(v.se), valid: Number(v.valid) })));
    } catch { /* fall back to pooled */ }
    const shifts = countryShifts({ targets: targetsByCountry[c] || [], delta, sens: countrySens, events: applying, library });
    for (const [target, byH] of Object.entries(shifts)) for (const h of HORIZONS) adjustments.push({ as_of: today, country: c, target, horizon: h, shift: +byH[h].shift.toFixed(4), extra_se: +byH[h].se.toFixed(4) });

    const explanation = [];
    const p10 = shifts.real_price?.[10]?.shift ?? 0, r10 = shifts.real_rent?.[10]?.shift ?? 0;
    if (now_ && originAvg != null) {
      const at = h => { const s = sens.find(r => r.target === 'real_price' && r.horizon === h); return s && s.valid ? s.coef * delta : 0; };
      explanation.push({ kind: 'rate', text: `Policy rate ${now_.value.toFixed(2)}% (${now_.date}) vs ${originAvg.toFixed(2)}% average in ${ctx.origin_year} → ${signed(delta, 2)}pp → real price path ${signed(pctFromLog(at(3)))}% at 3 years, ${signed(pctFromLog(at(10)))}% at 10 years` });
    }
    if (mortgage[c]) explanation.push({ kind: 'mortgage', text: `Mortgage rate ${mortgage[c].value.toFixed(2)}% (${mortgage[c].date}, ${mortgage[c].source})` });
    const eventSummaries = [];
    for (const e of countryEvents) {
      const lib = library.find(l => l.class === e.class && l.target === 'real_price' && l.horizon === 3);
      const effect3 = lib ? pctFromLog(lib.effect) : null;
      const label = CLASS_LABELS[e.class] || e.class;
      const evidenceText = e.class === 'natural_disaster' ? `${e.evidence.alert} GDACS alert: ${e.evidence.name}`
        : e.class === 'currency_crisis' ? `${e.evidence.currency} ${signed(e.evidence.changePct)}% vs USD over 90 days`
        : e.class === 'regional_conflict' ? `conflict news share z=${e.evidence.z} while ${e.evidence.conflictCountries.join(', ')} ${e.evidence.conflictCountries.length > 1 ? 'are' : 'is'} in armed conflict`
        : e.evidence.mode === 'ongoing' ? `conflict news share ${(e.evidence.share * 100).toFixed(1)}% vs ${(e.evidence.globalShare * 100).toFixed(1)}% global median` : `conflict news share z=${e.evidence.z}`;
      const clear = isSignificant(library, e.class, 'real_price') || isSignificant(library, e.class, 'real_rent');
      explanation.push(!e.evidence?.applies
        ? { kind: 'event', text: e.class === 'natural_disaster'
          ? `${label} (${evidenceText}): only Red alerts move national paths, so no adjustment`
          : `${label}, ongoing (${evidenceText}): already reflected in the data the model trained on, so no extra adjustment` }
        : effect3 == null ? { kind: 'event', text: `${label} detected ${e.onset} (${evidenceText}) → no historical episodes to size it, so no shift` }
        : !clear ? { kind: 'event', text: `${label} detected ${e.onset} (${evidenceText}) → past episodes show no clear effect (${signed(effect3)}% ± ${lib.se.toFixed(1)} over 3 years, ${lib.n_episodes} episodes), so no shift` }
        : { kind: 'event', text: `${label} detected ${e.onset} (${evidenceText}) → typical effect ${signed(effect3)}% on real prices over 3 years (${lib.n_episodes} past episodes)` });
      eventSummaries.push({ id: e.id, class: e.class, onset: e.onset, intensity: e.intensity, metric: e.metric, applies: !!e.evidence?.applies, effect3, n_episodes: lib?.n_episodes ?? 0 });
    }
    states.push({ country: c, as_of: today, run_id: run.id, policy_rate_now: now_?.value ?? null, policy_rate_date: now_?.date ?? null, policy_rate_origin: originAvg, rate_delta: now_ && originAvg != null ? +delta.toFixed(4) : null,
      events: JSON.stringify(eventSummaries), shift10_price: +p10.toFixed(4), shift10_rent: +r10.toFixed(4), explanation: JSON.stringify(explanation) });

    // Live persona components: rate-driven burden/trend via shiftComponents, then projected
    // growth replaced by base + total live shift (rate and events).
    const base = ctx.details.components || {};
    const shifted = shiftComponents(base, delta, {}, ctx.mortgage_rate);
    const add = (v, s) => (Number.isFinite(v) && Number.isFinite(s) ? v + s : v);
    componentsByCountry[c] = { ...shifted, proj3Price: add(base.proj3Price, shifts.real_price?.[3]?.shift), proj10Price: add(base.proj10Price, p10), proj10Rent: add(base.proj10Rent, shifts.real_rent?.[10]?.shift) };

    const prev = prevState[c];
    if (prev && now_ && prev.policy_rate_now != null && Math.abs(now_.value - Number(prev.policy_rate_now)) >= 0.25)
      logs.push({ date: today, country: c, kind: 'rate_change', message: `Policy rate moved from ${Number(prev.policy_rate_now).toFixed(2)}% to ${now_.value.toFixed(2)}%`, delta10: +(p10 - Number(prev.shift10_price || 0)).toFixed(4) });
    const prevIds = new Set(prev ? JSON.parse(prev.events).map(e => e.id) : []);
    for (const e of countryEvents) if (!prevIds.has(e.id)) logs.push({ date: today, country: c, kind: 'event_start', message: `${CLASS_LABELS[e.class]} detected (${e.metric}: ${e.intensity})${e.evidence?.applies ? '' : ', ongoing, no extra adjustment'}`, delta10: +(p10 - Number(prev?.shift10_price || 0)).toFixed(4) });
    for (const id of prevIds) if (!countryEvents.some(e => e.id === id)) logs.push({ date: today, country: c, kind: 'event_end', message: `${CLASS_LABELS[id.split(':')[1]] || id} ended`, delta10: +(p10 - Number(prev?.shift10_price || 0)).toFixed(4) });
  }
  // Events in Tier 2 countries are logged too, so the /live page shows them.
  const tier1 = new Set(contexts.map(c => c.country));
  const prevEventIds = new Set(previous.filter(e => e.status === 'active').map(e => e.id));
  for (const e of active) if (!tier1.has(e.country) && !prevEventIds.has(e.id)) logs.push({ date: today, country: e.country, kind: 'event_start', message: `${CLASS_LABELS[e.class]} detected (${e.metric}: ${e.intensity}); no house price projection to adjust`, delta10: null });

  const { rows: personaRows } = scoreAll(componentsByCountry);
  await db.execute({ sql: 'DELETE FROM live_adjustments WHERE as_of = ?', args: [today] });
  await upsertRows(db, 'live_adjustments', ['as_of', 'country', 'target', 'horizon', 'shift', 'extra_se'], adjustments);
  await db.execute('DELETE FROM live_state');
  await upsertRows(db, 'live_state', ['country', 'as_of', 'run_id', 'policy_rate_now', 'policy_rate_date', 'policy_rate_origin', 'rate_delta', 'events', 'shift10_price', 'shift10_rent', 'explanation'], states);
  await db.execute({ sql: 'DELETE FROM persona_indexes_live WHERE as_of = ?', args: [today] });
  await upsertRows(db, 'persona_indexes_live', ['as_of', 'country', 'persona', 'score', 'rank', 'components'], personaRows.map(r => ({ ...r, as_of: today, components: JSON.stringify(r.components) })));
  if (logs.length) await upsertRows(db, 'live_log', ['date', 'country', 'kind', 'message', 'delta10'], logs);
  const cutoff = addDays(today, -14);
  await db.batch([
    { sql: 'DELETE FROM live_adjustments WHERE as_of < ?', args: [cutoff] },
    { sql: 'DELETE FROM persona_indexes_live WHERE as_of < ?', args: [cutoff] },
    { sql: 'DELETE FROM live_signals WHERE date < ?', args: [addDays(today, -200)] },
  ], 'write');

  const biggest = states.map(s => ({ country: s.country, price10: +pctFromLog(s.shift10_price).toFixed(2), rent10: +pctFromLog(s.shift10_rent).toFixed(2), rateDelta: s.rate_delta })).sort((a, b) => Math.abs(b.price10) - Math.abs(a.price10)).slice(0, 10);
  const result = {
    asOf: today, runId: run.id, seconds: Math.round((Date.now() - started) / 1000), gdeltDaysLoaded: gdelt.fetched, policyRates: Object.keys(policy).length,
    countriesAdjusted: states.length, eventLibraryRows: library.length,
    activeEvents: active.map(e => ({ country: e.country, class: e.class, intensity: e.intensity, applies: !!e.evidence?.applies, onset: e.onset })),
    biggestShifts: biggest, logEntries: logs.length, personaScores: personaRows.length, mortgageSpread: summary.mortgageSpread,
  };
  // Cheap live-layer quality checks after every daily run (never blocks the run).
  try {
    const q = await runQuality({ db, live: true, now });
    result.quality = Object.fromEntries(['pass', 'warn', 'fail'].map(k => [k, q.checks.filter(c => c.severity === k).length]));
  } catch (e) { log(`  quality checks failed: ${e.message}`); }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--backfill');
  const backfill = i > -1 ? Number(process.argv[i + 1]) || 90 : null;
  runLive({ backfill }).then(r => {
    console.log(`\nLive layer ${r.asOf} (run ${r.runId}) in ${r.seconds}s: ${r.countriesAdjusted} countries adjusted, ${r.activeEvents.length} active events`);
    for (const e of r.activeEvents) console.log(`  ${e.country.padEnd(4)} ${e.class.padEnd(18)} ${String(e.intensity).padStart(7)}  ${e.applies ? 'applies' : 'ongoing, no shift'}  since ${e.onset}`);
    console.log('Biggest 10-year real price shifts:');
    for (const b of r.biggestShifts) console.log(`  ${b.country}  price ${b.price10}%  rent ${b.rent10}%  rate Δ ${b.rateDelta ?? '–'}pp`);
  }).catch(error => { console.error(error.stack || error); process.exit(1); });
}
