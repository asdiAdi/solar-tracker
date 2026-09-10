export const LIVE_TTL_MS = 5 * 60_000;
export const PERIOD_TTL_MS = 30 * 60_000;

interface CacheEntry<T> {
  at: number;
  value: T;
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (typeof parsed?.at !== "number" || !("value" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    const entry: CacheEntry<T> = { at: Date.now(), value };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // storage full / private mode — ignore, memory cache still works
  }
}

export function isFresh(at: number, ttlMs: number, now = Date.now()): boolean {
  return now - at < ttlMs;
}

export const cacheKeyFor = (kind: "live" | "day" | "month" | "year", dateKey?: string) =>
  kind === "live" ? "solacker:live" : `solacker:${kind}:${dateKey ?? "current"}`;
