import type { EnergyTotals } from '../lib/types'
import { kwhParts } from '../lib/format'

export default function TotalsCards({ energy, label }: { energy: EnergyTotals; label: string }) {
  const items = [
    { t: 'Generated', v: energy.generated_kwh },
    { t: 'Home use', v: energy.consumed_kwh },
    { t: 'Grid import', v: energy.grid_import_kwh },
  ]
  return (
    <section aria-label={`${label} energy totals`} className="card p-5">
      <div className="eyebrow mb-3">Energy Data</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {items.map((i) => {
          const p = kwhParts(i.v)
          return (
            <div key={i.t} className="rounded-xl p-4 text-center" style={{ background: 'var(--chip)' }}>
              <div className="text-sm font-semibold muted">{i.t}</div>
              <div className="med-number mt-1">{p.value}<span className="unit">{p.unit}</span></div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
