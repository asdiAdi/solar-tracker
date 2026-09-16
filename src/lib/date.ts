export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local today as YYYY-MM-DD (avoids UTC off-by-one from toISOString). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function currentMonthISO(): string {
  return todayISO().slice(0, 7);
}

export function currentYear(): number {
  return new Date().getFullYear();
}

export function parseDay(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function parseMonth(ym: string): { y: number; m: number } {
  const [y, m] = ym.split("-").map(Number);
  return { y, m };
}

export function toDayISO(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function toMonthISO(y: number, m: number): string {
  return `${y}-${pad2(m)}`;
}

/** "September 07 2026" */
export function formatFullDay(isoDay: string): string {
  const { y, m, d } = parseDay(isoDay);
  return `${MONTH_NAMES[m - 1]} ${pad2(d)} ${y}`;
}

/** "September 2026" */
export function formatMonthLabel(ym: string): string {
  const { y, m } = parseMonth(ym);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

const MONTH_SHORT = MONTH_NAMES.map((n) => n.slice(0, 3));

/** Billing window for YYYY-MM: [prevMonth-17, month-16] inclusive. */
export function billingWindowForMonth(ym: string): {
  start: string;
  end: string;
} {
  const { y, m } = parseMonth(ym);
  const prev = new Date(y, m - 2, 17);
  const start = toDayISO(prev.getFullYear(), prev.getMonth() + 1, 17);
  const end = toDayISO(y, m, 16);
  return { start, end };
}

/** Billing mm containing a given day: d<=16 -> that month, else next month. */
export function billingMonthForDay(isoDay: string): string {
  const { y, m, d } = parseDay(isoDay);
  if (d <= 16) return toMonthISO(y, m);
  const dt = new Date(y, m, 1);
  return toMonthISO(dt.getFullYear(), dt.getMonth() + 1);
}

/** Current billing month (window containing today). */
export function billingCurrentMonthISO(): string {
  return billingMonthForDay(todayISO());
}

/** "Aug 17 - Sep 16 2026" — range-only billing label. */
export function formatBillingLabel(ym: string): string {
  const { start, end } = billingWindowForMonth(ym);
  const s = parseDay(start);
  const e = parseDay(end);
  return `${MONTH_SHORT[s.m - 1]} ${s.d} - ${MONTH_SHORT[e.m - 1]} ${e.d} ${e.y}`;
}

/** Inclusive day count between YYYY-MM-DD dates. */
export function inclusiveDayCount(start: string, end: string): number {
  const s = parseDay(start);
  const e = parseDay(end);
  const ms =
    Date.UTC(e.y, e.m - 1, e.d) - Date.UTC(s.y, s.m - 1, s.d);
  return Math.round(ms / 86400000) + 1;
}

/** Full length of a billing window (30 or 31). */
export function billingMonthLength(ym: string): number {
  const { start, end } = billingWindowForMonth(ym);
  return inclusiveDayCount(start, end);
}

/** Elapsed billing days capped at today. */
export function billingElapsedDays(ym: string, today: string = todayISO()): number {
  const { start, end } = billingWindowForMonth(ym);
  const cappedEnd = end < today ? end : today;
  return inclusiveDayCount(start, cappedEnd);
}

export function shiftDay(iso: string, delta: number): string {
  const { y, m, d } = parseDay(iso);
  const dt = new Date(y, m - 1, d + delta);
  return toDayISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function shiftMonth(ym: string, delta: number): string {
  const { y, m } = parseMonth(ym);
  const dt = new Date(y, m - 1 + delta, 1);
  return toMonthISO(dt.getFullYear(), dt.getMonth() + 1);
}
