import type { Theme } from "./ThemeSwitcher";

export default function PeriodTabs({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  const tabs: { id: Period; label: string }[] = [
    { id: "day", label: "Day" },
    { id: "month", label: "Month" },
    { id: "year", label: "Year" },
  ];
  return (
    <div
      className="seg grid grid-cols-3 gap-1 p-1 w-full"
      role="tablist"
      aria-label="Period"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={period === t.id}
          onClick={() => onChange(t.id)}
          className="py-2.5 rounded-lg text-base font-semibold transition-colors"
          style={{
            background: period === t.id ? "var(--text)" : "transparent",
            color: period === t.id ? "var(--bg)" : "var(--muted)",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// re-export for App default-theme typing compat
export type { Theme };
