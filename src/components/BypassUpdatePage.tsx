import { useState } from "react";
import { postBypassUpdate } from "../lib/api";

export default function BypassUpdatePage() {
  const [kwh, setKwh] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [sending, setSending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    const v = Number(kwh);
    if (!Number.isFinite(v) || v < 0) {
      setIsError(true);
      setStatus("Enter a cumulative kWh value >= 0.");
      return;
    }
    setSending(true);
    try {
      const r = await postBypassUpdate(v, password);
      setIsError(false);
      setStatus(`Saved ${r.cumulative_kwh} kWh at ${r.recordedAt}.`);
      setKwh("");
      setPassword("");
    } catch (err) {
      setIsError(true);
      setStatus(String(err instanceof Error ? err.message : err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="max-w-2xl mx-auto px-4 pb-12 flex flex-col gap-4">
        <header className="pt-5">
          <h1 className="text-xl font-bold tracking-tight leading-none">
            Bypass Update
          </h1>
        </header>
        <form
          onSubmit={onSubmit}
          className="card p-5 flex flex-col gap-4"
          aria-label="Bypass update form"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-base font-semibold">
              Cumulative kWh reading
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={kwh}
              onChange={(e) => setKwh(e.target.value)}
              className="px-3 py-2 rounded-lg"
              style={{
                background: "var(--chip)",
                color: "var(--text)",
                border: "1px solid var(--border)",
              }}
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
              style={{
                background: "var(--chip)",
                color: "var(--text)",
                border: "1px solid var(--border)",
              }}
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
            {sending ? "Saving…" : "Save reading"}
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
