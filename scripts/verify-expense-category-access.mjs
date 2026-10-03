import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/views/admin/expenses.tsx", "utf8");

assert.match(source, /onManageCategories/, "the expense form must expose category management beside category selection");
assert.match(source, /onManageCategories=\{\(\) => setShowCategories\(true\)\}/, "the category action must open the existing category manager");
assert.match(source, /إدارة التصنيفات/, "the category field must provide a clear management action");
assert.match(source, /method: draft\.id \? "PATCH" : "POST"/, "the category manager must keep create and update operations available");
assert.match(source, /method: "DELETE"/, "the category manager must keep the guarded delete operation available");

assert.match(source, /useState\(\{ from: "", to: "", categoryId: "", paymentMethod: "", search: "", user: "" \}\)/, "expenses must show all dates by default");
assert.match(source, /if \(filters\.from\) params\.set\("from", filters\.from\)/, "the expense query must omit the lower date bound when cleared");
assert.match(source, /if \(filters\.to\) params\.set\("to", filters\.to\)/, "the expense query must omit the upper date bound when cleared");
assert.match(source, /aria-label="مسح التاريخين وعرض جميع المصاريف"[\s\S]*setFilters\(\(f\) => \(\{ \.\.\.f, from: "", to: "" \}\)\)/, "the date reset control must clear only the date bounds");

console.log("Expense category and date filter checks passed.");
