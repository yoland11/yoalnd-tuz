import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyGroupSashPricing,
  groupPricingSashTypes,
  groupSashPrice,
  GroupSashPricingError,
  normalizeSashType,
  validateGroupSashPricing,
} from "../src/lib/graduation-group-pricing";

const approved = {
  sashSelectionMode: "restricted",
  sashOptions: ["royal", "american"],
};
const policy = { mode: "by_sash", prices: { royal: 23_000, american: 25_000 } };
const priced = { ...approved, sashPricing: policy };
const catalog = {
  lines: [
    { key: "style", name: "روب", amount: 40_000, cost: 12_000 },
    { key: "fabric", name: "قماش", amount: 5_000, cost: 2_000 },
    { key: "custom:1", name: "تطريز الاسم", amount: 3_000, cost: 1_000 },
  ],
  subtotal: 48_000,
  discount: 0,
  total: 48_000,
  cost: 15_000,
  profit: 33_000,
};
const flowers = [{ key: "flower:7:0", name: "ورد", amount: 4_000, cost: 1_500 }];

test("the student's approved sash selects the group's distinct outfit price", () => {
  assert.equal(groupSashPrice(priced, "royal"), 23_000);
  assert.equal(groupSashPrice(priced, "american"), 25_000);
});

test("a configured price replaces all catalogue/custom kit charges but retains their costs", () => {
  const result = applyGroupSashPricing(priced, "royal", catalog);
  assert.equal(result.total, 23_000);
  assert.equal(result.subtotal, 23_000);
  assert.equal(result.cost, 15_000);
  assert.equal(result.profit, 8_000);
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.lines[0], {
    key: "group_sash_kit",
    name: "تجهيزات التخرج - ملكي",
    amount: 23_000,
    cost: 15_000,
  });
  assert.deepEqual(result.groupSashPricing, { mode: "by_sash", sashType: "royal", amount: 23_000 });
});

test("optional flowers keep their separate charge and actual cost", () => {
  const result = applyGroupSashPricing(priced, "american", catalog, flowers);
  assert.equal(result.subtotal, 29_000);
  assert.equal(result.total, 29_000);
  assert.equal(result.cost, 16_500);
  assert.equal(result.profit, 12_500);
  assert.deepEqual(result.lines[1], flowers[0]);
  assert.deepEqual(result.groupSashPricing, { mode: "by_sash", sashType: "american", amount: 25_000 });
});

test("a 100% client discount cannot reduce the configured kit or its flowers", () => {
  const discounted = { ...catalog, discount: 48_000, total: 0, profit: -15_000 };
  const result = applyGroupSashPricing(priced, "royal", discounted, flowers);
  assert.equal(result.total, 27_000);
  assert.equal(result.discount, 0);
  assert.equal(result.profit, 10_500);
});

test("an explicit zero group price remains zero and keeps production cost", () => {
  const zero = { sashSelectionMode: "fixed", sashType: "royal", sashPricing: { mode: "by_sash", prices: { royal: 0 } } };
  assert.equal(groupSashPrice(zero, "royal"), 0);
  const result = applyGroupSashPricing(zero, "royal", catalog, flowers);
  assert.equal(result.total, 4_000);
  assert.equal(result.cost, 16_500);
  assert.equal(result.profit, -12_500);
  assert.equal(result.lines[0].amount, 0);
});

test("legacy groups preserve catalogue pricing, discount and separately selected flowers", () => {
  const discounted = { ...catalog, discount: 5_000, total: 43_000, profit: 28_000 };
  const result = applyGroupSashPricing({}, "royal", discounted, flowers);
  assert.equal(groupSashPrice({}, "unknown"), null);
  assert.equal(result.subtotal, 52_000);
  assert.equal(result.discount, 5_000);
  assert.equal(result.total, 47_000);
  assert.equal(result.cost, 16_500);
  assert.equal(result.profit, 30_500);
  assert.deepEqual(result.lines, [...catalog.lines, ...flowers]);
  assert.equal(result.groupSashPricing, undefined);
  assert.deepEqual(applyGroupSashPricing({}, "royal", catalog), catalog);
});

test("legacy discount stays bounded by the total including extras", () => {
  const result = applyGroupSashPricing({}, "royal", { ...catalog, discount: 100_000 }, flowers);
  assert.equal(result.discount, 52_000);
  assert.equal(result.total, 0);
  assert.equal(result.profit, -16_500);
});

test("missing or null pricing disables the override", () => {
  assert.deepEqual(validateGroupSashPricing(undefined, approved), { success: true, pricing: null });
  assert.deepEqual(validateGroupSashPricing(null, approved), { success: true, pricing: null });
  assert.equal(groupSashPrice({ ...approved, sashPricing: null }, "royal"), null);
});

test("only known sash keys or their Arabic labels normalize into a selection", () => {
  assert.equal(normalizeSashType("royal"), "royal");
  assert.equal(normalizeSashType("ملكي"), "royal");
  assert.equal(normalizeSashType(" أمريكي "), "american");
  assert.equal(normalizeSashType("جانبي"), "side");
  assert.equal(normalizeSashType("عادي"), "standard");
  assert.equal(normalizeSashType("unknown"), null);
  assert.equal(normalizeSashType(null), null);
  assert.equal(normalizeSashType(1), null);
  assert.equal(groupSashPrice(priced, "أمريكي"), 25_000);
});

test("allowed pricing types follow fixed, restricted and legacy choice policies", () => {
  assert.deepEqual(groupPricingSashTypes({ sashSelectionMode: "fixed", sashType: "royal" }).map((item) => item.key), ["royal"]);
  assert.deepEqual(groupPricingSashTypes(approved).map((item) => item.key), ["royal", "american"]);
  assert.deepEqual(groupPricingSashTypes({ sashSelectionMode: "restricted", sashOptions: ["side"] }).map((item) => item.key), ["side"]);
  assert.deepEqual(groupPricingSashTypes({}).map((item) => item.key), ["standard", "side", "royal", "american"]);
  assert.deepEqual(groupPricingSashTypes({ sashSelectionMode: "per_student" }).map((item) => item.key), ["standard", "side", "royal", "american"]);
});

test("validation requires every allowed sash price", () => {
  assert.deepEqual(validateGroupSashPricing(policy, approved), { success: true, pricing: policy });
  assert.deepEqual(validateGroupSashPricing({ mode: "by_sash", prices: { royal: 0 } }, { sashSelectionMode: "fixed", sashType: "royal" }), {
    success: true, pricing: { mode: "by_sash", prices: { royal: 0 } },
  });
  assert.deepEqual(validateGroupSashPricing({ mode: "by_sash", prices: { standard: 1, side: 2, royal: 3, american: 4 } }, {}), {
    success: true, pricing: { mode: "by_sash", prices: { standard: 1, side: 2, royal: 3, american: 4 } },
  });
});

test("reducing approved choices retains known inactive quotes without allowing their selection", () => {
  const narrowed = { sashSelectionMode: "restricted", sashOptions: ["royal"] };
  assert.deepEqual(validateGroupSashPricing(policy, narrowed), { success: true, pricing: policy });
  assert.throws(() => groupSashPrice({ ...narrowed, sashPricing: policy }, "american"), GroupSashPricingError);
});

test("finite nonnegative prices allow cents and the documented upper boundary", () => {
  for (const amount of [0, 0.29, 1.01, 999_999_999.99, 1_000_000_000]) {
    const result = validateGroupSashPricing({ mode: "by_sash", prices: { royal: amount } }, { sashSelectionMode: "fixed", sashType: "royal" });
    assert.equal(result.success, true, `price ${amount} should be accepted`);
  }
});

const malformed: Array<[string, unknown]> = [
  ["unknown mode", { mode: "catalog", prices: policy.prices }],
  ["array policy", []],
  ["string policy", "by_sash"],
  ["missing prices", { mode: "by_sash" }],
  ["null prices", { mode: "by_sash", prices: null }],
  ["array prices", { mode: "by_sash", prices: [23_000, 25_000] }],
  ["unknown key", { mode: "by_sash", prices: { ...policy.prices, mystery: 0 } }],
  ["Arabic price key", { mode: "by_sash", prices: { ملكي: 23_000, american: 25_000 } }],
  ["missing approved sash", { mode: "by_sash", prices: { royal: 23_000 } }],
  ["no prices", { mode: "by_sash", prices: {} }],
  ["unexpected policy key", { ...policy, discount: 5 }],
  ["negative", { mode: "by_sash", prices: { ...policy.prices, royal: -1 } }],
  ["NaN", { mode: "by_sash", prices: { ...policy.prices, royal: Number.NaN } }],
  ["infinite", { mode: "by_sash", prices: { ...policy.prices, royal: Number.POSITIVE_INFINITY } }],
  ["too large", { mode: "by_sash", prices: { ...policy.prices, royal: 1_000_000_000.01 } }],
  ["fraction beyond cents", { mode: "by_sash", prices: { ...policy.prices, royal: 23_000.001 } }],
  ["numeric string", { mode: "by_sash", prices: { ...policy.prices, royal: "23000" } }],
];

for (const [reason, sashPricing] of malformed) {
  test(`invalid active pricing fails closed: ${reason}`, () => {
    const result = validateGroupSashPricing(sashPricing, approved);
    assert.equal(result.success, false);
    if (!result.success) assert.ok(result.error.trim());
    assert.throws(() => groupSashPrice({ ...approved, sashPricing }, "royal"), GroupSashPricingError);
    assert.throws(() => applyGroupSashPricing({ ...approved, sashPricing }, "royal", catalog), GroupSashPricingError);
  });
}

test("missing, unknown or unapproved selections cannot obtain a configured price", () => {
  for (const type of [undefined, null, "", "unknown", "side"]) {
    assert.throws(() => groupSashPrice(priced, type), GroupSashPricingError);
  }
  assert.throws(() => groupSashPrice({ sashSelectionMode: "fixed", sashType: "royal", sashPricing: { mode: "by_sash", prices: { royal: 23_000 } } }, "american"), GroupSashPricingError);
});

test("pricing application does not mutate catalogue or group configuration", () => {
  const previousCatalog = JSON.stringify(catalog);
  const previousConfiguration = JSON.stringify(priced);
  const previousExtras = JSON.stringify(flowers);
  applyGroupSashPricing(priced, "royal", catalog, flowers);
  assert.equal(JSON.stringify(catalog), previousCatalog);
  assert.equal(JSON.stringify(priced), previousConfiguration);
  assert.equal(JSON.stringify(flowers), previousExtras);
});
