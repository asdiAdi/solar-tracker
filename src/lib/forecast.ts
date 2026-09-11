import { CONFIG } from '../config'

interface OpenMeteoDaily {
  time: string[]
  shortwave_radiation_sum?: number[]
  sunshine_duration?: number[]
}

export interface DayForecast {
  yieldKwh: number
  billPhp: number
  sunHours: number
}

export interface MonthForecast {
  forecastKwh: number
  monthEndKwh: number
  monthEndNetPhp: number
  avgSunHours: number
  usedFallback: boolean
}

export interface CombinedForecast {
  today: DayForecast
  monthEnd: MonthForecast
  usedFallback: boolean
}

export interface YearForecast {
  yearEndKwh: number
  yearEndNetPhp: number
  avgSunHours: number
  usedFallback: boolean
}

function todayStrInTZ(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function fetchMeteoDaily(): Promise<OpenMeteoDaily> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.LAT}&longitude=${CONFIG.LON}` +
    `&daily=shortwave_radiation_sum,sunshine_duration&timezone=${encodeURIComponent(CONFIG.TIMEZONE)}&forecast_days=16&past_days=2`
  const res = await fetch(url)
  if (!res.ok) throw new Error('meteo ' + res.status)
  const j = await res.json()
  const daily = j.daily as OpenMeteoDaily
  if (!daily?.time?.length) throw new Error('empty')
  return daily
}

export async function fetchDayForecast(
  todaySolarKwh: number,
  todayConsumedKwh: number,
  todayNetPhp?: number,
): Promise<DayForecast> {
  try {
    const daily = await fetchMeteoDaily()
    const todayStr = todayStrInTZ()
    let todayIdx = daily.time.findIndex((t) => t === todayStr)
    if (todayIdx < 0) todayIdx = 2
    const now = new Date()
    const todayRad = daily.shortwave_radiation_sum?.[todayIdx] ?? 15
    const ratio = todaySolarKwh / Math.max(0.5, todayRad)
    const todaySunSec = daily.sunshine_duration?.[todayIdx] ?? 18000
    const todaySunHours = todaySunSec / 3600
    const todayCap = CONFIG.SYSTEM_KWP * todaySunHours * 0.8
    const todayYieldKwh = Math.max(todaySolarKwh, Math.min(todayRad * ratio, todayCap))
    const hoursElapsed = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
    const dayProgress = Math.min(1, Math.max(0, hoursElapsed / 24))
    const netBase = todayNetPhp ?? todayConsumedKwh * CONFIG.GRID_PHP_PER_KWH
    const billPhp = dayProgress > 0.02 ? netBase / Math.max(dayProgress, 0.05) : netBase
    return { yieldKwh: todayYieldKwh, billPhp, sunHours: todaySunHours }
  } catch {
    return {
      yieldKwh: todaySolarKwh,
      billPhp: todayNetPhp ?? todayConsumedKwh * CONFIG.GRID_PHP_PER_KWH,
      sunHours: 5,
    }
  }
}

export async function fetchYearForecast(
  yearSoFarSolarKwh: number,
  yearSoFarNetPhp: number,
): Promise<YearForecast> {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const dayOfYear = Math.max(1, Math.floor((now.getTime() - start.getTime()) / 86400000) + 1)
  const isLeap = (now.getFullYear() % 4 === 0 && now.getFullYear() % 100 !== 0) || now.getFullYear() % 400 === 0
  const daysInYear = isLeap ? 366 : 365
  const remaining = Math.max(0, daysInYear - dayOfYear)
  const dailyAvgSolar = yearSoFarSolarKwh / dayOfYear
  const dailyAvgNet = yearSoFarNetPhp / dayOfYear
  let avgSunHours = 5
  let usedFallback = true
  try {
    const daily = await fetchMeteoDaily()
    const suns = (daily.sunshine_duration ?? []).map((s) => s / 3600).filter((h) => Number.isFinite(h))
    if (suns.length) {
      avgSunHours = suns.reduce((a, b) => a + b, 0) / suns.length
      usedFallback = false
    }
  } catch {
    // keep fallback sun
  }
  return {
    yearEndKwh: yearSoFarSolarKwh + dailyAvgSolar * remaining,
    yearEndNetPhp: yearSoFarNetPhp + dailyAvgNet * remaining,
    avgSunHours,
    usedFallback,
  }
}

export async function fetchMonthForecast(
  soFarSolarKwh: number,
  todaySolarKwh: number,
  soFarNetPhp: number,
  todayConsumedKwh: number,
  todayNetPhp?: number,
): Promise<MonthForecast> {
  const c = await fetchForecastInner(soFarSolarKwh, todaySolarKwh, soFarNetPhp, todayConsumedKwh, todayNetPhp);
  return c.monthEnd;
}

export async function fetchForecast(
  soFarSolarKwh: number,
  todaySolarKwh: number,
  soFarNetPhp: number,
  todayConsumedKwh: number,
  todayNetPhp?: number,
): Promise<CombinedForecast> {
  return fetchForecastInner(soFarSolarKwh, todaySolarKwh, soFarNetPhp, todayConsumedKwh, todayNetPhp);
}

async function fetchForecastInner(
  soFarSolarKwh: number,
  todaySolarKwh: number,
  soFarNetPhp: number,
  todayConsumedKwh: number,
  todayNetPhp?: number,
): Promise<CombinedForecast> {
  const fallback = () => {
    const now = new Date()
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const elapsed = Math.max(1, now.getDate())
    const dailyAvg = soFarSolarKwh / elapsed
    const remaining = dim - elapsed
    const forecastKwh = dailyAvg * remaining
    const monthEnd: MonthForecast = {
      forecastKwh,
      monthEndKwh: soFarSolarKwh + forecastKwh,
      monthEndNetPhp: soFarNetPhp + (todayConsumedKwh * remaining) / 1,
      avgSunHours: 5,
      usedFallback: true,
    }
    const today: DayForecast = {
      yieldKwh: todaySolarKwh,
      billPhp: todayNetPhp ?? todayConsumedKwh * CONFIG.GRID_PHP_PER_KWH,
      sunHours: 5,
    }
    return { today, monthEnd, usedFallback: true } as CombinedForecast
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.LAT}&longitude=${CONFIG.LON}` +
      `&daily=shortwave_radiation_sum,sunshine_duration&timezone=${encodeURIComponent(CONFIG.TIMEZONE)}&forecast_days=16&past_days=2`
    const res = await fetch(url)
    if (!res.ok) throw new Error('meteo ' + res.status)
    const j = await res.json()
    const daily = j.daily as OpenMeteoDaily
    if (!daily?.time?.length) throw new Error('empty')

    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: CONFIG.TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    let todayIdx = daily.time.findIndex((t) => t === todayStr)
    if (todayIdx < 0) todayIdx = 2
    const now = new Date()
    const todayRad = daily.shortwave_radiation_sum?.[todayIdx] ?? 15
    const ratio = todaySolarKwh / Math.max(0.5, todayRad)

    let forecastKwh = 0
    let sunSec = 0
    let count = 0
    for (let i = todayIdx + 1; i < daily.time.length; i++) {
      const rad = daily.shortwave_radiation_sum?.[i] ?? 15
      const sun = daily.sunshine_duration?.[i] ?? 18000
      const sunH = sun / 3600
      const cap = CONFIG.SYSTEM_KWP * sunH * 0.8
      forecastKwh += Math.min(rad * ratio, cap)
      sunSec += sun
      count++
    }
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const remaining = Math.max(0, dim - now.getDate())
    if (count > remaining && remaining > 0) forecastKwh = (forecastKwh / count) * remaining

    const todaySunSec = daily.sunshine_duration?.[todayIdx] ?? 18000
    const todaySunHours = todaySunSec / 3600
    const todayCap = CONFIG.SYSTEM_KWP * todaySunHours * 0.8
    const todayMeteoYield = Math.min(todayRad * ratio, todayCap)
    const todayYieldKwh = Math.max(todaySolarKwh, todayMeteoYield)

    const hoursElapsed = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
    const dayProgress = Math.min(1, Math.max(0, hoursElapsed / 24))
    const netBase = todayNetPhp ?? todayConsumedKwh * CONFIG.GRID_PHP_PER_KWH
    const todayBillPhp = dayProgress > 0.02 ? netBase / Math.max(dayProgress, 0.05) : netBase

    const avgSunHours = count ? sunSec / count / 3600 : 5
    const elapsed = Math.max(1, now.getDate())
    const dailyNetAvg = soFarNetPhp / elapsed
    const monthEndNetPhp = soFarNetPhp + dailyNetAvg * remaining

    return {
      today: {
        yieldKwh: todayYieldKwh,
        billPhp: todayBillPhp,
        sunHours: todaySunHours,
      },
      monthEnd: {
        forecastKwh,
        monthEndKwh: soFarSolarKwh + forecastKwh,
        monthEndNetPhp,
        avgSunHours,
        usedFallback: false,
      },
      usedFallback: false,
    }
  } catch {
    return fallback()
  }
}
