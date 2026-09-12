// Live fetch test: invokes the real Lambda handler against SolarMAN and logs output.
// Needs env: SOLARMAN_TOKEN=<bearer> DEVICE_SN=<sn> [SOLARMAN_BASE_URL=...] [ROUTE=live|day] [DATE=YYYY-MM-DD]
// Run: SOLARMAN_TOKEN=xxx DEVICE_SN=yyy npm run test:live
// NOTE: hits the real SolarMAN API. Output is logged, not asserted.
import * as dotenv from "dotenv";
dotenv.config();

import { execSync } from "node:child_process";

execSync(
  "npx esbuild infra/backend/lambda/solar-data.ts --bundle --platform=node --target=node24 --format=cjs --outfile=/tmp/solar-data.cjs --external:aws-sdk",
  { stdio: "pipe" },
);
const { handler } = await import("/tmp/solar-data.cjs");

const route = process.env.ROUTE ?? "live";
const path = `/${route}`;
const queryStringParameters =
  route === "day" ? { date: process.env.DATE ?? "2026-09-08" } : {};

const res = await handler({ path, queryStringParameters }, {});
console.log("STATUS:", res.statusCode);
console.log(JSON.stringify(JSON.parse(res.body), null, 2));
