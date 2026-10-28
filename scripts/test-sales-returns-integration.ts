/**
 * Real-PostgreSQL integration test for grouped multi-invoice sales returns.
 * Write test: runs ONLY with AJN_ENV=test, ALLOW_TEST_WRITES=true and a separate
 * TEST_DATABASE_URL (never DATABASE_URL). Otherwise it reports SKIPPED. Every
 * row it creates belongs to this run's unique prefix.
 */
import assert from "node:assert/strict";
// @ts-expect-error shared .mjs guard without type declarations
import { assertSafeTestDatabase } from "./lib/test-database-guard.mjs";

let target: { url: string };
try {
  target = assertSafeTestDatabase(process.env);
} catch {
  console.log("SKIPPED sales returns integration: separate verified TEST database and write flags unavailable (not reported as PASS).");
  process.exit(process.argv.includes("--strict") ? 2 : 0);
}
// Only this verified child process talks to the TEST database; never DATABASE_URL.
process.env.DATABASE_URL = target!.url;

const { db } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
const returns = await import("../src/server/sales-returns");
const { reconcilePaymentState } = await import("../src/server/payment-state");
const { approveAndExecuteFinancialTransaction } = await import("../src/server/master-cash-box");
const { getCustomerStatement, getCustomerAccountSummary } = await import("../src/server/customer-account");

const run = `t${Date.now().toString(36)}`;
const one = async (query: any) => ((await db.execute(query)) as any).rows[0];
const all = async (query: any) => ((await db.execute(query)) as any).rows as any[];
const n = (value: unknown) => Number(value);
let keySeq = 0;
const key = () => `${run}-key-${++keySeq}-${Math.random().toString(36).slice(2, 8)}`;
const rejects = async (work: () => Promise<unknown>, pattern: RegExp, label: string) => {
  try {
    await work();
  } catch (cause: any) {
    assert.match(String(cause?.message), pattern, `${label}: ${cause?.message}`);
    return cause;
  }
  assert.fail(`${label}: expected a rejection`);
};

// ── Seed (unique to this run) ────────────────────────────────────────────
const admin = await one(sql`INSERT INTO staff (username, password_hash, full_name, role, permissions, is_active) VALUES (${`${run}-admin`}, 'x', 'مدير الاختبار', 'admin', '[]', true) RETURNING id`);
const clerk = await one(sql`INSERT INTO staff (username, password_hash, full_name, role, permissions, is_active) VALUES (${`${run}-clerk`}, 'x', 'موظف المرتجعات', 'staff', ${JSON.stringify(["sales_returns.create", "sales_returns.view"])}, true) RETURNING id`);
const adminActor = { id: n(admin.id), name: "مدير الاختبار", role: "admin", permissions: [] as string[] };
const clerkActor = { id: n(clerk.id), name: "موظف المرتجعات", role: "staff", permissions: ["sales_returns.create", "sales_returns.view"] };
const customer = await one(sql`INSERT INTO customers (phone, name, full_name, customer_type) VALUES (${`07${Date.now().toString().slice(-9)}`}, 'شركة فهود', 'شركة فهود', 'wholesale') RETURNING id`);
const other = await one(sql`INSERT INTO customers (phone, name) VALUES (${`07${(Date.now() + 7).toString().slice(-9)}`}, 'عميل آخر') RETURNING id`);
const cid = n(customer.id);
const shawl = await one(sql`INSERT INTO products (name, name_ar, price, stock) VALUES (${`${run}-shawl`}, 'شال حنة', 1860, 100) RETURNING id`);
const fan = await one(sql`INSERT INTO products (name, name_ar, price, stock) VALUES (${`${run}-fan`}, 'مهفة ريش', 2400, 40) RETURNING id`);

async function invoice(no: string, date: string, customerId: number, lines: { productId: number; name: string; qty: number; price: number; discount?: number }[], extra: { discount?: number; tax?: number; paid?: number } = {}) {
  const lineTotals = lines.map((line) => line.qty * line.price - (line.discount ?? 0));
  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const discount = lines.reduce((sum, line) => sum + (line.discount ?? 0), 0) + (extra.discount ?? 0);
  const total = subtotal - discount + (extra.tax ?? 0);
  const row = await one(sql`
    INSERT INTO sales_invoices (invoice_no, date, customer_id, customer_name, subtotal, discount_amount, tax_amount, total, paid_amount, remaining_amount, payment_method, payment_status, status)
    VALUES (${`${run}-${no}`}, ${date}, ${customerId}, 'شركة فهود', ${String(subtotal)}, ${String(discount)}, ${String(extra.tax ?? 0)}, ${String(total)}, '0', ${String(total)}, 'credit', 'unpaid', 'active')
    RETURNING id`);
  const items: number[] = [];
  for (const [index, line] of lines.entries()) {
    const item = await one(sql`
      INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price, discount, total, cost_price, track_inventory_snapshot)
      VALUES (${n(row.id)}, ${line.productId}, ${line.name}, ${String(line.qty)}, ${String(line.price)}, ${String(line.discount ?? 0)}, ${String(lineTotals[index])}, '1000', true)
      RETURNING id`);
    items.push(n(item.id));
  }
  if (extra.paid) {
    await db.execute(sql`
      INSERT INTO financial_transactions (transaction_no, transaction_date, direction, amount, transaction_type, idempotency_key, approval_status, source_type, source_id, customer_id)
      VALUES (${`${run}-FT-${no}`}, ${date}, 'revenue', ${String(extra.paid)}, 'sales_invoice', ${`${run}-ft-${no}`}, 'executed', 'sales_invoice', ${String(row.id)}, ${customerId})`);
  }
  await db.transaction((tx) => reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: n(row.id) }));
  return { id: n(row.id), items, total };
}
const inv101 = await invoice("INV-101", "2024-01-15", cid, [{ productId: n(shawl.id), name: "شال حنة", qty: 100, price: 2000 }], { paid: 200000 });
const inv115 = await invoice("INV-115", "2024-03-20", cid, [{ productId: n(shawl.id), name: "شال حنة", qty: 150, price: 1800 }, { productId: n(fan.id), name: "مهفة ريش", qty: 50, price: 3200 }], { paid: 100000 });
// Invoice-level discount 10,000 on a 300,000 line: refundable line value 290,000.
const inv130 = await invoice("INV-130", "2024-05-10", cid, [{ productId: n(shawl.id), name: "شال حنة", qty: 200, price: 1500 }], { discount: 10000 });
const otherInv = await invoice("INV-OTHER", "2024-01-01", n(other.id), [{ productId: n(shawl.id), name: "شال حنة", qty: 30, price: 2000 }]);
assert.equal(n((await one(sql`SELECT remaining_amount FROM sales_invoices WHERE id = ${inv115.id}`)).remaining_amount), 330000);

const shawlKey = `p:${shawl.id}|u:`;
const fanKey = `p:${fan.id}|u:`;
const save = (actor: typeof adminActor, items: any[], submit: boolean, extra: Record<string, unknown> = {}, returnId: number | null = null) =>
  returns.saveSalesReturn(db as any, actor, { customerId: cid, reasonCode: "excess_quantity", items, submit, idempotencyKey: key(), ...extra } as any, returnId);
const detail = (id: number) => returns.readSalesReturn(db as any, adminActor, id);
const stockOf = async (productId: number) => n((await one(sql`SELECT stock FROM products WHERE id = ${productId}`)).stock);

// 1. Purchased products are grouped across the customer's invoices only.
const purchases = await returns.readCustomerPurchases(db as any, adminActor, cid);
const shawlGroup = purchases.products.find((product) => product.key === shawlKey)!;
assert.equal(shawlGroup.purchased, 450, "grouped across INV-101/115/130, not the other customer's invoice");
assert.equal(shawlGroup.available, 450);
assert.equal(purchases.customer.outstanding, 330000 + 290000);

// 2. Earlier partial returns: 10 from INV-101 (FIFO) and 20 from INV-130 (manual, admin).
const r1 = await save(adminActor, [{ productKey: shawlKey, quantity: 10, condition: "good" }], true);
const r0 = await save(adminActor, [{ productKey: shawlKey, quantity: 20, condition: "good", allocations: [{ invoiceItemId: inv130.items[0], quantity: 20 }] }], true);
assert.equal((await detail(r1.id)).items[0].invoiceNo, `${run}-INV-101`);
assert.equal((await detail(r0.id)).return.totalAmount, 29000, "20/200 of the discounted 290,000 line");

// 3. Spec example: 250 units FIFO → INV-101 90, INV-115 150, INV-130 10.
const r2 = await save(adminActor, [{ productKey: shawlKey, quantity: 250, condition: "good" }, { productKey: fanKey, quantity: 5, condition: "inspection" }], false, { warehouseId: null });
let d2 = await detail(r2.id);
const byInvoice = Object.fromEntries(d2.items.filter((item) => item.productKey === shawlKey).map((item) => [item.invoiceNo.replace(`${run}-`, ""), item.quantity]));
assert.deepEqual(byInvoice, { "INV-101": 90, "INV-115": 150, "INV-130": 10 });
const shawlAmount = d2.items.filter((item) => item.productKey === shawlKey).reduce((sum, item) => sum + item.amount, 0);
assert.equal(shawlAmount, 180000 + 270000 + 14500, "original prices; INV-130 carries its invoice discount share");
assert.equal(d2.return.status, "draft");

// 4. Over-returning and cross-customer allocation are refused.
await rejects(() => save(adminActor, [{ productKey: shawlKey, quantity: 500, condition: "good" }], true), /أكبر من المتاح/, "over-return");
await rejects(() => save(adminActor, [{ productKey: shawlKey, quantity: 5, condition: "good", allocations: [{ invoiceItemId: otherInv.items[0], quantity: 5 }] }], true), /لا يخص/, "cross-customer line");
// 5. Manual allocation needs the override permission.
await rejects(() => save(clerkActor, [{ productKey: shawlKey, quantity: 5, condition: "good", allocations: [{ invoiceItemId: inv130.items[0], quantity: 5 }] }], true), /صلاحية/, "clerk manual split");

// 6. Draft edits are version-guarded; submit reserves the quantities.
await rejects(() => save(adminActor, [{ productKey: shawlKey, quantity: 250, condition: "good" }], false, { expectedVersion: 99 }, r2.id), /تغيّر المرتجع/, "stale draft");
await returns.submitSalesReturn(db as any, adminActor, r2.id);
d2 = await detail(r2.id);
assert.equal(d2.return.status, "pending_approval");
const afterReserve = (await returns.readCustomerPurchases(db as any, adminActor, cid)).products.find((p) => p.key === shawlKey)!;
assert.equal(afterReserve.available, 450 - 10 - 20 - 250);

// 7. Concurrent submissions cannot both take the last 170 units.
const racers = await Promise.allSettled([
  save(adminActor, [{ productKey: shawlKey, quantity: 100, condition: "good" }], true),
  save(adminActor, [{ productKey: shawlKey, quantity: 100, condition: "good" }], true),
]);
assert.equal(racers.filter((r) => r.status === "fulfilled").length, 1, "exactly one concurrent return wins");
const loser = racers.find((r) => r.status === "rejected") as PromiseRejectedResult;
assert.match(String(loser.reason?.message), /أكبر من المتاح/);
const winner = (racers.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: number }>).value;
// 8. Rejection releases the reservation.
await returns.rejectSalesReturn(db as any, adminActor, winner.id, "اختبار الرفض");
assert.equal((await returns.readCustomerPurchases(db as any, adminActor, cid)).products.find((p) => p.key === shawlKey)!.available, 170);

// 9. Idempotent create: the same key returns the same return.
const replayKey = key();
const first = await returns.saveSalesReturn(db as any, adminActor, { customerId: cid, reasonCode: "other", notes: "مكرر", items: [{ productKey: fanKey, quantity: 1, condition: "good" }], submit: false, idempotencyKey: replayKey } as any, null);
const second = await returns.saveSalesReturn(db as any, adminActor, { customerId: cid, reasonCode: "other", notes: "مكرر", items: [{ productKey: fanKey, quantity: 1, condition: "good" }], submit: false, idempotencyKey: replayKey } as any, null);
assert.equal(second.id, first.id);
assert.equal(second.replayed, true);
await returns.cancelSalesReturn(db as any, adminActor, first.id, "مسودة تجريبية");

// 10. Approval, physical receipt, inventory by condition.
await returns.approveSalesReturn(db as any, adminActor, r2.id, "تمت المراجعة");
await rejects(() => returns.acceptSalesReturnInventory(db as any, adminActor, r2.id, []), /استلام البضاعة/, "inventory before receipt");
await returns.receiveSalesReturn(db as any, clerkActor, r2.id, "استلمها المخزن");
const shawlBefore = await stockOf(n(shawl.id));
const fanBefore = await stockOf(n(fan.id));
await rejects(() => returns.acceptSalesReturnInventory(db as any, clerkActor, r2.id, []), /صلاحية/, "clerk inventory");
await returns.acceptSalesReturnInventory(db as any, adminActor, r2.id, []);
await returns.acceptSalesReturnInventory(db as any, adminActor, r2.id, []); // replay: nothing pending
assert.equal(await stockOf(n(shawl.id)), shawlBefore + 250, "good items return to sellable stock once");
assert.equal(await stockOf(n(fan.id)), fanBefore, "inspection items stay out of sale");
const fanItem = (await detail(r2.id)).items.find((item) => item.productKey === fanKey)!;
assert.equal(fanItem.inventoryState, "inspection");
await returns.resolveInspection(db as any, adminActor, r2.id, fanItem.id, "restock", "سليم بعد الفحص");
assert.equal(await stockOf(n(fan.id)), fanBefore + 5);
const movements = await all(sql`SELECT reason, quantity_change::numeric AS q FROM stock_movements WHERE related_type = 'sales_return' AND related_id = ${r2.id} ORDER BY id`);
assert.deepEqual(movements.map((m) => m.reason).sort(), ["customer_return_inspection_hold", "customer_return_restock", "customer_return_restock", "customer_return_restock", "customer_return_restock"].sort());

// 11. Settlement split: debt deduction (source invoices first), credit, refund.
d2 = await detail(r2.id);
const total = d2.return.totalAmount;
const fanAmount = d2.items.filter((item) => item.productKey === fanKey).reduce((sum, item) => sum + item.amount, 0);
assert.equal(total, 464500 + fanAmount);
await rejects(() => returns.settleSalesReturn(db as any, adminActor, r2.id, { invoiceCredit: total + 1, customerCredit: 0, refund: 0, idempotencyKey: key() }), /أكبر من المبلغ غير المسوّى/, "over-settle");
await rejects(() => returns.settleSalesReturn(db as any, adminActor, r2.id, { invoiceCredit: 0, customerCredit: 0, refund: 400000, refundMethod: "cash", idempotencyKey: key() }), /المدفوع فعلياً/, "refund above cash actually paid");
const settleKey = key();
const refund = total - 300000 - 100000;
await returns.settleSalesReturn(db as any, adminActor, r2.id, { invoiceCredit: 300000, customerCredit: 100000, refund, refundMethod: "cash", idempotencyKey: settleKey });
const replay = await returns.settleSalesReturn(db as any, adminActor, r2.id, { invoiceCredit: 300000, customerCredit: 100000, refund, refundMethod: "cash", idempotencyKey: settleKey });
assert.equal(replay.replayed, true, "settlement replay writes nothing");
const inv115After = await one(sql`SELECT paid_amount, remaining_amount, payment_status FROM sales_invoices WHERE id = ${inv115.id}`);
assert.equal(n(inv115After.paid_amount), 100000, "paid stays cash only");
assert.equal(n(inv115After.remaining_amount), 30000, "debt deducted from the oldest source invoice first");
d2 = await detail(r2.id);
assert.equal(d2.return.status, "completed");
assert.equal(d2.return.settlementStatus, "refund_pending");
const refundTx = d2.settlements.find((s) => s.kind === "refund")!;
assert.equal(refundTx.transactionStatus, "pending", "refund waits for financial approval; no cash moved");

// 11b. Views and legacy writers that derive remaining from paid see the credit.
assert.equal(await returns.salesInvoiceReturnCredits(db, inv115.id), 300000);
assert.equal(await returns.salesInvoiceReturnCredits(db, otherInv.id), 0);
const linked = await returns.invoicesWithSalesReturns(db, [inv101.id, inv115.id, inv130.id, otherInv.id]);
assert.deepEqual([...linked].sort((a, b) => a - b), [inv101.id, inv115.id, inv130.id].sort((a, b) => a - b));
const creditsSql = await returns.salesInvoiceReturnCreditsSql(sql`s.id`);
const registerRow = await one(sql`SELECT greatest(s.total::numeric - s.paid_amount::numeric - ${creditsSql}, 0) AS remaining, ${creditsSql}::numeric AS credited FROM sales_invoices s WHERE s.id = ${inv115.id}`);
assert.equal(n(registerRow.remaining), 30000, "register remaining matches the reconciled snapshot");
assert.equal(n(registerRow.credited), 300000);

// 12. Customer credit used on an open invoice; statement and summary agree.
await rejects(() => returns.applyCustomerCredit(db as any, adminActor, { customerId: cid, invoiceId: otherInv.id, amount: 1000, idempotencyKey: key() }), /لا تخص/, "credit on another customer's invoice");
await returns.applyCustomerCredit(db as any, adminActor, { customerId: cid, invoiceId: inv130.id, amount: 40000, idempotencyKey: key() });
assert.equal(n((await one(sql`SELECT remaining_amount FROM sales_invoices WHERE id = ${inv130.id}`)).remaining_amount), 250000);
const customerSummary = await returns.readCustomerReturnsSummary(db as any, adminActor, cid);
assert.equal(customerSummary.availableCredit, 60000);
const account = await getCustomerAccountSummary({ id: cid });
assert.equal(account.totalReturnCredits, 340000, "debt removed by returns is reported separately");
assert.equal(account.totalPaid, 300000, "cash paid is not inflated by return credits");
const statement = await getCustomerStatement({ id: cid });
assert.equal(statement.closingBalance, account.currentBalance - 60000 - refund, "statement = debt − unused credit − refund owed");

// 13. Reversal is blocked while credit is used; reverse the usage, then the return.
await rejects(() => returns.reverseSalesReturn(db as any, adminActor, r2.id, "خطأ في الكمية"), /استُخدم/, "credit used");
await rejects(() => returns.reverseSalesReturn(db as any, clerkActor, r2.id, "خطأ"), /للإدارة/, "clerk reversal");
const usage = await one(sql`SELECT id FROM sales_return_settlements WHERE parent_settlement_id IS NOT NULL AND customer_id = ${cid} AND status = 'applied'`);
await returns.reverseSettlement(db as any, adminActor, n(usage.id), "تصحيح الاستخدام");
assert.equal(n((await one(sql`SELECT remaining_amount FROM sales_invoices WHERE id = ${inv130.id}`)).remaining_amount), 290000);
const stockBeforeReverse = await stockOf(n(shawl.id));
await returns.reverseSalesReturn(db as any, adminActor, r2.id, "أُرجعت 250 بالخطأ");
await returns.reverseSalesReturn(db as any, adminActor, r2.id, "تكرار"); // no double reversal
d2 = await detail(r2.id);
assert.equal(d2.return.status, "reversed");
assert.match(String(d2.return.reversalNo), /^REV-/);
assert.equal(await stockOf(n(shawl.id)), stockBeforeReverse - 250, "restocked goods leave stock once");
assert.equal(n((await one(sql`SELECT remaining_amount FROM sales_invoices WHERE id = ${inv115.id}`)).remaining_amount), 330000, "debt comes back");
assert.equal((await one(sql`SELECT approval_status FROM financial_transactions WHERE id = ${refundTx.financialTransactionId}`)).approval_status !== "executed", true, "pending refund cancelled, never paid");
assert.equal((await returns.readCustomerPurchases(db as any, adminActor, cid)).products.find((p) => p.key === shawlKey)!.available, 420, "reversed return frees its quantity");

// 14. Reversal after an executed refund needs explicit financial recovery.
await db.execute(sql`UPDATE master_cash_box SET current_balance = current_balance + 1000000 WHERE code = 'MASTER'`);
const r3 = await save(adminActor, [{ productKey: shawlKey, quantity: 5, condition: "good" }], true);
await returns.approveSalesReturn(db as any, adminActor, r3.id, null);
await returns.settleSalesReturn(db as any, adminActor, r3.id, { invoiceCredit: 0, customerCredit: 0, refund: (await detail(r3.id)).return.totalAmount, refundMethod: "cash", idempotencyKey: key() });
const r3Refund = (await detail(r3.id)).settlements.find((s) => s.kind === "refund")!;
await approveAndExecuteFinancialTransaction(r3Refund.financialTransactionId!, { id: adminActor.id, name: adminActor.name, role: "admin" });
assert.equal((await detail(r3.id)).return.settlementStatus, "settled");
await rejects(() => returns.reverseSalesReturn(db as any, adminActor, r3.id, "خطأ"), /تم صرف مبلغ/, "executed refund");

// 15. Reversal after the returned goods were resold cannot create negative stock.
const r4 = await save(adminActor, [{ productKey: fanKey, quantity: 5, condition: "good" }], true);
await returns.approveSalesReturn(db as any, adminActor, r4.id, null);
await returns.receiveSalesReturn(db as any, adminActor, r4.id, null);
await returns.acceptSalesReturnInventory(db as any, adminActor, r4.id, []);
await db.execute(sql`UPDATE products SET stock = 2 WHERE id = ${n(fan.id)}`);
await rejects(() => returns.reverseSalesReturn(db as any, adminActor, r4.id, "خطأ"), /يبدو أنها بيعت/, "resold stock");
assert.equal(await stockOf(n(fan.id)), 2, "a blocked reversal changes nothing");

// 16. Invoice guards see linked returns.
assert.ok((await returns.salesReturnsForInvoice(db, inv101.id, "active")).length > 0);
assert.deepEqual(await returns.salesReturnsForInvoice(db, otherInv.id, "any"), []);

// 17. Reports aggregate approved/completed returns only.
const reports = await returns.readSalesReturnReports(db as any, adminActor, {});
assert.ok(reports.byProduct.some((row) => row.label === "شال حنة"));
assert.ok(reports.reversals.some((row) => row.returnNo === d2.return.returnNo));

// 18. Graduation and research mirror invoices stay in their own modules.
const purchasedBefore = (await returns.readCustomerPurchases(db as any, adminActor, cid)).products.find((p) => p.key === shawlKey)!.purchased;
const gradInv = await invoice("INV-GRAD", "2024-02-01", cid, [{ productId: n(shawl.id), name: "شال حنة", qty: 40, price: 2000 }]);
await db.execute(sql`INSERT INTO graduation_orders (order_no, qr_token, customer_name, phone, invoice_id) VALUES (${`${run}-GRAD`}, ${`${run}-grad-qr`}, 'طالب تخرج', '07700000000', ${gradInv.id})`);
assert.equal((await returns.readCustomerPurchases(db as any, adminActor, cid)).products.find((p) => p.key === shawlKey)!.purchased, purchasedBefore, "graduation mirror lines are not returnable here");
await returns.settleSalesReturn(db as any, adminActor, r4.id, { invoiceCredit: 0, customerCredit: (await detail(r4.id)).return.totalAmount, refund: 0, idempotencyKey: key() });
await rejects(() => returns.applyCustomerCredit(db as any, adminActor, { customerId: cid, invoiceId: gradInv.id, amount: 1000, idempotencyKey: key() }), /طلب تخرج أو بحث/, "credit on a graduation mirror invoice");
assert.ok(!(await returns.readCustomerReturnsSummary(db as any, adminActor, cid)).openInvoices.some((row) => row.id === gradInv.id), "mirror invoice is not offered for credit use");

console.log(`PASS sales returns integration (${run}): FIFO across invoices, original pricing with discount share, reservations, concurrency, approvals, inventory by condition, debt/credit/refund settlement, statement, guarded reversal, credit-aware views, module-owned invoices excluded`);
process.exit(0);
