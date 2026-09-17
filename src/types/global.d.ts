interface LiveValues {
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

interface CostTotals {
  consumed_php: number;
  bypass_php: number;
  solar_php: number;
  net_php: number;
}

interface LiveResponse {
  timestamp: string;
  live: LiveValues;
  elec_rate: number | null;
}

interface PeriodResponse {
  timestamp: string;
  energy: EnergyTotals;
  cost: CostTotals;
  elec_rate: number | null;
}

type Period = "day" | "month" | "year";

const NA = Number.NaN;
