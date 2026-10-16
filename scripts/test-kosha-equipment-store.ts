import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  saveKoshaEquipment,
  bookingKoshaEquipment,
} from "../src/server/kosha-equipment";

// Real service + real Drizzle query generation. Only database IO is replaced;
// unsupported queries fail rather than silently returning successful defaults.
const dialect = new PgDialect();
const equipment = {
  productId: 10,
  variantId: null,
  quantity: 2,
  unit: "قطعة",
  returnable: true,
  required: true,
  notes: "ورد",
};
type State = {
  assignments: any[];
  reservations: any[];
  details: any;
  timeline: any[];
  stock: number;
  conflict: number;
  failAudit: boolean;
  missingColumn: boolean;
  quantityTracked: boolean;
  otherQuantityHold: number;
};
function fixture() {
  let state: State = {
    assignments: [
      {
        id: 1,
        product_id: 10,
        quantity: 2,
        notes: "",
        shared: true,
        config: [equipment],
        name: "ورد",
        images: [],
      },
    ],
    reservations: [],
    details: {
      koshaId: 1,
      bookingOperations: { assets: [], productMeta: {}, productCharges: 123 },
      privateNote: "preserve",
    },
    timeline: [],
    stock: 10,
    conflict: 0,
    failAudit: false,
    missingColumn: false,
    quantityTracked: false,
    otherQuantityHold: 0,
  };
  const database: any = {
    transaction: async (fn: any) => {
      const draft = structuredClone(state);
      const executor = {
        execute: async (query: any) => {
          const built = dialect.sqlToQuery(query);
          const q = built.sql.replace(/\s+/g, " ").trim();
          const p = built.params;
          const rows = (value: any[]) => ({ rows: value });
          if (q.startsWith("select id from koshas")) return rows([{ id: 1 }]);
          if (q.includes("information_schema.columns"))
            return rows(draft.missingColumn ? [] : [{ exists: 1 }]);
          if (q.includes("pg_advisory_xact_lock")) return rows([]);
          // Quantity-asset tracking (migration 0124): none of these products use it.
          if (q.includes("information_schema.tables"))
            return rows([{ ready: true }]);
          if (q.includes("from asset_quantity_profiles"))
            return rows(
              draft.quantityTracked
                ? [{ product_id: 10, unit_of_measure: "قطعة", quantity_checked_out: 0, quantity_damaged: 0, quantity_maintenance: 0, quantity_missing: 0 }]
                : [],
            );
          if (q.includes("from kosha_bookings b cross join lateral jsonb_array_elements"))
            return rows([
              ...(draft.otherQuantityHold
                ? [{ source: "kosha_booking", booking_id: 8, day: "2026-10-20", status: "confirmed", customer_name: "حجز آخر", line: { productId: 10, trackingMode: "quantity", quantity: draft.otherQuantityHold, reservedQty: draft.otherQuantityHold, stage: "reserved" } }]
                : []),
              ...draft.details.bookingOperations.assets.map((line: any) => ({ source: "kosha_booking", booking_id: 7, day: "2026-10-20", status: "new", customer_name: "علي", line })),
            ]);
          if (q.includes("from stock_reservations where product_id = "))
            return rows([{ quantity: 0 }]);
          if (q.startsWith("select id,item_type from products"))
            return rows([{ id: p[0], item_type: "product" }]);
          if (q.includes("and shared=false")) return rows([]);
          if (q.startsWith("select id from product_variants")) return rows([]);
          if (q.startsWith("insert into kosha_asset_assignments")) {
            const group = JSON.parse(String(p[5]));
            const found = draft.assignments.find((r) => r.product_id === p[1]);
            const row = {
              id: found?.id ?? draft.assignments.length + 1,
              product_id: p[1],
              quantity: p[2],
              shared: true,
              notes: p[3],
              config: group,
              name: "ورد",
              images: [],
            };
            if (found) Object.assign(found, row);
            else draft.assignments.push(row);
            return rows([]);
          }
          if (q.startsWith("select id,product_id from kosha_asset_assignments"))
            return rows(draft.assignments);
          if (q.startsWith("update kosha_asset_assignments")) {
            draft.assignments = draft.assignments.filter((r) => r.id !== p[0]);
            return rows([]);
          }
          if (q.startsWith("select id,kosha_id,status,event_date"))
            return rows([
              {
                id: 7,
                kosha_id: 1,
                status: "new",
                event_date: "2026-10-20",
                details: structuredClone(draft.details),
                customer_name: "علي",
              },
            ]);
          if (q.startsWith("select id,status,event_date,custom_fields"))
            return rows([
              {
                id: 7,
                status: "new",
                event_date: "2026-10-20",
                details: structuredClone(draft.details),
                customer_name: "علي",
              },
            ]);
          if (q.includes("from kosha_asset_assignments a join products"))
            return rows(draft.assignments);
          if (
            q.startsWith(
              "select product_id,variant_id,quantity,status from stock_reservations",
            )
          )
            return rows(draft.reservations);
          if (q.startsWith("select id,stock,shared_stock_product_id"))
            return rows([
              { id: p[0], stock: draft.stock, shared_stock_product_id: null },
            ]);
          if (q.includes("from stock_reservations where product_id="))
            return rows([{ quantity: 0 }]);
          if (q.startsWith("select status from asset_profiles"))
            return rows([]);
          if (q.includes("cross join lateral jsonb_array_elements"))
            return rows([{ quantity: draft.conflict }]);
          if (q.includes("from equipment_custody"))
            return rows([{ quantity: 0 }]);
          if (q.startsWith("insert into stock_reservations")) {
            draft.reservations.push({
              product_id: p[0],
              variant_id: p[1],
              quantity: p[2],
              status: "reserved",
            });
            return rows([]);
          }
          if (q.startsWith("update kosha_bookings")) {
            draft.details = JSON.parse(String(p[0]));
            return rows([]);
          }
          if (q.startsWith("update service_orders")) {
            assert.match(q, /coalesce\("service_orders"\."custom_fields"/);
            const patch = JSON.parse(String(p[0]));
            assert.equal(
              Object.hasOwn(patch, "koshaPortalMedia"),
              false,
              "routed update cannot overwrite staff media",
            );
            assert.equal(
              Object.hasOwn(patch, "koshaPortalTimeline"),
              false,
              "routed update cannot overwrite staff timeline",
            );
            draft.details = { ...draft.details, ...patch };
            return rows([]);
          }
          if (q.startsWith("insert into entity_timeline")) {
            if (draft.failAudit) throw new Error("audit unavailable");
            draft.timeline.push(p);
            return rows([]);
          }
          throw new Error(`Unexpected SQL in equipment test: ${q}`);
        },
      };
      const result = await fn(executor);
      state = draft;
      return result;
    },
  };
  return {
    database,
    read: () => state,
    edit: (patch: Partial<State>) => Object.assign(state, patch),
  };
}
const who = { id: 1, name: "manager" };
async function run() {
  const f = fixture();
  await saveKoshaEquipment(1, [equipment], 1, f.database);
  assert.equal(f.read().stock, 10, "template save never deducts stock");
  assert.equal(
    f.read().reservations.length,
    0,
    "template save never creates holds",
  );
  assert.deepEqual(
    f.read().details.bookingOperations.assets,
    [],
    "template save never alters existing bookings",
  );
  const first = await bookingKoshaEquipment(
    { source: "kosha", id: 7 },
    "confirm",
    [equipment],
    who,
    f.database,
  );
  assert.equal(first.imported, 1);
  assert.equal(f.read().details.bookingOperations.assets[0].stage, "reserved");
  assert.equal(f.read().details.privateNote, "preserve");
  assert.equal(
    f.read().details.bookingOperations.productCharges,
    123,
    "equipment does not change historical charges",
  );
  const retry = await bookingKoshaEquipment(
    { source: "kosha", id: 7 },
    "confirm",
    [equipment],
    who,
    f.database,
  );
  assert.equal(retry.imported, 0, "retry cannot duplicate booking equipment");
  assert.equal(f.read().details.bookingOperations.assets.length, 1);
  assert.equal(
    f.read().timeline.length,
    1,
    "retry cannot duplicate import audit",
  );
  assert.equal(f.read().stock, 10, "import never checks stock out");
  await saveKoshaEquipment(
    1,
    [{ ...equipment, returnable: false }],
    1,
    f.database,
  );
  const changedPolicy = await bookingKoshaEquipment(
    { source: "kosha", id: 7 },
    "confirm",
    [{ ...equipment, returnable: false }],
    who,
    f.database,
  );
  assert.equal(
    changedPolicy.imported,
    0,
    "policy change cannot duplicate an existing physical asset as a material",
  );
  assert.equal(f.read().reservations.length, 0);
  const shortage = fixture();
  shortage.edit({ stock: 1 });
  await assert.rejects(
    () =>
      bookingKoshaEquipment(
        { source: "kosha", id: 7 },
        "confirm",
        [equipment],
        who,
        shortage.database,
      ),
    /غير متاحة/,
  );
  assert.equal(shortage.read().timeline.length, 0);
  assert.equal(shortage.read().details.bookingOperations.assets.length, 0);
  const rollback = fixture();
  rollback.edit({ failAudit: true });
  await assert.rejects(
    () =>
      bookingKoshaEquipment(
        { source: "kosha", id: 7 },
        "confirm",
        [equipment],
        who,
        rollback.database,
      ),
    /audit unavailable/,
  );
  assert.equal(
    rollback.read().details.bookingOperations.assets.length,
    0,
    "audit failure rolls back equipment import",
  );
  const consume = fixture();
  const material = { ...equipment, returnable: false, quantity: 1.5 };
  await saveKoshaEquipment(1, [material], 1, consume.database);
  await bookingKoshaEquipment(
    { source: "kosha", id: 7 },
    "confirm",
    [material],
    who,
    consume.database,
  );
  assert.equal(consume.read().reservations[0].quantity, 1.5);
  assert.equal(
    consume.read().details.bookingOperations.assets.length,
    0,
    "consumables must not become returnable assets",
  );
  assert.equal(
    consume.read().details.bookingOperations.productMeta["10:0"].unitPrice,
    0,
  );
  assert.equal(consume.read().stock, 10);
  await saveKoshaEquipment(1, [equipment], 1, consume.database);
  const reversePolicy = await bookingKoshaEquipment(
    { source: "kosha", id: 7 },
    "confirm",
    [equipment],
    who,
    consume.database,
  );
  assert.equal(
    reversePolicy.imported,
    0,
    "policy change cannot duplicate an existing material as a physical asset",
  );
  assert.equal(consume.read().details.bookingOperations.assets.length, 0);
  const conflictingMaterial = fixture();
  await saveKoshaEquipment(1, [material], 1, conflictingMaterial.database);
  conflictingMaterial.edit({ conflict: 1 });
  await assert.rejects(
    () =>
      bookingKoshaEquipment(
        { source: "kosha", id: 7 },
        "confirm",
        [material],
        who,
        conflictingMaterial.database,
      ),
    /غير متاحة/,
  );
  assert.equal(
    conflictingMaterial.read().reservations.length,
    0,
    "consumable policy cannot bypass physical asset holds",
  );
  const missing = fixture();
  missing.edit({ missingColumn: true });
  await assert.rejects(
    () => saveKoshaEquipment(1, [equipment], 1, missing.database),
    /ترقية/,
  );
  const fractional = fixture();
  await assert.rejects(
    () =>
      saveKoshaEquipment(
        1,
        [{ ...equipment, quantity: 0.5 }],
        1,
        fractional.database,
      ),
    /صحيحة/,
  );
  const routed = fixture();
  routed.edit({
    details: {
      ...routed.read().details,
      koshaPortalMedia: [{ id: "existing-photo" }],
      koshaPortalTimeline: [{ id: "existing-event" }],
    },
  });
  await bookingKoshaEquipment(
    { source: "service", id: 7 },
    "confirm",
    [equipment],
    who,
    routed.database,
  );
  assert.equal(routed.read().details.bookingOperations.assets.length, 1);
  assert.deepEqual(routed.read().details.koshaPortalMedia, [
    { id: "existing-photo" },
  ]);
  assert.deepEqual(routed.read().details.koshaPortalTimeline, [
    { id: "existing-event" },
  ]);
  // Quantity-based asset: overlapping bookings share the master quantity.
  const columns = { ...equipment, quantity: 20, notes: "عمود ملكي" };
  const shared = fixture();
  shared.edit({ quantityTracked: true, stock: 100, otherQuantityHold: 85, conflict: 1 });
  await saveKoshaEquipment(1, [columns], 1, shared.database);
  await assert.rejects(
    () => bookingKoshaEquipment({ source: "kosha", id: 7 }, "confirm", [columns], who, shared.database),
    /المتاح 15 قطعة، والمطلوب 20 قطعة/,
  );
  assert.equal(shared.read().details.bookingOperations.assets.length, 0);
  shared.edit({ otherQuantityHold: 30 });
  const sharedPreview = await bookingKoshaEquipment({ source: "kosha", id: 7 }, "preview", undefined, who, shared.database);
  assert.equal(sharedPreview.items[0].available, 70, "100 usable − 30 held by the other booking");
  const sharedImport = await bookingKoshaEquipment({ source: "kosha", id: 7 }, "confirm", [columns], who, shared.database);
  assert.equal(sharedImport.imported, 1, "a same-day booking holding part of the quantity no longer blocks the asset");
  const imported = shared.read().details.bookingOperations.assets[0];
  assert.deepEqual([imported.trackingMode, imported.quantity, imported.reservedQty, imported.checkedOutQty], ["quantity", 20, 20, 0]);
  assert.equal(shared.read().stock, 100, "template import never deducts warehouse stock");
  const sharedRetry = await bookingKoshaEquipment({ source: "kosha", id: 7 }, "confirm", [columns], who, shared.database);
  assert.equal(sharedRetry.imported, 0, "retry cannot add a second line for the same asset");
  console.log(
    "PASS real Koshah template/import service: no inventory deduction, financial preservation, duplicate retry, shortages, atomic audit rollback and consumable separation",
  );
  console.log("PASS Koshah template import for quantity assets: shared quantity, date-aware shortage, single booking line");
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
