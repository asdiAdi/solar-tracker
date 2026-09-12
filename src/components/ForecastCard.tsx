import { useEffect, useMemo, useState } from "react";
import {
  fetchForecast,
  type Forecast,
  type ForecastPeriod,
} from "../lib/forecast";
import { isNA, kwhParts, php, sunH } from "../lib/format";
import LoadingSpinner from "./LoadingSpinner";

function Tiles({ yieldKwh, billPhp, sunHours }: Forecast) {
  const y = kwhParts(yieldKwh);
  const yieldMissing = isNA(yieldKwh);
  const billMissing = isNA(billPhp);
  const sunMissing = isNA(sunHours);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      <div
        className="rounded-xl p-4 text-center"
        style={{ background: "var(--chip)" }}
      >
        <div className="text-sm font-semibold muted">Projected Yield</div>
        <div
          className="med-number mt-1"
          style={yieldMissing ? { color: "var(--bad)" } : undefined}
        >
          {y.value}
          {y.unit && <span className="unit">{y.unit}</span>}
        </div>
      </div>
      <div
        className="rounded-xl p-4 text-center"
        style={{ background: "var(--chip)" }}
      >
        <div className="text-sm font-semibold muted">Projected Bill</div>
        <div
          className="med-number mt-1"
          style={billMissing ? { color: "var(--bad)" } : undefined}
        >
          {php(billPhp)}
        </div>
      </div>
      <div
        className="rounded-xl p-4 text-center"
        style={{ background: "var(--chip)" }}
      >
        <div className="text-sm font-semibold muted">Sun average</div>
        <div
          className="med-number mt-1"
          style={sunMissing ? { color: "var(--bad)" } : undefined}
        >
          {sunH(sunHours)}
          {!sunMissing && <span className="unit">h/day</span>}
        </div>
      </div>
    </div>
  );
}

function LoadingTiles() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      {["Projected Yield", "Projected Bill", "Sun average"].map((t) => (
        <div
          key={t}
          className="rounded-xl p-4 text-center"
          style={{ background: "var(--chip)" }}
        >
          <div className="text-sm font-semibold muted">{t}</div>
          <div className="med-number mt-1" style={{ color: "var(--muted)" }}>
            <LoadingSpinner />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ForecastCardProps {
  period: Period;
  day: PeriodResponse | null;
  month: PeriodResponse | null;
  year: PeriodResponse | null;
  fetching?: boolean;
  elecRate?: number | null;
}

function dayOfYear(date: Date): number {
  return (
    Math.floor(
      (date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) /
        86400000,
    ) + 1
  );
}

function useForecastInputs(
  period: ForecastPeriod,
  day: PeriodResponse | null,
  month: PeriodResponse | null,
  year: PeriodResponse | null,
) {
  return useMemo(() => {
    const todaySolarKwh = day?.energy.generated_kwh ?? NaN;
    const todayConsumedKwh = day?.energy.consumed_kwh ?? NaN;
    const monthSolarKwh = month?.energy.generated_kwh ?? NaN;
    const monthConsumedKwh = month?.energy.consumed_kwh ?? NaN;
    const yearSolarKwh = year?.energy.generated_kwh ?? NaN;
    const yearConsumedKwh = year?.energy.consumed_kwh ?? NaN;
    const monthBypassKwh = month?.energy.bypass_kwh ?? NaN;

    const now = new Date();
    const elapsedDaysInMonth = now.getDate();
    const dayOfYearNow = dayOfYear(now);

    const bypassDailyAvgKwh =
      Number.isFinite(monthBypassKwh) && elapsedDaysInMonth > 0
        ? Math.max(0, monthBypassKwh / elapsedDaysInMonth)
        : 0;

    const monthRef =
      elapsedDaysInMonth > 1 &&
      Number.isFinite(monthSolarKwh) &&
      Number.isFinite(todaySolarKwh)
        ? (monthSolarKwh - todaySolarKwh) / (elapsedDaysInMonth - 1)
        : todaySolarKwh;
    const yearRef =
      dayOfYearNow > 1 &&
      Number.isFinite(yearSolarKwh) &&
      Number.isFinite(todaySolarKwh)
        ? (yearSolarKwh - todaySolarKwh) / (dayOfYearNow - 1)
        : todaySolarKwh;

    const refDailySolarKwh =
      period === "year"
        ? Number.isFinite(yearRef) && yearRef >= 0
          ? yearRef
          : todaySolarKwh
        : Number.isFinite(monthRef) && monthRef >= 0
          ? monthRef
          : todaySolarKwh;

    const periodSolarKwh =
      period === "day"
        ? todaySolarKwh
        : period === "month"
          ? monthSolarKwh
          : yearSolarKwh;

    const missing =
      period === "day"
        ? isNA(todaySolarKwh) || isNA(todayConsumedKwh)
        : period === "month"
          ? isNA(monthSolarKwh) || isNA(todaySolarKwh) || isNA(todayConsumedKwh)
          : isNA(yearSolarKwh) || isNA(todaySolarKwh) || isNA(todayConsumedKwh);

    return {
      periodSolarKwh,
      todaySolarKwh,
      todayConsumedKwh,
      refDailySolarKwh,
      bypassDailyAvgKwh,
      monthConsumedKwh,
      yearConsumedKwh,
      missing,
    };
  }, [period, day, month, year]);
}

export default function ForecastCard({
  period,
  day,
  month,
  year,
  fetching = false,
  elecRate = null,
}: ForecastCardProps) {
  const [result, setResult] = useState<Forecast | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetchingMeteo, setFetchingMeteo] = useState(false);

  const inputs = useForecastInputs(period, day, month, year);

  const inputsLoading =
    fetching ||
    day == null ||
    (period === "year" && year == null);

  useEffect(() => {
    if (inputsLoading || inputs.missing) {
      setResult(null);
      setFailed(false);
      setFetchingMeteo(false);
      return;
    }
    let live = true;
    setFailed(false);
    setResult(null);
    setFetchingMeteo(true);

    fetchForecast({
      period,
      periodSolarKwh: inputs.periodSolarKwh,
      todaySolarKwh: inputs.todaySolarKwh,
      todayConsumedKwh: inputs.todayConsumedKwh,
      refDailySolarKwh: inputs.refDailySolarKwh,
      bypassDailyAvgKwh: inputs.bypassDailyAvgKwh,
      monthConsumedKwh: inputs.monthConsumedKwh,
      yearConsumedKwh: inputs.yearConsumedKwh,
      elecRatePhpPerKwh: elecRate,
    })
      .then((f) => {
        if (live) setResult(f);
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setFetchingMeteo(false);
      });

    return () => {
      live = false;
    };
  }, [period, inputs, inputsLoading, elecRate]);

  const showLoading = inputsLoading || fetchingMeteo;

  if (showLoading) {
    return (
      <section className="card p-5" aria-label="Forecast" aria-busy="true">
        <div className="eyebrow mb-1">
          Forecast ·{" "}
          <span className="inline-flex items-center gap-1.5 align-middle">
            <LoadingSpinner label="Forecast loading" /> Loading
          </span>
        </div>
        <LoadingTiles />
      </section>
    );
  }

  if (inputs.missing || failed || !result) {
    return (
      <section className="card p-5" aria-label="Forecast">
        <div className="eyebrow mb-1">Forecast</div>
        <Tiles yieldKwh={NaN} billPhp={NaN} sunHours={NaN} />
      </section>
    );
  }

  return (
    <section className="card p-5" aria-label="Forecast">
      <div className="eyebrow mb-1">Forecast</div>
      <Tiles
        yieldKwh={result.yieldKwh}
        billPhp={result.billPhp}
        sunHours={result.sunHours}
      />
    </section>
  );
}
