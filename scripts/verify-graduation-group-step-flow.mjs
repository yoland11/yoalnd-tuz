import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(
  resolve(root, "src/views/graduation-groups.tsx"),
  "utf8",
);
const rail = readFileSync(
  resolve(root, "src/components/graduation-step-rail.tsx"),
  "utf8",
);

const assertions = [
  [
    "group builder has one step rendering source",
    source.includes("const renderCurrentStep = () =>") &&
      source.includes("{renderCurrentStep()}"),
  ],
  [
    "every graduation step has an explicit render branch",
    Array.from({ length: 11 }, (_, step) => `case ${step}:`).every((branch) =>
      source.includes(branch),
    ),
  ],
  [
    "shared template is not rendered across a range of steps",
    !source.includes("step >= 2 && step <= 7") &&
      !source.includes("القالب المشترك المقفل"),
  ],
  [
    "fabric, printing, text, accessory, and additional-service panels are separated",
    [
      "اختر نوع القماش الموحد للروب",
      "طريقة الشعار",
      "النصوص المشتركة",
      "إكسسوارات التخرج",
      "خدمات اختيارية للمجموعة، ولا تعيد إعدادات الروب أو الطباعة",
    ].every((text) => source.includes(text)),
  ],
  [
    "group selections stay in one form state and are persisted",
    source.includes("const [form, setForm] = useState(initialGroup)") &&
      source.includes("extras: form.extras") &&
      source.includes("customGraduationText"),
  ],
  [
    "next, previous, and rail navigation share the same step state",
    source.includes("<GraduationStepRail current={step} onStepChange={setStep} />") &&
      source.includes("const next = ()") &&
      source.includes("const previous = ()"),
  ],
  [
    "the shared rail remains backward compatible and supports direct navigation",
    rail.includes("onStepChange?: (step: number) => void") &&
      rail.includes("onClick={() => onStepChange(index)}"),
  ],
];

let failed = false;
for (const [label, passed] of assertions) {
  console.log(`${passed ? "✓" : "✗"} ${label}`);
  failed ||= !passed;
}

if (failed) process.exit(1);
console.log("\nGraduation group step-flow checks passed.");
