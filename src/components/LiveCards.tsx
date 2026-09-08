import type { LiveValues } from '../lib/types'
import { kwParts } from '../lib/format'

function Power({ v, tone }: { v: number; tone?: string }) {
  const p = kwParts(v)
  return (
    <span className="big-number" style={tone ? { color: tone } : undefined}>
      {p.value}
      <span className="unit">{p.unit}</span>
    </span>
  )
}

function EqualCard({ title, value, caption, tone, status }: {
  title: string; value: number; caption: string; tone?: string; status?: string
}) {
  return (
    <div className="card px-5 py-4 flex flex-col items-center gap-1 min-h-[132px] justify-center text-center">
      <div className="eyebrow">{title}</div>
      <Power v={value} tone={tone} />
      <div className="text-sm muted font-medium">{status ?? caption}</div>
    </div>
  )
}

export default function LiveCards({ live }: { live: LiveValues }) {
  const importing = live.grid_kw >= 0
  const charging = live.battery_kw >= 0
  const pct = Math.max(0, Math.min(100, live.battery_soc_pct))

  return (
    <section aria-label="Right now" className="flex flex-col gap-4">
      <div className="card p-5 w-full">
        <div className="flex items-center justify-between gap-3">
          <div className="eyebrow">Battery</div>
          <div
            className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ background: 'var(--chip)', color: charging ? 'var(--good)' : 'var(--warn)' }}
          >
            {charging ? '● Charging' : '● Discharging'}
          </div>
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <span className="big-number">{pct}<span className="unit">%</span></span>
          <span className="text-sm muted font-medium">
            {Math.abs(live.battery_kw).toFixed(2)} kW {charging ? 'in' : 'out'}
          </span>
        </div>
        <div
          className="w-full h-2.5 rounded-full mt-3 overflow-hidden"
          style={{ background: 'var(--chip)' }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Battery charge"
        >
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--good)' }} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <EqualCard title="Solar" value={live.solar_kw} caption="generating" tone="var(--warn)" />
        <EqualCard title="Home" value={live.home_kw} caption="consuming" tone="var(--accent)" />
        <EqualCard
          title="Grid"
          value={Math.abs(live.grid_kw)}
          caption={importing ? 'importing' : 'exporting'}
          status={importing ? 'importing' : 'exporting'}
          tone={importing ? 'var(--bad)' : 'var(--good)'}
        />
      </div>
    </section>
  )
}
