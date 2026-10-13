import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getGraduationMeasurementStatus,
  withGraduationMeasurementStatus,
} from "../src/lib/graduation-measurements";

const detailed = {
  robeLength: 145,
  sashLength: 110,
  sleeveLength: 61,
  americanSashBack: 42,
  shoulder: 44,
  capSize: 57,
};

assert.equal(getGraduationMeasurementStatus({}), "not_started");
assert.equal(getGraduationMeasurementStatus({ gender: "male" }), "not_started");
assert.equal(getGraduationMeasurementStatus({ sashWidth: 18 }), "partial");
assert.equal(getGraduationMeasurementStatus({ robeLength: 145 }), "partial");
assert.equal(
  getGraduationMeasurementStatus({ ...detailed, americanSashBack: undefined }),
  "partial",
);
assert.equal(getGraduationMeasurementStatus(detailed), "complete");
assert.equal(withGraduationMeasurementStatus(detailed).status, "complete");
assert.equal(getGraduationMeasurementStatus({ ...detailed, sleeveLength: undefined, sashWidth: 18 }), "complete");

// Historical orders and ready/ideal-size selections must retain their status.
assert.equal(
  getGraduationMeasurementStatus({
    height: 175, shoulder: 44, chest: 98, waist: 82, sleeveLength: 61,
  }),
  "complete",
);
assert.equal(getGraduationMeasurementStatus({ method: "ready", readySize: "M" }), "complete");
assert.equal(getGraduationMeasurementStatus({ method: "ready", standardSize: "48" }), "complete");
assert.equal(getGraduationMeasurementStatus({ method: "ready", readySize: "", standardSize: "48" }), "complete");
assert.equal(getGraduationMeasurementStatus({ status: "approved" }), "complete");

// The tailor's shared intake SQL must recognise the same detailed field set.
const tailoringSource = readFileSync("src/server/tailoring.ts", "utf8");
const intakePredicate = tailoringSource
  .split("function pendingMeasurementsCondition() {")[1]
  ?.split("function visibleCondition(")[0];
assert.ok(intakePredicate, "tailor intake predicate must exist");
for (const key of Object.keys(detailed)) {
  assert.ok(intakePredicate.includes(`->>'${key}'`), `tailor intake must recognise ${key}`);
}

console.log("PASS graduation detailed measurements, legacy measurements, and ready sizes classify correctly");
