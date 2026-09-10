import type { APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const BASE = (
  process.env.SOLARMAN_BASE_URL ?? "https://globalapi.solarmanpv.com"
).replace(/\/$/, "");
const TOKEN = () => process.env.SOLARMAN_TOKEN ?? "";
const DEVICE_SN = () => process.env.DEVICE_SN ?? "";
const RATE = Number(process.env.GRID_PHP_PER_KWH ?? "12");
const TZ = "Asia/Manila";
const r1 = (n: number) => Math.round(n * 10) / 10;

// TTLs (seconds for DynamoDB `expiresAt`, ms for in-memory fallback)
const LIVE_TTL_SEC = 5 * 60;
const HIST_CURRENT_TTL_SEC = 30 * 60;
// Frozen past periods never change -> no expiry (omit `expiresAt`).
// Storage is tiny for a single device, so retaining forever is cheapest
// for the Solarman rate limit.
const LIVE_TTL_MS = LIVE_TTL_SEC * 1000;
const HIST_TTL_MS = HIST_CURRENT_TTL_SEC * 1000;

const TABLE = () => process.env.CACHE_TABLE_NAME ?? "";

// --- Lazy DynamoDB doc client (so local tests without creds/table still run) ---
let docClient: DynamoDBDocumentClient | null = null;
function doc(): DynamoDBDocumentClient | null {
  if (!TABLE()) return null;
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

// --- In-memory fallback (local dev / `test:live` without CACHE_TABLE_NAME) ---
const memCache = new Map<string, { at: number; value: any }>();

export function clearSolarTrackerCache() {
  memCache.clear();
}

async function ddbGet(key: string): Promise<any | undefined> {
  const c = doc();
  if (!c) return undefined;
  try {
    const r = await c.send(
      new GetCommand({ TableName: TABLE(), Key: { pk: key } }),
    );
    const item = r.Item as any;
    if (!item || !("data" in item)) return undefined;
    if (
      typeof item.expiresAt === "number" &&
      item.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return undefined;
    }
    return item.data;
  } catch {
    return undefined; // fail open: fall through to Solarman fetch
  }
}

async function ddbSet(
  key: string,
  value: any,
  ttlSec: number | null,
): Promise<void> {
  const c = doc();
  if (!c) return;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await c.send(
      new PutCommand({
        TableName: TABLE(),
        Item: {
          pk: key,
          data: value,
          updatedAt: new Date().toISOString(),
          ...(ttlSec != null ? { expiresAt: nowSec + ttlSec } : {}),
        },
      }),
    );
  } catch {
    // fail open: cache write errors must never break the API response
  }
}

function memGet(key: string, ttlMs: number): any | undefined {
  const e = memCache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at >= ttlMs) {
    memCache.delete(key);
    return undefined;
  }
  return e.value;
}

function memSet(key: string, value: any) {
  memCache.set(key, { at: Date.now(), value });
}

async function cacheGet(key: string, ttlMs: number): Promise<any | undefined> {
  if (TABLE()) return ddbGet(key);
  return memGet(key, ttlMs);
}

async function cacheSet(
  key: string,
  value: any,
  ttlSec: number | null,
): Promise<void> {
  if (TABLE()) {
    await ddbSet(key, value, ttlSec);
    return;
  }
  memSet(key, value);
}

async function sm(path: string, body: any) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN()}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    const e: any = new Error("solarman-unauthorized");
    e.status = 502;
    throw e;
  }
  if (!res.ok) {
    const e: any = new Error(`solarman ${res.status}`);
    e.status = 502;
    throw e;
  }
  return res.json() as any;
}

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function kv(dataList: any[] = []) {
  const m: Record<string, string> = {};
  for (const d of dataList) if (d?.key) m[d.key] = d.value;
  return m;
}

export function mapLive(body: any) {
  const m = kv(body?.dataList);
  const solar_w = Math.round(num(m.DP1) + num(m.DP2) + num(m.DP3) + num(m.DP4));
  const home_w = Math.round(num(m.E_Puse_t1 ?? m.C_P_L1));
  const grid_w = Math.round(num(m.T_A_P_O_G ?? m.UAP1));
  const battery_w = Math.round(-num(m.B_P1));
  const battery_soc_pct = Math.round(num(m.B_left_cap1));
  return { solar_w, home_w, grid_w, battery_w, battery_soc_pct };
}

export function sumHistorical(lists: any[][]) {
  const t = {
    generated_kwh: 0,
    consumed_kwh: 0,
    grid_import_kwh: 0,
    grid_export_kwh: 0,
  };
  for (const dl of lists) {
    const m: Record<string, string> = {};
    for (const d of dl ?? []) if (d?.key) m[d.key] = d.value;
    t.generated_kwh += num(m.generation);
    t.consumed_kwh += num(m.consumption);
    t.grid_import_kwh += num(m.purchase);
    t.grid_export_kwh += num(m.grid);
  }
  return {
    generated_kwh: r1(t.generated_kwh),
    consumed_kwh: r1(t.consumed_kwh),
    grid_import_kwh: r1(t.grid_import_kwh),
    grid_export_kwh: r1(t.grid_export_kwh),
    bypass_kwh: 0,
  };
}

function manilaParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, dd] = f.format(d).split("-").map(Number);
  return { y, m, d: dd };
}

function manilaToday(offsetDays = 0) {
  const p = manilaParts(new Date(Date.now() + offsetDays * 864e5));
  return p;
}

const pad = (n: number) => String(n).padStart(2, "0");

function todayIso(): string {
  const t = manilaToday();
  return `${t.y}-${pad(t.m)}-${pad(t.d)}`;
}

function currentMonth(): string {
  const t = manilaToday();
  return `${t.y}-${pad(t.m)}`;
}

function currentYear(): number {
  return manilaToday().y;
}

async function histChunk(
  sn: string,
  timeType: number,
  startTime: string,
  endTime: string,
) {
  const j = await sm("/device/v1.0/historical", {
    deviceSn: sn,
    timeType,
    startTime,
    endTime,
  });
  return (j?.paramDataList ?? []).map((p: any) => p.dataList);
}

async function energyFor(
  kind: "day" | "month" | "year",
  date?: string,
  month?: string,
  year?: string,
  offset = 0,
) {
  const sn = DEVICE_SN();
  if (kind === "day") {
    const base =
      date ??
      `${manilaToday().y}-${pad(manilaToday().m)}-${pad(manilaToday().d)}`;
    const [y, m, d] = base.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + offset));
    const iso = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    const key = `day:${iso}`;
    const hit = await cacheGet(key, HIST_TTL_MS);
    if (hit) return hit;
    const lists = await histChunk(sn, 2, iso, iso);
    const out = { energy: sumHistorical(lists), ts: `${iso}T00:00:00+08:00` };
    // Frozen past days never change -> cache forever; today refreshes.
    await cacheSet(key, out, iso === todayIso() ? HIST_CURRENT_TTL_SEC : null);
    return out;
  }
  if (kind === "month") {
    const base = month ?? `${manilaToday().y}-${pad(manilaToday().m)}`;
    let [y, m] = base.split("-").map(Number);
    const tot = y * 12 + (m - 1) + offset;
    y = Math.floor(tot / 12);
    m = (tot % 12) + 1;
    const mm = `${y}-${pad(m)}`;
    const key = `month:${mm}`;
    const hit = await cacheGet(key, HIST_TTL_MS);
    if (hit) return hit;
    const lists = await histChunk(sn, 3, mm, mm);
    const out = { energy: sumHistorical(lists), ts: `${mm}-01T00:00:00+08:00` };
    await cacheSet(key, out, mm === currentMonth() ? HIST_CURRENT_TTL_SEC : null);
    return out;
  }
  const baseY = Number(year ?? manilaToday().y) + offset;
  const key = `year:${baseY}`;
  const hit = await cacheGet(key, HIST_TTL_MS);
  if (hit) return hit;
  const lists = await histChunk(sn, 4, String(baseY), String(baseY));
  const out = {
    energy: sumHistorical(lists),
    ts: `${baseY}-01-01T00:00:00+08:00`,
  };
  await cacheSet(key, out, baseY === currentYear() ? HIST_CURRENT_TTL_SEC : null);
  return out;
}

async function fetchLiveFresh() {
  const body = await sm("/device/v1.0/currentData", { deviceSn: DEVICE_SN() });
  await cacheSet("live", body, LIVE_TTL_SEC);
  return body;
}

async function getLive() {
  const hit = await cacheGet("live", LIVE_TTL_MS);
  if (hit) return hit;
  return fetchLiveFresh();
}

// Background warmer (EventBridge every 5 min): force-refresh live so users
// never wait on Solarman; ensure current day/month/year via the normal
// cached path (only fetches when their 30-min TTL is stale). Each step is
// best-effort so one Solarman failure doesn't fail the whole tick.
async function warmCache() {
  const warmed: Record<string, boolean> = {};
  try {
    await fetchLiveFresh();
    warmed.live = true;
  } catch {
    warmed.live = false;
  }
  for (const [k, fn] of [
    ["day", () => energyFor("day")],
    ["month", () => energyFor("month")],
    ["year", () => energyFor("year")],
  ] as const) {
    try {
      await fn();
      warmed[k] = true;
    } catch {
      warmed[k] = false;
    }
  }
  return warmed;
}

function isWarmerEvent(ev: any): boolean {
  if (!ev || typeof ev !== "object") return false;
  if (ev.warmer === true) return true;
  if (ev.source === "aws.events") return true;
  if (ev["detail-type"] === "Scheduled Event") return true;
  // Not an API Gateway proxy event -> treat as scheduled tick.
  if (!("path" in ev) && !("rawPath" in ev) && !("httpMethod" in ev)) return true;
  return false;
}

export const handler = async (ev: any): Promise<APIGatewayProxyResult> => {
  const json = (s: number, b: any): APIGatewayProxyResult => ({
    statusCode: s,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(b),
  });
  try {
    if (isWarmerEvent(ev)) {
      const warmed = await warmCache();
      return json(200, { warmed });
    }
    const path = ((ev.path ?? "") as string).replace(/\/$/, "").split("/").pop();
    const q = (ev.queryStringParameters ?? {}) as Record<string, string>;
    const offset = Number(q.offset ?? "0") || 0;
    if (path === "live") {
      const liveBody = await getLive();
      const live = mapLive(liveBody);
      const t = manilaToday();
      const timestamp = `${t.y}-${pad(t.m)}-${pad(t.d)}T00:00:00+08:00`;
      return json(200, { timestamp, live });
    }
    if (path === "day" || path === "month" || path === "year") {
      const r = await energyFor(path, q.date, q.month, q.year, offset);
      const energy = r.energy;
      const consumed_php = Math.round(energy.consumed_kwh * RATE);
      const bypass_php = Math.round(energy.bypass_kwh * RATE);
      const solar_php = Math.round(energy.generated_kwh * RATE);
      const net_php = consumed_php + bypass_php - solar_php;
      const cost = { consumed_php, bypass_php, solar_php, net_php };
      return json(200, { timestamp: r.ts, energy, cost });
    }
    return json(404, { error: "unknown route" });
  } catch (e: any) {
    return json(e?.status ?? 500, { error: e?.message ?? "internal" });
  }
};
