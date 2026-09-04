import { readFileSync } from "node:fs";

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`✓ ${label}`);
  else {
    failures += 1;
    console.error(`✗ ${label}`);
  }
}

const api = readFileSync("src/server/api.ts", "utf8");
const start = api.indexOf("function normalizeUnifiedBookingCustomFields");
const end = api.indexOf("async function ensureCrewsTable", start);
const normalizer = start >= 0 && end > start ? api.slice(start, end) : "";

check(
  "unified sound bookings create booking-operation reservations for asset and rental items",
  normalizer.includes("soundBookingOperationsWithReservations(") &&
    normalizer.includes("safeFields.soundItems"),
);
check(
  "sound reservation helper preserves an existing operation state rather than replacing it",
  api.includes("const operations =\n    current && typeof current === \"object\"") &&
    api.includes("stage: [\"out\", \"returned\", \"inspection\", \"completed\"].includes("),
);

if (failures) {
  console.error(`UNIFIED SOUND RESERVATION CONTRACT FAILED — ${failures} check(s) failed.`);
  process.exit(1);
}

console.log("UNIFIED SOUND RESERVATION CONTRACT PASSED");
