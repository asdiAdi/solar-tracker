import { CONFIG } from '../config'

interface OpenMeteoDaily {
  time: string[]
  shortwave_radiation_sum?: number[]
  sunshine_duration?: number[]
}

export interface MonthForecast {
  forecastKwh: number
  monthEndKwh: number
  monthEndGridPhp: number
  avgSunHours: number
  usedFallback: boolean
}

/**
 * Estimate month-end using Open-Meteo radiation/sunshine + today's yield.
 * Formula: ratio = today_kwh / max(today_radiation, 0.5)
 * forecast = sum(remaining_days_radiation * ratio), capped by SYSTEM_KWP * sun_hours.
 */
export async function fetchMonthForecast(
  soFarKwh: number,
  todayKwh: number,
  soFarGridPhp: number,
  todayGridKwh: number,
): Promise<MonthForecast> {
  const fallback = () => {
    // No network: assume rest of month = today daily average prorated
    const now = new Date()
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const elapsed = Math.max(1, now.getDate())
    const dailyAvg = soFarKwh / elapsed
    const remaining = dim - elapsed
    const forecastKwh = dailyAvg * remaining
    return {
      forecastKwh,
      monthEndKwh: soFarKwh + forecastKwh,
      monthEndGridPhp: soFarGridPhp + (todayGridKwh / Math.max(1, elapsed)) * remaining * 0 + (todayGridKwh * remaining) / 1,
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
    // Find today index (Manila date may differ by a day; use closest)
    let todayIdx = daily.time.findIndex((t) => t === todayStr)
    if (todayIdx < 0) todayIdx = 2 // past_days=2 => index 2 is today approx
    const todayRad = daily.shortwave_radiation_sum?.[todayIdx] ?? 15
    const ratio = todayKwh / Math.max(0.5, todayRad)

    let forecastKwh = 0
    let sunSec = 0
    let count = 0
    for (let i = todayIdx + 1; i < daily.time.length; i++) {
      const rad = daily.shortwave_radiation_sum?.[i] ?? 15
      const sun = daily.sunshine_duration?.[i] ?? 18000
      // cap by inverter: max kWh/day ~= SYSTEM_KWP * sun_hours * 0.8 perf ratio
      const sunH = sun / 3600
      const cap = CONFIG.SYSTEM_KWP * sunH * 0.8
      forecastKwh += Math.min(rad * ratio, cap)
      sunSec += sun
      count++
    }
    // Only keep remaining days of this calendar month (max)
    const now = new Date()
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const remaining = Math.max(0, dim - now.getDate())
    if (count > remaining && remaining > 0) forecastKwh = (forecastKwh / count) * remaining

    const avgSunHours = count ? sunSec / count / 3600 : 5
    // Grid forecast: assume daily grid avg continues
    const elapsed = Math.max(1, now.getDate())
    const dailyGridAvg = soFarGridPhp / elapsed / CONFIG.GRID_PHP_PER_KWH // kwh
    const forecastGridKwh = dailyGridAvg * remaining
    const monthEndGridPhp = soFarGridPhp + forecastGridKwh * CONFIG.GRID_PHP_PER_KWH

    return {
      forecastKwh,
      monthEndKwh: soFarKwh + forecastKwh,
      monthEndGridPhp,
      avgSunHours,
      usedFallback: false,
    }
  } catch {
    return fallback()
  }
}
