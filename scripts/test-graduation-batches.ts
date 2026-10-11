import assert from "node:assert/strict";
import {
  UNASSIGNED_BATCH,
  combineStats,
  compareBatchKeys,
  deliveryPhase,
  groupBatchKey,
  isValidBatchKey,
  normalizeBatchKey,
  paymentPhase,
  productionPhase,
  studentEquipment,
  summarizeStudents,
} from "../src/lib/graduation-batches";

// Batch keys come only from the stored graduation year — never guessed.
assert.equal(groupBatchKey("2027"), "2027");
assert.equal(groupBatchKey(" ٢٠٢٨ "), "2028", "Arabic-Indic digits normalise to the same batch");
assert.equal(groupBatchKey(""), UNASSIGNED_BATCH);
assert.equal(groupBatchKey(null), UNASSIGNED_BATCH);
assert.equal(groupBatchKey("الدفعة 45"), "الدفعة 45", "a stored non-year value is kept as-is, not reinterpreted");
assert.equal(normalizeBatchKey("2026-2027"), "2026-2027");
assert.ok(isValidBatchKey("2027"));
assert.ok(isValidBatchKey("2026-2027"));
assert.ok(!isValidBatchKey("2026-2028"), "academic span must be consecutive years");
assert.ok(!isValidBatchKey("1999"));
assert.ok(!isValidBatchKey("فيزيائيون 2027"), "group names are never accepted as a batch");
assert.deepEqual(["2026", UNASSIGNED_BATCH, "2028", "2027"].sort(compareBatchKeys), ["2028", "2027", "2026", UNASSIGNED_BATCH]);

const base = { status: "submitted", productionStage: "new", delivery: {}, deliveredAt: null };
const students = [
  { ...base, total: 100, paid: 0, remaining: 100 },
  { ...base, total: 100, paid: 40, remaining: 60, productionStage: "tailoring" },
  { ...base, total: 100, paid: 100, remaining: 0, productionStage: "ready" },
  { ...base, total: 100, paid: 100, remaining: 0, productionStage: "delivered", delivery: { status: "delivered" } },
  { ...base, total: 500, paid: 200, remaining: 300, status: "cancelled" },
];
const stats = summarizeStudents(students);
assert.equal(stats.students, 4, "cancelled orders are not counted");
assert.equal(stats.cancelled, 1);
assert.equal(stats.total, 400, "cancelled contract value is excluded from group totals");
assert.equal(stats.paid, 240);
assert.equal(stats.remaining, 160);
assert.deepEqual([stats.unpaid, stats.partial, stats.paidFull], [1, 1, 2]);
assert.equal(stats.produced, 2);
assert.equal(stats.delivered, 1);
assert.equal(stats.productionProgress, 50);
assert.equal(stats.deliveryProgress, 25);
assert.equal(stats.collectionProgress, 60);

const groupA = summarizeStudents(students.slice(0, 2));
const groupB = summarizeStudents(students.slice(2, 4));
const batch = combineStats([groupA, groupB]);
assert.equal(batch.total, groupA.total + groupB.total, "batch totals are the sum of its groups only");
assert.equal(batch.paid, 240);
assert.equal(batch.students, 4);
assert.equal(combineStats([]).total, 0, "an empty batch has zero totals");

assert.equal(paymentPhase({ total: 100, paid: 0, remaining: 100 }), "unpaid");
assert.equal(paymentPhase({ total: 100, paid: 10, remaining: 90 }), "partial");
assert.equal(paymentPhase({ total: 100, paid: 100, remaining: 0 }), "paid");
assert.equal(deliveryPhase({ delivery: {}, deliveredAt: "2026-10-01", productionStage: "ready" }), "delivered");
assert.equal(deliveryPhase({ delivery: { status: "out_for_delivery" }, deliveredAt: null, productionStage: "ready" }), "out_for_delivery");
assert.equal(productionPhase({ status: "submitted", productionStage: "embroidery", delivery: {}, deliveredAt: null }), "in_production");
assert.equal(productionPhase({ status: "cancelled", productionStage: "new", delivery: {}, deliveredAt: null }), "cancelled");

const equipment = studentEquipment({
  ...base, productionStage: "embroidery", styleKey: "american", accessories: ["cap", "sash"],
  customText: { text: "علي حسين" }, measurements: {}, total: 1, paid: 0, remaining: 1,
});
assert.equal(equipment.printing, "done");
assert.equal(equipment.embroidery, "active");
assert.equal(equipment.gown, "done", "the gown is finished once tailoring has passed");
assert.equal(equipment.cap, "pending");
assert.equal(studentEquipment({ ...base, styleKey: null, accessories: [], customText: {}, measurements: {}, total: 1, paid: 0, remaining: 1 }).sash, "na");

console.log("Graduation batch statistics and isolation helpers passed.");
