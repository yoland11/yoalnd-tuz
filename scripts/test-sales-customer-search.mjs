import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync("src/views/admin/sales.tsx", "utf8");
const api = readFileSync("src/server/api.ts", "utf8");

const lookupStart = ui.indexOf("function CustomerLookup(");
const lookupEnd = ui.indexOf("// ── Main Component", lookupStart);
assert.notEqual(lookupStart, -1, "Sales customer lookup exists");
const lookup = ui.slice(lookupStart, lookupEnd);

assert.match(
  lookup,
  /\/admin\/sales-invoices\/customer-search\?search=/,
  "Invoice customer lookup uses its accounting-authorized endpoint",
);
assert.match(lookup, /customers\.isError/, "Lookup distinguishes API errors from empty results");
assert.match(lookup, /customers\.refetch\(\)/, "Lookup provides a retry action");
assert.match(lookup, /لا يوجد عميل مطابق/, "Lookup retains an explicit empty state");
assert.match(lookup, /deferredSearch\.length\s*>=\s*1/, "Lookup starts matching from the first typed character");

const handlerStart = api.indexOf("async function handleSalesInvoices(");
const handlerEnd = api.indexOf("\nasync function ", handlerStart + 20);
assert.notEqual(handlerStart, -1, "Sales invoice API handler exists");
const handler = api.slice(handlerStart, handlerEnd === -1 ? undefined : handlerEnd);
assert.match(handler, /parts\[2\]\s*===\s*["']customer-search["']/, "Dedicated customer-search API route exists");
assert.match(handler, /requirePermission\([\s\S]{0,400}accounting/, "Customer search stays behind invoice permission");
assert.match(handler, /limit:\s*12/, "Customer search results are bounded");
assert.match(handler, /query\.length\s*<\s*1/, "API accepts a single-character search");
assert.match(handler, /customersTable\.(name|fullName|phone)/, "Search uses customer identity fields");
assert.match(handler, /status[\s\S]{0,80}deleted|deleted[\s\S]{0,80}status/, "Deleted customers are excluded");
const customerSearchStart = handler.indexOf("if (isCustomerSearch)");
const customerSearch = handler.slice(customerSearchStart, customerSearchStart + 1_500);
assert.doesNotMatch(customerSearch, /businessName/, "Search only selects fields present in the production customer schema");

console.log("Sales invoice customer search contract passed.");
