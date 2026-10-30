/** Printing one expense: every field on paper, escaped, and only an executed expense reads as paid. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { buildExpenseVoucherHtml } from "../src/views/admin/expenses";

Object.assign(globalThis, { React });
const expense = {
  id: 77,
  date: "2026-10-30",
  name: "ايجار محل ايوب مصور <b>",
  amount: "300000",
  categoryName: "إيجار",
  paymentMethod: "cash",
  notes: "دفعة شهر تشرين",
  approvalStatus: "executed",
  createdByName: "المدير الرئيسي",
  beneficiaryName: "أيوب",
};

for (const format of ["a4", "80mm", "58mm"] as const) {
  const html = buildExpenseVoucherHtml(expense, format, "/logo.png", "مجموعة علي جان نهاد");
  for (const text of ["سند مصروف", "#77", "2026-10-30", "إيجار", "نقد", "أيوب", "معتمد", "المدير الرئيسي", "دفعة شهر تشرين", "300,000", "مجموعة علي جان نهاد", "/logo.png"]) assert.ok(html.includes(text), `${format}: ${text}`);
  assert.ok(html.includes("ايجار محل ايوب مصور &lt;b&gt;"), `${format}: customer text is escaped`);
  assert.ok(!html.includes("<b>"), format);
  assert.ok(!html.includes("لا يثبت صرف المبلغ"), `${format}: an executed expense has no warning`);
  assert.match(html, /window\.print|\.print\(/, `${format}: prints itself once images are ready`);
  for (const status of ["pending", "rejected", "reversed", "cancelled"]) assert.ok(buildExpenseVoucherHtml({ ...expense, approvalStatus: status }, format, "", "ش").includes("لا يثبت صرف المبلغ"), `${format} ${status}: never reads as paid`);
}
assert.match(buildExpenseVoucherHtml(expense, "a4", "", "ش"), /@page\{size:A4/);
assert.match(buildExpenseVoucherHtml(expense, "80mm", "", "ش"), /@page \{ size: 80mm/);
assert.match(buildExpenseVoucherHtml(expense, "58mm", "", "ش"), /@page \{ size: 58mm/);
const legacy = buildExpenseVoucherHtml({ ...expense, approvalStatus: undefined, notes: null, beneficiaryName: null }, "a4", "", "ش");
assert.ok(legacy.includes("معتمد"), "a legacy expense without a status counts as executed, as the list does");
assert.ok(!legacy.includes("ملاحظات") && !legacy.includes("المستفيد"), "empty fields are left out");

const view = readFileSync(new URL("../src/views/admin/expenses.tsx", import.meta.url), "utf8");
assert.match(view, /printExpense\(expense, "a4"\)/, "the row offers A4");
assert.match(view, /printExpense\(expense, "80mm"\)/, "the row offers 80mm");
assert.match(view, /printExpense\(expense, "58mm"\)/, "the row offers 58mm");
assert.match(view, /<\/DropdownMenu>\s*<\/div>\s*<\/td>/, "the print button sits in the actions cell for every row");

console.log("PASS expense voucher print: all fields, escaping, A4/80mm/58mm, unpaid statuses never read as paid");
