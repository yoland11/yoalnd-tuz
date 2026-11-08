import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Regression for the shared stock engine in src/server/api.ts.
// - Each stock change and its ledger row commit together, or not at all.
// - On Vercel a request has a one-connection pool, so nothing inside a stock
//   transaction may use the global db (it would wait on the busy connection).
// - A repeated idempotency key changes stock once, not twice.
// - Movement errors reach the caller instead of being swallowed.
const source = readFileSync("src/server/api.ts", "utf8");
const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
const functionNames = new Set([
  "withStockWrite",
  "afterStockCommit",
  "getStockOwnerProduct",
  "insertStockMovementRow",
  "applyStockMovementEffects",
  "recordStockMovement",
  "adjustProductStock",
  "setProductStock",
  "adjustSaleStock",
  "applySalesInvoiceItemsStock",
  "syncProductStockFromVariants",
  "adjustVariantStock",
  "moveReservationShelf",
]);
const found = new Set();
const pieces = [];
for (const node of ast.statements) {
  if (ts.isFunctionDeclaration(node) && functionNames.has(node.name?.text)) {
    found.add(node.name.text);
    pieces.push(node.getText(ast));
  }
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((d) => d.name.getText(ast) === "stockAfterCommitQueues")
  ) {
    pieces.push(node.getText(ast));
  }
}
assert.deepEqual([...functionNames].filter((name) => !found.has(name)), [], "stock engine functions missing from api.ts");

// ---- in-memory database -------------------------------------------------
const insideTransaction = new AsyncLocalStorage();
let state;
function resetState() {
  state = {
    products: new Map([
      [1, { id: 1, stock: 10, costPrice: "0", sharedStockProductId: null }],
      [2, { id: 2, stock: 0, costPrice: "0", sharedStockProductId: 1 }],
      [3, { id: 3, stock: 5, costPrice: "25000", sharedStockProductId: null }],
      [4, { id: 4, stock: 0, costPrice: "0", sharedStockProductId: null }],
    ]),
    variants: new Map([
      [40, { id: 40, productId: 4, stock: 3, isActive: true }],
      [41, { id: 41, productId: 4, stock: 2, isActive: true }],
    ]),
    movements: [],
    warehouse: [],
    profiles: [],
    invoiceItems: [{ id: 501, invoiceId: 77, productId: 1, quantity: "2", trackInventorySnapshot: true }],
  };
}
resetState();
let transactions = 0;
let failMovementInsert = false;
const timeline = [];
const shelfMoves = [];

const productsTable = { id: "products.id" };
const stockMovementsTable = { id: "sm.id", idempotencyKey: "sm.idempotency_key", salesInvoiceId: "sm.sales_invoice_id" };
const warehouseStockTable = { productId: "ws.product_id", warehouseId: "ws.warehouse_id", quantity: "ws.quantity" };
const assetProfilesTable = { id: "ap.id", productId: "ap.product_id" };
const salesInvoicesTable = { id: "si.id" };
const salesInvoiceItemsTable = { invoiceId: "sii.invoice_id" };
const eq = (column, value) => ({ op: "eq", column, value });
const and = (...conditions) => ({ op: "and", conditions });
const sql = (parts, ...values) => ({ text: parts.join("?"), values });
const firstEq = (condition) =>
  condition?.op === "eq" ? condition : condition?.conditions?.find((c) => c?.op === "eq");

function runSql(query) {
  const text = query.text.replace(/\s+/g, " ").trim();
  if (/^UPDATE products SET stock = GREATEST\(0, stock \+ \?\)/i.test(text)) {
    const [delta, id] = query.values;
    const product = state.products.get(id);
    product.stock = Math.max(0, product.stock + Number(delta));
    return { rows: [] };
  }
  if (/^SELECT stock FROM products WHERE id = \? FOR UPDATE$/i.test(text)) {
    return { rows: [{ stock: state.products.get(query.values[0])?.stock }] };
  }
  if (/^update product_variants set stock = greatest\(0, stock \+ \?\)/i.test(text)) {
    const [delta, variantId] = query.values;
    const variant = state.variants.get(variantId);
    if (!variant) return { rows: [] };
    variant.stock = Math.max(0, variant.stock + Number(delta));
    return { rows: [{ product_id: variant.productId }] };
  }
  if (/^select id from products where id = \? for update$/i.test(text)) {
    return { rows: [{ id: query.values[0] }] };
  }
  if (/^update products set stock = coalesce\(\(select sum\(stock\) from product_variants/i.test(text)) {
    const productId = query.values[0];
    const total = [...state.variants.values()]
      .filter((v) => v.productId === productId && v.isActive)
      .reduce((sum, v) => sum + v.stock, 0);
    state.products.get(productId).stock = total;
    return { rows: [] };
  }
  throw new Error(`unexpected SQL in stock test: ${text}`);
}

function insertBuilder(table) {
  let values;
  let conflict = null;
  const run = async (wantRows) => {
    if (table === stockMovementsTable) {
      if (failMovementInsert) throw new Error("simulated stock_movements insert failure");
      const key = values.idempotencyKey;
      if (key && state.movements.some((m) => m.idempotencyKey === key)) {
        if (conflict?.kind === "nothing" && conflict.target === stockMovementsTable.idempotencyKey) return [];
        throw Object.assign(new Error('duplicate key value violates unique constraint "stock_movements_idempotency_idx"'), { code: "23505" });
      }
      const row = { id: state.movements.length + 1, ...values };
      state.movements.push(row);
      return wantRows ? [{ id: row.id }] : undefined;
    }
    if (table === warehouseStockTable) {
      const existing = state.warehouse.find(
        (r) => r.productId === values.productId && r.warehouseId === values.warehouseId,
      );
      if (existing) {
        assert.equal(conflict?.kind, "update", "warehouse stock must be one upsert, not read-then-write");
        assert.deepEqual([...conflict.target], [warehouseStockTable.productId, warehouseStockTable.warehouseId]);
        const delta = Number(conflict.set.quantity.values[1]);
        existing.quantity = String(Math.max(0, Number(existing.quantity) + delta));
        return [structuredClone(existing)];
      }
      const row = { id: state.warehouse.length + 1, ...values };
      state.warehouse.push(row);
      return [structuredClone(row)];
    }
    if (table === assetProfilesTable) {
      state.profiles.push({ id: state.profiles.length + 1, ...values });
      return [];
    }
    throw new Error("unexpected insert table");
  };
  const builder = {
    values(next) { values = next; return builder; },
    onConflictDoNothing(config = {}) { conflict = { kind: "nothing", ...config }; return builder; },
    onConflictDoUpdate(config) { conflict = { kind: "update", ...config }; return builder; },
    returning() { return run(true); },
    then(resolve, reject) { return run(false).then(resolve, reject); },
  };
  return builder;
}

function makeExecutor(isGlobal) {
  const guard = () => {
    if (isGlobal && insideTransaction.getStore())
      throw new Error("pool exhausted: the global db was used inside a stock transaction");
  };
  return {
    query: {
      productsTable: { findFirst: async ({ where }) => { guard(); return structuredClone(state.products.get(where.value) ?? null); } },
      assetProfilesTable: { findFirst: async ({ where }) => { guard(); return structuredClone(state.profiles.find((p) => p.productId === where.value) ?? null); } },
      salesInvoicesTable: { findFirst: async ({ where }) => { guard(); return { id: where.value, invoiceNo: "S-77" }; } },
    },
    execute: async (query) => { guard(); return runSql(query); },
    insert: (table) => { guard(); return insertBuilder(table); },
    update: (table) => {
      guard();
      return {
        set: (values) => ({
          where: async (condition) => {
            const id = firstEq(condition).value;
            if (table === productsTable) Object.assign(state.products.get(id), values);
            else if (table === assetProfilesTable) Object.assign(state.profiles.find((p) => p.id === id), values);
            else throw new Error("unexpected update table");
          },
        }),
      };
    },
    select: () => {
      guard();
      return {
        from: (table) => ({
          where: async (condition) => {
            const value = firstEq(condition).value;
            if (table === salesInvoiceItemsTable) return state.invoiceItems.filter((i) => i.invoiceId === value);
            if (table === stockMovementsTable)
              return state.movements
                .filter((m) => m.salesInvoiceId === value && m.idempotencyKey != null)
                .map((m) => ({ key: m.idempotencyKey }));
            throw new Error("unexpected select table");
          },
        }),
      };
    },
  };
}

const tx = makeExecutor(false);
const db = makeExecutor(true);
// One pooled connection: transactions run one after another, and a failed one
// leaves no trace.
let connection = Promise.resolve();
db.transaction = (callback) => {
  if (insideTransaction.getStore()) throw new Error("nested transaction on the global db");
  const run = async () => {
    transactions += 1;
    const snapshot = structuredClone(state);
    try {
      return await insideTransaction.run(true, () => callback(tx));
    } catch (err) {
      state = snapshot;
      throw err;
    }
  };
  const result = connection.then(run, run);
  connection = result.catch(() => {});
  return result;
};
const ensure = (name) => async () => {
  if (insideTransaction.getStore()) throw new Error(`${name} used the global db inside a stock transaction`);
};

const context = vm.createContext({
  db, sql, eq, and,
  productsTable, stockMovementsTable, warehouseStockTable, assetProfilesTable,
  salesInvoicesTable, salesInvoiceItemsTable,
  ensureStockTrackingTables: ensure("ensureStockTrackingTables"),
  ensureVariantTables: ensure("ensureVariantTables"),
  ensureAdminExtensionsTables: ensure("ensureAdminExtensionsTables"),
  addEntityTimeline: async (input) => { timeline.push({ input, insideTransaction: !!insideTransaction.getStore() }); },
  safeServerError: (err) => ({ message: String(err?.message ?? err) }),
  productSharedStockId: (product) => product?.sharedStockProductId ?? null,
  stockMovementKind: (reason) => ({ type: /out|sale|deduct|consumed/.test(String(reason)) ? "out" : "in" }),
  invoiceLineTracksInventory: () => true,
  warehouseBreakdowns: async (executor, ids) => {
    if (executor === db) throw new Error("warehouse breakdown read outside the transaction");
    return new Map(ids.map((id) => [id, { company: { inWarehouse: 10 } }]));
  },
  applyWarehouseDeltas: async (executor, change) => {
    if (executor === db) throw new Error("warehouse deltas written outside the transaction");
    shelfMoves.push(change);
  },
  console,
});
const compiled = ts.transpileModule(
  `${pieces.join("\n")}\nglobalThis.engine = { adjustProductStock, setProductStock, recordStockMovement, adjustVariantStock, applySalesInvoiceItemsStock, moveReservationShelf };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
vm.runInContext(compiled, context);
const engine = context.engine;
const flush = () => new Promise((resolve) => setImmediate(resolve));

// 1. No caller transaction: the change opens one, uses only it, follows shared stock.
await engine.adjustProductStock(2, -3, { reason: "order_stock_deducted", relatedType: "order", relatedId: 9 });
assert.equal(state.products.get(1).stock, 7);
assert.equal(state.movements.length, 1);
assert.equal(state.movements[0].stockSourceProductId, 1);
assert.equal(transactions, 1);
console.log("PASS stock change and ledger row commit in one transaction, without touching the global db");

// 2. Same idempotency key twice (retry or double click): stock moves once.
const keyed = { reason: "booking_penalty_stock", relatedType: "booking", relatedId: 5, idempotencyKey: "booking-penalty:5:stock" };
await engine.adjustProductStock(1, -2, keyed);
await engine.adjustProductStock(1, -2, keyed);
assert.equal(state.products.get(1).stock, 5);
assert.equal(state.movements.filter((m) => m.idempotencyKey === keyed.idempotencyKey).length, 1);
console.log("PASS a repeated idempotency key changes stock only once");

// 3. A failing ledger insert rolls the stock change back and reaches the caller.
failMovementInsert = true;
await assert.rejects(
  engine.adjustProductStock(1, -1, { reason: "order_stock_deducted", relatedType: "order", relatedId: 10 }),
  /simulated stock_movements insert failure/,
);
failMovementInsert = false;
assert.equal(state.products.get(1).stock, 5);
console.log("PASS a ledger failure is reported and leaves stock unchanged");

// 4. Inside a caller's transaction: no second transaction, no global db.
const before = transactions;
await db.transaction((outer) =>
  engine.adjustProductStock(1, 4, { reason: "purchase_return", relatedType: "order", relatedId: 11 }, outer),
);
assert.equal(transactions, before + 1);
assert.equal(state.products.get(1).stock, 9);
console.log("PASS a caller's transaction is reused, not nested");

// 5. Asset passport: usage counted in the transaction, timeline written after commit.
const timelineBefore = timeline.length;
await engine.adjustProductStock(3, -1, { reason: "rental_stock_deducted", relatedType: "order", relatedId: 12 });
await flush();
assert.equal(state.profiles.length, 1);
assert.equal(timeline.length, timelineBefore + 1);
assert.equal(timeline.at(-1).input.entityId, 3);
assert.ok(timeline.length > 0 && timeline.every((entry) => !entry.insideTransaction));
console.log("PASS the asset timeline is written after the stock transaction commits");

// 6. setProductStock records the change from the locked row.
await engine.setProductStock(1, 4, { reason: "manual_stock_set", relatedType: "product", relatedId: 1 });
assert.equal(state.products.get(1).stock, 4);
assert.equal(Number(state.movements.at(-1).quantityChange), -5);
console.log("PASS setting stock records the real difference");

// 7. Variant stock: product total re-synced and the ledger row is no longer best-effort.
await engine.adjustVariantStock(40, -2, { reason: "reservation_consumed:booking", sourceType: "booking", sourceId: 3 });
assert.equal(state.variants.get(40).stock, 1);
assert.equal(state.products.get(4).stock, 3);
assert.equal(state.movements.at(-1).variantId, 40);
failMovementInsert = true;
await assert.rejects(
  engine.adjustVariantStock(41, -1, { reason: "reservation_consumed:booking", sourceType: "booking", sourceId: 3 }),
  /simulated stock_movements insert failure/,
);
failMovementInsert = false;
assert.equal(state.variants.get(41).stock, 2);
console.log("PASS variant stock and its ledger row succeed or fail together");

// 8. Reservation shelf move: the stock-owner lookup stays inside its transaction.
await engine.moveReservationShelf(2, 7, -3);
assert.equal(shelfMoves.length, 1);
assert.equal(shelfMoves[0].productId, 1);
assert.equal(shelfMoves[0].company.inWarehouse, 7);
console.log("PASS moving a reservation shelf looks up the stock owner inside its transaction");

// 9. Sales invoice cycles: cancelled → active → cancelled are three real changes.
resetState();
state.movements.push({
  id: 1, productId: 1, salesInvoiceId: 77, quantityChange: "-2", reason: "sale",
  idempotencyKey: "sales-invoice-stock:77:501:sales_invoice_stock_restored",
});
await engine.applySalesInvoiceItemsStock(77, 1, "sales_invoice_stock_restored", null);
await engine.applySalesInvoiceItemsStock(77, -1, "sales_invoice_stock_deducted_again", null);
await engine.applySalesInvoiceItemsStock(77, 1, "sales_invoice_stock_restored", null);
assert.equal(state.products.get(1).stock, 12); // 10 + 2 − 2 + 2
assert.deepEqual(state.movements.slice(1).map((m) => m.idempotencyKey), [
  "sales-invoice-stock:77:501:sales_invoice_stock_restored:1",
  "sales-invoice-stock:77:501:sales_invoice_stock_deducted_again:0",
  "sales-invoice-stock:77:501:sales_invoice_stock_restored:2",
]);
console.log("PASS each sales-invoice stock cycle gets its own key and is logged");

// 10. Two identical sales-invoice requests at the same moment restore once.
resetState();
await Promise.all([
  engine.applySalesInvoiceItemsStock(77, 1, "sales_invoice_stock_restored", null),
  engine.applySalesInvoiceItemsStock(77, 1, "sales_invoice_stock_restored", null),
]);
assert.equal(state.products.get(1).stock, 12);
assert.equal(state.movements.length, 1);
console.log("PASS simultaneous identical sales-invoice requests change stock once");
