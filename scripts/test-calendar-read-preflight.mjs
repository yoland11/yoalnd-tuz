import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
const preflight = api.slice(api.indexOf("export async function handleApi("));
const calendar = readFileSync(new URL("../src/views/admin/calendar.tsx", import.meta.url), "utf8");

assert.match(
  preflight,
  /const isCalendarReadRequest\s*=\s*root === "admin"\s*&&\s*parts\[1\] === "calendar"\s*&&\s*req\.method === "GET"/,
  "Only GET requests to the admin calendar may skip unrelated schema bootstraps",
);
assert.match(
  preflight,
  /const shouldBootstrapAdminSchemas\s*=\s*root === "admin"[\s\S]*?!isCalendarReadRequest/,
  "Calendar reads must not run the broad admin schema bootstrap",
);
assert.match(
  preflight,
  /root === "admin" && !isInvoiceRegisterRequest && !isAdminAuth && !isBookingCenterReadRequest && !isCalendarReadRequest/g,
  "Calendar reads must skip unrelated staff and product schema probes",
);
assert.match(calendar, /\{ data, isLoading, isError, error, refetch \} = useQuery/, "Calendar must keep API failures distinct from empty data");
assert.match(calendar, /isError\s*\?\s*\(/, "Calendar must render an error state");
assert.match(calendar, /onClick=\{\(\) => void refetch\(\)\}/, "Calendar error state must offer a retry");

console.log("Calendar read preflight and error-state guards: PASS");
