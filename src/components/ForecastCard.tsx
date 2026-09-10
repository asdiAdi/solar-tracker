import { useEffect, useState } from "react";
import { CONFIG } from "../config";
import { fetchMonthForecast, type MonthForecast } from "../lib/forecast";
import { isNA, kwhParts, php, sunH } from "../lib/format";
import LoadingSpinner from "./LoadingSpinner";

export default function ForecastCard({
  monthSolarKwh,
  monthNetPhp,
  todaySolarKwh,
  todayConsumedKwh,
  inputsLoading = false,
}: {
  monthSolarKwh: number;
  monthNetPhp: number;
  todaySolarKwh: number;
  todayConsumedKwh: number;
  inputsLoading?: boolean;
}) {
  const [fc, setFc] = useState<MonthForecast | null>(null);
  const missing =
    isNA(monthSolarKwh) || isNA(monthNetPhp) || isNA(todaySolarKwh) || isNA(todayConsumedKwh);

  useEffect(() => {
    if (inputsLoading || missing) {
      setFc(null);
      return;
    }
    let live = true;
    fetchMonthForecast(monthSolarKwh, todaySolarKwh, monthNetPhp, todayConsumedKwh).then(
      (f) => {
        if (live) setFc(f);
      },
    );
    return () => {
      live = false;
    };
  }, [monthSolarKwh, monthNetPhp, todaySolarKwh, todayConsumedKwh, missing, inputsLoading]);

  const fetching = !missing && !inputsLoading && !fc;
  const showLoading = inputsLoading || fetching;
  if (showLoading) {
    return (
      <section className="card p-5" aria-label="Month forecast" aria-busy="true">
        <div className="eyebrow mb-1">
          Forecast · End of month · <span className="inline-flex items-center gap-1.5 align-middle"><LoadingSpinner label="Forecast loading" /> Loading</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: "var(--chip)" }}
          >
            <div className="text-sm font-semibold muted">Projected Yield</div>
            <div className="med-number mt-1" style={{ color: "var(--muted)" }}>
              <LoadingSpinner />
            </div>
          </div>
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: "var(--chip)" }}
          >
            <div className="text-sm font-semibold muted">Projected Bill</div>
            <div className="med-number mt-1" style={{ color: "var(--muted)" }}><LoadingSpinner /></div>
          </div>
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: "var(--chip)" }}
          >
            <div className="text-sm font-semibold muted">Sun average</div>
            <div className="med-number mt-1" style={{ color: "var(--muted)" }}>
              <LoadingSpinner />
            </div>
          </div>
        </div>
        <div className="formula mt-3">
          Open-Meteo {CONFIG.LAT.toFixed(2)},{CONFIG.LON.toFixed(2)} ·{" "}
          {CONFIG.SYSTEM_KWP} kW system
        </div>
      </section>
    );
  }

  if (missing || !fc) {
    const p = missing || !fc ? { value: "N/A", unit: "" } : kwhParts(fc.monthEndKwh);
    const bill = missing || !fc ? "N/A" : php(fc.monthEndNetPhp);
    const sun = missing || !fc ? "N/A" : sunH(fc.avgSunHours);
    const billMissing = missing || !fc || isNA(fc.monthEndNetPhp);
    const yieldMissing = missing || !fc || isNA(fc.monthEndKwh);
    const sunMissing = missing || !fc || isNA(fc.avgSunHours);
    return (
      <section className="card p-5" aria-label="Month forecast">
        <div className="eyebrow mb-1">
          Forecast · End of month{" "}
          {fc && !missing ? (fc.usedFallback ? "· offline" : "· live weather") : "· N/A"}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: "var(--chip)" }}
          >
            <div className="text-sm font-semibold muted">Projected Yield</div>
            <div className="med-number mt-1" style={yieldMissing ? { color: "var(--bad)" } : undefined}>
              {p.value}
              {p.unit && <span className="unit">{p.unit}</span>}
            </div>
          </div>
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: "var(--chip)" }}
          >
            <div className="text-sm font-semibold muted">Projected Bill</div>
            <div className="med-number mt-1" style={billMissing ? { color: "var(--bad)" } : undefined}>{bill}</div>
          </div>
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: "var(--chip)" }}
          >
            <div className="text-sm font-semibold muted">Sun average</div>
            <div className="med-number mt-1" style={sunMissing ? { color: "var(--bad)" } : undefined}>
              {sun}
              {!sunMissing && <span className="unit">h/day</span>}
            </div>
          </div>
        </div>
        <div className="formula mt-3">
          Open-Meteo {CONFIG.LAT.toFixed(2)},{CONFIG.LON.toFixed(2)} ·{" "}
          {CONFIG.SYSTEM_KWP} kW system
        </div>
      </section>
    );
  }

  const p = kwhParts(fc.monthEndKwh);
  return (
    <section className="card p-5" aria-label="Month forecast">
      <div className="eyebrow mb-1">
        Forecast · End of month{" "}
        {fc.usedFallback ? "· offline" : "· live weather"}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <div
          className="rounded-xl p-4 text-center"
          style={{ background: "var(--chip)" }}
        >
          <div className="text-sm font-semibold muted">Projected Yield</div>
          <div className="med-number mt-1" style={isNA(fc.monthEndKwh) ? { color: "var(--bad)" } : undefined}>
            {p.value}
            {p.unit && <span className="unit">{p.unit}</span>}
          </div>
        </div>
        <div
          className="rounded-xl p-4 text-center"
          style={{ background: "var(--chip)" }}
        >
          <div className="text-sm font-semibold muted">Projected Bill</div>
          <div className="med-number mt-1" style={isNA(fc.monthEndNetPhp) ? { color: "var(--bad)" } : undefined}>{php(fc.monthEndNetPhp)}</div>
        </div>
        <div
          className="rounded-xl p-4 text-center"
          style={{ background: "var(--chip)" }}
        >
          <div className="text-sm font-semibold muted">Sun average</div>
          <div className="med-number mt-1" style={isNA(fc.avgSunHours) ? { color: "var(--bad)" } : undefined}>
            {sunH(fc.avgSunHours)}
            {!isNA(fc.avgSunHours) && <span className="unit">h/day</span>}
          </div>
        </div>
      </div>
      <div className="formula mt-3">
        Open-Meteo {CONFIG.LAT.toFixed(2)},{CONFIG.LON.toFixed(2)} ·{" "}
        {CONFIG.SYSTEM_KWP} kW system
      </div>
    </section>
  );
}
