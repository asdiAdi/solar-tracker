interface SolarmanDataPoint {
  key: string;
  value: string;
}

interface SolarmanLiveResponse {
  dataList?: SolarmanDataPoint[];
}

interface SolarmanHistoricalResponse {
  paramDataList?: { dataList?: SolarmanDataPoint[] }[];
}

interface SolarTotals {
  generated_kwh: number;
  consumed_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
}

interface LiveMetrics {
  solar_w: number;
  home_w: number;
  grid_w: number;
  battery_w: number;
  battery_soc_pct: number;
}

interface EnergyTotals {
  generated_kwh: number;
  consumed_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  bypass_kwh: number;
}

interface ElecRate {
  mm: string;
  rate: number;
}

interface BypassReading {
  iso: string; // YYYY-MM-DD
  day: number; // days since epoch, for arithmetic
  cum: number; // cumulative kWh at that date
}

interface PeriodResult {
  energy: EnergyTotals;
  ts: string;
  ttlSec: number | null;
}

interface CacheRecord<T> {
  pk: string;
  data: T;
  updatedAt: string;
  expiresAt?: number;
}

interface LambdaEvent {
  path?: string;
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
}
