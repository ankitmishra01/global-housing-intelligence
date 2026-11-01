import { NextResponse, type NextRequest } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { buildFacts, checkNumbers } from "@/lib/agent";

export const maxDuration = 60;

// AI Gateway model id; override with AI_MODEL (the free gateway tier excludes the largest models).
const MODEL = process.env.AI_MODEL || "anthropic/claude-sonnet-5.5";
const Body = z.object({
  question: z.string().trim().min(3).max(500),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
});

const INSTRUCTIONS = `You are the analyst for Global Housing Intelligence, a public dashboard of house prices and rents.
Answer only from the FACTS block in the user message. Restate numbers exactly as they appear there; do not compute new numbers, convert currencies, or add figures from memory.
If the facts do not cover the question, say plainly that the data here does not cover it.
Explain uncertainty: mention the 80% range and whether the method showed out-of-sample skill or fell back to a baseline.
Keep answers under 180 words, plain prose, no headings. This is general information, not financial advice; say so in one short sentence when the question is about a personal decision.`;

// Best-effort per-instance limit: 10 requests per minute per IP.
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return NextResponse.json({ error: "Too many questions. Try again in a minute." }, { status: 429 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send {question: 3-500 characters, country?: ISO3 code}." }, { status: 400 });
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return NextResponse.json({ error: "Ask AI is not configured: set AI_GATEWAY_API_KEY, or deploy on Vercel so OIDC authenticates the AI Gateway." }, { status: 503 });
  }

  const facts = await buildFacts(parsed.data.country);
  if (!facts) return NextResponse.json({ error: "No projection run is stored yet." }, { status: 404 });
  const factsText = facts.map((f) => `- ${f}`).join("\n");

  try {
    const { text } = await generateText({
      model: MODEL,
      instructions: INSTRUCTIONS,
      prompt: `FACTS:\n${factsText}\n\nQUESTION: ${parsed.data.question}`,
    });
    return NextResponse.json({ answer: text, model: MODEL, guardrail: checkNumbers(text, factsText), facts });
  } catch (error) {
    console.error("[agent]", error);
    return NextResponse.json({ error: "The AI analyst is unavailable right now." }, { status: 502 });
  }
}
