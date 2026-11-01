import Link from "next/link";
import { WorldMap } from "@/components/world-map";
import { activeEvents, applyLive, countries, flags, latestRun, liveLog, liveShifts, liveStates, personaRows, projections } from "@/lib/data";
import { flagEmoji, pct, PERSONA_ORDER } from "@/lib/labels";

export const revalidate = 86400;

// Scale the map to the data: the 90th percentile of absolute changes, rounded up to 10.
function mapScale(values: number[]) {
  const a = values.map(Math.abs).sort((x, y) => x - y);
  const p90 = a.length ? a[Math.floor(a.length * 0.9)] : 40;
  return Math.max(10, Math.ceil(p90 / 10) * 10);
}

export default async function Overview() {
  const [run, list, rawProj, allFlags, personas, shifts, events, states, log] = await Promise.all([latestRun(), countries(), projections(), flags(), personaRows(), liveShifts(), activeEvents(), liveStates(), liveLog()]);
  // Every number on this page includes today's live adjustments (rates and detected events).
  const proj = rawProj.map((p) => applyLive([p], shifts[p.country]?.[p.target])[0]);
  const rateMoves = states.filter((s) => s.rate_delta != null && Math.abs(s.rate_delta) >= 0.25);
  if (!run) return <div className="page"><div className="empty"><p className="eyebrow">No data yet</p><h2>The first data refresh has not run</h2><p>Run the seed and training pipeline to populate the database.</p></div></div>;

  const byIso = Object.fromEntries(list.map((c) => [c.iso3, c]));
  const at10 = (target: string) => Object.fromEntries(proj.filter((p) => p.target === target && p.horizon === 10).map((p) => [p.country, p]));
  const price10 = at10("real_price"), rent10 = at10("real_rent");
  const mapValues = Object.fromEntries(Object.entries(price10).map(([k, p]) => [k, p.median - 100]));
  const ranked = Object.values(price10).sort((a, b) => b.median - a.median);
  const tier1 = list.filter((c) => c.tier === 1).length;
  const medianOf = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const names = Object.fromEntries(list.map((c) => [c.iso3, c.name]));
  const med10 = medianOf(Object.values(price10).map((p) => p.median - 100));
  const medRent10 = medianOf(Object.values(rent10).map((p) => p.median - 100));

  return (
    <div className="page">
      <header className="page-head page-head--hero">
        <div>
          <p className="eyebrow"><span className="hero-pill"><span className="live-dot" aria-hidden="true" />Live dataset</span> Global · {tier1} markets with price data · 10-year horizon · price data to {run.summary.latestYear}</p>
          <h1>
            The median housing market is projected to gain <span className="pos-on-ink">{pct(med10)}</span> in real prices over ten years.
            <span className="hero-sub"> Rents follow at {pct(medRent10)}, with {allFlags.length} risk flags across {new Set(allFlags.map((f) => f.country)).size} economies.</span>
          </h1>
        </div>
        <div className="hero-stats">
          <div><span>Economies</span><strong className="num">{list.length}</strong><small>{tier1} with official price indexes</small></div>
          <div><span>Median real price, 10y</span><strong className="num">{pct(med10)}</strong><small>after inflation</small></div>
          <div><span>Median real rent, 10y</span><strong className="num">{pct(medRent10)}</strong><small>{Object.keys(rent10).length} rent indexes</small></div>
          <div><span>Strongest outlook</span><strong className="num">{pct(ranked[0] ? ranked[0].median - 100 : null)}</strong><small>{byIso[ranked[0]?.country]?.name ?? "–"}</small></div>
          <div><span>Weakest outlook</span><strong className="num">{pct(ranked.at(-1) ? ranked.at(-1)!.median - 100 : null)}</strong><small className="warn-on-ink">{byIso[ranked.at(-1)?.country ?? ""]?.name ?? "–"}</small></div>
          <div><span>Live events</span><strong className="num">{events.length}</strong><small className="warn-on-ink">{rateMoves.length} rate moves applied</small></div>
        </div>
      </header>

      {log.length ? (
        <section className="section" style={{ marginTop: 4 }}>
          <div className="section-title"><div><h2>What changed <span className="count">/ {log.length}</span></h2></div><p>Rate moves, detected events and adjustments from the daily live run, newest first. <Link className="link" href="/live">All changes</Link></p></div>
          <div className="change-list">
            {log.slice(0, 8).map((l) => (
              <article key={l.id}>
                <div>
                  <p className="change-list__title">{flagEmoji(byIso[l.country]?.iso2)} <Link href={`/countries/${l.country}`}>{byIso[l.country]?.name ?? l.country}</Link> <span className="badge badge--warn">{l.kind.replace(/_/g, " ")}</span></p>
                  <p className="change-list__meta">{l.message} · <span className="badge badge--t1">as of {l.date}</span></p>
                </div>
                <strong className={`num ${(l.delta10 ?? 0) < 0 ? "neg" : "pos"}`}>{l.delta10 != null && Math.abs(l.delta10) >= 0.05 ? pct(100 * (Math.exp(l.delta10 / 100) - 1)) : ""}</strong>
              </article>
            ))}
          </div>
        </section>
      ) : null}


      <section className="section">
        <div className="section-title"><div><p className="eyebrow">10-year outlook</p><h2>Projected real house price change</h2></div><p>Median projection after inflation. Select a country for its fan chart, rents, dwelling types and the rate toggle.</p></div>
        <div className="panel"><WorldMap values={mapValues} names={names} maxAbs={mapScale(Object.values(mapValues))} label="Map of projected 10-year real house price change by country" /></div>
      </section>


      <section className="section grid-2">
        {[{ title: "Strongest 10-year outlook", rows: ranked.slice(0, 10) }, { title: "Weakest 10-year outlook", rows: ranked.slice(-10).reverse() }].map((block) => (
          <div key={block.title}>
            <div className="section-title"><h2>{block.title}</h2></div>
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
