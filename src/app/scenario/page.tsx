import type { Metadata } from "next";
import Link from "next/link";
import { ScenarioBuilder, type ScenarioProps } from "@/components/scenario-builder";
import { applyLive, contexts, countries, countryPanel, featureSensitivities, flags, latestRun, liveShifts, projections, rebased, type FeatureSensitivity, type LiveShift, type Projection } from "@/lib/data";
import type { Band, CoefMap, TargetSens } from "@/lib/scenario";

export const metadata: Metadata = { title: "Scenarios", description: "Move interest rates, unemployment, wages and growth together and see house prices, rents, mortgage stress and buyer, seller, investor and renter signals respond." };
export const dynamic = "force-dynamic";

const FEATURE_KEYS: Record<string, keyof TargetSens> = { unemployment_change: "unemployment", real_wage_growth: "wages", real_gdp_growth: "gdp" };
const FEATURE_NAMES: Record<string, string> = { unemployment_change: "unemployment", real_wage_growth: "real wage growth", real_gdp_growth: "real GDP growth", rate: "the policy rate" };
const TARGET_NAMES: Record<string, string> = { real_price: "prices", real_rent: "rents" };

const bandsFor = (list: Projection[], target: string, live?: Record<string, Record<number, LiveShift>>): Band[] =>
  applyLive(list.filter((p) => p.target === target).map((p) => ({ horizon: p.horizon, year: p.year, p10: p.p10, p25: p.p25, median: p.median, p75: p.p75, p90: p.p90 })), live?.[target]);

type RateSens = Record<string, Record<string, { coef: number; se: number; valid: number }> | number | boolean | undefined>;

function toCoefMap(m: Record<string, { coef: number; se: number; valid: number }> | undefined): CoefMap | undefined {
  return m ? Object.fromEntries(Object.entries(m).map(([h, v]) => [Number(h), { coef: Number(v.coef), se: Number(v.se), valid: !!v.valid }])) : undefined;
}

export default async function ScenarioPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const sp = await searchParams;
  const [run, list, ctxs, feats, allFlags] = await Promise.all([latestRun(), countries(), contexts(), featureSensitivities(), flags()]);
  const tier1 = list.filter((c) => c.tier === 1 && ctxs.some((x) => x.country === c.iso3));
  const requested = (sp.c ?? "CAN").toUpperCase();
  const iso3 = tier1.some((c) => c.iso3 === requested) ? requested : tier1.find((c) => c.iso3 === "CAN")?.iso3 ?? tier1[0]?.iso3;
  const ctx = ctxs.find((x) => x.country === iso3);

  if (!run || !iso3 || !ctx) {
    return <div className="page"><div className="empty"><h2>No projection run yet</h2><p>Scenarios need a training run in the database.</p></div></div>;
  }

  const [proj, shiftsAll, { panel, observations }] = await Promise.all([projections(iso3), liveShifts(iso3), countryPanel(iso3)]);
  const shifts = shiftsAll[iso3];
  const rs = (ctx.details.rateSens ?? {}) as RateSens;

  // Driver coefficients per target: the country's own rate effect plus the pooled driver effects.
  const sens: { real_price: TargetSens; real_rent: TargetSens } = { real_price: {}, real_rent: {} };
  for (const target of ["real_price", "real_rent"] as const) {
    const rate = toCoefMap(rs[target] as Record<string, { coef: number; se: number; valid: number }> | undefined);
    if (rate) sens[target].rate = rate;
    for (const f of feats.filter((x: FeatureSensitivity) => x.target === target)) {
      const key = FEATURE_KEYS[f.feature];
      if (!key) continue;
      (sens[target][key] ||= {})[f.horizon] = { coef: Number(f.coef), se: Number(f.se), valid: !!f.valid };
    }
  }
  const unclear: string[] = [];
  for (const target of ["real_price", "real_rent"] as const) {
    for (const [feature, key] of [["rate", "rate"], ...Object.entries(FEATURE_KEYS)] as [string, keyof TargetSens][]) {
      const m = sens[target][key];
      if (!m || Object.values(m).every((c) => !c.valid || c.coef === 0)) unclear.push(`${FEATURE_NAMES[feature]} on ${TARGET_NAMES[target]}`);
    }
  }

  const latest = (indicator: string, opts: { region?: string; type?: string } = {}) =>
    observations.filter((o) => o.indicator === indicator && o.region === (opts.region ?? "") && o.dwelling_type === (opts.type ?? "") && o.frequency === "A" && o.status === "actual").at(-1);
  const priceLevel = latest("AVG_PRICE") ?? latest("MEDIAN_PRICE");
  const rentLevel = latest("AVG_RENT") ?? latest("AVG_RENT_2BR", { region: "Toronto" }) ?? latest("AVG_RENT", { region: "Dubai", type: "condo" });

  // Projection-based index components include today's live shifts, like the country page.
  const base = ctx.details.components;
  const add = (v: number | null | undefined, s?: LiveShift) => (v == null ? null : s ? v + s.shift : v);
  const components = { ...base, proj3Price: add(base.proj3Price, shifts?.real_price?.[3]), proj10Price: add(base.proj10Price, shifts?.real_price?.[10]), proj10Rent: add(base.proj10Rent, shifts?.real_rent?.[10]) };

  const a = (ctx.details.affordability ?? {}) as Record<string, number | null>;
  const props: ScenarioProps = {
    countries: tier1.map((c) => ({ iso3: c.iso3, name: c.name })),
    iso3,
    name: tier1.find((c) => c.iso3 === iso3)!.name,
    originLabel: (ctx.details as { originLabel?: string }).originLabel ?? String(ctx.origin_year),
    history: { price: rebased(panel.PRICE, ctx.origin_year), rent: rebased(panel.REAL_RENT, ctx.rent_origin_year) },
    bands: { real_price: bandsFor(proj, "real_price", shifts), nominal_price: bandsFor(proj, "nominal_price", shifts), real_rent: bandsFor(proj, "real_rent", shifts), nominal_rent: bandsFor(proj, "nominal_rent", shifts) },
    sens,
    unclear,
    rates: { policy: ctx.policy_rate, mortgage: ctx.mortgage_rate, mortgageSource: ctx.mortgage_rate_source },
    personas: { specs: run.summary.personas, components, distributions: run.summary.distributions },
    stress: {
      metrics: { mortgageToIncome: a.mortgageToIncome, ptiVsHistory: a.ptiVsHistory, debtService: a.debtService, debtServiceGap: a.debtServiceGap, unemploymentChange12m: a.unemploymentChange12m, realWageGrowth3y: a.realWageGrowth3y, hhDebt: a.hhDebt, mortgageRate: ctx.mortgage_rate },
      distributions: ((run.summary as unknown as { stressDistributions?: Record<string, number[]> }).stressDistributions) ?? {},
    },
    flags: allFlags.filter((f) => f.country === iso3).map((f) => f.flag),
    calculator: { price: priceLevel?.value ?? null, rent: rentLevel?.value ?? null },
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Scenarios · {props.name}</p>
          <h1>What if the economy turns?</h1>
          <p className="lede">Set interest rates, unemployment, wages and growth together and watch house prices, rents, mortgage stress and the buyer, seller, investor and renter signals respond. For a single rate move, the <Link className="link" href={`/countries/${iso3}`}>country page</Link> has the simpler toggle.</p>
        </div>
      </header>
      <ScenarioBuilder key={iso3} {...props} />
    </div>
  );
}
