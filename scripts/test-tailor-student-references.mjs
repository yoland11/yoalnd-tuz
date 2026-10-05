import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real serializer behind the assignment-scoped tailor detail API.
// The student upload is already stored on the graduation order; this response
// must expose only its placement, note and saved image URL to that detail view.
const source = readFileSync("src/server/tailoring.ts", "utf8");
const ast = ts.createSourceFile("tailoring.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["serializeDetail", "studentReferencesOf"]);
const declarations = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map((node) => node.getText(ast));
assert.ok(declarations.some((code) => code.includes("function serializeDetail")), "tailor detail serializer must exist");
const context = vm.createContext({
  rec: (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {},
  serializeSummary: (order) => ({ id: order.id, name: order.customerName }),
});
const compiled = ts.transpileModule(`${declarations.join("\n")}\nglobalThis.serialize = serializeDetail;`, {
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
console.log("PASS assigned tailor detail exposes saved student references without copying media or leaking raw uploads");
