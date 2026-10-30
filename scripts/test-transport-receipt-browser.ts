/** Real AJN dialog and print HTML; controlled HTTP only, no database or Production. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { readFile,mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { readTransportPlan } from "../src/lib/booking-transport-plan";
import { DEFAULT_TRANSPORT_RECEIPT_SETTINGS,buildTransportReceiptHtml,type TransportReceiptData } from "../src/lib/transport-receipt";
const runtime=process.env.AJN_BROWSER_RUNTIME;assert.ok(runtime,"Set AJN_BROWSER_RUNTIME to bundled Playwright package.json");
const {chromium}=createRequire(runtime)("playwright");
const esbuild=createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss=createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind=createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css=(await postcss([tailwind()]).process(await readFile("src/index.css","utf8"),{from:resolve("src/index.css")})).css;
const js=(await esbuild.build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {TransportReceiptDialog} from './src/components/transport-receipt-dialog';function App(){const [ref,setRef]=useState(null);return <><button onClick={()=>setRef({source:'service',id:7})}>افتح الوصل</button><TransportReceiptDialog reference={ref} onClose={()=>setRef(null)}/></>}createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><App/></QueryClientProvider>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:".next/transport-receipt-browser",platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"development"'}})).outputFiles.find((f:any)=>f.path.endsWith(".js"))!.text;
const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/fixture.js"?"application/javascript":req.url==="/fixture.css"?"text/css":"text/html; charset=utf-8");res.end(req.url==="/fixture.js"?js:req.url==="/fixture.css"?css:'<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>')});
await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const output=".next/transport-receipt-review";await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const baseData:TransportReceiptData={sourceRevision:0,receiptReference:"B-7-1234-T01",bookingNumber:"B-7-1234",variant:"customer",company:{name:"شركة AJN للاختبار",phone:"07720000000",logoUrl:null},customerName:"اسم عميل عربي طويل ".repeat(8),customerPhone:"07710000000",transportType:"نقل كوشة",origin:"المخزن",destination:"قاعة طويلة الاسم للمناسبات",transportDate:"2026-10-24",departureTime:"10:00",expectedArrivalTime:null,driverName:"سائق عربي",driverPhone:null,vehicleName:"مركبة النقل",vehiclePlate:"12-3456",assignedWork:"نقل تجهيزات الحجز",notes:"ملاحظة عربية طويلة ".repeat(25),status:null,amount:{value:50000,label:"أجرة النقل الكلية للحجز"},driverSettlement:null,qrUrl:null};
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();const errors:string[]=[];page.on("pageerror",(e:any)=>errors.push(e.message));
 let mode="single",financial=true,failSettings=false,audits=0,stored={...DEFAULT_TRANSPORT_RECEIPT_SETTINGS};
 let holdCustomer=false,releaseCustomer:undefined|(()=>void),customerStarted:undefined|(()=>void);
 await page.route("**/api/**",async(route:any)=>{
   const request=route.request(),url=new URL(request.url());
   assert.ok(url.pathname.endsWith("/booking-operations/service/7/transportation"),"all writes stay on the existing selected transportation source");
   if(url.searchParams.get("transportAction")==="settings"){
     if(failSettings)return route.fulfill({status:503,json:{message:"تعذر قراءة إعدادات الوصل",requestId:"settings-test"}});
     if(request.method()==="PUT"){const payload=request.postDataJSON();stored=payload.reset?{...DEFAULT_TRANSPORT_RECEIPT_SETTINGS}:{...payload.settings};}
     return route.fulfill({json:{settings:stored,canManage:true}});
   }
   if(url.searchParams.get("transportAction")==="print-request"){audits++;return route.fulfill({json:{ok:true,physicalPrintConfirmed:false}})}
   if(url.searchParams.get("receipt")==="1"){
     const variant=url.searchParams.get("variant");
     if(holdCustomer&&variant==="customer"){customerStarted?.();await new Promise<void>(r=>{releaseCustomer=r});}
     const data={...baseData,variant,amount:variant==="driver"?null:baseData.amount,receiptReference:url.searchParams.get("tripId")==="t2"?"B-7-1234-T02":baseData.receiptReference};
     return route.fulfill({json:data});
   }
   if(mode==="failure")return route.fulfill({status:503,json:{message:"فشل قراءة النقل",requestId:"transport-test"}});
   const plan=readTransportPlan({source:"service",id:7,bookingNumber:"B-7",legacy:mode==="empty"?null:{mode:"ajn",fee:50000,vehicleId:5},storedPlan:null});
   if(mode==="multiple")plan.trips.push({...plan.trips[0],id:"t2",sequence:2,destination:"قاعة ثانية"});
   return route.fulfill({json:{transportation:null,transportPlan:plan,capabilities:{canEdit:true,canPrintFinancial:financial}}});
 });
 await page.goto(origin,{waitUntil:"networkidle"});const open=async()=>{await page.getByRole("button",{name:"افتح الوصل",exact:true}).click();await page.getByRole("dialog").waitFor()};
 const close=async()=>{await page.getByRole("button",{name:"إلغاء",exact:true}).click();await page.getByRole("dialog").waitFor({state:"detached"})};
 const frame=()=>page.frameLocator('iframe[title="وصل النقل — معاينة"]');
 await open();await frame().getByText("أجرة النقل الكلية للحجز",{exact:true}).waitFor();
 await page.getByText("نسخة السائق",{exact:true}).click();await frame().getByRole("heading",{name:"وصل السائق",exact:true}).waitFor();assert.ok(!(await frame().locator("body").innerText()).includes("50,000"));
 holdCustomer=true;const started=new Promise<void>(r=>{customerStarted=r});await page.getByText("نسخة العميل",{exact:true}).click();await started;await page.getByText("نسخة السائق",{exact:true}).click();await frame().getByRole("heading",{name:"وصل السائق",exact:true}).waitFor();releaseCustomer?.();holdCustomer=false;
 await page.getByLabel("عدد النسخ",{exact:true}).fill("0");assert.equal(await page.getByRole("button",{name:"طباعة",exact:true}).isEnabled(),false);
 await page.getByLabel("عدد النسخ",{exact:true}).fill("3");await frame().locator("article").nth(2).waitFor();assert.equal(await frame().locator("article").count(),3);
 await page.evaluate(()=>{(window as any).__originalOpen=window.open;window.open=()=>null});await page.getByRole("button",{name:"طباعة",exact:true}).click();await page.getByText("تعذر إرسال وصل النقل للطباعة",{exact:true}).waitFor();assert.equal(audits,0);
 await page.evaluate(()=>{window.open=(window as any).__originalOpen});
 await page.getByRole("button",{name:"إعدادات الطباعة",exact:true}).click();
 const printBox=await page.getByRole("button",{name:"طباعة",exact:true}).boundingBox();assert.ok(printBox&&printBox.y>=0&&printBox.y+printBox.height<=1000,"print/cancel actions stay visible with long settings and receipt on mobile/desktop");
 await page.getByLabel("ملاحظات النقل",{exact:true}).click();await page.getByRole("button",{name:"حفظ الإعدادات",exact:true}).click();await page.waitForFunction(()=>document.querySelector('button')!=null);assert.equal(stored.showNotes,false);
 await page.getByRole("button",{name:"استعادة الافتراضي",exact:true}).click();await frame().getByText("ملاحظة عربية طويلة",{exact:false}).first().waitFor();assert.equal(stored.showNotes,true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`dialog RTL overflow ${width}`);await page.screenshot({path:`${output}/preview-${width}.png`,fullPage:true});await close();
 mode="multiple";await open();await page.getByRole("combobox",{name:"عملية النقل",exact:true}).click();await page.getByRole("option",{name:/رحلة 2/}).click();await frame().getByText("B-7-1234-T02",{exact:true}).waitFor();await close();
 mode="empty";await open();await page.getByText("لا توجد عملية نقل مرتبطة بهذا الحجز.",{exact:true}).waitFor();assert.equal(await page.locator("iframe").count(),0);await close();
 mode="failure";await open();await page.getByText("تعذر قراءة عمليات النقل",{exact:true}).waitFor();assert.equal(await page.getByText("لا توجد عملية نقل مرتبطة بهذا الحجز.",{exact:true}).count(),0);await close();
 mode="single";financial=false;await open();await frame().getByRole("heading",{name:"وصل السائق",exact:true}).waitFor();assert.equal(await page.getByText("نسخة العميل",{exact:true}).isDisabled(),true);await page.keyboard.press("Escape");await page.getByRole("dialog").waitFor({state:"detached"});
 const paper=await context.newPage();await paper.setContent(buildTransportReceiptHtml(baseData,DEFAULT_TRANSPORT_RECEIPT_SETTINGS,3));await paper.emulateMedia({media:"print"});await paper.evaluate(()=>window.dispatchEvent(new Event("beforeprint")));
 const measurement=await paper.evaluate(()=>({width:document.querySelector("article")!.getBoundingClientRect().width,scroll:document.body.scrollWidth,page:document.getElementById("transport-measured-page")!.textContent}));
 assert.ok(Math.abs(measurement.width-302.36)<1);assert.ok(measurement.scroll<=304);assert.match(measurement.page!,/size:80mm \d+mm/);
 const pdf=await paper.pdf({preferCSSPageSize:true,printBackground:true});
 assert.equal((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)??[]).length,3,"three long copies produce exactly three pages, no blank trailing sheet");
 await paper.screenshot({path:`${output}/paper-${width}.png`,fullPage:true});await paper.close();
 assert.deepEqual(errors,[]);await context.close();console.log(`PASS real transport UI ${width}px: direct/multiple/empty/error, stale variant privacy, copies, popup blocked, settings/reset, keyboard and actual 80mm print CSS`);
}}finally{await browser.close();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))}
