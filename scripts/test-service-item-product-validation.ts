import assert from "node:assert/strict";
import { CreateProductBody } from "../lib/api-zod/src/generated/api";
import { normalizeProductItemSettings } from "../src/server/product-item-settings";

const servicePayload = {
  name: "Studio Photo Shot",
  nameAr: "لقطة تصوير استوديو",
  price: 10_000,
  itemType: "service",
  serviceUnit: "لقطة",
  trackInventory: false,
};

const parsed = CreateProductBody.safeParse(servicePayload);
assert.equal(parsed.success, true);
assert.equal((parsed as any).data.itemType, "service", "service type must survive API validation");
assert.equal((parsed as any).data.serviceUnit, "لقطة", "service unit must survive API validation");
assert.equal((parsed as any).data.trackInventory, false, "service inventory setting must survive API validation");
assert.equal(CreateProductBody.safeParse({ ...servicePayload, serviceUnit: " " }).success, false);
assert.equal(CreateProductBody.safeParse({ ...servicePayload, trackInventory: true }).success, false);

assert.equal(CreateProductBody.safeParse({ ...servicePayload, itemType: "unknown" }).success, false);
assert.deepEqual(
  normalizeProductItemSettings({ itemType: "service", serviceUnit: " لقطة ", trackInventory: false }),
  { ok: true, settings: { itemType: "service", serviceUnit: "لقطة", trackInventory: false } },
);
assert.deepEqual(
  normalizeProductItemSettings({}, { itemType: "product", trackInventory: true }),
  { ok: true, settings: { itemType: "product", serviceUnit: null, trackInventory: true } },
);
assert.equal(normalizeProductItemSettings({ itemType: "service", serviceUnit: " " }).ok, false);
console.log("Product service validation contract passed.");
