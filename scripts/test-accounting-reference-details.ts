import assert from "node:assert/strict";
import { findAccountingReferenceTransaction } from "../src/views/admin/accounting-reference-details";

const transactions = [
  {
    reference: "SI-2609-00082",
    date: "2026-09-10T10:00:00.000Z",
    serviceType: "فاتورة مبيعات",
    total: 78_000,
    paid: 20_000,
    remaining: 58_000,
    paymentHistory: [{ date: "2026-09-10T11:00:00.000Z", amount: 20_000, reference: "RC-1" }],
    href: "/admin/sales?invoice=82",
  },
  {
    reference: "SI-2609-000820",
    date: "2026-09-11T10:00:00.000Z",
    serviceType: "فاتورة مبيعات",
    total: 125_000,
    paid: 0,
    remaining: 125_000,
    href: "/admin/sales?invoice=820",
  },
];

assert.equal(
  findAccountingReferenceTransaction(" SI-2609-00082 ", transactions)?.total,
  78_000,
  "a reference should resolve its exact linked transaction despite surrounding whitespace",
);
assert.equal(
  findAccountingReferenceTransaction("SI-2609-0008", transactions),
  null,
  "a partial reference must not resolve to a different transaction",
);
assert.equal(
  findAccountingReferenceTransaction("RC-1", transactions),
  null,
  "payment references that are not transaction references should stay unmatched",
);

console.log("Accounting reference detail tests passed (3 assertions).");
