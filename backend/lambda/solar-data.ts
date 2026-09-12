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
const TZ = "Asia/Manila";
const ELEC_RATE_PREFIX = "elec_rate:";
export const LIVE_TTL_SEC = 5 * 60;
export const DAY_TTL_SEC = 5 * 60;
export const MONTH_TTL_SEC = 60 * 60;
export const YEAR_TTL_SEC = 24 * 60 * 60;
const PAST_TTL_SEC = 365 * 24 * 60 * 60;
const TABLE = () => process.env.TABLE_NAME ?? "";
const BYPASS_PASSWORD = () => process.env.BYPASS_PASSWORD ?? "";
const BYPASS_FAIL = "bypass-update failed";
const BYPASS_PREFIX = "bypass:reading:";
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

function costFor(energy: any, rate: number | null | undefined) {
  const r = Number(rate);
  const rate_php_per_kwh = Number.isFinite(r) && r > 0 ? r : null;
  if (rate_php_per_kwh == null) {
    return {
      consumed_php: NaN,
      bypass_php: NaN,
      solar_php: NaN,
      net_php: NaN,
      rate_php_per_kwh: null,
    };
  }
  const consumed_php = Math.round(Number(energy.consumed_kwh) * rate_php_per_kwh);
  const bypass_php = Math.round(Number(energy.bypass_kwh) * rate_php_per_kwh);
  const solar_php = Math.round(Number(energy.generated_kwh) * rate_php_per_kwh);
  return {
    consumed_php,
    bypass_php,
    solar_php,
    net_php: consumed_php + bypass_php - solar_php,
    rate_php_per_kwh,
  };
}

type ElecRate = { mm: string; rate: number };

async function loadElecRates(): Promise<ElecRate[]> {
  const c = doc();
  if (!c) return [];
  try {
    const r = await c.send(
      new ScanCommand({
        TableName: TABLE(),
        FilterExpression: "begins_with(pk, :p)",
        ExpressionAttributeValues: { ":p": ELEC_RATE_PREFIX },
      }),
    );
    const out: ElecRate[] = [];
    for (const it of (r.Items ?? []) as any[]) {
      const mm = String(it.pk ?? "").slice(ELEC_RATE_PREFIX.length);
      if (!/^\d{4}-\d{2}$/.test(mm)) continue;
      const m = Number(mm.slice(5, 7));
      if (m < 1 || m > 12) continue;
      const rate = Number(it.data?.rate);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      out.push({ mm, rate });
    }
    out.sort((a, b) => (a.mm < b.mm ? -1 : a.mm > b.mm ? 1 : 0));
    return out;
  } catch {
    return [];
  }
}

function latestElecRate(rs: ElecRate[]): number | null {
  if (!rs.length) return null;
  return rs[rs.length - 1].rate;
}

function rateForMonth(rs: ElecRate[], mm: string): number | null {
  const exact = rs.find((r) => r.mm === mm);
  if (exact) return exact.rate;
  return latestElecRate(rs);
}

function avgRateForYear(rs: ElecRate[], yyyy: string): number | null {
  const vals = rs.filter((r) => r.mm.startsWith(`${yyyy}-`)).map((r) => r.rate);
  if (!vals.length) return latestElecRate(rs);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
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

// Bypass (cumulative grid meter not wired through solar). Sparse manual readings:
// pk = "bypass:reading:YYYY-MM-DD", data = { cumulative_kwh, recordedAt }.
type BypassReading = { iso: string; day: number; cum: number };

function isoToDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

async function loadBypassReadings(): Promise<BypassReading[]> {
  const c = doc();
  if (!c) return [];
  try {
    const r = await c.send(
      new ScanCommand({
        TableName: TABLE(),
        FilterExpression: "begins_with(pk, :p)",
        ExpressionAttributeValues: { ":p": BYPASS_PREFIX },
      }),
    );
    const out: BypassReading[] = [];
    for (const it of (r.Items ?? []) as any[]) {
      const iso = String(it.pk ?? "").slice(BYPASS_PREFIX.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      const cum = Number(it.data?.cumulative_kwh);
      if (!Number.isFinite(cum) || cum < 0) continue;
      out.push({ iso, day: isoToDay(iso), cum });
    }
    out.sort((a, b) => (a.day === b.day ? a.cum - b.cum : a.day - b.day));
    return out;
  } catch {
    return [];
  }
}

function bypassGlobalAvg(rs: BypassReading[]): number {
  if (rs.length < 2) return 0;
  const span = rs[rs.length - 1].day - rs[0].day;
  if (span <= 0) return 0;
  const v = (rs[rs.length - 1].cum - rs[0].cum) / span;
  return v > 0 ? v : 0;
}

function bypassSegment(a: BypassReading, b: BypassReading, fb: number): number {
  const span = b.day - a.day;
  if (span <= 0) return fb;
  const v = (b.cum - a.cum) / span;
  return v > 0 ? v : 0;
}

function bypassDailyRate(rs: BypassReading[], iso: string): number {
  const g = bypassGlobalAvg(rs);
  if (rs.length < 2) return 0;
  const t = isoToDay(iso);
  const latest = rs[rs.length - 1];
  if (iso.slice(0, 7) === latest.iso.slice(0, 7)) {
    return bypassSegment(rs[rs.length - 2], latest, g);
  }
  let lower: BypassReading | undefined;
  let upper: BypassReading | undefined;
  for (const r of rs) {
    if (r.day < t) lower = r;
    if (r.day > t && !upper) upper = r;
  }
  if (lower && upper) return bypassSegment(lower, upper, g);
  return g;
}

function bypassMonthRate(rs: BypassReading[], mm: string): number {
  const g = bypassGlobalAvg(rs);
  if (rs.length < 2) return 0;
  const latest = rs[rs.length - 1];
  if (mm === latest.iso.slice(0, 7)) {
    return bypassSegment(rs[rs.length - 2], latest, g);
  }
  let lower: BypassReading | undefined;
  let upper: BypassReading | undefined;
  for (const r of rs) {
    if (r.iso.slice(0, 7) < mm) lower = r;
    if (r.iso.slice(0, 7) > mm && !upper) upper = r;
  }
  if (lower && upper) return bypassSegment(lower, upper, g);
  return g;
}

function bypassYearRate(rs: BypassReading[], yyyy: string): number {
  const g = bypassGlobalAvg(rs);
  if (rs.length < 2) return 0;
  let lower: BypassReading | undefined;
  let upper: BypassReading | undefined;
  for (const r of rs) {
    if (r.iso.slice(0, 4) < yyyy) lower = r;
    if (r.iso.slice(0, 4) > yyyy && !upper) upper = r;
  }
  if (lower && upper) return bypassSegment(lower, upper, g);
  return g;
}

function bypassDaysInMonth(mm: string): number {
  const [y, m] = mm.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function bypassIsLeap(yyyy: string): boolean {
  const y = Number(yyyy);
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function bypassMonthMult(mm: string): number {
  const cur = currentMonth();
  if (mm > cur) return 0;
  if (mm === cur) return manilaToday().d;
  return bypassDaysInMonth(mm);
}

function bypassYearMult(yyyy: string): number {
  return bypassIsLeap(yyyy) ? 366 : 365;
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
    const rs = await loadBypassReadings();
    r.energy.bypass_kwh = r1(bypassDailyRate(rs, p.iso));
    return r;
  }
  if (kind === "month") {
    const p = monthInfo(month);
    const r = await loadPeriod(p.key, p.ts, p.ttlSec, () =>
      fetchHistoricalRaw(sn, 3, p.mm, p.mm),
    );
    const rs = await loadBypassReadings();
    r.energy.bypass_kwh = r1(bypassMonthRate(rs, p.mm) * bypassMonthMult(p.mm));
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
  const rs = await loadBypassReadings();
  r.energy.bypass_kwh = r1(
    bypassYearRate(rs, String(baseY)) * bypassYearMult(String(baseY)),
  );
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
    if (path === "live") {
      const live = mapLive(await getLive());
      const t = manilaToday();
      const rates = await loadElecRates();
      return json(
        200,
        {
          timestamp: `${t.y}-${pad(t.m)}-${pad(t.d)}T00:00:00+08:00`,
          live,
          elec_rate: latestElecRate(rates),
        },
        LIVE_TTL_SEC,
      );
    }
    if (path === "day" || path === "month" || path === "year") {
      const r = await energyFor(path, q.date, q.month, q.year);
      const rates = await loadElecRates();
      const rate =
        path === "year"
          ? avgRateForYear(rates, r.ts.slice(0, 4))
          : rateForMonth(rates, r.ts.slice(0, 7));
      return json(
        200,
        {
          timestamp: r.ts,
          energy: r.energy,
          cost: costFor(r.energy, rate),
          elec_rate: rate,
        },
        r.ttlSec ?? PAST_TTL_SEC,
      );
    }
    if (path === "bypass-update") {
      try {
        const raw =
          typeof ev.body === "string"
            ? JSON.parse(ev.body || "{}")
            : (ev.body ?? {});
        const v = Number(raw?.cumulative_kwh);
        const pw = String(raw?.password ?? "");
        const expected = BYPASS_PASSWORD();
        if (!expected || pw !== expected || !Number.isFinite(v) || v < 0) {
          return json(400, { error: BYPASS_FAIL });
        }
        const iso = todayIso();
        const recordedAt = new Date().toISOString();
        await ddbSet(
          `${BYPASS_PREFIX}${iso}`,
          { cumulative_kwh: v, recordedAt },
          null,
        );
        return json(200, { ok: true, recordedAt, cumulative_kwh: v });
      } catch {
        return json(400, { error: BYPASS_FAIL });
      }
    }
    if (path === "rate-update") {
      try {
        const raw =
          typeof ev.body === "string"
            ? JSON.parse(ev.body || "{}")
            : (ev.body ?? {});
        const year = String(raw?.year ?? "").trim();
        const month = String(raw?.month ?? raw?.mm ?? "")
          .trim()
          .padStart(2, "0");
        const rate = Number(raw?.rate ?? raw?.elec_rate);
        const pw = String(raw?.password ?? "");
        const expected = BYPASS_PASSWORD();
        const validYear =
          /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100;
        const mNum = Number(month);
        const validMonth =
          /^\d{2}$/.test(month) && mNum >= 1 && mNum <= 12;
        if (
          !expected ||
          pw !== expected ||
          !validYear ||
          !validMonth ||
          !Number.isFinite(rate) ||
          rate <= 0
        ) {
          return json(400, { error: "rate-update failed" });
        }
        const mm = `${year}-${month}`;
        await ddbSet(
          `${ELEC_RATE_PREFIX}${mm}`,
          { rate, updatedAt: new Date().toISOString() },
          null,
        );
        return json(200, { ok: true, month: mm, rate });
      } catch {
        return json(400, { error: "rate-update failed" });
      }
    }
    return json(404, { error: "unknown route" });
  } catch (e: any) {
    return json(e?.status ?? 500, { error: e?.message ?? "internal" });
  }
};
