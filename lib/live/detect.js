import { salesYoY, isSlump, SLUMP_THRESHOLD } from '../engine/events.js';
// Event detection rules (pure). Inputs are daily signal histories and the previous
// event register; output is the new event register. Events apply automatically.
//
// armed_conflict has two modes:
//   escalation: the conflict share of GDELT mentions spikes vs the country's own 90-day
//               baseline. This is news the projection model has not seen, so it shifts paths.
//   ongoing:    a persistently high conflict share (a long-running war). Already reflected in
//               the data the model trained on, so it is shown but applies no extra shift.
export const RULES = {
  baselineDays: 90, recentDays: 7, minBaselineDays: 20,
  // Tuned on Aug-Oct 2026 GDELT: long-running wars (UKR, ISR, RUS, YEM) sit at 2.3-6x the
  // global median conflict share; quiet large countries (CAN, GBR, IND, CHN) stay below 1.
  escalationZ: 3, escalationFloor: 1000,      // 7-day conflict mentions
  ongoingRatio: 2.2, ongoingFloor: 5000,      // share vs global median share; 7-day mentions
  holdZ: 1.5, expireDays: 30,
  regionalZ: 1.5, regionalFloor: 500,
  disasterDays: 60,
  currencyDrop: -15,
};

const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// history: [{date, conflict, all}] ascending. Returns z, recent share, 7-day mentions.
export function conflictStats(history, rules = RULES) {
  const rows = history.filter(r => r.all > 0);
  if (rows.length < rules.recentDays + rules.minBaselineDays) return null;
  const recent = rows.slice(-rules.recentDays);
  const base = rows.slice(-(rules.recentDays + rules.baselineDays), -rules.recentDays);
  const share = r => r.conflict / r.all;
  const recentShare = recent.reduce((s, r) => s + r.conflict, 0) / recent.reduce((s, r) => s + r.all, 0);
  const baseShares = base.map(share);
  const z = (recentShare - mean(baseShares)) / Math.max(sd(baseShares), 0.01);
  return { z, recentShare, baseShare: mean(baseShares), mentions7: recent.reduce((s, r) => s + r.conflict, 0), lastDate: recent.at(-1).date };
}

export function detectEvents({ today, histories, regions, disasters = [], fxMoves = {}, previous = [], rules = RULES }) {
  const prevActive = new Map(previous.filter(e => e.status === 'active').map(e => [`${e.country}:${e.class}`, e]));
  const stats = Object.fromEntries(Object.entries(histories).map(([iso3, h]) => [iso3, conflictStats(h, rules)]).filter(([, s]) => s));
  const globalShare = median(Object.values(stats).map(s => s.recentShare));
  const found = [];
  const make = (country, cls, onsetIfNew, intensity, metric, evidence, source) => {
    const prev = prevActive.get(`${country}:${cls}`);
    const onset = prev ? prev.onset : onsetIfNew;
    found.push({ id: `${country}:${cls}:${onset}`, country, class: cls, status: 'active', onset, last_seen: today, intensity: +intensity.toFixed(2), metric, evidence, source });
  };

  for (const [iso3, s] of Object.entries(stats)) {
    const ratio = globalShare > 0 ? s.recentShare / globalShare : 0;
    const escalation = s.z >= rules.escalationZ && s.mentions7 >= rules.escalationFloor;
    const ongoing = ratio >= rules.ongoingRatio && s.mentions7 >= rules.ongoingFloor;
    const prev = prevActive.get(`${iso3}:armed_conflict`);
    const held = prev && (s.z >= rules.holdZ || (ongoing && prev.evidence?.mode === 'ongoing'));
    if (escalation || ongoing || held) {
      // An escalation that started while a war was already 'ongoing' keeps the ongoing mode.
      const mode = escalation && !(prev?.evidence?.mode === 'ongoing') ? 'escalation' : prev?.evidence?.mode || (escalation ? 'escalation' : 'ongoing');
      make(iso3, 'armed_conflict', today, escalation ? s.z : ratio, escalation ? 'conflict share z-score vs 90-day baseline' : 'conflict share vs global median',
        { mode, applies: mode === 'escalation', z: +s.z.toFixed(2), share: +s.recentShare.toFixed(4), baseShare: +s.baseShare.toFixed(4), globalShare: +globalShare.toFixed(4), mentions7: s.mentions7 }, 'GDELT 1.0 daily events');
    }
  }

  const conflictRegions = new Set(found.filter(e => e.class === 'armed_conflict').map(e => regions[e.country]).filter(Boolean));
  for (const [iso3, s] of Object.entries(stats)) {
    if (found.some(e => e.country === iso3 && e.class === 'armed_conflict')) continue;
    if (!conflictRegions.has(regions[iso3])) continue;
    const prev = prevActive.get(`${iso3}:regional_conflict`);
    if ((s.z >= rules.regionalZ && s.mentions7 >= rules.regionalFloor) || (prev && s.z >= 1)) {
      const sources = found.filter(e => e.class === 'armed_conflict' && regions[e.country] === regions[iso3]).map(e => e.country);
      make(iso3, 'regional_conflict', today, s.z, 'own conflict share z-score, with an armed conflict active in the same region',
        { applies: true, z: +s.z.toFixed(2), mentions7: s.mentions7, region: regions[iso3], conflictCountries: sources }, 'GDELT 1.0 daily events');
    }
  }

  for (const d of disasters) {
    if (!d.date || daysBetween(d.date, today) > rules.disasterDays) continue;
    if (found.some(e => e.country === d.iso3 && e.class === 'natural_disaster')) continue;
    make(d.iso3, 'natural_disaster', d.date, d.level === 'Red' ? 3 : 2, 'GDACS alert level (3 red, 2 orange)', { applies: d.level === 'Red', alert: d.level, type: d.type, name: d.name, gdacsId: d.id }, 'GDACS');
  }

  for (const [iso3, m] of Object.entries(fxMoves)) {
    const prev = prevActive.get(`${iso3}:currency_crisis`);
    if (m.changePct <= rules.currencyDrop || (prev && m.changePct <= rules.currencyDrop / 2)) {
      make(iso3, 'currency_crisis', today, -m.changePct, 'currency change vs USD over 90 days (%)', { applies: true, currency: m.currency, changePct: +m.changePct.toFixed(2) }, 'ECB reference rates via Frankfurter');
    }
  }

  // Previously active events not re-detected stay active until their hold period lapses.
  for (const [key, prev] of prevActive) {
    if (found.some(e => `${e.country}:${e.class}` === key)) continue;
    const lapse = prev.class === 'natural_disaster' ? rules.disasterDays : rules.expireDays;
    const anchor = prev.class === 'natural_disaster' ? prev.onset : prev.last_seen;
    found.push({ ...prev, status: daysBetween(anchor, today) > lapse ? 'expired' : 'active' });
  }
  return found;
}

// Transaction slump: registered sales over the latest 3 months (or latest quarter) vs the same
// period a year earlier, from land-registry sales counts. Series selection and the year-on-year
// window come from lib/engine/events.js so detection matches the calibration exactly.
// `applies` is decided by the caller from the calibrated event library (statistically clear or not).
// sales: { iso3: { region, freq: 'M'|'Q', points } } from salesSeries(), or the older
// { iso3: { region, monthly } } shape.
export function detectSalesSlumps({ today, sales, threshold = SLUMP_THRESHOLD, applies = false, maxStaleMonths = 9 }) {
  const out = [];
  const nowMonths = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  for (const [country, entry] of Object.entries(sales)) {
    const series = entry.points ? { country, ...entry } : { country, region: entry.region, freq: 'M', points: entry.monthly };
    if (Object.keys(series.points).length < (series.freq === 'M' ? 15 : 5)) continue;
    const latest = salesYoY(series).at(-1);
    if (!latest || !isSlump(latest, threshold)) continue;
    const p = latest.period;
    const endMonth = Number(p.slice(0, 4)) * 12 + (p.includes('-Q') ? (Number(p.slice(-1)) - 1) * 3 + 2 : Number(p.slice(5, 7)) - 1);
    if (nowMonths - endMonth > maxStaleMonths) continue;
    const months = series.freq === 'M' ? Object.keys(series.points).sort().filter(m => m <= p).slice(-3) : [p];
    const onset = p.includes('-Q') ? `${p.slice(0, 4)}-${String((Number(p.slice(-1)) - 1) * 3 + 1).padStart(2, '0')}-01` : `${p}-01`;
    out.push({ id: `${country}:transaction_slump:${p}`, country, class: 'transaction_slump', status: 'active', onset, last_seen: today,
      intensity: +latest.yoyPct.toFixed(1), metric: `registered sales, ${series.freq === 'M' ? '3 months' : 'latest quarter'} vs a year earlier (%)`,
      evidence: { applies, region: series.region, months, yoyPct: +latest.yoyPct.toFixed(1), twoYearPct: latest.twoYearPct == null ? null : +latest.twoYearPct.toFixed(1) }, source: 'Land registry sales counts' });
  }
  return out;
}
