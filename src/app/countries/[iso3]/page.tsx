import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CountryExplorer, type ExplorerProps } from "@/components/country-explorer";
import { applyLive, country, countryPanel, contexts, flags, latestRun, liveShifts, liveState, personaRows, projections, rebased, sensitivities, indicatorLabels, type LiveShift, type Projection, type Sensitivity } from "@/lib/data";
import { EVENT_LABELS, flagEmoji, fmt, money, TYPE_LABELS } from "@/lib/labels";
import type { Band, SensMap } from "@/lib/toggle";

export const revalidate = 86400;

export async function generateMetadata({ params }: { params: Promise<{ iso3: string }> }): Promise<Metadata> {
  const c = await country((await params).iso3);
  return { title: c ? `${c.name} housing outlook` : "Country" };
}

const DRIVERS = ["POP_GROWTH", "URBAN_GROWTH", "URBAN_SHARE", "GDP_PC_GROWTH", "GDP_PC_USD", "INFLATION", "LENDING_RATE", "REAL_RATE", "PRIVATE_CREDIT", "HH_CREDIT", "CREDIT_GAP", "PTI_AVG", "PTR_AVG"];
const NATIONAL = ["AVG_PRICE", "MEDIAN_PRICE", "AVG_RENT", "AVG_RENT_2BR", "VACANCY_RATE", "HOUSING_STARTS", "NEW_HOUSING_PRICE", "MORTGAGE_RATE", "RENT_CPI", "TYPE_PRICE_LEVEL", "SALES_COUNT", "MEDIAN_PSF", "DLD_PRICE_INDEX", "GROSS_YIELD", "CITY_PRICE", "MEDIAN_HH_INCOME"];

const bands = (list: Projection[], target: string, live?: Record<string, Record<number, LiveShift>>): Band[] =>
  applyLive(list.filter((p) => p.target === target).map((p) => ({ horizon: p.horizon, year: p.year, p10: p.p10, p25: p.p25, median: p.median, p75: p.p75, p90: p.p90 })), live?.[target]);
const sensMap = (list: Sensitivity[], target: string): SensMap | undefined => {
  const rows = list.filter((s) => s.target === target);
  return rows.length ? Object.fromEntries(rows.map((s) => [s.horizon, { coef: s.coef, se: s.se, valid: !!s.valid }])) : undefined;
};

// Live shifts move the projection-based index components the same way they move the charts.
function liveComponents(base: Record<string, number | null>, shifts?: Record<string, Record<number, LiveShift>>) {
  if (!shifts) return base;
  const add = (v: number | null, s?: LiveShift) => (v == null || !s ? v : v + s.shift);
  return { ...base, proj3Price: add(base.proj3Price, shifts.real_price?.[3]), proj10Price: add(base.proj10Price, shifts.real_price?.[10]), proj10Rent: add(base.proj10Rent, shifts.real_rent?.[10]) };
}

type RateSens = { householdCreditShare?: number; imputed?: boolean } & Record<string, Record<string, { coef: number; se: number; valid: number }> | number | boolean | undefined>;
function countrySens(rs: RateSens | null | undefined) {
  if (!rs) return null;
  const pick = (t: string): SensMap | undefined => {
    const m = rs[t];
    return m && typeof m === "object" ? Object.fromEntries(Object.entries(m).map(([h, v]) => [Number(h), { coef: v.coef, se: v.se, valid: !!v.valid }])) : undefined;
  };
  return { real_price: pick("real_price"), real_rent: pick("real_rent"), type_price: pick("type_price") };
}

export default async function CountryPage({ params }: { params: Promise<{ iso3: string }> }) {
  const iso3 = (await params).iso3.toUpperCase();
  const c = await country(iso3);
  if (!c) notFound();
  const [run, proj, sens, allFlags, personas, ctxs, { panel, observations }, labels, live, shiftsAll] = await Promise.all([latestRun(), projections(iso3), sensitivities(), flags(), personaRows(), contexts(), countryPanel(iso3), indicatorLabels(), liveState(iso3), liveShifts(iso3)]);
  const shifts = shiftsAll[iso3];
  const ctx = ctxs.find((x) => x.country === iso3);
  const myFlags = allFlags.filter((f) => f.country === iso3);

  const latest = (indicator: string, opts: { region?: string; type?: string; freq?: string } = {}) =>
    observations.filter((o) => o.indicator === indicator && o.region === (opts.region ?? "") && o.dwelling_type === (opts.type ?? "") && o.frequency === (opts.freq ?? "A") && o.status === "actual").at(-1);

  const drivers = DRIVERS.map((k) => ({ k, o: latest(k) })).filter((d) => d.o);
  // Registry flows show their latest month (or quarter for the DLD index); everything else its latest year.
  const FRESH = ["SALES_COUNT", "MEDIAN_PSF", "DLD_PRICE_INDEX"];
  const nationalRows = observations.filter((o) => NATIONAL.includes(o.indicator) && (FRESH.includes(o.indicator) ? o.frequency !== "A" : o.frequency === "A"));
  const nationalLatest = [...new Map(nationalRows.map((o) => [`${o.indicator}|${o.region}|${o.dwelling_type}`, o])).values()];
  const cityRows = nationalLatest.filter((o) => o.region);
  const nationalTop = nationalLatest.filter((o) => !o.region);

  let explorer: ExplorerProps | null = null;
  if (ctx && run) {
    const typeKeys = Object.keys(ctx.details.types ?? {});
    const priceSens = sens.filter((s) => s.target === "real_price");
    const rentSens = sens.find((s) => s.target === "real_rent");
    const priceLevel = latest("AVG_PRICE") ?? latest("MEDIAN_PRICE");
    const rentLevel = latest("AVG_RENT") ?? latest("AVG_RENT_2BR", { region: "Toronto" }) ?? latest("AVG_RENT", { region: "Dubai", type: "condo" });
    explorer = {
      name: c.name,
      history: {
        price: rebased(panel.PRICE, ctx.origin_year),
        rent: rebased(panel.REAL_RENT, ctx.rent_origin_year),
        types: Object.fromEntries(typeKeys.map((t) => [t, rebased(panel.TYPE_REAL?.[t], ctx.details.types[t].origin)])),
      },
      bands: {
        real_price: bands(proj, "real_price", shifts), nominal_price: bands(proj, "nominal_price", shifts), real_rent: bands(proj, "real_rent", shifts), nominal_rent: bands(proj, "nominal_rent", shifts),
        types: Object.fromEntries(typeKeys.map((t) => [t, bands(proj, `real_price:${t}`, shifts)]).filter(([, b]) => b.length)),
      },
      methods: { price10: proj.find((p) => p.target === "real_price" && p.horizon === 10)?.method ?? "–", rent10: proj.find((p) => p.target === "real_rent" && p.horizon === 10)?.method ?? "–" },
      sens: countrySens(ctx.details.rateSens) ?? { real_price: sensMap(sens, "real_price"), real_rent: sensMap(sens, "real_rent"), type_price: sensMap(sens, "type_price") },
      sensScope: (() => {
        const note = (t: string) => sens.find((x) => x.target === t)?.note ?? "";
        const share = ctx.details.rateSens?.householdCreditShare;
        const scaled = (t: string) => note(t).startsWith("quoted at the median");
        const debt = share != null ? `household credit of ${Math.round(share * 100)}% of GDP${ctx.details.rateSens?.imputed ? " (median used: no BIS series)" : ""}` : "household credit";
        return `Price effects ${scaled("real_price") ? `scale with this country's ${debt}` : "are pooled across countries, because household debt did not clearly change them"}; rent effects ${scaled("real_rent") ? `scale with its ${debt}` : "are pooled"}.`;
      })(),
      sensNotes: { price: priceSens[0]?.note ?? "", rent: rentSens?.note ? "Higher rates can push would-be buyers into renting, so the rent effect's sign is estimated, not assumed." : "", priceValid: priceSens.length > 0 && !!priceSens[0].valid },
      rates: { policy: ctx.policy_rate, policyAsOf: ctx.policy_rate_as_of, mortgage: ctx.mortgage_rate, mortgageSource: ctx.mortgage_rate_source },
      personas: {
        specs: run.summary.personas, components: liveComponents(ctx.details.components, shifts), distributions: run.summary.distributions,
        base: Object.fromEntries(["investor", "buyer", "renter", "seller"].map((k) => [k, personas.find((r) => r.country === iso3 && r.persona === k)?.score ?? null])),
      },
      calculator: {
        price: priceLevel?.value ?? null, priceLabel: priceLevel ? `${labels[priceLevel.indicator]?.label ?? priceLevel.indicator}, ${priceLevel.period} (${priceLevel.source})` : null,
        rent: rentLevel?.value ?? null, rentLabel: rentLevel ? `${labels[rentLevel.indicator]?.label ?? rentLevel.indicator}${rentLevel.region ? `, ${rentLevel.region}` : ""}, ${rentLevel.period} (${rentLevel.source})` : null,
      },
    };
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow"><Link href="/countries">Countries</Link> · {c.region}</p>
          <h1>{flagEmoji(c.iso2)} {c.name}</h1>
          <p className="lede">
            {c.tier === 1
              ? `Official house price index from ${panel.PRICE_SOURCE ?? "BIS/OECD"}${c.has_rent ? " and an OECD rent index" : ""}. Projections start in ${ctx?.origin_year ?? "the latest full year"}${ctx && run && ctx.origin_year <= run.summary.latestYear - 2 ? `, the latest year the official index covers${observations.some((o) => (o.region || c.has_national) && Number(o.period.slice(0, 4)) > ctx.origin_year + 1 && o.status === "actual" && ["SALES_COUNT", "MEDIAN_PSF", "AVG_PRICE", "AVG_RENT"].includes(o.indicator)) ? "; newer registry data appears below but is too short to model yet" : "; newer national data is not yet in the public datasets"}` : ""}.`
              : "No official house price index is published for this economy in the BIS or OECD datasets, so prices and rents are not projected. The housing drivers below are what the data supports."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className={`badge ${c.tier === 1 ? "badge--t1" : ""}`}>Tier {c.tier}</span>
          {c.has_national ? <span className="badge">National agency data</span> : null}
          {myFlags.length ? <span className="badge badge--flag">{myFlags.length} risk flag{myFlags.length > 1 ? "s" : ""}</span> : null}
          {ctx && run && ctx.origin_year <= run.summary.latestYear - 2 ? <span className="badge badge--warn">Price data to {ctx.origin_year}</span> : null}
          {ctx && run && ctx.rent_origin_year != null && ctx.rent_origin_year <= run.summary.latestYear - 2 ? <span className="badge badge--warn">Rent data to {ctx.rent_origin_year}</span> : null}
        </div>
      </header>

      {live && live.explanation.length ? (
        <section className="section live-banner" aria-label="Live adjustments">
          <div className="live-banner__head">
            <p className="eyebrow"><span className="live-dot" aria-hidden="true" />Live adjustments · {live.as_of}</p>
            <Link className="link" href="/live">What changed today →</Link>
          </div>
          <ul>{live.explanation.map((e, i) => <li key={i}><span className={`badge ${e.kind === "event" ? "badge--flag" : ""}`}>{e.kind === "event" ? "Event" : e.kind === "rate" ? "Rates" : e.kind.charAt(0).toUpperCase() + e.kind.slice(1)}</span> {e.text}</li>)}</ul>
          {live.events.length ? <p className="note">Active: {live.events.map((ev) => `${EVENT_LABELS[ev.class] ?? ev.class} since ${ev.onset}`).join(" · ")}. Charts, the buy-vs-rent table and index scores below include these adjustments; the rate toggle moves on top of them.</p>
            : <p className="note">Charts, the buy-vs-rent table and index scores below include these adjustments; the rate toggle moves on top of them.</p>}
        </section>
      ) : null}

      {myFlags.length ? (
        <section className="section">
          <div className="grid-3">
            {myFlags.map((f) => (
              <div key={f.flag} className="flag-card">
                <p className="flag-card__label">{run?.summary.flagRules[f.flag]?.label}</p>
                <p className="flag-card__meta">Reading {fmt(f.value)} against a threshold of {f.threshold} · {f.as_of}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {explorer ? <CountryExplorer {...explorer} /> : null}

      {ctx?.details.affordability || ctx?.details.signals ? <AffordabilitySection ctx={ctx} disclaimer={run?.summary && (run.summary as unknown as { signalDisclaimer?: string }).signalDisclaimer} /> : null}

      {nationalTop.length || cityRows.length ? (
        <section className="section">
          <div className="section-title"><div><p className="eyebrow">National agency data</p><h2>From the country&apos;s own housing agencies</h2></div><p>Latest annual readings in local currency, straight from the national source.</p></div>
          {nationalTop.length ? <div className="table-wrap">
            <table>
              <thead><tr><th>Measure</th><th>Type</th><th className="r">Latest</th><th>Year</th><th>Source</th></tr></thead>
              <tbody>{nationalTop.map((o) => (
                <tr key={`${o.indicator}|${o.dwelling_type}`}><td>{labels[o.indicator]?.label ?? o.indicator}</td><td>{o.dwelling_type ? TYPE_LABELS[o.dwelling_type] ?? o.dwelling_type : "All"}</td>
                  <td className="r">{o.value > 1000 ? money(o.value) : fmt(o.value, 2)}</td><td className="mono">{o.period}</td><td className="note">{o.source}</td></tr>
              ))}</tbody>
            </table>
          </div> : null}
          {cityRows.length ? (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>City / region</th><th>Measure</th><th className="r">Latest</th><th>Year</th><th>Source</th></tr></thead>
                <tbody>{cityRows.sort((a, b) => a.region.localeCompare(b.region) || a.indicator.localeCompare(b.indicator)).map((o) => (
                  <tr key={`${o.region}|${o.indicator}|${o.dwelling_type}`}><td>{o.region}</td><td>{labels[o.indicator]?.label ?? o.indicator}{o.dwelling_type ? ` · ${TYPE_LABELS[o.dwelling_type]}` : ""}</td>
                    <td className="r">{o.value > 1000 ? money(o.value) : fmt(o.value, o.indicator === "VACANCY_RATE" ? 1 : 0)}</td><td className="mono">{o.period}</td><td className="note">{o.source}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Drivers</p><h2>What moves housing here</h2></div><p>Latest annual readings from the World Bank, IMF, BIS and OECD.</p></div>
        {drivers.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Driver</th><th className="r">Latest</th><th>Unit</th><th>Year</th><th>Source</th></tr></thead>
              <tbody>{drivers.map(({ k, o }) => (
                <tr key={k}><td>{labels[k]?.label ?? k}</td><td className="r">{o!.value > 1000 ? money(o!.value) : fmt(o!.value, 2)}</td><td className="note">{labels[k]?.unit}</td><td className="mono">{o!.period}</td><td className="note">{o!.source}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="note">No driver data loaded yet.</p>}
      </section>
    </div>
  );
}

type Ctx = NonNullable<Awaited<ReturnType<typeof contexts>>[number]>;
const STRESS_NAMES: Record<string, string> = { mortgageToIncome: "Mortgage / income", ptiVsHistory: "Price-to-income vs history", debtServiceGap: "Debt service vs average", unemploymentChange12m: "Unemployment change, 12m", realWageGrowth3y: "Real wage growth, 3y", hhDebt: "Household debt % GDP" };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function AffordabilitySection({ ctx, disclaimer }: { ctx: Ctx; disclaimer?: string }) {
  const a = (ctx.details.affordability ?? {}) as Record<string, number | string | boolean | null>;
  const stress = ctx.details.stress;
  const signals = ctx.details.signals ?? {};
  const tiles: { label: string; value: string; note?: string | null; warn?: boolean }[] = [
    { label: "House price to income", value: num(a.priceToIncome) != null ? `${num(a.priceToIncome)!.toFixed(1)}×` : "–", note: (a.priceToIncomeBasis as string) ?? "No national price level to compare with income" },
    { label: "Price-to-income vs history", value: num(a.ptiVsHistory) != null ? `${num(a.ptiVsHistory)! > 0 ? "+" : ""}${num(a.ptiVsHistory)!.toFixed(0)}%` : "–", note: "OECD ratio vs its long-run average", warn: (num(a.ptiVsHistory) ?? 0) > 20 },
    { label: "Mortgage payment / income", value: num(a.mortgageToIncome) != null ? `${num(a.mortgageToIncome)!.toFixed(0)}%` : "–", note: (a.mortgageToIncomeBasis as string) ?? null, warn: (num(a.mortgageToIncome) ?? 0) > 30 },
    { label: "Rent / income", value: num(a.rentToIncome) != null ? `${num(a.rentToIncome)!.toFixed(0)}%` : "–", note: (a.rentToIncomeBasis as string) ?? null, warn: (num(a.rentToIncome) ?? 0) > 30 },
    { label: "Household debt service", value: num(a.debtService) != null ? `${num(a.debtService)!.toFixed(1)}% of income` : "–", note: num(a.debtServiceGap) != null ? `${num(a.debtServiceGap)! > 0 ? "+" : ""}${num(a.debtServiceGap)!.toFixed(1)}pp vs 15-year average (BIS, ${a.debtServiceAsOf})` : "BIS debt service ratio", warn: (num(a.debtServiceGap) ?? 0) >= 2 },
    { label: "Unemployment", value: num(a.unemployment) != null ? `${num(a.unemployment)!.toFixed(1)}%` : "–", note: num(a.unemploymentChange12m) != null ? `${num(a.unemploymentChange12m)! > 0 ? "+" : ""}${num(a.unemploymentChange12m)!.toFixed(1)}pp over 12 months${a.unemploymentRising ? " · rising fast" : ""} (${a.unemploymentAsOf})` : null, warn: !!a.unemploymentRising },
    { label: "Real wage growth (3y avg)", value: num(a.realWageGrowth3y) != null ? `${num(a.realWageGrowth3y)! > 0 ? "+" : ""}${num(a.realWageGrowth3y)!.toFixed(1)}%` : "–", note: a.wageStagnation ? "Stagnant: 0.5% a year or less (OECD)" : "OECD average annual wages, constant prices", warn: !!a.wageStagnation },
    { label: "Household debt", value: num(a.hhDebt) != null ? `${num(a.hhDebt)!.toFixed(0)}% of GDP` : "–", note: "BIS credit to households" },
  ];
  return (
    <section className="section">
      <div className="section-title">
        <div><p className="eyebrow">Affordability and mortgage stress</p><h2>Can households carry it?</h2></div>
        <p>Income ratios, debt service, unemployment and wages. Rising unemployment, stagnant wages and high debt service raise mortgage stress and pull the buyer and investor signals down.</p>
      </div>
      <div className="grid-4">
        {tiles.map((t) => (
          <div key={t.label} className="persona-card" style={t.warn ? { borderColor: "var(--neg)" } : undefined}>
            <h3>{t.label}</h3>
            <div className="score num" style={{ fontSize: 28 }}>{t.value}</div>
            {t.note ? <p>{t.note}</p> : null}
          </div>
        ))}
      </div>
      {stress ? (
        <div className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Mortgage stress index</p>
          <p style={{ margin: "4px 0" }}><strong className="num display" style={{ fontSize: 36 }}>{stress.score.toFixed(0)}</strong><span className="note"> / 100 · rank {stress.rank} of the economies with enough data (higher is more stress)</span></p>
          <div className="meter"><i style={{ width: `${stress.score}%`, background: stress.score >= 75 ? "var(--neg)" : "var(--accent)" }} /></div>
          <p className="note">{stress.components.filter((c) => c.percentile != null).map((c) => `${STRESS_NAMES[c.basis] ?? c.basis}: ${c.value} (${Math.round(c.percentile!)}th percentile)`).join(" · ")}</p>
        </div>
      ) : null}
      {Object.keys(signals).length ? (
        <div style={{ marginTop: 16 }}>
          <div className="grid-4">
            {(["buyer", "seller", "investor", "renter"] as const).map((k) => {
              const sg = signals[k];
              if (!sg) return null;
              return (
                <article key={k} className="persona-card">
                  <h3>{k[0].toUpperCase() + k.slice(1)} signal</h3>
                  <div className={`score ${sg.level > 0 ? "pos" : sg.level < 0 ? "neg" : ""}`} style={{ fontSize: 26 }}>{sg.label}</div>
                  {sg.adjusted ? <p className="delta" style={{ color: "var(--gold)" }}>Adjusted for labour-market and mortgage stress</p> : null}
                  <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 12.5 }}>
                    {sg.support.map((r) => <li key={r}>{r}</li>)}
                    {sg.oppose.map((r) => <li key={r} style={{ color: "var(--muted)" }}>But: {r}</li>)}
                  </ul>
                </article>
              );
            })}
          </div>
          <p className="note">{disclaimer ?? "Market-level signal from public data and statistical projections. Not personal financial advice."}</p>
        </div>
      ) : null}
    </section>
  );
}
