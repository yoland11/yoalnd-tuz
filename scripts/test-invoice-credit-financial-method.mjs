import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Invoices allow the payment term "credit" (آجل); financial requests accept only
// actual collection methods. Every invoice payment sync must map the method, or
// saving an edited credit invoice with a payment fails with a generic 500.
const api = readFileSync("src/server/api.ts", "utf8");

const calls = [...api.matchAll(/syncSourcePaymentTarget\(\s*\{(?:(?!syncSourcePaymentTarget\()[\s\S])*?sourceType: "(sales_invoice|purchase_invoice)"(?:(?!syncSourcePaymentTarget\()[\s\S])*?paymentMethod: ([^\n]+)/g)];
// `sourceMethod` (receipt allocation) is already narrowed to cash/transfer/pos.
for (const [, source, method] of calls)
  assert.match(method, /^(financialPaymentMethod\(\w+\.paymentMethod \|\| "cash"\)|sourceMethod),$/, `${source} sync must map its payment method: ${method}`);
const mapped = calls.filter(([, , method]) => method.startsWith("financialPaymentMethod(")).length;
assert.ok(mapped >= 5, `expected the 5 invoice edit/create/delete syncs to map credit, found ${mapped}`);
assert.doesNotMatch(api, /paymentMethod: \(\w+\.paymentMethod as any\) \|\| "cash",/, "no raw invoice payment method reaches a financial request");

const source = api.match(/function financialPaymentMethod\([\s\S]*?\n\}/)?.[0];
assert.ok(source, "financialPaymentMethod exists");
const financialPaymentMethod = new Function(`${ts.transpile(source)}; return financialPaymentMethod;`)();
assert.equal(financialPaymentMethod("credit" || "cash"), "other", "credit is recorded as an unclassified collection");
assert.equal(financialPaymentMethod("" || "cash"), "cash", "an empty method keeps the cash default");
for (const method of ["cash", "transfer", "card", "pos", "other"]) assert.equal(financialPaymentMethod(method), method);

console.log(`PASS invoice payment syncs map credit to a valid financial method (${mapped} call sites)`);
