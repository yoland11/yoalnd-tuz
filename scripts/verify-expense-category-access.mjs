import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/views/admin/expenses.tsx", "utf8");

assert.match(source, /onManageCategories/, "the expense form must expose category management beside category selection");
assert.match(source, /onManageCategories=\{\(\) => setShowCategories\(true\)\}/, "the category action must open the existing category manager");
assert.match(source, /إدارة التصنيفات/, "the category field must provide a clear management action");
assert.match(source, /method: draft\.id \? "PATCH" : "POST"/, "the category manager must keep create and update operations available");
assert.match(source, /method: "DELETE"/, "the category manager must keep the guarded delete operation available");

console.log("Expense category access checks passed.");
