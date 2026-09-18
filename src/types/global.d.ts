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
  system_loss_kwh: number;
  bypass_kwh: number | null;
}

interface CostTotals {
  consumed_php: number;
  bypass_php: number | null;
  solar_php: number;
  system_loss_php: number;
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
