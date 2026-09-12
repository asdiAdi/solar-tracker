import { useState } from "react";
import { postRateUpdate } from "../lib/api";
import { MONTH_NAMES, currentYear } from "../lib/date";

const thisYear = currentYear();
const YEARS = Array.from({ length: 8 }, (_, i) => String(thisYear - 5 + i));

export default function RateUpdatePage() {
  const [year, setYear] = useState(String(thisYear));
  const [month, setMonth] = useState(
    String(new Date().getMonth() + 1).padStart(2, "0"),
  );
  const [rate, setRate] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [sending, setSending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    const v = Number(rate);
    if (!Number.isFinite(v) || v <= 0) {
      setIsError(true);
      setStatus("Enter a rate in ₱/kWh greater than 0.");
      return;
    }
    setSending(true);
    try {
      const r = await postRateUpdate(year, month, v, password);
      setIsError(false);
      setStatus(`Saved ₱${r.rate}/kWh for ${r.month}.`);
      setRate("");
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
            Electricity Rate Update
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
            Saving overwrites the existing rate for that month. Past periods
            keep their own month&apos;s rate; missing months fall back to the
            latest rate.
          </p>
        </header>
        <form
          onSubmit={onSubmit}
          className="card p-5 flex flex-col gap-4"
          aria-label="Electricity rate update form"
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
            {sending ? "Saving…" : `Save rate for ${year}-${month}`}
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
