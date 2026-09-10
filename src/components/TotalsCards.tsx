import type { EnergyTotals } from "../lib/types";
import { isNA, kwhParts } from "../lib/format";

export default function TotalsCards({
  energy,
  label,
}: {
  energy: EnergyTotals;
  label: string;
}) {
  const items = [
    { t: "Generated", v: energy.generated_kwh, tone: "var(--good)" },
    { t: "Consumed", v: energy.consumed_kwh, tone: "var(--accent)" },
    { t: "Imported", v: energy.grid_import_kwh, tone: "var(--warn)" },
    { t: "Bypassed", v: energy.bypass_kwh, tone: "var(--bad)" },
  ];
  return (
    <section aria-label={`${label} energy totals`} className="card p-5">
      <div className="eyebrow mb-3">Energy Data</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((i) => {
          const p = kwhParts(i.v);
          const missing = isNA(i.v);
          return (
            <div
              key={i.t}
              className="rounded-xl p-4 text-center"
              style={{ background: "var(--chip)" }}
            >
              <div className="text-sm font-semibold muted">{i.t}</div>
              <div className="med-number mt-1" style={{ color: missing ? "var(--bad)" : i.tone }}>
                {p.value}
                {p.unit && <span className="unit">{p.unit}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
