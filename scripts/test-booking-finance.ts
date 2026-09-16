import { deriveBookingFinal } from "../src/server/booking-finance";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failed++;
    console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`);
  } else {
    console.log(`PASS ${name}`);
  }
}
const fin = (d: ReturnType<typeof deriveBookingFinal>) => ({
  base: d.base,
  products: d.products,
  finalTotal: d.finalTotal,
  paid: d.paid,
  remaining: d.remaining,
  status: d.paymentStatus,
});

// MANDATORY: Kosha 160,000 + Preparations 40,000, paid 50,000 → 200,000 / 150,000
check(
  "mandatory: kosha 160k + تجهيزات 40k, paid 50k",
  fin(deriveBookingFinal({ baseBookingAmount: 160000, persistedTotal: 160000, products: 40000, paid: 50000 })),
  { base: 160000, products: 40000, finalTotal: 200000, paid: 50000, remaining: 150000, status: "partial" },
);

// No-double-count guard: base known (160k) but persisted total already folded products (200k) → still 200,000, NOT 240,000
check(
  "no double count: base 160k, persistedTotal already 200k, products 40k",
  fin(deriveBookingFinal({ baseBookingAmount: 160000, persistedTotal: 200000, products: 40000, paid: 0 })).finalTotal,
  200000,
);

// Never-PUT: base unknown → falls back to persistedTotal (which is base) + products
check(
  "base fallback: baseBookingAmount null, persistedTotal 160k, products 40k",
  fin(deriveBookingFinal({ baseBookingAmount: null, persistedTotal: 160000, products: 40000, paid: 0 })).finalTotal,
  200000,
);

// 1 service, no products
check(
  "single service, no products",
  fin(deriveBookingFinal({ baseBookingAmount: 100000, persistedTotal: 100000, products: 0, paid: 0 })),
  { base: 100000, products: 0, finalTotal: 100000, paid: 0, remaining: 100000, status: "unpaid" },
);

// 3+ services worth of products: base 100k + products (50k + 25k) = 175k
check(
  "base 100k + products 75k = 175k",
  fin(deriveBookingFinal({ baseBookingAmount: 100000, persistedTotal: 100000, products: 75000, paid: 0 })).finalTotal,
  175000,
);

// zero payment
check(
  "zero payment",
  fin(deriveBookingFinal({ baseBookingAmount: 200000, persistedTotal: 200000, products: 0, paid: 0 })).status,
  "unpaid",
);
// full payment
check(
  "full payment",
  fin(deriveBookingFinal({ baseBookingAmount: 160000, persistedTotal: 160000, products: 40000, paid: 200000 })),
  { base: 160000, products: 40000, finalTotal: 200000, paid: 200000, remaining: 0, status: "paid" },
);
// overpaid (paid > final) → remaining floored at 0, status paid
check(
  "overpaid floors remaining at 0",
  fin(deriveBookingFinal({ baseBookingAmount: 160000, persistedTotal: 160000, products: 40000, paid: 250000 })).remaining,
  0,
);
// pending pricing (0 total)
check(
  "pending pricing when total 0",
  fin(deriveBookingFinal({ baseBookingAmount: 0, persistedTotal: 0, products: 0, paid: 0 })).status,
  "pending_pricing",
);
// large IQD values
check(
  "large IQD",
  fin(deriveBookingFinal({ baseBookingAmount: 18750000, persistedTotal: 18750000, products: 1250000, paid: 5000000 })),
  { base: 18750000, products: 1250000, finalTotal: 20000000, paid: 5000000, remaining: 15000000, status: "partial" },
);

if (failed) {
  console.error(`\nbooking-finance: ${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nbooking-finance aggregation verified (no double count; base + products authoritative).");
