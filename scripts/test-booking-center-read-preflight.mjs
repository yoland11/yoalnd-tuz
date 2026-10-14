import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
const preflight = api.slice(api.indexOf("export async function handleApi("));

assert.match(
  preflight,
  /const isBookingCenterReadRequest\s*=\s*root === "admin"\s*&&\s*parts\[1\] === "booking-center"\s*&&\s*req\.method === "GET"/,
  "Only GET requests to the admin booking center may skip unrelated schema bootstraps",
);
assert.match(
  preflight,
  /const shouldBootstrapAdminSchemas\s*=\s*root === "admin"\s*&&\s*!isAdminAuth\s*&&\s*!isInvoiceRegisterRequest\s*&&\s*!isBookingCenterReadRequest/,
  "Booking-center reads must not trigger the broad admin schema bootstrap",
);
assert.equal(
  (preflight.match(/root === "admin" && !isInvoiceRegisterRequest && !isAdminAuth && !isBookingCenterReadRequest/g) ?? []).length,
  2,
  "Booking-center reads must skip both unrelated staff and product schema probes",
);

console.log("Booking center GET preflight isolation: PASS");
