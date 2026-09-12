import { isNA, php } from "../lib/format";
import type { CostTotals, EnergyTotals } from "../lib/types";
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
  const solarMissing = !loading && isNA(cost.solar_php);
  const netMissing = !loading && isNA(cost.net_php);

  return (
    <section
      aria-label={`${label} cost breakdown`}
      className="card p-5 w-full"
      aria-busy={loading || undefined}
    >
      <div className="eyebrow mb-4">Total Cost</div>
      <div className="flex flex-col gap-3 w-full">
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-base font-semibold">Hybrid Power Used</div>
            <div className="formula">
              {loading ? (
                <LoadingSpinner label="Cost loading" />
              ) : (
                formula(energy.consumed_kwh)
              )}
            </div>
          </div>
          <div
            className="text-xl font-bold"
            style={{
              fontVariantNumeric: "tabular-nums",
              color: loading ? "var(--muted)" : "var(--warn)",
            }}
          >
            {loading ? <LoadingSpinner /> : php(cost.consumed_php)}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-base font-semibold">Bypassed Power Used</div>
            <div className="formula">
              {loading ? (
                <LoadingSpinner label="Cost loading" />
              ) : (
                formula(energy.bypass_kwh)
              )}
            </div>
          </div>
          <div
            className="text-xl font-bold"
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
            <div className="text-base font-semibold">Solar Power Savings</div>
            <div className="formula">
              {loading ? (
                <LoadingSpinner label="Cost loading" />
              ) : (
                formula(energy.generated_kwh)
              )}
            </div>
          </div>
          <div
            className="text-xl font-bold"
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
          className="border-t pt-3 mt-1"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="text-lg font-bold">{netLabel}</div>
            <div
              className="text-3xl font-extrabold"
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
