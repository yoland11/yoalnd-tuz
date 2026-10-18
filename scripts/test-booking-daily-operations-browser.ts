// Presentation fixtures only. All API calls intercepted; no database reads/writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { buildDailyOperations, parseDailyOperationsFilters, type DailyBookingFact } from "../src/lib/booking-daily-operations";
const runtime = process.env.AJN_BROWSER_RUNTIME;
assert.ok(runtime, "Set AJN_BROWSER_RUNTIME to the installed Playwright runtime package.json");
const { chromium } = createRequire(runtime)("playwright");
const output = ".next/daily-operations-review";
await mkdir(output, {recursive:true});
// Actual React component + actual AJN CSS in a test-only server. The full app's
// root layout requires DB-backed public settings, which this fixture must not use.
const localRequire = createRequire(resolve("package.json"));
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = localRequire("@tailwindcss/postcss");
const css = await postcss([tailwind()]).process(await readFile("src/index.css","utf8"), {from:resolve("src/index.css")});
const bundle = await esbuild.build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import {DailyOperationsTab} from './src/views/admin/daily-operations'; createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DailyOperationsTab /></QueryClientProvider>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'}});
const server = createServer((req,res)=>{
  if(req.url==="/fixture.js") {res.setHeader("Content-Type","application/javascript");res.end(bundle.outputFiles[0].text);}
  else if(req.url==="/fixture.css") {res.setHeader("Content-Type","text/css");res.end(css.css);}
  else {res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto"></main><script src="/fixture.js"></script></body></html>');}
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const facts: DailyBookingFact[] = [
  {source:"kosha",id:12,number:"AJN-KOSHA-0012",customerName:"أحمد محمد حسين",eventDate:"2026-10-18",eventTime:"18:00",location:"بغداد — قاعة المناسبات",status:"preparing",category:"kosha",details:{bookingOperations:{productMeta:{"4:0":{prep:{status:"ready"}}}}},assignedStaffId:8,staff:[{id:8,name:"حسين علي"}],staffConfirmation:{trackedIds:[8],acceptedIds:[8]},vehicleId:2,vehicleName:"سيارة التجهيز رقم ٢",vehicleState:{active:true,status:"maintenance"},transportationMode:"ajn",crewName:"فريق الكوشات",overdueTasks:2,openTasks:3,products:[{productId:4,variantId:null,quantity:2,status:"reserved"}]},
  {source:"service",id:12,number:"SRV-0012",customerName:"سارة عبد الرحمن محمد عبد الله الطويل لاختبار عرض الاسم",eventDate:"2026-10-18",eventTime:null,location:"المنصور",status:"new",category:"sound",details:{},assignedStaffId:null,vehicleId:null,vehicleName:null,transportationMode:"customer",crewName:null,overdueTasks:0,openTasks:1,products:[]},
];
const browser = await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
try {
  for (const width of [1440,768,390]) {
    const context = await browser.newContext({viewport:{width,height:1000}});
    await context.addCookies([{name:"ajn_admin_session",value:"daily-room-fixture",url:origin}]);
    const page = await context.newPage();
    const errors:string[]=[]; let fail=false; let globalCommandReads=0; let roomReads=0;
    page.on("pageerror",(error:any)=>errors.push(error.message));
    await page.route("**/api/**",async (route:any)=>{
      const request=route.request(); const url=new URL(request.url());
      assert.equal(request.method(),"GET","room must not trigger any mutation");
      if(url.pathname.endsWith("/admin/auth/me")) return route.fulfill({json:{user:{id:1,role:"admin",username:"fixture",fullName:"مدير الاختبار",isActive:true,permissions:[]}}});
      if(url.pathname.endsWith("/enterprise/command-center")) {globalCommandReads++;return route.fulfill({json:{}});}
      if(url.pathname.endsWith("/enterprise/daily-operations")) {
        roomReads++;
        if(fail) return route.fulfill({status:503,json:{message:"تعذر تحميل العمليات",code:"DATABASE_ERROR",requestId:"fixture-error"}});
        return route.fulfill({json:buildDailyOperations(facts,parseDailyOperationsFilters(url.searchParams),false,new Date("2026-10-18T12:00:00Z"))});
      }
      if(/notifications/.test(url.pathname)) return route.fulfill({json:{data:[],unreadCount:0}});
      return route.fulfill({json:{}});
    });
    await page.goto(`${origin}/admin/command-center?tab=daily-operations`,{waitUntil:"networkidle"});
    await page.getByRole("heading",{name:"غرفة عمليات اليوم",exact:true}).waitFor();
    await page.getByRole("article",{name:"الحجز AJN-KOSHA-0012"}).waitFor();
    assert.equal(globalCommandReads,0,"daily deep link must not fetch globally cached command data");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth+1),false,`no document overflow at ${width}`);
    assert.equal(await page.locator('a[href="/admin/bookings/kosha/12"]').first().getAttribute("href"),"/admin/bookings/kosha/12");
    await page.getByText("عرض الفحوص",{exact:true}).first().click();
    assert.ok(await page.getByText("قبول المهمة موثق لجميع الموظفين المعيّنين",{exact:true}).first().isVisible());
    await page.screenshot({path:`${output}/daily-${width}.png`,fullPage:true});
    await page.getByRole("button",{name:"تأكيد الفريق",exact:true}).click();
    await page.getByRole("article",{name:"الحجز AJN-KOSHA-0012"}).waitFor({state:"detached"});
    await page.getByRole("article",{name:"الحجز SRV-0012"}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("opsAttention"),"team");
    await page.getByRole("button",{name:"كل الحجوزات",exact:true}).click();
    await page.getByLabel("الموظف",{exact:true}).selectOption("8");
    await page.getByRole("article",{name:"الحجز AJN-KOSHA-0012"}).waitFor();
    await page.getByRole("article",{name:"الحجز SRV-0012"}).waitFor({state:"detached"});
    assert.equal(new URL(page.url()).searchParams.get("opsEmployee"),"8");
    await page.reload({waitUntil:"networkidle"});
    assert.equal(await page.getByLabel("الموظف",{exact:true}).inputValue(),"8","employee filter survives reload/back URL");
    await page.getByRole("button",{name:"مسح الفلاتر",exact:true}).click();
    await page.getByRole("article",{name:"الحجز SRV-0012"}).waitFor();
    await page.getByPlaceholder("ابحث بالاسم أو رقم الحجز").fill("سارة");
    await page.getByRole("article",{name:"الحجز AJN-KOSHA-0012"}).waitFor({state:"detached"});
    await page.getByRole("article",{name:"الحجز SRV-0012"}).waitFor();
    assert.equal(await page.getByRole("article").count(),1);
    await page.getByPlaceholder("ابحث بالاسم أو رقم الحجز").fill("غير موجود");
    await page.getByText("لا توجد حجوزات مطابقة",{exact:true}).waitFor();
    fail=true;
    await page.getByRole("button",{name:"تحديث العمليات",exact:true}).click();
    await page.getByText("تعذر تحديث غرفة العمليات",{exact:true}).waitFor();
    fail=false;
    await page.getByPlaceholder("ابحث بالاسم أو رقم الحجز").fill("");
    await page.getByRole("article",{name:"الحجز AJN-KOSHA-0012"}).waitFor();
    assert.equal(errors.length,0,errors.join("\n"));
    assert.ok(roomReads>=4);
    await context.close();
    console.log(`PASS daily operations ${width}px RTL, filters, exact-source links, checks, error and recovery`);
  }
} finally { await browser.close(); await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve())); }
