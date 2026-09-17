import { useState } from "react";
import CalendarModal from "./CalendarModal";
import {
  MIN_MONTH_ISO,
  MIN_SELECTABLE_DAY_ISO,
  MIN_YEAR,
  billingCurrentMonthISO,
  currentYear,
  formatBillingLabel,
  formatFullDay,
  shiftDay,
  shiftMonth,
  todayISO,
} from "../lib/date";

export default function DateSelector({
  period,
  day,
  month,
  year,
  onDay,
  onMonth,
  onYear,
}: {
  period: Period;
  day: string;
  month: string;
  year: string;
  onDay: (v: string) => void;
  onMonth: (v: string) => void;
  onYear: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const btn =
    "px-2 sm:px-3 py-2 rounded-lg text-sm sm:text-base font-semibold shrink-0 transition-colors";
  const ghost = { color: "var(--muted)" } as const;

  const label =
    period === "day"
      ? formatFullDay(day)
      : period === "month"
        ? formatBillingLabel(month)
        : year;

  const atDayMax = day >= todayISO();
  const atMonthMax = month >= billingCurrentMonthISO();
  const atYearMax = Number(year) >= currentYear();

  const atDayMin = day <= MIN_SELECTABLE_DAY_ISO;
  const atMonthMin = month <= MIN_MONTH_ISO;
  const atYearMin = Number(year) <= MIN_YEAR;

  return (
    <>
      <div className="seg flex justify-between items-center p-1 w-full">
        {period === "day" && (
          <>
            <button
              className={btn}
              style={{ ...ghost, opacity: atDayMin ? 0.3 : 1 }}
              onClick={() => onDay(shiftDay(day, -1))}
              disabled={atDayMin}
              aria-label="Previous day"
            >
              ‹
            </button>
            <CalendarTrigger
              label={label}
              onOpen={() => setOpen(true)}
              ariaLabel="Select day"
            />
            <button
              className={btn}
              style={{ ...ghost, opacity: atDayMax ? 0.3 : 1 }}
              onClick={() => onDay(shiftDay(day, 1))}
              disabled={atDayMax}
              aria-label="Next day"
            >
              ›
            </button>
          </>
        )}
        {period === "month" && (
          <>
            <button
              className={btn}
              style={{ ...ghost, opacity: atMonthMin ? 0.3 : 1 }}
              onClick={() => onMonth(shiftMonth(month, -1))}
              disabled={atMonthMin}
              aria-label="Previous month"
            >
              ‹
            </button>
            <CalendarTrigger
              label={label}
              onOpen={() => setOpen(true)}
              ariaLabel="Select month"
            />
            <button
              className={btn}
              style={{ ...ghost, opacity: atMonthMax ? 0.3 : 1 }}
              onClick={() => onMonth(shiftMonth(month, 1))}
              disabled={atMonthMax}
              aria-label="Next month"
            >
              ›
            </button>
          </>
        )}
        {period === "year" && (
          <>
            <button
              className={btn}
              style={{ ...ghost, opacity: atYearMin ? 0.3 : 1 }}
              onClick={() => onYear(String(Number(year) - 1))}
              disabled={atYearMin}
              aria-label="Previous year"
            >
              ‹
            </button>
            <CalendarTrigger
              label={label}
              onOpen={() => setOpen(true)}
              ariaLabel="Select year"
            />
            <button
              className={btn}
              style={{ ...ghost, opacity: atYearMax ? 0.3 : 1 }}
              onClick={() => onYear(String(Number(year) + 1))}
              disabled={atYearMax}
              aria-label="Next year"
            >
              ›
            </button>
          </>
        )}
      </div>

      {open && (
        <CalendarModal
          mode={period}
          day={day}
          month={month}
          year={year}
          onPickDay={onDay}
          onPickMonth={onMonth}
          onPickYear={onYear}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CalendarTrigger({
  label,
  onOpen,
  ariaLabel,
}: {
  label: string;
  onOpen: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onOpen}
      className="min-w-0 flex-1 flex items-center justify-center gap-2 px-2 sm:px-3 py-2 rounded-lg text-sm sm:text-base font-semibold bg-transparent outline-none cursor-pointer"
      style={{ color: "var(--text)" }}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
