import "server-only";
import { applyLive, backtests, citySummaries, contexts, countryNotes, liveShifts, projections, regionsFor, type Context, type Country, type LiveState, type Observation, type Run } from "@/lib/data";
import driversFallback from "../../data/derived/country-drivers.json";
import { EVENT_LABELS, TYPE_LABELS } from "@/lib/labels";
import type { Band, SensMap } from "@/lib/toggle";

// Everything the narrative generator may cite, assembled from Turso. The generator never
// computes a new figure from these beyond rounding, so the prose can be checked against them.
export type NarrativeInput = Record<string, unknown> & { name: string; tier: number };

const toPct = (logPts: number) => 100 * (Math.exp(logPts / 100) - 1);
// True median: mean of the two middle values when the count is even.
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
// Rank against the other markets only, so a country never ranks below the count.
const rankDesc = (others: number[], v: number) => others.filter((x) => x > v).length + 1;
const lastYear = (series?: Record<string, number>) => { const ys = Object.keys(series ?? {}).map(Number).filter((y) => Number.isFinite(series![y])); return ys.length ? Math.max(...ys) : null; };
const at = (rows: Band[] | undefined, h: number) => rows?.find((r) => r.horizon === h);
const band = (rows: Band[] | undefined) => {
  if (!rows?.length) return null;
  const pick = (h: number) => { const r = at(rows, h); return r ? { median: r.median - 100, p10: r.p10 - 100, p90: r.p90 - 100 } : null; };
  return { h1: pick(1), h3: pick(3), h5: pick(5), h10: pick(10) };
};

function history(series: Record<string, number> | undefined, origin: number | null) {
  if (!series || origin == null || !series[origin]) return null;
  const v = (y: number) => series[y];
  const ch = (k: number) => (v(origin - k) ? 100 * (v(origin) / v(origin - k) - 1) : null);
  const window = Object.entries(series).map(([y, x]) => [Number(y), x] as const).filter(([y]) => y >= origin - 25 && y <= origin);
  const peak = window.reduce((m, p) => (p[1] > m[1] ? p : m), window[0]);
  return { change10: ch(10), change5: ch(5), peakYear: peak?.[0] ?? null, belowPeak: peak ? 100 * (1 - v(origin) / peak[1]) : null, atPeak: peak?.[0] === origin };
}

// Turning points of a real price index: a zigzag that only registers a reversal of at least
// `threshold` percent, so the prose describes the booms and corrections, not annual noise.
// Returns up to the last three legs, each with its real and (where available) nominal change.
export function pricePhases(real: Record<string, number> | undefined, nominal: Record<string, number> | undefined, origin: number | null, threshold = 8, window = 25) {
  if (!real || origin == null) return [];
  const pts = Object.entries(real).map(([y, v]) => [Number(y), v] as const).filter(([y, v]) => y >= origin - window && y <= origin && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  if (pts.length < 4) return [];
  const pivots: (readonly [number, number])[] = [pts[0]];
  let trend = 0, ext = pts[0];
  for (const p of pts.slice(1)) {
    if (trend >= 0 && p[1] >= ext[1]) { ext = p; if (trend === 0 && p[1] > pts[0][1] * (1 + threshold / 100)) trend = 1; continue; }
    if (trend <= 0 && p[1] <= ext[1]) { ext = p; if (trend === 0 && p[1] < pts[0][1] * (1 - threshold / 100)) trend = -1; continue; }
    if (trend >= 0 && p[1] < ext[1] * (1 - threshold / 100)) { if (ext !== pivots.at(-1)) pivots.push(ext); trend = -1; ext = p; continue; }
    if (trend <= 0 && p[1] > ext[1] * (1 + threshold / 100)) { if (ext !== pivots.at(-1)) pivots.push(ext); trend = 1; ext = p; }
  }
  if (ext !== pivots.at(-1)) pivots.push(ext);
  if (pivots.at(-1)![0] !== origin) pivots.push(pts.at(-1)!);
  const legs = pivots.slice(1).map((p, i) => {
    const a = pivots[i];
    const n0 = nominal?.[a[0]], n1 = nominal?.[p[0]];
    return { from: a[0], to: p[0], real: 100 * (p[1] / a[1] - 1), nominal: n0 && n1 ? 100 * (n1 / n0 - 1) : null };
  }).filter((l) => l.to > l.from);
  return legs.slice(-3);
}

// Converts a stored driver breakdown (log points) into percentage-point shares of the projected
// percentage change, scaled so the parts add up to the headline figure.
type DriverRow = { name: string; value: number; typical: number; contribution: number };
type Drivers = { method: string; weight?: number; base?: number; anchor?: number; features?: DriverRow[]; total: number | null };
function driverShares(d: Drivers | undefined | null) {
  if (!d || d.total == null || !d.features) return null;
  const pct = toPct(d.total);
  const k = Math.abs(d.total) > 0.5 ? pct / d.total : 1;
  return { method: d.method, weight: d.weight ?? 1, totalPct: pct, base: (d.base ?? 0) * k, anchor: (d.anchor ?? 0) * k,
    features: d.features.map((f) => ({ name: f.name, value: f.value, typical: f.typical, contribution: f.contribution * k })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)) };
}

export async function buildNarrativeInput(args: {
  c: Country; ctx: Context | undefined; run: Run | null; live: LiveState | null;
  panel: Record<string, Record<string, number>> & { TYPE_REAL?: Record<string, Record<string, number>> };
  observations: Observation[];
  explorer: { bands: { real_price: Band[]; real_rent: Band[]; types: Record<string, Band[]> }; history: { types: Record<string, { year: number; value: number }[]> }; sens: { real_price?: SensMap; real_rent?: SensMap }; sensNotes: { priceValid: boolean } } | null;
  flagLabels: string[]; flagIds?: string[]; allCountries: Country[];
}): Promise<NarrativeInput> {
  const { c, ctx, run, live, panel, observations, explorer, flagLabels, flagIds, allCountries } = args;
  const latestObs = (indicator: string, region = "") => observations.filter((o) => o.indicator === indicator && o.region === region && !o.dwelling_type && o.frequency === "A" && o.status === "actual").at(-1);

  if (!explorer || !ctx || !run || c.tier !== 1) {
    const drivers = [
      ["POP_GROWTH", "Population growth", (v: number) => `${v.toFixed(1)}%`],
      ["URBAN_GROWTH", "Urban growth", (v: number) => `${v.toFixed(1)}%`],
      ["INFLATION", "Inflation", (v: number) => `${v.toFixed(1)}%`],
      ["GDP_PC_USD", "GDP per head", (v: number) => `$${Math.round(v).toLocaleString("en")}`],
      ["LENDING_RATE", "Lending rate", (v: number) => `${v.toFixed(1)}%`],
      ["PRIVATE_CREDIT", "Private credit", (v: number) => `${Math.round(v)}% GDP`],
    ] as const;
    return {
      name: c.name, tier: c.tier,
      drivers: drivers.map(([key, label, display]) => { const o = latestObs(key); return o ? { key, label, value: Number(o.value), display: display(Number(o.value)), period: o.period } : null; }).filter(Boolean),
    };
  }

  // Tier 1 medians and ranks from live-adjusted projections across all markets.
  const [all, shifts, ctxs, bts, regionList, cityList, notes] = await Promise.all([projections(), liveShifts(), contexts(), backtests(), regionsFor(c.iso3), citySummaries(c.iso3), countryNotes(c.iso3)]);
  const tenYear = (target: string) => Object.fromEntries(all.filter((p) => p.target === target && p.horizon === 10).map((p) => [p.country, applyLive([p], shifts[p.country]?.[target])[0].median - 100]));
  const price10 = tenYear("real_price"), rent10 = tenYear("real_rent");
  const others = (m: Record<string, number>) => Object.entries(m).filter(([k]) => k !== c.iso3).map(([, v]) => v);
  const priceVals = others(price10), rentVals = others(rent10);
  const myPrice = band(explorer.bands.real_price)!, myRent = band(explorer.bands.real_rent);
  const region = c.region;
  const peerIsos = allCountries.filter((x) => x.tier === 1 && x.region === region && x.iso3 !== c.iso3).map((x) => x.iso3);
  const peerVals = peerIsos.map((i) => price10[i]).filter((v) => Number.isFinite(v));

  const stressCount = ctxs.filter((x) => x.details.stress?.score != null).length;
  const bt = (target: string, h: number) => bts.find((b) => b.target === target && b.horizon === h);
  const p10bt = bt("real_price", 10);

  const sensPct = (m: SensMap | undefined, h: number) => (m?.[h] ? toPct(m[h].coef) : null);
  const coef10 = explorer.sens.real_price?.[10]?.coef;
  const delta = live?.rate_delta ?? null;

  const types = Object.entries(explorer.bands.types).map(([t, rows]) => {
    const hist = explorer.history.types[t] ?? [];
    const last5 = hist.length > 5 ? 100 * (hist.at(-1)!.value / hist.at(-6)!.value - 1) : null;
    const r = at(rows, 10);
    return { type: t, label: TYPE_LABELS[t] ?? t, h10: r ? r.median - 100 : null, last5 };
  });

  // City rents (latest year across metros) and national vacancy, where agencies publish them.
  const cityRents = observations.filter((o) => o.indicator === "AVG_RENT_2BR" && o.region && o.frequency === "A");
  const rentYear = cityRents.reduce((m, o) => (o.period > m ? o.period : m), "");
  const latestRents = cityRents.filter((o) => o.period === rentYear).sort((a, b) => a.value - b.value);
  const vacancy = latestObs("VACANCY_RATE");

  const events = (live?.events ?? []).map((e) => {
    const label = EVENT_LABELS[e.class] ?? e.class;
    const text = live?.explanation.find((x) => x.kind === "event" && x.text.startsWith(label))?.text ?? "";
    return {
      class: e.class, label, onset: e.onset, intensity: e.intensity, applies: !!(e as { applies?: boolean }).applies,
      effect3: e.effect3 ?? null, episodes: e.n_episodes ?? null, clear: /typical effect/.test(text),
      region: text.match(/\(([A-Z][\w ]+?) registered sales/)?.[1] ?? null,
    };
  });

  // Projection drivers: stored with the run, or the exported file while database writes were blocked.
  const storedDrivers = (ctx.details as { drivers?: Record<string, Drivers>; rentDrivers?: Record<string, Drivers> });
  const fileDrivers = (driversFallback as unknown as { countries: Record<string, { drivers: Record<string, Drivers> | null; rentDrivers: Record<string, Drivers> | null }> }).countries[c.iso3];
  const drv = storedDrivers.drivers ?? fileDrivers?.drivers ?? null;
  const rentDrv = storedDrivers.rentDrivers ?? fileDrivers?.rentDrivers ?? null;
  // Live adjustments sit on top of the model path; the breakdown explains the model path.
  const modelPrice10 = drv?.["10"]?.total != null ? toPct(drv["10"].total) : null;

  // Macro backdrop from the national observations (latest actual, IMF forecasts ahead).
  const obsA = (indicator: string, status = "actual") => observations.filter((o) => o.indicator === indicator && !o.region && !o.dwelling_type && o.frequency === "A" && o.status === status);
  const latestA = (indicator: string) => obsA(indicator).at(-1);
  const valueIn = (indicator: string, year: number) => obsA(indicator).find((o) => Number(o.period) === year);
  const gdpAhead = observations.filter((o) => o.indicator === "GDP_GROWTH" && !o.region && o.frequency === "A" && Number(o.period) > ctx.origin_year && Number(o.period) <= ctx.origin_year + 5).map((o) => Number(o.value));
  const credit = latestA("HH_CREDIT"), credit5 = credit ? valueIn("HH_CREDIT", Number(credit.period) - 5) : undefined;
  const gdp = latestA("GDP_GROWTH"), pop = latestA("POP_GROWTH"), urban = latestA("URBAN_SHARE");
  const inflPath = Object.values(ctx.details.inflation ?? {}).map(Number).filter(Number.isFinite);
  const inflAvg = inflPath.length ? inflPath.reduce((a, b) => a + b, 0) / inflPath.length : null;
  const cumInfl = inflPath.length ? 100 * (inflPath.reduce((acc, v) => acc * (1 + v / 100), 1) - 1) : null;

  // Policy rate: the daily live reading when it is newer than the monthly series in the run.
  const monthlyPolicy = observations.filter((o) => o.indicator === "POLICY_RATE" && !o.region && o.frequency === "M").sort((a, b) => a.period.localeCompare(b.period));
  const liveNewer = live?.policy_rate_now != null && live.policy_rate_date && (!ctx.policy_rate_as_of || live.policy_rate_date.slice(0, 7) > ctx.policy_rate_as_of);
  const policyNow = liveNewer ? live!.policy_rate_now! : ctx.policy_rate;
  const policyAsOf = liveNewer ? live!.policy_rate_date! : ctx.policy_rate_as_of;
  // Last change: the live reading against the latest monthly value, else the last monthly step.
  let lastMove: { size: number; from: number; since: string } | null = null;
  if (liveNewer && ctx.policy_rate != null && Math.abs(live!.policy_rate_now! - ctx.policy_rate) >= 0.05) lastMove = { size: live!.policy_rate_now! - ctx.policy_rate, from: ctx.policy_rate, since: ctx.policy_rate_as_of ?? "" };
  else for (let i = monthlyPolicy.length - 1; i > 0; i--) {
    const d = Number(monthlyPolicy[i].value) - Number(monthlyPolicy[i - 1].value);
    if (Math.abs(d) >= 0.05) { lastMove = { size: d, from: Number(monthlyPolicy[i - 1].value), since: monthlyPolicy[i].period }; break; }
  }
  const mortgageIsProxy = !!ctx.mortgage_rate_source?.startsWith("policy");
  const mortgageNow = mortgageIsProxy && policyNow != null ? Math.max(0.1, policyNow + (run.summary.mortgageSpread ?? 2)) : ctx.mortgage_rate;

  // Cities: price changes (nominal, as published) and the national nominal change to compare.
  const cityPrices = cityList.filter((x) => x.price && x.price.change5y != null).map((x) => ({ name: x.name, change5y: x.price!.change5y!, change1y: x.price!.change1y, period: x.price!.period, kind: x.price!.kind }));
  const nat5 = (() => { const n = panel.NPRICE; if (!n) return null; const y = lastYear(n); return y && n[y - 5] ? 100 * (n[y] / n[y - 5] - 1) : null; })();

  const ptiYear = lastYear(panel.PTI_AVG);
  const ptrYear = lastYear(panel.PTR_AVG);
  const latestYear = run.summary.latestYear;
  const mortgageSource = ctx.mortgage_rate_source ?? null;
  const sig = (ctx.details.signals ?? {}) as Record<string, { label: string; support: string[]; oppose: string[] }>;

  return {
    name: c.name, iso3: c.iso3, tier: 1, region,
    bandLevel: 80, loanToValue: 80, rentBurden: 30, debtServiceWindow: 15,
    originYear: ctx.origin_year, rentOriginYear: ctx.rent_origin_year, latestYear,
    stale: ctx.origin_year <= latestYear - 2, stale_rent: ctx.rent_origin_year != null && ctx.rent_origin_year <= latestYear - 2,
    price: myPrice, rent: myRent,
    history: { price: history(panel.PRICE, ctx.origin_year), rent: history(panel.REAL_RENT, ctx.rent_origin_year), phases: pricePhases(panel.PRICE, panel.NPRICE, ctx.origin_year) },
    tier1: {
      count: priceVals.length + 1, medianPrice10: median(Object.values(price10)), priceRank: rankDesc(priceVals, myPrice.h10!.median), priceRankLow: priceVals.length + 2 - rankDesc(priceVals, myPrice.h10!.median),
      rentCount: rentVals.length + (myRent ? 1 : 0), medianRent10: median(Object.values(rent10)), rentRank: myRent?.h10 ? rankDesc(rentVals, myRent.h10.median) : null,
    },
    peers: peerVals.length ? { region, count: peerVals.length, medianPrice10: median(peerVals) } : null,
    affordability: ctx.details.affordability ?? {},
    ptiYear, ptrVsHistory: ptrYear ? panel.PTR_AVG[ptrYear] - 100 : null,
    stress: ctx.details.stress ? { score: ctx.details.stress.score, rank: ctx.details.stress.rank, count: stressCount, rankLow: stressCount - ctx.details.stress.rank + 1, max: 100 } : null,
    rates: {
      policy: policyNow, policyAsOf, mortgage: mortgageNow, mortgageSource, lastMove,
      mortgageIsProxy, spread: run.summary.mortgageSpread ?? 2,
      delta, originYear: ctx.origin_year,
      liveShift10: delta != null && coef10 != null ? toPct(coef10 * delta) : null,
      sens3: sensPct(explorer.sens.real_price, 3), sens10: sensPct(explorer.sens.real_price, 10), rentSens10: sensPct(explorer.sens.real_rent, 10),
      sensValid: explorer.sensNotes.priceValid,
    },
    skill: { price10: p10bt?.skill_pct ?? null, price10Method: p10bt && /baseline/.test(p10bt.method) ? "baseline" : "model" },
    signals: sig, flags: flagLabels, flagIds: flagIds ?? [],
    live: { events },
    nowcast: (ctx.details as { nowcast?: { quarter: string; changePct: number } | null }).nowcast ?? null,
    types,
    drivers: { h10: driverShares(drv?.["10"]), h3: driverShares(drv?.["3"]), rent10: myRent ? driverShares(rentDrv?.["10"]) : null, modelPrice10, liveGap10: modelPrice10 != null ? myPrice.h10!.median - modelPrice10 : null },
    nominal: inflAvg != null && cumInfl != null ? { inflAvg, cumInfl, price10: 100 * ((1 + myPrice.h10!.median / 100) * (1 + cumInfl / 100) - 1) } : null,
    macro: {
      gdp: gdp ? { value: Number(gdp.value), period: gdp.period } : null,
      gdpAhead: gdpAhead.length ? gdpAhead.reduce((a, b) => a + b, 0) / gdpAhead.length : null,
      pop: pop ? { value: Number(pop.value), period: pop.period } : null,
      urban: urban ? { value: Number(urban.value), period: urban.period } : null,
      credit: credit ? { value: Number(credit.value), period: credit.period, change5: credit5 ? Number(credit.value) - Number(credit5.value) : null } : null,
    },
    cityPrices: cityPrices.length ? { list: cityPrices, national5: nat5 } : null,
    notes,
    cities: cityList.length ? {
      count: cityList.length,
      rent: latestRents.length >= 2 ? { min: Math.round(latestRents[0].value), minCity: latestRents[0].region, max: Math.round(latestRents.at(-1)!.value), maxCity: latestRents.at(-1)!.region, year: rentYear } : null,
      vacancy: vacancy ? { value: Number(vacancy.value), period: vacancy.period } : null,
    } : null,
  };
}
