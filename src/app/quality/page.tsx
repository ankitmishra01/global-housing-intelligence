import type { Metadata } from "next";
import Link from "next/link";
import { qualityChecks, type QualityCheck } from "@/lib/data";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Data quality" };

type Freshness = { indicator: string; frequency: string; latest: string; monthsOld: number; stale: boolean };
const FREQ: Record<string, string> = { A: "Annual", Q: "Quarterly", M: "Monthly" };
const badge = (s: QualityCheck["severity"]) => <span className={`badge ${s === "pass" ? "badge--t1" : s === "warn" ? "badge--warn" : s === "info" ? "" : "badge--flag"}`}>{s}</span>;

export default async function QualityPage() {
  const { runAt, liveRunAt, checks } = await qualityChecks();
  const categories = [...new Set(checks.map((c) => c.category))];
  const count = (s: string) => checks.filter((c) => c.severity === s).length;
  const freshness = ((checks.find((c) => c.check_id === "freshness.sources")?.details.series ?? []) as Freshness[]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Data quality {runAt ? `· checked ${runAt.slice(0, 16).replace("T", " ")} UTC` : ""}</p>
          <h1>How much to trust the numbers</h1>
          <p className="lede">Automated checks run after every training run and every daily live update: coverage, freshness, validity, cross-source consistency, and the integrity of every projection, index and live adjustment. Integrity failures stop the pipeline before anything is published.</p>
        </div>
      </header>

      {!runAt ? <div className="empty"><h2>No quality run yet</h2><p>Checks run with the next training run.</p></div> : (
        <>
          <div className="stats">
            <div><span>Checks</span><strong className="num">{checks.length}</strong><small>{categories.length} categories</small></div>
            <div><span>Pass</span><strong className="num pos">{count("pass")}</strong><small>no issue found</small></div>
            <div><span>Warn</span><strong className="num" style={{ color: "var(--gold)" }}>{count("warn")}</strong><small>published, with caveats</small></div>
            <div><span>Fail</span><strong className="num neg">{count("fail")}</strong><small>{liveRunAt ? `live checks ${liveRunAt.slice(0, 10)}` : "integrity failures"}</small></div>
          </div>

          {categories.map((cat) => (
            <section key={cat} className="section">
              <div className="section-title"><div><p className="eyebrow">{cat}</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Status</th><th>Check</th><th>Result</th></tr></thead>
                  <tbody>{checks.filter((c) => c.category === cat).map((c) => (
                    <tr key={c.check_id}><td>{badge(c.severity)}</td><td className="mono" style={{ whiteSpace: "nowrap" }}>{c.check_id}</td><td>{c.summary}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ))}

          {freshness.length ? (
            <section className="section">
              <div className="section-title"><div><p className="eyebrow">Freshness</p><h2>Latest reading per series</h2></div><p>Allowed lag: annual 22 months, quarterly 9, monthly 5 after the period ends.</p></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Series</th><th>Frequency</th><th>Latest</th><th className="r">Months old</th><th>Status</th></tr></thead>
                  <tbody>{freshness.map((f) => (
                    <tr key={`${f.indicator}${f.frequency}`}><td className="mono">{f.indicator}</td><td>{FREQ[f.frequency] ?? f.frequency}</td><td className="mono">{f.latest}</td><td className="r">{f.monthsOld}</td><td>{badge(f.stale ? "warn" : "pass")}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : null}
          <p className="note" style={{ marginTop: 24 }}>Full audit write-up: <Link className="link" href="https://github.com/ankitmishra01/global-housing-intelligence/blob/main/docs/DATA_QUALITY.md">docs/DATA_QUALITY.md</Link>.</p>
        </>
      )}
    </div>
  );
}
