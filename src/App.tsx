import { useCallback, useEffect, useRef, useState } from 'react'
import { CONFIG } from './config'
import { getLive, getPeriod } from './lib/api'
import { currentMonthISO, currentYear, todayISO } from './lib/date'
import type { LiveResponse, Period, PeriodResponse } from './lib/types'
import { DEFAULT_COST, DEFAULT_ENERGY, DEFAULT_LIVE } from './lib/types'
import ThemeSwitcher, { getInitialTheme } from './components/ThemeSwitcher'
import PeriodTabs from './components/PeriodTabs'
import DateSelector from './components/DateSelector'
import LiveCards from './components/LiveCards'
import TotalsCards from './components/TotalsCards'
import CostCards from './components/CostCards'
import ForecastCard from './components/ForecastCard'

// Backend is the single source of truth for caching (Dynamo TTLs + Cache-Control).
// Frontend does plain fetches,no localStorage/memory TTL checks.
const LIVE_POLL_MS = 5 * 60_000

const isoDay = () => todayISO()
const isoMonth = () => currentMonthISO()
const isoYear = () => String(currentYear())

function ageLabel(at: number | null): string {
  if (!at) return 'never'
  const m = Math.max(0, Math.round((Date.now() - at) / 60000))
  if (m < 1) return 'just now'
  if (m === 1) return '1 min ago'
  return `${m} min ago`
}

export default function App() {
  const [period, setPeriod] = useState<Period>('day')
  const [day, setDay] = useState(isoDay())
  const [month, setMonth] = useState(isoMonth())
  const [year, setYear] = useState(isoYear())
  const [data, setData] = useState<Record<string, PeriodResponse>>({})
  const [dataAt, setDataAt] = useState<Record<string, number>>({})
  const [live, setLive] = useState<LiveResponse | null>(null)
  const [liveAt, setLiveAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef<Set<string>>(new Set())

  useEffect(() => {
    document.documentElement.dataset.theme = getInitialTheme()
  }, [])

  const dateKey = period === 'day' ? day : period === 'month' ? month : year
  const cacheKey = `${period}:${dateKey}`

  const fetchLive = useCallback(async (signal?: AbortSignal) => {
    const key = 'live'
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    try {
      const r = await getLive(signal)
      if (signal?.aborted) return
      const at = Date.now()
      setLive(r)
      setLiveAt(at)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      // keep stale live on error (caller decides whether to surface)
    } finally {
      inFlight.current.delete(key)
    }
  }, [])

  const fetchPeriod = useCallback(async (kind: Period, key: string, signal?: AbortSignal) => {
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    try {
      setError(null)
      const dateArg = key.split(':').slice(1).join(':')
      const r = await getPeriod(kind, dateArg, signal)
      if (signal?.aborted) return
      const at = Date.now()
      setData((d) => ({ ...d, [key]: r }))
      setDataAt((d) => ({ ...d, [key]: at }))
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setError(String(e))
    } finally {
      inFlight.current.delete(key)
    }
  }, [])

  // Live: fetch once on mount, then every 5 min. Not tied to date browsing.
  useEffect(() => {
    const ctrl = new AbortController()
    void fetchLive(ctrl.signal)
    const t = setInterval(() => { void fetchLive() }, LIVE_POLL_MS)
    return () => {
      ctrl.abort()
      clearInterval(t)
    }
  }, [fetchLive])

  // Period: fetch active period/dateKey on change. No freshness checks.
  useEffect(() => {
    const ctrl = new AbortController()
    void fetchPeriod(period, cacheKey, ctrl.signal)
    return () => { ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateKey])

  // Forecast needs current month + today even when viewing other dates — fetch directly.
  useEffect(() => {
    if (period !== 'month') return
    const ctrl = new AbortController()
    const todayKey = `day:${isoDay()}`
    const monthKey = `month:${month}`
    void fetchPeriod('day', todayKey, ctrl.signal)
    if (monthKey !== todayKey) void fetchPeriod('month', monthKey, ctrl.signal)
    return () => { ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, month])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        fetchLive(),
        fetchPeriod(period, cacheKey),
      ])
    } finally {
      setRefreshing(false)
    }
  }, [fetchLive, fetchPeriod, period, cacheKey])

  const cur = data[cacheKey] ?? null
  const curAt = dataAt[cacheKey] ?? null
  const monthCacheKey = `month:${month}`
  const dayCacheKey = `day:${day}`
  const monthData = data[monthCacheKey] ?? null
  const dayData = data[dayCacheKey] ?? null
  const liveValues = live?.live ?? DEFAULT_LIVE
  const energy = cur?.energy ?? DEFAULT_ENERGY
  const cost = cur?.cost ?? DEFAULT_COST
  const label = period === 'day' ? (day === isoDay() ? 'Today' : day) : period === 'month' ? (month === isoMonth() ? 'This month' : month) : isoYear()
  const netLabel = period === 'day' ? "Today's net" : period === 'month' ? "Month net" : "Year net"
  // Loading vs error: spinner while first fetch has no data yet; N/A (red) only after fetch failed.
  const isLiveLoading = live == null
  const isPeriodLoading = cur == null && !error
  const isForecastInputsLoading = monthData == null || dayData == null

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

        <LiveCards live={liveValues} loading={isLiveLoading} />

        <div className="flex flex-col gap-2">
          <PeriodTabs period={period} onChange={setPeriod} />
          <DateSelector period={period} day={day} month={month} year={year} onDay={setDay} onMonth={setMonth} onYear={setYear} />
          <div className="flex items-center justify-between text-sm muted">
            <span>Updated {ageLabel(curAt)} · Live {ageLabel(liveAt)}</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: 'var(--chip)', color: 'var(--text)', opacity: refreshing ? 0.6 : 1 }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <div className="card p-4 text-base font-semibold" role="alert">Cannot load data: {error}</div>}

        <TotalsCards energy={energy} label={label} loading={isPeriodLoading} />
        <CostCards cost={cost} energy={energy} label={label} netLabel={netLabel} loading={isPeriodLoading} />
        {period === 'month' && (
          <ForecastCard
            monthSolarKwh={monthData?.energy.generated_kwh ?? DEFAULT_ENERGY.generated_kwh}
            monthNetPhp={monthData?.cost.net_php ?? DEFAULT_COST.net_php}
            todaySolarKwh={dayData?.energy.generated_kwh ?? DEFAULT_ENERGY.generated_kwh}
            todayConsumedKwh={dayData?.energy.consumed_kwh ?? DEFAULT_ENERGY.consumed_kwh}
            inputsLoading={isForecastInputsLoading}
          />
        )}
      </div>
    </div>
  )
}
