import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Existing finance regression harnesses evaluate real extracted functions in a
// controlled VM. Supply their new dependency from its REAL source, never a
// no-op allow-all stub and never a runtime DB import.
const classification=ts.createSourceFile("classification.ts",readFileSync(new URL("../../src/server/vehicle-partnership/financial-classification.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
const repository=ts.createSourceFile("repository.ts",readFileSync(new URL("../../src/server/vehicle-partnership/repository.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
const declarations=classification.statements.filter(node=>
 ts.isFunctionDeclaration(node)&&["fail","assertGenericFinancialSourceInput"].includes(node.name?.text)||
 ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text==="isPartnershipFinancialSource"));
const error=repository.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="PartnershipRepositoryError");
assert.equal(declarations.length,3);assert.ok(error);
const text=[error,...declarations].map(node=>node.getText(node===error?repository:classification).replace(/^export\s+/,"")).join("\n");
const code=ts.transpileModule(`${text}\nglobalThis.guard=assertGenericFinancialSourceInput;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const context=vm.createContext({});vm.runInContext(code,context);
export const assertGenericFinancialSourceInput=context.guard;
assert.throws(()=>assertGenericFinancialSourceInput({sourceType:"vehicle_partnership_activity"}),cause=>cause.status===409);
assert.doesNotThrow(()=>assertGenericFinancialSourceInput({sourceType:"graduation_order",transactionType:"graduation_payment"}));
