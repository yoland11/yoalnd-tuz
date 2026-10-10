import assert from "node:assert/strict";
import { isActiveGroupStudent } from "../src/lib/graduation-group-student-identity";
import { importGroupStudentRows } from "../src/lib/graduation-group-import";

const active = { status: "submitted", archivedAt: null };
assert.equal(isActiveGroupStudent(active), true);
assert.equal(isActiveGroupStudent({ status: "cancelled", archivedAt: null }), false);
assert.equal(isActiveGroupStudent({ status: "submitted", archivedAt: new Date() }), false);

const rows = [{ row: 2, customerName: "علي" }, { row: 3, customerName: "حسن" }];
const firstAttempt = await importGroupStudentRows(rows, async (item) => {
  if (item.row === 3) throw new Error("temporary failure");
});
assert.deepEqual(firstAttempt.succeeded.map((item) => item.row), [2]);
assert.deepEqual(firstAttempt.failed.map((item) => item.rowData.row), [3]);
const retried: number[] = [];
const retry = await importGroupStudentRows(firstAttempt.failed.map((item) => item.rowData), async (item) => {
  retried.push(item.row);
});
assert.deepEqual(retried, [3], "retry must never resubmit a saved student");
assert.deepEqual(retry.failed, []);

console.log("Group student overview and partial import retry checks passed.");
