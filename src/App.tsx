import { useCallback, useEffect, useMemo, useState } from "react";
import { CONFIG } from "./config";
import { getLive, getPeriod } from "./lib/api";
import { currentMonthISO, currentYear, todayISO } from "./lib/date";
import ThemeSwitcher, { getInitialTheme } from "./components/ThemeSwitcher";
import PeriodTabs from "./components/PeriodTabs";
import DateSelector from "./components/DateSelector";
import LiveCards from "./components/LiveCards";
import BypassUpdatePage from "./components/BypassUpdatePage";
import RateUpdatePage from "./components/RateUpdatePage";
import TotalsCards from "./components/TotalsCards";
import CostCards from "./components/CostCards";
import ForecastCard from "./components/ForecastCard";

const NA = Number.NaN;

const DEFAULT_LIVE: LiveValues = {
  solar_w: NA,
  home_w: NA,
  grid_w: NA,
  battery_w: NA,
  battery_soc_pct: NA,
};

const DEFAULT_ENERGY: EnergyTotals = {
  generated_kwh: NA,
  consumed_kwh: NA,
  grid_import_kwh: NA,
  grid_export_kwh: NA,
  bypass_kwh: NA,
};

const DEFAULT_COST: CostTotals = {
  consumed_php: NA,
  bypass_php: NA,
  solar_php: NA,
  net_php: NA,
  rate_php_per_kwh: null,
};

const ROUTES: Record<string, React.ComponentType> = {
  "/bypass-update": BypassUpdatePage,
  "/rate-update": RateUpdatePage,
};

const keyFor = (kind: Period, value: string) => `${kind}:${value}`;

const currentKeys = () => ({
  day: keyFor("day", todayISO()),
  month: keyFor("month", currentMonthISO()),
  year: keyFor("year", String(currentYear())),
});

const PERIOD_LABEL: Record<Period, (selected: string) => string> = {
  day: (selected) => (selected === todayISO() ? "Today" : selected),
  month: (selected) =>
    selected === currentMonthISO() ? "This month" : selected,
  year: () => String(currentYear()),
};

const NET_LABEL: Record<Period, string> = {
  day: "Today's net",
  month: "Month net",
  year: "Year net",
};

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const Route = ROUTES[path];
  return Route ? <Route /> : <MainApp />;
}

function MainApp() {
  const [period, setPeriod] = useState<Period>("day");
  const [day, setDay] = useState(todayISO());
  const [month, setMonth] = useState(currentMonthISO());
  const [year, setYear] = useState(String(currentYear()));
  const [data, setData] = useState<Record<string, PeriodResponse>>({});
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Record<string, number>>({});

  useEffect(() => {
    document.documentElement.dataset.theme = getInitialTheme();
  }, []);

  const dateKey = period === "day" ? day : period === "month" ? month : year;
  const cacheKey = keyFor(period, dateKey);

  const fetchLive = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await getLive(signal);
      if (signal?.aborted) return;
      setLive(r);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
    }
  }, []);

  const fetchPeriod = useCallback(
    async (kind: Period, key: string, signal?: AbortSignal) => {
      setPending((p) => ({ ...p, [key]: (p[key] ?? 0) + 1 }));
      try {
        setError(null);
        const dateArg = key.slice(key.indexOf(":") + 1);
        const r = await getPeriod(kind, dateArg, signal);
        if (signal?.aborted) return;
        setData((d) => ({ ...d, [key]: r }));
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setError(String(e));
      } finally {
        setPending((p) => {
          const remaining = (p[key] ?? 1) - 1;
          if (remaining <= 0) {
            const { [key]: _, ...rest } = p;
            return rest;
          }
          return { ...p, [key]: remaining };
        });
      }
    },
    [],
  );

  // autofetch live every 5 minutes
  useEffect(() => {
    const ctrl = new AbortController();
    void fetchLive(ctrl.signal);
    const id = setInterval(
      () => {
        void fetchLive();
      },
      5 * 60 * 1000,
    );
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [fetchLive]);

  useEffect(() => {
    const ctrl = new AbortController();
    void fetchPeriod(period, cacheKey, ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateKey]);

  useEffect(() => {
    const ctrl = new AbortController();
    const keys = currentKeys();
    if (period === "day") {
      void fetchPeriod("day", keys.day, ctrl.signal);
    } else if (period === "month") {
      void fetchPeriod("day", keys.day, ctrl.signal);
      void fetchPeriod("month", keys.month, ctrl.signal);
    } else {
      void fetchPeriod("year", keys.year, ctrl.signal);
    }
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const keys = currentKeys();
      const jobs: Promise<unknown>[] = [
        fetchLive(),
        fetchPeriod(period, cacheKey),
      ];

      if (period === "day") {
        if (keys.day !== cacheKey) jobs.push(fetchPeriod("day", keys.day));
      } else if (period === "month") {
        jobs.push(fetchPeriod("day", keys.day));
        if (keys.month !== cacheKey)
          jobs.push(fetchPeriod("month", keys.month));
      } else if (keys.year !== cacheKey) {
        jobs.push(fetchPeriod("year", keys.year));
      }

      await Promise.all(jobs);
    } finally {
      setRefreshing(false);
    }
  }, [fetchLive, fetchPeriod, period, cacheKey]);

  const keys = useMemo(currentKeys, [dateKey]);
  const cur = data[cacheKey] ?? null;
  const dayData = data[keys.day] ?? null;
  const monthData = data[keys.month] ?? null;
  const yearData = data[keys.year] ?? null;

  const liveValues = live?.live ?? DEFAULT_LIVE;
  const energy = cur?.energy ?? DEFAULT_ENERGY;
  const cost = cur?.cost ?? DEFAULT_COST;
  const label = PERIOD_LABEL[period](dateKey);
  const netLabel = NET_LABEL[period];

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
              <h1 className="text-xl font-bold tracking-tight leading-none">
                {CONFIG.APP_NAME}
              </h1>
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
          elecRate={live?.elec_rate ?? null}
        />
      </div>
    </div>
  );
}
