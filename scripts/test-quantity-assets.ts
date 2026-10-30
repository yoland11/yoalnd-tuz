import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { executeIndividualCustody, IndividualCustodyError } from "../src/server/individual-custody";
import {
  adjustQuantityValuation,
  availabilityForDay,
  commitmentFor,
  insufficientQuantityMessage,
  lineOutstanding,
  normalizeQuantityLine,
  planQuantityAdjustment,
  quantityLineStage,
  totalQuantity,
  validateReturnSplit,
} from "../src/lib/quantity-assets";
import {
  adjustQuantityAsset,
  baghdadDay,
  configureQuantityTracking,
  executeQuantityBookingAction,
  quantityAssetSummary,
  quantityListFigures,
  quantityMovements,
  quantityProfilesFor,
  peakCommitment,
  QuantityAssetError,
  type QuantityBookingInput,
} from "../src/server/quantity-assets";

// Real module + real Drizzle SQL generation. Only database IO is replaced by an
// in-memory model; any unexpected statement fails the test instead of passing.
const dialect = new PgDialect();
const today = baghdadDay();
const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const EVENT_DAY = addDays(today, 4);
const NEXT_DAY = addDays(today, 5);

// ── 1. Pure rules ────────────────────────────────────────────────────────────
{
  assert.equal(
    insufficientQuantityMessage(20, 30),
    "الكمية المطلوبة غير متوفرة.\nالمتاح 20 قطعة، والمطلوب 30 قطعة.",
    "exact Arabic overbooking message",
  );
  const buckets = { inWarehouse: 80, checkedOut: 20, damaged: 0, maintenance: 0, missing: 0 };
  assert.equal(totalQuantity(buckets), 100);
  // A line reserved 20 and checked out 20 holds 20, never 40.
  const both = { trackingMode: "quantity", quantity: 20, reservedQty: 20, checkedOutQty: 20, stage: "out" };
  const hold = commitmentFor({ source: "kosha_booking", bookingId: 1, day: EVENT_DAY, status: "confirmed", line: both }, EVENT_DAY, today);
  assert.deepEqual(hold, { reserved: 0, out: 20 }, "reserved and checked-out units are not double counted");
  // Reservations only collide on the same day.
  const reservedOnly = { trackingMode: "quantity", quantity: 30, reservedQty: 30, stage: "reserved" };
  assert.equal(commitmentFor({ source: "k", bookingId: 2, day: EVENT_DAY, status: "confirmed", line: reservedOnly }, NEXT_DAY, today).reserved, 0);
  assert.equal(commitmentFor({ source: "k", bookingId: 2, day: EVENT_DAY, status: "confirmed", line: reservedOnly }, EVENT_DAY, today).reserved, 30);
  assert.equal(commitmentFor({ source: "k", bookingId: 2, day: EVENT_DAY, status: "cancelled", line: reservedOnly }, EVENT_DAY, today).reserved, 0, "cancelled booking releases its reservation");
  // Units out for an earlier, not-yet-overdue booking are expected back in time;
  // overdue units or units taken early for a later event still count.
  const out = { trackingMode: "quantity", quantity: 10, reservedQty: 10, checkedOutQty: 10, stage: "out" };
  assert.equal(commitmentFor({ source: "k", bookingId: 3, day: today, status: "confirmed", line: out }, NEXT_DAY, today).out, 0);
  assert.equal(commitmentFor({ source: "k", bookingId: 3, day: addDays(today, -2), status: "confirmed", line: out }, NEXT_DAY, today).out, 10, "overdue units stay committed");
  assert.equal(commitmentFor({ source: "k", bookingId: 3, day: addDays(NEXT_DAY, 3), status: "confirmed", line: out }, NEXT_DAY, today).out, 10, "early checkout for a later event stays committed");
  assert.equal(commitmentFor({ source: "k", bookingId: 3, day: addDays(today, -2), status: "completed", line: out }, NEXT_DAY, today).out, 10, "a completed booking with unreturned units still holds them");
  // Legacy individual lines normalise without negative or invented quantities.
  const legacy = normalizeQuantityLine({ productId: 1, quantity: 1, stage: "returned", problem: "damaged", problemQuantity: 1 });
  assert.deepEqual(
    [legacy.checkedOutQty, legacy.returnedGoodQty, legacy.returnedDamagedQty, lineOutstanding(legacy)],
    [1, 0, 1, 0],
  );
  assert.equal(normalizeQuantityLine({ productId: 1, stage: "linked" }).reservedQty, 0);
  // Partial return accounting.
  const line = normalizeQuantityLine({ trackingMode: "quantity", quantity: 20, reservedQty: 20, checkedOutQty: 20 });
  assert.equal(validateReturnSplit(line, { good: 15, damaged: 3, missing: 3 }).ok, false, "cannot return more than is out");
  const split = validateReturnSplit(line, { good: 15, damaged: 3, missing: 2 });
  assert.ok(split.ok && split.remaining === 0);
  assert.equal(quantityLineStage({ ...line, returnedGoodQty: 15 }), "out", "partial return keeps the line out");
  assert.equal(quantityLineStage({ ...line, returnedGoodQty: 15, returnedDamagedQty: 3, missingQty: 2 }), "returned");
  // Adjustment guards.
  const reduce = planQuantityAdjustment({ buckets, kind: "reduce", quantity: 10, peakCommitment: 95 });
  assert.equal(reduce.ok, false, "cannot reduce below commitments");
  const damage = planQuantityAdjustment({ buckets, kind: "damage", quantity: 10, peakCommitment: 95 });
  assert.ok(damage.ok && damage.commitmentWarning, "physical damage is recorded with a shortage warning");
  assert.equal(planQuantityAdjustment({ buckets, kind: "count", quantity: 0, countedQuantity: 80, peakCommitment: 0 }).ok, false, "a count equal to the balance is not a correction");
  // Valuation moves proportionally and adds new units at unit cost.
  assert.deepEqual(adjustQuantityValuation({ purchasePrice: 1_500_000, currentValue: 1_200_000, totalBefore: 100, totalAfter: 150, unitCost: 15_000 }), { purchasePrice: 2_250_000, currentValue: 1_950_000 });
  assert.deepEqual(adjustQuantityValuation({ purchasePrice: 1_500_000, currentValue: 1_200_000, totalBefore: 100, totalAfter: 90, unitCost: 15_000 }), { purchasePrice: 1_350_000, currentValue: 1_080_000 });
  assert.equal(
    availabilityForDay({ buckets, rows: [], targetDay: EVENT_DAY, today, otherHolds: 5 }).available,
    95,
    "store-product holds reduce availability",
  );
  console.log("PASS  quantity rules: states, overlap, partial returns, adjustments, valuation");
}

{
  const buckets={inWarehouse:10,checkedOut:2,damaged:0,maintenance:0,missing:0};
  const line={trackingMode:"quantity",quantity:6,reservedQty:6,stage:"reserved"};
  const timed={source:"kosha_booking",bookingId:1,day:EVENT_DAY,status:"confirmed",line,interval:{start:`${EVENT_DAY}T12:00:00+03:00`,end:`${NEXT_DAY}T12:00:00+03:00`}};
  const unknown={...timed,bookingId:2,day:NEXT_DAY,interval:null};
  assert.equal(peakCommitment([timed,unknown],buckets,today,1),15,"unknown legacy hold, real out bucket and global store hold are protected once");
  assert.equal(peakCommitment([timed,{...unknown,day:addDays(today,-6)}],buckets,today,1),9,"a lapsed date-only reservation (day passed, nothing out) holds nothing");
  assert.equal(peakCommitment([timed,{...unknown,day:addDays(today,-6),line:{...line,checkedOutQty:2,stage:"out"}}],buckets,today,1),13,"a past booking with units still out is not lapsed: its open reservation stays held");
  assert.equal(peakCommitment([{...timed,line:{...line,reservedQty:8,checkedOutQty:2,stage:"out"}}],buckets,today,1),9,"out counters are not added twice to reserved-not-out demand");
  assert.equal(peakCommitment([{...timed,interval:{start:`${addDays(today,-2)}T12:00:00+03:00`,end:`${addDays(today,-1)}T12:00:00+03:00`}}],buckets,today),2,"expired reserved intervals do not free actual unreturned inventory");
}

// ── 2. In-memory database ────────────────────────────────────────────────────
type Booking = { source: "kosha_booking" | "service_order"; id: number; day: string; status: string; customer: string; details: any };
function createDatabase() {
  const state = {
    ready: true,
    products: new Map<number, any>([
      [369, { id: 369, name: "عمود ملكي", stock: 0, cost_price: 15000, min_stock: 0, is_asset: true, shared_stock_product_id: null }],
      [400, { id: 400, name: "كاميرا", stock: 1, cost_price: 900000, min_stock: 0, is_asset: true, shared_stock_product_id: null }],
    ]),
    quantity: new Map<number, any>(),
    assetProfiles: new Map<number, any>([
      [369, { purchase_price: "1500000", current_value: "1500000", status: "active", deleted_at: null }],
      [400, { purchase_price: "900000", current_value: "900000", status: "active", deleted_at: null }],
    ]),
    passports: new Map<number, any>([[369, { warehouse_id: 1 }]]),
    purchaseInvoices: new Map<number, any>([
      [12, { id: 12, status: "active" }],
      [13, { id: 13, status: "deleted" }],
      [77, { id: 77, status: "active" }],
    ]),
    staff: [
      { id: 7, name: "أحمد المخزن", is_active: true },
      { id: 8, name: "موظف سابق", is_active: false },
    ],
    bookings: [
      { source: "kosha_booking", id: 125, day: EVENT_DAY, status: "confirmed", customer: "حجز 125", details: { bookingOperations: { assets: [] } } },
      { source: "kosha_booking", id: 126, day: EVENT_DAY, status: "confirmed", customer: "حجز 126", details: { bookingOperations: { assets: [] } } },
      { source: "service_order", id: 127, day: EVENT_DAY, status: "confirmed", customer: "حجز 127", details: { bookingOperations: { assets: [] } } },
      { source: "kosha_booking", id: 128, day: NEXT_DAY, status: "confirmed", customer: "حجز 128", details: { bookingOperations: { assets: [] } } },
    ] as Booking[],
    movements: [] as any[],
    warehouseRows: [] as any[],
    timeline: [] as any[],
    reservations: [] as any[],
    custodyIssued: 0,
    employeeReservations: 0,
    log: [] as string[],
  };
  const rows = (value: any[]) => ({ rows: value });
  const execute = async (query: any) => {
    const built = dialect.sqlToQuery(query);
    const q = built.sql.replace(/\s+/g, " ").trim();
    const p = built.params as any[];
    state.log.push(q);
    if (q.includes("information_schema.tables")) return rows([{ ready: state.ready }]);
    // One warehouse: every unit is the main warehouse's, so no warehouse_stock row is ever written.
    if (q === "select id from warehouses order by id asc limit 1") return rows([{ id: 1 }]);
    if (q.startsWith("select w.id, w.name, w.code, w.location")) return rows([{ id: 1, name: "المخزن الرئيسي", is_active: 1 }]);
    if (q.startsWith("select id, name, is_active from warehouses where id")) return rows(Number(p[0]) === 1 ? [{ id: 1, name: "المخزن الرئيسي", is_active: 1 }] : []);
    if (q.startsWith("select p.id, p.stock, q.quantity_checked_out")) {
      const ids = new Set(p.map(Number));
      return rows([...state.products.values()].filter((row: any) => ids.has(Number(row.id))).map((row: any) => ({ id: row.id, stock: row.stock, ...(state.quantity.get(Number(row.id)) ?? {}) })));
    }
    if (q.startsWith("select * from warehouse_stock where product_id in")) return rows(state.warehouseRows);
    if (q.startsWith("select coalesce(sum(quantity::numeric), 0) as in_warehouse")) return rows([{ in_warehouse: 0, checked_out: 0, damaged: 0, maintenance: 0, missing: 0 }]);
    if (q.includes("from stock_reservations") && q.includes("coalesce(warehouse_id,")) {
      const productId = Number(p[0]);
      const exclude = p.length > 3 ? { source: p[3], id: Number(p[4]) } : null;
      return rows([{ quantity: state.reservations.filter((row: any) => row.product_id === productId && row.status === "reserved" && !(exclude && row.source_type === exclude.source && row.source_id === exclude.id)).reduce((sum: number, row: any) => sum + Number(row.quantity), 0) }]);
    }
    if (q.startsWith("select product_id, unit_of_measure, quantity_checked_out") && q.includes("product_id in")) {
      const ids = new Set(p.map(Number));
      return rows([...state.quantity.values()].filter((r) => r.tracking_mode === "quantity" && ids.has(r.product_id)));
    }
    if (q.startsWith("select id, coalesce(name_ar, name) as name, stock, cost_price, min_stock, is_asset from products")) {
      const product = state.products.get(Number(p[0]));
      return rows(product ? [product] : []);
    }
    if (q.startsWith("select product_id, unit_of_measure") && q.includes("for update")) {
      const row = state.quantity.get(Number(p[0]));
      return rows(row && row.tracking_mode === "quantity" ? [row] : []);
    }
    if (q.startsWith("select purchase_price, current_value, status, deleted_at from asset_profiles"))
      return rows(state.assetProfiles.has(Number(p[0])) ? [state.assetProfiles.get(Number(p[0]))] : []);
    if (q.startsWith("select warehouse_id from asset_passports"))
      return rows(state.passports.has(Number(p[0])) ? [state.passports.get(Number(p[0]))] : []);
    if (q.startsWith("select w.id, w.name from asset_passports ap join warehouses w")) {
      const passport = state.passports.get(Number(p[0]));
      return rows(passport?.warehouse_id ? [{ id: passport.warehouse_id, name: "المستودع الرئيسي" }] : []);
    }
    if (q.startsWith("select id, status from purchase_invoices where id"))
      return rows(state.purchaseInvoices.has(Number(p[0])) ? [state.purchaseInvoices.get(Number(p[0]))] : []);
    if (q.includes("as from_invoice") && q.includes("from stock_movements")) {
      const mine = state.movements.filter((m) => Number(m.source_id ?? m.product_id) === Number(p[0]) && m.related_type === "purchase_invoice" && Number(m.related_id) === Number(p[1]));
      return rows([{
        from_invoice: mine.filter((m) => String(m.reason).startsWith("purchase_invoice")).reduce((sum, m) => sum + Number(m.quantity_change), 0),
        manual: mine.filter((m) => m.reason === "quantity_asset_add").length,
      }]);
    }
    if (q.startsWith("select id, coalesce(nullif(full_name, ''), username) as name from staff where id"))
      return rows(state.staff.filter((member) => member.id === Number(p[0]) && member.is_active).map(({ id, name }) => ({ id, name })));
    if (q.startsWith("select coalesce(sum((metadata->>'quantity')::numeric), 0) as qty from stock_movements")) {
      const [productId, action, bookingType, bookingId] = p;
      const recorded = state.movements.filter(
        (m) => Number(m.source_id ?? m.product_id) === Number(productId) && m.metadata?.action === action && m.metadata?.bookingType === bookingType && String(m.metadata?.bookingId) === String(bookingId),
      );
      return rows([{ qty: recorded.reduce((sum, m) => sum + Number(m.metadata.quantity ?? 0), 0) }]);
    }
    if (q.startsWith("select m.id, m.quantity_change") || q.startsWith("select count(*)::int as total from stock_movements m")) {
      let index = 1;
      const from = q.includes("::date >=") ? String(p[index++]) : null;
      const to = q.includes("::date <=") ? String(p[index++]) : null;
      const baghdad = (value: Date) => new Date(value.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
      const matching = state.movements
        .filter((m) => Number(m.source_id ?? m.product_id) === Number(p[0]))
        .filter((m) => (!from || baghdad(m.created_at) >= from) && (!to || baghdad(m.created_at) <= to))
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
      if (q.startsWith("select count(*)")) return rows([{ total: matching.length }]);
      const [limit, offset] = [Number(p[index]), Number(p[index + 1])];
      return rows(
        matching.slice(offset, offset + limit).map((m) => ({
          ...m,
          movement_type: "quantity_asset",
          warehouse_name: m.warehouse_id === 1 ? "المستودع الرئيسي" : null,
        })),
      );
    }
    if (q.includes("from kosha_bookings b cross join lateral jsonb_array_elements")) {
      const ids = new Set(p.map(String));
      return rows(
        state.bookings.flatMap((booking) =>
          (booking.details.bookingOperations?.assets ?? [])
            .filter((line: any) => ids.has(String(line.productId)))
            .map((line: any) => ({
              source: booking.source,
              booking_id: booking.id,
              day: booking.day,
              status: booking.status,
              customer_name: booking.customer,
              line: structuredClone(line),
              resource_window: structuredClone(booking.details.bookingOperations?.resourceWindow),
            })),
        ),
      );
    }
    if (q.includes("from stock_reservations where product_id")) {
      const total = state.reservations
        .filter((r) => r.product_id === Number(p[0]) && r.status === "reserved" && !(p.length > 1 && r.source_type === p[1] && r.source_id === p[2]))
        .reduce((sum, r) => sum + r.quantity, 0);
      return rows([{ quantity: total }]);
    }
    if (q.startsWith("select id from stock_movements where idempotency_key"))
      return rows(state.movements.filter((m) => m.idempotency_key === p[0]).map((m) => ({ id: m.id })));
    if (q.startsWith("insert into stock_movements")) {
      const [product_id, source_id, quantity_change, reason, related_type, related_id, warehouse_id, idempotency_key, metadata, created_by, created_by_name] = p;
      if (idempotency_key && state.movements.some((m) => m.idempotency_key === idempotency_key))
        throw new Error("duplicate key value violates unique constraint stock_movements_idempotency_idx");
      state.movements.push({ id: state.movements.length + 1, product_id, source_id, quantity_change: Number(quantity_change), reason, related_type, related_id, warehouse_id, idempotency_key, metadata: JSON.parse(metadata), created_by, created_by_name, created_at: new Date() });
      return rows([]);
    }
    if (q.startsWith("update products set stock = stock::numeric +")) {
      const product = state.products.get(Number(p[1]));
      if (!product || product.stock + Number(p[2]) < 0) return rows([]);
      product.stock += Number(p[0]);
      return rows([{ stock: product.stock }]);
    }
    if (q.startsWith("insert into warehouse_stock")) throw new Error("the main warehouse has no balance row");
    if (q.startsWith("update asset_quantity_profiles set quantity_checked_out")) {
      const row = state.quantity.get(Number(p[4]));
      Object.assign(row, { quantity_checked_out: p[0], quantity_damaged: p[1], quantity_maintenance: p[2], quantity_missing: p[3] });
      for (const value of [p[0], p[1], p[2], p[3]]) assert.ok(value >= 0, "CHECK constraint: buckets never negative");
      return rows([]);
    }
    if (q.startsWith("insert into entity_timeline")) {
      state.timeline.push({ entity_type: p[0], entity_id: p[1], type: p[2], title: p[3] });
      return rows([]);
    }
    if (q.startsWith("update asset_profiles set purchase_price")) {
      Object.assign(state.assetProfiles.get(Number(p[2])), { purchase_price: p[0], current_value: p[1] });
      return rows([]);
    }
    if (q.startsWith("select stock, cost_price, min_stock from products"))
      return rows([state.products.get(Number(p[0]))]);
    if (q.startsWith("select id, coalesce(name_ar, name) as name, stock, is_asset, shared_stock_product_id from products"))
      return rows(state.products.has(Number(p[0])) ? [state.products.get(Number(p[0]))] : []);
    if (q.startsWith("select * from asset_quantity_profiles where product_id"))
      return rows(state.quantity.has(Number(p[0])) ? [state.quantity.get(Number(p[0]))] : []);
    if (q.startsWith("select status, deleted_at from asset_profiles"))
      return rows(state.assetProfiles.has(Number(p[0])) ? [state.assetProfiles.get(Number(p[0]))] : []);
    if (q.includes("from equipment_custody where product_id")) return rows([{ count: state.custodyIssued }]);
    if (q.includes("from employee_custody_reservations where product_id")) return rows([{ count: state.employeeReservations }]);
    if (q.startsWith("select count(*)::int as count from stock_movements"))
      return rows([{ count: state.movements.filter((m) => m.source_id === Number(p[0]) && m.reason !== "product_initial_stock").length }]);
    if (q.startsWith("insert into asset_quantity_profiles")) {
      state.quantity.set(Number(p[0]), { product_id: Number(p[0]), tracking_mode: "quantity", unit_of_measure: p[1], quantity_checked_out: 0, quantity_damaged: 0, quantity_maintenance: 0, quantity_missing: 0, configured_by: p[2] });
      return rows([]);
    }
    if (q.startsWith("update asset_quantity_profiles set tracking_mode = 'individual'")) {
      state.quantity.get(Number(p[1])).tracking_mode = "individual";
      return rows([]);
    }
    if (q.startsWith("update asset_quantity_profiles set tracking_mode = 'quantity'")) {
      Object.assign(state.quantity.get(Number(p[2])), { tracking_mode: "quantity", unit_of_measure: p[0] });
      return rows([]);
    }
    if (q.startsWith("update asset_quantity_profiles set unit_of_measure")) {
      state.quantity.get(Number(p[1])).unit_of_measure = p[0];
      return rows([]);
    }
    throw new Error(`Unexpected SQL in quantity asset test: ${q}`);
  };
  /** Emulates a transaction: a thrown error restores every write. */
  const transaction = async <T>(work: (executor: { execute: typeof execute }) => Promise<T>) => {
    const snapshot = structuredClone({ ...state, log: [] });
    try {
      return await work({ execute });
    } catch (error) {
      Object.assign(state, { ...snapshot, log: state.log });
      throw error;
    }
  };
  return { state, execute, transaction };
}

const actor = { id: 1, name: "مدير المستودع" };
let requestCounter = 0;
const nextRequest = () => `req-${++requestCounter}-abcdef`;

async function bookingAction(
  database: ReturnType<typeof createDatabase>,
  bookingId: number,
  action: Partial<QuantityBookingInput> & { mode: QuantityBookingInput["mode"] },
) {
  const booking = database.state.bookings.find((row) => row.id === bookingId)!;
  return database.transaction((executor) =>
    executeQuantityBookingAction(executor as any, {
      reference: {
        source: booking.source === "kosha_booking" ? "kosha" : "service",
        entityType: booking.source,
        id: booking.id,
        eventDate: booking.day,
        status: booking.status,
        customerName: booking.customer,
        operations: structuredClone(booking.details.bookingOperations),
        details: structuredClone(booking.details),
      },
      action: {
        productId: 369,
        quantity: 1,
        problem: "none",
        estimatedCost: 0,
        photoUrls: [],
        managerApproval: false,
        ...action,
      } as QuantityBookingInput,
      actor,
      saveOperations: async (operations) => {
        booking.details = { ...booking.details, bookingOperations: operations };
      },
    }),
  );
}

const expectError = async (work: () => Promise<unknown>, pattern: RegExp, status?: number) => {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof QuantityAssetError, `expected QuantityAssetError, got ${String(error)}`);
    assert.match(error.message, pattern);
    if (status) assert.equal(error.status, status);
    return error;
  }
  assert.fail(`expected error ${pattern}`);
};

async function run() {
  // Exercise the uncached readiness probe before any schema-ready fixture.
  const db = createDatabase();
  db.state.ready = false;
  assert.equal((await quantityProfilesFor(db as any, [369])).size, 0);
  assert.ok(!db.state.log.some((q) => q.includes("from asset_quantity_profiles")), "no query against a missing table");
  db.state.ready = true;
  // A stock reduction must protect the full operating peak, not only event days.
  for (const kind of ["reduce", "count"] as const) {
    const overlapping = createDatabase();
    overlapping.state.products.get(369).stock = 12;
    overlapping.state.quantity.set(369, { product_id: 369, tracking_mode: "quantity", unit_of_measure: "قطعة", quantity_checked_out: 0, quantity_damaged: 0, quantity_maintenance: 0, quantity_missing: 0 });
    const first = overlapping.state.bookings.find(b => b.id === 125)!;
    const second = overlapping.state.bookings.find(b => b.id === 128)!;
    first.details.bookingOperations = { resourceWindow: { preparationStart: `${EVENT_DAY}T12:00:00+03:00`, eventStart: `${EVENT_DAY}T18:00:00+03:00`, eventEnd: `${NEXT_DAY}T01:00:00+03:00`, returnEnd: `${NEXT_DAY}T12:00:00+03:00` }, assets: [{ productId: 369, trackingMode: "quantity", quantity: 6, reservedQty: 6, stage: "reserved" }] };
    second.details.bookingOperations = { resourceWindow: { preparationStart: `${EVENT_DAY}T15:00:00+03:00`, eventStart: `${NEXT_DAY}T18:00:00+03:00`, eventEnd: `${NEXT_DAY}T22:00:00+03:00`, returnEnd: `${NEXT_DAY}T23:00:00+03:00` }, assets: [{ productId: 369, trackingMode: "quantity", quantity: 6, reservedQty: 6, stage: "reserved" }] };
    await expectError(() => overlapping.transaction(executor => adjustQuantityAsset(executor as any, { productId: 369, kind, quantity: kind === "reduce" ? 6 : 0, countedQuantity: kind === "count" ? 6 : undefined, reason: "جرد محكوم", requestId: nextRequest(), actor })), /الالتزامات الحالية/, 409);
    assert.equal(overlapping.state.products.get(369).stock, 12, "overlapping commitments survive rejected reduction/count");
    assert.equal(overlapping.state.movements.length, 0, "rejected reduction creates no inventory or valuation movement");
    overlapping.state.bookings.find(b=>b.id===128)!.details.bookingOperations.resourceWindow.preparationStart=`${NEXT_DAY}T12:00:00+03:00`;
    await overlapping.transaction(executor => adjustQuantityAsset(executor as any, { productId: 369, kind, quantity: kind === "reduce" ? 6 : 0, countedQuantity: kind === "count" ? 6 : undefined, reason: "جرد فترات متجاورة", requestId: nextRequest(), actor }));
    assert.equal(overlapping.state.products.get(369).stock,6,"adjacent half-open periods reuse stock rather than summing reservations");
    assert.equal(overlapping.state.movements.length,1,"accepted adjustment uses the original movement once");
  }
  const periodDb=createDatabase();
  periodDb.state.products.get(369).stock=15;
  periodDb.state.quantity.set(369,{product_id:369,tracking_mode:"quantity",unit_of_measure:"قطعة",quantity_checked_out:0,quantity_damaged:0,quantity_maintenance:0,quantity_missing:0});
  const periodOwn=periodDb.state.bookings.find(b=>b.id===125)!;
  const periodOther=periodDb.state.bookings.find(b=>b.id===128)!;
  periodOwn.details.bookingOperations.resourceWindow={preparationStart:`${EVENT_DAY}T12:00:00+03:00`,eventStart:`${EVENT_DAY}T18:00:00+03:00`,eventEnd:`${NEXT_DAY}T01:00:00+03:00`,returnEnd:`${NEXT_DAY}T12:00:00+03:00`};
  periodOther.details.bookingOperations={resourceWindow:{preparationStart:`${EVENT_DAY}T15:00:00+03:00`,eventStart:`${NEXT_DAY}T18:00:00+03:00`,eventEnd:`${NEXT_DAY}T22:00:00+03:00`,returnEnd:`${NEXT_DAY}T23:00:00+03:00`},assets:[{productId:369,trackingMode:"quantity",quantity:8,reservedQty:8,stage:"reserved"}]};
  await expectError(()=>bookingAction(periodDb,125,{mode:"reserve",quantity:10}),/المتاح 7 قطعة، والمطلوب 10 قطعة/,409);
  assert.deepEqual(periodOwn.details.bookingOperations.assets,[],"cross-day refusal rolls back original booking line");
  assert.equal(periodDb.state.products.get(369).stock,15);
  assert.equal(periodDb.state.movements.length,0,"cross-day reservation rejection never creates a movement");
  console.log("PASS original quantity mutation rejects cross-day preparation shortage without stock movement");
  for (const mode of ["pick", "checkout"] as const) {
    periodDb.state.bookings.find(b => b.id === 125)!.details.bookingOperations.assets = [{ productId: 369, trackingMode: "quantity", quantity: 10, reservedQty: 10, preparedQty: 10, checkedOutQty: 0, stage: "reserved" }];
    await expectError(() => bookingAction(periodDb, 125, { mode, quantity: mode === "pick" ? 10 : 5 }), /المتاح 7 قطعة، والمطلوب 10 قطعة/, 409);
    assert.equal(periodDb.state.products.get(369).stock, 15, "revalidation failure never checks inventory out");
    assert.equal(periodDb.state.movements.length, 0);
  }
  // The individual adapter was extracted from api.ts. Verify its real guard,
  // not the old location/exact wording of an Arabic error message.
  const custodyReads: string[] = [];
  const individualTx = {
    execute: async (statement: any) => {
      const query = dialect.sqlToQuery(statement);
      assert.match(query.sql, /^select .*from products where id = .*for update$/);
      assert.deepEqual(query.params, [369]);
      custodyReads.push(query.sql);
      return { rows: [{ id: 369, name: "LED", name_ar: "إضاءة", cost_price: "100", is_active: true }] };
    },
  };
  await assert.rejects(() => executeIndividualCustody(individualTx, {
    mode: "checkout", productId: 369, actorId: 1, staffId: 2,
    source: { kind: "standalone" }, checklist: { confirmed: true },
  }, {
    isQuantityTracked: async (connection, productId) => {
      assert.equal(connection, individualTx); assert.equal(productId, 369);
      assert.equal(custodyReads.length, 1, "fresh quantity guard follows canonical product lock");
      return true;
    },
    audit: async () => { assert.fail("quantity asset must not create individual custody/audit"); },
  }), (cause: unknown) => cause instanceof IndividualCustodyError && cause.status === 409);
  assert.equal(custodyReads.length, 1, "quantity asset refused before individual custody writes");
  console.log("PASS  quantity asset cannot bypass its original engine through individual custody");
  // (1)(2)(3) Create: an individual asset stays individual; the master asset with
  // 100 units is one product row whose initial stock came from the product API.
  db.state.products.get(369).stock = 100;
  db.state.movements.push({ id: 1, product_id: 369, source_id: 369, quantity_change: 100, reason: "product_initial_stock", idempotency_key: null, metadata: {}, created_at: new Date() });
  const configured = await db.transaction((executor) =>
    configureQuantityTracking(executor as any, { productId: 369, trackingMode: "quantity", unitOfMeasure: "قطعة", confirmConversion: false, isManager: false, actor }),
  );
  assert.equal(configured.changed, true, "a new asset with only its opening stock converts without extra confirmation");
  assert.equal((await quantityProfilesFor(db as any, [369, 400])).has(400), false, "individual asset untouched");
  let summary = await quantityAssetSummary(db as any, 369, EVENT_DAY);
  assert.equal(summary?.total, 100);
  assert.equal(summary?.available, 100);
  assert.equal(summary?.totalValue, 1_500_000, "total value = quantity × unit cost");

  // (4)(5) Reserve 20 + 30 for overlapping bookings → 50 reserved, 50 available.
  await bookingAction(db, 125, { mode: "reserve", quantity: 20 });
  await bookingAction(db, 126, { mode: "reserve", quantity: 30 });
  summary = await quantityAssetSummary(db as any, 369, EVENT_DAY);
  assert.equal(summary?.committedOnDay, 50);
  assert.equal(summary?.available, 50);
  assert.equal(summary?.reserved, 50);
  assert.equal(db.state.products.get(369).stock, 100, "reservations never move warehouse stock");

  // (6) Overbooking is rejected server-side with the exact Arabic message.
  await bookingAction(db, 126, { mode: "reserve", quantity: 60 }); // 126 now holds 60 → 80 reserved
  const overbook = await expectError(() => bookingAction(db, 127, { mode: "reserve", quantity: 30 }), /الكمية المطلوبة غير متوفرة/, 409);
  assert.equal(overbook.message, "الكمية المطلوبة غير متوفرة.\nالمتاح 20 قطعة، والمطلوب 30 قطعة.");
  assert.deepEqual(db.state.bookings.find((b) => b.id === 127)!.details.bookingOperations.assets, [], "rejected reservation leaves no line");
  await bookingAction(db, 126, { mode: "reserve", quantity: 30 }); // back to the spec example

  // (14) Different day: booking 128 on the next day may use all usable units.
  await bookingAction(db, 128, { mode: "reserve", quantity: 100 });
  await expectError(() => bookingAction(db, 128, { mode: "reserve", quantity: 101 }), /المتاح 100 قطعة، والمطلوب 101 قطعة/);
  await bookingAction(db, 128, { mode: "unlink" });

  // (7)(13) Checkout 20 → warehouse 80, out 20; a retried request never deducts twice.
  await bookingAction(db, 125, { mode: "pick", quantity: 20 });
  const checkoutRequest = nextRequest();
  await bookingAction(db, 125, { mode: "checkout", quantity: 20, requestId: checkoutRequest, vehicle: "بيك أب 1", note: "تحميل صباحي" });
  const replay = await bookingAction(db, 125, { mode: "checkout", quantity: 20, requestId: checkoutRequest });
  assert.equal(replay.replayed, true);
  assert.equal(db.state.products.get(369).stock, 80);
  assert.equal(db.state.quantity.get(369).quantity_checked_out, 20);
  assert.equal(db.state.movements.filter((m) => m.reason === "quantity_asset_checkout").length, 1, "one ledger row for one checkout");
  const checkoutRow = db.state.movements.find((m) => m.reason === "quantity_asset_checkout");
  assert.equal(checkoutRow.quantity_change, -20);
  assert.equal(checkoutRow.related_type, "kosha_booking");
  assert.equal(checkoutRow.related_id, 125);
  assert.equal(checkoutRow.warehouse_id, 1);
  assert.equal(checkoutRow.metadata.vehicle, "بيك أب 1");
  assert.equal(db.state.warehouseRows.length, 0, "main-warehouse units stay in products.stock; no balance row is written");
  summary = await quantityAssetSummary(db as any, 369, EVENT_DAY);
  assert.equal(summary?.checkedOut, 20);
  assert.equal(summary?.reserved, 30, "booking 125's 20 are out, not also reserved");
  assert.equal(summary?.available, 50, "100 usable − 20 out − 30 reserved");
  assert.equal(summary?.total, 100);
  await expectError(() => bookingAction(db, 125, { mode: "unlink" }), /لا يمكن إزالة أصل خرجت منه كميات/);

  // (8)(9)(10) Return 15 good + 3 damaged + 2 missing: every unit accounted for.
  await expectError(
    () => bookingAction(db, 125, { mode: "return", goodQuantity: 15, damagedQuantity: 3, missingQuantity: 3, description: "كسر", managerApproval: true, requestId: nextRequest() }),
    /لا يمكن إرجاع أكثر من الكمية الخارجة/,
  );
  await expectError(
    () => bookingAction(db, 125, { mode: "return", goodQuantity: 15, damagedQuantity: 3, missingQuantity: 2, description: "كسر ونقص", requestId: nextRequest() }),
    /اعتماد المدير/,
  );
  await expectError(
    () => bookingAction(db, 125, { mode: "return", goodQuantity: 0, damagedQuantity: 3, managerApproval: true, requestId: nextRequest() }),
    /وصف التلف/,
  );
  await bookingAction(db, 125, { mode: "return", goodQuantity: 10, requestId: nextRequest() });
  let line = db.state.bookings.find((b) => b.id === 125)!.details.bookingOperations.assets[0];
  assert.equal(line.stage, "out", "partial return");
  await bookingAction(db, 125, { mode: "return", goodQuantity: 5, damagedQuantity: 3, missingQuantity: 2, description: "3 مكسورة و2 مفقودة", managerApproval: true, requestId: nextRequest() });
  line = db.state.bookings.find((b) => b.id === 125)!.details.bookingOperations.assets[0];
  assert.deepEqual(
    [line.checkedOutQty, line.returnedGoodQty, line.returnedDamagedQty, line.missingQty, line.stage],
    [20, 15, 3, 2, "returned"],
  );
  assert.equal(db.state.products.get(369).stock, 95, "only good units return to the warehouse");
  assert.deepEqual(
    [db.state.quantity.get(369).quantity_checked_out, db.state.quantity.get(369).quantity_damaged, db.state.quantity.get(369).quantity_missing],
    [0, 3, 2],
  );
  summary = await quantityAssetSummary(db as any, 369, EVENT_DAY);
  assert.equal(summary?.total, 100, "total unchanged: damaged and missing units are still accounted for");
  assert.equal(summary?.available, 65, "95 usable − 30 reserved by booking 126");
  assert.equal(summary?.reconciliation.matches, true);
  assert.equal(db.state.movements.filter((m) => m.reason === "quantity_asset_damage").length, 1);
  assert.equal(db.state.movements.filter((m) => m.reason === "quantity_asset_loss").length, 1);
  await bookingAction(db, 125, { mode: "inspect", quantity: 20 });
  await expectError(() => bookingAction(db, 126, { mode: "inspect", quantity: 30 }), /إرجاع كامل الكمية/);

  // (10) Damaged/missing follow the controlled procedures.
  await db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "send_maintenance", quantity: 3, reason: "إرسال للحداد", requestId: nextRequest(), actor }));
  await db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "repaired", quantity: 2, reason: "تم اللحام", requestId: nextRequest(), actor }));
  await db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "write_off", quantity: 1, writeOffFrom: "maintenance", reason: "غير قابل للإصلاح", requestId: nextRequest(), actor }));
  await db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "found", quantity: 1, reason: "وجدت في القاعة", requestId: nextRequest(), actor }));
  summary = await quantityAssetSummary(db as any, 369);
  assert.deepEqual(
    [summary?.total, summary?.inWarehouse, summary?.damaged, summary?.maintenance, summary?.missing],
    [99, 98, 0, 0, 1],
  );
  assert.equal(db.state.assetProfiles.get(369).purchase_price, "1485000", "write-off removes 1/100 of the acquisition cost");

  // Adjustments record before/change/after and cannot erase commitments.
  const addRequest = nextRequest();
  const added = await db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "add", quantity: 50, unitCost: 15000, reason: "شراء إضافي", relatedType: "purchase_invoice", relatedId: 77, requestId: addRequest, actor }));
  assert.equal((added as any).totalBefore, 99);
  assert.equal((added as any).totalAfter, 149);
  const addReplay = await db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "add", quantity: 50, reason: "شراء إضافي", requestId: addRequest, actor }));
  assert.equal(addReplay.replayed, true, "retried adjustment is applied once");
  assert.equal(db.state.products.get(369).stock, 148);
  const addRow = db.state.movements.find((m) => m.idempotency_key === `qasset:369:${addRequest}`);
  assert.deepEqual([addRow.metadata.totalBefore, addRow.metadata.change, addRow.metadata.totalAfter, addRow.metadata.reason], [99, 50, 149, "شراء إضافي"]);
  assert.deepEqual(addRow.metadata.document, { type: "purchase_invoice", id: 77 });
  await bookingAction(db, 128, { mode: "reserve", quantity: 140 });
  await expectError(
    () => db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "reduce", quantity: 20, reason: "بيع خردة", requestId: nextRequest(), actor })),
    /لا يمكن تخفيض الكمية دون الالتزامات الحالية/,
  );
  await expectError(
    () => db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "count", quantity: 0, countedQuantity: 120, reason: "جرد", requestId: nextRequest(), actor })),
    /الالتزامات الحالية/,
  );
  const counted = await db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "count", quantity: 0, countedQuantity: 146, reason: "جرد شهري", requestId: nextRequest(), actor }));
  assert.equal((counted as any).change, -2);
  await bookingAction(db, 128, { mode: "unlink" });

  // (12) An approved purchase adds stock through the existing purchase ledger;
  // the total is derived from it, so the quantity grows exactly once.
  const beforePurchase = (await quantityAssetSummary(db as any, 369))!.total;
  db.state.products.get(369).stock += 50;
  db.state.movements.push({ id: 999, product_id: 369, source_id: 369, quantity_change: 50, reason: "purchase_invoice_stock_increased", related_type: "purchase_invoice", related_id: 12, idempotency_key: "purchase-invoice-stock:12:1", metadata: {}, created_at: new Date() });
  assert.equal((await quantityAssetSummary(db as any, 369))!.total, beforePurchase + 50);

  // Store-product holds and list figures.
  const list = await quantityListFigures(db as any, [{ id: 369, stock: db.state.products.get(369).stock }, { id: 400, stock: 1 }]);
  assert.equal(list.get(369)?.total, (await quantityAssetSummary(db as any, 369))!.total);
  assert.equal(list.has(400), false);

  // A rejected action leaves no partial writes (transaction rollback).
  const stockBefore = db.state.products.get(369).stock;
  const movementsBefore = db.state.movements.length;
  await expectError(() => bookingAction(db, 127, { mode: "checkout", quantity: 10_000, requestId: nextRequest() }), /الكمية غير متوفرة في المستودع/);
  assert.equal(db.state.products.get(369).stock, stockBefore);
  assert.equal(db.state.movements.length, movementsBefore);

  // Status gates still apply to quantity assets.
  db.state.assetProfiles.get(369).status = "locked";
  await expectError(() => bookingAction(db, 127, { mode: "reserve", quantity: 1 }), /تمنع الحجز/, 423);
  db.state.assetProfiles.get(369).status = "active";
  db.state.bookings.find((b) => b.id === 127)!.status = "cancelled";
  await expectError(() => bookingAction(db, 127, { mode: "reserve", quantity: 1 }), /ملغي أو مكتمل/);

  // (15)(16) Conversion restrictions for existing individual assets.
  db.state.bookings[0].details.bookingOperations.assets.push({ productId: 400, quantity: 1, stage: "reserved" });
  await expectError(
    () => db.transaction((executor) => configureQuantityTracking(executor as any, { productId: 400, trackingMode: "quantity", confirmConversion: true, isManager: true, actor })),
    /مرتبط بحجوزات نشطة/,
  );
  db.state.bookings[0].details.bookingOperations.assets.pop();
  db.state.bookings[1].details.bookingOperations.assets.push({ productId: 400, quantity: 1, stage: "completed" });
  const needsConfirm = await expectError(
    () => db.transaction((executor) => configureQuantityTracking(executor as any, { productId: 400, trackingMode: "quantity", confirmConversion: false, isManager: true, actor })),
    /تأكيداً صريحاً/,
  );
  assert.equal((needsConfirm as QuantityAssetError).extra.requiresConfirmation, true);
  await expectError(
    () => db.transaction((executor) => configureQuantityTracking(executor as any, { productId: 400, trackingMode: "quantity", confirmConversion: true, isManager: false, actor })),
    /للمدير فقط/,
    403,
  );
  db.state.custodyIssued = 1;
  await expectError(
    () => db.transaction((executor) => configureQuantityTracking(executor as any, { productId: 400, trackingMode: "quantity", confirmConversion: true, isManager: true, actor })),
    /بعهدة موظف/,
  );
  db.state.custodyIssued = 0;
  await expectError(
    () => db.transaction((executor) => configureQuantityTracking(executor as any, { productId: 369, trackingMode: "individual", confirmConversion: true, isManager: true, actor })),
    /مرتبط بحجوزات نشطة \(#126 بتاريخ \d{4}-\d{2}-\d{2}\)/,
  );
  await bookingAction(db, 126, { mode: "unlink" });
  await expectError(
    () => db.transaction((executor) => configureQuantityTracking(executor as any, { productId: 369, trackingMode: "individual", confirmConversion: true, isManager: true, actor })),
    /توجد كميات|قطعة واحدة/,
  );
  assert.equal(db.state.quantity.get(369).tracking_mode, "quantity", "failed conversion keeps the mode");

  // «إدارة الكميات» guards. A purchase invoice is received once: its own lines
  // already added stock (#12), a manual add already used it (#77), or it is deleted (#13).
  const beforeGuards = db.state.movements.length;
  const addFrom = (relatedId: number) =>
    db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "add", quantity: 50, reason: "شراء جديد", relatedType: "purchase_invoice", relatedId, requestId: nextRequest(), actor }));
  await expectError(() => addFrom(12), /فاتورة الشراء #12 \(50\) استُلمت تلقائياً/, 409);
  await expectError(() => addFrom(77), /أُضيفت كمية من فاتورة الشراء #77 لهذا الأصل سابقاً/, 409);
  await expectError(() => addFrom(13), /#13 غير موجودة/, 422);
  await expectError(() => addFrom(404), /#404 غير موجودة/, 422);
  // Damage/loss already recorded at booking 125's return is not recorded again.
  const report = (extra: Record<string, unknown>) =>
    db.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "damage", quantity: 1, reason: "كسر اكتُشف لاحقاً", requestId: nextRequest(), actor, ...extra } as any));
  await expectError(() => report({ relatedType: "kosha_booking", relatedId: 125 }), /سُجّل تلف 3 عند إرجاع هذا الحجز/, 409);
  await expectError(() => report({ kind: "loss", relatedType: "kosha_booking", relatedId: 125 }), /سُجّل فقدان 2 عند إرجاع هذا الحجز/, 409);
  await expectError(() => report({ responsibleStaffId: 8 }), /غير موجود أو غير نشط/, 422);
  await expectError(() => report({ photos: ["javascript:alert(1)"] }), /مرفوعة إلى التخزين/, 422);
  await expectError(() => report({ photos: Array.from({ length: 11 }, (_, i) => `/api/media/${i}.jpg`) }), /10 صور/, 422);
  assert.equal(db.state.movements.length, beforeGuards, "refused quantity actions write nothing");
  // Damage found after the return is recorded once, marked additional, with its evidence.
  const damagedBefore = db.state.quantity.get(369).quantity_damaged;
  await report({ relatedType: "kosha_booking", relatedId: 125, additionalToReturn: true, notes: "ظهر عند التنظيف", responsibleStaffId: 7, photos: ["/api/media/crack.jpg"] });
  const extraRow = db.state.movements.at(-1);
  assert.deepEqual(
    [extraRow.reason, extraRow.related_type, extraRow.related_id, extraRow.metadata.responsible, extraRow.metadata.photos, extraRow.metadata.notes, extraRow.metadata.additionalToReturn],
    ["quantity_asset_damage", "kosha_booking", 125, { id: 7, name: "أحمد المخزن" }, ["/api/media/crack.jpg"], "ظهر عند التنظيف", true],
  );
  assert.equal(db.state.quantity.get(369).quantity_damaged, damagedBefore + 1);
  // A booking whose return recorded no damage needs no flag.
  await report({ relatedType: "service_order", relatedId: 127 });
  assert.equal(db.state.quantity.get(369).quantity_damaged, damagedBefore + 2);

  // Expected result: a zero-unit asset receives 100 units through «إضافة كمية»:
  // one movement, every figure updated, nothing written to accounting or the cash box.
  const fresh = createDatabase();
  fresh.state.quantity.set(369, { product_id: 369, tracking_mode: "quantity", unit_of_measure: "قطعة", quantity_checked_out: 0, quantity_damaged: 0, quantity_maintenance: 0, quantity_missing: 0 });
  Object.assign(fresh.state.assetProfiles.get(369), { purchase_price: "0", current_value: "0" });
  assert.equal((await quantityAssetSummary(fresh as any, 369))!.total, 0);
  fresh.state.log.length = 0;
  const hundred = await fresh.transaction((executor) =>
    adjustQuantityAsset(executor as any, { productId: 369, kind: "add", quantity: 100, unitCost: 15000, reason: "شراء جديد", notes: "إضافة كمية أولية من المشتريات", requestId: nextRequest(), actor }),
  );
  assert.deepEqual([(hundred as any).totalBefore, (hundred as any).totalAfter], [0, 100]);
  assert.equal(fresh.state.movements.length, 1, "exactly one stock movement");
  assert.equal(fresh.state.movements[0].reason, "quantity_asset_add");
  assert.equal(fresh.state.movements[0].metadata.notes, "إضافة كمية أولية من المشتريات");
  assert.equal(fresh.state.products.get(369).stock, 100);
  assert.equal(fresh.state.assetProfiles.get(369).purchase_price, "1500000", "acquisition value grows by 100 x 15,000");
  assert.ok(
    !fresh.state.log.some((q) => /financial_transactions|journal|cash_box|purchase_invoices|expenses/i.test(q)),
    "no accounting, cash box or purchase records",
  );
  const after100 = (await quantityAssetSummary(fresh as any, 369))!;
  assert.deepEqual(
    [after100.total, after100.inWarehouse, after100.available, after100.totalValue, after100.warehouse],
    [100, 100, 100, 1_500_000, { id: 1, name: "المستودع الرئيسي" }],
  );
  // Movement history: date range and pages.
  await fresh.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "reduce", quantity: 10, reason: "بيع القطع", requestId: nextRequest(), actor }));
  await fresh.transaction((executor) => adjustQuantityAsset(executor as any, { productId: 369, kind: "count", quantity: 0, countedQuantity: 88, reason: "جرد دوري", responsibleStaffId: 7, requestId: nextRequest(), actor }));
  const page1 = await quantityMovements(fresh as any, 369, { page: 1, pageSize: 2 });
  const page2 = await quantityMovements(fresh as any, 369, { page: 2, pageSize: 2 });
  assert.deepEqual([page1.total, page1.totalPages, page1.data.length, page2.data.length], [3, 2, 2, 1]);
  assert.equal(page1.data[0].warehouseName, "المستودع الرئيسي");
  assert.deepEqual(page1.data.map((m) => m.metadata.totalAfter), [88, 90], "newest first with totals before/after");
  assert.equal((await quantityMovements(fresh as any, 369, { from: today, to: today })).total, 3);
  assert.equal((await quantityMovements(fresh as any, 369, { from: addDays(today, 1) })).total, 0);
  assert.equal((await quantityMovements(fresh as any, 369, { from: "not-a-day" })).total, 3, "invalid dates are ignored, not injected");

  console.log("PASS  quantity bookings: reserve 20+30, overbooking, overlap, checkout, partial return 15/3/2, idempotency");
  console.log("PASS  quantity adjustments: maintenance, write-off, add, count, commitment guard, purchase derivation, rollback");
  // An individual asset left «محجوز» in bookings whose date passed (nothing taken out)
  // converts; the bookings are not changed and the lapsed lines hold no units.
  const legacy = createDatabase();
  const pastLine = () => ({ productId: 400, quantity: 1, stage: "reserved", reservedAt: "2026-08-07T14:34:12.558Z" });
  legacy.state.bookings.push(
    { source: "service_order", id: 18, day: addDays(today, -76), status: "processing", customer: "زبون فاتورة مبيعات", details: { bookingOperations: { assets: [pastLine()] } } },
    { source: "service_order", id: 121, day: addDays(today, -6), status: "pending", customer: "دنيا علي", details: { bookingOperations: { assets: [pastLine()] } } },
  );
  const before = JSON.stringify(legacy.state.bookings);
  const needsManager = await expectError(
    () => legacy.transaction((executor) => configureQuantityTracking(executor as any, { productId: 400, trackingMode: "quantity", confirmConversion: false, isManager: true, actor })),
    /تأكيداً صريحاً/,
  );
  assert.equal((needsManager as QuantityAssetError).extra.requiresConfirmation, true, "past bookings still count as history");
  const convertedLegacy = await legacy.transaction((executor) =>
    configureQuantityTracking(executor as any, { productId: 400, trackingMode: "quantity", confirmConversion: true, isManager: true, actor }),
  );
  assert.equal(convertedLegacy.changed, true);
  assert.equal(JSON.stringify(legacy.state.bookings), before, "bookings are left exactly as they were");
  const legacySummary = (await quantityAssetSummary(legacy as any, 400, EVENT_DAY))!;
  assert.deepEqual([legacySummary.total, legacySummary.available], [1, 1], "lapsed reservations do not hold the unit");
  // A booking that is today or later, or a piece still out, keeps blocking.
  for (const [day, line] of [[today, pastLine()], [addDays(today, 3), pastLine()], [addDays(today, -6), { productId: 400, quantity: 1, reservedQty: 1, checkedOutQty: 1, stage: "out" }]] as const) {
    const blocked = createDatabase();
    blocked.state.bookings.push({ source: "service_order", id: 81, day, status: "pending", customer: "مصطفى", details: { bookingOperations: { assets: [line] } } });
    await expectError(
      () => blocked.transaction((executor) => configureQuantityTracking(executor as any, { productId: 400, trackingMode: "quantity", confirmConversion: true, isManager: true, actor })),
      new RegExp(`مرتبط بحجوزات نشطة \\(#81 بتاريخ ${day}\\)`),
    );
    assert.equal(blocked.state.quantity.has(400), false, "a refused conversion writes nothing");
  }

  console.log("PASS  tracking-mode conversion restrictions for historical individual assets");
  console.log("PASS  lapsed reservations (past day, nothing out) do not block conversion or hold units; current/out ones do");
  console.log("PASS  quantity manager: purchase invoice received once, no double return damage/loss, evidence, add 100 -> one movement, history pages");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
