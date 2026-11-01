import { countries, liveLog, recentRuns } from "@/lib/data";
import { SITE_URL, rss, type FeedItem } from "@/lib/api-helpers";

// Global change feed: live-layer changes (rate moves, events starting or ending, adjustments)
// and new projection runs.
export const revalidate = 3600;

export async function GET() {
  const [log, runs, list] = await Promise.all([liveLog(), recentRuns(10), countries()]);
  const names = Object.fromEntries(list.map((c) => [c.iso3, c.name]));
  const items: FeedItem[] = [
    ...log.slice(0, 50).map((l) => ({
      title: `${names[l.country] ?? l.country}: ${l.message}`,
      link: `${SITE_URL}/countries/${l.country}`,
      guid: `live-${l.id}`,
      date: l.date,
      category: l.kind,
      description: `${l.message}${l.delta10 != null ? ` (10-year real price path ${l.delta10 > 0 ? "+" : ""}${Number(l.delta10).toFixed(2)} log points)` : ""}`,
    })),
    ...runs.map((r) => ({
      title: `New projection run ${r.id} (data vintage ${r.data_vintage})`,
      link: `${SITE_URL}/methodology`,
      guid: `run-${r.id}`,
      date: r.created_at,
      category: "projection_run",
      description: `Model ${r.model_version}: 10-year price and rent projections, backtests, flags and indexes were refreshed.`,
    })),
  ];
  const xml = rss({ title: "Global Housing Intelligence: what changed", link: `${SITE_URL}/live`, description: "Daily live-layer changes and new projection runs for house prices and rents in 217 economies.", selfUrl: `${SITE_URL}/feed.xml`, items });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=1800, stale-while-revalidate=86400" } });
}
