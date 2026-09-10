import { useCallback, useEffect, useRef, useState } from 'react'
import { CONFIG } from './config'
import { getLive, getPeriod } from './lib/api'
import { currentMonthISO, currentYear, todayISO } from './lib/date'
import type { LiveResponse, Period, PeriodResponse } from './lib/types'
import { DEFAULT_COST, DEFAULT_ENERGY, DEFAULT_LIVE } from './lib/types'
import { LIVE_TTL_MS, PERIOD_TTL_MS, cacheKeyFor, isFresh, readCache, writeCache } from './lib/cache'
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
  const [live, setLive] = useState<LiveResponse | null>(() => readCache<LiveResponse>(cacheKeyFor('live'))?.value ?? null)
  const [liveAt, setLiveAt] = useState<number | null>(() => readCache<LiveResponse>(cacheKeyFor('live'))?.at ?? null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef<Set<string>>(new Set())
  const liveAtRef = useRef<number | null>(null)
  const dataRef = useRef<Record<string, PeriodResponse>>({})
  const dataAtRef = useRef<Record<string, number>>({})

  useEffect(() => {
    document.documentElement.dataset.theme = getInitialTheme()
  }, [])

  // Keep refs in sync for stable callbacks (avoids refetch loops)
  useEffect(() => { liveAtRef.current = liveAt }, [liveAt])
  useEffect(() => {
    dataRef.current = data
    dataAtRef.current = dataAt
  }, [data, dataAt])

  const dateKey = period === 'day' ? day : period === 'month' ? month : year
  const cacheKey = `${period}:${dateKey}`

  const fetchLive = useCallback(async (force = false, signal?: AbortSignal) => {
    const key = cacheKeyFor('live')
    if (!force) {
      if (liveAtRef.current && isFresh(liveAtRef.current, LIVE_TTL_MS)) return
      const cached = readCache<LiveResponse>(key)
      if (cached && isFresh(cached.at, LIVE_TTL_MS)) {
        setLive(cached.value)
        setLiveAt(cached.at)
        return
      }
    }
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    try {
      const r = await getLive(signal)
      if (signal?.aborted) return
      const at = Date.now()
      setLive(r)
      setLiveAt(at)
      writeCache(key, r)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      // keep stale live on error (caller decides whether to surface)
    } finally {
      inFlight.current.delete(key)
    }
  }, [])

  const fetchPeriod = useCallback(async (kind: Period, key: string, storageKey: string, force = false, signal?: AbortSignal) => {
    if (!force) {
      const at = dataAtRef.current[key]
      if (at && isFresh(at, PERIOD_TTL_MS) && dataRef.current[key]) return
      const cached = readCache<PeriodResponse>(storageKey)
      if (cached && isFresh(cached.at, PERIOD_TTL_MS)) {
        const ck = key
        const cv = cached.value
        const ca = cached.at
        setData((d) => (d[ck] ? d : { ...d, [ck]: cv }))
        setDataAt((d) => (d[ck] ? d : { ...d, [ck]: ca }))
        return
      }
    }
    if (inFlight.current.has(storageKey)) return
    inFlight.current.add(storageKey)
    try {
      setError(null)
      const dateArg = key.split(':').slice(1).join(':')
      const r = await getPeriod(kind, dateArg, signal)
      if (signal?.aborted) return
      const at = Date.now()
      setData((d) => ({ ...d, [key]: r }))
      setDataAt((d) => ({ ...d, [key]: at }))
      writeCache(storageKey, r)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setError(String(e))
    } finally {
      inFlight.current.delete(storageKey)
    }
  }, [])

  // Live: fetch once on mount, then every 5 min. Not tied to date browsing.
  useEffect(() => {
    const ctrl = new AbortController()
    void fetchLive(false, ctrl.signal)
    const t = setInterval(() => { void fetchLive(true) }, LIVE_TTL_MS)
    return () => {
      ctrl.abort()
      clearInterval(t)
    }
  }, [fetchLive])

  // Period: fetch only active period/dateKey, skip if fresh (memory or localStorage).
  useEffect(() => {
    const ctrl = new AbortController()
    const storageKey = cacheKeyFor(period, dateKey)
    void fetchPeriod(period, cacheKey, storageKey, false, ctrl.signal)
    return () => { ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateKey])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const storageKey = cacheKeyFor(period, dateKey)
      await Promise.all([
        fetchLive(true),
        fetchPeriod(period, cacheKey, storageKey, true),
      ])
    } finally {
      setRefreshing(false)
    }
  }, [fetchLive, fetchPeriod, period, dateKey, cacheKey])

  const cur = data[cacheKey] ?? readCache<PeriodResponse>(cacheKeyFor(period, dateKey))?.value ?? null
  const curAt = dataAt[cacheKey] ?? readCache<PeriodResponse>(cacheKeyFor(period, dateKey))?.at ?? null
  // Forecast needs current month + today even when viewing other dates — read from cache, no extra fetch here.
  const monthCacheKey = `month:${month}`
  const dayCacheKey = `day:${day}`
  const monthData = data[monthCacheKey] ?? readCache<PeriodResponse>(cacheKeyFor('month', month))?.value ?? null
  const dayData = data[dayCacheKey] ?? readCache<PeriodResponse>(cacheKeyFor('day', day))?.value ?? null
  const liveValues = live?.live ?? DEFAULT_LIVE
  const energy = cur?.energy ?? DEFAULT_ENERGY
  const cost = cur?.cost ?? DEFAULT_COST
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

        <LiveCards live={liveValues} />

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

        <TotalsCards energy={energy} label={label} />
        <CostCards cost={cost} energy={energy} label={label} netLabel={netLabel} />
        {period === 'month' && (
          <ForecastCard
            monthSolarKwh={monthData?.energy.generated_kwh ?? DEFAULT_ENERGY.generated_kwh}
            monthNetPhp={monthData?.cost.net_php ?? DEFAULT_COST.net_php}
            todaySolarKwh={dayData?.energy.generated_kwh ?? DEFAULT_ENERGY.generated_kwh}
            todayConsumedKwh={dayData?.energy.consumed_kwh ?? DEFAULT_ENERGY.consumed_kwh}
          />
        )}
      </div>
    </div>
  )
}
