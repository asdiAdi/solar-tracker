/**
 * Shared Solar Tracker schema.
 * Your future AWS API Gateway should return this shape so the frontend just works.
 *
 * GET {API_BASE_URL}/live                        -> SolarData (live kW now)
 * GET {API_BASE_URL}/day?date=YYYY-MM-DD         -> SolarData (that day totals)
 * GET {API_BASE_URL}/month?month=YYYY-MM         -> SolarData (billing month totals)
 * GET {API_BASE_URL}/year?year=YYYY              -> SolarData (billing year totals)
 */
export interface LiveValues {
  solar_kw: number       // generated right now
  home_kw: number        // consumption right now
  grid_kw: number        // >0 importing from grid, <0 exporting to grid
  battery_kw: number     // >0 charging, <0 discharging
  battery_soc_pct: number // 0-100
}

export interface EnergyTotals {
  generated_kwh: number
  consumed_kwh: number
  grid_import_kwh: number
  grid_export_kwh: number
}

export interface CostTotals {
  grid_import_php: number
  saved_php: number // vs buying everything from grid
}

export interface SolarData {
  timestamp: string
  live: LiveValues
  energy: EnergyTotals
  cost: CostTotals
}

export type Period = 'day' | 'month' | 'year'
