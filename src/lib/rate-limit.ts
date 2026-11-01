import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { connect } from "../../lib/db.js";
import { clientIp, retryAfterSeconds, windowStart } from "./api-helpers";

// Fixed-window per-IP limit for the public API and MCP server, counted in Turso so it holds
// across function instances. IPs are stored only as salted SHA-256 hashes.
const LIMIT = Number(process.env.API_RATE_LIMIT) || 60;
const WINDOW_SEC = Number(process.env.API_RATE_WINDOW_SEC) || 600;
const SALT = process.env.API_RATE_SALT || "global-housing-intelligence/api-rate/v1";

let db: ReturnType<typeof connect> | null = null;
let tableReady = false;

export type RateResult = { ok: boolean; limit: number; remaining: number; retryAfter: number };

export async function rateLimit(request: Request, bucket: "api" | "mcp"): Promise<RateResult> {
  const now = Date.now();
  const start = windowStart(now, WINDOW_SEC);
  const key = `${bucket}:${createHash("sha256").update(`${SALT}|${clientIp(request.headers)}`).digest("hex").slice(0, 32)}`;
  try {
    db ||= connect();
    if (!tableReady) {
      await db.execute("CREATE TABLE IF NOT EXISTS api_rate (key TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, window_start))");
      tableReady = true;
    }
    const result = await db.execute({
      sql: "INSERT INTO api_rate (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count",
      args: [key, start],
    });
    const count = Number(result.rows[0]?.count ?? 1);
    // Occasional cleanup of finished windows keeps the table small.
    if (Math.random() < 0.02) await db.execute({ sql: "DELETE FROM api_rate WHERE window_start < ?", args: [start - WINDOW_SEC * 1000] });
    return { ok: count <= LIMIT, limit: LIMIT, remaining: Math.max(0, LIMIT - count), retryAfter: retryAfterSeconds(now, WINDOW_SEC) };
  } catch {
    // The limiter must never take the API down: fail open if the database is unreachable.
    return { ok: true, limit: LIMIT, remaining: LIMIT, retryAfter: 0 };
  }
}

export function rateHeaders(r: RateResult): Record<string, string> {
  return { "X-RateLimit-Limit": String(r.limit), "X-RateLimit-Remaining": String(r.remaining) };
}

export function tooMany(r: RateResult) {
  return NextResponse.json(
    { error: `Rate limit exceeded: ${r.limit} requests per ${WINDOW_SEC / 60} minutes per IP. Try again in ${r.retryAfter}s.` },
    { status: 429, headers: { ...rateHeaders(r), "Retry-After": String(r.retryAfter) } },
  );
}

// Wrap a route handler with the limiter; adds rate headers to successful responses.
export function withRateLimit<R extends Request, A extends unknown[]>(bucket: "api" | "mcp", handler: (request: R, ...rest: A) => Promise<Response> | Response) {
  return async (request: R, ...rest: A): Promise<Response> => {
    const r = await rateLimit(request, bucket);
    if (!r.ok) return tooMany(r);
    const response = await handler(request, ...rest);
    try {
      for (const [k, v] of Object.entries(rateHeaders(r))) response.headers.set(k, v);
    } catch { /* immutable headers (e.g. redirects): skip */ }
    return response;
  };
}
