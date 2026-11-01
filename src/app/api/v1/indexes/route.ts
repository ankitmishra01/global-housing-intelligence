import { NextResponse, type NextRequest } from "next/server";
import { latestRun, personaRows } from "@/lib/data";

const PERSONAS = ["investor", "buyer", "renter", "seller"];

export async function GET(request: NextRequest) {
  const persona = request.nextUrl.searchParams.get("persona");
  if (persona && !PERSONAS.includes(persona)) return NextResponse.json({ error: `persona must be one of ${PERSONAS.join(", ")}` }, { status: 400 });
  const run = await latestRun();
  if (!run) return NextResponse.json({ error: "No projection run available yet" }, { status: 404 });
  const rows = (await personaRows()).filter((r) => !persona || r.persona === persona);
  return NextResponse.json({ runId: run.id, dataVintage: run.data_vintage, weights: run.summary.personas, rows });
}
