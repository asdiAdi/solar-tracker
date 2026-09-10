import type { LiveValues } from "../lib/types";
import { isNA, kwParts } from "../lib/format";

function Power({ v, tone }: { v: number; tone?: string }) {
  const p = kwParts(v);
  const missing = isNA(v);
  return (
    <span className="big-number" style={{ color: missing ? "var(--bad)" : tone }}>
      {p.value}
      {p.unit && <span className="unit">{p.unit}</span>}
    </span>
  );
}

function EqualCard({
  title,
  value,
  caption,
  tone,
}: {
  title: string;
  value: number;
  caption: string;
  tone?: string;
  status?: string;
}) {
  return (
    <div className="card px-5 py-4 flex flex-col items-center gap-1 min-h-[132px] justify-center text-center">
      <div className="eyebrow">{title}</div>
      <Power v={value} tone={tone} />
      <div className="text-sm muted font-medium">{caption}</div>
    </div>
  );
}

export default function LiveCards({ live }: { live: LiveValues }) {
  const socMissing = isNA(live.battery_soc_pct);
  const battMissing = isNA(live.battery_w);
  const charging = (live.battery_w ?? 0) >= 0;
  const pct = socMissing ? 0 : Math.max(0, Math.min(100, live.battery_soc_pct));

  return (
    <section aria-label="Right now" className="flex flex-col gap-4">
      <div className="card p-5 w-full">
        <div className="flex items-center justify-between gap-3">
          <div className="eyebrow">Battery</div>
          <div
            className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{
              background: "var(--chip)",
              color: socMissing ? "var(--bad)" : charging ? "var(--good)" : "var(--warn)",
            }}
          >
            {socMissing ? "● N/A" : charging ? "● Charging" : "● Discharging"}
          </div>
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <span className="big-number" style={socMissing ? { color: "var(--bad)" } : undefined}>
            {socMissing ? "N/A" : pct}
            {!socMissing && <span className="unit">%</span>}
          </span>
          <span className="text-sm muted font-medium" style={battMissing ? { color: "var(--bad)" } : undefined}>
            {battMissing ? "N/A" : `${Math.abs(Math.round(live.battery_w))} W ${charging ? "in" : "out"}`}
          </span>
        </div>
        <div
          className="w-full h-2.5 rounded-full mt-3 overflow-hidden"
          style={{ background: "var(--chip)" }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Battery charge"
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: socMissing ? "var(--bad)" : "var(--good)" }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EqualCard
          title="Solar"
          value={live.solar_w}
          caption="generating"
          tone="var(--good)"
        />
        <EqualCard
          title="Home"
          value={live.home_w}
          caption="consuming"
          tone="var(--accent)"
        />
        <EqualCard
          title="Grid"
          value={isNA(live.grid_w) ? live.grid_w : Math.abs(live.grid_w)}
          caption={"importing"}
          status={"importing"}
          tone={"var(--warn)"}
        />
        <EqualCard
          title="Bypass"
          value={0}
          caption={"bypassing"}
          tone={"var(--bad)"}
        />
      </div>
    </section>
  );
}
