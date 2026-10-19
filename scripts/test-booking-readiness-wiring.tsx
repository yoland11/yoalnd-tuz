import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import * as icons from "lucide-react";
import {Button} from "../src/components/ui/button";
import {formatCurrency} from "../src/views/admin/_lib";
(globalThis as any).React=React;
function extract(file:string,name:string,context:Record<string,unknown>={}) {
  const ast=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;
  const source=ts.transpileModule(node.getText(ast),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const c=vm.createContext({React,Button,formatCurrency,...icons,...context});vm.runInContext(source,c);return c[name] as (...args:any[])=>any;
}
let failures=0;
for(const [name,run] of [
  ["list readiness must not rise when only payment or service status changes",()=>{
    const get=extract("src/views/admin/booking-center.tsx","getReadiness");
    const base={services:[{status:"waiting"}],paid:0,total:500,remaining:500};
    assert.equal(get(base),null,"no operational evidence means unassessed, not a guessed number");
    assert.equal(get({...base,paid:500,remaining:0,contractNumber:"C1",services:[{status:"finished"}]}),null);
    assert.equal(get({...base,operationalReadiness:{status:"not_ready",percentage:33}}),33);
  }],
  ["workspace cards must not use guessed products/assets/warehouse percentages",()=>{
    const Summary=extract("src/views/admin/booking-operations-workspace.tsx","OperationsSummary");
    const html=renderToStaticMarkup(Summary({data:{warehouseStage:"out",readinessParts:{products:100,assets:100},counts:{alerts:0},alerts:[]},booking:{paymentStatus:"unpaid",remaining:500},onTab:()=>{},readiness:{categories:{equipment:{percentage:20},staff:{percentage:0},transport:{percentage:0}}}}));
    assert.doesNotMatch(html,/100%|80%|60%/);assert.match(html,/20%/);assert.match(html,/فحوص المعدات/);
  }]
] as const) {try{run();console.log(`PASS ${name}`)}catch(cause){failures++;console.error(`FAIL ${name}`,cause)}}
assert.equal(failures,0);
