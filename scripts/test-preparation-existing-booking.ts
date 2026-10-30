import assert from "node:assert/strict";
import { appendManualPreparationItems } from "../src/server/booking-preparation";
import { canonicalPreparationItems } from "../src/server/preparation-requests";

const items = [
  { source: "custom" as const, name: "تجهيز قماش", department: "kosha", quantity: 1 },
  { source: "product" as const, productId: 4, name: "ورد", department: "flowers", quantity: 2 },
];
const first = appendManualPreparationItems({ manualPrepItems: [{ id: "old", name: "قديم", department: "other", quantity: 1 }] }, "token-1", items, 5);
assert.equal(first.added, true);
assert.equal((first.operations.manualPrepItems as unknown[]).length, 3);
const retry = appendManualPreparationItems(first.operations, "token-1", items, 5);
assert.equal(retry.added, false);
assert.equal((retry.operations.manualPrepItems as unknown[]).length, 3);
assert.throws(() => appendManualPreparationItems(first.operations, "token-1", [{ ...items[0], name: "different" }], 5), /مختلف|conflict/i);
assert.equal((first.operations.manualPrepItems as Array<{ id: string }>)[0]?.id, "old");
const catalogChanged = [{ ...items[0], name: "اسم جديد من المتجر" }, items[1]];
const changedButSameDraft = appendManualPreparationItems(first.operations, "token-1", catalogChanged, 5, items);
assert.equal(changedButSameDraft.added, false, "retry identity belongs to the original draft, not a later catalog name");
await assert.rejects(() => canonicalPreparationItems([items[1]], async () => [{ id: 4, name: "ورد", nameAr: "ورد", barcode: null, isAsset: false, isActive: true, archivedAt: new Date() }]), /منتج|product/i);
console.log("Existing booking preparation append and retry: passed");
