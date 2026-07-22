import assert from "node:assert/strict";
import {
  calculateHistoricalOutstanding,
  resolveHistoricalCustomer,
} from "../src/server/customer-receivable-repair";

const unpaid = calculateHistoricalOutstanding({
  invoiceTotal: 1_000_000,
  headerPaidAmount: 0,
  allPostedAllocations: 0,
  validPostedAllocations: 0,
  executedInvoicePayment: 0,
  returns: 0,
  creditNotes: 0,
  adjustments: 0,
});
assert.equal(unpaid.outstanding, 1_000_000);

const partial = calculateHistoricalOutstanding({
  invoiceTotal: 1_000_000,
  headerPaidAmount: 300_000,
  allPostedAllocations: 0,
  validPostedAllocations: 0,
  executedInvoicePayment: 300_000,
  returns: 100_000,
  creditNotes: 0,
  adjustments: 0,
});
assert.equal(partial.validPayments, 300_000);
assert.equal(partial.outstanding, 600_000);

const allocatedPayment = calculateHistoricalOutstanding({
  invoiceTotal: 500_000,
  headerPaidAmount: 300_000,
  allPostedAllocations: 100_000,
  validPostedAllocations: 100_000,
  executedInvoicePayment: 200_000,
  returns: 0,
  creditNotes: 0,
  adjustments: 0,
});
assert.equal(allocatedPayment.validPayments, 300_000, "posted allocation must not be counted twice");

const fullyPaid = calculateHistoricalOutstanding({
  invoiceTotal: 250_000,
  headerPaidAmount: 250_000,
  allPostedAllocations: 0,
  validPostedAllocations: 0,
  executedInvoicePayment: 250_000,
  returns: 0,
  creditNotes: 0,
  adjustments: 0,
});
assert.equal(fullyPaid.outstanding, 0);

const customers = [
  { id: 1, phone: "07701234567", name: "محمد أحمد", fullName: null },
  { id: 2, phone: "07801234567", name: "محمد أحمد", fullName: "محمد أحمد" },
];
assert.equal(
  resolveHistoricalCustomer({
    invoice: { customerId: 1, customerPhone: null, customerName: "", notes: null },
    customers,
    transactionCustomerIds: [],
  }).customer?.id,
  1,
);
assert.equal(
  resolveHistoricalCustomer({
    invoice: { customerId: null, customerPhone: "0770 123 4567", customerName: "", notes: null },
    customers,
    transactionCustomerIds: [],
  }).customer?.id,
  1,
);
assert.equal(
  resolveHistoricalCustomer({
    invoice: { customerId: null, customerPhone: null, customerName: "CUS-000002", notes: null },
    customers,
    transactionCustomerIds: [],
  }).customer?.id,
  2,
);
assert.equal(
  resolveHistoricalCustomer({
    invoice: { customerId: null, customerPhone: null, customerName: "محمد أحمد", notes: null },
    customers,
    transactionCustomerIds: [],
  }).ambiguous,
  true,
);

process.stdout.write("customer receivable repair logic: 8 assertions passed\n");

