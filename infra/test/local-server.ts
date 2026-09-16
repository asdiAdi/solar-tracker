/**
 * Runs Lambda `handler` as a plain HTTP server on your machine, hitting
 * REAL SSM, REAL DynamoDB, and the REAL Solarman API.
 *
 * Setup
 *   npm i -D tsx
 *   Create a .env.local file
 *
 *   npx tsx watch --env-file=.env.local local-server.ts
 *
 *   curl http://localhost:4000/live
 *   curl "http://localhost:4000/day?date=2026-09-01"
 */

import http from "node:http";

for (const key of ["SSM_PREFIX", "TABLE_NAME", "ALLOWED_ORIGINS"]) {
  if (!process.env[key]) {
    throw new Error(
      `Missing ${key}. Set it in .env.local (see bottom of this file) or export it before running.`,
    );
  }
}

const { handler } = await import("../lambda/solar-data.ts");

const PORT = 4000;
const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const queryStringParameters: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (queryStringParameters[k] = v));

  const event = {
    path: url.pathname,
    rawPath: url.pathname,
    httpMethod: req.method,
    headers: req.headers,
    queryStringParameters,
    body: rawBody || undefined,
  };

  console.log(`\n→ ${req.method} ${url.pathname}${url.search}`);

  try {
    const result = await handler(event as any);
    console.log(`← ${result.statusCode}`);
    res.writeHead(result.statusCode, result.headers as any);
    res.end(result.body);
  } catch (err) {
    console.error("  [local-server] handler threw:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "local-server crash", detail: String(err) }),
    );
  }
});

server.listen(PORT, () => {
  console.log(`Local lambda dev server on http://localhost:${PORT}`);
  console.log(`Try:  curl http://localhost:${PORT}/live`);
});
