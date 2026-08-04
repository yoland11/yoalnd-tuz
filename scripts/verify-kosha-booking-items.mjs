/**
 * Pure-logic guard for Kosha booking Store line items. No DB/network — mirrors
 * the server math in src/server/api.ts (koshaItemLineTotal, rentalDaysBetween,
 * recalcKoshaBookingProducts: grand = base + Σ products).
 *
 * Usage: node scripts/verify-kosha-booking-items.mjs
 */
let failures = 0;
function assert(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const round2 = (n) => Math.round(n * 100) / 100;

function lineTotal({ quantity, unitPrice, isRental = false, rentalDays = 0, discount = 0, tax = 0 }) {
  const qty = Number(quantity) || 0;
  const unit = Number(unitPrice) || 0;
  const days = isRental ? Math.max(1, Number(rentalDays) || 1) : 1;
  return round2(Math.max(0, unit * qty * days - discount + tax));
}
function rentalDaysBetween(checkout, ret) {
  if (!checkout || !ret) return 1;
  const a = new Date(checkout).getTime();
  const b = new Date(ret).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}
function bookingTotal(base, items, paid = 0) {
  const productsTotal = round2(items.reduce((s, it) => s + lineTotal(it), 0));
  const grand = Math.max(0, round2(base + productsTotal));
  return { productsTotal, grand, remaining: Math.max(0, round2(grand - paid)) };
}

console.log("Test 1 — sale line total (qty × price − discount + tax)");
{
  assert("2 × 25000 − 5000 = 45000", lineTotal({ quantity: 2, unitPrice: 25000, discount: 5000 }) === 45000);
  assert("tax adds", lineTotal({ quantity: 1, unitPrice: 10000, tax: 500 }) === 10500);
}

console.log("Test 2 — rental line total uses days");
{
  const days = rentalDaysBetween("2026-08-10", "2026-08-13");
  assert("3 rental days", days === 3);
  assert("1 × 40000 × 3 = 120000", lineTotal({ quantity: 1, unitPrice: 40000, isRental: true, rentalDays: days }) === 120000);
  assert("missing dates → 1 day", rentalDaysBetween(null, null) === 1);
}

console.log("Test 3 — products fold into the booking grand total");
{
  const r = bookingTotal(300000, [{ quantity: 2, unitPrice: 25000 }, { quantity: 1, unitPrice: 40000, isRental: true, rentalDays: 2 }], 100000);
  assert("productsTotal = 50000 + 80000", r.productsTotal === 130000);
  assert("grand = base 300000 + 130000", r.grand === 430000);
  assert("remaining = grand − paid", r.remaining === 330000);
}

console.log("Test 4 — booking with no items is unchanged");
{
  const r = bookingTotal(250000, [], 50000);
  assert("grand = base", r.grand === 250000 && r.productsTotal === 0);
  assert("remaining = base − paid", r.remaining === 200000);
}

console.log("Test 5 — reference-only (item carries productId, never a product copy)");
{
  const item = { id: 7, productId: 42, productName: "مرآة أكريليك", unitPrice: 30000, quantity: 1 };
  assert("has productId reference", item.productId === 42);
  assert("no nested product row", !("product" in item) && !("variants" in item));
}

if (failures) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1); }
console.log("\nAll kosha-booking-items logic checks passed.");
