import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const serverSource = readFileSync("src/server/tailoring.ts", "utf8");
const serverAst = ts.createSourceFile("tailoring.ts", serverSource, ts.ScriptTarget.Latest, true);
const requiredFunctions = new Set(["rec", "deriveStatus", "buildNextMeasurements", "serializeGroupRow"]);
const requiredVariables = new Set(["MEASUREMENT_NUMERIC_KEYS", "MEASUREMENT_TEXT_KEYS", "TAILOR_MEASUREMENT_STATUSES"]);
const declarations = serverAst.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && requiredFunctions.has(node.name?.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) =>
    ts.isIdentifier(decl.name) && requiredVariables.has(decl.name.text))),
).map((node) => node.getText(serverAst));
const context = vm.createContext({
  getGraduationMeasurementStatus: () => "partial",
});
vm.runInContext(ts.transpileModule(
  `${declarations.join("\n").replace(/\bexport\s+(?=(?:const|function)\b)/g, "")}\nglobalThis.build = buildNextMeasurements; globalThis.row = serializeGroupRow;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText, context);

const user = { fullName: "خياط", username: "tailor" };
const measurements = context.build({ robeLength: 145 }, { sashLength: "110", sashWidth: "18", americanSashBack: "42" }, user);
assert.equal(measurements.robeLength, 145, "legacy measurements must survive a partial sash edit");
assert.equal(measurements.sashLength, 110, "sash length must be stored as a number");
assert.equal(measurements.sashWidth, 18, "sash width must be stored as a number");
assert.equal(measurements.americanSashBack, 42, "American sash back must be stored as a number");
const row = context.row({
  id: 12, studentCode: "ST-12", customerName: "طالب", measurements,
  productionEstimate: {}, updatedAt: new Date("2026-10-11T00:00:00Z"),
});
assert.equal(row.sashLength, 110, "group table must expose saved sash length");
assert.equal(row.sashWidth, 18, "group table must expose saved sash width");
assert.equal(row.americanSashBack, 42, "group table must expose saved American sash back");
const legacy = context.row({
  id: 13, studentCode: "ST-13", customerName: "قديم", measurements: {},
  productionEstimate: {}, updatedAt: new Date("2026-10-11T00:00:00Z"),
});
assert.equal(legacy.sashLength, "", "old orders without sash length must remain readable");
assert.equal(legacy.sashWidth, "", "old orders without sash measurements must remain readable");
assert.equal(legacy.americanSashBack, "", "old orders without American sash back must remain readable");

const viewSource = readFileSync("src/views/staff/tailors/index.tsx", "utf8");
const viewAst = ts.createSourceFile("tailors.tsx", viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewVariables = new Set(["NUMERIC_FIELDS", "EDIT_COLS", "CSV_HEAD", "EXCEL_COLUMNS"]);
const viewDeclarations = viewAst.statements.filter((node) => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some((decl) => ts.isIdentifier(decl.name) && viewVariables.has(decl.name.text)))
  .map((node) => node.getText(viewAst));
const viewContext = vm.createContext({});
vm.runInContext(ts.transpileModule(
  `${viewDeclarations.join("\n")}\nglobalThis.fields = NUMERIC_FIELDS; globalThis.columns = EDIT_COLS; globalThis.csv = CSV_HEAD; globalThis.excel = EXCEL_COLUMNS;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText, viewContext);
for (const [key, label] of [["sashLength", "طول وشاح"], ["sashWidth", "عرض الوشاح"], ["americanSashBack", "خلف الوشاح الأمريكي"]]) {
  assert.equal(viewContext.fields.find((field) => field.key === key)?.label, label, `${key} must be editable on order details`);
  assert.equal(viewContext.columns.find((column) => column.key === key)?.label, label, `${key} must be editable in group table`);
  assert.ok(viewContext.csv.includes(key), `${key} must be exported to CSV`);
  assert.ok(viewContext.excel.includes(key), `${key} must be exported to Excel`);
}

console.log("PASS tailor saves and displays all three sash measurements while legacy orders remain readable");
