import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { applyLive, contexts, country, flags, latestRun, liveShifts, liveState, projections } from "@/lib/data";
import { flagEmoji, fmt, pct } from "@/lib/labels";

export const revalidate = 86400;

type Params = { params: Promise<{ iso3: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const c = await country((await params).iso3);
  return { title: c ? `${c.name} housing brief` : "Brief" };
}

const SITE = "global-housing-intelligence.vercel.app";
const PERSONAS = ["buyer", "seller", "investor", "renter"] as const;

export default async function BriefPage({ params }: Params) {
  const iso3 = (await params).iso3.toUpperCase();
  const c = await country(iso3);
  if (!c) notFound();
  const [run, proj, ctxs, allFlags, live, shiftsAll] = await Promise.all([latestRun(), projections(iso3), contexts(), flags(), liveState(iso3), liveShifts(iso3)]);
  const ctx = ctxs.find((x) => x.country === iso3);
  const shifts = shiftsAll[iso3];
  const band = (target: string, h: number) => {
    const row = proj.find((p) => p.target === target && Number(p.horizon) === h);
    return row ? applyLive([row], shifts?.[target])[0] : null;
  };
  const rows = [
    { label: "Real house prices", t: "real_price" },
    { label: "Nominal house prices", t: "nominal_price" },
    { label: "Real rents", t: "real_rent" },
    { label: "Nominal rents", t: "nominal_rent" },
  ].map((r) => ({ ...r, h3: band(r.t, 3), h10: band(r.t, 10) })).filter((r) => r.h10);
  const a = (ctx?.details.affordability ?? {}) as Record<string, number | string | boolean | null>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const metrics = [
    num(a.priceToIncome) != null ? { label: "House price to income", value: `${num(a.priceToIncome)!.toFixed(1)}×`, note: String(a.priceToIncomeBasis ?? "") } : null,
    num(a.ptiVsHistory) != null ? { label: "Price-to-income vs its long-run average", value: pct(num(a.ptiVsHistory), 0), note: "OECD" } : null,
    num(a.mortgageToIncome) != null ? { label: "Mortgage payment / income", value: `${num(a.mortgageToIncome)!.toFixed(0)}%`, note: String(a.mortgageToIncomeBasis ?? "") } : null,
    num(a.rentToIncome) != null ? { label: "Rent / income", value: `${num(a.rentToIncome)!.toFixed(0)}%`, note: String(a.rentToIncomeBasis ?? "") } : null,
    ctx?.details.stress ? { label: "Mortgage stress index", value: `${ctx.details.stress.score.toFixed(0)} / 100`, note: "higher means more stress" } : null,
  ].filter(Boolean).slice(0, 3) as { label: string; value: string; note: string }[];
  const signals = ctx?.details.signals ?? {};
  const myFlags = allFlags.filter((f) => f.country === iso3);
  const range = (b: ReturnType<typeof band>) => (b ? `${pct(b.p10 - 100, 0)} to ${pct(b.p90 - 100, 0)}` : "–");

  return (
    <div className="page brief">
      <div className="brief__actions no-print">
        <Link className="link" href={`/countries/${iso3}`}>Back to {c.name}</Link>
        <PrintButton />
      </div>
      <article className="brief__sheet">
        <header className="brief__head">
          <div>
            <p className="eyebrow">Housing brief · data to {run?.data_vintage ?? "–"}{live ? ` · live adjustments ${live.as_of}` : ""}</p>
            <h1 className="display" style={{ margin: "4px 0 0", fontSize: 40 }}>{flagEmoji(c.iso2)} {c.name}</h1>
          </div>
          <span className="brief__mark">GHI</span>
        </header>

        {c.tier !== 1 || !rows.length ? (
          <p className="lede">No official house price index is published for {c.name} in the BIS or OECD datasets, so prices and rents are not projected.</p>
        ) : (
          <>
            <h2 className="brief__h2">10-year outlook{ctx ? `, from ${(ctx.details as { originLabel?: string }).originLabel ?? ctx.origin_year}` : ""}</h2>
            <table className="brief__table">
              <thead><tr><th>Measure</th><th className="r">3 years</th><th className="r">10 years</th><th className="r">10-year 80% range</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.t}><td>{r.label}</td><td className="r">{pct(r.h3 ? r.h3.median - 100 : null)}</td><td className="r"><strong>{pct(r.h10 ? r.h10.median - 100 : null)}</strong></td><td className="r">{range(r.h10)}</td></tr>
              ))}</tbody>
            </table>
          </>
        )}

        {metrics.length ? (
          <>
            <h2 className="brief__h2">Affordability</h2>
            <div className="brief__grid">{metrics.map((m) => (
              <div key={m.label} className="brief__metric"><span>{m.label}</span><strong className="display">{m.value}</strong><small>{m.note}</small></div>
            ))}</div>
          </>
        ) : null}

        {Object.keys(signals).length ? (
          <>
            <h2 className="brief__h2">Market signals</h2>
            <div className="brief__grid brief__grid--4">{PERSONAS.map((k) => signals[k] ? (
              <div key={k} className="brief__metric">
                <span>{k[0].toUpperCase() + k.slice(1)}</span>
                <strong className={`display ${signals[k].level > 0 ? "pos" : signals[k].level < 0 ? "neg" : ""}`}>{signals[k].label}</strong>
                <small>{signals[k].support[0] ?? ""}</small>
              </div>
            ) : null)}</div>
          </>
        ) : null}

        {myFlags.length || live?.explanation.length ? (
          <>
            <h2 className="brief__h2">Risks and live adjustments</h2>
            <ul className="brief__list">
              {myFlags.map((f) => <li key={f.flag}><strong className="neg">Flag:</strong> {run?.summary.flagRules[f.flag]?.label} (reading {fmt(f.value)}, {f.as_of})</li>)}
              {live?.explanation.map((e, i) => <li key={i}><strong>{e.kind === "event" ? "Event" : "Rates"}:</strong> {e.text}</li>)}
            </ul>
          </>
        ) : null}

        <footer className="brief__foot">
          <p>Method: pooled ridge regression and baselines, chosen and scored on held-out years; 80% ranges from past forecast errors. Statistical estimates, not financial advice.</p>
          <p>Sources: BIS, OECD, IMF World Economic Outlook, World Bank and national housing agencies, credited on the country page. Full page: {SITE}/countries/{iso3}</p>
        </footer>
      </article>
    </div>
  );
}
