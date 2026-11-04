import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";

// Supply the REAL source-owned guard to legacy extracted-function harnesses.
// This imports no runtime DB and never substitutes an allow-all stub.
const rental = ts.createSourceFile("rental.ts", readFileSync(new URL("../../src/server/equipment-rental-finance.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const cash = ts.createSourceFile("cash.ts", readFileSync(new URL("../../src/server/master-cash-box.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const functions = rental.statements.filter(node => ts.isFunctionDeclaration(node) && ["isEquipmentRentalFinancial", "assertGenericEquipmentRentalInput", "lockEquipmentRentalReceiptSources"].includes(node.name?.text));
const error = cash.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FinancialApprovalError");
assert.equal(functions.length, 3); assert.ok(error);
const body = [error.getText(cash), ...functions.map(node => node.getText(rental))].map(text => text.replace(/^export\s+/, "")).join("\n");
const context = vm.createContext({sql});
vm.runInContext(ts.transpileModule(`${body}\nglobalThis.guard=assertGenericEquipmentRentalInput;globalThis.isRental=isEquipmentRentalFinancial;globalThis.lockReceipt=lockEquipmentRentalReceiptSources;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
export const assertGenericEquipmentRentalInput = context.guard;
export const isEquipmentRentalFinancial = context.isRental;
export const lockEquipmentRentalReceiptSources = context.lockReceipt;
assert.throws(() => assertGenericEquipmentRentalInput({ sourceType: "equipment_rental_deposit" }), error => error.status === 409);
assert.throws(() => assertGenericEquipmentRentalInput({ sourceType: "sales_invoice", transactionType: "er_charge" }), error => error.status === 409);
assert.doesNotThrow(() => assertGenericEquipmentRentalInput({ sourceType: "graduation_order", transactionType: "graduation_payment" }));
