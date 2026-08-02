/**
 * Pure-logic guard for the Graduation Extras step (flowers + photography).
 * No database, no network — mirrors the server math/rules in
 * src/server/graduation.ts (flower pricing folds into the order total),
 * photography-booking-integration.ts (time-overlap conflict), and
 * graduation-enterprise.ts (kit checklist gains Bouquet/Photography).
 *
 * Usage: node scripts/verify-graduation-extras.mjs
 */

let failures = 0;
function assert(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const round2 = (n) => Math.round(n * 100) / 100;

// Mirror of createOrder pricing: total = base + Σflowers − discount.
function orderTotal({ base, flowers = [], discount = 0 }) {
  const flowersTotal = round2(flowers.reduce((s, f) => s + f.unit * f.quantity, 0));
  const subtotal = base + flowersTotal;
  return { flowersTotal, total: Math.max(0, round2(subtotal - discount)) };
}
// Mirror of findPhotographerConflict overlap test.
function conflicts(existing, next) {
  const start = next.start || "00:00";
  const end = next.end || "23:59";
  return existing.some((row) => {
    if (row.date !== next.date) return false;
    const os = row.start || "00:00";
    const oe = row.end || "23:59";
    return start < oe && os < end;
  });
}
// Mirror of componentDefinitions extras branch.
function checklistExtras(extras) {
  const out = [];
  const flowers = extras.flowers || {};
  if (Number(flowers.count) > 0 || (flowers.names || []).length) out.push("bouquet");
  if (extras.photography) out.push("photography");
  return out;
}

console.log("Test 1 — flowers fold into the order total");
{
  const r = orderTotal({ base: 150000, flowers: [{ unit: 25000, quantity: 1 }, { unit: 10000, quantity: 2 }], discount: 5000 });
  assert("flowersTotal = 25000 + 20000", r.flowersTotal === 45000);
  assert("total = 150000 + 45000 − 5000", r.total === 190000);
}

console.log("Test 2 — order with no flowers is unchanged");
{
  const r = orderTotal({ base: 120000, flowers: [], discount: 0 });
  assert("total = base", r.total === 120000 && r.flowersTotal === 0);
}

console.log("Test 3 — photographer double-booking detection");
{
  const existing = [{ date: "2026-08-10", start: "10:00", end: "12:00" }];
  assert("overlapping slot conflicts", conflicts(existing, { date: "2026-08-10", start: "11:00", end: "13:00" }) === true);
  assert("non-overlapping slot is free", conflicts(existing, { date: "2026-08-10", start: "12:30", end: "13:30" }) === false);
  assert("different day is free", conflicts(existing, { date: "2026-08-11", start: "10:00", end: "12:00" }) === false);
}

console.log("Test 4 — kit checklist gains Bouquet / Photography");
{
  assert("flowers → bouquet on checklist", checklistExtras({ flowers: { count: 3, names: ["ورد أحمر"] } }).includes("bouquet"));
  assert("photography → photography on checklist", checklistExtras({ photography: { serviceOrderId: 5 } }).includes("photography"));
  assert("no extras → neither", checklistExtras({}).length === 0);
}

if (failures) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1); }
console.log("\nAll graduation-extras logic checks passed.");
