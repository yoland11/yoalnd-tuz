import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/views/admin/purchases.tsx", "utf8");
const tableStart = source.indexOf('<table className="w-full text-sm">');
const tableEnd = source.indexOf("</table>", tableStart);
assert.notEqual(tableStart, -1, "purchase invoice item table exists");
assert.notEqual(tableEnd, -1, "purchase invoice item table is closed");

const table = source.slice(tableStart, tableEnd);
assert.match(table, /<tfoot[\s\S]*<\/tfoot>/, "purchase item table has a totals footer");
assert.match(table, /مجموع الكميات/, "footer labels the total quantity");
assert.match(table, /مجموع سعر التكلفة/, "footer labels cost-column total");
assert.match(table, /مجموع سعر البيع/, "footer labels sale-column total");
assert.match(table, /مجموع الخصم/, "footer labels discount-column total");
assert.match(table, /مجموع الأصناف/, "footer labels the existing line-total sum");
assert.doesNotMatch(table, /مجموع السطر/, "totals are consolidated at the table bottom, not repeated under each item");

console.log("Purchase invoice column totals UI contract passed.");
