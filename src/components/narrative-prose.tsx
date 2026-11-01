import { runs } from "../../lib/engine/narrative.js";

// Paragraphs from the narrative generator; **marked** figures render in bold.
export function NarrativeProse({ paragraphs, title }: { paragraphs: string[]; title?: string }) {
  return (
    <div className="brief-prose">
      {title ? <p className="brief-prose__label">{title}</p> : null}
      {paragraphs.map((p, i) => (
        <p key={i}>{runs(p).map((r: { bold: boolean; text: string }, j: number) => (r.bold ? <strong key={j}>{r.text}</strong> : <span key={j}>{r.text}</span>))}</p>
      ))}
    </div>
  );
}
