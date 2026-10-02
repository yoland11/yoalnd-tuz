import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const products = readFileSync("src/views/admin/products.tsx", "utf8");
const pos = readFileSync("src/views/admin/pos.tsx", "utf8");
const checks = [
  ["catalog selects product or service", products.includes('value="service"') && products.includes('value="product"')],
  ["service unit can be entered", products.includes("serviceUnit") && products.includes("وحدة البيع")],
  ["service inventory is presented as disabled", pos.includes("لا تخصم من المخزون")],
  ["service unit appears in cart and printed invoice", pos.includes("item.serviceUnit || \"خدمة\"") && pos.includes("(${i.serviceUnit || \"خدمة\"})")],
  ["tracked products retain stock checks", pos.includes("tracksInventory && stock <= 0")],
];
for (const [label, ok] of checks) assert.ok(ok, label);
console.log("Service item catalog and POS UI contract passed.");
