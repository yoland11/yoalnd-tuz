import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real serializer behind the assignment-scoped tailor detail API.
// The student upload is already stored on the graduation order; this response
// must expose only its placement, note and saved image URL to that detail view.
const source = readFileSync("src/server/tailoring.ts", "utf8");
const ast = ts.createSourceFile("tailoring.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["serializeDetail", "studentReferencesOf", "serializeGroupRow", "sashDetailsOf"]);
const declarations = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map((node) => node.getText(ast));
assert.ok(declarations.some((code) => code.includes("function serializeDetail")), "tailor detail serializer must exist");
const context = vm.createContext({
  rec: (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {},
  serializeSummary: (order) => ({ id: order.id, name: order.customerName }),
  deriveStatus: () => "complete",
  SASH_TYPES: [{ key: "american", label: "أمريكي" }],
  SASH_FONTS: [{ key: "naskh", label: "النسخ" }],
});
const compiled = ts.transpileModule(`${declarations.join("\n")}\nglobalThis.serialize = serializeDetail;\nglobalThis.groupRow = serializeGroupRow;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
vm.runInContext(compiled, context);

function detail(previewAssets) {
  return JSON.parse(JSON.stringify(context.serialize({
    id: 41, customerName: "طالب", styleKey: "royal", packageKey: "gold",
    garmentDetails: {}, customText: {}, accessories: [], colors: {}, measurements: {},
    previewAssets,
  }, null, [])));
}

const references = detail({ studentReferences: [
  { placement: "cap_edge", note: "الاسم على طرف القبعة", imageUrl: "https://assets.example/cap.png", fileName: "cap.png" },
  { placement: "sash_back", note: "خلف الوشاح", imageUrl: "https://assets.example/sash.png" },
  { placement: "other", note: "نص خاص بلا صورة" },
] }).studentReferences;
assert.deepEqual(references, [
  { placement: "cap_edge", note: "الاسم على طرف القبعة", imageUrl: "https://assets.example/cap.png" },
  { placement: "sash_back", note: "خلف الوشاح", imageUrl: "https://assets.example/sash.png" },
  { placement: "other", note: "نص خاص بلا صورة" },
]);
assert.deepEqual(detail({ studentReference: {
  placement: "cap_top", note: "فوق القبعة", imageUrl: "https://assets.example/top.png",
} }).studentReferences, [
  { placement: "cap_top", note: "فوق القبعة", imageUrl: "https://assets.example/top.png" },
]);
assert.deepEqual(detail({ studentReferences: [
  { placement: "other", note: "لا تُرسل بيانات خام", imageUrl: "data:image/png;base64,AAAA", imageData: "private" },
] }).studentReferences, [
  { placement: "other", note: "لا تُرسل بيانات خام" },
]);
assert.deepEqual(detail({}).studentReferences, []);

// Group rows carry the same references plus the sash text, for the group preparation PDF.
const groupRow = (order) => JSON.parse(JSON.stringify(context.groupRow({
  id: 7, studentCode: "G-7", customerName: "سارة علي", qrToken: "q", measurements: {}, studentProfile: {}, productionEstimate: {},
  updatedAt: null, garmentDetails: {}, customText: {}, colors: {}, previewAssets: {}, ...order,
})));
const row = groupRow({
  phone: "07701234567",
  customText: { text: "المهندسة سارة علي", sashType: "american", font: "naskh", embroideryColor: "#d4af37" },
  colors: { sash: "#7b1e3a" },
  previewAssets: { studentReferences: [{ placement: "sash_back", note: "الاسم بخط كبير", imageUrl: "https://assets.example/back.png", imageData: "raw" }] },
});
assert.deepEqual(row.sash, { name: "المهندسة سارة علي", type: "أمريكي", font: "النسخ", color: "#7b1e3a", embroideryColor: "#d4af37" });
assert.equal(row.phone, "07701234567");
assert.equal(row.phone2, "", "a missing second number is an empty string, never undefined");
assert.deepEqual(row.studentReferences, [{ placement: "sash_back", note: "الاسم بخط كبير", imageUrl: "https://assets.example/back.png" }]);
// Older orders: the sash name/type saved in garment details, colours from the sash override.
const legacy = groupRow({ garmentDetails: { sashName: "د. أحمد", sashType: "وشاح كلاسيكي" }, customText: { sashColor: "#000000" } });
assert.deepEqual(legacy.sash, { name: "د. أحمد", type: "وشاح كلاسيكي", font: "", color: "#000000", embroideryColor: "" });
assert.deepEqual(legacy.studentReferences, []);
assert.equal(groupRow({ customText: { text: 42 } }).sash.name, "", "non-text values are never printed as a sash name");
console.log("PASS assigned tailor detail and group rows expose saved student references and the sash text without copying media or leaking raw uploads");
