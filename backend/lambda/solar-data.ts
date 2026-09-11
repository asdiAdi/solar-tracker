import type { APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
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
    return loadPeriod(p.key, p.ts, p.ttlSec, () =>
      fetchHistoricalRaw(sn, 2, p.iso, p.iso),
    );
  }
  if (kind === "month") {
    const p = monthInfo(month);
    return loadPeriod(p.key, p.ts, p.ttlSec, () =>
      fetchHistoricalRaw(sn, 3, p.mm, p.mm),
    );
  }
  const baseY = Number(year ?? currentYear());
  const ts = `${baseY}-01-01T00:00:00+08:00`;
  const isCurrent = baseY === currentYear();
  return loadPeriod(`year:${baseY}`, ts, isCurrent ? YEAR_TTL_SEC : null, () =>
    fetchHistoricalRaw(sn, 4, String(baseY), String(baseY)),
  );
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
