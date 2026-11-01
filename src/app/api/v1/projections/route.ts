import { withRateLimit } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";
import { latestRun, projections } from "@/lib/data";

async function handler(request: NextRequest) {
  const c = request.nextUrl.searchParams.get("c")?.toUpperCase() ?? "";
  const target = request.nextUrl.searchParams.get("target");
  if (!/^[A-Z]{3}$/.test(c)) return NextResponse.json({ error: "Query parameter c must be an ISO3 country code, e.g. ?c=CAN" }, { status: 400 });
  if (target && !/^[a-z_]+(:[a-z_]+)?$/.test(target)) return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  const run = await latestRun();
  if (!run) return NextResponse.json({ error: "No projection run available yet" }, { status: 404 });
  const rows = (await projections(c)).filter((p) => !target || p.target === target);
  if (!rows.length) return NextResponse.json({ error: `No projections for ${c}. Only Tier 1 economies with an official house price index are projected.` }, { status: 404 });
  return NextResponse.json({ runId: run.id, modelVersion: run.model_version, dataVintage: run.data_vintage, country: c, unit: "index, origin year = 100", rows });
}

export const GET = withRateLimit("api", handler);
