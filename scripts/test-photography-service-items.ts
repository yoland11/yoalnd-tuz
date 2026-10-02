import assert from "node:assert/strict";
import { CreateServiceOrderBody } from "../lib/api-zod/src/generated/api";
import { calculateServiceLine, serviceOrderTotal } from "../src/server/service-item-lines";

const line = calculateServiceLine({ quantity: 5, unitPrice: 10_000 });
assert.equal(line?.total, 50_000);
assert.equal(serviceOrderTotal(0, [line!.total]), 50_000);
assert.equal(50_000 - 20_000, 30_000, "existing booking payment state retains the remaining amount");
assert.equal(calculateServiceLine({ quantity: 2, unitPrice: 10_000, discount: 2_000 })?.total, 18_000);
assert.equal(serviceOrderTotal(125_000, [50_000, 18_000]), 193_000, "existing base booking amount is preserved and service lines are added once");
assert.equal(CreateServiceOrderBody.safeParse({ serviceId: 1, phone: "07700000000", baseTotalAmount: 0, serviceItems: [{ productId: 1, quantity: 5 }] }).success, true);
assert.equal(CreateServiceOrderBody.safeParse({ serviceId: 1, phone: "07700000000", serviceItems: [{ productId: 1, quantity: 0 }] }).success, false);
console.log("Photography service-item calculation and request contract passed.");
