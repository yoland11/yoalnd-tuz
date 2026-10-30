/** Real PostgreSQL proof of the warehouse paths. Runs only in an isolated TEST database, in a transaction it rolls back. */
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (process.env.AJN_ENV !== "test" || process.env.ALLOW_TEST_WRITES !== "true" || !url) {
  console.log("SKIPPED warehouse PostgreSQL integration: needs AJN_ENV=test, ALLOW_TEST_WRITES=true and TEST_DATABASE_URL");
  process.exit(0);
}
if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must be a separate database");

const { createWarehouse, listWarehouses, mainWarehouseId, updateWarehouse, warehouseBreakdowns, WarehouseError } = await import("../src/server/warehouses");
const { approveWarehouseTransfer, createWarehouseTransfer, rejectWarehouseTransfer } = await import("../src/server/warehouse-transfers");
const { approveWarehouseCount, createWarehouseCount } = await import("../src/server/warehouse-counts");
const { warehouseMovementRows, warehouseStockRows, warehouseTotals } = await import("../src/server/warehouse-reports");
const { adjustQuantityAsset, executeQuantityBookingAction } = await import("../src/server/quantity-assets");

const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
const db: any = drizzle(client);
const rows = async (query: any) => (await db.execute(query)).rows as any[];
const actor = { id: null, name: "فحص المخازن" };
const stamp = Date.now();
class Rollback extends Error {}

const expectRefusal = async (work: () => Promise<unknown>, pattern: RegExp) => {
  await db.execute(sql`savepoint refusal`);
  let caught: unknown = null;
  try { await work(); } catch (cause) { caught = cause; }
  await db.execute(sql`rollback to savepoint refusal`);
  assert.ok(caught instanceof Error, `expected a refusal matching ${pattern}`);
  assert.match((caught as Error).message, pattern);
  return caught as Error;
};

await db.execute(sql`begin`);
try {
  const mainId = await mainWarehouseId(db);
  const secondId = await createWarehouse(db, { name: `المخزن الثاني ${stamp}`, code: `T${stamp}` }, actor);
  assert.ok(secondId > mainId, "a new warehouse never becomes the main one");
  await expectRefusal(() => createWarehouse(db, { name: `المخزن الثاني ${stamp}` }, actor), /يوجد مخزن بهذا الاسم/);

  // (1)(2) Existing stock stays whole and belongs to the main warehouse.
  const [product] = await rows(sql`insert into products (name, name_ar, price, stock, is_asset) values (${`Chair ${stamp}`}, ${`كرسي ملكي ${stamp}`}, 0, 100, true) returning id`);
  const productId = Number(product.id);
  await db.execute(sql`insert into asset_quantity_profiles (product_id, tracking_mode, unit_of_measure) values (${productId}, 'quantity', 'قطعة')`);
  const shelves = async () => {
    const breakdown = (await warehouseBreakdowns(db, [productId])).get(productId)!;
    const of = (id: number) => breakdown.shares.find((row) => row.warehouseId === id)!;
    return { main: of(mainId), second: of(secondId), company: breakdown.company };
  };
  let now = await shelves();
  assert.equal(now.main.inWarehouse, 100);
  assert.equal(now.second.inWarehouse, 0);
  assert.equal(now.company.inWarehouse, 100, "never 200");

  // (4)(5)(6) Transfers move once, atomically, and refuse what is not there.
  await expectRefusal(() => createWarehouseTransfer(db, { productId, fromWarehouseId: mainId, toWarehouseId: secondId, quantity: 101 }, actor), /الكمية غير متوفرة/);
  const token = `t-${stamp}`;
  const created = await createWarehouseTransfer(db, { productId, fromWarehouseId: mainId, toWarehouseId: secondId, quantity: 40, requestToken: token, notes: "نقل" }, actor);
  assert.equal(created.replayed, false);
  const again = await createWarehouseTransfer(db, { productId, fromWarehouseId: mainId, toWarehouseId: secondId, quantity: 40, requestToken: token }, actor);
  assert.equal(again.replayed, true, "the same token returns the first transfer");
  now = await shelves();
  assert.equal(now.second.inWarehouse, 0, "nothing moves before approval");
  const transferId = Number(created.row.id);
  const executed = await approveWarehouseTransfer(db, transferId, actor);
  assert.equal(executed.executed, true);
  const repeated = await approveWarehouseTransfer(db, transferId, actor);
  assert.equal(repeated.executed, false, "a second approval moves nothing");
  now = await shelves();
  assert.deepEqual([now.main.inWarehouse, now.second.inWarehouse, now.company.inWarehouse], [60, 40, 100]);
  await expectRefusal(() => rejectWarehouseTransfer(db, transferId, actor), /نُفّذ هذا التحويل/);
  assert.equal((await rows(sql`select count(*)::int as c from stock_movements where related_type = 'warehouse_transfer' and related_id = ${transferId}`))[0].c, 1, "one ledger row");
  assert.equal((await rows(sql`select stock::float as s from products where id = ${productId}`))[0].s, 100, "the company figure was never written");
  assert.equal((await rows(sql`select count(*)::int as c from financial_transactions where source_id = ${String(transferId)} and source_type like '%warehouse%'`))[0].c, 0, "no cash movement");

  // A stale pending transfer re-checks stock when approved.
  const stale = await createWarehouseTransfer(db, { productId, fromWarehouseId: secondId, toWarehouseId: mainId, quantity: 40 }, actor);
  const drain = await createWarehouseTransfer(db, { productId, fromWarehouseId: secondId, toWarehouseId: mainId, quantity: 30 }, actor);
  await approveWarehouseTransfer(db, Number(drain.row.id), actor);
  await expectRefusal(() => approveWarehouseTransfer(db, Number(stale.row.id), actor), /الكمية غير متوفرة/);
  const back = await createWarehouseTransfer(db, { productId, fromWarehouseId: mainId, toWarehouseId: secondId, quantity: 30 }, actor);
  await approveWarehouseTransfer(db, Number(back.row.id), actor);
  await rejectWarehouseTransfer(db, Number(stale.row.id), actor);

  // (7)(8)(9) Bookings reserve per warehouse, can split, and return to a chosen warehouse.
  const newBooking = async (customer: string) => Number((await rows(sql`insert into service_orders (service_id, customer_name, phone, event_date, status, tracking_code) values ((select id from services order by id limit 1), ${customer}, '07700000000', '2039-05-05', 'confirmed', ${`WH-${stamp}-${customer}`}) returning id`))[0].id);
  const bookingId = await newBooking("أ");
  const otherBooking = await newBooking("ب");
  const operationsOf = new Map<number, Record<string, any>>([[bookingId, {}], [otherBooking, {}]]);
  const act = (id: number, action: Record<string, unknown>) => executeQuantityBookingAction(db, {
    reference: { source: "service", entityType: "service_order", id, eventDate: "2039-05-05", status: "confirmed", customerName: "فحص", operations: operationsOf.get(id)!, details: {} },
    action: { mode: "reserve", productId, quantity: 0, problem: "none", estimatedCost: 0, photoUrls: [], managerApproval: false, ...action } as any,
    actor,
    saveOperations: async (operations) => {
      operationsOf.set(id, operations);
      await db.execute(sql`update service_orders set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{bookingOperations}', ${JSON.stringify(operations)}::jsonb, true) where id = ${id}`);
    },
  });
  await act(bookingId, { mode: "reserve", quantity: 50, allocations: [{ warehouseId: mainId, quantity: 20 }, { warehouseId: secondId, quantity: 30 }] });
  let line = operationsOf.get(bookingId)!.assets[0];
  assert.deepEqual([line.warehouseAllocations[mainId].reserved, line.warehouseAllocations[secondId].reserved], [20, 30], "one booking draws on both warehouses");
  // The second warehouse holds 40 and 30 are promised, so another booking gets 10 at most there.
  await expectRefusal(() => act(otherBooking, { mode: "reserve", quantity: 11, warehouseId: secondId }), /الكمية غير متوفرة في/);
  await act(otherBooking, { mode: "reserve", quantity: 10, warehouseId: secondId });
  // Reserved units cannot be transferred away from under a booking.
  await expectRefusal(() => createWarehouseTransfer(db, { productId, fromWarehouseId: secondId, toWarehouseId: mainId, quantity: 1 }, actor), /محجوزة/);
  await act(bookingId, { mode: "checkout", quantity: 30, warehouseId: secondId });
  now = await shelves();
  assert.deepEqual([now.second.inWarehouse, now.second.checkedOut, now.company.inWarehouse, now.company.checkedOut], [10, 30, 70, 30]);
  assert.equal(now.main.inWarehouse, 60, "the other warehouse is untouched");
  await act(bookingId, { mode: "return", quantity: 30, goodQuantity: 25, damagedQuantity: 3, missingQuantity: 2, description: "فحص", managerApproval: true, warehouseId: mainId });
  now = await shelves();
  assert.deepEqual([now.second.inWarehouse, now.second.checkedOut, now.second.missing], [10, 0, 2], "units left the second warehouse; what was lost stays on its record");
  assert.deepEqual([now.main.inWarehouse, now.main.damaged], [85, 3], "good and damaged units landed in the chosen warehouse");
  assert.deepEqual([now.company.inWarehouse, now.company.damaged, now.company.missing, now.company.checkedOut], [95, 3, 2, 0]);
  line = operationsOf.get(bookingId)!.assets[0];
  assert.equal(line.warehouseAllocations[secondId].returned, 30);

  // (12) Damage and loss are per warehouse and refuse what that warehouse lacks.
  await expectRefusal(() => adjustQuantityAsset(db, { productId, kind: "damage", quantity: 11, reason: "فحص التلف", warehouseId: secondId, requestId: `d-${stamp}-1`, actor }), /الكمية غير كافية/);
  await adjustQuantityAsset(db, { productId, kind: "damage", quantity: 4, reason: "فحص التلف", warehouseId: mainId, requestId: `d-${stamp}-2`, actor });
  now = await shelves();
  assert.deepEqual([now.main.inWarehouse, now.main.damaged, now.second.damaged], [81, 7, 0]);
  await adjustQuantityAsset(db, { productId, kind: "add", quantity: 5, reason: "شراء جديد", warehouseId: secondId, requestId: `a-${stamp}`, actor });
  now = await shelves();
  assert.deepEqual([now.second.inWarehouse, now.company.inWarehouse], [15, 96]);

  // (10) Stocktaking each warehouse, with approval and a stale-count refusal.
  const count = await createWarehouseCount(db, { warehouseId: secondId, requestToken: `c-${stamp}-1`, lines: [{ productId, countedQuantity: 13 }] }, actor);
  assert.equal(count.status, "pending");
  assert.deepEqual([count.lines[0].expected, count.lines[0].counted, count.lines[0].difference], [15, 13, -2]);
  now = await shelves();
  assert.equal(now.second.inWarehouse, 15, "a count changes nothing before approval");
  await approveWarehouseCount(db, count.id, actor);
  now = await shelves();
  assert.deepEqual([now.second.inWarehouse, now.main.inWarehouse, now.company.inWarehouse], [13, 81, 94]);
  assert.equal((await approveWarehouseCount(db, count.id, actor)).executed, false, "approving twice applies once");
  const matched = await createWarehouseCount(db, { warehouseId: mainId, requestToken: `c-${stamp}-2`, lines: [{ productId, countedQuantity: 81 }] }, actor);
  assert.equal(matched.status, "matched");
  const stale2 = await createWarehouseCount(db, { warehouseId: mainId, requestToken: `c-${stamp}-3`, lines: [{ productId, countedQuantity: 70 }] }, actor);
  await adjustQuantityAsset(db, { productId, kind: "add", quantity: 1, reason: "شراء جديد", warehouseId: mainId, requestId: `a2-${stamp}`, actor });
  await expectRefusal(() => approveWarehouseCount(db, stale2.id, actor), /تغيّر رصيد/);

  // A store product with no quantity profile counts and transfers too.
  const [store] = await rows(sql`insert into products (name, name_ar, price, stock) values (${`Ribbon ${stamp}`}, ${`شريط ${stamp}`}, 0, 12.5) returning id`);
  const storeId = Number(store.id);
  const storeTransfer = await createWarehouseTransfer(db, { productId: storeId, fromWarehouseId: mainId, toWarehouseId: secondId, quantity: 2 }, actor);
  await approveWarehouseTransfer(db, Number(storeTransfer.row.id), actor);
  const storeCount = await createWarehouseCount(db, { warehouseId: secondId, requestToken: `c-${stamp}-4`, lines: [{ productId: storeId, countedQuantity: 1.5 }] }, actor);
  await approveWarehouseCount(db, storeCount.id, actor);
  const storeSplit = (await warehouseBreakdowns(db, [storeId])).get(storeId)!;
  assert.deepEqual([storeSplit.company.inWarehouse, storeSplit.shares.find((row) => row.warehouseId === secondId)!.inWarehouse], [12, 1.5]);

  // (13) Reports and the dashboard read the same figures.
  const totals = await warehouseTotals(db);
  const secondTotals = totals.warehouses.find((row) => row.id === secondId)!;
  assert.ok(secondTotals.shelf >= 14.5 && secondTotals.assets >= 1);
  const report = await warehouseStockRows(db, { warehouseId: secondId, search: String(stamp) });
  assert.equal(report.total, 2);
  const chair = report.data.find((row) => row.productId === productId)!;
  assert.equal(chair.inWarehouse, 13);
  assert.equal(chair.reserved, 10, "only the other booking's hold is left");
  const mainReport = await warehouseStockRows(db, { warehouseId: mainId, search: String(stamp) });
  assert.equal(mainReport.data.find((row) => row.productId === productId)!.inWarehouse, 82);
  const movements = await warehouseMovementRows(db, { warehouseId: secondId, productId });
  const transferMovement = movements.data.find((row) => row.reason === "warehouse_transfer_executed")!;
  assert.equal(transferMovement.quantity > 0, true, "a transfer shows its real size");
  assert.ok(transferMovement.warehouseName && transferMovement.toWarehouseName);
  assert.ok(movements.data.some((row) => row.reason === "quantity_asset_checkout" && row.relatedId === bookingId), "booking reference stays on the movement");

  // Warehouse rules.
  await expectRefusal(() => updateWarehouse(db, mainId, { name: "المخزن الرئيسي", isActive: false }), /لا يمكن إيقاف المخزن الرئيسي/);
  await expectRefusal(() => updateWarehouse(db, secondId, { name: `المخزن الثاني ${stamp}`, isActive: false }), /حوّل كميات هذا المخزن/);
  assert.ok((await listWarehouses(db)).find((row) => row.id === mainId)?.isMain);
  assert.ok(WarehouseError);
  throw new Rollback();
} catch (cause) {
  await db.execute(sql`rollback`);
  if (!(cause instanceof Rollback)) { client.release(); await pool.end(); throw cause; }
}
client.release();
await pool.end();
console.log("PASS warehouses on real PostgreSQL: existing stock stays whole, transfers once and atomic, per-warehouse reservations, split bookings, chosen return warehouse, damage, counts with approval, store products, reports; rolled back");
