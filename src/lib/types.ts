export interface LiveValues {
  solar_w: number
  home_w: number
  grid_w: number
  battery_w: number
  battery_soc_pct: number
}

export interface EnergyTotals {
  generated_kwh: number
  consumed_kwh: number
  grid_import_kwh: number
  grid_export_kwh: number
  bypass_kwh: number
}

export interface CostTotals {
  consumed_php: number
  bypass_php: number
  solar_php: number
  net_php: number
}

export interface LiveResponse {
  timestamp: string
  live: LiveValues
}

export interface PeriodResponse {
  timestamp: string
  energy: EnergyTotals
  cost: CostTotals
}

export type Period = 'day' | 'month' | 'year'

export const NA = Number.NaN

export const DEFAULT_LIVE: LiveValues = {
  solar_w: NA,
  home_w: NA,
  grid_w: NA,
  battery_w: NA,
  battery_soc_pct: NA,
}

export const DEFAULT_ENERGY: EnergyTotals = {
  generated_kwh: NA,
  consumed_kwh: NA,
  grid_import_kwh: NA,
  grid_export_kwh: NA,
  bypass_kwh: NA,
}

export const DEFAULT_COST: CostTotals = {
  consumed_php: NA,
  bypass_php: NA,
  solar_php: NA,
  net_php: NA,
}
