import { CONFIG } from '../config'

export const php = (n: number) =>
  `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`

export const fmtKw = (n: number) => `${n.toFixed(2)} kW`
export const fmtKwh = (n: number) => `${n.toFixed(1)} kWh`

export const kwParts = (n: number) => ({ value: n.toFixed(2), unit: 'kW' })
export const kwhParts = (n: number) => ({ value: n.toFixed(1), unit: 'kWh' })

export const gridCost = (gridImportKwh: number) =>
  gridImportKwh * CONFIG.GRID_PHP_PER_KWH

export const savedVsGrid = (generatedKwh: number, gridExportKwh: number) => {
  // Savings = self-consumed solar * rate (export ignored for simplicity, no feed-in)
  const selfConsumed = Math.max(0, generatedKwh - gridExportKwh)
  return selfConsumed * CONFIG.GRID_PHP_PER_KWH
}
