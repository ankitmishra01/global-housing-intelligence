import type { Metadata } from "next";
import { AskForm } from "@/components/ask-form";
import { countries } from "@/lib/data";

export const revalidate = 86400;
export const metadata: Metadata = { title: "Ask AI" };

export default async function AskPage() {
  const list = (await countries()).filter((c) => c.tier === 1).map((c) => ({ iso3: c.iso3, name: c.name }));
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Ask AI</p>
          <h1>Ask the housing analyst</h1>
          <p className="lede">The analyst explains the stored projections, indexes and backtests in plain English. It is given only facts from the database and every number in its answer is checked against them. It never makes a forecast of its own.</p>
        </div>
      </header>
      <section className="section"><AskForm countries={list} /></section>
    </div>
  );
}
