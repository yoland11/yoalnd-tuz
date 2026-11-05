import assert from "node:assert/strict";
import { resolveRentalScan } from "../src/lib/equipment-rental-scan";

const assets = [
  { productId: 7, code: "CHAIR-7", quantity: 5, checkedOutQty: 3, returnedGoodQty: 1 },
  { productId: 12, code: "LIGHT/12", quantity: 2, checkedOutQty: 2, returnedGoodQty: 2 },
];
for (const raw of ["CHAIR-7", " chair-7 ", "AJN-A000007", "https://ajn.example/assets/AJN-A000007?source=qr", "https://ajn.example/assets/AJN-A7-abcdef123"]) {
  assert.deepEqual(resolveRentalScan(raw, assets, "dispatch"), { productId: 7 });
}
assert.deepEqual(resolveRentalScan("LIGHT/12", assets, "dispatch"), { error: "اكتمل تسليم هذه المعدة." });
assert.deepEqual(resolveRentalScan("AJN-A000012", assets, "return"), { error: "لا توجد كمية متبقية لدى العميل لهذه المعدة." });
assert.deepEqual(resolveRentalScan("CHAIR-7", assets, "return"), { productId: 7 });
assert.deepEqual(resolveRentalScan("AJN-A000999", assets, "dispatch"), { error: "هذه المعدة غير موجودة في الإيجار الحالي." });
assert.ok("error" in resolveRentalScan("not-AJN-A7", assets, "dispatch"));
assert.ok("error" in resolveRentalScan("AJN-A7-other-invalid", assets, "dispatch"));
assert.ok("error" in resolveRentalScan("%invalid", assets, "dispatch"));
assert.ok("error" in resolveRentalScan("", assets, "return"));
assert.deepEqual(resolveRentalScan("duplicate", [{ ...assets[0], code: "duplicate" }, { ...assets[1], code: "duplicate" }], "dispatch"), { error: "الباركود مكرر بين معدات الإيجار؛ اختر المعدة يدوياً." });
const returned = [{ ...assets[0], checkedOutQty: 5, returnedGoodQty: 1, returnedDamagedQty: 1, missingQty: 1, pendingInspectionQty: 2 }];
assert.ok("error" in resolveRentalScan("CHAIR-7", returned, "return"), "damaged, lost and inspection custody cannot be returned twice");
assert.deepEqual(resolveRentalScan("AJN-A000007", [{ ...assets[0], code: "" }], "return"), { productId: 7 }, "legacy blank barcode supports original asset QR");
const encodedAssets = [
  { ...assets[0], code: "LIGHT/12" },
  { ...assets[0], productId: 8, code: "12" },
  { ...assets[0], productId: 9, code: "NAME?#" },
  { ...assets[0], productId: 10, code: "LITERAL%2F12" },
];
assert.deepEqual(resolveRentalScan("/assets/LIGHT%2F12", encodedAssets, "dispatch"), { productId: 7 }, "encoded slash must not select a different rental line");
assert.deepEqual(resolveRentalScan("https://ajn.example/assets/NAME%3F%23?print=1#photo", encodedAssets, "dispatch"), { productId: 9 });
assert.deepEqual(resolveRentalScan("LITERAL%2F12", encodedAssets, "dispatch"), { productId: 10 }, "ordinary percent-containing barcodes remain literal");
const qrToken = "f".repeat(64);
const withAliases = [{ ...assets[0], scanCodes: ["NEW-BARCODE", qrToken] }];
assert.deepEqual(resolveRentalScan(`/api/qr/${qrToken}`, withAliases, "dispatch"), { productId: 7 });
assert.deepEqual(resolveRentalScan("NEW-BARCODE", withAliases, "return"), { productId: 7 });
assert.ok("error" in resolveRentalScan(`/api/qr/${qrToken}`, assets, "dispatch"), "an unlisted QR token cannot identify equipment");
assert.ok("error" in resolveRentalScan("CHAIR-7", [{ ...assets[0], reservedQty: 3 }], "dispatch"), "a scan cannot offer an unreserved unit");
console.log("PASS rental barcode identification: exact scoped matches, QR/URLs, ambiguity, exhausted quantities and manual legacy fallback");
