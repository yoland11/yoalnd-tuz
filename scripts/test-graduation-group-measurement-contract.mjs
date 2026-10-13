import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = readFileSync("src/server/graduation-operations.ts", "utf8");
const ast = ts.createSourceFile("graduation-operations.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find((node) =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) =>
    ts.isIdentifier(entry.name) && entry.name.text === "studentPatchSchema"));
const formatter = ast.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "formatStudent");
assert.ok(declaration && formatter, "group student schema and formatter must exist");

const context = vm.createContext({
  z,
  studentIdentity: () => ({}),
  record: (value) => value && typeof value === "object" ? value : {},
  getGraduationMeasurementFilter: () => "complete",
  amount: (value) => Number(value || 0),
});
vm.runInContext(ts.transpileModule(
  `${declaration.getText(ast)}\n${formatter.getText(ast)}\nglobalThis.schema = studentPatchSchema; globalThis.format = formatStudent;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText, context);

const measurements = {
  robeLength: 140, sashLength: 120, sashWidth: 14,
  americanSashBack: 42, shoulder: 46, capSize: 58,
};
const parsed = context.schema.parse(measurements);
assert.equal(parsed.sashWidth, 14, "admin updates must validate sash width as a number");
assert.equal(context.schema.parse({ sleeveLength: 61 }).sleeveLength, 61, "admin updates must accept current sleeve length");
assert.equal(context.schema.safeParse({ sleeveLength: 200 }).success, false, "out-of-range sleeve length must be rejected");
assert.equal(context.schema.safeParse({ sashWidth: 200 }).success, false, "out-of-range sash width must be rejected");
assert.equal(context.schema.safeParse({ robeLength: 300 }).success, false, "out-of-range robe length must be rejected");
for (const key of Object.keys(measurements))
  assert.equal(context.schema.parse({ [key]: null })[key], null, `${key} must preserve an explicit clear instead of coercing it to zero`);

const formatted = context.format({
  id: 1, qrToken: "token", groupId: 7, customerName: "طالب",
  studentProfile: { size: "M" }, measurements,
});
for (const [key, value] of Object.entries(measurements))
  assert.equal(formatted[key], value, `group detail must expose saved ${key}`);
assert.equal(formatted.size, "M", "ideal/ready size must stay visible alongside detailed measurements");

const legacy = context.format({
  id: 2, qrToken: "legacy", groupId: 7, customerName: "قديم",
  measurements: { height: 175, chest: 95, suggestedSize: "48" },
});
assert.equal(legacy.size, "48", "legacy size must remain visible");
assert.equal(legacy.sashWidth, "", "historical students without new fields must load");
assert.equal(context.format({ id: 3, measurements: { sleeveLength: 61 } }).sleeveLength, 61, "group detail must expose current sleeve length");

const core = readFileSync("src/server/graduation.ts", "utf8");
const coreAst = ts.createSourceFile("graduation.ts", core, ts.ScriptTarget.Latest, true);
for (const functionName of ["graduationMeasurementCompleteCondition", "graduationMeasurementNoneCondition"]) {
  const fn = coreAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === functionName);
  assert.ok(fn, `${functionName} must exist`);
  const text = fn.getText(coreAst);
  for (const key of Object.keys(measurements))
    assert.ok(text.includes(`->>'${key}'`), `${functionName} must filter on ${key}`);
}

console.log("PASS group student measurement schema, formatter, legacy size, and admin filters");
