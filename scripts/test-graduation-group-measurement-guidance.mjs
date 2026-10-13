import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const individual = readFileSync("src/views/graduation.tsx", "utf8");
const group = readFileSync("src/components/graduation-student-wizard.tsx", "utf8");
const shared = readFileSync("src/lib/graduation-student-flow.ts", "utf8");

for (const key of ["robeLength", "sashLength", "sleeveLength", "americanSashBack", "shoulder", "capSize"])
  assert.match(shared, new RegExp(`${key}: ".+"`), `${key} must have one shared measurement instruction`);
assert.match(individual, /MEASUREMENT_HELP\[key\]/, "individual guidance must use the shared instructions");
assert.match(group, /MEASUREMENT_HELP\[key\]/, "group guidance must match the individual flow");
assert.match(group, /showDetailedMeasurements \? \(/, "representative's show/hide choice must remain effective");
assert.match(group, /form\.size === size/, "ideal/ready size selection must remain in group measurements");

console.log("PASS individual and group measurement guidance with representative visibility and ideal size");
