import assert from "node:assert/strict";
import {PartnershipValidationError} from "../src/lib/vehicle-partnership/types";
import {buildPayoutCoverage, validatePayoutCapacity} from "../src/lib/vehicle-partnership/payout";

async function main() {
  let passed = 0;
  function test(name: string, run: () => void) {
    try { run(); passed++; }
    catch (error) { throw new Error(name, {cause: error}); }
  }
  const rejects = (run: () => void) => assert.throws(run, PartnershipValidationError);
  const capacity = {
    amount: "1.00", availableAmount: "1.00", ownPendingAmount: "0.00", reservedAmount: "0.00", coverage: [],
  };
  const coverage = {
    rightId: 1, conversionAllocationId: 10, amount: "1.00", availableAmount: "1.00", ownPendingAmount: "0.00", reservedAmount: "0.00",
  };

  test("one minor unit goes to the first conversion identity regardless of input order", () => {
    assert.deepEqual(buildPayoutCoverage("0.01", [
      {rightId: 20, conversionAllocationId: 2, availableAmount: "0.01"},
      {rightId: 10, conversionAllocationId: 1, availableAmount: "0.01"},
    ]), [{rightId: 10, conversionAllocationId: 1, amount: "0.01"}]);
  });
  test("coverage stops exactly at the requested minor unit", () => {
    assert.deepEqual(buildPayoutCoverage("0.03", [
      {rightId: 2, conversionAllocationId: 2, availableAmount: "0.02"},
      {rightId: 1, conversionAllocationId: 1, availableAmount: "0.02"},
    ]), [
      {rightId: 1, conversionAllocationId: 1, amount: "0.02"},
      {rightId: 2, conversionAllocationId: 2, amount: "0.01"},
    ]);
  });
  test("coverage remains exact above JavaScript safe minor-unit precision", () => {
    assert.deepEqual(buildPayoutCoverage("99999999999999.99", [
      {rightId: 2, conversionAllocationId: 2, availableAmount: "0.01"},
      {rightId: 1, conversionAllocationId: 1, availableAmount: "99999999999999.98"},
    ]), [
      {rightId: 1, conversionAllocationId: 1, amount: "99999999999999.98"},
      {rightId: 2, conversionAllocationId: 2, amount: "0.01"},
    ]);
  });
  test("partial converted coverage leaves the remainder externally funded", () => {
    assert.deepEqual(buildPayoutCoverage("100.00", [
      {rightId: 1, conversionAllocationId: 1, availableAmount: "30.00"},
      {rightId: 2, conversionAllocationId: 2, availableAmount: "25.00"},
      {rightId: 3, conversionAllocationId: 3, availableAmount: "0.00"},
    ]), [
      {rightId: 1, conversionAllocationId: 1, amount: "30.00"},
      {rightId: 2, conversionAllocationId: 2, amount: "25.00"},
    ]);
    assert.deepEqual(buildPayoutCoverage("100.00", []), []);
  });
  test("planning preserves caller input and canonical decimal strings", () => {
    const budgets = Object.freeze([
      Object.freeze({rightId: 2, conversionAllocationId: 2, availableAmount: "3"}),
      Object.freeze({rightId: 1, conversionAllocationId: 1, availableAmount: "2.5"}),
    ]);
    assert.deepEqual(buildPayoutCoverage("4", budgets), [
      {rightId: 1, conversionAllocationId: 1, amount: "2.50"},
      {rightId: 2, conversionAllocationId: 2, amount: "1.50"},
    ]);
    assert.equal(budgets[0].conversionAllocationId, 2);
  });
  test("planner rejects duplicate rights even under different conversion parents", () => rejects(() => buildPayoutCoverage("1", [
    {rightId: 1, conversionAllocationId: 1, availableAmount: "1"},
    {rightId: 1, conversionAllocationId: 2, availableAmount: "1"},
  ])));
  test("planner rejects duplicate conversion parents even under different rights", () => rejects(() => buildPayoutCoverage("1", [
    {rightId: 1, conversionAllocationId: 1, availableAmount: "1"},
    {rightId: 2, conversionAllocationId: 1, availableAmount: "1"},
  ])));
  test("planner validates unused budgets after funding is exhausted", () => rejects(() => buildPayoutCoverage("1", [
    {rightId: 1, conversionAllocationId: 1, availableAmount: "1"},
    {rightId: 2, conversionAllocationId: 2, availableAmount: "broken"},
  ])));
  test("planner bounds the conversion budget list", () => {
    const budgets = Array.from({length: 501}, (_, index) => ({rightId: index + 1, conversionAllocationId: index + 1, availableAmount: "0"}));
    rejects(() => buildPayoutCoverage("1", budgets));
    assert.deepEqual(buildPayoutCoverage("1", budgets.slice(0, 500)), []);
    rejects(() => buildPayoutCoverage("1", null as never));
  });
  test("planner rejects invalid right and parent identities", () => {
    for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
      rejects(() => buildPayoutCoverage("1", [{rightId: id as number, conversionAllocationId: 1, availableAmount: "1"}]));
      rejects(() => buildPayoutCoverage("1", [{rightId: 1, conversionAllocationId: id as number, availableAmount: "1"}]));
    }
    rejects(() => buildPayoutCoverage("1", [null as never]));
  });
  test("planner and admission reject nonpositive or noncanonical payout amounts", () => {
    for (const amount of ["0", "0.00", "-0.01", "0.001", "1e3", "NaN", "100000000000000", "01", "Infinity", 1, null]) {
      rejects(() => buildPayoutCoverage(amount as string, []));
      rejects(() => validatePayoutCapacity({...capacity, amount: amount as string}));
    }
  });
  test("primary payout with no own hold uses only available capacity", () => {
    assert.doesNotThrow(() => validatePayoutCapacity(capacity));
    rejects(() => validatePayoutCapacity({...capacity, amount: "1.01"}));
  });
  test("primary payout can reclaim only its proven own pending hold", () => {
    const pending = {...capacity, amount: "90", availableAmount: "60", ownPendingAmount: "30", reservedAmount: "40"};
    assert.doesNotThrow(() => validatePayoutCapacity(pending));
    rejects(() => validatePayoutCapacity({...pending, amount: "90.01"}));
  });
  test("stale other-payout pending reservations never become primary capacity", () => {
    rejects(() => validatePayoutCapacity({...capacity, amount: "0.01", availableAmount: "0", ownPendingAmount: "0", reservedAmount: "100"}));
    rejects(() => validatePayoutCapacity({...capacity, amount: "100", availableAmount: "60", ownPendingAmount: "0", reservedAmount: "40"}));
  });
  test("primary own hold cannot exceed the total reserved amount", () => rejects(() => validatePayoutCapacity({
    ...capacity, availableAmount: "0", ownPendingAmount: "1.00", reservedAmount: "0.99",
  })));
  test("capacity compares huge IQD values and cents exactly", () => {
    const large = {...capacity, amount: "99999999999999.99", availableAmount: "99999999999999.98", ownPendingAmount: "0.01", reservedAmount: "0.01"};
    assert.doesNotThrow(() => validatePayoutCapacity(large));
    rejects(() => validatePayoutCapacity({...large, ownPendingAmount: "0"}));
  });
  test("partial and empty coverage are admitted with an externally funded remainder", () => {
    assert.doesNotThrow(() => validatePayoutCapacity({...capacity, amount: "100", availableAmount: "100", coverage: [{...coverage, amount: "30", availableAmount: "30"}]}));
    assert.doesNotThrow(() => validatePayoutCapacity({...capacity, amount: "100", availableAmount: "100"}));
  });
  test("coverage consumes its own exact available amount and accepts any row order", () => {
    assert.doesNotThrow(() => validatePayoutCapacity({...capacity, amount: "0.03", availableAmount: "0.03", coverage: [
      {...coverage, rightId: 2, conversionAllocationId: 20, amount: "0.01", availableAmount: "0.01"},
      {...coverage, amount: "0.02", availableAmount: "0.02"},
    ]}));
    rejects(() => validatePayoutCapacity({...capacity, coverage: [{...coverage, amount: "0.02", availableAmount: "0.01"}]}));
  });
  test("coverage can reclaim only its own proven pending hold", () => {
    const ownCoverage = {...coverage, amount: "0.03", availableAmount: "0.01", ownPendingAmount: "0.02", reservedAmount: "0.04"};
    assert.doesNotThrow(() => validatePayoutCapacity({...capacity, coverage: [ownCoverage]}));
    rejects(() => validatePayoutCapacity({...capacity, coverage: [{...ownCoverage, amount: "0.04"}]}));
  });
  test("other coverage pending reservations are never excluded from capacity", () => rejects(() => validatePayoutCapacity({
    ...capacity, coverage: [{...coverage, amount: "0.01", availableAmount: "0", ownPendingAmount: "0", reservedAmount: "100"}],
  })));
  test("coverage own hold cannot exceed its parent reservation", () => rejects(() => validatePayoutCapacity({
    ...capacity, coverage: [{...coverage, availableAmount: "0", ownPendingAmount: "1", reservedAmount: "0.99"}],
  })));
  test("combined coverage cannot exceed the primary payout even by one cent", () => rejects(() => validatePayoutCapacity({
    ...capacity, amount: "0.02", availableAmount: "0.02", coverage: [
      {...coverage, amount: "0.02", availableAmount: "0.02"},
      {...coverage, rightId: 2, conversionAllocationId: 20, amount: "0.01", availableAmount: "0.01"},
    ],
  })));
  test("coverage validation prevents reusing rights or conversion parents", () => {
    rejects(() => validatePayoutCapacity({...capacity, amount: "2", availableAmount: "2", coverage: [coverage, {...coverage, conversionAllocationId: 20}]}));
    rejects(() => validatePayoutCapacity({...capacity, amount: "2", availableAmount: "2", coverage: [coverage, {...coverage, rightId: 2}]}));
  });
  test("coverage requires valid identities and a positive amount", () => {
    for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      rejects(() => validatePayoutCapacity({...capacity, coverage: [{...coverage, rightId: id}]}));
      rejects(() => validatePayoutCapacity({...capacity, coverage: [{...coverage, conversionAllocationId: id}]}));
    }
    rejects(() => validatePayoutCapacity({...capacity, coverage: [{...coverage, amount: "0"}]}));
    rejects(() => validatePayoutCapacity({...capacity, coverage: [null as never]}));
  });
  test("all capacity monetary inputs use the existing strict money contract", () => {
    for (const field of ["availableAmount", "ownPendingAmount", "reservedAmount"] as const) {
      for (const value of ["-1", "0.001", "broken", 1, null]) {
        rejects(() => validatePayoutCapacity({...capacity, [field]: value} as never));
        rejects(() => validatePayoutCapacity({...capacity, coverage: [{...coverage, [field]: value}]} as never));
      }
    }
    rejects(() => buildPayoutCoverage("1", [{rightId: 1, conversionAllocationId: 1, availableAmount: "-1"}]));
  });
  test("coverage admission rejects missing and oversized lists", () => {
    rejects(() => validatePayoutCapacity({...capacity, coverage: null as never}));
    const many = Array.from({length: 501}, (_, index) => ({...coverage, rightId: index + 1, conversionAllocationId: index + 1, amount: "0.01", availableAmount: "0.01"}));
    rejects(() => validatePayoutCapacity({...capacity, amount: "100", availableAmount: "100", coverage: many}));
  });
  console.log(`PASS vehicle partnership payout exact admission and planning (${passed} cases)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
