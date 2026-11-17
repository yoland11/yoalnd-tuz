import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { readResearchCanonicalPaymentState, guardResearchFinancialApproval,lockResearchPaymentSources } from "../src/server/research-payment-state";

const dialect = new PgDialect();
function fixture(options: { paid?: string; credit?: string; pending?: string; candidate?: string; invoiceTotal?: string; invoiceStatus?:string } = {}) {
  const seen: string[] = [];
  return { seen, async execute(query: any) {
    const text = dialect.sqlToQuery(query).sql; seen.push(text);
    if (text.includes("research_table_available")) return { rows: [{ ready: true }] };
    if (text.includes("research_source_lock")) return { rows: [{ id: 1, invoice_id: 8, total_amount: "100", invoice_total: options.invoiceTotal ?? "100",invoice_status:options.invoiceStatus??'active', customer_id: 2, status: "new", payment_due_date: null }] };
    if (text.includes("research_money_totals")) return { rows: [{ paid: options.paid ?? "30", credits: options.credit ?? "10" }] };
    if (text.includes("research_pending_reservations")) return { rows: [{ pending: options.pending ?? "20" }] };
    if (text.includes("research_approval_candidates")) return { rows: [{ order_id: 1, amount: options.candidate ?? "20" }] };
    if (text.includes("research_return_table")) return { rows: [{ ready: true }] };
    return { rows: [] };
  } };
}
const tx = fixture();
const state = await readResearchCanonicalPaymentState(tx, 1);
assert.equal(state.approvedPaidAmount, "30.00");
assert.equal(state.creditAmount, "10.00");
assert.equal(state.remainingAmount, "60.00");
assert.equal(state.paymentDueDate, null);
assert.equal(tx.seen.some(text => /^\s*UPDATE/.test(text)), false, "financial GET reads must not mutate snapshots");
const reversed = await readResearchCanonicalPaymentState(fixture({ paid: "5", credit: "10" }), 1, true);
assert.equal(reversed.remainingAmount, "85.00");
assert.equal(reversed.paymentStatus, "partial");
assert.equal((await readResearchCanonicalPaymentState(fixture({ paid: "0", credit: "100" }), 1)).paymentStatus, "paid");
await assert.rejects(() => readResearchCanonicalPaymentState(fixture({ invoiceTotal: "110" }), 1, true), /قيمة الفاتورة/);
await assert.rejects(() => guardResearchFinancialApproval(fixture({ pending: "90", candidate: "40" }), { id: 7, sourceType: "research_order", sourceId: "1", direction: "revenue" }), /المتبقي/);
await guardResearchFinancialApproval(fixture(), { id: 7, sourceType: "research_order", sourceId: "1", direction: "revenue" });
await assert.rejects(()=>lockResearchPaymentSources(fixture({invoiceStatus:'cancelled'}),{sourceType:'research_order',sourceId:1}),/فاتورة البحث ملغاة/);
await lockResearchPaymentSources(fixture({invoiceStatus:'cancelled'}),{sourceType:'research_order',sourceId:1},false);
assert.ok(tx.seen.some(text => text.includes("research_order") && text.includes("sales_invoice")), "canonical totals include original and mirror identities");
console.log("Research canonical cash/credit/reversal, null due date and approval guard behavior passed.");
