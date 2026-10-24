// Real original list components + real AJN CSS/primitives; API IO controlled.
// Never connects to Production or PostgreSQL. Optional installed browser runtime.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {realpathSync} from "node:fs";
import {readFile, mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve} from "node:path";
const runtime = process.env.AJN_BROWSER_RUNTIME;
assert.ok(runtime, "Set AJN_BROWSER_RUNTIME to installed Playwright package.json");
const {chromium} = createRequire(runtime)("playwright");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css = (await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), {from:resolve("src/index.css")})).css;
const student = {id:42,groupId:8,orderNo:"GR-42",customerName:"أحمد محمد عبد الرحمن حسين",studentCode:"GR-ST-42",barcodeValue:"GR-ST-42",receiptNo:"REC-42",phone:"07700000000",phone2:"",gender:"male",size:"M",measurementStatus:"none",accessories:[],accessoryItems:[],total:60000,totalAmount:60000,paid:0,remaining:60000,discount:0,paymentStatus:"unpaid",designStatus:"waiting_preview",productionStage:"waiting",deliveryStatus:"pending",status:"pending",stageLabel:"بانتظار التجهيز",sashType:"royal",trackingUrl:"#"};
const names = [
 ["long", "أحمد محمد عبد الرحمن حسين عبد الله محمود مصطفى علي إبراهيم حسن يوسف كريم خالد عمر ".repeat(4).trim()],
 ["normal", student.customerName],
];
// Opt-in negative checks change only the in-memory test bundle, never repo code.
// Each must fail: Escape swallowed, or a long name made non-wrapping/clipped.
const mutation = process.env.AJN_ARCHIVE_TEST_MUTATION || "";
assert.ok(["", "swallow-escape", "nowrap-name", "clip-name"].includes(mutation), "Unknown archive test mutation");
const archiveMutationPlugin = {name:"archive-negative-check", setup(build) {
 if(!mutation)return;
 build.onLoad({filter:/[\\/]views[\\/]admin[\\/]graduation-archive\.tsx$/},async ({path})=>{
  const original=await readFile(path,"utf8");
  const contents=mutation==="swallow-escape"
   ? original.replace('<AlertDialogContent dir="rtl"', '<AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()} dir="rtl"')
   : mutation==="nowrap-name"
    ? original.replace('<strong className="break-words">', '<strong className="whitespace-nowrap">')
    : original.replace('<strong className="break-words">', '<strong style={{maxHeight:"1.5rem",overflow:"hidden",display:"block"}} className="break-words">');
  assert.notEqual(contents,original,"Negative check must alter the intended production behavior in memory");
  return {contents,loader:"tsx"};
 });
}};
const bundle = await esbuild.build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TooltipProvider} from './src/components/ui/tooltip';
import {Orders} from './src/views/admin/graduation';import {GraduationGroupWorkspace} from './src/views/admin/graduation-order-center';
const mode=new URLSearchParams(location.search).get('mode');
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><TooltipProvider>{mode==='group'?<GraduationGroupWorkspace groupId={8} onBack={()=>{}}/>:<Orders individualOnly={mode==='individual'}/>}</TooltipProvider></QueryClientProvider>);`,resolveDir:process.cwd(),loader:"tsx"},plugins:[archiveMutationPlugin,{name:"test-only-orders-export",setup(build){build.onLoad({filter:/[\\/]views[\\/]admin[\\/]graduation\.tsx$/},async ({path})=>({contents:await readFile(path,"utf8")+"\nexport {Orders};",loader:"tsx"}));}}],bundle:true,write:false,outdir:".next/graduation-archive-browser",platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"development"'}});
const javascript = bundle.outputFiles.find(file=>file.path.endsWith(".js")).text;
const output = "output/graduation-archive-ui";await mkdir(output,{recursive:true});
const server = createServer((req,res)=>{
 if(req.url==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(javascript);}
 else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);}
 else {res.setHeader("Content-Type","text/html;charset=utf-8");res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto;min-width:0"></main><script src="/fixture.js"></script></body></html>');}
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.AJN_BROWSER_EXECUTABLE||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
try {for(const [nameCase,customerName] of names)for(const width of [1440,768,390])for(const mode of ["group","individual","mixed"]){
 const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:"ajn_admin_session",value:"archive-fixture",url:origin}]);const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors=[],writes=[];let archived=false,blocked=true,delay=false,release,arrived;let pending=Promise.resolve(),arrival=Promise.resolve();
 page.on("pageerror",error=>errors.push(error.message));
 const row={...student,customerName,groupId:mode==="individual"?null:8};
 await page.route("**/api/**",async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(req.method()==="DELETE"){
   writes.push(path);if(delay){arrived();await pending;}
   assert.equal(path,mode==="individual"?"/api/admin/graduation/orders/42":"/api/admin/graduation/groups/8/students/42");
   if(blocked)return route.fulfill({status:409,json:{message:"لا يمكن الأرشفة: توجد دفعة معلقة",code:"CONFLICT",requestId:"REQ-archive-fixture"}});
   archived=true;return route.fulfill({json:{archived:true}});
  }
  assert.equal(req.method(),"GET","archive fixture permits no other mutation");
  if(path.endsWith("/auth/me"))return route.fulfill({json:{user:{id:1,role:"staff",isActive:true,permissions:["graduation.student.delete","graduation.delete"]}}});
  if(path.endsWith("/groups/8"))return route.fulfill({json:{group:{id:8,title:"مجموعة التخرج",groupNo:"GROUP-8",defaultConfiguration:{}},students:archived?[]:[row],totals:{students:archived?0:1,orderValue:60000,paid:0,remaining:60000},sizeDistribution:{M:1},duplicates:[],missingData:[],materialRequirements:{},shortages:[]}});
  if(path.endsWith("/orders"))return route.fulfill({json:{items:archived?[]:[row]}});
  if(path.endsWith("/templates"))return route.fulfill({json:{items:[]}});
  if(path.endsWith("/settings/public"))return route.fulfill({json:{}});
  throw Error(`Unhandled fixture API ${path}`);
 });
 try {
  await page.goto(`${origin}/admin/graduation/orders?mode=${mode}`,{waitUntil:"networkidle"});
  const mobile=mode==="group"&&width<768;
  const action=()=>mobile?page.getByRole("button",{name:"إلغاء وأرشفة طلب هذا الطالب فقط",exact:true}):page.getByRole("button",{name:`أرشفة طلب ${customerName}`,exact:true});
  const restoredFocus=()=>page.waitForFunction(({mobile,name})=>document.activeElement?.tagName==="BUTTON"&&(mobile?document.activeElement.textContent.includes("إلغاء وأرشفة طلب هذا الطالب فقط"):document.activeElement.getAttribute("aria-label")===`أرشفة طلب ${name}`),{mobile,name:customerName},{timeout:2000});
  await action().waitFor();assert.equal(writes.length,0);
  await action().click();const dialog=page.getByRole("alertdialog");await dialog.waitFor();
  if(mode!=="individual")await dialog.getByText(/لن تُمسح المجموعة أو دفعاتها/).waitFor();
  await dialog.getByText(customerName,{exact:true}).waitFor();
  assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1),false,`confirmation horizontal overflow ${nameCase}/${width}/${mode}`);
  assert.equal(await dialog.getByText(customerName,{exact:true}).evaluate(element=>{
   const box=element.getBoundingClientRect(), range=document.createRange();range.selectNodeContents(element);
   const text=range.getBoundingClientRect();
   return element.scrollHeight<=element.clientHeight+1&&element.scrollWidth<=element.clientWidth+1&&
    text.left>=box.left-1&&text.right<=box.right+1&&text.top>=box.top-1&&text.bottom<=box.bottom+1;
  }),true,`customer name must render fully without clipping ${nameCase}/${width}/${mode}`);
  const cancel=dialog.getByRole("button",{name:"رجوع بدون أرشفة",exact:true});
  const confirm=dialog.getByRole("button",{name:"تأكيد إلغاء وأرشفة الطلب",exact:true});
  await cancel.focus();await cancel.press("Tab");assert.equal(await confirm.evaluate(element=>document.activeElement===element),true,"confirmation is keyboard reachable");
  await confirm.press("Shift+Tab");assert.equal(await cancel.evaluate(element=>document.activeElement===element),true,"cancel is keyboard reachable");
  for(const control of [cancel,confirm]){
   await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();
   assert.ok(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=width+1&&box.y+box.height<=1001,`confirmation controls reachable within viewport ${nameCase}/${width}/${mode}`);
  }
  await dialog.screenshot({path:`${output}/initial-${nameCase}-${mode}-${width}.png`});
  await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
  assert.equal(writes.length,0,"non-pending Escape must not archive");assert.equal(archived,false);await restoredFocus();
  await action().click();await dialog.waitFor();
  await dialog.getByRole("button",{name:"رجوع بدون أرشفة",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal(writes.length,0);
  // Keyboard cancellation must return focus to the invoking action.
  await restoredFocus();
  await action().click();await dialog.getByRole("button",{name:"تأكيد إلغاء وأرشفة الطلب",exact:true}).click();
  await dialog.getByText(/لا يمكن الأرشفة: توجد دفعة معلقة/).waitFor();assert.equal(writes.length,1);assert.equal(archived,false);
  assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1),false,`dialog overflow ${width}/${mode}`);
  await dialog.screenshot({path:`${output}/confirmation-${nameCase}-${mode}-${width}.png`});
  await dialog.getByRole("button",{name:"رجوع بدون أرشفة",exact:true}).click();await dialog.waitFor({state:"hidden"});await action().waitFor();
  blocked=false;delay=true;arrival=new Promise(done=>arrived=done);pending=new Promise(done=>release=done);
  await action().click();await dialog.getByRole("button",{name:"تأكيد إلغاء وأرشفة الطلب",exact:true}).click();await arrival;
  await dialog.getByRole("button",{name:"جارٍ الأرشفة…",exact:true}).waitFor();
  await page.keyboard.press("Escape");assert.equal(await dialog.isVisible(),true);assert.equal(await dialog.getByRole("button",{name:"رجوع بدون أرشفة",exact:true}).isDisabled(),true);assert.equal(writes.length,2);
  release();await dialog.waitFor({state:"hidden"});await action().waitFor({state:"hidden"});assert.equal(writes.length,2);
  assert.equal(errors.length,0,errors.join("\n"));
  console.log(`PASS original ${mode} list ${width}px ${nameCase} name: no dialog overflow, reachable keyboard controls, non-pending Escape/cancel/focus without DELETE, scoped route, server blocker retention, pending lock and success refetch`);
 }catch(error){await page.screenshot({path:`${output}/failure-${nameCase}-${mode}-${width}.png`,fullPage:true});console.error(errors);throw error;}finally{release?.();await context.close();}
}}finally{await browser.close();await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));}
