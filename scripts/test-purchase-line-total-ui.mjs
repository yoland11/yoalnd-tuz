import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/views/admin/purchases.tsx", "utf8");
const tableStart = source.indexOf('<tbody className="divide-y divide-border/20">');
const tableEnd = source.indexOf("</tbody>", tableStart);
assert.notEqual(tableStart, -1, "purchase invoice item table exists");
assert.notEqual(tableEnd, -1, "purchase invoice item table body is closed");

const body = source.slice(tableStart, tableEnd);
assert.match(
  body,
  /formatCurrency\(item\.total\)/,
  "each purchase line summary displays the existing line total",
);
assert.match(
  body,
  /مجموع السطر/,
  "each purchase line has a labeled total summary beneath its editable row",
);
assert.match(
  body,
  /colSpan=\{8\}/,
  "the line total summary spans the full purchase table row",
);

console.log("Purchase invoice line total UI contract passed.");
