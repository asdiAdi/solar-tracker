import { useState } from "react";
import { postMonthlyUpdate } from "../lib/api";
import { MONTH_NAMES, currentYear, formatBillingLabel } from "../lib/date";

const thisYear = currentYear();
const YEARS = Array.from({ length: 8 }, (_, i) => String(thisYear - 5 + i));

export default function MonthlyUpdatePage() {
  const [year, setYear] = useState(String(thisYear));
  const [month, setMonth] = useState(() =>
    String(new Date().getMonth() + 1).padStart(2, "0"),
  );
  const [rate, setRate] = useState("");
  const [bypassKwh, setBypassKwh] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [sending, setSending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    const r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) {
      setIsError(true);
      setStatus("Enter a rate in ₱/kWh greater than 0.");
      return;
    }
    const b = Number(bypassKwh);
    if (!Number.isFinite(b) || b < 0) {
      setIsError(true);
      setStatus("Enter a bypass kWh value >= 0.");
      return;
    }
    if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) {
      setIsError(true);
      setStatus("Enter a valid year between 2000 and 2100.");
      return;
    }
    if (!/^\d{2}$/.test(month) || Number(month) < 1 || Number(month) > 12) {
      setIsError(true);
      setStatus("Enter a valid month.");
      return;
    }
    setSending(true);
    try {
      const res = await postMonthlyUpdate(year, month, r, b, password);
      setIsError(false);
      setStatus(`Saved ₱${res.rate}/kWh + ${res.bypass_kwh}kWh for ${res.month}.`);
      setRate("");
      setBypassKwh("");
      setPassword("");
    } catch (err) {
      setIsError(true);
      setStatus(String(err instanceof Error ? err.message : err));
    } finally {
      setSending(false);
    }
  };

  const inputStyle = {
    background: "var(--chip)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  } as const;

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="max-w-2xl mx-auto px-4 pb-12 flex flex-col gap-4">
        <header className="pt-5">
          <h1 className="text-xl font-bold tracking-tight leading-none">
            Monthly Update
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
            Billing period: rate + bypass for{" "}
            {formatBillingLabel(`${year}-${month}`)}. Saving overwrites the
            existing entry for that billing month.
          </p>
        </header>
        <form
          onSubmit={onSubmit}
          className="card p-5 flex flex-col gap-4"
          aria-label="Monthly update form"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-base font-semibold">Year</span>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="px-3 py-2 rounded-lg"
                style={inputStyle}
                required
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-base font-semibold">Month</span>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2 rounded-lg"
                style={inputStyle}
                required
              >
                {MONTH_NAMES.map((name, i) => {
                  const mm = String(i + 1).padStart(2, "0");
                  return (
                    <option key={mm} value={mm}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-base font-semibold">Rate (₱/kWh)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="px-3 py-2 rounded-lg"
              style={inputStyle}
              placeholder="e.g. 13.50"
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-base font-semibold">
              Bypass kWh for billing window
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={bypassKwh}
              onChange={(e) => setBypassKwh(e.target.value)}
              className="px-3 py-2 rounded-lg"
              style={inputStyle}
              placeholder="e.g. 42.5"
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-base font-semibold">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="px-3 py-2 rounded-lg"
              style={inputStyle}
              required
            />
          </label>
          <button
            type="submit"
            disabled={sending}
            className="px-3 py-2 rounded-lg font-semibold"
            style={{
              background: "var(--chip)",
              color: "var(--text)",
              opacity: sending ? 0.6 : 1,
            }}
          >
            {sending ? "Saving…" : `Save for ${year}-${month}`}
          </button>
          {status && (
            <div
              role={isError ? "alert" : "status"}
              className="text-base font-semibold"
              style={{ color: isError ? "var(--bad)" : "var(--good)" }}
            >
              {status}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
