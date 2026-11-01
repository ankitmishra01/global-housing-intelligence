import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { connect } from "../../../../../lib/db.js";
import { runLive } from "../../../../../sync/live.js";

// Daily live layer, triggered by Vercel Cron (see vercel.ts). Vercel sends
// `Authorization: Bearer $CRON_SECRET`; anything else is rejected.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const lines: string[] = [];
  try {
    const result = await runLive({ db: connect(), log: (line: string) => lines.push(line) });
    // Fresh Turso reads first, then every page (including prerendered country pages).
    revalidateTag("turso", { expire: 0 });
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, ...result, log: lines });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String((error as Error).message ?? error), log: lines }, { status: 500 });
  }
}
