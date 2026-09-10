import { readFileSync } from "node:fs";

const api = readFileSync("src/server/api.ts", "utf8");
const schema = readFileSync("lib/db/src/schema/services.ts", "utf8");

const trackingLimit = Number(
  schema.match(/trackingCode:\s*varchar\("tracking_code",\s*\{\s*length:\s*(\d+)/)?.[1],
);
const phoneTracking = api.slice(
  api.indexOf("function trackingCodeForPhone"),
  api.indexOf("function isSecureTrackingCode"),
);
const randomBytes = Number(
  phoneTracking.match(/randomBytes\((\d+)\)/)?.[1] ??
    api.match(/function generateTrackingCode[\s\S]*?randomBytes\((\d+)\)/)?.[1],
);
const phoneTrackingLength = "AJN-0000-".length + randomBytes * 2;
const errorMapper = api.slice(
  api.indexOf("function serviceBookingSaveError"),
  api.indexOf("function parseStoreItemMetadata"),
);

const checks = [
  [
    "phone-aware tracking code fits service_orders.tracking_code",
    Number.isFinite(trackingLimit) &&
      Number.isFinite(randomBytes) &&
      phoneTrackingLength <= trackingLimit,
    `generated=${phoneTrackingLength}, column=${trackingLimit}`,
  ],
  [
    "booking error mapping reads a nested PostgreSQL cause",
    /wrapped\?\.cause\s*\?\?\s*wrapped/.test(errorMapper),
    "Drizzle may expose PostgreSQL code through error.cause.code",
  ],
  [
    "booking failure log uses the safe nested server error helper",
    /safeServerError\(err\)[\s\S]{0,200}?admin service booking core save failed/.test(api),
    "server logs need safe PostgreSQL diagnostics",
  ],
];

let failed = false;
for (const [name, passed, detail] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
