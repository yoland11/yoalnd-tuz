import assert from "node:assert/strict";
import { calculateEquipmentRental, equipmentRentalCapabilities, EquipmentRentalValidationError } from "../src/lib/equipment-rentals";

const base = { startDate: "2026-11-03", endDate: "2026-11-05", startTime: "10:00", endTime: "12:00", assets: [{ productId: 1, quantity: 2, pricingType: "daily", unitPrice: 100, discount: 10 }], deliveryCharge: 25, installationCharge: 5, discount: 20, depositRequired: 500 };
const result = calculateEquipmentRental(base);
assert.equal(result.assets[0].duration, 3);
assert.equal(result.assets[0].lineTotal, 590);
assert.equal(result.total, 600, "security deposit is a liability, never rental revenue");
assert.equal(calculateEquipmentRental({ ...base, assets: [{ productId: 1, quantity: 1, pricingType: "hourly", unitPrice: 10 }] }).assets[0].duration, 50);
assert.equal(calculateEquipmentRental({ ...base, assets: [{ productId: 1, quantity: 3, pricingType: "fixed", unitPrice: 10 }] }).assets[0].lineTotal, 30);
for (const patch of [{ assets: [] }, { discount: 100000 }, { endDate: "2026-11-02" }, { assets: [{ productId: 1, quantity: -1, unitPrice: 2 }] }, { assets: [{ productId: 1, quantity: 1, unitPrice: 2 }, { productId: 1, quantity: 1, unitPrice: 2 }] }]) {
  assert.throws(() => calculateEquipmentRental({ ...base, ...patch }), EquipmentRentalValidationError);
}
assert.equal(equipmentRentalCapabilities({ role: "employee", permissions: ["booking_create"] }).create, true);
assert.equal(equipmentRentalCapabilities({ role: "employee", permissions: ["booking_create"] }).finance, false);
assert.equal(equipmentRentalCapabilities({ role: "admin", permissions: [] }).finance, true);
console.log("equipment rental pricing and permissions passed");
