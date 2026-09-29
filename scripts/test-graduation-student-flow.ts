import assert from "node:assert/strict";
import * as flow from "../src/lib/graduation-student-flow";

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
console.log(
  "Graduation student isolation, payload, validation and legacy customization passed.",
);
