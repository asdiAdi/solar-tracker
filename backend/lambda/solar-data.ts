import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const BASE = (process.env.SOLARMAN_BASE_URL ?? 'https://globalapi.solarmanpv.com').replace(/\/$/, '');
const TOKEN = () => process.env.SOLARMAN_TOKEN ?? '';
const DEVICE_SN = () => process.env.DEVICE_SN ?? '';
const RATE = Number(process.env.GRID_PHP_PER_KWH ?? '12');
const TZ = 'Asia/Manila';
const r1 = (n: number) => Math.round(n * 10) / 10;

let liveCache: { at: number; body: any } | null = null;

async function sm(path: string, body: any) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    const e: any = new Error('solarman-unauthorized'); e.status = 502; throw e;
  }
  if (!res.ok) { const e: any = new Error(`solarman ${res.status}`); e.status = 502; throw e; }
  return res.json() as any;
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function kv(dataList: any[] = []) {
  const m: Record<string, string> = {};
  for (const d of dataList) if (d?.key) m[d.key] = d.value;
  return m;
}

export function mapLive(body: any) {
  const m = kv(body?.dataList);
  const solar_kw = r1((num(m.DP1) + num(m.DP2) + num(m.DP3) + num(m.DP4)) / 1000);
  const home_kw = r1(num(m.E_Puse_t1 ?? m.C_P_L1) / 1000);
  const grid_kw = r1(num(m.T_A_P_O_G ?? m.UAP1) / 1000);
  const battery_kw = r1(-num(m.B_P1) / 1000); // device + = discharging; contract + = charging
  const battery_soc_pct = Math.round(num(m.B_left_cap1));
  return { solar_kw, home_kw, grid_kw, battery_kw, battery_soc_pct };
}

export function sumHistorical(lists: any[][]) {
  const t = { generated_kwh: 0, consumed_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 };
  for (const dl of lists) {
    const m: Record<string, string> = {};
    for (const d of dl ?? []) if (d?.key) m[d.key] = d.value;
    t.generated_kwh += num(m.generation);
    t.consumed_kwh += num(m.consumption);
    t.grid_import_kwh += num(m.purchase);
    t.grid_export_kwh += num(m.grid);
  }
  return { generated_kwh: r1(t.generated_kwh), consumed_kwh: r1(t.consumed_kwh), grid_import_kwh: r1(t.grid_import_kwh), grid_export_kwh: r1(t.grid_export_kwh) };
}

// --- Manila span helpers (offset-aware) ---
function manilaParts(d: Date) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, dd] = f.format(d).split('-').map(Number);
  return { y, m, d: dd };
}
function manilaToday(offsetDays = 0) {
  const p = manilaParts(new Date(Date.now() + offsetDays * 864e5));
  return p;
}
const pad = (n: number) => String(n).padStart(2, '0');

async function histChunk(sn: string, timeType: number, startTime: string, endTime: string) {
  const j = await sm('/device/v1.0/historical', { deviceSn: sn, timeType, startTime, endTime });
  return (j?.paramDataList ?? []).map((p: any) => p.dataList);
}

async function energyFor(kind: 'day' | 'month' | 'year', date?: string, month?: string, year?: string, offset = 0) {
  const sn = DEVICE_SN();
  if (kind === 'day') {
    const base = date ?? `${manilaToday().y}-${pad(manilaToday().m)}-${pad(manilaToday().d)}`;
    const [y, m, d] = base.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + offset));
    const iso = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    const lists = await histChunk(sn, 2, iso, iso);
    return { energy: sumHistorical(lists), ts: `${iso}T00:00:00+08:00` };
  }
  if (kind === 'month') {
    const base = month ?? `${manilaToday().y}-${pad(manilaToday().m)}`;
    let [y, m] = base.split('-').map(Number);
    const tot = (y * 12 + (m - 1)) + offset;
    y = Math.floor(tot / 12); m = (tot % 12) + 1;
    const mm = `${y}-${pad(m)}`;
    const lists = await histChunk(sn, 3, mm, mm);
    // timeType=3 same-month returns daily rows; sum all
    return { energy: sumHistorical(lists), ts: `${mm}-01T00:00:00+08:00` };
  }
  const baseY = Number(year ?? manilaToday().y) + offset;
  const lists = await histChunk(sn, 4, String(baseY), String(baseY));
  return { energy: sumHistorical(lists), ts: `${baseY}-01-01T00:00:00+08:00` };
}

async function getLive() {
  if (liveCache && Date.now() - liveCache.at < 60_000) return liveCache.body;
  const body = await sm('/device/v1.0/currentData', { deviceSn: DEVICE_SN() });
  liveCache = { at: Date.now(), body };
  return body;
}

export const handler = async (ev: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const json = (s: number, b: any): APIGatewayProxyResult => ({
    statusCode: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b),
  });
  try {
    const path = (ev.path ?? '').replace(/\/$/, '').split('/').pop();
    const q = ev.queryStringParameters ?? {};
    const offset = Number(q.offset ?? '0') || 0;
    const liveBody = await getLive();
    const live = mapLive(liveBody);
    let energy, timestamp: string;
    if (path === 'live') {
      // energy = today-so-far totals from currentData daily keys as fallback-safe snapshot
      const m = kv(liveBody?.dataList);
      energy = {
        generated_kwh: r1(num(m.Etdy_ge1)), consumed_kwh: r1(num(m.Etdy_use1)),
        grid_import_kwh: r1(num(m.Etdy_pu1)), grid_export_kwh: r1(num(m.t_gc_tdy1)),
      };
      const t = manilaToday();
      timestamp = `${t.y}-${pad(t.m)}-${pad(t.d)}T00:00:00+08:00`;
    } else if (path === 'day' || path === 'month' || path === 'year') {
      const r = await energyFor(path, q.date, q.month, q.year, offset);
      energy = r.energy; timestamp = r.ts;
    } else return json(404, { error: 'unknown route' });
    const cost = {
      grid_import_php: Math.round(energy.grid_import_kwh * RATE),
      saved_php: Math.round(Math.max(0, energy.generated_kwh - energy.grid_export_kwh) * RATE * 0.9),
    };
    return json(200, { timestamp, live, energy, cost });
  } catch (e: any) {
    return json(e?.status ?? 500, { error: e?.message ?? 'internal' });
  }
};
