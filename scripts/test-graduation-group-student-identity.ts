import assert from "node:assert/strict";
import {
  hasDuplicateGroupStudentName,
  normalizeGroupStudentName,
} from "../src/lib/graduation-group-student-identity";

assert.equal(normalizeGroupStudentName("  مُحَمَّد   عَلي  "), "محمد علي");
assert.equal(normalizeGroupStudentName("محمـد علي"), "محمد علي");

const students = [
  { id: 1, customerName: "محمد علي", status: "submitted", archivedAt: null, phone: "07700000000" },
  { id: 2, customerName: "حسن علي", status: "submitted", archivedAt: null, phone: "07700000000" },
  { id: 3, customerName: "زيد علي", status: "cancelled", archivedAt: null, phone: "07700000000" },
  { id: 4, customerName: "علي حسن", status: "submitted", archivedAt: new Date(), phone: "07700000000" },
];

assert.equal(hasDuplicateGroupStudentName(" محمد   علي ", students), true);
assert.equal(hasDuplicateGroupStudentName("مُحَمَّد علي", students), true);
assert.equal(hasDuplicateGroupStudentName("محمد علي", students, 1), false);
assert.equal(hasDuplicateGroupStudentName("حسين علي", students), false);
assert.equal(hasDuplicateGroupStudentName("زيد علي", students), false);
assert.equal(hasDuplicateGroupStudentName("علي حسن", students), false);
assert.equal(hasDuplicateGroupStudentName("حسن علي", students), true);

console.log("PASS group student names are unique among active orders; shared phones remain allowed");
