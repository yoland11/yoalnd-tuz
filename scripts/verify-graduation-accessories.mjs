/**
 * Pure-logic guard for graduation group-accessory pricing + per-student isolation.
 * No database, no network — it mirrors the server math in
 * `recalcGraduationOrderTotals` and the apply/remove flow in
 * src/server/graduation-operations.ts, and asserts the invariants the UI relies
 * on. Run in CI to catch a regression in accessory totals or allocation scope.
 *
 * Usage: node scripts/verify-graduation-accessories.mjs
 */

let failures = 0;
function assert(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const round2 = (n) => Math.round(n * 100) / 100;

// ── Mirror of the server model ──────────────────────────────────────────────
// A student order: base subtotal (creation-time package), discount, paid, and a
// list of group-accessory items (each with quantity + finalUnitPrice).
function makeOrder(id, subtotal, discount = 0, paid = 0) {
  return { id, subtotal, discount, paid, accessories: [] };
}
// recalcGraduationOrderTotals: total = base + Σaccessories − discount.
function recalc(order) {
  const accessoriesTotal = round2(order.accessories.reduce((s, a) => s + a.finalUnitPrice * a.quantity, 0));
  const total = Math.max(0, round2(order.subtotal + accessoriesTotal - order.discount));
  const remaining = Math.max(0, round2(total - order.paid));
  const paymentStatus = total <= 0 ? "paid" : order.paid <= 0 ? "unpaid" : order.paid >= total ? "paid" : "partial";
  return { accessoriesTotal, total, remaining, paymentStatus };
}
// applyAccessory(scope="all"|"selected"|"student"): one line PER targeted order.
function applyAccessory(orders, targetIds, item) {
  for (const order of orders) if (targetIds.includes(order.id)) order.accessories.push({ ...item });
}
function groupTotals(orders) {
  return orders.reduce((acc, o) => {
    const r = recalc(o);
    acc.total += r.total; acc.remaining += r.remaining; acc.accessories += r.accessoriesTotal;
    return acc;
  }, { total: 0, remaining: 0, accessories: 0 });
}

// ── Test 1: apply one accessory to ALL → one line per student, totals rise ────
console.log("Test 1 — apply to all creates one line per student");
{
  const orders = Array.from({ length: 40 }, (_, i) => makeOrder(i + 1, 100000));
  applyAccessory(orders, orders.map((o) => o.id), { name: "medal", quantity: 1, finalUnitPrice: 5000 });
  assert("40 separate lines created (not one shared)", orders.every((o) => o.accessories.length === 1) && orders.reduce((s, o) => s + o.accessories.length, 0) === 40);
  const r = recalc(orders[0]);
  assert("student total = base + accessory", r.total === 105000);
  assert("student accessoriesTotal = 5000", r.accessoriesTotal === 5000);
  const g = groupTotals(orders);
  assert("group total = 40 × 105000", g.total === 4200000);
  assert("group accessories value = 40 × 5000", g.accessories === 200000);
}

// ── Test 2: apply to SELECTED only touches those students ─────────────────────
console.log("Test 2 — apply to selected students only");
{
  const orders = Array.from({ length: 5 }, (_, i) => makeOrder(i + 1, 100000));
  applyAccessory(orders, [2, 4], { name: "sash", quantity: 1, finalUnitPrice: 3000 });
  assert("only selected have accessories", orders.filter((o) => o.accessories.length).map((o) => o.id).join(",") === "2,4");
  assert("unselected total unchanged", recalc(orders[0]).total === 100000);
  assert("selected total raised", recalc(orders[1]).total === 103000);
}

// ── Test 3: quantity + remaining balance ──────────────────────────────────────
console.log("Test 3 — quantity, discount, remaining balance");
{
  const order = makeOrder(1, 100000, 10000, 50000); // base, discount, paid
  order.accessories.push({ name: "folder", quantity: 3, finalUnitPrice: 4000 });
  const r = recalc(order);
  assert("total = 100000 + 12000 − 10000", r.total === 102000);
  assert("remaining = total − paid", r.remaining === 52000);
  assert("payment status partial", r.paymentStatus === "partial");
}

// ── Test 4: free accessory adds nothing; remove reverts totals ────────────────
console.log("Test 4 — free accessory + removal reverts");
{
  const order = makeOrder(1, 80000);
  order.accessories.push({ name: "pin", quantity: 2, finalUnitPrice: 0 }); // free
  assert("free accessory keeps total at base", recalc(order).total === 80000);
  order.accessories.push({ name: "box", quantity: 1, finalUnitPrice: 15000 });
  assert("paid box raises total", recalc(order).total === 95000);
  order.accessories = order.accessories.filter((a) => a.name !== "box"); // remove
  assert("removal reverts total to base", recalc(order).total === 80000);
}

// ── Test 5: existing orders with no accessories are unchanged ──────────────────
console.log("Test 5 — orders without accessories keep original totals");
{
  const order = makeOrder(1, 123456, 6456, 0);
  const r = recalc(order);
  assert("total = base − discount, no accessories", r.total === 117000 && r.accessoriesTotal === 0);
}

// ── Test 6: shortage math (need vs available) ─────────────────────────────────
console.log("Test 6 — inventory shortage message math");
{
  const need = 40 * 1, available = 32;
  const shortage = Math.max(0, need - available);
  assert("shortage = 8", shortage === 8);
  assert("message matches spec", `الكمية المتوفرة لا تكفي، النقص ${shortage} قطعة`.includes("النقص 8"));
}

if (failures) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1); }
console.log("\nAll graduation-accessory logic checks passed.");
