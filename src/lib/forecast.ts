import { CONFIG } from "../config";

export interface Forecast {
  yieldKwh: number;
  billPhp: number;
  sunHours: number;
}

interface Sky {
  time: string[];
  shortwave_radiation_sum?: number[];
  sunshine_duration?: number[];
}

const PAST_DAYS = 7;

async function getSky(): Promise<Sky> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.LAT}&longitude=${CONFIG.LON}` +
    `&daily=shortwave_radiation_sum,sunshine_duration&timezone=${encodeURIComponent(CONFIG.TIMEZONE)}&forecast_days=16&past_days=${PAST_DAYS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("meteo " + res.status);
  const sky = ((await res.json()).daily ?? {}) as Sky;
  if (!sky.time?.length) throw new Error("empty sky");
  return sky;
}

function avg(nums: number[]): number {
  const ok = nums.filter((n) => Number.isFinite(n));
  if (!ok.length) return NaN;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

function estimateForecast(
  sky: Sky,
  period: "day" | "month" | "year",
  soFarSolar: number,
  todaySolar: number,
  todayConsumed: number,
  refDailySolar: number,
  bypassDailyAvg = 0,
): Forecast {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  let todayIdx = sky.time.findIndex((t) => t === todayStr);
  if (todayIdx < 0) todayIdx = PAST_DAYS;

  const sunH = sky.time.map(
    (_, i) => (sky.sunshine_duration?.[i] ?? 18000) / 3600,
  );
  const rad = sky.time.map((_, i) => sky.shortwave_radiation_sum?.[i] ?? 15);

  // Efficiency from PAST days, not today's partial ratio.
  const pastRadAvg = avg(rad.slice(0, todayIdx));
  const pastSolar = Number.isFinite(refDailySolar) ? refDailySolar : todaySolar;
  const systemEff =
    pastSolar /
    Math.max(
      0.5,
      Number.isFinite(pastRadAvg) ? pastRadAvg : (rad[todayIdx] ?? 15),
    );

  const potential = (i: number) =>
    Math.min(rad[i] * systemEff, CONFIG.SYSTEM_KWP * sunH[i] * 0.8);

  // Rest-of-day shrinks to 0 at midnight, so yield > generated midday.
  const hoursElapsed =
    now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const progress = Math.min(1, Math.max(1 / 24, hoursElapsed / 24));
  const remainder = Math.max(0, potential(todayIdx) * (1 - progress));

  const futureKwh = sky.time
    .slice(todayIdx + 1)
    .map((_, k) => potential(todayIdx + 1 + k));
  const avgFuture = Number.isFinite(avg(futureKwh))
    ? avg(futureKwh)
    : potential(todayIdx);
  const futureSun = sunH.slice(todayIdx + 1);

  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfYear =
    Math.floor(
      (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000,
    ) + 1;
  const daysInYear =
    Math.round(
      (new Date(now.getFullYear() + 1, 0, 1).getTime() -
        new Date(now.getFullYear(), 0, 1).getTime()) /
        86400000,
    ) || 365;

  const fullDayConsump = todayConsumed / progress;
  const bypassDaily = Number.isFinite(bypassDailyAvg) ? Math.max(0, bypassDailyAvg) : 0;

  let yieldKwh = todaySolar + remainder;
  let consumpKwh = fullDayConsump + bypassDaily;
  let sunHours = sunH[todayIdx] ?? 5;

  if (period === "month") {
    const left = Math.max(0, dim - now.getDate());
    yieldKwh = soFarSolar + remainder + avgFuture * left;
    consumpKwh = fullDayConsump * dim + bypassDaily * dim;
    const slice = futureSun.slice(0, Math.max(1, left));
    sunHours = Number.isFinite(avg(slice)) ? avg(slice) : (sunH[todayIdx] ?? 5);
  }

  if (period === "year") {
    const left = Math.max(0, daysInYear - dayOfYear);
    yieldKwh = soFarSolar + remainder + avgFuture * left;
    consumpKwh = fullDayConsump * daysInYear + bypassDaily * daysInYear;
    sunHours = Number.isFinite(avg(sunH)) ? avg(sunH) : 5;
  }

  // Negative = saved/credit, positive = paid.
  const billPhp = (consumpKwh - yieldKwh) * CONFIG.GRID_PHP_PER_KWH;

  return { yieldKwh, billPhp, sunHours };
}

export async function fetchDayForecast(
  todaySolarKwh: number,
  todayConsumedKwh: number,
  refDailySolar: number,
  bypassDailyAvg = 0,
): Promise<Forecast | null> {
  try {
    return estimateForecast(
      await getSky(),
      "day",
      todaySolarKwh,
      todaySolarKwh,
      todayConsumedKwh,
      refDailySolar,
      bypassDailyAvg,
    );
  } catch {
    return null;
  }
}

export async function fetchMonthForecast(
  monthSolarKwh: number,
  todaySolarKwh: number,
  todayConsumedKwh: number,
  refDailySolar: number,
  bypassDailyAvg = 0,
): Promise<Forecast | null> {
  try {
    return estimateForecast(
      await getSky(),
      "month",
      monthSolarKwh,
      todaySolarKwh,
      todayConsumedKwh,
      refDailySolar,
      bypassDailyAvg,
    );
  } catch {
    return null;
  }
}

export async function fetchYearForecast(
  yearSolarKwh: number,
  todaySolarKwh: number,
  todayConsumedKwh: number,
  refDailySolar: number,
  bypassDailyAvg = 0,
): Promise<Forecast | null> {
  try {
    return estimateForecast(
      await getSky(),
      "year",
      yearSolarKwh,
      todaySolarKwh,
      todayConsumedKwh,
      refDailySolar,
      bypassDailyAvg,
    );
  } catch {
    return null;
  }
}
