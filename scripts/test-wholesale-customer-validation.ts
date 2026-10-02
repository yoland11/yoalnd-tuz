import assert from "node:assert/strict";
import {
  wholesaleCustomerProfileSchema,
} from "../src/server/wholesale-customer";

assert.equal(wholesaleCustomerProfileSchema.safeParse({ customerType: "retail" }).success, true);
assert.equal(wholesaleCustomerProfileSchema.safeParse({
  customerType: "wholesale",
  businessName: "مكتبة النور",
  ownerName: "علي",
  creditLimit: 1_000_000,
  specialDiscountPercent: 5,
}).success, true);
assert.equal(wholesaleCustomerProfileSchema.safeParse({ customerType: "wholesale", businessName: "" }).success, false);
assert.equal(wholesaleCustomerProfileSchema.safeParse({ customerType: "other" }).success, false);
assert.equal(wholesaleCustomerProfileSchema.safeParse({ customerType: "wholesale", businessName: "مكتبة", ownerName: "صاحب", creditLimit: -1 }).success, false);
assert.equal(wholesaleCustomerProfileSchema.safeParse({ customerType: "wholesale", businessName: "مكتبة", ownerName: "صاحب", specialDiscountPercent: 101 }).success, false);
console.log("Wholesale customer validation passed.");
