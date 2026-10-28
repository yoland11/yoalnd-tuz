import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SalesReturnRuleError,
  allocateFifo,
  allocateInvoiceCredit,
  lineRefundableCents,
  returnAmountCents,
  returnProductKey,
  toMilli,
  validateAllocation,
  validateSettlementPlan,
  type ReturnableLine,
} from "../src/lib/sales-returns";

const line = (invoiceItemId: number, invoiceId: number, date: string, quantity: number, consumed = 0): ReturnableLine => ({
  invoiceItemId,
  invoiceId,
  invoiceNo: `INV-${invoiceId}`,
  invoiceDate: date,
  quantityMilli: toMilli(quantity),
  consumedMilli: toMilli(consumed),
});

// FIFO — the spec example: 250 over INV-101 (90 left), INV-115 (150), INV-130 (180 left).
const lines = [line(30, 130, "2024-05-10", 200, 20), line(10, 101, "2024-01-15", 100, 10), line(20, 115, "2024-03-20", 150)];
assert.deepEqual(allocateFifo(lines, toMilli(250)), [
  { invoiceItemId: 10, quantityMilli: 90000 },
  { invoiceItemId: 20, quantityMilli: 150000 },
  { invoiceItemId: 30, quantityMilli: 10000 },
]);
assert.throws(() => allocateFifo(lines, toMilli(421)), /أكبر من المتاح للإرجاع/);
assert.throws(() => allocateFifo(lines, 0), /أكبر من صفر/);

// Manual allocation: must sum to the request and stay within each line.
assert.deepEqual(validateAllocation(lines, toMilli(20), [{ invoiceItemId: 30, quantityMilli: toMilli(20) }, { invoiceItemId: 10, quantityMilli: 0 }]), [{ invoiceItemId: 30, quantityMilli: 20000 }]);
assert.throws(() => validateAllocation(lines, toMilli(100), [{ invoiceItemId: 10, quantityMilli: toMilli(100) }]), /تتجاوز المتاح/);
assert.throws(() => validateAllocation(lines, toMilli(50), [{ invoiceItemId: 20, quantityMilli: toMilli(40) }]), /لا تساوي/);
assert.throws(() => validateAllocation(lines, toMilli(5), [{ invoiceItemId: 999, quantityMilli: toMilli(5) }]), /لا يخص/);

// Original pricing: invoice discount and tax shared by line value; fees excluded.
const facts = { linesNetTotal: 400000, linesDiscountTotal: 5000, discountAmount: 25000, taxAmount: 8000 };
// line A 300,000 (after its own 5,000 discount) + line B 100,000; invoice-level discount 20,000.
assert.equal(lineRefundableCents({ total: 300000 }, facts), (300000 - 15000 + 6000) * 100);
assert.equal(lineRefundableCents({ total: 100000 }, facts), (100000 - 5000 + 2000) * 100);
assert.equal(lineRefundableCents({ total: 0 }, facts), 0);

// Repeated partial returns never exceed the original line value.
const refundable = lineRefundableCents({ total: 1000 }, { linesNetTotal: 1000, linesDiscountTotal: 0, discountAmount: 0, taxAmount: 0 });
const q = toMilli(3);
const firstPart = returnAmountCents({ lineQuantityMilli: q, lineRefundableCents: refundable, quantityMilli: toMilli(1), consumedQuantityMilli: 0, consumedAmountCents: 0 });
const secondPart = returnAmountCents({ lineQuantityMilli: q, lineRefundableCents: refundable, quantityMilli: toMilli(1), consumedQuantityMilli: toMilli(1), consumedAmountCents: firstPart });
const lastPart = returnAmountCents({ lineQuantityMilli: q, lineRefundableCents: refundable, quantityMilli: toMilli(1), consumedQuantityMilli: toMilli(2), consumedAmountCents: firstPart + secondPart });
assert.equal(firstPart + secondPart + lastPart, refundable, "1000/3 rounds, the closing return takes the exact remainder");

// Different units or names are different products; same id+unit groups.
assert.equal(returnProductKey({ productId: 5, productName: "شال", unit: "قطعة" }), returnProductKey({ productId: 5, productName: "شال حنة", unit: "قطعة" }));
assert.notEqual(returnProductKey({ productId: 5, productName: "شال", unit: "قطعة" }), returnProductKey({ productId: 5, productName: "شال", unit: "درزن" }));
assert.notEqual(returnProductKey({ productId: 5, productName: "شال", unit: null }), returnProductKey({ productId: 6, productName: "شال", unit: null }));

// Settlement split never exceeds the unsettled value; refunds need a method.
assert.deepEqual(validateSettlementPlan({ invoiceCredit: 300000, customerCredit: 100000, refund: 65000, refundMethod: "cash" }, 46500000), { invoiceCreditCents: 30000000, customerCreditCents: 10000000, refundCents: 6500000, totalCents: 46500000 });
assert.throws(() => validateSettlementPlan({ invoiceCredit: 465001, customerCredit: 0, refund: 0 }, 46500000), /أكبر من المبلغ غير المسوّى/);
assert.throws(() => validateSettlementPlan({ invoiceCredit: 0, customerCredit: 0, refund: 1000 }, 46500000), /طريقة استرجاع/);
assert.throws(() => validateSettlementPlan({ invoiceCredit: -1, customerCredit: 0, refund: 0 }, 46500000), SalesReturnRuleError);

// Debt deduction fills open invoices in the given order, never above a remaining balance.
assert.deepEqual(allocateInvoiceCredit([{ invoiceId: 1, remainingCents: 3000 }, { invoiceId: 2, remainingCents: 0 }, { invoiceId: 3, remainingCents: 5000 }], 7000), [
  { invoiceId: 1, amountCents: 3000 },
  { invoiceId: 3, amountCents: 4000 },
]);
assert.throws(() => allocateInvoiceCredit([{ invoiceId: 1, remainingCents: 3000 }], 3001), /أكبر من مديونية العميل/);

// Contracts with the existing invoice, payment and statement code.
const api = readFileSync("src/server/api.ts", "utf8");
assert.match(api, /const linkedReturns = await salesReturnsForInvoice\(tx, id, "active"\);\s*if \(linkedReturns\.length\)\s*throw new CheckoutError\(`لا يمكن إلغاء الفاتورة/, "cancellation refuses invoices with live returns");
assert.match(api, /if \(parsedItems \|\| b\.discountAmount !== undefined \|\| b\.taxAmount !== undefined\) \{\s*const linkedReturns = await salesReturnsForInvoice\(db, id, "any"\);/, "item, discount and tax edits refuse invoices with returned lines");
assert.match(api, /if \(linesChanged \|\| pricingChanged\)[\s\S]{0,400}?parsedItems = null;/, "unchanged resent lines keep the original rows returns point at");
assert.match(api, /const groupedReturns = await salesReturnsForInvoice\(db, id, "any"\);/, "deletion refuses invoices with returns");
assert.match(api, /if \(err instanceof SalesReturnError\) \{[\s\S]{0,300}return error\(err\.message, err\.status, \{code: err\.code, requestId/, "structured errors with a request id");
const paymentState = readFileSync("src/server/payment-state.ts", "utf8");
assert.match(paymentState, /WHERE s\.kind = 'invoice_credit' AND s\.status = 'applied' AND s\.invoice_id = \$\{sourceId\}/);
assert.match(paymentState, /SET \$\{paid\} = least\(computed\.total_amount, computed\.approved_paid\),\s*\$\{remaining\} = greatest\(computed\.total_amount - computed\.approved_paid - computed\.credits, 0\)/, "credits lower remaining, never paid");
assert.match(paymentState, /: sql`, return_credits AS \(SELECT 0::numeric AS value\)`;/, "zero term before migration 0130 and for other sources");
const service = readFileSync("src/server/sales-returns.ts", "utf8");
assert.match(service, /createSourceFinancialRequest\(/, "refunds go through the existing financial approvals");
assert.doesNotMatch(service, /createAndExecuteSourceFinancialTransaction|approveAndExecuteFinancialTransaction/, "a return never executes cash by itself");
assert.match(service, /ON CONFLICT \(idempotency_key\) WHERE idempotency_key IS NOT NULL DO NOTHING/, "one stock movement per item and purpose");
const migration = readFileSync("lib/db/migrations/0130_sales_returns.sql", "utf8");
assert.doesNotMatch(migration.replace(/^--.*$/gm, ""), /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s|ALTER\s+TABLE)/im, "additive only: no destructive or rewriting statements");

console.log("PASS sales returns logic: FIFO, manual allocation, original pricing with discount/tax share, exact remainders, unit-safe grouping, settlement limits, invoice/payment/statement contracts");
