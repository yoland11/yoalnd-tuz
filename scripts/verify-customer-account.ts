import { readFileSync } from "node:fs";
import {
  summarizeCustomerAccount,
  type CustomerAccountDocument,
} from "@/server/customer-account-summary";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) console.log(`✓ ${label}`);
  else {
    failures += 1;
    console.error(`✗ ${label}`);
  }
}

// ── Accounting math: the customer balance is a pure fold of reconciled docs ──
// Mirrors the task's worked example: Kosha + Store invoice + a paid service.
const documents: CustomerAccountDocument[] = [
  { sourceType: "kosha_booking", sourceId: 104, reference: "K-104", date: "2026-09-01", total: 1_000_000, paid: 400_000, remaining: 600_000, paymentStatus: "partial", linkedById: true },
  { sourceType: "sales_invoice", sourceId: 800, reference: "SI-800", date: "2026-09-04", total: 100_000, paid: 0, remaining: 100_000, paymentStatus: "unpaid", linkedById: true },
  { sourceType: "service_order", sourceId: 72, reference: "SRV-72", date: "2026-09-02", total: 200_000, paid: 200_000, remaining: 0, paymentStatus: "paid", linkedById: false },
];
const summary = summarizeCustomerAccount(55, documents);

check("total receivable = Σ document totals", summary.totalReceivable === 1_300_000);
check("total paid = Σ approved/posted paid", summary.totalPaid === 600_000);
check("current balance (في الذمة) = Σ reconciled remaining", summary.currentBalance === 700_000);
check("balance is internally consistent (receivable − paid)", summary.currentBalance === summary.totalReceivable - summary.totalPaid);
check("document count is exact", summary.documentCount === 3);
check("phone-fallback rows are surfaced, not hidden", summary.unlinkedByPhoneCount === 1);
check("service booking receivable participates in the customer account", summary.sources.some((d) => d.sourceType === "service_order"));

const empty = summarizeCustomerAccount(1, []);
check("empty account is zero, never null/NaN", empty.currentBalance === 0 && empty.totalReceivable === 0 && empty.totalPaid === 0 && empty.documentCount === 0);

const overpaid = summarizeCustomerAccount(2, [
  { sourceType: "order", sourceId: 9, reference: "ORD-9", date: null, total: 100_000, paid: 100_000, remaining: 0, paymentStatus: "paid", linkedById: true },
]);
check("fully paid document leaves zero balance", overpaid.currentBalance === 0);

// ── Architecture invariants: read-only, joined by canonical customer_id ──
const service = readFileSync("src/server/customer-account.ts", "utf8");
check("joins by the canonical customer_id", service.includes("customer_id = ${cid}"));
check("phone fallback is restricted to rows with NULL customer_id", service.includes("customer_id IS NULL AND"));
check("paid is derived from total − remaining (never client input)", service.includes("Math.max(total - remaining, 0)"));
check("service_orders receivable is included in the account", service.includes("FROM service_orders"));
check("all four core receivable sources are covered", ["FROM sales_invoices", "FROM orders", "FROM service_orders", "FROM kosha_bookings"].every((s) => service.includes(s)));
check("read-only: no INSERT / UPDATE / DELETE / cash posting", !/insert\s+into|update\s+[a-z_]+\s+set|delete\s+from|master_cash_box/i.test(service));

if (failures) {
  console.error(`AJN CUSTOMER ACCOUNT REGRESSION: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("AJN CUSTOMER ACCOUNT LEDGER PASSED — one derived customer balance, joined by canonical customer_id.");
