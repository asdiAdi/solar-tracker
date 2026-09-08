/**
 * Solar Tracker central config.
 */
const envLat = Number(import.meta.env.VITE_LAT)
const envLon = Number(import.meta.env.VITE_LON)
const envTz = import.meta.env.VITE_TIMEZONE as string | undefined

export const CONFIG = {
  APP_NAME: 'Solar Tracker',
  API_BASE_URL: '/mock',

  // defaults to manila
  LAT: envLat ?? 14.5995,
  LON: envLon ?? 120.9842,
  TIMEZONE: envTz ?? "Asia/Manila",
  INVERTER_KW: 6,
  SYSTEM_KWP: 6,

  BATTERY_AH: 660,
  BATTERY_VOLTAGE: 12,
  get BATTERY_KWH() {
    return (this.BATTERY_AH * this.BATTERY_VOLTAGE) / 1000
  },

  // Single flat grid rate
  GRID_PHP_PER_KWH: 12.0,

  // Billing month offset: 0 = 1st-31st, e.g. 15 = 15th-14th
  BILLING_DAY_OFFSET: 0,
} as const

export type AppConfig = typeof CONFIG
