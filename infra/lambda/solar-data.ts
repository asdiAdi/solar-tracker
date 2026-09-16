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

  if (!res.ok) {
    throw new Error(JSON.stringify(res.body));
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Solar totals (SolarMAN only). Bypass is NOT here on purpose: it comes from
// the manual meter and is combined with import exactly once in costFor.
// ---------------------------------------------------------------------------
interface SolarTotals {
  generated_kwh: number;
  consumed_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
}

const ZERO_SOLAR: SolarTotals = {
  generated_kwh: 0,
  consumed_kwh: 0,
  grid_import_kwh: 0,
  grid_export_kwh: 0,
};

function sumSolar(raw: SolarmanHistoricalResponse): SolarTotals {
  let generated = 0;
  let consumed = 0;
  let gridImport = 0;
  let gridExport = 0;
  for (const entry of raw?.paramDataList ?? []) {
    const m = toKeyValueMap(entry?.dataList ?? []);
    generated += toNumber(m.generation);
    consumed += toNumber(m.consumption);
    gridImport += toNumber(m.purchase);
    gridExport += toNumber(m.grid);
  }
  return {
    generated_kwh: round1(generated),
    consumed_kwh: round1(consumed),
    grid_import_kwh: round1(gridImport),
    grid_export_kwh: round1(gridExport),
  };
}

function addSolar(a: SolarTotals, b: SolarTotals): SolarTotals {
  return {
    generated_kwh: round1(a.generated_kwh + b.generated_kwh),
    consumed_kwh: round1(a.consumed_kwh + b.consumed_kwh),
    grid_import_kwh: round1(a.grid_import_kwh + b.grid_import_kwh),
    grid_export_kwh: round1(a.grid_export_kwh + b.grid_export_kwh),
  };
}

async function loadSolarRange(
  key: string, // key e.g: day:2023-02-02
  ts: string, // timestamp
  ttlSec: number | null, //timeToLive, only on current date/month/year
  start: string,
  end: string,
): Promise<{ solar: SolarTotals; ts: string; ttlSec: number | null }> {
  // check if its already in cache
  const cached = await cacheGet<{
    raw: SolarmanHistoricalResponse;
    start: string;
    end: string;
    ts?: string;
  }>(key);
  if (cached?.raw && cached.start === start && cached.end === end) {
    return { solar: sumSolar(cached.raw), ts: cached.ts ?? ts, ttlSec };
  }

  // fetch if not found in cache
  const raw = await fetchBillingPeriod(getParam("DEVICE_SN"), start, end);
  await cacheSet(key, { raw, start, end, ts }, ttlSec);
  return { solar: sumSolar(raw), ts, ttlSec };
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

  // THE one place import is subtracted: the meter sees the whole house
  // (bypass_kwh is gross), SolarMAN already counted part of that grid power
  // as import, so net new grid power = gross - import (floored at 0 for
  // stale manual readings).
  const bypassNetKwh = Math.max(
    0,
    round1(energy.bypass_kwh - energy.grid_import_kwh),
  );
  const consumed_php = Math.round(energy.consumed_kwh * rate_php_per_kwh);
  const bypass_php = Math.round(bypassNetKwh * rate_php_per_kwh);
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

const currentYear = () => manilaToday().y;

/** Billing month YYYY-MM means window [prevMonth-17, month-16] inclusive, Manila. */
function billingWindowForMonth(mm: string): { start: string; end: string } {
  const [y, m] = mm.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, 1));
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const py = prev.getUTCFullYear();
  const pm = prev.getUTCMonth() + 1;
  return {
    start: `${py}-${pad2(pm)}-17`,
    end: `${y}-${pad2(m)}-16`,
  };
}

/** Billing mm containing today: d<=16 -> calendar month, else next month. */
function billingCurrentMonth(): string {
  const t = manilaToday();
  if (t.d <= 16) return `${t.y}-${pad2(t.m)}`;
  const dt = new Date(Date.UTC(t.y, t.m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
}

function normalizeMm(mm: string | undefined, fallback: string): string {
  if (mm && /^\d{4}-\d{2}$/.test(mm)) {
    const m = Number(mm.slice(5, 7));
    if (m >= 1 && m <= 12) return mm;
  }
  return fallback;
}

// count number of day from start to end inclusive e.g: 09-01 to 09-16 is 16 days
function inclusiveDayCount(start: string, end: string): number {
  return isoToDay(end) - isoToDay(start) + 1;
}

/**
 * Single call when <=30 days inclusive, else split at the calendar month
 * Reason being Solarman API only accepts 30 days... but some months are 31 days :(
 * Billing window is 17th day current month to 16th day of next month
 */
async function fetchBillingPeriod(
  deviceSn: string,
  start: string,
  end: string,
): Promise<SolarmanHistoricalResponse> {
  if (end < start) return { paramDataList: [] }; // unreachable but you never know

  const fetchRaw = (
    deviceSn: string,
    timeType: number,
    startTime: string,
    endTime: string,
  ) =>
    solarmanPost<SolarmanHistoricalResponse>("device/v1.0/historical", {
      deviceSn,
      timeType,
      startTime,
      endTime,
    });

  // single call because it's <= 30, this is only used in fetching a single day
  if (inclusiveDayCount(start, end) <= 30) {
    return fetchRaw(deviceSn, 2, start, end);
  }

  // splits call into 2 eg:
  // 03-17 to 04-16
  // will call [03-17 to 03-31] and [04-01 to 04-16]
  const [y, m] = start.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // last day of prev month
  const partAEnd = `${y}-${pad2(m)}-${pad2(last)}`;
  const partBStart = `${end.slice(0, 7)}-01`; // first day of next month

  const [a, b] = await Promise.all([
    fetchRaw(deviceSn, 2, start, partAEnd),
    fetchRaw(deviceSn, 2, partBStart, end),
  ]);

  // merge the outputs
  const merged: SolarmanHistoricalResponse["paramDataList"] = [];
  for (const p of [a, b]) {
    for (const entry of p?.paramDataList ?? []) merged.push(entry);
  }
  return { paramDataList: merged };
}

function monthInfo(month: string | undefined) {
  const mm = normalizeMm(month, billingCurrentMonth());
  const { start, end } = billingWindowForMonth(mm);
  const today = todayIso();
  const isFuture = start > today;
  const isCurrent = !isFuture && end >= today;
  const cappedEnd = isFuture ? end : end < today ? end : today;
  const ts = `${cappedEnd}T00:00:00+08:00`;
  return {
    key: `month:${mm}`,
    ts,
    isCurrent,
    isFuture,
    ttlSec: isCurrent ? MONTH_TTL_SEC : null,
    mm,
    start,
    end,
    cappedEnd,
    elapsedDays: isFuture ? 0 : inclusiveDayCount(start, cappedEnd),
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

// ---------------------------------------------------------------------------
// Manual bypass meter: cumulative readings -> kWh/day -> gross kWh estimate.
// Always extrapolates from the latest segment (stale readings accepted).
// Returns GROSS house-meter kWh; import is subtracted later, once, in costFor.
// ---------------------------------------------------------------------------
function meterDailyRate(readings: BypassReading[]): number {
  if (readings.length < 2) return 0;
  const first = readings[0];
  const last = readings[readings.length - 1];
  const prev = readings[readings.length - 2];
  const segSpan = last.day - prev.day;
  if (segSpan > 0 && last.cum > prev.cum) {
    return (last.cum - prev.cum) / segSpan;
  }
  const fullSpan = last.day - first.day;
  if (fullSpan > 0 && last.cum > first.cum) {
    return (last.cum - first.cum) / fullSpan;
  }
  return 0;
}

function meterGrossKwh(readings: BypassReading[], days: number): number {
  if (days <= 0) return 0;
  return round1(meterDailyRate(readings) * days);
}

// ---------------------------------------------------------------------------
// Period builders. Each returns solar totals + GROSS bypass for its window.
// Billing month YYYY-MM = [prevMonth-17, month-16] inclusive (Manila).
// ---------------------------------------------------------------------------
async function energyForDay(date: string): Promise<PeriodResult> {
  // validates and normalizes date into iso format "YYYY-MM-DD"
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const iso = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  const isCurrent = iso === todayIso();

  const readings = await loadBypassReadings();
  const { solar, ts, ttlSec } = await loadSolarRange(
    `data:${iso}`,
    `${iso}T00:00:00+08:00`,
    isCurrent ? DAY_TTL_SEC : null,
    iso,
    iso,
  );
  return {
    energy: { ...solar, bypass_kwh: meterGrossKwh(readings, 1) },
    ts,
    ttlSec,
  };
}

async function energyForMonth(
  month: string | undefined,
): Promise<PeriodResult> {
  const info = monthInfo(month);
  if (info.isFuture) {
    return {
      energy: { ...ZERO_SOLAR, bypass_kwh: 0 },
      ts: info.ts,
      ttlSec: info.ttlSec,
    };
  }
  const readings = await loadBypassReadings();
  const { solar, ts, ttlSec } = await loadSolarRange(
    info.key,
    info.ts,
    info.ttlSec,
    info.start,
    info.cappedEnd,
  );
  return {
    energy: { ...solar, bypass_kwh: meterGrossKwh(readings, info.elapsedDays) },
    ts,
    ttlSec,
  };
}

function billingMonthsForYear(y: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${y}-${pad2(i + 1)}`);
}

function billingYearContainsToday(y: number, today: string): boolean {
  return billingMonthsForYear(y).some((mm) => {
    const w = billingWindowForMonth(mm);
    return w.start <= today && w.end >= today;
  });
}

async function energyForYear(year: string | undefined): Promise<PeriodResult> {
  const y = Number(year ?? billingCurrentMonth().slice(0, 4)) || currentYear();
  const key = `year:${y}`;
  const ts = `${y}-12-16T00:00:00+08:00`;
  const today = todayIso();
  const isCurrentYear = billingYearContainsToday(y, today);
  const ttlSec = isCurrentYear ? YEAR_TTL_SEC : null;

  // Past years never change: serve the cached aggregate.
  if (!isCurrentYear) {
    const cached = await cacheGet<{ energy: EnergyTotals; ts: string }>(key);
    if (cached?.energy) return { energy: cached.energy, ts, ttlSec };
  }

  // Current year always recomputed so the growing partial month stays fresh.
  // Each billing month shares its cache entry with the month view.
  const readings = await loadBypassReadings();
  let solar = { ...ZERO_SOLAR };
  let elapsedDays = 0;
  for (const mm of billingMonthsForYear(y)) {
    const info = monthInfo(mm);
    if (info.isFuture) continue;
    const r = await loadSolarRange(
      info.key,
      info.ts,
      info.ttlSec,
      info.start,
      info.cappedEnd,
    );
    solar = addSolar(solar, r.solar);
    elapsedDays += info.elapsedDays;
  }
  const energy: EnergyTotals = {
    ...solar,
    bypass_kwh: meterGrossKwh(readings, elapsedDays),
  };
  if (!isCurrentYear) await cacheSet(key, { energy, ts }, ttlSec);
  return { energy, ts, ttlSec };
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
  let body: SolarmanLiveResponse;
  const cached = await cacheGet<SolarmanLiveResponse>("live");
  if (cached) {
    body = cached;
  } else {
    body = await solarmanPost("device/v1,0/currentData", {
      deviceSn: getParam("DEVICE_SN"),
    });
    await cacheSet("live", body, LIVE_TTL_SEC);
  }

  const m = toKeyValueMap(body.dataList);

  const data = {
    solar_w: Math.round(
      toNumber(m.DP1) + toNumber(m.DP2) + toNumber(m.DP3) + toNumber(m.DP4),
    ),
    home_w: Math.round(toNumber(m.E_Puse_t1 ?? m.C_P_L1)),
    grid_w: Math.round(toNumber(m.T_A_P_O_G ?? m.UAP1)),
    battery_w: Math.round(-toNumber(m.B_P1)),
    battery_soc_pct: Math.round(toNumber(m.B_left_cap1)),
  };

  const t = manilaToday();
  const rates = await loadElecRates();
  return jsonResponse(
    200,
    {
      timestamp: `${t.y}-${pad2(t.m)}-${pad2(t.d)}T00:00:00+08:00`,
      live: data,
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
      ? await energyForDay(query.date ?? todayIso())
      : period === "month"
        ? await energyForMonth(query.month)
        : await energyForYear(query.year);

  const rates = await loadElecRates();
  const rate =
    period === "year"
      ? avgRateForYear(
          rates,
          /^\d{4}$/.test(query.year ?? "")
            ? String(query.year)
            : billingCurrentMonth().slice(0, 4),
        )
      : period === "month"
        ? rateForMonth(rates, normalizeMm(query.month, billingCurrentMonth()))
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
  const fullPath = ev.path ?? ev.rawPath ?? "";
  const path = fullPath.replace(/\/$/, "").split("/").pop() ?? "";

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
    return jsonResponse(500, { error: JSON.stringify(e) }, ev);
  }
};
