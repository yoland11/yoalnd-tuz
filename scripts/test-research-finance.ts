import assert from "node:assert/strict";
import { researchMoney, assertResearchCollection, assertResearchRetry, requireResearchFinance, researchStatementDay } from "../src/server/research-payment-rules";

// These checks exercise the production money rules without any database URL.
assert.equal(researchMoney("1200.01"), 120001);
for (const value of [NaN, Infinity, "1.001", "1e3", "", -1, "0.001"])
  assert.throws(() => researchMoney(value), /مبلغ/);
assert.throws(() => assertResearchCollection({ amount: "70", remaining: "100", pending: "40" }), /المتبقي/);
assert.throws(() => assertResearchCollection({ amount: "101", remaining: "100", pending: "0" }), /المتبقي/);
assert.equal(assertResearchCollection({ amount: "60", remaining: "100", pending: "40" }), 6000);
assert.equal(assertResearchCollection({ amount: "100", remaining: "100", pending: "100", ownPending: "100" }), 10000);
const original = { amount: "25", method: "cash", date: "2026-11-16", notes: "دفعة", accountId: null };
assert.equal(assertResearchRetry(original, { ...original, amount: 25 }, "pending"), true);
for (const changed of [{ method: "transfer" }, { amount: "26" }, { notes: "تغيير" }, { date: "2026-11-17" }, { accountId: 3 }])
  assert.throws(() => assertResearchRetry(original, { ...original, ...changed }, "pending"), /التكرار/);
assert.throws(() => assertResearchRetry(original, original, "rejected"), /مرفوض/);
assert.equal(assertResearchRetry(original, original, "executed"), true);
const employee = { role: "employee", isActive: true, permissions: ["research.financials.view", "research.payment.receive"] };
requireResearchFinance(employee);
requireResearchFinance(employee, "research.payment.receive");
requireResearchFinance({ ...employee, permissions: ["research"] }, "research.payment.receive");
assert.throws(() => requireResearchFinance({ ...employee, permissions: ["research.view"] }), /صلاحية/);
assert.throws(() => requireResearchFinance({ ...employee, permissions: ["research.financials.view"] }, "research.payment.receive"), /صلاحية/);
assert.throws(() => requireResearchFinance({ ...employee, isActive: false }), /صلاحية/);
assert.equal(researchStatementDay("2026-11-15T22:30:00.000Z"), "2026-11-16");
assert.equal(researchStatementDay("2026-11-16T21:00:00.000Z"), "2026-11-17");
assert.equal(researchStatementDay("2026-11-15"), "2026-11-15");
assert.equal(researchStatementDay(null), null);
// Net approved cash after reversals is independent from noncash credit.
assert.equal(assertResearchCollection({ amount: "20", remaining: "20", pending: "0" }), 2000);
console.log("Research financial validation, pending reservation and durable retry rules passed.");
