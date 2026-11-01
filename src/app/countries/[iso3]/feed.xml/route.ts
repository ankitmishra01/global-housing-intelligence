import { contexts, country, flags, latestRun, liveLogFor } from "@/lib/data";
import { SITE_URL, parseIso3, rss, type FeedItem } from "@/lib/api-helpers";

// Per-country change feed: live-layer log entries plus the current risk flags and persona
// signals. Flag and signal items carry the run id and label in their guid, so a feed reader
// sees a new item whenever one changes.
export const revalidate = 3600;

export async function GET(_request: Request, { params }: { params: Promise<{ iso3: string }> }) {
  const iso3 = parseIso3((await params).iso3);
  const c = iso3 ? await country(iso3) : null;
  if (!c) return new Response("Unknown country", { status: 404 });
  const [log, run, allFlags, ctxs] = await Promise.all([liveLogFor(c.iso3), latestRun(), flags(), contexts()]);
  const ctx = ctxs.find((x) => x.country === c.iso3);
  const page = `${SITE_URL}/countries/${c.iso3}`;
  const runDate = run?.created_at ?? new Date().toISOString();
  const items: FeedItem[] = [
    ...log.map((l) => ({ title: l.message, link: page, guid: `live-${l.id}`, date: l.date, category: l.kind })),
    ...allFlags.filter((f) => f.country === c.iso3).map((f) => ({
      title: `Risk flag: ${run?.summary.flagRules[f.flag]?.label ?? f.flag}`,
      link: page, guid: `flag-${run?.id}-${f.flag}`, date: runDate, category: "risk_flag",
      description: `Reading ${f.value} against a threshold of ${f.threshold} (as of ${f.as_of}).`,
    })),
    ...Object.values(ctx?.details.signals ?? {}).map((s) => ({
      title: `${s.persona[0].toUpperCase()}${s.persona.slice(1)} signal: ${s.label}`,
      link: page, guid: `signal-${c.iso3}-${s.persona}-${s.label}-${run?.data_vintage}`, date: runDate, category: "signal",
      description: [...s.support, ...s.oppose.map((o) => `But: ${o}`)].join(" "),
    })),
  ];
  const xml = rss({ title: `${c.name} housing: what changed`, link: page, description: `Live adjustments, risk flags and market signals for ${c.name} from Global Housing Intelligence.`, selfUrl: `${page}/feed.xml`, items });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=1800, stale-while-revalidate=86400" } });
}
