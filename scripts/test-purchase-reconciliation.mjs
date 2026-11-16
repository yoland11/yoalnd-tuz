// Executes the real purchase edit stock actions and total calculations against
// an in-memory SQL boundary. No application, database, credentials or network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("src/server/api.ts", "utf8");
const compile = (input) => ts.transpileModule(input, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const between = (start, end, from = 0) => {
  const begin = source.indexOf(start, from);
  const finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `purchase extraction: ${start}`);
  return source.slice(begin, finish);
};
const variantContext = { exports: {} };
vm.runInNewContext(compile(readFileSync("src/server/purchase-variant-lines.ts", "utf8")), variantContext);
const sql = (parts, ...values) => ({ text: parts.join("?"), values });
sql.join = (values) => values;
class CheckoutError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const makeContext = () => {
  const context = {
    sql, CheckoutError,
    groupPurchaseInvoiceStockChanges: variantContext.exports.groupPurchaseInvoiceStockChanges,
    stockOwnerProductIdsInTransaction: async (_tx, ids) => new Map(ids.map((id) => [id, id === 11 ? 10 : id])),
    stockMovementsTable: "movements", purchaseInvoiceItemsTable: { invoiceId: "invoiceId" },
    eq: () => true,
    money: (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0,
    textFallback: (...values) => values.find((value) => value != null && String(value).trim()) || "",
    normalizeProductBarcode: (value) => String(value || "").trim(),
  };
  vm.runInNewContext(compile(between("/** Batch purchase stock updates", "async function nextSalesInvoiceNo(")), context);
  vm.runInNewContext(compile(between("function purchaseInvoiceItems(value:", "async function preparePurchaseInvoiceVariantItemsInTransaction(")), context);
  return context;
};
const purchaseHandler = source.indexOf("async function handlePurchaseInvoices(");
const put = source.indexOf('if (method === "PUT" && id)', purchaseHandler);
// Include the actual line replacement and stock calls used by PUT, so reverting
// only the route to full reversal + full addition also breaks the regression.
const stockActions = between("      await reversePurchaseInvoiceStockInTransaction(", "      for (const item of processedItems)", put);
const makeStockFixture = (plainStock = 2, variantStock = 2) => {
  const products = new Map([[10, plainStock], [20, variantStock + 3]]);
  const variants = new Map([[21, { productId: 20, stock: variantStock }], [22, { productId: 20, stock: 3 }]]);
  const movements = [];
  let lines = [];
  const tx = {
    execute: async (query) => {
      if (/SELECT[\s\S]+FOR UPDATE/i.test(query.text)) return { rows: [] };
      if (/UPDATE products[\s\S]*SELECT SUM\(stock\)/i.test(query.text)) {
        const productId = Number(query.values[0]);
        products.set(productId, [...variants.values()].filter((row) => row.productId === productId).reduce((sum, row) => sum + row.stock, 0));
        return { rows: [{ id: productId }] };
      }
      if (/UPDATE (products|product_variants)/i.test(query.text)) {
        const isVariant = /UPDATE product_variants/i.test(query.text);
        const amount = Number(query.values[0]);
        const id = Number(query.values[1]);
        const current = isVariant ? variants.get(id)?.stock : products.get(id);
        if (current == null) return { rows: [] };
        const subtract = /stock(?:::numeric)? -/.test(query.text);
        const clamp = /GREATEST\(0,/.test(query.text);
        const next = current + (subtract ? -amount : amount);
        if (/AND stock(?:::numeric)? \+/.test(query.text) && next < 0) return { rows: [] };
        if (/AND stock(?:::numeric)? >=/.test(query.text) && current < amount) return { rows: [] };
        const result = clamp ? Math.max(0, next) : next;
        if (isVariant) variants.get(id).stock = result;
        else products.set(id, result);
        return { rows: [{ id, product_id: isVariant ? variants.get(id).productId : id }] };
      }
      throw new Error(`Unexpected stock SQL: ${query.text}`);
    },
    delete: () => ({ where: async () => { lines = []; } }),
    insert: (table) => ({ values: (values) => {
      if (table === "movements") { movements.push(...values); return Promise.resolve(); }
      // Match purchase_invoice_items.quantity numeric(12,3): PostgreSQL rounds
      // each persisted row before RETURNING, rather than the grouped quantity.
      lines = values.map((line, index) => ({ ...line, quantity: Number(line.quantity).toFixed(3), id: 101 + index }));
      return { returning: async () => lines };
    } }),
  };
  return { tx, products, variants, movements, get lines() { return lines; } };
};
async function editStock(oldItems, processedItems, fixture = makeStockFixture()) {
  const context = makeContext();
  Object.assign(context, { tx: fixture.tx, oldItems, processedItems, id: 1, a: { id: 1, name: "test" } });
  vm.runInNewContext(compile(`async function run(){${stockActions}} this.run=run;`), context);
  await context.run();
  return fixture;
}
const line = (quantity, productId = 10, variantId = null, id = 1) => ({
  id, productId, variantId, quantity, productName: "fixture", costPrice: 100, salePrice: 0, discount: 0, total: quantity * 100,
});

test("unchanged edit after selling eight of ten ordinary units keeps stock two", async () => {
  const state = await editStock([line(10)], [line(10)]);
  assert.equal(state.products.get(10), 2);
  assert.deepEqual(state.movements.map((row) => Number(row.quantityChange)), [-10, 10]);
  assert.equal(new Set(state.movements.map((row) => row.idempotencyKey)).size, 2);
});
test("unchanged variant edit preserves consumed stock and parent total", async () => {
  const state = await editStock([line(10, 20, 21)], [line(10, 20, 21)]);
  assert.equal(state.variants.get(21).stock, 2);
  assert.equal(state.products.get(20), 5);
});
test("increase adds only the newly purchased difference", async () => {
  const state = await editStock([line(10)], [line(13)]);
  assert.equal(state.products.get(10), 5);
});
test("variant increases and decreases reconcile only their differences", async () => {
  const increased = await editStock([line(10, 20, 21)], [line(12, 20, 21)]);
  assert.equal(increased.variants.get(21).stock, 4);
  assert.equal(increased.products.get(20), 7);
  const decreased = await editStock([line(10, 20, 21)], [line(9, 20, 21)]);
  assert.equal(decreased.variants.get(21).stock, 1);
  assert.equal(decreased.products.get(20), 4);
});
test("decrease removes only available units", async () => {
  const state = await editStock([line(10)], [line(9)]);
  assert.equal(state.products.get(10), 1);
});
test("shared-stock rows are reconciled at their common owner", async () => {
  const state = await editStock([line(10)], [line(4), line(7, 11)]);
  assert.equal(state.products.get(10), 3);
});
test("regrouping fractional quantities does not create a tiny negative stock delta", async () => {
  const state = await editStock([line(0.1), line(0.2, 10, null, 2)], [line(0.3)], makeStockFixture(0));
  assert.equal(state.products.get(10), 0);
});
test("edit stock agrees with individually persisted three-decimal purchase lines", async () => {
  const context = makeContext();
  const items = context.purchaseInvoiceItems([
    { productId: 10, productName: "first", quantity: 1.0006, costPrice: 100, discount: 0.03 },
    { productId: 10, productName: "second", quantity: 1.0006, costPrice: 100, discount: 0.03 },
  ]);
  const state = await editStock([line(1)], items, makeStockFixture(0));
  assert.equal(state.lines.reduce((sum, row) => sum + Number(row.quantity), 0), 2.002);
  assert.equal(state.products.get(10), 1.002, "old purchase 1 replaced by two stored 1.001 lines adds 1.002 units");
  assert.deepEqual(state.lines.map((row) => Number(row.total)), [100.07, 100.07]);
});
test("variant quantity validation rejects fractions that would round to an integer", () => {
  const context = makeContext();
  const catalog = [{ id: 20, name: "variant product", variants: [{ id: 21, productId: 20, isActive: true }] }];
  for (const quantity of [1.0004, 0.9996, 1.5]) {
    const items = context.purchaseInvoiceItems([{ productId: 20, variantId: 21, productName: "variant product", quantity, costPrice: 100 }]);
    assert.equal(variantContext.exports.preparePurchaseVariantLines(items, catalog).ok, false, `fractional variant ${quantity} must remain invalid`);
  }
});
test("reducing consumed ordinary or variant stock fails before line/movement replacement", async () => {
  for (const [productId, variantId] of [[10, null], [20, 21]]) {
    const state = makeStockFixture();
    await assert.rejects(editStock([line(10, productId, variantId)], [line(7, productId, variantId)], state), (cause) => cause instanceof CheckoutError && cause.status === 422);
    assert.equal(state.products.get(10), 2);
    assert.equal(state.variants.get(21).stock, 2);
    assert.equal(state.movements.length, 0);
    assert.equal(state.lines.length, 0);
  }
});
test("deletion reverses available stock exactly and rejects consumed stock", async () => {
  const context = makeContext();
  for (const [productId, variantId] of [[10, null], [20, 21]]) {
    const available = makeStockFixture(10, 10);
    await context.reversePurchaseInvoiceStockInTransaction(available.tx, [line(10, productId, variantId)], 1, { id: 1, name: "test" }, "purchase_invoice_deleted_reversal");
    assert.equal(variantId ? available.variants.get(variantId).stock : available.products.get(productId), 0);
    assert.equal(Number(available.movements[0].quantityChange), -10);
    const consumed = makeStockFixture();
    await assert.rejects(context.reversePurchaseInvoiceStockInTransaction(consumed.tx, [line(10, productId, variantId)], 1, { id: 1, name: "test" }, "purchase_invoice_deleted_reversal"), (cause) => cause instanceof CheckoutError && cause.status === 422);
    assert.equal(consumed.movements.length, 0);
    assert.equal(variantId ? consumed.variants.get(variantId).stock : consumed.products.get(productId), 2);
  }
});

for (const [name, start] of [["POST", source.indexOf('if (method === "POST")', purchaseHandler)], ["PUT", put]]) {
  test(`${name} quantity precision is normalized per line before total calculation`, () => {
    const context = makeContext();
    const items = context.purchaseInvoiceItems([
      { productId: 10, productName: "first", quantity: 1.0006, costPrice: 100, discount: 0.03 },
      { productId: 10, productName: "second", quantity: 1.0006, costPrice: 100, discount: 0.03 },
    ]);
    Object.assign(context, { items, newItems: items, b: {} });
    vm.runInNewContext(`${between("    const subtotal =", "    const paymentMethod =", start)}; this.result = {subtotal,total};`, context);
    assert.deepEqual(Array.from(items, (item) => item.quantity), [1.001, 1.001]);
    assert.deepEqual(Array.from(items, (item) => item.total), [100.07, 100.07]);
    assert.equal(context.result.subtotal, 200.14);
    assert.equal(context.result.total, 200.14);
  });
  test(`${name} header includes line discounts exactly once`, () => {
    const context = makeContext();
    const items = context.purchaseInvoiceItems([{ productName: "fixture", quantity: 2, costPrice: 100, discount: 30 }]);
    Object.assign(context, { items, newItems: items, b: { discountAmount: 10, taxAmount: 5, shippingCost: 7 } });
    const calculation = between("    const subtotal =", "    const paymentMethod =", start);
    vm.runInNewContext(`${calculation}; this.result = {subtotal,discountAmount,taxAmount,shippingCost,total};`, context);
    assert.equal(items[0].total, 170);
    assert.equal(context.result.subtotal, 170);
    assert.equal(context.result.total, 172);
  });
  test(`${name} cents, decimal quantities and excessive discounts remain consistent`, () => {
    const context = makeContext();
    const items = context.purchaseInvoiceItems([
      { productName: "decimal", quantity: 1.5, costPrice: 10.01, discount: 0.01 },
      { productName: "tiny", quantity: 2, costPrice: 0.1, discount: 0 },
      { productName: "free", quantity: 1, costPrice: 1, discount: 5 },
    ]);
    Object.assign(context, { items, newItems: items, b: { discountAmount: 0.1, taxAmount: 0.2, shippingCost: 0.3 } });
    vm.runInNewContext(`${between("    const subtotal =", "    const paymentMethod =", start)}; this.result = {subtotal,total};`, context);
    assert.deepEqual(Array.from(items, (item) => item.total), [15.01, 0.2, 0]);
    assert.equal(context.result.subtotal, 15.21);
    assert.equal(context.result.total, 15.61);
  });
}
