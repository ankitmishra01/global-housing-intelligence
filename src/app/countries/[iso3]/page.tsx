import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CountryExplorer, type ExplorerProps } from "@/components/country-explorer";
import { country, countryPanel, contexts, flags, latestRun, personaRows, projections, rebased, sensitivities, indicatorLabels, type Projection, type Sensitivity } from "@/lib/data";
import { flagEmoji, fmt, money, TYPE_LABELS } from "@/lib/labels";
import type { Band, SensMap } from "@/lib/toggle";

export const revalidate = 86400;

export async function generateMetadata({ params }: { params: Promise<{ iso3: string }> }): Promise<Metadata> {
  const c = await country((await params).iso3);
  return { title: c ? `${c.name} housing outlook` : "Country" };
}

const DRIVERS = ["POP_GROWTH", "URBAN_GROWTH", "URBAN_SHARE", "GDP_PC_GROWTH", "GDP_PC_USD", "INFLATION", "LENDING_RATE", "REAL_RATE", "PRIVATE_CREDIT", "HH_CREDIT", "CREDIT_GAP", "PTI_AVG", "PTR_AVG"];
const NATIONAL = ["AVG_PRICE", "MEDIAN_PRICE", "AVG_RENT", "AVG_RENT_2BR", "VACANCY_RATE", "HOUSING_STARTS", "NEW_HOUSING_PRICE", "MORTGAGE_RATE", "RENT_CPI", "TYPE_PRICE_LEVEL"];

const bands = (list: Projection[], target: string): Band[] => list.filter((p) => p.target === target).map((p) => ({ horizon: p.horizon, year: p.year, p10: p.p10, p25: p.p25, median: p.median, p75: p.p75, p90: p.p90 }));
const sensMap = (list: Sensitivity[], target: string): SensMap | undefined => {
  const rows = list.filter((s) => s.target === target);
  return rows.length ? Object.fromEntries(rows.map((s) => [s.horizon, { coef: s.coef, se: s.se, valid: !!s.valid }])) : undefined;
};

export default async function CountryPage({ params }: { params: Promise<{ iso3: string }> }) {
  const iso3 = (await params).iso3.toUpperCase();
  const c = await country(iso3);
  if (!c) notFound();
  const [run, proj, sens, allFlags, personas, ctxs, { panel, observations }, labels] = await Promise.all([latestRun(), projections(iso3), sensitivities(), flags(), personaRows(), contexts(), countryPanel(iso3), indicatorLabels()]);
  const ctx = ctxs.find((x) => x.country === iso3);
  const myFlags = allFlags.filter((f) => f.country === iso3);

  const latest = (indicator: string, opts: { region?: string; type?: string; freq?: string } = {}) =>
    observations.filter((o) => o.indicator === indicator && o.region === (opts.region ?? "") && o.dwelling_type === (opts.type ?? "") && o.frequency === (opts.freq ?? "A") && o.status === "actual").at(-1);

  const drivers = DRIVERS.map((k) => ({ k, o: latest(k) })).filter((d) => d.o);
  const nationalRows = observations.filter((o) => NATIONAL.includes(o.indicator) && o.frequency === "A");
  const nationalLatest = [...new Map(nationalRows.map((o) => [`${o.indicator}|${o.region}|${o.dwelling_type}`, o])).values()];
  const cityRows = nationalLatest.filter((o) => o.region);
  const nationalTop = nationalLatest.filter((o) => !o.region);

  let explorer: ExplorerProps | null = null;
  if (ctx && run) {
    const typeKeys = Object.keys(ctx.details.types ?? {});
    const priceSens = sens.filter((s) => s.target === "real_price");
    const rentSens = sens.find((s) => s.target === "real_rent");
    const priceLevel = latest("AVG_PRICE") ?? latest("MEDIAN_PRICE");
    const rentLevel = latest("AVG_RENT") ?? latest("AVG_RENT_2BR", { region: "Toronto" });
    explorer = {
      name: c.name,
      history: {
        price: rebased(panel.PRICE, ctx.origin_year),
        rent: rebased(panel.REAL_RENT, ctx.rent_origin_year),
        types: Object.fromEntries(typeKeys.map((t) => [t, rebased(panel.TYPE_REAL?.[t], ctx.details.types[t].origin)])),
      },
      bands: {
        real_price: bands(proj, "real_price"), nominal_price: bands(proj, "nominal_price"), real_rent: bands(proj, "real_rent"), nominal_rent: bands(proj, "nominal_rent"),
        types: Object.fromEntries(typeKeys.map((t) => [t, bands(proj, `real_price:${t}`)]).filter(([, b]) => b.length)),
      },
      methods: { price10: proj.find((p) => p.target === "real_price" && p.horizon === 10)?.method ?? "–", rent10: proj.find((p) => p.target === "real_rent" && p.horizon === 10)?.method ?? "–" },
      sens: { real_price: sensMap(sens, "real_price"), real_rent: sensMap(sens, "real_rent"), type_price: sensMap(sens, "type_price") },
      sensNotes: { price: priceSens[0]?.note ?? "", rent: rentSens?.note ? `Rate effect on rents: ${rentSens.note}.` : "", priceValid: priceSens.length > 0 && !!priceSens[0].valid },
      rates: { policy: ctx.policy_rate, policyAsOf: ctx.policy_rate_as_of, mortgage: ctx.mortgage_rate, mortgageSource: ctx.mortgage_rate_source },
      personas: {
        specs: run.summary.personas, components: ctx.details.components, distributions: run.summary.distributions,
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
              ? `Official house price index from ${panel.PRICE_SOURCE ?? "BIS/OECD"}${c.has_rent ? " and an OECD rent index" : ""}. Projections start in ${ctx?.origin_year ?? "the latest full year"}.`
              : "No official house price index is published for this economy in the BIS or OECD datasets, so prices and rents are not projected. The housing drivers below are what the data supports."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className={`badge ${c.tier === 1 ? "badge--t1" : ""}`}>Tier {c.tier}</span>
          {c.has_national ? <span className="badge">National agency data</span> : null}
          {myFlags.length ? <span className="badge badge--flag">{myFlags.length} risk flag{myFlags.length > 1 ? "s" : ""}</span> : null}
        </div>
      </header>

      {myFlags.length ? (
        <section className="section">
          <div className="grid-3">
            {myFlags.map((f) => (
              <div key={f.flag} className="panel" style={{ borderColor: "var(--neg)" }}>
                <p className="eyebrow" style={{ color: "var(--neg)" }}>Risk flag · {f.as_of}</p>
                <p style={{ margin: "6px 0 0" }}>{run?.summary.flagRules[f.flag]?.label}</p>
                <p className="note">Reading: {fmt(f.value)} (threshold {f.threshold})</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {explorer ? <CountryExplorer {...explorer} /> : null}

      {nationalTop.length ? (
        <section className="section">
          <div className="section-title"><div><p className="eyebrow">National agency data</p><h2>From the country&apos;s own housing agencies</h2></div><p>Latest annual readings in local currency, straight from the national source.</p></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Measure</th><th>Type</th><th className="r">Latest</th><th>Year</th><th>Source</th></tr></thead>
              <tbody>{nationalTop.map((o) => (
                <tr key={`${o.indicator}|${o.dwelling_type}`}><td>{labels[o.indicator]?.label ?? o.indicator}</td><td>{o.dwelling_type ? TYPE_LABELS[o.dwelling_type] ?? o.dwelling_type : "All"}</td>
                  <td className="r">{o.value > 1000 ? money(o.value) : fmt(o.value, 2)}</td><td className="mono">{o.period}</td><td className="note">{o.source}</td></tr>
              ))}</tbody>
            </table>
          </div>
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
