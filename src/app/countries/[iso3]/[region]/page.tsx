import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SeriesChart } from "@/components/series-chart";
import { country, indicatorLabels, regionData, regionsFor } from "@/lib/data";
import { flagEmoji, fmt, money, TYPE_LABELS } from "@/lib/labels";

export const revalidate = 86400;

// No pages are built ahead of time, but each one is cached after its first request (ISR).
export async function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ iso3: string; region: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { iso3, region } = await params;
  const [c, data] = await Promise.all([country(iso3), regionData(iso3.toUpperCase(), region)]);
  return { title: c && data ? `${data.region}, ${c.name}: housing data` : "Region" };
}

const value = (v: number) => (Math.abs(v) >= 1000 ? money(v) : fmt(v, Math.abs(v) < 20 ? 2 : 1));

export default async function RegionPage({ params }: Params) {
  const { iso3: raw, region: slug } = await params;
  const iso3 = raw.toUpperCase();
  const [c, data, labels, regions] = await Promise.all([country(iso3), regionData(iso3, slug), indicatorLabels(), regionsFor(iso3)]);
  if (!c || !data) notFound();

  // One series per indicator × dwelling type; annual rows where they exist, else the native frequency.
  const keys = [...new Set(data.rows.map((r) => `${r.indicator}|${r.dwelling_type}`))];
  const series = keys.map((key) => {
    const [indicator, type] = key.split("|");
    const all = data.rows.filter((r) => r.indicator === indicator && r.dwelling_type === type && r.status === "actual");
    const freq = all.some((r) => r.frequency === "A") ? "A" : all[0]?.frequency;
    const points = all.filter((r) => r.frequency === freq).sort((a, b) => a.period.localeCompare(b.period));
    const nat = data.national.filter((r) => r.indicator === indicator && r.dwelling_type === type && r.frequency === freq && r.status === "actual").sort((a, b) => a.period.localeCompare(b.period));
    const latest = points.at(-1), natLatest = nat.at(-1);
    return { indicator, type, freq, points, nat, latest, natLatest, label: labels[indicator]?.label ?? indicator, unit: labels[indicator]?.unit ?? "", source: latest?.source ?? "" };
  }).filter((s) => s.points.length).sort((a, b) => a.label.localeCompare(b.label));

  const others = regions.filter((r) => r.slug !== slug);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow"><Link href={`/countries/${iso3}`}>{flagEmoji(c.iso2)} {c.name}</Link></p>
          <h1>{data.region}</h1>
          <p className="lede">Housing data published for {data.region} by national agencies. This page is descriptive: the 10-year projections, rate toggle and indexes are modelled for {c.name} as a whole.</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><span className="badge">{series.length} series</span></div>
      </header>

      <section className="section">
        <div className="section-title"><div><h2>Latest readings</h2></div><p>Most recent value of each series, with the national figure where the same measure is published for the whole country.</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Measure</th><th className="r">{data.region}</th><th className="r">{c.name}</th><th>Period</th><th>Source</th></tr></thead>
            <tbody>{series.map((s) => (
              <tr key={`${s.indicator}|${s.type}`}>
                <td>{s.label}{s.type ? ` · ${TYPE_LABELS[s.type] ?? s.type}` : ""}<div className="note">{s.unit}</div></td>
                <td className="r"><strong>{s.latest ? value(s.latest.value) : "–"}</strong></td>
                <td className="r">{s.natLatest ? value(s.natLatest.value) : "–"}</td>
                <td>{s.latest?.period}</td>
                <td className="note">{s.source}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><h2>History</h2></div><p>{series.some((s) => s.nat.length) ? `Where ${c.name} publishes the same measure, it is drawn alongside for comparison.` : "Series as published by the source."}</p></div>
        <div className="grid-2">
          {series.filter((s) => s.points.length > 1).map((s) => (
            <div key={`${s.indicator}|${s.type}`} className="panel">
              <h3 className="display" style={{ margin: "0 0 4px", fontSize: 18 }}>{s.label}{s.type ? ` · ${TYPE_LABELS[s.type] ?? s.type}` : ""}</h3>
              <p className="note" style={{ margin: "0 0 8px" }}>{s.unit} · {s.freq === "A" ? "annual" : s.freq === "Q" ? "quarterly" : "monthly"}</p>
              <SeriesChart
                label={`${s.label} in ${data.region}`}
                unit={s.unit}
                series={[
                  { name: data.region, color: "var(--line)", points: s.points.map((p) => ({ period: p.period, value: p.value })) },
                  ...(s.nat.length ? [{ name: c.name, color: "var(--faint)", points: s.nat.map((p) => ({ period: p.period, value: p.value })) }] : []),
                ]}
              />
            </div>
          ))}
        </div>
      </section>

      {others.length ? (
        <section className="section">
          <div className="section-title"><div><h2>Other regions in {c.name}</h2></div></div>
          <div className="chips">{others.map((r) => <Link key={r.slug} className="chip" href={`/countries/${iso3}/${r.slug}`}>{r.name}</Link>)}</div>
        </section>
      ) : null}
    </div>
  );
}
