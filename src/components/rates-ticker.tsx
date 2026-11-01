import { liveStates } from "@/lib/data";

const MAJORS = ["USA", "CAN", "GBR", "AUS", "DEU", "JPN", "CHE", "NZL", "KOR", "SWE", "BRA", "ARE"];
const NAMES: Record<string, string> = { USA: "Fed", CAN: "BoC", GBR: "BoE", AUS: "RBA", DEU: "ECB", JPN: "BoJ", CHE: "SNB", NZL: "RBNZ", KOR: "BoK", SWE: "Riksbank", BRA: "BCB", ARE: "CBUAE" };

// Policy rates strip, the housing counterpart of the economic app's markets strip.
export async function RatesTicker() {
  const states = await liveStates().catch(() => []);
  const rows = MAJORS.map((c) => states.find((s) => s.country === c)).filter((s) => s && s.policy_rate_now != null);
  if (!rows.length) return null;
  const asOf = rows.map((r) => r!.policy_rate_date).filter(Boolean).sort().at(-1);
  return (
    <div className="ticker" aria-label="Central bank policy rates">
      <span className="ticker__label"><i aria-hidden="true" />Rates · daily</span>
      {rows.map((s) => {
        const d = s!.rate_delta;
        return (
          <span key={s!.country} className="ticker__item">
            {NAMES[s!.country]}<b>{s!.policy_rate_now!.toFixed(2)}%</b>
            {d != null && Math.abs(d) >= 0.01 ? <span className={d > 0 ? "ticker__up" : "ticker__down"}>{d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(2)} vs origin</span> : null}
          </span>
        );
      })}
      {asOf ? <span className="badge badge--t1">as of {asOf}</span> : null}
    </div>
  );
}
