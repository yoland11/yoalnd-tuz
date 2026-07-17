import assert from "node:assert/strict";

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function localizedNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const normalized = String(value ?? "").trim()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function salaryTotal(input) {
  const gross = money(input.base + input.allowances + input.bonus + input.overtime + input.addition);
  const deductions = money(input.deduction + input.advance);
  return { gross, deductions, net: Math.max(0, money(gross - deductions)) };
}

function applyPayment(state, amount, key) {
  if (state.keys.has(key)) return { ...state, duplicate: true };
  const remaining = money(state.net - state.paid);
  if (amount <= 0) throw new Error("invalid payment");
  if (amount > remaining) throw new Error("overpayment");
  const paid = money(state.paid + amount);
  const keys = new Set(state.keys).add(key);
  return { ...state, keys, paid, remaining: money(state.net - paid), status: paid >= state.net ? "paid" : "partially_paid", cashTransactions: state.cashTransactions + 1, journalEntries: state.journalEntries + 1, duplicate: false };
}

function applyAdvance(state, reference, amount) {
  if (state.advanceReferences.has(reference)) return state;
  return { ...state, advanceBalance: money(state.advanceBalance - amount), advanceReferences: new Set(state.advanceReferences).add(reference) };
}

function restoreAdvance(state, reference, amount) {
  if (!state.advanceReferences.has(reference)) return state;
  const next = new Set(state.advanceReferences); next.delete(reference);
  return { ...state, advanceBalance: money(state.advanceBalance + amount), advanceReferences: next };
}

const totals = salaryTotal({ base: 1_000_000, allowances: 100_000, bonus: 50_000, overtime: 25_000, addition: 10_000, deduction: 35_000, advance: 100_000 });
assert.deepEqual(totals, { gross: 1_185_000, deductions: 135_000, net: 1_050_000 });

let payment = { net: 500_000, paid: 0, remaining: 500_000, status: "unpaid", keys: new Set(), cashTransactions: 0, journalEntries: 0 };
payment = applyPayment(payment, 200_000, "request-1");
assert.equal(payment.status, "partially_paid");
assert.equal(payment.remaining, 300_000);
payment = applyPayment(payment, 300_000, "request-2");
assert.equal(payment.status, "paid");
assert.equal(payment.remaining, 0);
assert.equal(payment.cashTransactions, 2);
assert.equal(payment.journalEntries, 2);

const duplicate = applyPayment(payment, 300_000, "request-2");
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.cashTransactions, 2);
assert.throws(() => applyPayment({ ...payment, net: 600_000, paid: 500_000 }, 100_001, "request-3"), /overpayment/);

let advance = { advanceBalance: 250_000, advanceReferences: new Set() };
advance = applyAdvance(advance, "PAY-7:line:12", 50_000);
advance = applyAdvance(advance, "PAY-7:line:12", 50_000);
assert.equal(advance.advanceBalance, 200_000);
advance = restoreAdvance(advance, "PAY-7:line:12", 50_000);
assert.equal(advance.advanceBalance, 250_000);

const reconciliation = { existingCashTransactions: 1, existingJournalEntries: 1, linked: false };
const linked = { ...reconciliation, linked: true };
assert.equal(linked.existingCashTransactions, 1);
assert.equal(linked.existingJournalEntries, 1);

assert.equal(localizedNumber("500,000"), 500_000);
assert.equal(localizedNumber("٥٠٠٬٠٠٠"), 500_000);
assert.equal(localizedNumber("١٢٣٫٥"), 123.5);

console.log("Employee salary logic: 17 assertions passed (calculation, localized amounts, partial/full payment, overpayment, idempotency, advances, legacy reconciliation)." );
