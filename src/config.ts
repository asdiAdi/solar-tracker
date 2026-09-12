const envLat = Number(import.meta.env.VITE_LAT);
const envLon = Number(import.meta.env.VITE_LON);
const envTz = import.meta.env.VITE_TIMEZONE as string;
const envApiBase = import.meta.env.VITE_API_BASE_URL as string;
const envApiKey = import.meta.env.VITE_X_API_KEY as string;

export const CONFIG = {
  APP_NAME: "Solar Tracker",
  API_BASE_URL: envApiBase.replace(/\/$/, ""),
  API_KEY: envApiKey,

  LAT: envLat ?? 14.5995,
  LON: envLon ?? 120.9842,
  TIMEZONE: envTz ?? "Asia/Manila",
  INVERTER_KW: 6,
  SYSTEM_KWP: 6,

  BATTERY_AH: 660,
  BATTERY_VOLTAGE: 52,
  BATTERY_RESERVE_PCT: 20,
  BATTERY_FULL_PCT: 100,
  get BATTERY_KWH() {
    return (this.BATTERY_AH * this.BATTERY_VOLTAGE) / 1000;
  },
} as const;

export type AppConfig = typeof CONFIG;
