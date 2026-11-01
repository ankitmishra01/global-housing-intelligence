import { NextResponse } from "next/server";
import { countries, latestRun } from "@/lib/data";

export async function GET() {
  const [list, run] = await Promise.all([countries(), latestRun()]);
  return NextResponse.json({
    runId: run?.id ?? null,
    dataVintage: run?.data_vintage ?? null,
    countries: list.map((c) => ({ iso3: c.iso3, iso2: c.iso2, name: c.name, region: c.region, incomeGroup: c.income_group, tier: c.tier, hasPrice: !!c.has_price, hasRent: !!c.has_rent, hasNational: !!c.has_national })),
  });
}
