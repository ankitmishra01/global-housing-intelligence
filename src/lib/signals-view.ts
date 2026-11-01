import "server-only";
import { computeSignals } from "../../lib/engine/signals.js";
import type { Context, Flag, IndexComponent, LiveShift, PersonaRow, Projection } from "@/lib/data";

const toPct = (logPts: number) => 100 * (Math.exp(logPts / 100) - 1);
const LIVE_COMPONENTS: Record<string, [string, number]> = { proj3Price: ["real_price", 3], proj10Price: ["real_price", 10], proj10Rent: ["real_rent", 10] };

// Persona signals rebuilt at render time from the stored index components, so the reasons quote
// the live-adjusted projections shown elsewhere on the page. Momentum is a quarterly
// year-on-year percent change, except where no quarterly index exists and it is annual log growth.
export function liveSignals({ iso3, ctx, personas, flags, proj, shifts, hasQuarterly }: {
  iso3: string; ctx: Context; personas: PersonaRow[]; flags: Flag[]; proj: Projection[];
  shifts: Record<string, Record<number, LiveShift>> | undefined; hasQuarterly: boolean;
}): NonNullable<Context["details"]["signals"]> | undefined {
  const mine = personas.filter((r) => r.country === iso3);
  if (!mine.length) return ctx.details.signals;
  const adjust = (list: IndexComponent[]) => list.map((x) => {
    const [target, horizon] = LIVE_COMPONENTS[x.key] ?? [];
    const p = target ? proj.find((r) => r.target === target && r.horizon === horizon) : undefined;
    if (p && typeof x.value === "number") return { ...x, value: 100 * Math.log(p.median / 100) + (shifts?.[target]?.[horizon]?.shift ?? 0) };
    if (x.key === "momentum" && !hasQuarterly && typeof x.value === "number") return { ...x, value: toPct(x.value) };
    return x;
  });
  return (computeSignals as (a: unknown) => NonNullable<Context["details"]["signals"]>)({
    scores: Object.fromEntries(mine.map((r) => [r.persona, r.score])),
    components: Object.fromEntries(mine.map((r) => [r.persona, adjust(r.components)])),
    flags: flags.filter((f) => f.country === iso3).map((f) => f.flag), stress: ctx.details.stress ?? null,
  });
}
