import type { Metadata } from "next";
import Link from "next/link";
import { PredictedActualScatter } from "@/components/track-record-chart";
import { allBacktestPoints, backtests, countries, toPctChange, trackRecordSummary, vintageScores } from "@/lib/data";
import { flagEmoji, fmt, TARGET_LABELS } from "@/lib/labels";

export const revalidate = 86400;
export const metadata: Metadata = { title: "Track record" };

const pctFmt = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "–" : `${v.toFixed(d)}%`);

export default async function TrackRecordPage() {
  const [summary, bt, h1, h5, list, scores] = await Promise.all([trackRecordSummary(), backtests(), allBacktestPoints("real_price", 1), allBacktestPoints("real_price", 5), countries(), vintageScores()]);
  const names = Object.fromEntries(list.map((c) => [c.iso3, c]));
  const scatter = (pts: typeof h1) => pts.map((p) => ({ predicted: toPctChange(Number(p.predicted)), actual: toPctChange(Number(p.actual)), label: `${p.country} ${p.origin}` }));

  // Per-country accuracy of 1-year real price projections across all backtest dates.
  const byCountry = new Map<string, { n: number; abs: number; hit: number; first: number; last: number }>();
  for (const p of h1) {
    const pr = toPctChange(Number(p.predicted)), ac = toPctChange(Number(p.actual));
    const r = byCountry.get(p.country) ?? { n: 0, abs: 0, hit: 0, first: Number(p.origin), last: Number(p.origin) };
    r.n++; r.abs += Math.abs(ac - pr); r.hit += (ac >= 0) === (pr >= 0) ? 1 : 0; r.last = Math.max(r.last, Number(p.origin)); r.first = Math.min(r.first, Number(p.origin));
    byCountry.set(p.country, r);
  }
  const countryRows = [...byCountry].map(([iso3, r]) => ({ iso3, n: r.n, mae: r.abs / r.n, hit: (100 * r.hit) / r.n, span: `${r.first + 1}–${r.last + 1}` })).sort((a, b) => a.mae - b.mae);
  const headline = summary.backtest.filter((r) => r.target === "real_price");

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Track record</p>
          <h1>How the projections have done</h1>
          <p className="lede">Two kinds of evidence. A pseudo-out-of-sample backtest re-runs the model at past dates using only data available then and compares with what happened. A live scorecard checks projections this site actually published, as they come due.</p>
        </div>
      </header>

      <div className="stats">
        {headline.map((r) => (
          <div key={r.horizon}>
            <span>{r.horizon}-year real price projections</span>
            <strong className="num">{pctFmt(100 * Number(r.direction_hit), 0)}</strong>
            <small>right direction · average miss {fmt(Number(r.mae), 1)} pts · {Number(r.n)} forecasts</small>
          </div>
        ))}
      </div>

      <section className="section">
        <div className="section-title"><div><h2>Pseudo-out-of-sample backtest</h2></div><p>Each dot is one country at one past forecast date, using only the data available at that date. Dots on the dashed line were forecast exactly.</p></div>
        <div className="grid-2">
          <div className="panel">
            <h3 className="display" style={{ margin: "0 0 6px", fontSize: 18, color: "var(--line)" }}>1 year ahead</h3>
            <PredictedActualScatter points={scatter(h1)} label="Projected versus actual 1-year real house price change" />
          </div>
          <div className="panel">
            <h3 className="display" style={{ margin: "0 0 6px", fontSize: 18, color: "var(--line)" }}>5 years ahead</h3>
            <PredictedActualScatter points={scatter(h5)} label="Projected versus actual 5-year real house price change" />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><h2>Skill against a no-change forecast</h2></div><p>Errors on the later half of backtest dates, which the method selection never saw. <Link className="link" href="/methodology">Method</Link></p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Projection</th><th className="r">Horizon</th><th>Shipped method</th><th className="r">Average miss</th><th className="r">No-change miss</th><th className="r">Skill</th><th className="r">Inside 80% range</th><th className="r">Forecast dates</th></tr></thead>
            <tbody>{bt.map((r) => (
              <tr key={`${r.target}${r.horizon}`}>
                <td>{TARGET_LABELS[r.target] ?? (r.target === "type_price" ? "Prices by dwelling type" : r.target)}</td>
                <td className="r">{r.horizon}y</td>
                <td className="note">{r.method}</td>
                <td className="r">{fmt(Number(r.mae), 1)}</td>
                <td className="r">{fmt(Number(r.baseline_mae), 1)}</td>
                <td className={`r ${Number(r.skill_pct) > 0 ? "pos" : ""}`}>{pctFmt(Number(r.skill_pct))}</td>
                <td className="r">{pctFmt(Number(r.coverage80), 0)}</td>
                <td className="r">{r.n_origins}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><h2>By country, 1 year ahead</h2></div><p>Average miss in percentage points of real price change, and how often the direction (up or down) was right.</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Country</th><th className="r">Average miss</th><th className="r">Right direction</th><th className="r">Forecasts</th><th>Years</th></tr></thead>
            <tbody>{countryRows.map((r) => (
              <tr key={r.iso3}>
                <td><Link href={`/countries/${r.iso3}`}>{flagEmoji(names[r.iso3]?.iso2)} {names[r.iso3]?.name ?? r.iso3}</Link></td>
                <td className="r">{fmt(r.mae, 1)} pts</td>
                <td className="r">{pctFmt(r.hit, 0)}</td>
                <td className="r">{r.n}</td>
                <td>{r.span}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><h2>Live forecast scorecard</h2></div><p>Projections this site published, scored when their target year&apos;s official data arrives.</p></div>
        {scores.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Country</th><th>Measure</th><th className="r">Target year</th><th className="r">Projected</th><th className="r">Actual</th><th className="r">Inside 80% range</th></tr></thead>
              <tbody>{scores.slice(0, 100).map((s) => (
                <tr key={`${s.vintage_run_id}${s.country}${s.target}${s.horizon}`}>
                  <td>{names[s.country]?.name ?? s.country}</td><td>{TARGET_LABELS[s.target] ?? s.target}</td><td className="r">{s.target_year}</td>
                  <td className="r">{fmt(Number(s.projected_median) - 100, 1)}%</td><td className="r">{fmt(Number(s.actual) - 100, 1)}%</td>
                  <td className="r">{Number(s.in80) ? <span className="badge badge--t1">Yes</span> : <span className="badge badge--flag">No</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h2>No published projection has come due yet</h2>
            <p>Every monthly run is kept. The first 1-year projections, made in 2026, are scored automatically when full-year 2027 data is published, and the results will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
