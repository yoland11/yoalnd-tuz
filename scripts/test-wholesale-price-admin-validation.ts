import assert from "node:assert/strict";
import { wholesalePriceUpdateSchema, customerProductPriceSchema } from "../src/server/wholesale-price-admin";

assert.equal(wholesalePriceUpdateSchema.safeParse({
  wholesalePrice: 9_000,
  tiers: [{ minimumQuantity: 10, unitPrice: 8_000 }, { minimumQuantity: 50, unitPrice: 7_000 }],
}).success, true);
assert.equal(wholesalePriceUpdateSchema.safeParse({
  wholesalePrice: -1,
  tiers: [],
}).success, false);
assert.equal(wholesalePriceUpdateSchema.safeParse({
  wholesalePrice: null,
  tiers: [{ minimumQuantity: 10, unitPrice: 7_000 }, { minimumQuantity: 10, unitPrice: 6_000 }],
}).success, false);
assert.equal(customerProductPriceSchema.safeParse({ customerId: 4, unitPrice: 7_200 }).success, true);
assert.equal(customerProductPriceSchema.safeParse({ customerId: 0, unitPrice: -1 }).success, false);
console.log("Wholesale price admin validation passed.");
