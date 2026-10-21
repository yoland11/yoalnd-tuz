/** Actual production UI + pure coordinator. Controlled I/O, NOT a PostgreSQL integration test. */
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {realpathSync} from "node:fs";
import {readFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve} from "node:path";
import {executeLoadingRequest,loadingReturnSummary,type LoadingFacts,type LoadingRecord} from "../src/lib/booking-loading";
const runtime=process.env.AJN_BROWSER_RUNTIME;assert.ok(runtime,"Set AJN_BROWSER_RUNTIME to Playwright package.json");
const {chromium}=createRequire(runtime)("playwright");
const esbuild=createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss=createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind=createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css=(await postcss([tailwind()]).process(await readFile("src/index.css","utf8"),{from:resolve("src/index.css")})).css;
const js=(await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {TooltipProvider} from './src/components/ui/tooltip';import {BookingLoadingPanel} from './src/components/booking-loading-panel';import {StaffBookingLoading} from './src/components/staff-booking-loading';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TooltipProvider>{location.pathname.startsWith('/staff')?<StaffBookingLoading id={12} source="kosha" onReturned={()=>{}}/>:<BookingLoadingPanel endpoint="/admin/booking-operations/kosha/12/loading" queryKey={['fixture']}/>}</TooltipProvider></QueryClientProvider>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:".next/loading-browser-bundle",platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"development"'}})).outputFiles.find((f:any)=>f.path.endsWith(".js"))!.text;
const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/fixture.js"?"application/javascript":req.url==="/fixture.css"?"text/css":"text/html; charset=utf-8");res.end(req.url==="/fixture.js"?js:req.url==="/fixture.css"?css:'<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1150px;margin:auto"></main><script src="/fixture.js"></script></body></html>')});
await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const output=".next/booking-loading-review";await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
try{for(const width of [1440,768,390]){
 const ctx=await browser.newContext({viewport:{width,height:1000}});await ctx.addCookies([{name:"ajn_admin_session",value:"controlled-ui",url:origin}]);const page=await ctx.newPage();const errors:string[]=[];page.on("pageerror",(e:any)=>errors.push(e.message));
 let actor=1,record:LoadingRecord|null=null,failGet=false,loseReply=false,lostId="",replayed=false,returnWrites=0;
 const facts:LoadingFacts={source:"kosha",id:12,status:"confirmed",vehicle:{id:8,name:"مركبة التجهيز",active:true},staff:[{id:1,name:"علي"},{id:2,name:"أحمد"},{id:3,name:"حسين"}],blockers:[],lines:[
  {key:"asset:10",kind:"asset",productId:10,variantId:null,tracking:"individual",required:1,issued:1,prepared:1,origin:"custody:100",name:"عمود ذهبي",unit:"قطعة",codes:["AJN-A10"],returnedGood:0,damaged:0,missing:0,maintenance:0},
  {key:"asset:11",kind:"asset",productId:11,variantId:null,tracking:"quantity",required:3,issued:3,prepared:3,origin:"movements:200",name:"إضاءة مشتركة",unit:"قطعة",codes:["LIGHT"],returnedGood:0,damaged:0,missing:0,maintenance:0},
  {key:"stock:20:0",kind:"consumable",productId:20,variantId:null,tracking:"quantity",required:1.5,issued:1.5,prepared:1.5,origin:"reservation:300",name:"قماش مستهلك",unit:"متر",codes:["CLOTH"],returnedGood:0,damaged:0,missing:0,maintenance:0}]};
 const view=()=>({facts:{...facts,lines:facts.lines.map(({codes,...l})=>l)},record,blockers:[],actorId:actor,canAct:true,canManage:actor===1,returns:record?.status==="confirmed"?loadingReturnSummary(record,facts):null});
 await page.route("**/api/**",async(route:any)=>{const request=route.request(),path=new URL(request.url()).pathname;
  if(path.endsWith("/loading")||path.includes("/koshas/loading/")){
   if(request.method()==="GET")return failGet?route.fulfill({status:503,json:{message:"تعذر قراءة الأصل",requestId:"loading-ui"}}):route.fulfill({json:view()});
   const cmd=request.postDataJSON();try{const result=executeLoadingRequest(record,facts,{id:actor,name:"موظف",manager:actor===1},cmd,new Date().toISOString(),crypto.randomUUID());record=result.record;
    if(loseReply){loseReply=false;lostId=cmd.requestId;return route.fulfill({status:503,json:{message:"انقطع الرد بعد الحفظ",requestId:"loading-ui"}})}
    if(cmd.requestId===lostId){replayed=result.duplicate;assert.ok(replayed)}return route.fulfill({json:view()});
   }catch(e:any){return route.fulfill({status:e.status||500,json:{message:e.message,requestId:"loading-ui"}})}
  }
  if(path.endsWith("/assets")&&request.method()==="POST"){
   const p=request.postDataJSON();assert.equal(p.productId,11);assert.equal(p.mode,"return");assert.equal(p.goodQuantity,1);assert.equal(p.damagedQuantity,1);assert.equal(p.description,"كسر عند الإرجاع");assert.ok(p.requestId);
   facts.lines[1].returnedGood=1;facts.lines[1].damaged=1;returnWrites++;return route.fulfill({json:{ok:true}});
  }
  return route.fulfill({json:{}});
 });
 const go=async(staff=false)=>{await page.goto(`${origin}/${staff?'staff/koshas':'admin/booking-operations'}/kosha/12`,{waitUntil:"networkidle"})};
 const click=async(name:string)=>{await page.getByRole("button",{name,exact:true}).click()};
 const scan=async(name:string,code:string,qty?:string)=>{await page.getByRole("group",{name:`عنصر التحميل: ${name}`,exact:true}).getByRole("button").click();await page.getByLabel("QR أو الباركود",{exact:true}).fill(code);if(qty)await page.getByLabel("الكمية الممسوحة",{exact:true}).fill(qty);await click("تأكيد المسح")};
 await go();await click("إنشاء قائمة التحميل من الصرف الأصلي");await page.getByLabel("QR أو الباركود",{exact:true}).waitFor();
 await scan("عمود ذهبي","WRONG");await page.getByText("الرمز لا يطابق العنصر المحدد في هذا الحجز",{exact:true}).waitFor();
 loseReply=true;await scan("عمود ذهبي","AJN-A10");await page.getByText("انقطع الرد بعد الحفظ",{exact:true}).waitFor();await page.reload({waitUntil:"networkidle"});await click("إعادة نفس المحاولة دون تكرار");await page.getByText("توجد محاولة لم يتأكد ردها؛ أعد نفس المحاولة قبل عملية جديدة.",{exact:true}).waitFor({state:"detached"});assert.ok(replayed);assert.equal(record!.lines[0].loaded,1);
 await scan("عمود ذهبي","AJN-A10");await page.getByText("تم مسح هذه القطعة سابقاً",{exact:true}).waitFor();
 await scan("إضاءة مشتركة","LIGHT","2");await page.getByRole("group",{name:"عنصر التحميل: إضاءة مشتركة"}).getByText("2 / 3 قطعة",{exact:true}).waitFor();
 await scan("إضاءة مشتركة","LIGHT","1");await page.getByRole("group",{name:"عنصر التحميل: إضاءة مشتركة"}).getByText("3 / 3 قطعة",{exact:true}).waitFor();
 await scan("قماش مستهلك","CLOTH","1.5");await page.getByText("100%",{exact:true}).waitFor();await click("إقراري بالتسليم");await page.getByRole("button",{name:"إقراري بالتسليم",exact:true}).waitFor();assert.ok(await page.getByRole("button",{name:"إقراري بالتسليم",exact:true}).isDisabled()||record!.acknowledgements.sender);
 actor=2;await go(true);await click("إقراري بالاستلام");await page.getByText("المسلّم: أقرّ بنفسه · المستلم: أقرّ بنفسه. تأكيد التحميل لا يعتمد جاهزية الحجز الشاملة.",{exact:true}).waitFor();
 actor=1;await go();await click("تأكيد تحميل المركبة");await page.getByText("التحميل مؤكد",{exact:true}).waitFor();assert.equal(record!.handovers.length,1);
 actor=2;await go(true);await page.getByRole("combobox",{name:"المستلم التالي",exact:true}).click();await page.getByRole("option",{name:"حسين",exact:true}).click();await page.getByLabel("من موقع",{exact:true}).fill("المركبة");await page.getByLabel("إلى موقع",{exact:true}).fill("المناسبة");await click("تسجيل التسليم وطلب إقرار المستلم");await page.getByLabel("سبب إلغاء التسليم المعلق",{exact:true}).waitFor();
 actor=3;await go(true);await click("إقراري باستلام العهدة الحالية");await page.getByText("تسليم المعدات المتبقية إلى الموظف التالي",{exact:true}).waitFor();
 await page.getByRole("group",{name:"عنصر التحميل: إضاءة مشتركة",exact:true}).getByRole("button",{name:"الإرجاع الأصلي",exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByLabel("سليم",{exact:true}).fill("1");await dialog.getByLabel("تالف",{exact:true}).fill("1");await dialog.getByLabel("وصف التلف أو النقص *",{exact:true}).fill("كسر عند الإرجاع");await dialog.getByRole("button",{name:"تأكيد",exact:true}).click();await dialog.waitFor({state:"detached"});await page.getByText("مطلوب 4 · معاد 2 · لم يعد 2",{exact:true}).waitFor();assert.equal(returnWrites,1);assert.equal(record!.lines[1].loaded,3);
 failGet=true;await click("تحديث التحميل");await page.getByText("تعذر قراءة سجل التحميل",{exact:true}).waitFor();assert.ok(await page.getByRole("button",{name:"تسجيل التسليم وطلب إقرار المستلم",exact:true}).isDisabled());failGet=false;await click("إعادة المحاولة");await page.getByText("تعذر قراءة سجل التحميل",{exact:true}).waitFor({state:"detached"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`RTL overflow ${width}`);await page.screenshot({path:`${output}/staff-${width}.png`,fullPage:true});assert.equal(errors.length,0,errors.join("\n"));await ctx.close();console.log(`PASS actual loading/staff return UI ${width}px: QR, wrong/duplicate scans, decimal, durable reload retry, personal receipt, original partial/damaged return and error recovery`);
}}finally{await browser.close();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))}
