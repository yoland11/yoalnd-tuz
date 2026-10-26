import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {financialTransactionTotals,formatFinancialTotal} from "../src/lib/financial-transaction-totals";

const source=readFileSync("src/views/admin/master-cash.tsx","utf8");
const tree=ts.createSourceFile("master-cash.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const table=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="TransactionTable");
const display=tree.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(tree)==="movementDisplay"));
assert.ok(table&&display,"execute the real transaction table and its existing legacy display helper");
const footer=()=>null;
const stub=()=>null;
const code=ts.transpileModule(`${display.getText(tree)}\n${table.getText(tree)}\nTransactionTable;`,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const context:Record<string,unknown>={React,financialTransactionTotals,formatFinancialTotal,TableTotalsFooter:footer,Button:stub,History:stub,Check:stub,Pencil:stub,X:stub,Skeleton:stub,EmptyState:stub,STATUS_CLASSES:{},STATUS_LABELS:{},departmentLabel:(value:string)=>value,formatCurrency:(value:unknown)=>String(value)};
const component=vm.runInNewContext(code,context);
function findFooter(node:any):any{
  if(!React.isValidElement(node))return null;
  if(node.type===footer)return node.props;
  for(const child of React.Children.toArray((node.props as any).children)){const found=findFooter(child);if(found)return found;}
  return null;
}
const row=(changes:Record<string,unknown>={})=>({id:1,transactionNo:"F-1",transactionDate:"2026-10-25",direction:"revenue",amount:"100.00",department:"general",transactionType:"payment",description:"",sourceType:"sales_invoice",approvalStatus:"executed",...changes});
function footerValues(rows:Record<string,unknown>[]){
 const props=findFooter(component({rows,loading:false,isManager:false,onOpen:stub,onApprove:stub,onReject:stub,onRequestModification:stub,busy:false}));
 assert.ok(props,"actual table must wire a totals footer");
 const operating=props.cells.find((cell:any)=>cell.key==="direction");
 const cash=props.cells.find((cell:any)=>cell.key==="amount");
 const render=(cell:any)=>renderToStaticMarkup(React.createElement(React.Fragment,null,cell.format(rows.reduce((sum,entry)=>sum+(cell.value?.(entry)??0),0),rows))).replace(/<[^>]*>/g,"");
 return {operating:render(operating),cash:render(cash)};
}
const noncash=row({sourceType:"vehicle_partnership_external",transactionType:"vp_external_attribution",accountingClassification:"partnership_transfer",cashDirection:"noncash",accountingClassificationLabel:"تسوية شراكة / خارج نتيجة التشغيل",cashDirectionLabel:"غير نقدي"});
assert.equal(footerValues([noncash]).cash,"0 د.ع","a noncash attribution cannot become received cash in the real table footer");
assert.equal(footerValues([noncash]).operating,"إيراد 0 د.ع/مصروف 0 د.ع","noncash attribution is not company operating income");
const accrual=row({direction:"expense",sourceType:"vehicle_partnership_cost",transactionType:"vp_driver_accrual",accountingClassification:"expense",cashDirection:"noncash"});
assert.deepEqual(footerValues([accrual]),{operating:"إيراد 0 د.ع/مصروف 100 د.ع",cash:"0 د.ع"});
const reversal={...accrual,direction:"revenue",transactionType:"vp_driver_accrual_reversal",amount:"40.00"};
assert.deepEqual(footerValues([accrual,reversal]),{operating:"إيراد 0 د.ع/مصروف 60 د.ع",cash:"0 د.ع"},"expense reversal reduces expense and never creates revenue");
const settlement=row({direction:"expense",sourceType:"vehicle_partnership_settlement",transactionType:"vp_driver_settlement",accountingClassification:"partnership_transfer",cashDirection:"outflow",amount:"25.00"});
assert.deepEqual(footerValues([settlement]),{operating:"إيراد 0 د.ع/مصروف 0 د.ع",cash:"-25 د.ع"},"actual settlement is cash but not a second expense");
assert.deepEqual(footerValues([row({approvalStatus:"pending"}),row({approvalStatus:"approved"}),row({approvalStatus:"rejected"}),row({approvalStatus:"draft"})]),{operating:"إيراد 0 د.ع/مصروف 0 د.ع",cash:"0 د.ع"},"cash and operating totals require execution");
const loan=row({sourceType:"company_loan",transactionType:"company_loan_received",cashDirectionLabel:"وارد",accountingClassificationLabel:"استلام قرض / التزام"});
const advance=row({direction:"expense",sourceType:"employee_advance",transactionType:"employee_advance",amount:"20.00"});
assert.deepEqual(footerValues([loan,advance,row({amount:"10.00"})]),{operating:"إيراد 10 د.ع/مصروف 0 د.ع",cash:"90 د.ع"},"loans and employee advances remain cash balance-sheet movements");
assert.deepEqual(footerValues([row({direction:"expense",amount:"5.00"}),row({amount:"0.01"}),row({amount:"0.02"})]),{operating:"إيراد 0.03 د.ع/مصروف 5 د.ع",cash:"-4.97 د.ع"},"legacy revenue and expense remain intact with exact decimal totals");
assert.deepEqual(footerValues([row({amount:"99999999999999.99"}),row({amount:"0.02"})]),{operating:"إيراد 100,000,000,000,000.01 د.ع/مصروف 0 د.ع",cash:"100,000,000,000,000.01 د.ع"},"the actual footer must not round aggregated decimal strings through Number");
assert.equal(formatFinancialTotal("-0.01"),"-0.01 د.ع");
for(const bad of [{...noncash,cashDirection:undefined},{...noncash,accountingClassification:undefined},row({amount:"oops"})]){
 const totals=footerValues([bad]);
 assert.match(totals.operating,/غير متاح/);assert.match(totals.cash,/غير متاح/,"invalid classification must not silently become zero or crash rendering");
}
const pure=financialTransactionTotals([accrual,reversal,settlement] as any,()=>false);
assert.deepEqual(pure,{complete:true,revenue:"0.00",expenses:"60.00",cash:"-25.00"});
console.log("PASS actual master-cash footer and exact client totals: noncash, accrual/reversal, settlements, pending approval, legacy loans/advances, large IQD, incomplete classification.");
