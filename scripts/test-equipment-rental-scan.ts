import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeRentalScanCode, rentalAssetIdFromCode, resolveRentalScan } from "../src/lib/equipment-rental-scan";

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
// The desk's lookup reads codes exactly as the in-rental scanner does.
assert.equal(normalizeRentalScanCode("  CHAIR-7  "), "CHAIR-7");
assert.equal(normalizeRentalScanCode("https://ajn.example/assets/LIGHT%2F12?print=1#x"), "LIGHT/12");
assert.equal(normalizeRentalScanCode("LIGHT/12"), "LIGHT/12", "a slash inside an ordinary barcode stays");
assert.equal(rentalAssetIdFromCode("AJN-A000007"), 7);
assert.equal(rentalAssetIdFromCode("ajn-a7-abcdef12"), 7);
assert.equal(rentalAssetIdFromCode("CHAIR-7"), null);

// The desk: find the rental from a scan, then open it on the right form with the unit counted.
const server = readFileSync("src/server/equipment-rentals.ts", "utf8");
const lookup = server.slice(server.indexOf("async function scanLookup("), server.indexOf("async function options("));
assert.ok(lookup.length > 200 && !/(insert|update|delete)/i.test(lookup), "the lookup only reads");
assert.match(lookup, /canDispatchEquipment\(rental\) : !canReturnEquipment\(rental\)/, "it offers only what the rental's own buttons would offer");
assert.match(lookup, /ap\.qr_token[\s\S]*ap\.serial_number[\s\S]*a\.serial_number[\s\S]*qr_tokens/, "it knows every alias the in-rental scanner knows");
assert.match(server, /parts\[0\] === "scan" && req\.method === "GET"\) \{\s+const action = [^;]+;\s+requireCapability\(caps, action\);/, "dispatch and return lookups need their own permission");
const view = readFileSync("src/views/admin/equipment-rentals.tsx", "utf8");
assert.match(view, /mode === "returns" \? <RentalScanDesk capabilities=\{capabilities\} \/>/, "the dispatch and return page opens with the scan desk");
assert.match(view, /\?\$\{new URLSearchParams\(\{ action, scan: scanned \}\)\}/, "a match opens the rental on the right form with the code");
assert.match(view, /useState<"manual" \| "scan">\("scan"\)/, "the movement form starts on scanning");
assert.match(view, /const scanField: RentalQuantityField = dispatching \? "quantity" : "good";/, "each scan counts one unit");
assert.match(view, /if \(item\.entered >= item\.limit\) return \{ ok: false/, "a scan never counts past what is out or reserved");
assert.match(view, /function RentalRowActions[\s\S]{0,400}استلام معدات[\s\S]{0,400}تسليم معدات/, "receive and dispatch are visible buttons on every rental");
assert.match(view, /<RentalCards rows=\{list\.data\?\.data \?\? \[\]\} mode=\{mode\} \/><div className="hidden overflow-x-auto xl:block">/, "below the wide-table width rentals are cards, so the buttons stay on screen");
console.log("PASS rental barcode identification: exact scoped matches, QR/URLs, ambiguity, exhausted quantities and manual legacy fallback; the scan desk finds the rental and counts each scan");
