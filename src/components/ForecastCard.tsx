import { useEffect, useState } from 'react'
import { CONFIG } from '../config'
import { fetchMonthForecast, type MonthForecast } from '../lib/forecast'
import { php } from '../lib/format'
import { kwhParts } from '../lib/format'

export default function ForecastCard({ monthKwh, monthGridPhp, todayKwh, todayGridKwh }: {
  monthKwh: number; monthGridPhp: number; todayKwh: number; todayGridKwh: number
}) {
  const [fc, setFc] = useState<MonthForecast | null>(null)

  useEffect(() => {
    let live = true
    fetchMonthForecast(monthKwh, todayKwh, monthGridPhp, todayGridKwh).then((f) => {
      if (live) setFc(f)
    })
    return () => { live = false }
  }, [monthKwh, monthGridPhp, todayKwh, todayGridKwh])

  if (!fc) return <div className="card p-5 text-base font-semibold muted">Loading forecast…</div>

  const p = kwhParts(fc.monthEndKwh)
  return (
    <section className="card p-5" aria-label="Month forecast">
      <div className="eyebrow mb-1">Forecast · End of month {fc.usedFallback ? '· offline' : '· live weather'}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <div className="rounded-xl p-4 text-center" style={{ background: 'var(--chip)' }}>
          <div className="text-sm font-semibold muted">Projected yield</div>
          <div className="med-number mt-1">{p.value}<span className="unit">{p.unit}</span></div>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: 'var(--chip)' }}>
          <div className="text-sm font-semibold muted">Projected grid bill</div>
          <div className="med-number mt-1">{php(fc.monthEndGridPhp)}</div>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: 'var(--chip)' }}>
          <div className="text-sm font-semibold muted">Sun average</div>
          <div className="med-number mt-1">{fc.avgSunHours.toFixed(1)}<span className="unit">h/day</span></div>
        </div>
      </div>
      <div className="formula mt-3">Open-Meteo {CONFIG.LAT.toFixed(2)},{CONFIG.LON.toFixed(2)} · {CONFIG.SYSTEM_KWP} kW system</div>
    </section>
  )
}
