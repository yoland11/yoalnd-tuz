import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("src/views/admin/graduation-order-center.tsx", "utf8");
const ast = ts.createSourceFile("graduation-order-center.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fieldsDeclaration = ast.statements.find((node) =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && declaration.name.text === "GROUP_MEASUREMENT_FIELDS"));
assert.ok(fieldsDeclaration, "group measurements need one field list shared by form, table and export");
const context = vm.createContext({});
vm.runInContext(ts.transpileModule(`${fieldsDeclaration.getText(ast)}\nglobalThis.fields = GROUP_MEASUREMENT_FIELDS;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, context);
assert.deepEqual(Array.from(context.fields, (field) => field.key), [
  "robeLength", "sashLength", "sleeveLength", "americanSashBack", "shoulder", "capSize",
], "group measurements must match the student and tailor field order");
assert.deepEqual(Array.from(context.fields, (field) => field.label), [
  "طول روب", "طول وشاح", "طول ردن", "خلف الوشاح الأمريكي", "عرض كتف", "قياس قبعة",
]);

const addStudent = source.slice(source.indexOf("function AddStudentDialog"), source.indexOf("function PaymentDialog"));
const exportExcel = source.slice(source.indexOf("async function exportExcel"), source.indexOf("async function printGroupReceipt"));
const workspace = source.slice(source.indexOf("export function GraduationGroupWorkspace"), source.indexOf("export function GraduationStudentsDirectory"));
assert.match(addStudent, /GROUP_MEASUREMENT_FIELDS\.map/, "staff must be able to enter the six fields when adding a group student");
assert.match(exportExcel, /GROUP_MEASUREMENT_FIELDS\.map/, "Excel must include all six measurements");
assert.match(workspace, /GROUP_MEASUREMENT_FIELDS\.map\(\(field\) => <TableHead/, "desktop measurements table must display each field");
assert.match(workspace, /GROUP_MEASUREMENT_FIELDS\.map\(\(field\) => <TableCell/, "desktop measurements table must edit each field");
assert.match(workspace, /GROUP_MEASUREMENT_FIELDS\.map\(\(field\) => <div/, "mobile measurements card must display each field");
assert.match(workspace, /المقاس المثالي/, "the suggested ideal size must remain visible");
console.log("PASS group admin measurements retain ideal size and expose all six detailed values");
