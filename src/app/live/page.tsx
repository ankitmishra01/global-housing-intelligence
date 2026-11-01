import type { Metadata } from "next";
import Link from "next/link";
import { activeEvents, countries, eventLibrary, liveLog, liveRuns, liveStates, recentEvents } from "@/lib/data";
import { EVENT_LABELS, flagEmoji, fmt, pct } from "@/lib/labels";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Live adjustments" };

const toPct = (logPts: number | null | undefined) => (logPts == null ? null : 100 * (Math.exp(logPts / 100) - 1));

export default async function LivePage() {
  const [list, states, active, recent, log, library, runs] = await Promise.all([countries(), liveStates(), activeEvents(), recentEvents(), liveLog(), eventLibrary(), liveRuns()]);
  const lastRun = runs.find((r) => r.ok);
  const TRIGGERS: Record<string, string> = { "vercel-cron": "daily job", "refresh-workflow": "monthly data refresh", cli: "manual run" };
  const byIso = Object.fromEntries(list.map((c) => [c.iso3, c]));
  const asOf = states[0]?.as_of;
  const moved = [...states].filter((s) => s.shift10_price != null && Math.abs(s.shift10_price) >= 0.05).sort((a, b) => Math.abs(b.shift10_price!) - Math.abs(a.shift10_price!));
  const evidence = (raw: string) => { try { const e = JSON.parse(raw); return Object.entries(e).filter(([, v]) => typeof v !== "object").slice(0, 4).map(([k, v]) => `${k}: ${typeof v === "number" ? fmt(v, 2) : v}`).join(" · "); } catch { return ""; } };
  const lib = (cls: string, target: string, h: number) => library.find((r) => r.class === cls && r.target === target && r.horizon === h);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="live-dot" aria-hidden="true" />Live layer {lastRun ? `· updated ${lastRun.run_at.slice(0, 16).replace("T", " ")} UTC by the ${TRIGGERS[lastRun.trigger] ?? lastRun.trigger}` : asOf ? `· updated ${asOf}` : ""}</p>
          <h1>What changed, and what it did to the outlook</h1>
          <p className="lede">Every day the live layer reads current central bank rates, global news events (GDELT), disaster alerts (GDACS) and exchange rates. Rate moves and detected events adjust the projections automatically, using effects measured from history.</p>
        </div>
      </header>

      {!asOf ? <div className="empty"><h2>The live layer has not run yet</h2><p>It runs daily at 06:15 UTC.</p></div> : null}

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Active events</p><h2>Applied to projections now</h2></div><p>Detected automatically. Each one applies the typical effect of its event class, measured on past episodes.</p></div>
        {active.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Country</th><th>Event</th><th>Since</th><th className="r">Intensity</th><th className="r">Typical 3y price effect</th><th>Evidence</th></tr></thead>
              <tbody>{active.map((e) => {
                const l = lib(e.class, "real_price", 3);
                return (
                  <tr key={e.id}>
                    <td><Link href={`/countries/${e.country}`}>{flagEmoji(byIso[e.country]?.iso2)} {byIso[e.country]?.name ?? e.country}</Link>{byIso[e.country]?.tier === 2 ? <span className="badge" style={{ marginLeft: 6 }}>no price index</span> : null}</td>
                    <td>{EVENT_LABELS[e.class] ?? e.class}</td>
                    <td className="mono">{e.onset}</td>
                    <td className="r">{fmt(e.intensity, 1)} <span className="note">{e.metric}</span></td>
                    <td className="r">{l ? `${pct(toPct(l.effect))} ± ${fmt(l.se, 1)} (${l.n_episodes} ep.)` : "–"}</td>
                    <td className="note">{evidence(e.evidence)} · {e.source}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="note">No active events today.</p>}
      </section>

      <section className="section">
        <div className="section-title"><div><p className="eyebrow">Biggest moves</p><h2>Live change to the 10-year real price path</h2></div><p>Rate changes since the projection origin plus active events.</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Country</th><th className="r">Policy rate now</th><th className="r">At origin</th><th className="r">10y price shift</th><th className="r">10y rent shift</th><th>Why</th></tr></thead>
            <tbody>{moved.slice(0, 30).map((s) => (
              <tr key={s.country}>
                <td><Link href={`/countries/${s.country}`}>{flagEmoji(byIso[s.country]?.iso2)} {byIso[s.country]?.name ?? s.country}</Link></td>
                <td className="r">{s.policy_rate_now != null ? `${fmt(s.policy_rate_now, 2)}%` : "–"}</td>
                <td className="r">{s.policy_rate_origin != null ? `${fmt(s.policy_rate_origin, 2)}%` : "–"}</td>
                <td className={`r ${(s.shift10_price ?? 0) < 0 ? "neg" : "pos"}`}>{pct(toPct(s.shift10_price))}</td>
                <td className="r">{pct(toPct(s.shift10_rent))}</td>
                <td className="note">{s.explanation.map((e) => e.text).join(" ")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="section grid-2">
        <div>
          <div className="section-title"><div><p className="eyebrow">Change log</p><h2>Timeline</h2></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Country</th><th>Change</th></tr></thead>
              <tbody>{log.length ? log.map((l) => (
                <tr key={l.id}><td className="mono">{l.date}</td><td>{byIso[l.country]?.name ?? l.country}</td><td>{l.message}{l.delta10 != null ? <span className="note"> ({pct(toPct(l.delta10))} on 10y)</span> : null}</td></tr>
              )) : <tr><td colSpan={3} className="note">No changes logged yet.</td></tr>}</tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="section-title"><div><p className="eyebrow">Event library</p><h2>How past events moved housing</h2></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Event class</th><th className="r">Price 1y</th><th className="r">Price 3y</th><th className="r">Rent 3y</th><th className="r">Episodes</th></tr></thead>
              <tbody>{[...new Set(library.map((r) => r.class))].map((cls) => (
                <tr key={cls}>
                  <td>{EVENT_LABELS[cls] ?? cls}</td>
                  <td className="r">{pct(toPct(lib(cls, "real_price", 1)?.effect))}</td>
                  <td className="r">{pct(toPct(lib(cls, "real_price", 3)?.effect))}</td>
                  <td className="r">{pct(toPct(lib(cls, "real_rent", 3)?.effect))}</td>
                  <td className="r">{lib(cls, "real_price", 3)?.n_episodes ?? "–"}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="note" style={{ padding: "0 12px 10px" }}>Real price and rent moves versus what the model expected just before each episode, shrunk toward zero when episodes are few. <Link className="link" href="/methodology">Method</Link></p>
          </div>
          <div className="section-title" style={{ marginTop: 28 }}><h2 style={{ fontSize: 20 }}>Recently seen</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Country</th><th>Event</th><th>Status</th><th>Last seen</th></tr></thead>
              <tbody>{recent.slice(0, 20).map((e) => <tr key={e.id}><td>{byIso[e.country]?.name ?? e.country}</td><td>{EVENT_LABELS[e.class] ?? e.class}</td><td><span className={`badge ${e.status === "active" ? "badge--flag" : ""}`}>{e.status}</span></td><td className="mono">{e.last_seen}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
