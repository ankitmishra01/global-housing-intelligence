import { runs } from "../../lib/engine/narrative.js";

export type ProseSource = { title: string; publisher?: string; url: string; date?: string };

// Paragraphs from the narrative generator; **marked** figures render in bold. Curated notes
// carry their sources, listed under the section they appear in.
export function NarrativeProse({ paragraphs, title, sources }: { paragraphs: string[]; title?: string; sources?: ProseSource[] }) {
  return (
    <div className="brief-prose">
      {title ? <p className="brief-prose__label">{title}</p> : null}
      {paragraphs.map((p, i) => (
        <p key={i}>{runs(p).map((r: { bold: boolean; text: string }, j: number) => (r.bold ? <strong key={j}>{r.text}</strong> : <span key={j}>{r.text}</span>))}</p>
      ))}
      {sources?.length ? (
        <div className="brief-sources">
          <span>Sources</span>
          <ol>
            {sources.map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>{s.publisher ? `, ${s.publisher}` : ""}{s.date ? ` (${s.date})` : ""}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
