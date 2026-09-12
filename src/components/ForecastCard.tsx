import { useEffect, useState } from "react";
import {
  fetchDayForecast,
  fetchMonthForecast,
  fetchYearForecast,
} from "../lib/forecast";
import { isNA, kwhParts, php, sunH } from "../lib/format";
import type { Period, PeriodResponse } from "../lib/types";
import LoadingSpinner from "./LoadingSpinner";

function Tiles({
  yieldKwh,
  billPhp,
  sunHours,
}: {
  yieldKwh: number;
  billPhp: number;
  sunHours: number;
}) {
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

export default function ForecastCard({
  period,
  day,
  month,
  year,
  fetching = false,
}: {
  period: Period;
  day: PeriodResponse | null;
  month: PeriodResponse | null;
  year: PeriodResponse | null;
  fetching?: boolean;
}) {
  const [result, setResult] = useState<{
    yieldKwh: number;
    billPhp: number;
    sunHours: number;
  } | null>(null);

  const [failed, setFailed] = useState(false);
  const [fetchingMeteo, setFetchingMeteo] = useState(false);

  const todaySolarKwh = day?.energy.generated_kwh ?? NaN;
  const todayConsumedKwh = day?.energy.consumed_kwh ?? NaN;
  const monthSolarKwh = month?.energy.generated_kwh ?? NaN;
  const monthConsumedKwh = month?.energy.consumed_kwh ?? NaN;
  const yearSolarKwh = year?.energy.generated_kwh ?? NaN;
  const yearConsumedKwh = year?.energy.consumed_kwh ?? NaN;
  const monthBypassKwh = month?.energy.bypass_kwh ?? NaN;

  const now = new Date();
  const elapsed = now.getDate();

  const bypassDailyAvg =
    Number.isFinite(monthBypassKwh) && elapsed > 0
      ? Math.max(0, monthBypassKwh / elapsed)
      : 0;
  const dayOfYear =
    Math.floor(
      (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000,
    ) + 1;

  const monthRef =
    elapsed > 1 &&
    Number.isFinite(monthSolarKwh) &&
    Number.isFinite(todaySolarKwh)
      ? (monthSolarKwh - todaySolarKwh) / (elapsed - 1)
      : todaySolarKwh;
  const yearRef =
    dayOfYear > 1 &&
    Number.isFinite(yearSolarKwh) &&
    Number.isFinite(todaySolarKwh)
      ? (yearSolarKwh - todaySolarKwh) / (dayOfYear - 1)
      : todaySolarKwh;
  const refDailySolar =
    period === "year"
      ? Number.isFinite(yearRef) && yearRef >= 0
        ? yearRef
        : todaySolarKwh
      : Number.isFinite(monthRef) && monthRef >= 0
        ? monthRef
        : todaySolarKwh;

  const missing =
    period === "day"
      ? isNA(todaySolarKwh) || isNA(todayConsumedKwh)
      : period === "month"
        ? isNA(monthSolarKwh) || isNA(todaySolarKwh) || isNA(todayConsumedKwh)
        : isNA(yearSolarKwh) || isNA(todaySolarKwh) || isNA(todayConsumedKwh);

  const inputsLoading =
    fetching ||
    day == null ||
    (period === "day" && month == null) ||
    (period === "month" && month == null) ||
    (period === "year" && year == null);

  useEffect(() => {
    if (inputsLoading || missing) {
      setResult(null);
      setFailed(false);
      setFetchingMeteo(false);
      return;
    }
    let live = true;
    setFailed(false);
    // Clear stale period result immediately so tab switches show loading, not old data.
    setResult(null);
    setFetchingMeteo(true);
    const run = async () => {
      try {
        if (period === "day") {
          const f = await fetchDayForecast(
            todaySolarKwh,
            todayConsumedKwh,
            refDailySolar,
            bypassDailyAvg,
            monthConsumedKwh,
            yearConsumedKwh,
          );
          if (live) setResult(f);
        } else if (period === "month") {
          const f = await fetchMonthForecast(
            monthSolarKwh,
            todaySolarKwh,
            todayConsumedKwh,
            refDailySolar,
            bypassDailyAvg,
            monthConsumedKwh,
            yearConsumedKwh,
          );
          if (live) setResult(f);
        } else {
          const f = await fetchYearForecast(
            yearSolarKwh,
            todaySolarKwh,
            todayConsumedKwh,
            refDailySolar,
            bypassDailyAvg,
            monthConsumedKwh,
            yearConsumedKwh,
          );
          if (live) setResult(f);
        }
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setFetchingMeteo(false);
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [
    period,
    monthSolarKwh,
    monthConsumedKwh,
    todaySolarKwh,
    todayConsumedKwh,
    yearSolarKwh,
    yearConsumedKwh,
    refDailySolar,
    bypassDailyAvg,
    missing,
    inputsLoading,
  ]);

  const showLoading =
    inputsLoading || fetchingMeteo || (!missing && !result && !failed);
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

  if (missing || failed || !result) {
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
