import { useEffect, useState } from 'react'
import { CONFIG } from './config'
import { getSolarData } from './lib/api'
import { currentMonthISO, currentYear, todayISO } from './lib/date'
import type { Period, SolarData } from './lib/types'
import ThemeSwitcher, { getInitialTheme } from './components/ThemeSwitcher'
import PeriodTabs from './components/PeriodTabs'
import DateSelector from './components/DateSelector'
import LiveCards from './components/LiveCards'
import TotalsCards from './components/TotalsCards'
import CostCards from './components/CostCards'
import ForecastCard from './components/ForecastCard'

const isoDay = () => todayISO()
const isoMonth = () => currentMonthISO()
const isoYear = () => String(currentYear())

export default function App() {
  const [period, setPeriod] = useState<Period>('day')
  const [day, setDay] = useState(isoDay())
  const [month, setMonth] = useState(isoMonth())
  const [year, setYear] = useState(isoYear())
  const [data, setData] = useState<Record<Period, SolarData | null>>({ day: null, month: null, year: null })
  const [live, setLive] = useState<SolarData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = getInitialTheme()
  }, [])

  const dateKey = period === 'day' ? day : period === 'month' ? month : year

  useEffect(() => {
    let alive = true
    setError(null)
    getSolarData('live').then((r) => alive && setLive(r)).catch(() => { })
    getSolarData(period, dateKey).then((r) => alive && setData((d) => ({ ...d, [period]: r }))).catch((e) => alive && setError(String(e)))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, day, month, year])

  useEffect(() => {
    getSolarData('month', month).then((r) => setData((d) => (d.month ? d : { ...d, month: r }))).catch(() => { })
    getSolarData('day', day).then((r) => setData((d) => (d.day ? d : { ...d, day: r }))).catch(() => { })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cur = data[period]
  const label = period === 'day' ? (day === isoDay() ? 'Today' : day) : period === 'month' ? (month === isoMonth() ? 'This month' : month) : isoYear()
  const netLabel = period === 'day' ? "Today's net" : period === 'month' ? "Month net" : "Year net"

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="max-w-2xl mx-auto px-4 pb-12 flex flex-col gap-4">
        <header className="pt-5 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl" aria-hidden>☀️</span>
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none">{CONFIG.APP_NAME}</h1>
            </div>
          </div>
          <ThemeSwitcher />
        </header>

        {live && <LiveCards live={live.live} />}

        <div className="flex flex-col gap-2">
          <PeriodTabs period={period} onChange={setPeriod} />
          <DateSelector period={period} day={day} month={month} year={year} onDay={setDay} onMonth={setMonth} onYear={setYear} />
        </div>

        {error && <div className="card p-4 text-base font-semibold" role="alert">Cannot load data: {error}</div>}
        {!cur && !error && <div className="card p-6 text-lg font-semibold muted">Loading…</div>}

        {cur && (
          <>
            <TotalsCards energy={cur.energy} label={label} />
            <CostCards cost={cur.cost} energy={cur.energy} label={label} netLabel={netLabel} />
          </>
        )}
        {data.month && data.day && period === 'month' && (
          <ForecastCard
            monthKwh={data.month.energy.generated_kwh}
            monthGridPhp={data.month.cost.grid_import_php}
            todayKwh={data.day.energy.generated_kwh}
            todayGridKwh={data.day.energy.grid_import_kwh}
          />
        )}
      </div>
    </div>
  )
}
