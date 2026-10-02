import assert from "node:assert/strict";
import {
  groupPurchaseInvoiceStockChanges,
  preparePurchaseVariantLines,
} from "../src/server/purchase-variant-lines";

const catalog = [
  { id: 1, name: "إطار", variants: [] },
  {
    id: 2,
    name: "ورد صناعي",
    variants: [
      { id: 21, productId: 2, color: "أبيض", size: "كبير", sku: "W-01", barcode: "V-21", cost: 5_000, price: 8_000, stock: 10, isActive: true },
      { id: 22, productId: 2, color: "وردي", size: "وسط", sku: "W-02", barcode: "V-22", cost: 4_500, price: 7_000, stock: 7, isActive: true },
    ],
  },
];

const plain = preparePurchaseVariantLines(
  [{ productId: 1, quantity: 2, costPrice: 1000 }],
  catalog,
);
assert.equal(plain.ok, true, "products without variants keep the old line flow");
assert.equal(plain.lines[0]?.variantId, null);

const required = preparePurchaseVariantLines(
  [{ productId: 2, quantity: 20, costPrice: 5000 }],
  catalog,
);
assert.equal(required.ok, false, "a product with variants requires a selection");

const mixed = preparePurchaseVariantLines(
  [
    { productId: 2, variantId: 21, quantity: 20, costPrice: 5000 },
    { productId: 2, variantId: 22, quantity: 15, costPrice: 4500 },
  ],
  catalog,
);
assert.equal(mixed.ok, true);
assert.equal(mixed.lines[0]?.variantLabel, "أبيض / كبير");
assert.equal(mixed.lines[0]?.barcode, "V-21");
assert.equal(mixed.lines[0]?.variantSku, "W-01");
assert.equal(mixed.lines[0]?.total, 100_000);
assert.equal(mixed.lines[1]?.variantLabel, "وردي / وسط");
assert.equal(mixed.lines[1]?.total, 67_500);

const changes = groupPurchaseInvoiceStockChanges([
  { productId: 1, variantId: null, quantity: 3 },
  { productId: 2, variantId: 21, quantity: 20 },
  { productId: 2, variantId: 22, quantity: 15 },
]);
assert.deepEqual(changes.productQuantities, new Map([[1, 3]]));
assert.deepEqual(changes.variantQuantities, new Map([[21, 20], [22, 15]]));

const invalidVariant = preparePurchaseVariantLines(
  [{ productId: 1, variantId: 21, quantity: 1, costPrice: 1000 }],
  catalog,
);
assert.equal(invalidVariant.ok, false, "variant must belong to its selected product");

const fractionalVariantQuantity = preparePurchaseVariantLines(
  [{ productId: 2, variantId: 21, quantity: 1.5, costPrice: 5000 }],
  catalog,
);
assert.equal(fractionalVariantQuantity.ok, false, "variant stock uses existing integer quantity storage");

const inactiveCatalog = [{
  id: 3,
  name: "منتج مؤرشف",
  variants: [{ id: 31, productId: 3, color: "أسود", size: "XL", stock: 0, isActive: false }],
}];
assert.equal(preparePurchaseVariantLines([{ productId: 3, variantId: 31, quantity: 1, costPrice: 5000 }], inactiveCatalog).ok, false);
assert.equal(preparePurchaseVariantLines([{ productId: 3, variantId: 31, quantity: 1, costPrice: 5000 }], inactiveCatalog, new Set([31])).ok, true, "edits may preserve their existing inactive variant");

console.log("Purchase invoice product-variant contracts passed.");
