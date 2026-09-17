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
  system_loss_kwh: number;
  bypass_kwh: number;
}

interface ManualUpdate {
  mm: string; // YYYY-MM billing month
  rate: number; // ₱/kWh
  bypass_kwh: number; // final bypass kWh for the billing window
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
