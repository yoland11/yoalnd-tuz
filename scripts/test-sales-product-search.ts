import assert from "node:assert/strict";
import { filterSalesProducts } from "../src/views/admin/sales-invoice-ui";

const products = [
  { id: 1, name: "Wireless microphone", nameAr: "مايك لاسلكي", barcode: "AJN-001", price: "100", stock: "4" },
  { id: 2, name: "LED flower", nameAr: "ورد مضيء", barcode: "AJN-002", price: "50", stock: "8" },
  { id: 3, name: "Speaker", nameAr: "سماعة RCF", barcode: "745-RCF", price: "500", stock: "2" },
];

assert.deepEqual(filterSalesProducts(products, "مايك").map((row) => row.id), [1], "Arabic name search must return the matching product");
assert.deepEqual(filterSalesProducts(products, "wireless").map((row) => row.id), [1], "English name search must be case-insensitive");
assert.deepEqual(filterSalesProducts(products, "745-rcf").map((row) => row.id), [3], "barcode search must be case-insensitive");
assert.deepEqual(filterSalesProducts(products, "   ").map((row) => row.id), [1, 2, 3], "empty search must keep the catalogue available");

console.log("Sales product searchable selector behavior verified.");
