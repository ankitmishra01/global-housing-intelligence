import Link from "next/link";
import { WorldMap } from "@/components/world-map";
import { activeEvents, applyLive, countries, flags, latestRun, liveShifts, liveStates, personaRows, projections } from "@/lib/data";
import { EVENT_LABELS, flagEmoji, pct, PERSONA_ORDER } from "@/lib/labels";

export const revalidate = 86400;

export default async function Overview() {
  const [run, list, rawProj, allFlags, personas, shifts, events, states] = await Promise.all([latestRun(), countries(), projections(), flags(), personaRows(), liveShifts(), activeEvents(), liveStates()]);
  // Every number on this page includes today's live adjustments (rates and detected events).
  const proj = rawProj.map((p) => applyLive([p], shifts[p.country]?.[p.target])[0]);
  const asOf = states[0]?.as_of;
  const rateMoves = states.filter((s) => s.rate_delta != null && Math.abs(s.rate_delta) >= 0.25);
  if (!run) return <div className="page"><div className="empty"><p className="eyebrow">No data yet</p><h2>The first data refresh has not run</h2><p>Run the seed and training pipeline to populate the database.</p></div></div>;

  const byIso = Object.fromEntries(list.map((c) => [c.iso3, c]));
  const at10 = (target: string) => Object.fromEntries(proj.filter((p) => p.target === target && p.horizon === 10).map((p) => [p.country, p]));
  const price10 = at10("real_price"), rent10 = at10("real_rent");
  const mapValues = Object.fromEntries(Object.entries(price10).map(([k, p]) => [k, p.median - 100]));
  const ranked = Object.values(price10).sort((a, b) => b.median - a.median);
  const tier1 = list.filter((c) => c.tier === 1).length;
  const medianOf = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const names = Object.fromEntries(list.map((c) => [c.iso3, c.name]));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Global housing markets · {run.data_vintage}</p>
          <h1>Where house prices and rents go next</h1>
          <p className="lede">Official house price and rent data for {list.length} economies, 10-year projections tested against history, an interest-rate toggle, and indexes for investors, buyers, renters and sellers.</p>
        </div>
      </header>
      <div className="stats">
        <div><span>Economies covered</span><strong className="num">{list.length}</strong><small>{tier1} with official price indexes</small></div>
        <div><span>Median 10-year real price change</span><strong className="num">{pct(medianOf(Object.values(price10).map((p) => p.median - 100)))}</strong><small>across Tier 1 economies</small></div>
        <div><span>Median 10-year real rent change</span><strong className="num">{pct(medianOf(Object.values(rent10).map((p) => p.median - 100)))}</strong><small>{Object.keys(rent10).length} economies with rent indexes</small></div>
        <div><span>Active risk flags</span><strong className="num">{allFlags.length}</strong><small>across {new Set(allFlags.map((f) => f.country)).size} economies</small></div>
      </div>

      {asOf ? (
        <section className="section live-banner" aria-label="Live layer">
          <div className="live-banner__head">
            <p className="eyebrow"><span className="live-dot" aria-hidden="true" />Live · {asOf}</p>
            <Link className="link" href="/live">Live page →</Link>
          </div>
          <ul>
            <li><strong>{events.length}</strong> active event{events.length === 1 ? "" : "s"}{events.length ? ": " + events.slice(0, 6).map((e) => `${byIso[e.country]?.name ?? e.country} (${(EVENT_LABELS[e.class] ?? e.class).toLowerCase()})`).join(", ") : ""}</li>
            <li><strong>{rateMoves.length}</strong> economies where the policy rate has moved at least 0.25pp since the projection origin; their paths are adjusted automatically.</li>
          </ul>
        </section>
      ) : null}

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">10-year outlook</p><h2>Projected real house price change</h2></div><p>Median projection after inflation. Select a country for its fan chart, rents, dwelling types and the rate toggle.</p></div>
        <div className="panel"><WorldMap values={mapValues} names={names} label="Map of projected 10-year real house price change by country" /></div>
      </section>

      <section className="section grid-2">
        {[{ title: "Strongest 10-year outlook", rows: ranked.slice(0, 10) }, { title: "Weakest 10-year outlook", rows: ranked.slice(-10).reverse() }].map((block) => (
          <div key={block.title}>
            <div className="section-title"><h2 style={{ fontSize: 22 }}>{block.title}</h2></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Country</th><th className="r">Real price, 10y</th><th className="r">80% range</th><th className="r">Real rent, 10y</th></tr></thead>
                <tbody>{block.rows.map((p) => (
                  <tr key={p.country}>
                    <td><Link href={`/countries/${p.country}`}>{flagEmoji(byIso[p.country]?.iso2)} {byIso[p.country]?.name ?? p.country}</Link></td>
                    <td className="r">{pct(p.median - 100)}</td>
                    <td className="r note">{pct(p.p10 - 100, 0)} to {pct(p.p90 - 100, 0)}</td>
                    <td className="r">{rent10[p.country] ? pct(rent10[p.country].median - 100) : "–"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Indexes</p><h2>Top markets by persona</h2></div><Link className="link" href="/indexes">All rankings →</Link></div>
        <div className="grid-4">
          {PERSONA_ORDER.map((k) => (
            <div key={k} className="persona-card">
              <h3>{run.summary.personas[k]?.label}</h3>
              <p>{run.summary.personas[k]?.question}</p>
              <ol style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                {personas.filter((r) => r.persona === k).slice(0, 5).map((r) => (
                  <li key={r.country}><Link href={`/countries/${r.country}`}>{byIso[r.country]?.name}</Link> <span className="note num">{r.score.toFixed(0)}</span></li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Risk register</p><h2>Rule-based flags</h2></div><Link className="link" href="/methodology#flags">Thresholds →</Link></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Country</th><th>Flag</th><th className="r">Reading</th><th>As of</th></tr></thead>
            <tbody>{allFlags.slice(0, 20).map((f) => (
              <tr key={`${f.country}${f.flag}`}><td><Link href={`/countries/${f.country}`}>{byIso[f.country]?.name ?? f.country}</Link></td><td>{run.summary.flagRules[f.flag]?.label}</td><td className="r">{f.value.toFixed(1)}</td><td className="mono">{f.as_of}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
