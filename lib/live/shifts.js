// Live shifts (pure): how a rate move since the projection origin and active events move
// each projected path. Units: x100 log points on the cumulative path, like the toggle.
export const HORIZONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const EVENT_CAP = 40;
// An event class moves projections only if its historical effect on that target is clear
// at some horizon: |effect| >= Z_MIN × se. Noisy classes are shown but shift nothing.
export const Z_MIN = 1.64;

export function isSignificant(library, cls, family) {
  return library.some(r => r.class === cls && r.target === family && r.se > 0 && Math.abs(r.effect) >= Z_MIN * r.se);
}

// Which sensitivity / event-library series a projection target uses.
export function familyOf(target) {
  if (target === 'real_rent' || target === 'nominal_rent') return { rate: 'real_rent', event: 'real_rent' };
  if (target.startsWith('real_price:')) return { rate: 'type_price', event: 'real_price' };
  return { rate: 'real_price', event: 'real_price' };
}

// sens: [{target, horizon, coef, se, valid}]
export function rateShift(delta, sens, family) {
  const out = {};
  for (const h of HORIZONS) {
    const s = sens.find(r => r.target === family && r.horizon === h);
    out[h] = s && s.valid && Number.isFinite(delta) ? { shift: s.coef * delta, se: Math.abs(s.se * delta) } : { shift: 0, se: 0 };
  }
  return out;
}

// events: active events that apply; library: [{class, target, horizon, effect, se, n_episodes}]
// Effects exist for h = 1..3 and are held at the h = 3 level afterwards (a level shift).
export function eventShift(events, library, family) {
  const out = Object.fromEntries(HORIZONS.map(h => [h, { shift: 0, var: 0 }]));
  for (const e of events) {
    if (!isSignificant(library, e.class, family)) continue;
    for (const h of HORIZONS) {
      const hh = Math.min(h, 3);
      const row = library.find(r => r.class === e.class && r.target === family && r.horizon === hh);
      if (!row) continue;
      out[h].shift += row.effect;
      out[h].var += row.se ** 2;
    }
  }
  return Object.fromEntries(HORIZONS.map(h => [h, { shift: Math.max(-EVENT_CAP, Math.min(EVENT_CAP, out[h].shift)), se: Math.sqrt(out[h].var) }]));
}

// All live adjustments for one country: { [target]: { [h]: { shift, se } } }
export function countryShifts({ targets, delta, sens, events, library }) {
  const result = {};
  for (const target of targets) {
    if (target === 'price_to_rent') continue;
    const fam = familyOf(target);
    const r = rateShift(delta, sens, fam.rate), e = eventShift(events, library, fam.event);
    result[target] = Object.fromEntries(HORIZONS.map(h => [h, { shift: r[h].shift + e[h].shift, se: Math.hypot(r[h].se, e[h].se) }]));
  }
  if (targets.includes('price_to_rent') && result.nominal_price && result.nominal_rent) {
    result.price_to_rent = Object.fromEntries(HORIZONS.map(h => [h, { shift: result.nominal_price[h].shift - result.nominal_rent[h].shift, se: Math.hypot(result.nominal_price[h].se, result.nominal_rent[h].se) }]));
  }
  return result;
}
