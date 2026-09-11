import { useCallback, useEffect, useState } from "react";
import { CONFIG } from "./config";
import { getLive, getPeriod } from "./lib/api";
import { currentMonthISO, currentYear, todayISO } from "./lib/date";
import type { LiveResponse, Period, PeriodResponse } from "./lib/types";
import { DEFAULT_COST, DEFAULT_ENERGY, DEFAULT_LIVE } from "./lib/types";
import ThemeSwitcher, { getInitialTheme } from "./components/ThemeSwitcher";
import PeriodTabs from "./components/PeriodTabs";
import DateSelector from "./components/DateSelector";
import LiveCards from "./components/LiveCards";
import BypassUpdatePage from "./components/BypassUpdatePage";
import TotalsCards from "./components/TotalsCards";
import CostCards from "./components/CostCards";
import ForecastCard from "./components/ForecastCard";

// Backend is the single source of truth for caching (Dynamo TTLs + Cache-Control).
// Frontend does plain fetches,no localStorage/memory TTL checks.
const LIVE_POLL_MS = 5 * 60_000;

const isoDay = () => todayISO();
const isoMonth = () => currentMonthISO();
const isoYear = () => String(currentYear());

export default function App() {
  if (
    typeof window !== "undefined" &&
    window.location.pathname === "/bypass-update"
  ) {
    return <BypassUpdatePage />;
  }
  const [period, setPeriod] = useState<Period>("day");
  const [day, setDay] = useState(isoDay());
  const [month, setMonth] = useState(isoMonth());
  const [year, setYear] = useState(isoYear());
  const [data, setData] = useState<Record<string, PeriodResponse>>({});
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Record<string, number>>({});

  useEffect(() => {
    document.documentElement.dataset.theme = getInitialTheme();
  }, []);

  const dateKey = period === "day" ? day : period === "month" ? month : year;
  const cacheKey = `${period}:${dateKey}`;

  const fetchLive = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await getLive(signal);
      if (signal?.aborted) return;
      setLive(r);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      // keep stale live on error (caller decides whether to surface)
    }
  }, []);

  const fetchPeriod = useCallback(
    async (kind: Period, key: string, signal?: AbortSignal) => {
      setPending((p) => ({ ...p, [key]: (p[key] ?? 0) + 1 }));
      try {
        setError(null);
        const dateArg = key.split(":").slice(1).join(":");
        const r = await getPeriod(kind, dateArg, signal);
        if (signal?.aborted) return;
        setData((d) => ({ ...d, [key]: r }));
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setError(String(e));
      } finally {
        setPending((p) => {
          const n = (p[key] ?? 1) - 1;
          if (n <= 0) {
            const { [key]: _removed, ...rest } = p;
            return rest;
          }
          return { ...p, [key]: n };
        });
      }
    },
    [],
  );

  // Live: fetch once on mount, then every 5 min
  useEffect(() => {
    const ctrl = new AbortController();
    void fetchLive(ctrl.signal);
    const t = setInterval(() => {
      void fetchLive();
    }, LIVE_POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, [fetchLive]);

  // Period: fetch active period/dateKey on change.
  useEffect(() => {
    const ctrl = new AbortController();
    void fetchPeriod(period, cacheKey, ctrl.signal);
    return () => {
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateKey]);

  useEffect(() => {
    const ctrl = new AbortController();
    const todayKey = `day:${isoDay()}`;
    const monthKey = `month:${isoMonth()}`;
    const yearKey = `year:${isoYear()}`;
    if (period === "day") {
      void fetchPeriod("day", todayKey, ctrl.signal);
    } else if (period === "month") {
      void fetchPeriod("day", todayKey, ctrl.signal);
      void fetchPeriod("month", monthKey, ctrl.signal);
    } else {
      void fetchPeriod("year", yearKey, ctrl.signal);
    }
    return () => {
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const jobs: Promise<unknown>[] = [
        fetchLive(),
        fetchPeriod(period, cacheKey),
      ];
      const todayKey = `day:${isoDay()}`;
      const monthKey = `month:${isoMonth()}`;
      const yearKey = `year:${isoYear()}`;
      if (period === "day") {
        if (todayKey !== cacheKey) jobs.push(fetchPeriod("day", todayKey));
      } else if (period === "month") {
        jobs.push(fetchPeriod("day", todayKey));
        if (monthKey !== cacheKey) jobs.push(fetchPeriod("month", monthKey));
      } else {
        if (yearKey !== cacheKey) jobs.push(fetchPeriod("year", yearKey));
      }
      await Promise.all(jobs);
    } finally {
      setRefreshing(false);
    }
  }, [fetchLive, fetchPeriod, period, cacheKey]);

  const cur = data[cacheKey] ?? null;
  const monthData = data[`month:${isoMonth()}`] ?? null;
  const dayData = data[`day:${isoDay()}`] ?? null;
  const yearData = data[`year:${isoYear()}`] ?? null;
  const liveValues = live?.live ?? DEFAULT_LIVE;
  const energy = cur?.energy ?? DEFAULT_ENERGY;
  const cost = cur?.cost ?? DEFAULT_COST;
  const label =
    period === "day"
      ? day === isoDay()
        ? "Today"
        : day
      : period === "month"
        ? month === isoMonth()
          ? "This month"
          : month
        : isoYear();
  const netLabel =
    period === "day"
      ? "Today's net"
      : period === "month"
        ? "Month net"
        : "Year net";

  const isFetchingCur = (pending[cacheKey] ?? 0) > 0;
  const isLiveLoading = live == null;
  const isPeriodLoading = !error && (cur == null || isFetchingCur);
  const isForecastFetching = Object.values(pending).some((n) => n > 0);

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="max-w-2xl mx-auto px-4 pb-12 flex flex-col gap-4">
        <header className="pt-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl" aria-hidden>
                ☀️
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight leading-none">
                  {CONFIG.APP_NAME}
                </h1>
              </div>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh data"
              className="px-3 py-1.5 rounded-lg font-semibold"
              style={{
                background: "var(--chip)",
                color: "var(--text)",
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <ThemeSwitcher />
        </header>

        <LiveCards live={liveValues} loading={isLiveLoading} />

        <div className="flex flex-col gap-2">
          <PeriodTabs period={period} onChange={setPeriod} />
          <DateSelector
            period={period}
            day={day}
            month={month}
            year={year}
            onDay={setDay}
            onMonth={setMonth}
            onYear={setYear}
          />
        </div>

        {error && (
          <div className="card p-4 text-base font-semibold" role="alert">
            Cannot load data: {error}
          </div>
        )}

        <TotalsCards energy={energy} label={label} loading={isPeriodLoading} />
        <CostCards
          cost={cost}
          energy={energy}
          label={label}
          netLabel={netLabel}
          loading={isPeriodLoading}
        />
        <ForecastCard
          period={period}
          day={dayData}
          month={monthData}
          year={yearData}
          fetching={isForecastFetching}
        />
      </div>
    </div>
  );
}
