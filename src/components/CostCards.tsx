import { CONFIG } from "../config";
import { isNA, php } from "../lib/format";
import type { CostTotals, EnergyTotals } from "../lib/types";

export default function CostCards({
  cost,
  energy,
  label,
  netLabel,
}: {
  cost: CostTotals;
  energy: EnergyTotals;
  label: string;
  netLabel: string;
}) {
  const rate = CONFIG.GRID_PHP_PER_KWH;
  const formula = (v: number) => (isNA(v) ? "N/A" : `${v.toFixed(1)} kWh × ₱${rate.toFixed(1)}/kWh`);
  const solarMissing = isNA(cost.solar_php);

  return (
    <section aria-label={`${label} cost breakdown`} className="card p-5 w-full">
      <div className="eyebrow mb-4">Total Cost</div>
      <div className="flex flex-col gap-3 w-full">
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-base font-semibold">Hybrid Power Used</div>
            <div className="formula">
              {formula(energy.consumed_kwh)}
            </div>
          </div>
          <div
            className="text-xl font-bold"
            style={{ fontVariantNumeric: "tabular-nums", color: isNA(cost.consumed_php) ? "var(--bad)" : undefined }}
          >
            {php(cost.consumed_php)}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-base font-semibold">Bypassed Power Used</div>
            <div className="formula">
              {formula(energy.bypass_kwh)}
            </div>
          </div>
          <div
            className="text-xl font-bold"
            style={{ fontVariantNumeric: "tabular-nums", color: isNA(cost.bypass_php) ? "var(--bad)" : undefined }}
          >
            {php(cost.bypass_php)}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-base font-semibold">Solar Power Savings</div>
            <div className="formula">
              {formula(energy.generated_kwh)}
            </div>
          </div>
          <div
            className="text-xl font-bold"
            style={{ color: solarMissing ? "var(--bad)" : "var(--good)", fontVariantNumeric: "tabular-nums" }}
          >
            {solarMissing ? php(cost.solar_php) : `−${php(cost.solar_php).replace(/^−/, "")}`}
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
              style={{ fontVariantNumeric: "tabular-nums", color: isNA(cost.net_php) ? "var(--bad)" : undefined }}
            >
              {php(cost.net_php)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
