import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// The graduation request creates an invoice before it can replace its temporary
// number with AJN-GR-<id>. PostgreSQL rejects the insert if that temporary
// value exceeds sales_invoices.invoice_no's varchar limit.
const graduation = readFileSync("src/server/graduation.ts", "utf8");
const invoiceSchema = readFileSync("lib/db/src/schema/sales-invoices.ts", "utf8");
const maxLength = Number(invoiceSchema.match(/invoiceNo:\s*varchar\("invoice_no",\s*\{\s*length:\s*(\d+)/)?.[1]);
assert.ok(Number.isSafeInteger(maxLength), "sales invoice number column must declare a length");

const ast = ts.createSourceFile("graduation.ts", graduation, ts.ScriptTarget.Latest, true);
const createInvoice = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "createInvoice");
assert.ok(createInvoice, "graduation invoice creator must exist");
let temporaryInvoiceNumber;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "invoiceNo" && !temporaryInvoiceNumber) {
    temporaryInvoiceNumber = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(createInvoice);
assert.ok(temporaryInvoiceNumber, "graduation invoice insert must have a temporary invoice number");

const sampleUuid = "12345678-1234-4234-8234-123456789abc";
const temporaryNumber = vm.runInNewContext(temporaryInvoiceNumber, { randomUUID: () => sampleUuid });
assert.ok(temporaryNumber.startsWith("GR-TMP-"), "keep graduation's temporary invoice namespace");
assert.ok(temporaryNumber.length <= maxLength,
  `temporary graduation invoice number is ${temporaryNumber.length} characters, but sales_invoices.invoice_no only accepts ${maxLength}`);
assert.match(createInvoice.getText(ast), /AJN-GR-/, "retain the existing final graduation invoice number");
console.log("PASS graduation invoice insert number fits the sales invoice database column");
