import { isNA, kwParts } from "../lib/format";
import { CONFIG } from "../config";
import LoadingSpinner from "./LoadingSpinner";

function Power({
  v,
  tone,
  loading,
}: {
  v: number;
  tone?: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <span
        className="big-number big-number--compact"
        style={{ color: "var(--muted)" }}
        aria-busy="true"
      >
        <LoadingSpinner />
      </span>
    );
  }
  const p = kwParts(v);
  const missing = isNA(v);
  return (
    <span
      className="big-number big-number--compact"
      style={{ color: missing ? "var(--bad)" : tone }}
    >
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
  loading,
}: {
  title: string;
  value: number;
  caption: string;
  tone?: string;
  status?: string;
  loading?: boolean;
}) {
  return (
    <div
      className="card px-1.5 py-2 sm:px-5 sm:py-4 flex flex-col items-center gap-0.5 sm:gap-1 min-h-0 sm:min-h-[132px] justify-center text-center min-w-0"
      aria-busy={loading || undefined}
    >
      <div className="eyebrow eyebrow--compact max-w-full truncate">{title}</div>
      <Power v={value} tone={tone} loading={loading} />
      <div className="text-[0.65rem] sm:text-sm muted font-medium truncate max-w-full leading-tight">{caption}</div>
    </div>
  );
}

export default function LiveCards({
  live,
  loading = false,
}: {
  live: LiveValues;
  loading?: boolean;
}) {
  const socMissing = !loading && isNA(live.battery_soc_pct);
  const battMissing = !loading && isNA(live.battery_w);
  const charging = (live.battery_w ?? 0) >= 0;
  const pct = socMissing ? 0 : Math.max(0, Math.min(100, live.battery_soc_pct));
  const roundedW = battMissing ? 0 : Math.round(live.battery_w);
  const signedW = roundedW > 0 ? `+${roundedW} W` : `${roundedW} W`;
  function fmtDuration(totalSecs: number): string {
    const totalMins = Math.max(1, Math.round(totalSecs / 60));
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function batteryEstimate(): string | null {
    if (loading || socMissing || battMissing) return null;

    const netW = roundedW;
    const netCharging = netW >= 0;
    const netAbs = Math.abs(netW);
    if (pct >= CONFIG.BATTERY_FULL_PCT) return "Full";
    if (!netCharging && pct <= CONFIG.BATTERY_RESERVE_PCT) return "At reserve";
    if (netAbs < 50) return "Idle";
    const delta = netCharging
      ? CONFIG.BATTERY_FULL_PCT - pct
      : pct - CONFIG.BATTERY_RESERVE_PCT;
    if (delta <= 0) return netCharging ? "Full" : "At reserve";
    const remainingKwh = (CONFIG.BATTERY_KWH * delta) / 100;
    const secs = (remainingKwh * 1000 * 3600) / netAbs;
    const dur = fmtDuration(secs);
    return netCharging ? `${dur} to full` : `${dur} left`;
  }

  const estimate = batteryEstimate();

  return (
    <section aria-label="Right now" className="flex flex-col gap-4">
      <div className="card p-5 w-full" aria-busy={loading || undefined}>
        <div className="flex items-center justify-between gap-3">
          <div className="eyebrow">Battery</div>
          <div
            className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{
              background: "var(--chip)",
              color: loading
                ? "var(--muted)"
                : socMissing
                  ? "var(--bad)"
                  : charging
                    ? "var(--good)"
                    : "var(--warn)",
            }}
          >
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <LoadingSpinner label="Battery loading" /> Loading
              </span>
            ) : socMissing ? (
              "● N/A"
            ) : charging ? (
              "● Charging"
            ) : (
              "● Discharging"
            )}
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-2">
          <div className="flex items-baseline gap-2">
            <span
              className="big-number"
              style={
                loading
                  ? { color: "var(--muted)" }
                  : socMissing
                    ? { color: "var(--bad)" }
                    : undefined
              }
            >
              {loading ? (
                <LoadingSpinner />
              ) : socMissing ? (
                "N/A"
              ) : (
                <>
                  {pct}
                  <span className="unit">%</span>
                </>
              )}
            </span>
            <span
              className="text-xs sm:text-sm muted font-medium"
              style={
                loading
                  ? undefined
                  : battMissing
                    ? { color: "var(--bad)" }
                    : undefined
              }
            >
              {loading ? (
                <LoadingSpinner label="Battery power loading" />
              ) : battMissing ? (
                "N/A"
              ) : (
                signedW
              )}
            </span>
          </div>
          {estimate != null && (
            <span className="text-xs sm:text-sm muted font-medium ml-auto text-right">
              {estimate}
            </span>
          )}
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
            style={{
              width: `${loading ? 0 : pct}%`,
              background: loading
                ? "var(--muted)"
                : socMissing
                  ? "var(--bad)"
                  : "var(--good)",
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <EqualCard
          title="Solar"
          value={live.solar_w}
          caption="generating"
          tone="var(--good)"
          loading={loading}
        />
        <EqualCard
          title="Home"
          value={live.home_w}
          caption="consuming"
          tone="var(--accent)"
          loading={loading}
        />
        <EqualCard
          title="Grid"
          value={isNA(live.grid_w) ? live.grid_w : Math.abs(live.grid_w)}
          caption={"importing"}
          status={"importing"}
          tone={"var(--warn)"}
          loading={loading}
        />
      </div>
    </section>
  );
}
