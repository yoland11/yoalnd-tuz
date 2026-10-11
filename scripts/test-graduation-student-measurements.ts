import assert from "node:assert/strict";
import { graduationMeasurementsSchema } from "../src/lib/graduation";
import { MEASUREMENTS, newStudent, studentPayload } from "../src/lib/graduation-student-flow";

assert.deepEqual(MEASUREMENTS.map(([key]) => key), ["robeLength", "sashLength", "sashWidth", "americanSashBack", "shoulder", "capSize"]);

const student = newStudent();
student.customerName = "محمد علي";
student.phone = "07701234567";
student.measurements = {
  robeLength: "140", sashLength: "120", sashWidth: "14", americanSashBack: "42", shoulder: "46", capSize: "58",
  height: "175", // A saved historical value must survive a later student edit.
};
const payload = studentPayload(student, { previewAssets: {}, colors: {}, customText: {} });
assert.deepEqual(
  Object.fromEntries(["robeLength", "sashLength", "sashWidth", "americanSashBack", "shoulder", "capSize", "height"].map((key) => [key, payload.measurements[key]])),
  { robeLength: 140, sashLength: 120, sashWidth: 14, americanSashBack: 42, shoulder: 46, capSize: 58, height: 175 },
);
assert.equal(payload.phone, student.phone);
assert.equal(graduationMeasurementsSchema.parse(payload.measurements).capSize, 58);
assert.equal(graduationMeasurementsSchema.safeParse({ capSize: 500 }).success, false);
assert.equal(graduationMeasurementsSchema.safeParse({ sashWidth: 500 }).success, false);

console.log("Graduation student measurement fields and legacy values verified.");
