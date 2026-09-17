import { isNA, php } from "../lib/format";
import LoadingSpinner from "./LoadingSpinner";

export default function CostCards({
  cost,
  energy,
  label,
  netLabel,
  loading = false,
}: {
  cost: CostTotals;
  energy: EnergyTotals;
  label: string;
  netLabel: string;
  loading?: boolean;
}) {
  const rate = cost.rate_php_per_kwh;
  const formula = (v: number) => {
    if (loading) return null;
    if (isNA(v)) return "N/A";
    if (typeof rate !== "number" || !Number.isFinite(rate))
      return `${v.toFixed(1)} kWh`;
    return `${v.toFixed(1)} kWh × ₱${rate.toFixed(2)}/kWh`;
  };
  const bypassFormula = () => {
    if (loading) return null;
    if (isNA(energy.bypass_kwh) || isNA(energy.grid_import_kwh)) return "N/A";
    if (typeof rate !== "number" || !Number.isFinite(rate))
      return `${energy.bypass_kwh.toFixed(1)} kWh`;
    return `${energy.bypass_kwh.toFixed(1)} × ₱${rate.toFixed(2)}/kWh`;
  };
  const solarMissing = !loading && isNA(cost.solar_php);
  const netMissing = !loading && isNA(cost.net_php);

  return (
    <section
      aria-label={`${label} cost breakdown`}
      className="card p-4 sm:p-5 w-full"
      aria-busy={loading || undefined}
    >
      <div className="eyebrow mb-3 sm:mb-4">Total Cost</div>
      <div className="flex flex-col gap-2.5 sm:gap-3 w-full">
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-sm sm:text-base font-semibold">
              Hybrid Power Used
            </div>
            <div className="formula">
              {loading ? (
                <LoadingSpinner label="Cost loading" />
              ) : (
                formula(energy.consumed_kwh)
              )}
            </div>
          </div>
          <div
            className="text-base sm:text-xl font-bold text-right whitespace-nowrap"
            style={{
              fontVariantNumeric: "tabular-nums",
              color: loading ? "var(--muted)" : "var(--accent)",
            }}
          >
            {loading ? <LoadingSpinner /> : php(cost.consumed_php)}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-sm sm:text-base font-semibold">
              Bypassed Power Used
            </div>
            <div className="formula">
              {loading ? (
                <LoadingSpinner label="Cost loading" />
              ) : (
                bypassFormula()
              )}
            </div>
          </div>
          <div
            className="text-base sm:text-xl font-bold text-right whitespace-nowrap"
            style={{
              fontVariantNumeric: "tabular-nums",
              color: loading ? "var(--muted)" : "var(--bad)",
            }}
          >
            {loading ? <LoadingSpinner /> : php(cost.bypass_php)}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-sm sm:text-base font-semibold">
              Solar Power Savings
            </div>
            <div className="formula">
              {loading ? (
                <LoadingSpinner label="Cost loading" />
              ) : (
                formula(energy.generated_kwh)
              )}
            </div>
          </div>
          <div
            className="text-base sm:text-xl font-bold text-right whitespace-nowrap"
            style={{
              color: loading
                ? "var(--muted)"
                : solarMissing
                  ? "var(--bad)"
                  : "var(--good)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {loading ? (
              <LoadingSpinner />
            ) : solarMissing ? (
              php(cost.solar_php)
            ) : (
              `−${php(cost.solar_php).replace(/^−/, "")}`
            )}
          </div>
        </div>
        <div
          className="border-t pt-2.5 sm:pt-3 mt-1"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="text-base sm:text-lg font-bold">{netLabel}</div>
            <div
              className="text-xl sm:text-3xl font-extrabold text-right whitespace-nowrap"
              style={{
                fontVariantNumeric: "tabular-nums",
                color: loading
                  ? "var(--muted)"
                  : netMissing
                    ? "var(--bad)"
                    : undefined,
              }}
            >
              {loading ? <LoadingSpinner /> : php(cost.net_php)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
