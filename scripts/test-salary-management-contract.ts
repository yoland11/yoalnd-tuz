import assert from "node:assert/strict";
import { readSalaryManagementPayments } from "../src/views/admin/salary-management-contract";

const payments = [{ id: 12, status: "paid" }];
assert.deepEqual(readSalaryManagementPayments({ payments }), payments);
assert.deepEqual(readSalaryManagementPayments({ payments: [] }), []);
assert.equal(readSalaryManagementPayments({}), null);
assert.equal(readSalaryManagementPayments({ payments: undefined }), null);
assert.equal(readSalaryManagementPayments(null), null);

console.log("Salary management payload contract: 5 assertions passed.");
