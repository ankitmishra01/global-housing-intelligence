// Pure helpers for the public API, MCP server and feeds. No imports, so node:test can load
// this file directly (Node strips the types).

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://global-housing-intelligence.vercel.app").replace(/\/$/, "");

export const ATTRIBUTION = "Global Housing Intelligence (global-housing-intelligence.vercel.app)";
export const SOURCE_CREDITS = [
  "BIS residential property prices, credit and policy rates",
  "OECD Analytical House Prices",
  "IMF World Economic Outlook",
  "World Bank WDI",
  "CMHC and Statistics Canada (Open Government Licence, Canada)",
  "Bank of Canada",
  "US Census Bureau, BLS and Freddie Mac via FRED",
  "Zillow Research (ZHVI, ZORI)",
  "HM Land Registry (Open Government Licence; contains HM Land Registry data © Crown copyright)",
  "Australian Bureau of Statistics (CC BY 4.0)",
  "Dubai Real Estate Data (dubairealestatedata.com), based on Dubai Land Department open data (CC BY 4.0)",
];
export const DISCLAIMER = "Statistical estimates with published error rates, not financial advice.";

export const PERSONAS = ["investor", "buyer", "renter", "seller"] as const;

// ISO3 country code, case-insensitive; null when invalid.
export function parseIso3(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : null;
}

export function clampDelta(value: number, limit = 5): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-limit, Math.min(limit, value));
}

// Index (origin = 100) to a rounded % change.
export function pctChange(index: number | null | undefined, digits = 1): number | null {
  if (index == null || !Number.isFinite(index)) return null;
  return Number((index - 100).toFixed(digits));
}

// ── Rate limiting (fixed windows) ──
export function windowStart(nowMs: number, windowSec: number): number {
  const w = windowSec * 1000;
  return Math.floor(nowMs / w) * w;
}

export function retryAfterSeconds(nowMs: number, windowSec: number): number {
  return Math.max(1, Math.ceil((windowStart(nowMs, windowSec) + windowSec * 1000 - nowMs) / 1000));
}

export function clientIp(headers: { get(name: string): string | null }): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

// ── RSS ──
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// YYYY-MM-DD or ISO timestamp → RFC 822 date for RSS.
export function rfc822(date: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T06:30:00Z`) : new Date(date);
  return Number.isNaN(d.getTime()) ? new Date(0).toUTCString() : d.toUTCString();
}

export type FeedItem = { title: string; link: string; guid: string; date: string; description?: string; category?: string };

export function rss({ title, link, description, selfUrl, items }: { title: string; link: string; description: string; selfUrl: string; items: FeedItem[] }): string {
  const sorted = [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const body = sorted.map((i) => [
    "    <item>",
    `      <title>${escapeXml(i.title)}</title>`,
    `      <link>${escapeXml(i.link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(i.guid)}</guid>`,
    `      <pubDate>${rfc822(i.date)}</pubDate>`,
    i.category ? `      <category>${escapeXml(i.category)}</category>` : "",
    i.description ? `      <description>${escapeXml(i.description)}</description>` : "",
    "    </item>",
  ].filter(Boolean).join("\n")).join("\n");
  const lastBuild = sorted[0] ? rfc822(sorted[0].date) : new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />
${body}
  </channel>
</rss>
`;
}
