import { CONFIG } from "../config";
import { php } from "../lib/format";
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
  const net = cost.grid_import_php - cost.saved_php;
  const rate = CONFIG.GRID_PHP_PER_KWH;
  // self-consumed kWh implied by savings (keeps numbers consistent with Php)
  const solarKwh = cost.saved_php / rate;

  return (
    <section aria-label={`${label} cost breakdown`} className="card p-5 w-full">
      <div className="eyebrow mb-4">Total Cost</div>
      <div className="flex flex-col gap-3 w-full">
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-base font-semibold">Hybrid Power Used</div>
            <div className="formula">
              {energy.grid_import_kwh.toFixed(1)} kWh × ₱{rate.toFixed(1)}/kWh
            </div>
          </div>
          <div
            className="text-xl font-bold"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {php(cost.grid_import_php)}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-base font-semibold">Bypassed Power Used</div>
            <div className="formula">
              {solarKwh.toFixed(1)} kWh × ₱{rate.toFixed(1)}/kWh
            </div>
          </div>
          <div
            className="text-xl font-bold"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {php(cost.grid_import_php)}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 w-full">
          <div>
            <div className="text-base font-semibold">Solar Power Savings</div>
            <div className="formula">
              {solarKwh.toFixed(1)} kWh × ₱{rate.toFixed(1)}/kWh
            </div>
          </div>
          <div
            className="text-xl font-bold"
            style={{ color: "var(--good)", fontVariantNumeric: "tabular-nums" }}
          >
            −{php(cost.saved_php)}
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
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {php(net)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
