import { CONFIG } from "../config";
import type { LiveResponse, PeriodResponse } from "./types";

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (CONFIG.API_KEY) headers["x-api-key"] = CONFIG.API_KEY;
  const r = await fetch(url, { headers, signal });
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

export async function getLive(signal?: AbortSignal): Promise<LiveResponse> {
  const base = CONFIG.API_BASE_URL.replace(/\/$/, "");
  return fetchJson<LiveResponse>(`${base}/live`, signal);
}

export async function getPeriod(
  kind: "day" | "month" | "year",
  dateKey?: string,
  signal?: AbortSignal,
): Promise<PeriodResponse> {
  const base = CONFIG.API_BASE_URL.replace(/\/$/, "");
  const q =
    kind === "day" && dateKey
      ? `?date=${dateKey}`
      : kind === "month" && dateKey
        ? `?month=${dateKey}`
        : kind === "year" && dateKey
          ? `?year=${dateKey}`
          : "";
  return fetchJson<PeriodResponse>(`${base}/${kind}${q}`, signal);
}

export async function postBypassUpdate(
  cumulative_kwh: number,
  password: string,
): Promise<{ ok: boolean; recordedAt: string; cumulative_kwh: number }> {
  const base = CONFIG.API_BASE_URL.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (CONFIG.API_KEY) headers["x-api-key"] = CONFIG.API_KEY;
  const r = await fetch(`${base}/bypass-update`, {
    method: "POST",
    headers,
    body: JSON.stringify({ cumulative_kwh, password }),
  });
  if (!r.ok) {
    let msg = `bypass-update: ${r.status}`;
    try {
      const j = (await r.json()) as any;
      if (j?.error) msg = j.error;
    } catch {
      // keep status message
    }
    throw new Error(msg);
  }
  return r.json() as Promise<{
    ok: boolean;
    recordedAt: string;
    cumulative_kwh: number;
  }>;
}

export async function postRateUpdate(
  year: string,
  month: string,
  rate: number,
  password: string,
): Promise<{ ok: boolean; month: string; rate: number }> {
  const base = CONFIG.API_BASE_URL.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (CONFIG.API_KEY) headers["x-api-key"] = CONFIG.API_KEY;
  const r = await fetch(`${base}/rate-update`, {
    method: "POST",
    headers,
    body: JSON.stringify({ year, month, rate, password }),
  });
  if (!r.ok) {
    let msg = `rate-update: ${r.status}`;
    try {
      const j = (await r.json()) as any;
      if (j?.error) msg = j.error;
    } catch {
      // keep status message
    }
    throw new Error(msg);
  }
  return r.json() as Promise<{ ok: boolean; month: string; rate: number }>;
}
