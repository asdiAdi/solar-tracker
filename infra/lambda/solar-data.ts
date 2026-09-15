import type { APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

type StringMap = Record<string, string>;

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const SSM_PREFIX = process.env.SSM_PREFIX;
const TABLE_NAME = process.env.TABLE_NAME;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;

if (!SSM_PREFIX) {
  throw new Error("SSM_PREFIX undefined");
}
if (!TABLE_NAME) {
  throw new Error("TABLE_NAME undefined");
}
if (!ALLOWED_ORIGINS) {
  throw new Error("ALLOWED_ORIGINS undefined");
}

const TIMEZONE = "Asia/Manila";
const ELEC_RATE_PREFIX = "elec_rate:";
const BYPASS_PREFIX = "bypass:reading:";
const BYPASS_UPDATE_FAILED = "bypass-update failed";
const RATE_UPDATE_FAILED = "rate-update failed";
const LIVE_TTL_SEC = 5 * 60;
const DAY_TTL_SEC = 5 * 60;
const MONTH_TTL_SEC = 60 * 60;
const YEAR_TTL_SEC = 24 * 60 * 60;
const PAST_TTL_SEC = 365 * 24 * 60 * 60;

const round1 = (n: number) => Math.round(n * 10) / 10;
const pad2 = (n: number) => String(n).padStart(2, "0");

const toNumber = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toKeyValueMap(dataList: SolarmanDataPoint[] = []): StringMap {
  const map: StringMap = {};
  for (const point of dataList) {
    if (point?.key) map[point.key] = point.value;
  }
  return map;
}

let ssmClient: SSMClient | null = null;
let ssmCache: StringMap | null = null;
let config: StringMap = {};
function getSSmClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient();
  }
  return ssmClient;
}

async function loadParams(prefix: string): Promise<StringMap> {
  if (ssmCache) return ssmCache;
  const client = getSSmClient();
  const params: StringMap = {};
  let nextToken: string | undefined;
  do {
    const res = await client.send(
      new GetParametersByPathCommand({
        Path: prefix,
        Recursive: true,
        WithDecryption: true,
        NextToken: nextToken,
      }),
    );
    for (const p of res.Parameters ?? []) {
      const shortKey = p.Name?.split("/").pop();
      if (shortKey && p.Value !== undefined) params[shortKey] = p.Value;
    }
    nextToken = res.NextToken;
  } while (nextToken);
  ssmCache = params;
  return params;
}

function getParam(key: string): string {
  const v = config[key];
  if (v === undefined || v === "") {
    throw new HttpError(`missing SSM ${key}`, 500);
  }
  return v;
}

// Reused across invocations within the same Lambda execution environment.
let docClient: DynamoDBDocumentClient | null = null;
function getDocClient(): DynamoDBDocumentClient | null {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

async function cacheGet<T>(key: string): Promise<T | undefined> {
  const client = getDocClient();
  if (!client) return undefined;
  try {
    const result = await client.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: key } }),
    );
    const item = result.Item as CacheRecord<T> | undefined;
    if (!item || !("data" in item)) return undefined;

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof item.expiresAt === "number" && item.expiresAt <= nowSec) {
      return undefined;
    }
    return item.data;
  } catch {
    return undefined;
  }
}

async function cacheSet<T>(
  key: string,
  value: T,
  ttlSec: number | null,
): Promise<void> {
  const client = getDocClient();
  if (!client) return;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const item: CacheRecord<T> = {
      pk: key,
      data: value,
      updatedAt: new Date().toISOString(),
      ...(ttlSec != null ? { expiresAt: nowSec + ttlSec } : {}),
    };
    await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  } catch {}
}

async function scanByPrefix<T>(
  prefix: string,
  parse: (pk: string, data: unknown) => T | undefined,
): Promise<T[]> {
  const client = getDocClient();
  if (!client) return [];
  try {
    const result = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "begins_with(pk, :p)",
        ExpressionAttributeValues: { ":p": prefix },
      }),
    );
    const out: T[] = [];
    for (const raw of result.Items ?? []) {
      const pk = String(raw.pk ?? "");
      const parsed = parse(pk, raw.data);
      if (parsed !== undefined) out.push(parsed);
    }
    return out;
  } catch {
    return [];
  }
}

async function solarmanPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://globalapi.solarmanpv.com/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getParam("SOLARMAN_TOKEN")}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new HttpError("solarman-unauthorized", 502);
  }
  if (!res.ok) {
    throw new HttpError(`solarman ${res.status}`, 502);
  }
  return res.json() as Promise<T>;
}

function fetchHistoricalRaw(
  deviceSn: string,
  timeType: number,
  startTime: string,
  endTime: string,
): Promise<SolarmanHistoricalResponse> {
  return solarmanPost<SolarmanHistoricalResponse>("device/v1.0/historical", {
    deviceSn,
    timeType,
    startTime,
    endTime,
  });
}

async function fetchLiveFresh(): Promise<SolarmanLiveResponse> {
  const body = await solarmanPost<SolarmanLiveResponse>(
    "device/v1.0/currentData",
    {
      deviceSn: getParam("DEVICE_SN"),
    },
  );
  await cacheSet("live", body, LIVE_TTL_SEC);
  return body;
}

async function getLive(): Promise<SolarmanLiveResponse> {
  const cached = await cacheGet<SolarmanLiveResponse>("live");
  return cached ?? fetchLiveFresh();
}

function mapLive(body: SolarmanLiveResponse): LiveMetrics {
  const m = toKeyValueMap(body?.dataList);
  return {
    solar_w: Math.round(
      toNumber(m.DP1) + toNumber(m.DP2) + toNumber(m.DP3) + toNumber(m.DP4),
    ),
    home_w: Math.round(toNumber(m.E_Puse_t1 ?? m.C_P_L1)),
    grid_w: Math.round(toNumber(m.T_A_P_O_G ?? m.UAP1)),
    battery_w: Math.round(-toNumber(m.B_P1)),
    battery_soc_pct: Math.round(toNumber(m.B_left_cap1)),
  };
}

function sumHistorical(raw: SolarmanHistoricalResponse): EnergyTotals {
  const lists = (raw?.paramDataList ?? []).map((p) => p?.dataList ?? []);
  const totals = {
    generated_kwh: 0,
    consumed_kwh: 0,
    grid_import_kwh: 0,
    grid_export_kwh: 0,
  };

  for (const dataList of lists) {
    const m = toKeyValueMap(dataList);
    totals.generated_kwh += toNumber(m.generation);
    totals.consumed_kwh += toNumber(m.consumption);
    totals.grid_import_kwh += toNumber(m.purchase);
    totals.grid_export_kwh += toNumber(m.grid);
  }

  return {
    generated_kwh: round1(totals.generated_kwh),
    consumed_kwh: round1(totals.consumed_kwh),
    grid_import_kwh: round1(totals.grid_import_kwh),
    grid_export_kwh: round1(totals.grid_export_kwh),
    bypass_kwh: 0,
  };
}

async function loadPeriod(
  key: string,
  ts: string,
  ttlSec: number | null,
  fetchRaw: () => Promise<SolarmanHistoricalResponse>,
): Promise<PeriodResult> {
  const cached = await cacheGet<{
    raw: SolarmanHistoricalResponse;
    ts?: string;
  }>(key);
  if (cached?.raw) {
    return { energy: sumHistorical(cached.raw), ts: cached.ts ?? ts, ttlSec };
  }
  const raw = await fetchRaw();
  await cacheSet(key, { raw, ts }, ttlSec);
  return { energy: sumHistorical(raw), ts, ttlSec };
}

async function loadElecRates(): Promise<ElecRate[]> {
  const rates = await scanByPrefix<ElecRate>(ELEC_RATE_PREFIX, (pk, data) => {
    const mm = pk.slice(ELEC_RATE_PREFIX.length);
    if (!/^\d{4}-\d{2}$/.test(mm)) return undefined;
    const month = Number(mm.slice(5, 7));
    if (month < 1 || month > 12) return undefined;
    const rate = Number((data as { rate?: unknown } | undefined)?.rate);
    if (!Number.isFinite(rate) || rate <= 0) return undefined;
    return { mm, rate };
  });

  return rates.sort((a, b) => (a.mm < b.mm ? -1 : a.mm > b.mm ? 1 : 0));
}

function latestElecRate(rates: ElecRate[]): number | null {
  return rates.length ? rates[rates.length - 1].rate : null;
}

function rateForMonth(rates: ElecRate[], mm: string): number | null {
  return rates.find((r) => r.mm === mm)?.rate ?? latestElecRate(rates);
}

function avgRateForYear(rates: ElecRate[], yyyy: string): number | null {
  const values = rates
    .filter((r) => r.mm.startsWith(`${yyyy}-`))
    .map((r) => r.rate);
  if (!values.length) return latestElecRate(rates);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function costFor(
  energy: EnergyTotals,
  rate: number | null | undefined,
): CostBreakdown {
  const rate_php_per_kwh =
    Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : null;
  if (rate_php_per_kwh == null) {
    return {
      consumed_php: NaN,
      bypass_php: NaN,
      solar_php: NaN,
      net_php: NaN,
      rate_php_per_kwh: null,
    };
  }

  const consumed_php = Math.round(energy.consumed_kwh * rate_php_per_kwh);
  const bypass_php = Math.round(energy.bypass_kwh * rate_php_per_kwh);
  const solar_php = Math.round(energy.generated_kwh * rate_php_per_kwh);

  return {
    consumed_php,
    bypass_php,
    solar_php,
    net_php: consumed_php + bypass_php - solar_php,
    rate_php_per_kwh,
  };
}

function manilaToday(): { y: number; m: number; d: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = formatter.format(new Date()).split("-").map(Number);
  return { y, m, d };
}

const todayIso = () => {
  const t = manilaToday();
  return `${t.y}-${pad2(t.m)}-${pad2(t.d)}`;
};

const currentMonth = () => {
  const t = manilaToday();
  return `${t.y}-${pad2(t.m)}`;
};

const currentYear = () => manilaToday().y;

function dayInfo(date: string | undefined) {
  const base = date ?? todayIso();
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const iso = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  const isCurrent = iso === todayIso();
  return {
    key: `day:${iso}`,
    ts: `${iso}T00:00:00+08:00`,
    isCurrent,
    ttlSec: isCurrent ? DAY_TTL_SEC : null,
    iso,
  };
}

function monthInfo(month: string | undefined) {
  const base = month ?? currentMonth();
  const [y, m] = base.split("-").map(Number);
  const mm = `${y}-${pad2(m)}`;
  const isCurrent = mm === currentMonth();
  return {
    key: `month:${mm}`,
    ts: `${mm}-01T00:00:00+08:00`,
    isCurrent,
    ttlSec: isCurrent ? MONTH_TTL_SEC : null,
    mm,
  };
}

function isoToDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

async function loadBypassReadings(): Promise<BypassReading[]> {
  const readings = await scanByPrefix<BypassReading>(
    BYPASS_PREFIX,
    (pk, data) => {
      const iso = pk.slice(BYPASS_PREFIX.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
      const cum = Number(
        (data as { cumulative_kwh?: unknown } | undefined)?.cumulative_kwh,
      );
      if (!Number.isFinite(cum) || cum < 0) return undefined;
      return { iso, day: isoToDay(iso), cum };
    },
  );
  return readings.sort((a, b) =>
    a.day === b.day ? a.cum - b.cum : a.day - b.day,
  );
}

function bypassGlobalAvg(readings: BypassReading[]): number {
  if (readings.length < 2) return 0;
  const first = readings[0];
  const last = readings[readings.length - 1];
  const span = last.day - first.day;
  if (span <= 0) return 0;
  const rate = (last.cum - first.cum) / span;
  return rate > 0 ? rate : 0;
}

function bypassSegmentRate(
  a: BypassReading,
  b: BypassReading,
  fallback: number,
): number {
  const span = b.day - a.day;
  if (span <= 0) return fallback;
  const rate = (b.cum - a.cum) / span;
  return rate > 0 ? rate : 0;
}

function findBracket(
  readings: BypassReading[],
  isBefore: (r: BypassReading) => boolean,
  isAfter: (r: BypassReading) => boolean,
): { lower?: BypassReading; upper?: BypassReading } {
  let lower: BypassReading | undefined;
  let upper: BypassReading | undefined;
  for (const r of readings) {
    if (isBefore(r)) lower = r;
    if (isAfter(r) && !upper) upper = r;
  }
  return { lower, upper };
}

function bypassDailyRate(readings: BypassReading[], iso: string): number {
  const fallback = bypassGlobalAvg(readings);
  if (readings.length < 2) return 0;
  const targetDay = isoToDay(iso);
  const latest = readings[readings.length - 1];
  if (iso.slice(0, 7) === latest.iso.slice(0, 7)) {
    return bypassSegmentRate(readings[readings.length - 2], latest, fallback);
  }
  const { lower, upper } = findBracket(
    readings,
    (r) => r.day < targetDay,
    (r) => r.day > targetDay,
  );
  return lower && upper ? bypassSegmentRate(lower, upper, fallback) : fallback;
}

function bypassMonthRate(readings: BypassReading[], mm: string): number {
  const fallback = bypassGlobalAvg(readings);
  if (readings.length < 2) return 0;
  const latest = readings[readings.length - 1];
  if (mm === latest.iso.slice(0, 7)) {
    return bypassSegmentRate(readings[readings.length - 2], latest, fallback);
  }
  const { lower, upper } = findBracket(
    readings,
    (r) => r.iso.slice(0, 7) < mm,
    (r) => r.iso.slice(0, 7) > mm,
  );
  return lower && upper ? bypassSegmentRate(lower, upper, fallback) : fallback;
}

function bypassYearRate(readings: BypassReading[], yyyy: string): number {
  const fallback = bypassGlobalAvg(readings);
  if (readings.length < 2) return 0;
  const { lower, upper } = findBracket(
    readings,
    (r) => r.iso.slice(0, 4) < yyyy,
    (r) => r.iso.slice(0, 4) > yyyy,
  );
  return lower && upper ? bypassSegmentRate(lower, upper, fallback) : fallback;
}

function daysInMonth(mm: string): number {
  const [y, m] = mm.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isLeapYear(yyyy: string): boolean {
  const y = Number(yyyy);
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function bypassMonthMultiplier(mm: string): number {
  const current = currentMonth();
  if (mm > current) return 0;
  if (mm === current) return manilaToday().d;
  return daysInMonth(mm);
}

function bypassYearMultiplier(yyyy: string): number {
  return isLeapYear(yyyy) ? 366 : 365;
}

async function energyForDay(date: string | undefined): Promise<PeriodResult> {
  const info = dayInfo(date);
  const result = await loadPeriod(info.key, info.ts, info.ttlSec, () =>
    fetchHistoricalRaw(getParam("DEVICE_SN"), 2, info.iso, info.iso),
  );
  const readings = await loadBypassReadings();
  result.energy.bypass_kwh = round1(bypassDailyRate(readings, info.iso));
  return result;
}

async function energyForMonth(
  month: string | undefined,
): Promise<PeriodResult> {
  const info = monthInfo(month);
  const result = await loadPeriod(info.key, info.ts, info.ttlSec, () =>
    fetchHistoricalRaw(getParam("DEVICE_SN"), 3, info.mm, info.mm),
  );
  const readings = await loadBypassReadings();
  result.energy.bypass_kwh = round1(
    bypassMonthRate(readings, info.mm) * bypassMonthMultiplier(info.mm),
  );
  return result;
}

async function energyForYear(year: string | undefined): Promise<PeriodResult> {
  const y = Number(year ?? currentYear());
  const ts = `${y}-01-01T00:00:00+08:00`;
  const isCurrent = y === currentYear();
  const result = await loadPeriod(
    `year:${y}`,
    ts,
    isCurrent ? YEAR_TTL_SEC : null,
    () => fetchHistoricalRaw(getParam("DEVICE_SN"), 4, String(y), String(y)),
  );
  const readings = await loadBypassReadings();
  result.energy.bypass_kwh = round1(
    bypassYearRate(readings, String(y)) * bypassYearMultiplier(String(y)),
  );
  return result;
}

function resolveOrigin(ev: LambdaEvent): string | undefined {
  const allowed = ALLOWED_ORIGINS?.split(",");
  const headers = ev.headers ?? {};
  const requestOrigin =
    headers.origin ?? headers.Origin ?? headers.ORIGIN ?? "";
  if (!requestOrigin) return undefined;
  return allowed?.includes(requestOrigin) ? requestOrigin : undefined;
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  ev?: LambdaEvent,
  maxAgeSec?: number,
): APIGatewayProxyResult {
  let origin: string | undefined;
  try {
    origin = ev ? resolveOrigin(ev) : undefined;
  } catch {
    origin = undefined;
  }
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...(origin !== undefined
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
      ...(maxAgeSec != null
        ? { "Cache-Control": `public, max-age=${maxAgeSec}` }
        : {}),
    },
    body: JSON.stringify(body),
  };
}

function getRoutePath(ev: LambdaEvent): string {
  const fullPath = ev.path ?? ev.rawPath ?? "";
  return fullPath.replace(/\/$/, "").split("/").pop() ?? "";
}

function parseJsonBody(ev: LambdaEvent): Record<string, unknown> {
  if (!ev.body) return {};
  try {
    return JSON.parse(ev.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function requireValidPassword(password: string): void {
  if (password !== getParam("BYPASS_PASSWORD")) {
    throw new Error("invalid password");
  }
}

async function handleLive(ev: LambdaEvent): Promise<APIGatewayProxyResult> {
  const live = mapLive(await getLive());
  const t = manilaToday();
  const rates = await loadElecRates();
  return jsonResponse(
    200,
    {
      timestamp: `${t.y}-${pad2(t.m)}-${pad2(t.d)}T00:00:00+08:00`,
      live,
      elec_rate: latestElecRate(rates),
    },
    ev,
    LIVE_TTL_SEC,
  );
}

async function handleEnergyPeriod(
  period: "day" | "month" | "year",
  query: Record<string, string | undefined>,
  ev: LambdaEvent,
): Promise<APIGatewayProxyResult> {
  const result =
    period === "day"
      ? await energyForDay(query.date)
      : period === "month"
        ? await energyForMonth(query.month)
        : await energyForYear(query.year);

  const rates = await loadElecRates();
  const rate =
    period === "year"
      ? avgRateForYear(rates, result.ts.slice(0, 4))
      : rateForMonth(rates, result.ts.slice(0, 7));

  return jsonResponse(
    200,
    {
      timestamp: result.ts,
      energy: result.energy,
      cost: costFor(result.energy, rate),
      elec_rate: rate,
    },
    ev,
    result.ttlSec ?? PAST_TTL_SEC,
  );
}

async function handleBypassUpdate(
  ev: LambdaEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const body = parseJsonBody(ev);
    const cumulativeKwh = Number(body.cumulative_kwh);
    requireValidPassword(String(body.password ?? ""));

    if (!Number.isFinite(cumulativeKwh) || cumulativeKwh < 0) {
      throw new Error("invalid cumulative_kwh");
    }

    const iso = todayIso();
    const recordedAt = new Date().toISOString();
    await cacheSet(
      `${BYPASS_PREFIX}${iso}`,
      { cumulative_kwh: cumulativeKwh, recordedAt },
      null,
    );

    return jsonResponse(
      200,
      {
        ok: true,
        recordedAt,
        cumulative_kwh: cumulativeKwh,
      },
      ev,
    );
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return jsonResponse(400, { error: BYPASS_UPDATE_FAILED }, ev);
  }
}

async function handleRateUpdate(
  ev: LambdaEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const body = parseJsonBody(ev);
    const year = String(body.year ?? "").trim();
    const month = String(body.month ?? body.mm ?? "")
      .trim()
      .padStart(2, "0");
    const rate = Number(body.rate ?? body.elec_rate);
    requireValidPassword(String(body.password ?? ""));

    const monthNum = Number(month);
    const validYear =
      /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100;
    const validMonth = /^\d{2}$/.test(month) && monthNum >= 1 && monthNum <= 12;

    if (!validYear || !validMonth || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("invalid year/month/rate");
    }

    const mm = `${year}-${month}`;
    await cacheSet(
      `${ELEC_RATE_PREFIX}${mm}`,
      { rate, updatedAt: new Date().toISOString() },
      null,
    );

    return jsonResponse(200, { ok: true, month: mm, rate }, ev);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return jsonResponse(400, { error: RATE_UPDATE_FAILED }, ev);
  }
}

export const handler = async (
  ev: LambdaEvent,
): Promise<APIGatewayProxyResult> => {
  const path = getRoutePath(ev);
  const query = (ev.queryStringParameters ?? {}) as Record<
    string,
    string | undefined
  >;

  config = await loadParams(SSM_PREFIX);

  try {
    switch (path) {
      case "live":
        return await handleLive(ev);
      case "day":
      case "month":
      case "year":
        return await handleEnergyPeriod(path, query, ev);
      case "bypass-update":
        return await handleBypassUpdate(ev);
      case "rate-update":
        return await handleRateUpdate(ev);
      default:
        return jsonResponse(404, { error: "unknown route" }, ev);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "internal";
    return jsonResponse(status, { error: message }, ev);
  }
};
