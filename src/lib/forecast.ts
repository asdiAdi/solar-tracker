import { CONFIG } from "../config";

export type ForecastPeriod = "day" | "month" | "year";

export interface Forecast {
  yieldKwh: number;
  billPhp: number;
  sunHours: number;
}

export interface ForecastInputs {
  period: ForecastPeriod;
  periodSolarKwh: number;
  todaySolarKwh: number;
  todayConsumedKwh: number;
  refDailySolarKwh: number;
  bypassDailyAvgKwh?: number;
  monthConsumedKwh?: number;
  yearConsumedKwh?: number;
  elecRatePhpPerKwh?: number | null;
}

interface Sky {
  time: string[];
  shortwave_radiation_sum?: number[];
  sunshine_duration?: number[];
}

interface SkySeries {
  sunHours: number[];
  radiation: number[];
  todayIndex: number;
}

const PAST_DAYS = 7;
const FALLBACK_SUNSHINE_SECONDS = 18000;
const FALLBACK_RADIATION = 15;
const MIN_RADIATION_FOR_EFFICIENCY = 0.5;
const SYSTEM_DERATE = 0.8;
const FALLBACK_SUN_HOURS = 5;

async function fetchSky(): Promise<Sky> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.LAT}&longitude=${CONFIG.LON}` +
    `&daily=shortwave_radiation_sum,sunshine_duration&timezone=${encodeURIComponent(CONFIG.TIMEZONE)}&forecast_days=16&past_days=${PAST_DAYS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`meteo ${res.status}`);
  const sky = ((await res.json()).daily ?? {}) as Sky;
  if (!sky.time?.length) throw new Error("empty sky");
  return sky;
}

function average(nums: number[]): number {
  const finite = nums.filter((n) => Number.isFinite(n));
  return finite.length
    ? finite.reduce((a, b) => a + b, 0) / finite.length
    : NaN;
}

function todayDateString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function dayOfYear(date: Date): number {
  return (
    Math.floor(
      (date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) /
        86400000,
    ) + 1
  );
}

function daysInYear(date: Date): number {
  return (
    Math.round(
      (new Date(date.getFullYear() + 1, 0, 1).getTime() -
        new Date(date.getFullYear(), 0, 1).getTime()) /
        86400000,
    ) || 365
  );
}

function fractionOfDayElapsed(date: Date): number {
  const hours =
    date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  return Math.min(1, Math.max(1 / 24, hours / 24));
}

function buildSkySeries(sky: Sky): SkySeries {
  const sunHours = sky.time.map(
    (_, i) => (sky.sunshine_duration?.[i] ?? FALLBACK_SUNSHINE_SECONDS) / 3600,
  );
  const radiation = sky.time.map(
    (_, i) => sky.shortwave_radiation_sum?.[i] ?? FALLBACK_RADIATION,
  );
  const foundIndex = sky.time.findIndex((t) => t === todayDateString());
  const todayIndex = foundIndex >= 0 ? foundIndex : PAST_DAYS;
  return { sunHours, radiation, todayIndex };
}

function estimateSystemEfficiency(
  radiation: number[],
  todayIndex: number,
  refDailySolarKwh: number,
  todaySolarKwh: number,
): number {
  const pastRadiationAvg = average(radiation.slice(0, todayIndex));
  const referenceSolar = Number.isFinite(refDailySolarKwh)
    ? refDailySolarKwh
    : todaySolarKwh;
  const denominator = Number.isFinite(pastRadiationAvg)
    ? pastRadiationAvg
    : (radiation[todayIndex] ?? FALLBACK_RADIATION);
  return referenceSolar / Math.max(MIN_RADIATION_FOR_EFFICIENCY, denominator);
}

function periodDailyAverage(
  periodConsumedKwh: number,
  elapsedDays: number,
  fallback: number,
): number {
  return Number.isFinite(periodConsumedKwh) && elapsedDays > 1
    ? Math.max(0, periodConsumedKwh / elapsedDays)
    : fallback;
}

function estimateForecast(
  sky: Sky,
  {
    period,
    periodSolarKwh,
    todaySolarKwh,
    todayConsumedKwh,
    refDailySolarKwh,
    bypassDailyAvgKwh,
    monthConsumedKwh,
    yearConsumedKwh,
    elecRatePhpPerKwh,
  }: Required<Omit<ForecastInputs, "elecRatePhpPerKwh">> & {
    elecRatePhpPerKwh: number | null;
  },
): Forecast {
  const now = new Date();
  const { sunHours, radiation, todayIndex } = buildSkySeries(sky);
  const systemEfficiency = estimateSystemEfficiency(
    radiation,
    todayIndex,
    refDailySolarKwh,
    todaySolarKwh,
  );

  const potentialYield = (i: number) =>
    Math.min(
      radiation[i] * systemEfficiency,
      CONFIG.SYSTEM_KWP * sunHours[i] * SYSTEM_DERATE,
    );

  const dayProgress = fractionOfDayElapsed(now);
  const remainderToday = Math.max(
    0,
    potentialYield(todayIndex) * (1 - dayProgress),
  );

  const futurePotential = sky.time
    .slice(todayIndex + 1)
    .map((_, k) => potentialYield(todayIndex + 1 + k));
  const avgFuturePotential = Number.isFinite(average(futurePotential))
    ? average(futurePotential)
    : potentialYield(todayIndex);
  const futureSunHours = sunHours.slice(todayIndex + 1);

  const dayOfYearNow = dayOfYear(now);
  const fullDayConsumption = todayConsumedKwh / dayProgress;
  const bypassDaily = Number.isFinite(bypassDailyAvgKwh)
    ? Math.max(0, bypassDailyAvgKwh)
    : 0;

  const monthDailyAvg = periodDailyAverage(
    monthConsumedKwh,
    now.getDate(),
    fullDayConsumption,
  );
  const yearDailyAvg = periodDailyAverage(
    yearConsumedKwh,
    dayOfYearNow,
    fullDayConsumption,
  );

  let yieldKwh = todaySolarKwh + remainderToday;
  let consumptionKwh = monthDailyAvg + bypassDaily;
  let sunHoursResult = sunHours[todayIndex] ?? FALLBACK_SUN_HOURS;

  if (period === "month") {
    const monthLength = daysInMonth(now);
    const remainingDays = Math.max(0, monthLength - now.getDate());
    yieldKwh =
      periodSolarKwh + remainderToday + avgFuturePotential * remainingDays;
    consumptionKwh = monthDailyAvg * monthLength + bypassDaily * monthLength;
    const upcomingSun = futureSunHours.slice(0, Math.max(1, remainingDays));
    sunHoursResult = Number.isFinite(average(upcomingSun))
      ? average(upcomingSun)
      : (sunHours[todayIndex] ?? FALLBACK_SUN_HOURS);
  }

  if (period === "year") {
    const yearLength = daysInYear(now);
    const remainingDays = Math.max(0, yearLength - dayOfYearNow);
    yieldKwh =
      periodSolarKwh + remainderToday + avgFuturePotential * remainingDays;
    consumptionKwh = yearDailyAvg * yearLength + bypassDaily * yearLength;
    sunHoursResult = Number.isFinite(average(sunHours))
      ? average(sunHours)
      : FALLBACK_SUN_HOURS;
  }

  const billPhp =
    typeof elecRatePhpPerKwh === "number" && Number.isFinite(elecRatePhpPerKwh)
      ? (consumptionKwh - yieldKwh) * elecRatePhpPerKwh
      : NaN;

  return { yieldKwh, billPhp, sunHours: sunHoursResult };
}

export async function fetchForecast(
  inputs: ForecastInputs,
): Promise<Forecast | null> {
  try {
    const sky = await fetchSky();
    return estimateForecast(sky, {
      period: inputs.period,
      periodSolarKwh: inputs.periodSolarKwh,
      todaySolarKwh: inputs.todaySolarKwh,
      todayConsumedKwh: inputs.todayConsumedKwh,
      refDailySolarKwh: inputs.refDailySolarKwh,
      bypassDailyAvgKwh: inputs.bypassDailyAvgKwh ?? 0,
      monthConsumedKwh: inputs.monthConsumedKwh ?? NaN,
      yearConsumedKwh: inputs.yearConsumedKwh ?? NaN,
      elecRatePhpPerKwh: inputs.elecRatePhpPerKwh ?? null,
    });
  } catch {
    return null;
  }
}
