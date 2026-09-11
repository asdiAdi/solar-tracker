import type { APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

// settings
const BASE = (
  process.env.SOLARMAN_BASE_URL ?? "https://globalapi.solarmanpv.com"
).replace(/\/$/, "");
const TOKEN = () => process.env.SOLARMAN_TOKEN ?? "";
const DEVICE_SN = () => process.env.DEVICE_SN ?? "";
const RATE = Number(process.env.GRID_PHP_PER_KWH ?? "12");
const TZ = "Asia/Manila";
export const LIVE_TTL_SEC = 5 * 60;
export const DAY_TTL_SEC = 5 * 60;
export const MONTH_TTL_SEC = 60 * 60;
export const YEAR_TTL_SEC = 24 * 60 * 60;
const PAST_TTL_SEC = 365 * 24 * 60 * 60;
const TABLE = () => process.env.TABLE_NAME ?? "";
const BYPASS_PASSWORD = () => process.env.BYPASS_PASSWORD ?? "";
const BYPASS_LOOKBACK_COUNT = () =>
  Math.max(2, Number(process.env.BYPASS_LOOKBACK_COUNT ?? "5") || 5);
const BYPASS_LOOKBACK_DAYS = () =>
  Math.max(1, Number(process.env.BYPASS_LOOKBACK_DAYS ?? "30") || 30);
const BYPASS_PREFIX = "bypass:reading#";
const DAY_MS = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pad = (n: number) => String(n).padStart(2, "0");

// lazy initialization
// Reuse the client across invocations within the same Lambda execution environment.
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

// get item from database
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
    return undefined;
  }
}

// set item from database
async function ddbSet(key: string, value: any, ttlSec: number | null) {
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
    // skip when save fails
  }
}

// get from solar
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

function fetchHistoricalRaw(
  deviceSn: string,
  timeType: number,
  startTime: string,
  endTime: string,
) {
  return sm("/device/v1.0/historical", {
    deviceSn,
    timeType,
    startTime,
    endTime,
  });
}

async function fetchLiveFresh() {
  const body = await sm("/device/v1.0/currentData", { deviceSn: DEVICE_SN() });
  await ddbSet("live", body, LIVE_TTL_SEC);
  return body;
}

async function getLive() {
  const hit = await ddbGet("live");
  if (hit) return hit;
  return fetchLiveFresh();
}

// Convert to number, default to 0 if invalid
const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Convert data list to a key-value map
function kv(dataList: any[] = []) {
  const m: Record<string, string> = {};
  for (const d of dataList) if (d?.key) m[d.key] = d.value;
  return m;
}

export function mapLive(body: any) {
  const m = kv(body?.dataList);
  return {
    solar_w: Math.round(num(m.DP1) + num(m.DP2) + num(m.DP3) + num(m.DP4)),
    home_w: Math.round(num(m.E_Puse_t1 ?? m.C_P_L1)),
    grid_w: Math.round(num(m.T_A_P_O_G ?? m.UAP1)),
    battery_w: Math.round(-num(m.B_P1)),
    battery_soc_pct: Math.round(num(m.B_left_cap1)),
  };
}

function costFor(energy: any) {
  const consumed_php = Math.round(energy.consumed_kwh * RATE);
  const bypass_php = Math.round(energy.bypass_kwh * RATE);
  const solar_php = Math.round(energy.generated_kwh * RATE);
  return {
    consumed_php,
    bypass_php,
    solar_php,
    net_php: consumed_php + bypass_php - solar_php,
  };
}

// dates
function manilaToday() {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, dd] = f.format(new Date(Date.now())).split("-").map(Number);
  return { y, m, d: dd };
}

function todayIso() {
  const t = manilaToday();
  return `${t.y}-${pad(t.m)}-${pad(t.d)}`;
}

function currentMonth() {
  const t = manilaToday();
  return `${t.y}-${pad(t.m)}`;
}

function currentYear() {
  return manilaToday().y;
}

// aggregate
export function sumHistorical(raw: any) {
  const lists: [][] = (raw?.paramDataList ?? []).map(
    (p: any) => p?.dataList ?? [],
  );
  const t = {
    generated_kwh: 0,
    consumed_kwh: 0,
    grid_import_kwh: 0,
    grid_export_kwh: 0,
  };
  for (const dl of lists) {
    const m = kv(dl ?? []);
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

// ---- Bypass (manual cumulative meter) ----
interface BypassReading {
  cum: number;
  t: number;
}

async function scanBypassReadings(): Promise<BypassReading[]> {
  const c = doc();
  if (!c) return [];
  const out: BypassReading[] = [];
  let startKey: any = undefined;
  try {
    do {
      const r = await c.send(
        new ScanCommand({
          TableName: TABLE(),
          FilterExpression: "begins_with(pk, :p)",
          ExpressionAttributeValues: { ":p": BYPASS_PREFIX },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of r.Items ?? []) {
        const d = (item as any)?.data ?? item;
        const cum = Number(d?.cumulative_kwh);
        const t = Date.parse(d?.recordedAt ?? "");
        if (Number.isFinite(cum) && Number.isFinite(t)) out.push({ cum, t });
      }
      startKey = r.LastEvaluatedKey;
    } while (startKey);
  } catch {
    return out;
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function avgOfSlice(slice: BypassReading[]): number {
  if (slice.length < 2) return 0;
  const oldest = slice[0];
  const latest = slice[slice.length - 1];
  const spanDays = (latest.t - oldest.t) / DAY_MS;
  if (!(spanDays > 0)) return 0;
  return (latest.cum - oldest.cum) / spanDays;
}

function constrainSpan(
  slice: BypassReading[],
  maxDays: number,
): BypassReading[] {
  const out = [...slice];
  while (
    out.length > 2 &&
    out[out.length - 1].t - out[0].t > maxDays * DAY_MS
  ) {
    out.shift();
  }
  return out;
}

function bypassAvgDaily(readings: BypassReading[]): number {
  return bypassAvgNear(readings, Date.now());
}

// Period-local average: up to BYPASS_LOOKBACK_COUNT readings nearest the
// queried period end (preferring readings at/before the anchor), spanning at
// most BYPASS_LOOKBACK_DAYS. Falls back to the latest readings so old periods
// still estimate from current data instead of going 0.
function bypassAvgNear(
  readings: BypassReading[],
  anchorMs: number,
): number {
  if (readings.length < 2) return 0;
  const count = BYPASS_LOOKBACK_COUNT();
  const days = BYPASS_LOOKBACK_DAYS();
  const before = readings.filter((r) => r.t <= anchorMs);
  if (before.length >= 2) {
    const sub = constrainSpan(before.slice(-count), days);
    if (sub.length >= 2) {
      const v = avgOfSlice(sub);
      if (Number.isFinite(v) && v !== 0) return v;
      if (sub.length >= 2) return v;
    }
  }
  return avgOfSlice(constrainSpan(readings.slice(-count), days));
}

// Accurate proration: intervals overlapping the period contribute
// proportionally, plus avgDaily * uncovered leading/trailing days.
// effectiveEnd is capped at now so current periods don't bill the future.
function bypassForRange(
  readings: BypassReading[],
  startMs: number,
  endExclusiveMs: number,
  avgDaily: number,
): number {
  const endMs = Math.min(endExclusiveMs, Date.now());
  if (!(endMs > startMs)) return 0;
  if (readings.length === 0) return 0;
  if (readings.length === 1) {
    // Single reading: no exact interval; estimate whole span if reading is inside/past.
    const t = readings[0].t;
    if (avgDaily <= 0) return 0;
    if (t <= startMs) return avgDaily * ((endMs - startMs) / DAY_MS);
    if (t < endMs) {
      // leading estimated, trailing estimated — both avg
      return avgDaily * ((endMs - startMs) / DAY_MS);
    }
    return 0;
  }
  let total = 0;
  for (let i = 0; i < readings.length - 1; i++) {
    const a = readings[i];
    const b = readings[i + 1];
    const len = b.t - a.t;
    if (!(len > 0)) continue;
    const overlap = Math.max(0, Math.min(b.t, endMs) - Math.max(a.t, startMs));
    if (overlap > 0) total += (b.cum - a.cum) * (overlap / len);
  }
  if (avgDaily > 0) {
    const first = readings[0].t;
    const last = readings[readings.length - 1].t;
    if (first > startMs) {
      const lead = Math.max(0, Math.min(first, endMs) - startMs);
      total += avgDaily * (lead / DAY_MS);
    }
    if (last < endMs) {
      const trail = endMs - Math.max(last, startMs);
      if (trail > 0) total += avgDaily * (trail / DAY_MS);
    }
  }
  if (total === 0 && avgDaily > 0) {
    // No interval overlapped this period (e.g. previous month before the
    // first reading): estimate the whole span from current bypass data.
    total = avgDaily * ((endMs - startMs) / DAY_MS);
  }
  return Math.max(0, r1(total));
}

function parseManilaMs(s: string): number {
  return Date.parse(s);
}

function dayBounds(iso: string): [number, number] {
  const s = parseManilaMs(`${iso}T00:00:00+08:00`);
  return [s, s + DAY_MS];
}

function monthBounds(mm: string): [number, number] {
  const [y, m] = mm.split("-").map(Number);
  const s = parseManilaMs(`${y}-${pad(m)}-01T00:00:00+08:00`);
  const nm = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  const e = parseManilaMs(`${nm}-01T00:00:00+08:00`);
  return [s, e];
}

function yearBounds(y: number): [number, number] {
  return [
    parseManilaMs(`${y}-01-01T00:00:00+08:00`),
    parseManilaMs(`${y + 1}-01-01T00:00:00+08:00`),
  ];
}

async function bypassForBounds(
  startMs: number,
  endExclusiveMs: number,
): Promise<number> {
  const readings = await scanBypassReadings();
  if (readings.length === 0) return 0;
  const avg = bypassAvgNear(readings, endExclusiveMs);
  return bypassForRange(readings, startMs, endExclusiveMs, avg);
}

// Load from the cache if available; otherwise fetch and cache the result.
async function loadPeriod(
  key: string,
  ts: string,
  ttlSec: number | null,
  doFetch: () => Promise<any>,
) {
  const hit = await ddbGet(key);
  if (hit?.raw) {
    return { energy: sumHistorical(hit.raw), ts: hit.ts ?? ts, ttlSec };
  }
  const raw = await doFetch();
  await ddbSet(key, { raw, ts }, ttlSec);
  return { energy: sumHistorical(raw), ts, ttlSec };
}

// helper
function dayInfo(date: string | undefined) {
  const base = date ?? todayIso();
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const iso = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  const isCurrent = iso === todayIso();
  return {
    key: `day:${iso}`,
    ts: `${iso}T00:00:00+08:00`,
    isCurrent,
    ttlSec: isCurrent ? DAY_TTL_SEC : null,
    iso,
  };
}

// helper
function monthInfo(month: string | undefined) {
  const base = month ?? currentMonth();
  const [y, m] = base.split("-").map(Number);
  const mm = `${y}-${pad(m)}`;
  const isCurrent = mm === currentMonth();
  return {
    key: `month:${mm}`,
    ts: `${mm}-01T00:00:00+08:00`,
    isCurrent,
    ttlSec: isCurrent ? MONTH_TTL_SEC : null,
    mm,
  };
}

async function energyFor(
  kind: "day" | "month" | "year",
  date?: string,
  month?: string,
  year?: string,
) {
  const sn = DEVICE_SN();
  if (kind === "day") {
    const p = dayInfo(date);
    const r = await loadPeriod(p.key, p.ts, p.ttlSec, () =>
      fetchHistoricalRaw(sn, 2, p.iso, p.iso),
    );
    const [s, e] = dayBounds(p.iso);
    r.energy.bypass_kwh = await bypassForBounds(s, e);
    return r;
  }
  if (kind === "month") {
    const p = monthInfo(month);
    const r = await loadPeriod(p.key, p.ts, p.ttlSec, () =>
      fetchHistoricalRaw(sn, 3, p.mm, p.mm),
    );
    const [s, e] = monthBounds(p.mm);
    r.energy.bypass_kwh = await bypassForBounds(s, e);
    return r;
  }
  const baseY = Number(year ?? currentYear());
  const ts = `${baseY}-01-01T00:00:00+08:00`;
  const isCurrent = baseY === currentYear();
  const r = await loadPeriod(
    `year:${baseY}`,
    ts,
    isCurrent ? YEAR_TTL_SEC : null,
    () => fetchHistoricalRaw(sn, 4, String(baseY), String(baseY)),
  );
  const [s, e] = yearBounds(baseY);
  r.energy.bypass_kwh = await bypassForBounds(s, e);
  return r;
}

const ALLOWED_ORIGIN = () => (process.env.ALLOWED_ORIGIN ?? "").trim();

function corsOrigin(ev: any): string {
  const allowed = ALLOWED_ORIGIN();
  if (!allowed) return "*";
  const headers = (ev?.headers ?? {}) as Record<string, string>;
  const reqOrigin = headers.origin ?? headers.Origin ?? headers.ORIGIN ?? "";
  if (reqOrigin && reqOrigin === allowed) return reqOrigin;
  return allowed;
}

// main
export const handler = async (ev: any): Promise<APIGatewayProxyResult> => {
  const origin = corsOrigin(ev);
  const json = (
    s: number,
    b: any,
    maxAgeSec?: number,
  ): APIGatewayProxyResult => ({
    statusCode: s,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      ...(maxAgeSec != null
        ? { "Cache-Control": `public, max-age=${maxAgeSec}` }
        : {}),
    },
    body: JSON.stringify(b),
  });
  try {
    const path = ((ev.path ?? ev.rawPath ?? "") as string)
      .replace(/\/$/, "")
      .split("/")
      .pop();
    const q = (ev.queryStringParameters ?? {}) as Record<string, string>;
    const method = (
      ev.httpMethod ??
      ev.requestContext?.http?.method ??
      "GET"
    ).toUpperCase();
    if (path === "bypass-update" && method === "POST") {
      let body: any = {};
      try {
        const raw = ev.body ?? "{}";
        body = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
      } catch {
        return json(400, { error: "invalid json" });
      }
      const cumulative_kwh = Number(body?.cumulative_kwh ?? body?.kwh);
      if (!Number.isFinite(cumulative_kwh) || cumulative_kwh < 0) {
        return json(400, { error: "cumulative_kwh must be a number >= 0" });
      }
      if (!BYPASS_PASSWORD()) {
        return json(500, { error: "bypass password not configured" });
      }
      if (body?.password !== BYPASS_PASSWORD()) {
        return json(401, { error: "unauthorized" });
      }
      const nowMs = Date.now();
      const recordedAt = new Date(nowMs).toISOString();
      const pk = `${BYPASS_PREFIX}${recordedAt}`;
      const c = doc();
      if (!c) return json(500, { error: "db not configured" });
      try {
        await c.send(
          new PutCommand({
            TableName: TABLE(),
            Item: {
              pk,
              data: { cumulative_kwh, recordedAt },
              updatedAt: recordedAt,
            },
          }),
        );
      } catch {
        return json(500, { error: "db write failed" });
      }
      return json(200, { ok: true, recordedAt, cumulative_kwh });
    }
    if (path === "live") {
      const live = mapLive(await getLive());
      const t = manilaToday();
      return json(
        200,
        {
          timestamp: `${t.y}-${pad(t.m)}-${pad(t.d)}T00:00:00+08:00`,
          live,
        },
        LIVE_TTL_SEC,
      );
    }
    if (path === "day" || path === "month" || path === "year") {
      const r = await energyFor(path, q.date, q.month, q.year);
      return json(
        200,
        {
          timestamp: r.ts,
          energy: r.energy,
          cost: costFor(r.energy),
        },
        r.ttlSec ?? PAST_TTL_SEC,
      );
    }
    return json(404, { error: "unknown route" });
  } catch (e: any) {
    return json(e?.status ?? 500, { error: e?.message ?? "internal" });
  }
};
