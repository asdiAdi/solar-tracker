import { CONFIG } from '../config'
import type { SolarReading } from './types'

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`)
  return r.json() as Promise<T>
}

/** Deterministic pseudo-variation so past dates show different placeholder numbers. */
function vary(base: SolarReading, seedStr: string): SolarReading {
  let h = 0
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0
  const f = 0.7 + ((h % 60) / 100) // 0.70 - 1.29
  const g = 0.8 + (((h >> 3) % 40) / 100)
  const gridImport = base.energy.grid_import_kwh * f
  const generated = base.energy.generated_kwh * g
  return {
    ...base,
    timestamp: seedStr,
    energy: {
      generated_kwh: round1(generated),
      consumed_kwh: round1(base.energy.consumed_kwh * ((f + g) / 2)),
      grid_import_kwh: round1(gridImport),
      grid_export_kwh: round1(base.energy.grid_export_kwh * g),
    },
    cost: {
      grid_import_php: Math.round(gridImport * CONFIG.GRID_PHP_PER_KWH),
      saved_php: Math.round(Math.max(0, generated - base.energy.grid_export_kwh * g) * CONFIG.GRID_PHP_PER_KWH * 0.9),
    },
  }
}
const round1 = (n: number) => Math.round(n * 10) / 10

export async function getReading(
  kind: 'live' | 'day' | 'month' | 'year',
  dateKey?: string,
): Promise<SolarReading> {
  const base = CONFIG.API_BASE_URL.replace(/\/$/, '')
  const q =
    kind === 'day' && dateKey ? `?date=${dateKey}` :
      kind === 'month' && dateKey ? `?month=${dateKey}` :
        kind === 'year' && dateKey ? `?year=${dateKey}` : ''
  const candidates = [`${base}/${kind}.json${q}`]
  if (base !== '/mock') candidates.push(`/mock/${kind}.json`)
  let lastErr: unknown
  for (const u of candidates) {
    try {
      const data = await fetchJson<SolarReading>(u.split('?')[0])
      if (dateKey && kind !== 'live') return vary(data, dateKey)
      return data
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('no data')
}
