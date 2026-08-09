import assert from "node:assert/strict";
import { normalizeIraqiPhone } from "../src/lib/phone";
import { customerLinkResolution, salesInvoicePaymentProjection } from "../src/server/sales-invoice-customer-link-logic";

assert.equal(normalizeIraqiPhone("07701234567"), "9647701234567");
assert.equal(normalizeIraqiPhone("+9647701234567"), "9647701234567");
assert.equal(normalizeIraqiPhone("009647701234567"), "9647701234567");
assert.equal(customerLinkResolution({ customerId: null, normalizedPhone: "9647701234567", candidateCount: 1 }), "single_match");
assert.equal(customerLinkResolution({ customerId: null, normalizedPhone: "9647701234567", candidateCount: 2 }), "multiple_matches");
assert.equal(customerLinkResolution({ customerId: null, normalizedPhone: null, candidateCount: 0 }), "missing_data");
assert.deepEqual(salesInvoicePaymentProjection(100_000, 0, 40_000), { paid: 40_000, remaining: 60_000, paymentStatus: "partial" });
assert.deepEqual(salesInvoicePaymentProjection(100_000, 100_000, 25_000), { paid: 125_000, remaining: 0, paymentStatus: "overpaid" });
console.log("Sales invoice customer-linking assertions passed: 8");
