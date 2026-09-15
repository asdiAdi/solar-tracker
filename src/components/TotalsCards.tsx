import { isNA, kwhParts } from "../lib/format";
import LoadingSpinner from "./LoadingSpinner";

export default function TotalsCards({
  energy,
  label,
  loading = false,
}: {
  energy: EnergyTotals;
  label: string;
  loading?: boolean;
}) {
  const items = [
    { t: "Generated", v: energy.generated_kwh, tone: "var(--good)" },
    { t: "Consumed", v: energy.consumed_kwh, tone: "var(--accent)" },
    { t: "Imported", v: energy.grid_import_kwh, tone: "var(--warn)" },
    { t: "Bypassed", v: energy.bypass_kwh, tone: "var(--bad)" },
  ];
  return (
    <section
      aria-label={`${label} energy totals`}
      className="card p-4 sm:p-5"
      aria-busy={loading || undefined}
    >
      <div className="eyebrow mb-3">Energy Data</div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {items.map((i) => {
          const p = kwhParts(i.v);
          const missing = !loading && isNA(i.v);
          return (
            <div
              key={i.t}
              className="rounded-xl p-2.5 sm:p-4 text-center min-w-0"
              style={{ background: "var(--chip)" }}
            >
              <div className="text-[0.65rem] sm:text-sm font-semibold muted truncate leading-tight">{i.t}</div>
              <div
                className="med-number med-number--compact mt-1"
                style={{
                  color: loading
                    ? "var(--muted)"
                    : missing
                      ? "var(--bad)"
                      : i.tone,
                }}
              >
                {loading ? (
                  <LoadingSpinner />
                ) : (
                  <>
                    {p.value}
                    {p.unit && <span className="unit">{p.unit}</span>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
