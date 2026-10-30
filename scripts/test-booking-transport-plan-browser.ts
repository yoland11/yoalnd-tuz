/** Real editor/controller; all HTTP intercepted. Never touches a real database. */
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {realpathSync} from "node:fs";
import {readFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve} from "node:path";
import {readTransportPlan} from "../src/lib/booking-transport-plan";
const runtime=process.env.AJN_BROWSER_RUNTIME;assert.ok(runtime,"Set AJN_BROWSER_RUNTIME to bundled Playwright package.json");
const {chromium}=createRequire(runtime)("playwright");
const esbuild=createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss=createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind=createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css=(await postcss([tailwind()]).process(await readFile("src/index.css","utf8"),{from:resolve("src/index.css")})).css;
const js=(await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {BookingTransportPlanEditor} from './src/components/booking-transport-plan-editor';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><BookingTransportPlanEditor reference={{source:'service',id:7}} onPrint={ref=>document.getElementById('printed').textContent=JSON.stringify(ref)}/></QueryClientProvider>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:".next/transport-editor-browser",platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"development"'}})).outputFiles.find((f:any)=>f.path.endsWith(".js"))!.text;
const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/fixture.js"?"application/javascript":req.url==="/fixture.css"?"text/css":"text/html; charset=utf-8");res.end(req.url==="/fixture.js"?js:req.url==="/fixture.css"?css:'<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root"></main><output id="printed"></output><script src="/fixture.js"></script></body></html>')});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  let current=readTransportPlan({source:"service",id:7,bookingNumber:"B-7",legacy:{mode:"ajn",fee:50000,vehicleId:5,driverId:8},storedPlan:null});
  let rejectSave=false,readonly=false,failRead=false;const writes:any[]=[],errors:string[]=[];
  page.on("pageerror",(error:any)=>errors.push(error.message));
  await page.route("**/api/**",async(route:any)=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith("/admin/staff"))return route.fulfill({json:[{id:8,fullName:"سائق عربي",department:"delivery"}]});
   if(url.pathname.endsWith("/admin/enterprise/vehicles"))return route.fulfill({json:{data:[{id:5,name:"مركبة أولى",isActive:true},{id:6,name:"مركبة ثانية",isActive:true}]}});
   if(request.method()==="POST"){
    writes.push(request.postDataJSON());
    if(rejectSave)return route.fulfill({status:409,json:{error:"تغيّرت خطة النقل؛ أعد تحميل الحجز",code:"TRANSPORT_PLAN_CONFLICT",requestId:"test-save"}});
    current={...request.postDataJSON().transportPlan,revision:current.revision+1,legacy:false};
    return route.fulfill({json:{ok:true}});
   }
   if(failRead)return route.fulfill({status:500,json:{error:"تعذرت قراءة الحجز",requestId:"test-read"}});
   return route.fulfill({json:{transportation:{mode:"ajn",fee:50000},transportPlan:current,resourceOccupancy:{start:"2026-10-24T00:00:00+03:00",end:"2026-10-25T00:00:00+03:00"},capabilities:{canEdit:!readonly,canPrintFinancial:!readonly}}});
  });
  await page.goto(origin);await page.getByRole("button",{name:"حفظ خطة النقل",exact:true}).waitFor();
  await page.getByRole("radio",{name:"أجرة مستقلة لكل رحلة",exact:true}).click();
  await page.getByLabel("أجرة هذه الرحلة — د.ع",{exact:true}).fill("30000");
  await page.getByRole("button",{name:"إضافة رحلة نقل",exact:true}).click();
  const fields=page.locator("fieldset");const second=fields.nth(1);
  await second.getByLabel("المركبة",{exact:true}).click();await page.getByRole("option",{name:"مركبة ثانية",exact:true}).click();
  await second.getByLabel("أجرة هذه الرحلة — د.ع",{exact:true}).fill("20000");
  await second.getByLabel("موقع الوصول",{exact:true}).fill("قاعة عربية طويلة للاختبار");
  await page.getByRole("button",{name:"حفظ خطة النقل",exact:true}).click();assert.equal(writes.length,0,"mode confirmation mandatory before write");
  await page.getByRole("checkbox",{name:/أؤكد تغيير طريقة/}).check();
  rejectSave=true;await page.getByRole("button",{name:"حفظ خطة النقل",exact:true}).click();await page.getByRole("alert").filter({hasText:"تغيّرت خطة النقل"}).first().waitFor();
  assert.equal(writes.length,1);assert.equal(writes[0].expectedTransportRevision,0);assert.equal(writes[0].transportPlan.trips.length,2);
  rejectSave=false;await page.getByRole("button",{name:"حفظ خطة النقل",exact:true}).click();await page.getByRole("button",{name:/وصل رحلة 2/}).waitFor();
  await page.getByRole("button",{name:/وصل رحلة 2/}).click();assert.equal(JSON.parse(await page.locator("#printed").innerText()).tripId,current.trips[1].id);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"no horizontal overflow");
  await mkdir(".next/transport-receipt-review",{recursive:true});await page.screenshot({path:`.next/transport-receipt-review/editor-${width}.png`,fullPage:true});
  readonly=true;await page.reload();await page.getByText(/عرض للقراءة فقط/).waitFor();assert.equal(await page.getByRole("button",{name:"حفظ خطة النقل",exact:true}).count(),0);
  failRead=true;await page.reload();await page.getByRole("alert").filter({hasText:"تعذرت قراءة الحجز"}).waitFor();assert.equal(await page.getByRole("button",{name:"حفظ خطة النقل",exact:true}).count(),0);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log("PASS real transport editor desktop/mobile: two trip fees, explicit mode confirmation, 409 retry preserving draft/revision, exact trip action, permissions, read failures and no overflow");
}finally{await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));}
