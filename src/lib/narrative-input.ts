import "server-only";
import { applyLive, backtests, contexts, liveShifts, projections, regionsFor, type Context, type Country, type LiveState, type Observation, type Run } from "@/lib/data";
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
  const [all, shifts, ctxs, bts, regionList] = await Promise.all([projections(), liveShifts(), contexts(), backtests(), regionsFor(c.iso3)]);
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
    history: { price: history(panel.PRICE, ctx.origin_year), rent: history(panel.REAL_RENT, ctx.rent_origin_year) },
    tier1: {
      count: priceVals.length + 1, medianPrice10: median(Object.values(price10)), priceRank: rankDesc(priceVals, myPrice.h10!.median), priceRankLow: priceVals.length + 2 - rankDesc(priceVals, myPrice.h10!.median),
      rentCount: rentVals.length + (myRent ? 1 : 0), medianRent10: median(Object.values(rent10)), rentRank: myRent?.h10 ? rankDesc(rentVals, myRent.h10.median) : null,
    },
    peers: peerVals.length ? { region, count: peerVals.length, medianPrice10: median(peerVals) } : null,
    affordability: ctx.details.affordability ?? {},
    ptiYear, ptrVsHistory: ptrYear ? panel.PTR_AVG[ptrYear] - 100 : null,
    stress: ctx.details.stress ? { score: ctx.details.stress.score, rank: ctx.details.stress.rank, count: stressCount, rankLow: stressCount - ctx.details.stress.rank + 1, max: 100 } : null,
    rates: {
      policy: ctx.policy_rate, policyAsOf: ctx.policy_rate_as_of, mortgage: ctx.mortgage_rate, mortgageSource,
      mortgageIsProxy: !!mortgageSource?.startsWith("policy"), spread: run.summary.mortgageSpread ?? 2,
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
    cities: regionList.length ? {
      count: regionList.length,
      rent: latestRents.length >= 2 ? { min: Math.round(latestRents[0].value), minCity: latestRents[0].region, max: Math.round(latestRents.at(-1)!.value), maxCity: latestRents.at(-1)!.region, year: rentYear } : null,
      vacancy: vacancy ? { value: Number(vacancy.value), period: vacancy.period } : null,
    } : null,
  };
}
