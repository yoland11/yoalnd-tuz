import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GraduationReferenceImagePicker } from "../src/components/graduation-reference-image-picker";
import * as flow from "../src/lib/graduation-student-flow";
import { graduationOrderInputSchema } from "../src/lib/graduation";

// The upload affordance must be Arabic while the real file input remains
// associated with its label for keyboard and assistive-technology access.
Object.assign(globalThis, { React });
const picker = renderToStaticMarkup(React.createElement(GraduationReferenceImagePicker, {
  id: "student-reference-image-test",
  fileName: "",
  busy: false,
  disabled: false,
  onSelect: () => {},
}));
assert.match(picker, /اختيار صورة/);
assert.match(picker, /لم تُختر صورة/);
assert.match(picker, /type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
assert.match(picker, /type="file"[^>]*sr-only/);
assert.match(picker, /role="status"/);
const selectedPicker = renderToStaticMarkup(React.createElement(GraduationReferenceImagePicker, {
  id: "student-reference-image-test",
  fileName: "cap.png",
  busy: false,
  disabled: true,
  onSelect: () => {},
}));
assert.match(selectedPicker, /تغيير الصورة/);
assert.match(selectedPicker, /cap\.png/);
assert.match(selectedPicker, /disabled=""/);

assert.equal(
  typeof flow.newStudent,
  "function",
  "a new student must start independently",
);
assert.deepEqual(
  flow.SASH_TYPES.map(({ key, images }) => [key, images.length]),
  [
    ["standard", 1],
    ["side", 1],
    ["royal", 2],
    ["american", 2],
  ],
  "sash chooser should show a single model for standard/side and front/back models for royal/American",
);
assert.ok(
  flow.SASH_TYPES.every((type) => type.description.trim().length > 12),
  "each sash model should explain its cut",
);
const first = flow.newStudent();
first.customerName = "علي أحمد";
first.phone = "07712345678";
first.sashName = "عَلِيّ";
first.size = "XS";
first.flowers.push({ productId: 12, quantity: 2, name: "ورد" });
const second = flow.newStudent();
assert.equal(
  flow.studentPayload(second, { extras: { photography: { serviceId: 7 } } })
    .extras.photography,
  null,
  "new student must not inherit a photography booking",
);
const oldSeed = flow.newStudent();
const editedSeed = { ...oldSeed, sashColor: "#AA2233" };
const restored = flow.restoreStudentDraft(
  { ...oldSeed, customerName: "علي" },
  oldSeed,
  editedSeed,
);
assert.equal(
  restored.sashColor,
  "#AA2233",
  "outer configurator edits must replace stale draft selections",
);
assert.equal(
  restored.customerName,
  "علي",
  "unrelated personal draft edits must survive",
);
const measuredSeed = { ...oldSeed, measurements: { height: "170", chest: "" } };
assert.deepEqual(
  flow.restoreStudentDraft(
    { ...measuredSeed, measurements: { height: "170", chest: "95" } },
    measuredSeed,
    { ...measuredSeed, measurements: { height: "175", chest: "" } },
  ).measurements,
  { height: "175", chest: "95" },
);
assert.equal(second.customerName, "");
assert.deepEqual(second.flowers, []);
assert.notEqual(first.measurements, second.measurements);
const payload = flow.studentPayload(first, {
  groupToken: "group-a",
  colors: { robe: "#123456" },
  fabric: { key: "standard" },
});
assert.equal(payload.groupToken, "group-a");
assert.equal(payload.customText.text, "عَلِيّ");
assert.equal(payload.measurements.readySize, "XS");
assert.equal(payload.measurements.method, "ready");
assert.equal(payload.colors.robe, "#123456");
assert.equal(payload.extras.flowers[0].quantity, 2);
const legacyStudentWithUniversityNumber = Object.assign(flow.newStudent(), {
  studentId: "UNI-123",
});
const withoutUniversityNumber = flow.studentPayload(
  legacyStudentWithUniversityNumber,
  { customText: { studentId: "UNI-456", department: "الحاسبات" } },
);
assert.equal(
  "studentId" in withoutUniversityNumber.customText,
  false,
  "new student registrations must not include a university number from old drafts or base data",
);
assert.equal(flow.studentIssue(first, 0), undefined);
assert.ok(flow.studentIssue(second, 0));
first.measurements.height = "2";
assert.ok(flow.studentIssue(first, 2));
first.measurements.height = "";
assert.equal(flow.studentIssue(first, 2), undefined);
const merged = flow.studentSashOverrides({
  sashType: "royal",
  sashColor: "#222222",
  embroideryColor: "#D4AF37",
  font: "thuluth",
});
assert.equal(merged.sashColor, "#222222");
assert.deepEqual(flow.studentSashOverrides({}), {});
assert.deepEqual(
  flow.studentSashOverrides({ sashColor: "url(evil)", sashType: "other" }),
  {},
);
const legacySashPolicy = flow.resolveGroupSashPolicy({});
assert.equal(
  legacySashPolicy.mode,
  "per_student",
  "groups without a policy must preserve the existing individual-choice behavior",
);
const fixedSashPolicy = flow.resolveGroupSashPolicy({
  sashSelectionMode: "fixed",
  sashType: "royal",
  colors: { sash: "#AA2233", embroidery: "#C0C0C0" },
});
assert.deepEqual(fixedSashPolicy, {
  mode: "fixed",
  sashType: "royal",
  sashColor: "#AA2233",
  embroideryColor: "#C0C0C0",
});
assert.deepEqual(
  flow.studentSashOverrides(
    { sashType: "american", sashColor: "#FFFFFF", embroideryColor: "#D4AF37", font: "thuluth" },
    fixedSashPolicy,
  ),
  { sashType: "royal", sashColor: "#AA2233", embroideryColor: "#C0C0C0", font: "thuluth" },
  "fixed group policy must override submitted type and both colors but retain personal font",
);
const perStudentSashPolicy = flow.resolveGroupSashPolicy({
  sashSelectionMode: "per_student",
  colors: { sash: "#AA2233", embroidery: "#C0C0C0" },
});
assert.deepEqual(
  flow.studentSashOverrides(
    { sashType: "american", sashColor: "#FFFFFF", embroideryColor: "#D4AF37" },
    perStudentSashPolicy,
  ),
  { sashType: "american", sashColor: "#AA2233", embroideryColor: "#C0C0C0" },
  "student may choose the sash type but not the representative's colors",
);
assert.deepEqual(
  flow.studentSashOverrides(
    { sashType: "american", sashColor: "#FFFFFF", embroideryColor: "#D4AF37" },
    flow.resolveGroupSashPolicy({ sashSelectionMode: "per_student" }),
  ),
  { sashType: "american", sashColor: "#FFFFFF", embroideryColor: "#D4AF37" },
  "legacy groups without representative colors must retain their existing customization",
);
const fixedPayload = flow.studentPayload(
  { ...first, sashType: "american", sashColor: "#FFFFFF", embroideryColor: "#D4AF37" },
  {
    groupToken: "group-a",
    sashSelectionMode: "fixed",
    sashType: "royal",
    colors: { robe: "#123456", sash: "#AA2233", embroidery: "#C0C0C0" },
  },
);
assert.equal(fixedPayload.customText.sashType, "royal");
assert.equal(fixedPayload.customText.sashColor, "#AA2233");
assert.equal(fixedPayload.colors.sash, "#AA2233");
assert.equal(fixedPayload.customText.embroideryColor, "#C0C0C0");
assert.equal(fixedPayload.colors.embroidery, "#C0C0C0");
const personalGroupPayload = flow.studentPayload(
  { ...first, sashType: "american", sashColor: "#FFFFFF", embroideryColor: "#D4AF37" },
  {
    groupToken: "group-a",
    sashSelectionMode: "per_student",
    colors: { sash: "#AA2233", embroidery: "#C0C0C0" },
  },
);
assert.equal(personalGroupPayload.customText.sashType, "american");
assert.equal(personalGroupPayload.colors.sash, "#AA2233");
assert.equal(personalGroupPayload.colors.embroidery, "#C0C0C0");
const personalPayload = flow.studentPayload(
  { ...first, sashType: "american", sashColor: "#FFFFFF" },
  {},
);
assert.equal(personalPayload.customText.sashType, "american");
assert.equal(personalPayload.colors.sash, "#FFFFFF");
const referenceImage = "data:image/png;base64,AAAA";
const referencePayload = flow.studentPayload(
  {
    ...first,
    referencePlacement: "cap_top",
    referenceNote: "ثبت الزهرة بالمنتصف",
    referenceImage,
    referenceFileName: "cap.png",
  },
  { groupToken: "group-a" },
);
assert.deepEqual(referencePayload.studentReference, {
  placement: "cap_top",
  note: "ثبت الزهرة بالمنتصف",
  imageData: referenceImage,
  fileName: "cap.png",
});
assert.equal(
  flow.studentIssue({ ...first, referencePlacement: "other", referenceNote: "" }, 3),
  "اكتب ملاحظة توضّح الموضع الآخر",
);
assert.equal(
  flow.studentIssue({ ...first, referenceImage, referencePlacement: "" }, 3),
  "حدد موضع الصورة أو الملاحظة",
);
assert.equal(flow.studentPayload(first, { groupToken: "group-a" }).studentReference, undefined);
const untrustedPreviewPayload = flow.studentPayload(first, {
  groupToken: "group-a",
  previewAssets: {
    robe: "existing-preview",
    studentReference: { imageUrl: "javascript:alert(1)" },
  },
});
assert.deepEqual(untrustedPreviewPayload.previewAssets, { robe: "existing-preview" });
const orderInput = {
  customerName: "علي أحمد",
  phone: "07712345678",
  styleKey: "standard",
  fabric: { key: "standard" },
};
assert.equal(
  graduationOrderInputSchema.safeParse({
    ...orderInput,
    studentReference: { placement: "other", note: "" },
  }).success,
  false,
  "other placement requires a note",
);
assert.equal(
  graduationOrderInputSchema.safeParse({
    ...orderInput,
    studentReference: { placement: "cap_top", note: "", imageData: referenceImage },
  }).success,
  true,
  "a reference image and a known placement are valid without a note",
);
assert.equal(
  graduationOrderInputSchema.safeParse({
    ...orderInput,
    studentReference: { placement: "cap_top", imageData: "https://example.com/private.jpg" },
  }).success,
  false,
  "student reference upload must not accept an arbitrary remote URL",
);
console.log(
  "Graduation student isolation, payload, validation and legacy customization passed.",
);
