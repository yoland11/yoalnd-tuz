import { penaltyDisplayStatus } from "../src/server/booking-penalties";

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

// Lifecycle gates win first.
check("pending review", penaltyDisplayStatus("pending_review", 100000, 0), "pending_review");
check("cancelled", penaltyDisplayStatus("cancelled", 100000, 0), "cancelled");
check("cancelled ignores paid", penaltyDisplayStatus("cancelled", 100000, 100000), "cancelled");

// Approved obligations derive from paid vs amount.
check("approved unpaid", penaltyDisplayStatus("approved", 100000, 0), "unpaid");
check("approved partly (40k of 100k)", penaltyDisplayStatus("approved", 100000, 40000), "partly_paid");
check("approved fully (100k of 100k)", penaltyDisplayStatus("approved", 100000, 100000), "paid");
check("approved over-collected still paid", penaltyDisplayStatus("approved", 100000, 120000), "paid");
// §25 scenario steps: 100,000 penalty, pay 40k then 60k.
check("§25 after 40k", penaltyDisplayStatus("approved", 100000, 40000), "partly_paid");
check("§25 after 100k", penaltyDisplayStatus("approved", 100000, 100000), "paid");
// A zero-amount approved penalty is never silently "paid".
check("zero amount stays unpaid", penaltyDisplayStatus("approved", 0, 0), "unpaid");

if (failed) {
  console.error(`\nbooking-penalties: ${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nbooking-penalties status derivation verified (lifecycle gates + paid-vs-amount).");
