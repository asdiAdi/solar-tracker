export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Local today as YYYY-MM-DD (avoids UTC off-by-one from toISOString). */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function currentMonthISO(): string {
  return todayISO().slice(0, 7)
}

export function currentYear(): number {
  return new Date().getFullYear()
}

export function parseDay(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

export function parseMonth(ym: string): { y: number; m: number } {
  const [y, m] = ym.split('-').map(Number)
  return { y, m }
}

export function toDayISO(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

export function toMonthISO(y: number, m: number): string {
  return `${y}-${pad2(m)}`
}

/** "September 07 2026" */
export function formatFullDay(isoDay: string): string {
  const { y, m, d } = parseDay(isoDay)
  return `${MONTH_NAMES[m - 1]} ${pad2(d)} ${y}`
}

/** "September 2026" */
export function formatMonthLabel(ym: string): string {
  const { y, m } = parseMonth(ym)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

export function shiftDay(iso: string, delta: number): string {
  const { y, m, d } = parseDay(iso)
  const dt = new Date(y, m - 1, d + delta)
  return toDayISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

export function shiftMonth(ym: string, delta: number): string {
  const { y, m } = parseMonth(ym)
  const dt = new Date(y, m - 1 + delta, 1)
  return toMonthISO(dt.getFullYear(), dt.getMonth() + 1)
}

export function clampDayMaxToday(iso: string): string {
  const t = todayISO()
  return iso > t ? t : iso
}

export function clampMonthMaxCurrent(ym: string): string {
  const c = currentMonthISO()
  return ym > c ? c : ym
}

export function clampYearMaxCurrent(y: string | number): string {
  return String(Math.min(Number(y), currentYear()))
}
