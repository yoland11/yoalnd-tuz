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
const bundle = await esbuild.build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TooltipProvider} from './src/components/ui/tooltip';
import {Orders} from './src/views/admin/graduation';import {GraduationGroupWorkspace} from './src/views/admin/graduation-order-center';
const mode=new URLSearchParams(location.search).get('mode');
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><TooltipProvider>{mode==='group'?<GraduationGroupWorkspace groupId={8} onBack={()=>{}}/>:<Orders individualOnly={mode==='individual'}/>}</TooltipProvider></QueryClientProvider>);`,resolveDir:process.cwd(),loader:"tsx"},plugins:[{name:"test-only-orders-export",setup(build){build.onLoad({filter:/[\\/]views[\\/]admin[\\/]graduation\.tsx$/},async ({path})=>({contents:await readFile(path,"utf8")+"\nexport {Orders};",loader:"tsx"}));}}],bundle:true,write:false,outdir:".next/graduation-archive-browser",platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"development"'}});
const javascript = bundle.outputFiles.find(file=>file.path.endsWith(".js")).text;
const output = "output/graduation-archive-ui";await mkdir(output,{recursive:true});
const server = createServer((req,res)=>{
 if(req.url==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(javascript);}
 else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);}
 else {res.setHeader("Content-Type","text/html;charset=utf-8");res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto;min-width:0"></main><script src="/fixture.js"></script></body></html>');}
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.AJN_BROWSER_EXECUTABLE||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
try {for(const width of [1440,768,390])for(const mode of ["group","individual","mixed"]){
 const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:"ajn_admin_session",value:"archive-fixture",url:origin}]);const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors=[],writes=[];let archived=false,blocked=true,delay=false,release,arrived;let pending=Promise.resolve(),arrival=Promise.resolve();
 page.on("pageerror",error=>errors.push(error.message));
 const row={...student,groupId:mode==="individual"?null:8};
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
  const action=()=>mode==="group"&&width<768?page.getByRole("button",{name:"إلغاء وأرشفة طلب هذا الطالب فقط",exact:true}):page.getByRole("button",{name:`أرشفة طلب ${student.customerName}`,exact:true});
  await action().waitFor();assert.equal(writes.length,0);
  await action().click();const dialog=page.getByRole("alertdialog");await dialog.waitFor();
  if(mode!=="individual")await dialog.getByText(/لن تُمسح المجموعة أو دفعاتها/).waitFor();
  await dialog.getByRole("button",{name:"رجوع بدون أرشفة",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal(writes.length,0);
  // Keyboard cancellation must return focus to the invoking action.
  await page.waitForFunction(()=>document.activeElement?.tagName==="BUTTON"&&(/أرشفة طلب/.test(document.activeElement.getAttribute("aria-label")||"")||document.activeElement.textContent.includes("إلغاء وأرشفة طلب هذا الطالب فقط")),{},{timeout:2000});
  await action().click();await dialog.getByRole("button",{name:"تأكيد إلغاء وأرشفة الطلب",exact:true}).click();
  await dialog.getByText(/لا يمكن الأرشفة: توجد دفعة معلقة/).waitFor();assert.equal(writes.length,1);assert.equal(archived,false);
  assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1),false,`dialog overflow ${width}/${mode}`);
  await dialog.screenshot({path:`${output}/confirmation-${mode}-${width}.png`});
  await dialog.getByRole("button",{name:"رجوع بدون أرشفة",exact:true}).click();await dialog.waitFor({state:"hidden"});await action().waitFor();
  blocked=false;delay=true;arrival=new Promise(done=>arrived=done);pending=new Promise(done=>release=done);
  await action().click();await dialog.getByRole("button",{name:"تأكيد إلغاء وأرشفة الطلب",exact:true}).click();await arrival;
  await dialog.getByRole("button",{name:"جارٍ الأرشفة…",exact:true}).waitFor();
  await page.keyboard.press("Escape");assert.equal(await dialog.isVisible(),true);assert.equal(await dialog.getByRole("button",{name:"رجوع بدون أرشفة",exact:true}).isDisabled(),true);assert.equal(writes.length,2);
  release();await dialog.waitFor({state:"hidden"});await action().waitFor({state:"hidden"});assert.equal(writes.length,2);
  assert.equal(errors.length,0,errors.join("\n"));
  console.log(`PASS original ${mode} list ${width}px: scoped route, confirmation/cancel/focus, server blocker retention, pending lock and success refetch`);
 }catch(error){await page.screenshot({path:`${output}/failure-${mode}-${width}.png`,fullPage:true});console.error(errors);throw error;}finally{release?.();await context.close();}
}}finally{await browser.close();await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));}
