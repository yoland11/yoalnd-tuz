import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const groupBuilder = readFileSync(
  resolve(root, "src/views/graduation-groups.tsx"),
  "utf8",
);
const studentWizard = readFileSync(
  resolve(root, "src/components/graduation-student-wizard.tsx"),
  "utf8",
);
const measurementStepStart = studentWizard.indexOf("{step === 2 && (");
const sashStepStart = studentWizard.indexOf("{step === 3 && (", measurementStepStart);
const measurementStep = studentWizard.slice(measurementStepStart, sashStepStart);

const checks = [
  [
    "new groups default to showing detailed measurements for backward compatibility",
    /showDetailedMeasurements:\s*true/.test(groupBuilder),
  ],
  [
    "the representative can control whether group students see measurement details",
    /إظهار تفاصيل القياسات للطالب/.test(groupBuilder) &&
      /checked=\{form\.showDetailedMeasurements\}/.test(groupBuilder) &&
      /showDetailedMeasurements:\s*form\.showDetailedMeasurements/.test(groupBuilder),
  ],
  [
    "legacy groups and individual orders continue showing measurement details",
    /scope\s*===\s*["']individual["']\s*\|\|\s*base\.showDetailedMeasurements\s*!==\s*false/.test(
      studentWizard,
    ),
  ],
  [
    "gender choice remains visible when measurement details are hidden",
    /\["male",\s*"رجالي"\][\s\S]*?\["female",\s*"نسائي"\]/.test(
      measurementStep,
    ) &&
      measurementStep.indexOf('"female", "نسائي"') <
        measurementStep.indexOf("showDetailedMeasurements ?"),
  ],
  [
    "size and exact measurements are shown only when the group setting allows them",
    /showDetailedMeasurements\s*\?\s*\([\s\S]*?أدخل قياساتك بالتفصيل[\s\S]*?مقاس البدن[\s\S]*?\)\s*:\s*null/.test(
      measurementStep,
    ),
  ],
];

let failed = false;
for (const [label, passed] of checks) {
  console.log(`${passed ? "✓" : "✗"} ${label}`);
  failed ||= !passed;
}

if (failed) process.exit(1);

// Exercise the form actually used by both validation and submission, including
// an invalid browser draft saved before the representative hides measurements.
const expression = studentWizard.match(/const submissionForm = ([\s\S]*?);/);
assert.ok(expression, "wizard derives a single effective submission form");
const prepare = new Function("form", "showDetailedMeasurements", `return (${expression[1]});`);
const module = { exports: {} };
const compiled = ts.transpileModule(
  readFileSync(resolve(root, "src/lib/graduation-student-flow.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
new Function("module", "exports", compiled)(module, module.exports);
const { newStudent, studentIssue, studentPayload } = module.exports;
const draft = {
  ...newStudent(), customerName: "طالب تجريبي", phone: "07700000000",
  gender: "female", size: "XL", measurements: { height: "invalid", chest: "900" },
};
const hidden = prepare(draft, false);
assert.equal(studentIssue(hidden, 2), undefined);
assert.equal(studentIssue(hidden, 0), undefined);
const payload = studentPayload(hidden, {});
assert.equal(payload.measurements.gender, "female");
assert.equal(payload.measurements.height, undefined);
assert.equal(payload.measurements.chest, undefined);
assert.equal(payload.measurements.readySize, undefined);
assert.equal(payload.customText.preferredSize, "");
assert.equal(draft.measurements.height, "invalid", "keep the draft intact");
assert.equal(prepare(draft, true), draft, "visible measurements preserve existing validation");
assert.ok(studentIssue(prepare(draft, true), 2));
assert.match(studentWizard, /studentIssue\(submissionForm, step\)/);
assert.match(studentWizard, /studentIssue\(submissionForm, index\)/);
assert.match(studentWizard, /studentPayload\(submissionForm, base\)/);
console.log("✓ Hidden draft measurements neither block saving nor enter a new order; visible measurements retain validation.");
console.log("\nGraduation measurement visibility checks passed.");
