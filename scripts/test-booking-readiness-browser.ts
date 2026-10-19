// Real Booking Center/workspace components and AJN CSS; intercepted read-only APIs.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {realpathSync} from "node:fs";
import {readFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve} from "node:path";
import {projectDailyBooking,type DailyBookingFact} from "../src/lib/booking-daily-operations";
const runtime=process.env.AJN_BROWSER_RUNTIME;
assert.ok(runtime,"Set AJN_BROWSER_RUNTIME to the installed Playwright package.json");
const {chromium}=createRequire(runtime)("playwright");
const esbuild=createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss=createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind=createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css=await postcss([tailwind()]).process(await readFile("src/index.css","utf8"),{from:resolve("src/index.css")});
const styles=css.css+await readFile("src/views/admin/booking-operations-workspace.css","utf8")+await readFile("src/views/admin/booking-center.css","utf8");
const now=new Date("2026-10-18T12:00:00Z");
const fact:DailyBookingFact={source:"kosha",id:12,number:"AJN-KOSHA-0012",customerName:"أحمد محمد حسين",eventDate:"2026-10-18",eventTime:"18:00",location:"بغداد — قاعة المناسبات",status:"confirmed",category:"kosha",details:{bookingOperations:{assets:[{productId:7,stage:"reserved"}]}},assignedStaffId:8,staff:[{id:8,name:"حسين علي"}],staffConfirmation:{trackedIds:[8],acceptedIds:[]},vehicleId:null,vehicleName:null,transportationMode:"customer",crewName:null,overdueTasks:0,openTasks:0,products:[]};
const readiness={...projectDailyBooking(fact,now).readiness,generatedAt:now.toISOString()};
const booking={source:"kosha",id:12,number:fact.number,customerName:fact.customerName,phone:"07701234567",eventDate:fact.eventDate,eventTime:fact.eventTime,hall:fact.location,status:"confirmed",total:50000,paid:10000,remaining:40000,paymentStatus:"partial",services:[{type:"kosha",status:"waiting"}],raw:{}};
const centerRow={...booking,departments:["kosha"],operationalReadiness:readiness,detailHref:"/admin/bookings/kosha/12"};
const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {PrintProvider} from './src/components/print/print-provider';import {TooltipProvider} from './src/components/ui/tooltip';import BookingCenter from './src/views/admin/booking-center';import {BookingOperationsWorkspace} from './src/views/admin/booking-operations-workspace';const booking=${JSON.stringify(booking)};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TooltipProvider><PrintProvider>{window.location.pathname.endsWith('/kosha/12')?<BookingOperationsWorkspace booking={booking}/>:<BookingCenter/>}</PrintProvider></TooltipProvider></QueryClientProvider>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:".next/readiness-browser-bundle",platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"development"'}});
const javascript=bundle.outputFiles.find((file:any)=>file.path.endsWith(".js"))!.text;
const output=".next/booking-readiness-review";await mkdir(output,{recursive:true});
const server=createServer((req,res)=>{
  if(req.url==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(javascript)}
  else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(styles)}
  else{res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto"></main><script src="/fixture.js"></script></body></html>')}
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
try{
  for(const width of [1440,768,390]){
    const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:"ajn_admin_session",value:"readiness-fixture",url:origin}]);
    const page=await context.newPage();let fail=false;let optedIn=false;const errors:string[]=[];
    page.on("pageerror",(cause:any)=>errors.push(cause.message));
    await page.route("**/api/**",async(route:any)=>{
      const request=route.request();const url=new URL(request.url());assert.equal(request.method(),"GET","readiness never mutates a booking");
      const path=url.pathname;
      if(path.endsWith("/auth/me"))return route.fulfill({json:{user:{id:1,role:"admin",username:"fixture",fullName:"مدير الاختبار",isActive:true,permissions:[]}}});
      if(path.endsWith("/booking-center")){optedIn=url.searchParams.get("readiness")==="1";return route.fulfill({json:[centerRow]})}
      if(path.endsWith("/readiness"))return fail?route.fulfill({status:503,json:{message:"تعذر قراءة المتطلبات",code:"DATABASE_ERROR",requestId:"readiness-fixture"}}):route.fulfill({json:readiness});
      if(path.endsWith("/overview"))return route.fulfill({json:{readiness:100,readinessParts:{products:100,assets:100,finance:100},bookingStage:"booked",warehouseStage:"out",warehouseHistory:[],counts:{products:0,assets:1,tasks:0,completedTasks:0,documents:0,alerts:0},alerts:[],recentActivity:[]}});
      if(path.endsWith("/transportation"))return route.fulfill({json:{transportation:{mode:"customer",fee:0}}});
      if(path.endsWith("/group-attendees"))return route.fulfill({json:{attendees:[]}});
      if(path.endsWith("/staff-assignment"))return route.fulfill({json:{types:["kosha"],assignedStaff:[],eligibleStaff:[]}});
      if(path.endsWith("/branches"))return route.fulfill({json:{data:[],assignments:[]}});
      if(path.endsWith("/penalties/indicators"))return route.fulfill({json:{indicators:{}}});
      if(/notifications/.test(path))return route.fulfill({json:{data:[],unreadCount:0}});
      if(path.endsWith("/services")||path.endsWith("/customers"))return route.fulfill({json:[]});
      return route.fulfill({json:{}});
    });
    await page.goto(`${origin}/admin/bookings`,{waitUntil:"networkidle"});
    await page.getByText(fact.customerName,{exact:true}).first().waitFor();assert.ok(optedIn,"Booking Center opts into authoritative operational evidence");
    assert.ok(await page.getByText("جاهزية مؤكدة اليوم",{exact:true}).isVisible());
    await page.screenshot({path:`${output}/center-${width}.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`center overflow ${width}`);
    await page.goto(`${origin}/admin/bookings/kosha/12`,{waitUntil:"networkidle"});
    const panel=page.getByRole("region",{name:"فحص جاهزية الحجز",exact:true});await panel.waitFor();
    assert.ok(await panel.getByText("غير جاهز",{exact:true}).isVisible());
    assert.ok(await panel.getByText("غير موثق · إلزامي",{exact:true}).first().isVisible());
    assert.equal(await panel.locator('a[href="/admin/bookings/kosha/12?tab=assets"]').count(),2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`workspace overflow ${width}`);
    await page.screenshot({path:`${output}/workspace-${width}.png`,fullPage:true});
    await panel.screenshot({path:`${output}/checks-${width}.png`});
    fail=true;await panel.getByRole("button",{name:"تحديث الفحص",exact:true}).click();await panel.getByText("تعذر تحديث فحص الجاهزية",{exact:true}).waitFor();
    assert.ok(await panel.getByText("المعروض آخر قراءة ناجحة، وليس تأكيداً للحالة الحالية.",{exact:true}).isVisible());
    fail=false;await panel.getByRole("button",{name:"إعادة المحاولة",exact:true}).click();await panel.getByText("تعذر تحديث فحص الجاهزية",{exact:true}).waitFor({state:"detached"});
    assert.equal(errors.length,0,errors.join("\n"));await context.close();
    console.log(`PASS Booking Center/workspace ${width}px: original evidence, RTL, resolution links, no overflow/writes, retry recovery`);
  }
}finally{await browser.close();await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}
