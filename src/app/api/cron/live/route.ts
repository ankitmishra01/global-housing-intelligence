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
  // ?trigger=refresh-workflow when the monthly GitHub refresh calls this after retraining.
  const trigger = new URL(request.url).searchParams.get("trigger") === "refresh-workflow" ? "refresh-workflow" : "vercel-cron";
  const db = connect();
  try {
    const result = await runLive({ db, log: (line: string) => lines.push(line), trigger });
    // Fresh Turso reads first, then every page (including prerendered country pages).
    revalidateTag("turso", { expire: 0 });
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, ...result, log: lines });
  } catch (error) {
    const message = String((error as Error).message ?? error);
    await db.execute({ sql: "INSERT OR REPLACE INTO live_runs (run_at, trigger, ok, error) VALUES (?, ?, 0, ?)", args: [new Date().toISOString(), trigger, message.slice(0, 500)] }).catch(() => {});
    return NextResponse.json({ ok: false, error: message, log: lines }, { status: 500 });
  }
}
