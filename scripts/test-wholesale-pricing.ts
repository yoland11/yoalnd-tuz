import assert from "node:assert/strict";
import {
  resolveWholesaleUnitPrice,
  validateWholesaleTiers,
} from "../src/server/wholesale-pricing";

const tiers = [
  { minimumQuantity: 10, unitPrice: 8_500 },
  { minimumQuantity: 50, unitPrice: 7_500 },
  { minimumQuantity: 100, unitPrice: 6_800 },
];

assert.deepEqual(validateWholesaleTiers(tiers), { ok: true });
assert.equal(
  resolveWholesaleUnitPrice({ retailPrice: 10_000, wholesalePrice: 9_000, quantity: 60, tiers }).unitPrice,
  7_500,
);
assert.equal(
  resolveWholesaleUnitPrice({ retailPrice: 10_000, wholesalePrice: 9_000, quantity: 50, tiers }).tierMinimumQuantity,
  50,
);
assert.equal(
  resolveWholesaleUnitPrice({ retailPrice: 10_000, wholesalePrice: 9_000, quantity: 9, tiers }).unitPrice,
  9_000,
);
assert.deepEqual(
  resolveWholesaleUnitPrice({ retailPrice: 10_000, wholesalePrice: 9_000, quantity: 60, tiers, customerPrice: 7_200 }),
  { unitPrice: 7_200, source: "customer" },
);
assert.deepEqual(
  resolveWholesaleUnitPrice({ retailPrice: 10_000, wholesalePrice: null, quantity: 4, tiers: [] }),
  { unitPrice: 10_000, source: "retail" },
);
assert.equal(
  resolveWholesaleUnitPrice({ retailPrice: 10_000, wholesalePrice: null, quantity: 12, tiers }).unitPrice,
  8_500,
);
assert.deepEqual(
  validateWholesaleTiers([
    { minimumQuantity: 10, unitPrice: 8_500 },
    { minimumQuantity: 10, unitPrice: 8_000 },
  ]).ok,
  false,
);
assert.deepEqual(
  validateWholesaleTiers([
    { minimumQuantity: 10, unitPrice: 7_000 },
    { minimumQuantity: 50, unitPrice: 8_000 },
  ]).ok,
  false,
);
assert.deepEqual(
  validateWholesaleTiers([{ minimumQuantity: 0, unitPrice: 7_000 }]).ok,
  false,
);

console.log("Wholesale pricing rules passed.");
