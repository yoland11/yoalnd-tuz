import { deriveKoshaFinancialSummary, canAssignKoshaAsset, validateKoshaExpenseClassification } from "../src/lib/kosha-finance";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`FAIL ${label}\n  got: ${JSON.stringify(actual)}\n want: ${JSON.stringify(expected)}`);
  } else {
    console.log(`PASS ${label}`);
  }
}

const summary = deriveKoshaFinancialSummary({
  investmentTotal: 1_000_000,
  bookingRevenue: 500_000,
  collectedRevenue: 300_000,
  customerRemaining: 200_000,
  operatingCosts: [
    { sourceKey: "txn:10", amount: 50_000, status: "executed" },
    { sourceKey: "txn:11", amount: 12_000, status: "pending" },
  ],
  bookingCosts: [
    { sourceKey: "txn:20", amount: 80_000, status: "executed", bookingId: 1 },
    { sourceKey: "txn:20", amount: 80_000, status: "executed", bookingId: 1 },
    { sourceKey: "txn:21", amount: 25_000, status: "executed", bookingId: 1, category: "investment" },
  ],
});

check("investment stays separate from current period costs", summary.totalInvestment, 1_000_000);
check("pending cost is not posted and duplicate source counts once", summary.operatingCosts, 50_000);
check("booking costs count one executed source and exclude investment", summary.bookingCosts, 80_000);
check("booking profit excludes investment and operating costs", summary.bookingProfit, 420_000);
check("collections and receivables stay distinct from revenue", [summary.bookingRevenue, summary.collectedRevenue, summary.customerRemaining], [500_000, 300_000, 200_000]);
check("investment recovery uses collected cash, net costs, and is capped at invested amount", [summary.recoveredInvestment, summary.remainingInvestment, summary.recoveryPercent], [170_000, 830_000, 17]);

const unpaidSummary = deriveKoshaFinancialSummary({ investmentTotal: 1_000_000, bookingRevenue: 300_000, collectedRevenue: 0, customerRemaining: 300_000, operatingCosts: [], bookingCosts: [] });
check("unpaid booking revenue does not count as recovered investment", unpaidSummary.recoveredInvestment, 0);

check("dedicated asset cannot be assigned to a second Koshah", canAssignKoshaAsset(2, false, [{ koshaId: 1, shared: false }]), false);
check("shared asset can be assigned to multiple Koshat only when every assignment is shared", canAssignKoshaAsset(2, true, [{ koshaId: 1, shared: true }]), true);
check("a shared flag cannot override an existing dedicated assignment", canAssignKoshaAsset(2, true, [{ koshaId: 1, shared: false }]), false);
check("same Koshah duplicate is handled by the existing per-Koshah unique index", canAssignKoshaAsset(2, false, [{ koshaId: 2, shared: false }]), true);

const overlappingViews = deriveKoshaFinancialSummary({
  investmentTotal: 0,
  bookingRevenue: 90,
  collectedRevenue: 0,
  customerRemaining: 90,
  operatingCosts: [{ sourceKey: "txn:shared", amount: 30, status: "executed" }],
  bookingCosts: [{ sourceKey: "txn:shared", amount: 30, status: "executed", bookingId: 7 }],
});
check("one financial transaction is counted once across analytical views", [overlappingViews.operatingCosts, overlappingViews.bookingCosts], [30, 0]);
check("ordinary legacy expenses need no Koshah classification", validateKoshaExpenseClassification({}), null);
check("a Koshah cost requires a cost category", validateKoshaExpenseClassification({ koshaId: 3 }), "تصنيف المصروف مطلوب عند ربطه بكوشة");
check("booking cost requires a booking", validateKoshaExpenseClassification({ koshaId: 3, costCategory: "booking" }), "الحجز مطلوب لتسجيل تكلفة حجز");
check("booking cost must match the selected Koshah", validateKoshaExpenseClassification({ koshaId: 3, costCategory: "booking", bookingId: 4, bookingKoshaId: 5 }), "الحجز لا يتبع الكوشة المختارة");
check("non-booking categories cannot carry booking references", validateKoshaExpenseClassification({ koshaId: 3, costCategory: "operating", bookingId: 4, bookingKoshaId: 3 }), "الحجز مسموح فقط لتكلفة الحجز");
check("legacy unassigned booking can be explicitly linked without rewriting its booking", validateKoshaExpenseClassification({ koshaId: 3, costCategory: "booking", bookingId: 4, bookingKoshaId: null }), null);

if (failures) process.exit(1);
console.log("Koshah finance rules verified.");
