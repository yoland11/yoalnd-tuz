/** Pure warehouse rules: the main warehouse owns the remainder and totals can never double. */
import assert from "node:assert/strict";
import { assertDeltasMatchCompany, consumeOutstanding, lineAllocations, lineForWarehouse, planWarehouseTransfer, rebalanceAllocations, warehouseBreakdown } from "../src/lib/warehouse-stock";

const warehouses = [{ id: 1, name: "المخزن الرئيسي" }, { id: 2, name: "المخزن الثاني" }];
const company = { inWarehouse: 100, checkedOut: 0, damaged: 0, maintenance: 0, missing: 0 };

// The spec's example: existing stock belongs to main, a new warehouse starts at zero, never 200.
let split = warehouseBreakdown({ company, rows: [], warehouses, mainId: 1 });
assert.equal(split.shares[0].inWarehouse, 100);
assert.equal(split.shares[1].inWarehouse, 0);
assert.equal(split.shares.reduce((sum, row) => sum + row.inWarehouse, 0), 100, "company total is unchanged");

// A stale main-warehouse row from the old mirror is never counted.
split = warehouseBreakdown({ company, rows: [{ warehouseId: 1, inWarehouse: 100 }], warehouses, mainId: 1 });
assert.equal(split.shares[0].inWarehouse, 100, "the old main mirror cannot double the stock");

// After moving 40.
split = warehouseBreakdown({ company, rows: [{ warehouseId: 2, inWarehouse: 40 }], warehouses, mainId: 1 });
assert.deepEqual(split.shares.map((row) => row.inWarehouse), [60, 40]);
assert.equal(split.overdrawn.inWarehouse, 0);

// A claim above the company figure is reported, not hidden and not negative.
split = warehouseBreakdown({ company: { ...company, inWarehouse: 30 }, rows: [{ warehouseId: 2, inWarehouse: 40 }], warehouses, mainId: 1 });
assert.equal(split.shares[0].inWarehouse, 0);
assert.equal(split.overdrawn.inWarehouse, 10);

// Damaged units split the same way.
split = warehouseBreakdown({ company: { ...company, damaged: 5 }, rows: [{ warehouseId: 2, inWarehouse: 0, damaged: 2 }], warehouses, mainId: 1 });
assert.deepEqual(split.shares.map((row) => row.damaged), [3, 2]);

// Transfers.
const base = { fromWarehouseId: 1, toWarehouseId: 2, quantity: 20, sourceShelf: 100 };
const planned = planWarehouseTransfer(base);
assert.ok(planned.ok);
if (planned.ok) {
  assert.deepEqual(planned.deltas, [{ warehouseId: 1, inWarehouse: -20 }, { warehouseId: 2, inWarehouse: 20 }]);
  assert.equal(assertDeltasMatchCompany(planned.deltas, company, company), null, "a transfer nets to zero");
}
assert.deepEqual(planWarehouseTransfer({ ...base, toWarehouseId: 1 }), { ok: false, message: "المخزن المصدر والمستلم يجب أن يكونا مختلفين", status: 422 });
for (const quantity of [0, -5, 1.5]) assert.equal(planWarehouseTransfer({ ...base, quantity }).ok, false, `quantity ${quantity}`);
const short = planWarehouseTransfer({ ...base, quantity: 101 });
assert.ok(!short.ok && short.status === 409 && short.message.includes("المتاح 100"));
const held = planWarehouseTransfer({ ...base, quantity: 90, sourceUsable: 100, sourceCommitted: 30 });
assert.ok(!held.ok && held.status === 409 && held.message.includes("محجوزة"), "reserved units cannot be transferred away");
assert.ok(planWarehouseTransfer({ ...base, quantity: 70, sourceUsable: 100, sourceCommitted: 30 }).ok);

// Deltas that do not explain the company change are caught.
assert.ok(assertDeltasMatchCompany([{ warehouseId: 1, inWarehouse: -5 }], company, company));

// Booking lines: an old line stays with its warehouse, a split is honoured per warehouse.
const legacy = { trackingMode: "quantity", quantity: 30, reservedQty: 30, checkedOutQty: 10, returnedGoodQty: 4, stage: "out" };
assert.deepEqual(lineAllocations(legacy, 1), { 1: { reserved: 30, checkedOut: 10, returned: 4 } });
assert.equal(lineForWarehouse(legacy, 2, 1), null, "a line saved before warehouses is not the second warehouse's");
const split2 = { ...legacy, warehouseAllocations: { 1: { reserved: 20, checkedOut: 10, returned: 4 }, 2: { reserved: 10, checkedOut: 0, returned: 0 } } };
assert.equal(lineForWarehouse(split2, 2, 1)?.reservedQty, 10);
assert.equal(lineForWarehouse(split2, 1, 1)?.checkedOutQty, 10);

// A return comes off the warehouses the units left from.
assert.deepEqual(consumeOutstanding({ 1: { reserved: 10, checkedOut: 10, returned: 8 }, 2: { reserved: 5, checkedOut: 5, returned: 0 } }, 4), [{ warehouseId: 1, quantity: 2 }, { warehouseId: 2, quantity: 2 }]);

// Reservations always add up to the line's total, without touching units already out.
const balanced = rebalanceAllocations({ 1: { reserved: 30, checkedOut: 0, returned: 0 }, 2: { reserved: 0, checkedOut: 20, returned: 0 } }, 30, 2);
assert.equal(balanced[1].reserved + balanced[2].reserved, 30);
assert.equal(balanced[2].reserved, 20);
assert.equal(balanced[1].reserved, 10);

console.log("PASS warehouse rules: remainder owned by main, no doubling, transfers net to zero, stock and reservation limits, per-warehouse booking lines");
