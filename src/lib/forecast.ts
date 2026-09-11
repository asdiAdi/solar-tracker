import { CONFIG } from '../config'

interface OpenMeteoDaily {
  time: string[]
  shortwave_radiation_sum?: number[]
  sunshine_duration?: number[]
}

export interface MonthForecast {
  forecastKwh: number
  monthEndKwh: number
  monthEndNetPhp: number
  avgSunHours: number
  usedFallback: boolean
}

export async function fetchMonthForecast(
  soFarSolarKwh: number,
  todaySolarKwh: number,
  soFarNetPhp: number,
  todayConsumedKwh: number,
): Promise<MonthForecast> {
  return fetchMonthForecastInner(soFarSolarKwh, todaySolarKwh, soFarNetPhp, todayConsumedKwh);
}

async function fetchMonthForecastInner(
  soFarSolarKwh: number,
  todaySolarKwh: number,
  soFarNetPhp: number,
  todayConsumedKwh: number,
): Promise<MonthForecast> {
  const fallback = () => {
    const now = new Date()
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const elapsed = Math.max(1, now.getDate())
    const dailyAvg = soFarSolarKwh / elapsed
    const remaining = dim - elapsed
    const forecastKwh = dailyAvg * remaining
    return {
      forecastKwh,
      monthEndKwh: soFarSolarKwh + forecastKwh,
      monthEndNetPhp: soFarNetPhp + (todayConsumedKwh * remaining) / 1,
      avgSunHours: 5,
      usedFallback: true,
    } as MonthForecast
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

    const todayStr = new Date().toISOString().slice(0, 10)
    let todayIdx = daily.time.findIndex((t) => t === todayStr)
    if (todayIdx < 0) todayIdx = 2
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
    const now = new Date()
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const remaining = Math.max(0, dim - now.getDate())
    if (count > remaining && remaining > 0) forecastKwh = (forecastKwh / count) * remaining

    const avgSunHours = count ? sunSec / count / 3600 : 5
    const elapsed = Math.max(1, now.getDate())
    const dailyNetAvg = soFarNetPhp / elapsed
    const monthEndNetPhp = soFarNetPhp + dailyNetAvg * remaining

    return {
      forecastKwh,
      monthEndKwh: soFarSolarKwh + forecastKwh,
      monthEndNetPhp,
      avgSunHours,
      usedFallback: false,
    }
  } catch {
    return fallback()
  }
}
