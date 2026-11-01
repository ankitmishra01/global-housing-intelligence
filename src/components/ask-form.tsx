"use client";
import { useState } from "react";

type Result = { answer: string; model: string; guardrail: { passed: boolean; unverified: string[] }; facts: string[] };

const EXAMPLES = [
  "Where are real house prices projected to rise most over 10 years?",
  "How would a 1 point rate hike change the outlook here?",
  "Is it cheaper to rent or buy over the next decade?",
  "How reliable is the 10-year projection?",
];

export function AskForm({ countries }: { countries: { iso3: string; name: string }[] }) {
  const [country, setCountry] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function ask(q = question) {
    if (q.trim().length < 3) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, country: country || undefined }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Something went wrong.");
      else setResult(data);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <div className="panel" style={{ display: "grid", gap: 12 }}>
        <label className="field">Country (optional)
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All countries</option>
            {countries.map((c) => <option key={c.iso3} value={c.iso3}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">Question
          <textarea value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about prices, rents, rates, dwelling types or the indexes" />
        </label>
        <div className="chips" role="group" aria-label="Example questions">
          {EXAMPLES.map((q) => <button key={q} type="button" className="chip" onClick={() => { setQuestion(q); ask(q); }}>{q}</button>)}
        </div>
        <div><button type="button" className="primary" disabled={busy || question.trim().length < 3} onClick={() => ask()}>{busy ? "Thinking…" : "Ask"}</button></div>
      </div>
      {error ? <p className="disabled-note" style={{ marginTop: 16 }}>{error}</p> : null}
      {result ? (
        <div style={{ marginTop: 16 }}>
          <div className="answer">{result.answer}</div>
          <p className="note" style={{ marginTop: 8 }}>
            {result.guardrail.passed
              ? <span className="badge badge--t1">Every number checked against the database</span>
              : <span className="badge badge--warn">Unverified numbers: {result.guardrail.unverified.join(", ")}. Check them against the country page.</span>}
            {" "}<span className="mono">{result.model}</span>
          </p>
          <details>
            <summary className="note">Facts the analyst was given ({result.facts.length})</summary>
            <ul className="note">{result.facts.map((f) => <li key={f}>{f}</li>)}</ul>
          </details>
        </div>
      ) : null}
    </div>
  );
}
