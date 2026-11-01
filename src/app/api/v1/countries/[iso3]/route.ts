import { NextResponse } from "next/server";
import { parseIso3 } from "@/lib/api-helpers";
import { countryFull, ToolError } from "@/lib/mcp-tools";
import { withRateLimit } from "@/lib/rate-limit";

// Full country JSON: live-adjusted bands for every target, outlook summary, flags, signals,
// affordability and the latest national / regional values.
export const GET = withRateLimit("api", async (_request: Request, { params }: { params: Promise<{ iso3: string }> }) => {
  const iso3 = parseIso3((await params).iso3);
  if (!iso3) return NextResponse.json({ error: "Path must end with an ISO3 country code, e.g. /api/v1/countries/CAN" }, { status: 400 });
  try {
    return NextResponse.json(await countryFull(iso3));
  } catch (error) {
    if (error instanceof ToolError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
});
