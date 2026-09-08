import { CONFIG } from '../config'

/** Billing period with day-offset. offset=0 => 1st-31st. offset=15 => 15th-14th. */
export function billingMonthRange(ref = new Date(), offset = CONFIG.BILLING_DAY_OFFSET) {
  const y = ref.getFullYear()
  const m = ref.getMonth()
  // If today < offset day, we belong to previous billing month
  let start: Date
  let end: Date
  if (offset <= 1) {
    start = new Date(y, m, 1)
    end = new Date(y, m + 1, 0)
  } else {
    if (ref.getDate() >= offset) {
      start = new Date(y, m, offset)
      end = new Date(y, m + 1, offset - 1)
    } else {
      start = new Date(y, m - 1, offset)
      end = new Date(y, m, offset - 1)
    }
  }
  return { start, end }
}

export function daysLeftInBillingMonth(ref = new Date()) {
  const { end } = billingMonthRange(ref)
  const ms = end.getTime() - ref.getTime()
  return Math.max(0, Math.ceil(ms / 86400000))
}

export function daysInBillingMonth(ref = new Date()) {
  const { start, end } = billingMonthRange(ref)
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1
}
