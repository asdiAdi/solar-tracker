import { useEffect, useState } from "react";
import {
  MONTH_NAMES,
  billingCurrentMonthISO,
  currentMonthISO,
  currentYear,
  parseDay,
  parseMonth,
  toDayISO,
  toMonthISO,
  todayISO,
} from "../lib/date";

interface CalendarModalProps {
  mode: Period;
  day: string;
  month: string;
  year: string;
  onPickDay: (isoDay: string) => void;
  onPickMonth: (ym: string) => void;
  onPickYear: (y: string) => void;
  onClose: () => void;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function CalendarModal({
  mode,
  day,
  month,
  year,
  onPickDay,
  onPickMonth,
  onPickYear,
  onClose,
}: CalendarModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card w-full max-w-xs p-4 flex flex-col gap-3"
        style={{ background: "var(--card)", color: "var(--text)" }}
        role="dialog"
        aria-modal="true"
        aria-label={
          mode === "day"
            ? "Pick a day"
            : mode === "month"
              ? "Pick a month"
              : "Pick a year"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-base font-bold">
            {mode === "day"
              ? "Select day"
              : mode === "month"
                ? "Select month"
                : "Select year"}
          </span>
          <button
            className="px-2 py-1 rounded-lg text-base font-semibold"
            style={{ color: "var(--muted)" }}
            onClick={onClose}
            aria-label="Close calendar"
          >
            ✕
          </button>
        </div>

        {mode === "day" && (
          <DayGrid
            selected={day}
            onPick={(v) => {
              onPickDay(v);
              onClose();
            }}
          />
        )}
        {mode === "month" && (
          <MonthGrid
            selected={month}
            onPick={(v) => {
              onPickMonth(v);
              onClose();
            }}
          />
        )}
        {mode === "year" && (
          <YearGrid
            selected={year}
            onPick={(v) => {
              onPickYear(v);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function navBtnStyle(disabled?: boolean) {
  return {
    color: "var(--muted)",
    opacity: disabled ? 0.3 : 1,
  } as const;
}

const cellBase =
  "rounded-lg text-base font-semibold py-2 px-1 text-center transition-colors disabled:cursor-not-allowed";

/* ---------- Day: full month grid, future days disabled (max = today) ---------- */
function DayGrid({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (v: string) => void;
}) {
  const init = parseDay(selected);
  const [viewY, setViewY] = useState(init.y);
  const [viewM, setViewM] = useState(init.m);
  const today = todayISO();
  const curYm = currentMonthISO();
  const viewYm = toMonthISO(viewY, viewM);
  const atMaxMonth = viewYm >= curYm;

  const firstWeekday = new Date(viewY, viewM - 1, 1).getDay();
  const daysInMonth = new Date(viewY, viewM, 0).getDate();

  const step = (d: number) => {
    const dt = new Date(viewY, viewM - 1 + d, 1);
    const ny = dt.getFullYear();
    const nm = dt.getMonth() + 1;
    if (toMonthISO(ny, nm) > curYm) return;
    setViewY(ny);
    setViewM(nm);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          className="px-3 py-1.5 rounded-lg text-lg font-bold"
          style={navBtnStyle()}
          onClick={() => step(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-base font-bold">
          {MONTH_NAMES[viewM - 1]} {viewY}
        </span>
        <button
          className="px-3 py-1.5 rounded-lg text-lg font-bold"
          style={navBtnStyle(atMaxMonth)}
          onClick={() => step(1)}
          disabled={atMaxMonth}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            className="text-center text-xs font-bold"
            style={{ color: "var(--muted)" }}
          >
            {w}
          </span>
        ))}
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const d = i + 1;
          const iso = toDayISO(viewY, viewM, d);
          const isFuture = iso > today;
          const isSel = iso === selected;
          return (
            <button
              key={d}
              className={cellBase}
              disabled={isFuture}
              onClick={() => onPick(iso)}
              aria-label={`Pick ${iso}`}
              aria-pressed={isSel}
              style={
                isSel
                  ? { background: "var(--accent)", color: "#fff", opacity: 1 }
                  : isFuture
                    ? { color: "var(--muted)", opacity: 0.3 }
                    : { color: "var(--text)" }
              }
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Month: 12 months of a year, future months disabled ---------- */
function MonthGrid({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (v: string) => void;
}) {
  const init = parseMonth(selected);
  const [viewY, setViewY] = useState(init.y);
  const cy = currentYear();
  const curYm = billingCurrentMonthISO();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          className="px-3 py-1.5 rounded-lg text-lg font-bold"
          style={navBtnStyle()}
          onClick={() => setViewY((y) => y - 1)}
          aria-label="Previous year"
        >
          ‹
        </button>
        <span className="text-base font-bold">{viewY}</span>
        <button
          className="px-3 py-1.5 rounded-lg text-lg font-bold"
          style={navBtnStyle(viewY >= cy)}
          onClick={() => setViewY((y) => Math.min(cy, y + 1))}
          disabled={viewY >= cy}
          aria-label="Next year"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTH_NAMES.map((name, i) => {
          const m = i + 1;
          const ym = toMonthISO(viewY, m);
          const isFuture = ym > curYm;
          const isSel = ym === selected;
          return (
            <button
              key={name}
              className={cellBase}
              disabled={isFuture}
              onClick={() => onPick(ym)}
              aria-pressed={isSel}
              style={
                isSel
                  ? { background: "var(--accent)", color: "#fff", opacity: 1 }
                  : isFuture
                    ? { color: "var(--muted)", opacity: 0.3 }
                    : { color: "var(--text)" }
              }
            >
              {name.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Year: grid of years, future years disabled (max = current year) ---------- */
const PAGE = 12;
function YearGrid({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (v: string) => void;
}) {
  const cy = currentYear();
  const selY = Number(selected) || cy;
  const [base, setBase] = useState(
    () => Math.min(selY, cy) - (Math.min(selY, cy) % PAGE),
  );
  const years = Array.from({ length: PAGE }, (_, i) => base + i);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          className="px-3 py-1.5 rounded-lg text-lg font-bold"
          style={navBtnStyle()}
          onClick={() => setBase((b) => b - PAGE)}
          aria-label="Previous years"
        >
          ‹
        </button>
        <span className="text-base font-bold">
          {base} – {Math.min(base + PAGE - 1, cy)}
        </span>
        <button
          className="px-3 py-1.5 rounded-lg text-lg font-bold"
          style={navBtnStyle(base + PAGE > cy)}
          onClick={() => setBase((b) => b + PAGE)}
          disabled={base + PAGE > cy}
          aria-label="Next years"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {years.map((y) => {
          if (y > cy) return <span key={y} />;
          const isSel = String(y) === String(selected);
          return (
            <button
              key={y}
              className={cellBase}
              onClick={() => onPick(String(y))}
              aria-pressed={isSel}
              style={
                isSel
                  ? { background: "var(--accent)", color: "#fff" }
                  : { color: "var(--text)" }
              }
            >
              {y}
            </button>
          );
        })}
      </div>
    </div>
  );
}
