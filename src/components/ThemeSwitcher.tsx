import { useEffect, useState } from "react";

export type Theme = "dark" | "tokyo-storm" | "mocha" | "dracula";

const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "tokyo-storm", label: "Tokyo Storm" },
  { id: "mocha", label: "Mocha" },
  { id: "dracula", label: "Dracula" },
];

const KEY = "solar-tracker-theme";

export function getInitialTheme(): Theme {
  const s = localStorage.getItem(KEY) as Theme | null;
  if (s && THEMES.some((t) => t.id === s)) return s;
  return "tokyo-storm";
}

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return (
    <div
      className="seg grid grid-cols-4 gap-1 p-1 w-full min-w-0"
      role="group"
      aria-label="Theme"
    >
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          aria-pressed={theme === t.id}
          title={t.label}
          className="px-1 sm:px-2 py-2 rounded-lg text-xs sm:text-sm font-semibold w-full min-w-0 truncate whitespace-nowrap transition-colors"
          style={{
            background: theme === t.id ? "var(--text)" : "transparent",
            color: theme === t.id ? "var(--bg)" : "var(--muted)",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
