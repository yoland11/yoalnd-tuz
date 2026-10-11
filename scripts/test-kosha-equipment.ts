import assert from "node:assert/strict";
import {
  equipmentKey,
  normalizeEquipment,
  mergeEquipmentImport,
  equipmentAvailability,
  selectTemplateEquipment,
} from "../src/lib/kosha-equipment";

const gold = {
  productId: 10,
  variantId: 2,
  quantity: 2.5,
  unit: "قطعة",
  returnable: true,
  required: true,
  notes: "ذهب",
};
assert.equal(equipmentKey(gold), "10:2");
assert.deepEqual(normalizeEquipment([gold]), [gold]);
for (const quantity of [0, -1, NaN, Infinity, 0.0001]) {
  assert.throws(() => normalizeEquipment([{ ...gold, quantity }]));
}
assert.throws(() => normalizeEquipment([{ ...gold, productId: 0 }]));
assert.throws(() => normalizeEquipment([{ ...gold, variantId: -1 }]));
assert.throws(() => normalizeEquipment([gold, gold]));
assert.throws(() => normalizeEquipment([{ ...gold, returnable: "false" }]));
const existing = [{ ...gold, quantity: 4, stage: "reserved" }];
assert.deepEqual(
  mergeEquipmentImport(existing, [gold]),
  existing,
  "repeat import preserves booking overrides",
);
const secondVariant = { ...gold, variantId: 3 };
assert.equal(mergeEquipmentImport(existing, [secondVariant]).length, 2);
assert.equal(existing.length, 1, "import does not mutate existing lines");
assert.deepEqual(
  selectTemplateEquipment(
    [gold],
    [{ productId: 10, variantId: 2, quantity: 5, returnable: false }],
  ),
  [{ ...gold, quantity: 5 }],
  "client cannot change authoritative return policy",
);
assert.throws(() =>
  selectTemplateEquipment([gold], [{ productId: 99, quantity: 1 }]),
);
assert.throws(() =>
  selectTemplateEquipment(
    [gold],
    [{ productId: 10, variantId: 2, quantity: 0 }],
  ),
);
assert.deepEqual(equipmentAvailability(10, 4, 8), {
  required: 8,
  available: 6,
  reserved: 4,
  missing: 2,
});
assert.deepEqual(equipmentAvailability(2, 4, 1), {
  required: 1,
  available: 0,
  reserved: 4,
  missing: 1,
});
console.log(
  "Koshah equipment validation, identity, duplicate protection and availability passed",
);
