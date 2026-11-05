/** Actual original attendance screens, intercepted synthetic I/O only. No Production writes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import QRCode from "qrcode";
const runtime=process.env.AJN_BROWSER_RUNTIME;
assert.ok(runtime,"AJN_BROWSER_RUNTIME must point to playwright/package.json");
const {chromium}=createRequire(runtime)("playwright");
const esbuild=createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss=createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind=createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css=(await postcss([tailwind()]).process(await readFile("src/index.css","utf8"),{from:resolve("src/index.css")})).css;
const js=(await esbuild.build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{Router}from'wouter';import{QueryClientProvider}from'@tanstack/react-query';import{queryClient}from'./src/lib/query-client';import Kiosk from './src/views/attendance-kiosk';import Staff from './src/views/staff/unified-portal';import{AttendanceCenter}from'./src/views/admin/attendance-center';queryClient.setDefaultOptions({queries:{retry:false,staleTime:0,refetchOnWindowFocus:false}});const Page=location.pathname.startsWith('/attendance-kiosk')?Kiosk:location.pathname.startsWith('/admin/')?()=> <AttendanceCenter policyEditor={<p>سياسة الرواتب الحالية</p>}/>:Staff;const root=createRoot(document.getElementById('root'));window.__attendanceFixture={root,queryClient};root.render(<Router><QueryClientProvider client={queryClient}><Page/></QueryClientProvider></Router>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:".next/attendance-fixture",platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"development"'}})).outputFiles.find((file:any)=>file.path.endsWith(".js"))!.text;
const fallbackLogo=await readFile("public/images/logo-fallback.svg","utf8");
const server=createServer((req,res)=>{if(req.url?.startsWith("/images/logo-fallback.svg")){res.setHeader("content-type","image/svg+xml");res.end(fallbackLogo);return;}res.setHeader("content-type",req.url==="/fixture.js"?"application/javascript":req.url==="/fixture.css"?"text/css":"text/html; charset=utf-8");res.end(req.url==="/fixture.js"?js:req.url==="/fixture.css"?css:'<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:#fffafb"><div id="root" style="min-width:0"></div><script src="/fixture.js"></script></body></html>');});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const artifacts=process.env.AJN_BROWSER_ARTIFACTS||resolve(".next/attendance-screenshots");await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.AJN_BROWSER_EXECUTABLE,headless:true});
const code=`AJN1.7.12345.${"a".repeat(32)}`,nextCode=`AJN1.7.12346.${"b".repeat(32)}`;
const qr=await QRCode.toDataURL(`${origin}/staff?attendanceQr=${code}`);
const epoch=Date.parse("2035-05-10T06:00:00Z");
const employee={id:7,username:"attendance_test",fullName:"موظف الاختبار",role:"employee",permissions:[],isActive:true};
const location={id:1,name:"المكتب الرئيسي",kind:"office",isActive:true,latitude:34.888,longitude:44.633,radiusMeters:100,maxAccuracyMeters:50,requiredMethod:"qr_gps"};
const shift={shiftId:5,startMs:epoch,endMs:epoch+8*3600000,kind:"fixed",title:null,bookingSource:null,bookingId:null,locationId:1,locationName:location.name,method:"qr_gps",needsQr:true,needsGps:true,manualOnly:false,allowedMethods:["qr_gps"]};
const baseToday={enabled:true,employeeName:employee.fullName,date:"2035-05-10",status:"not_started",statusLabel:"لم يبدأ الدوام",workedMinutes:0,open:null,shifts:[shift],current:shift,canCheckIn:true,canCheckOut:false,corrections:[],recent:[{id:1,checkInMs:epoch-86400000,checkOutMs:epoch-57600000,workedMinutes:480,status:"out",locationName:location.name}]};
const errorBody={success:false,code:"DATABASE_ERROR",message:"تعذر الاتصال بسجل الحضور",error:"تعذر الاتصال بسجل الحضور",requestId:"REQ-attendance-test",retryable:true};
try{
 for(const width of [390,768,1440]){
  // Kiosk keeps no stale QR while a refresh is delayed, and handles offline/malformed replies.
  const kiosk=await browser.newContext({viewport:{width,height:980}}),page=await kiosk.newPage();const errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
  await page.clock.install({time:new Date(epoch)});
  let serverNow=epoch,hold=false,pending:any=null,fail=false,malformed=false;
  await page.route("**/api/**",async(route:any)=>{const path=new URL(route.request().url()).pathname;if(path==="/api/settings")return route.fulfill({contentType:"application/json",body:JSON.stringify({site_name:"AJN ERP"})});if(hold){pending=route;return;}if(fail)return route.abort();return route.fulfill({contentType:"application/json",body:JSON.stringify(malformed?{unexpected:true}:{name:"شاشة المكتب",locationName:location.name,serverTime:serverNow,rotatesAt:serverNow+30000,rotationSeconds:30,qrDataUrl:qr})});});
  await page.goto(`${origin}/attendance-kiosk/test-device-token`);await page.getByRole("img",{name:"رمز تسجيل الحضور",exact:true}).waitFor();
  assert.equal(await page.getByText(location.name,{exact:true}).count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(artifacts,`attendance-kiosk-${width}.png`),fullPage:true});
  hold=true;await page.clock.runFor(30500);assert.equal(await page.getByRole("img",{name:"رمز تسجيل الحضور",exact:true}).count(),0,"expired code is hidden during pending refresh");
  assert.equal(await page.getByRole("status").count(),1);assert.ok(pending,"rotation requested fresh code");
  serverNow+=30500;hold=false;await pending.fulfill({contentType:"application/json",body:JSON.stringify({name:"شاشة المكتب",locationName:location.name,serverTime:serverNow,rotatesAt:serverNow+30000,rotationSeconds:30,qrDataUrl:qr})});
  await page.getByRole("img",{name:"رمز تسجيل الحضور",exact:true}).waitFor();
  fail=true;await page.clock.runFor(30500);await page.getByRole("alert").waitFor();assert.equal(await page.getByRole("img",{name:"رمز تسجيل الحضور",exact:true}).count(),0);
  fail=false;malformed=true;await page.getByRole("button",{name:"إعادة المحاولة",exact:true}).click();await page.getByRole("alert").filter({hasText:"بيانات شاشة الحضور"}).waitFor();
  malformed=false;serverNow+=30500;await page.getByRole("button",{name:"إعادة المحاولة",exact:true}).click();await page.getByRole("img",{name:"رمز تسجيل الحضور",exact:true}).waitFor();
  await page.getByRole("button",{name:"ملء الشاشة",exact:true}).click();assert.ok(await page.evaluate(()=>!!document.fullscreenElement));await page.getByRole("button",{name:"إنهاء ملء الشاشة",exact:true}).click();assert.deepEqual(errors,[]);await kiosk.close();
  // Real employee portal login retains QR, then requires explicit action and fresh one-shot GPS.
  const mobile=await browser.newContext({viewport:{width,height:980}}),phone=await mobile.newPage();let authed=false;let today:any=structuredClone(baseToday);const writes:any[]=[];let delayNextPunch=false,pendingPunch:any=null,punchRequested:(()=>void)|undefined;const phoneErrors:string[]=[];phone.on("pageerror",(e:Error)=>phoneErrors.push(e.message));
  await phone.addInitScript(`window.__name=(fn)=>fn;window.gpsCalls=0;Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(ok,bad){window.gpsCalls++;window.resolveGps=ok;window.rejectGps=bad;}}});Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{async getUserMedia(){throw new Error("camera unavailable in local test");},async enumerateDevices(){return[];}}});window.BarcodeDetector=class{static async getSupportedFormats(){return["qr_code"];}async detect(){return[];}};`);
  await phone.route("**/api/**",async(route:any)=>{const req=route.request(),path=new URL(req.url()).pathname;let data:any={};let status=200;
    if(path==="/api/admin/auth/me"){if(authed)data={user:employee};else{status=401;data={...errorBody,code:"AUTH_REQUIRED",message:"غير مخول"};}}
    else if(path==="/api/admin/auth/login"){authed=true;data={user:employee};}
    else if(path==="/api/settings")data={site_name:"AJN ERP"};
    else if(path==="/api/admin/attendance/me")data=today;
    else if(path==="/api/admin/attendance/punch"){const payload=req.postDataJSON();writes.push(payload);assert.ok(payload.qrCode);assert.equal(payload.gps.latitude,34.888);assert.equal(payload.gps.accuracy,10);const entering=payload.action==="check_in";today={...today,status:entering?"present":"out",statusLabel:entering?"حاضر الآن":"منصرف",open:entering?{id:2,startMs:epoch}:null,canCheckIn:!entering,canCheckOut:entering};data={action:payload.action,recordId:2,atMs:epoch,locationName:location.name,today};if(delayNextPunch){pendingPunch={route,data};punchRequested?.();return;}}
    else if(path==="/api/staff/portal/dashboard")data={today:"2035-05-10",tasks:[],summary:{todayTasks:0,overdueTasks:0},staff:employee,attendance:writes.length?{checkInAt:new Date(epoch).toISOString(),checkOutAt:today.open?null:new Date(epoch).toISOString()}:null};
    else if(path.includes("/staff/portal/"))data={today:"2035-05-10",data:[],current:null};
    else if(path.includes("followup"))data={data:[],summary:{},count:0};
    await route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
  });
  await phone.goto(`${origin}/staff?attendanceQr=${code}`);await phone.waitForURL(/\/staff\/login\?attendanceQr=/);assert.ok(phone.url().includes(code));
  await phone.getByPlaceholder("اسم المستخدم",{exact:true}).fill("attendance_test");await phone.getByPlaceholder("كلمة المرور",{exact:true}).fill("local-test-only");await phone.getByRole("button",{name:"تسجيل الدخول",exact:true}).click();
  await phone.getByRole("region",{name:"دوامي اليوم",exact:true}).waitFor().catch(async cause=>{await phone.screenshot({path:resolve(artifacts,"employee-failure.png"),fullPage:true});console.log(JSON.stringify({url:phone.url(),errors:phoneErrors,text:(await phone.locator("body").innerText()).slice(0,2200)}));throw cause;});const card=phone.getByRole("region",{name:"دوامي اليوم",exact:true});await card.getByText(/تمت قراءة رمز الحضور/).waitFor();assert.equal(writes.length,0);assert.equal(await phone.evaluate(()=>(window as any).gpsCalls),0);
  await card.getByRole("button",{name:"تسجيل حضور",exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});assert.equal(await phone.evaluate(()=>(window as any).gpsCalls),1);assert.equal(writes.length,0);
  await phone.evaluate(()=>(window as any).resolveGps({coords:{latitude:34.888,longitude:44.633,accuracy:10}}));await card.getByRole("status").filter({hasText:"تم تسجيل حضورك"}).waitFor();
  await card.getByRole("button",{name:"مسح QR",exact:true}).click();const scanner=phone.getByRole("dialog",{name:"امسح رمز شاشة الحضور",exact:true});await scanner.getByPlaceholder("إدخال يدوي / ماسح Bluetooth أو USB").fill("AJN-A000007");await scanner.getByRole("button",{name:"إدخال",exact:true}).click();await scanner.getByRole("alert").waitFor();assert.equal(writes.length,1);
  await scanner.getByPlaceholder("إدخال يدوي / ماسح Bluetooth أو USB").fill(nextCode);await scanner.getByRole("button",{name:"إدخال",exact:true}).click();await scanner.waitFor({state:"hidden"});assert.equal(writes.length,1,"scanning identifies QR but never automatically punches");
  await card.getByRole("button",{name:"تسجيل انصراف",exact:true}).click();await phone.evaluate(()=>(window as any).rejectGps({code:1,PERMISSION_DENIED:1}));await card.getByRole("alert").filter({hasText:"اسمح"}).waitFor();assert.equal(writes.length,1);
  await card.getByRole("button",{name:"تسجيل انصراف",exact:true}).click();await phone.evaluate(()=>(window as any).resolveGps({coords:{latitude:34.888,longitude:44.633,accuracy:10}}));await phone.waitForFunction(()=>document.querySelector('section[aria-label="دوامي اليوم"]')?.textContent?.includes("تم تسجيل انصرافك"));assert.equal(writes.length,2);assert.equal(writes[1].action,"check_out");
  await card.getByRole("button",{name:"سجل حضوري وطلبات التصحيح",exact:true}).click();
  await card.getByRole("region",{name:"سجل حضوري",exact:true}).getByText("2035-05-09",{exact:true}).waitFor();
  assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:resolve(artifacts,`attendance-employee-${width}.png`),fullPage:true});assert.deepEqual(phoneErrors,[]);
  await phone.getByRole("button",{name:"الرئيسية",exact:true}).filter({visible:true}).click();
  // A response arriving after logout/unmount must not restore the old employee cache.
  delayNextPunch=true;const pendingArrival=new Promise<void>(done=>{punchRequested=done;});
  await card.getByRole("button",{name:"مسح QR",exact:true}).click();const delayedScanner=phone.getByRole("dialog",{name:"امسح رمز شاشة الحضور",exact:true});
  await delayedScanner.getByPlaceholder("إدخال يدوي / ماسح Bluetooth أو USB").fill(nextCode);await delayedScanner.getByRole("button",{name:"إدخال",exact:true}).click();
  await card.getByRole("button",{name:"تسجيل حضور",exact:true}).click();await phone.evaluate(()=>(window as any).resolveGps({coords:{latitude:34.888,longitude:44.633,accuracy:10}}));await pendingArrival;
  await phone.evaluate(()=>{(window as any).__attendanceFixture.root.unmount();(window as any).__attendanceFixture.queryClient.clear();});
  const lateResponse=phone.waitForResponse((r:any)=>r.url().endsWith("/api/admin/attendance/punch"));await pendingPunch.route.fulfill({contentType:"application/json",body:JSON.stringify(pendingPunch.data)});await lateResponse;
  await phone.evaluate(async()=>{await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));});
  assert.equal(await phone.evaluate(()=>Boolean((window as any).__attendanceFixture.queryClient.getQueryData(["staff","attendance","me"]))),false,"late success must never restore prior employee attendance after session clear");
  await mobile.close();
  // Manager center uses original data and errors, and provides kiosk/report actions.
  const admin=await browser.newContext({viewport:{width,height:980}}),desk=await admin.newPage();const adminErrors:string[]=[];desk.on("pageerror",(e:Error)=>adminErrors.push(e.message));
  const options={locations:[location],staff:[{id:7,fullName:employee.fullName,department:"التصوير"}],capabilities:{canManage:true,canApprove:true,canManagePolicy:true,canViewLocation:true},policy:{overtimeRequiresApproval:true}};
  await desk.route("**/api/**",async(route:any)=>{const req=route.request(),path=new URL(req.url()).pathname;let data:any={};if(path.endsWith("/options"))data=options;else if(path.endsWith("/dashboard"))data={date:"2035-05-10",summary:{total:1,presentNow:1,late:0,absent:0,out:0,mission:0,scheduled:1},departments:["التصوير"],locations:[location],rows:[{staffId:7,name:employee.fullName,department:"التصوير",locationName:location.name,shiftStartMs:epoch,shiftEndMs:epoch+28800000,checkInMs:epoch,checkOutMs:null,workedMinutes:0,method:"qr_gps",status:"present",statusLabel:"حاضر الآن"}]};else if(path.endsWith("/kiosks")&&req.method()==="POST")data={deviceToken:"test-created-device"};else if(path.endsWith("/kiosks"))data={data:[{id:1,name:"شاشة المكتب",locationName:location.name,isActive:true,lastSeenAt:"2035-05-10T06:00:00.000Z"}]};else if(path.endsWith("/report"))data={data:[{staffId:7,name:employee.fullName,department:"التصوير",scheduledDays:20,presentDays:19,absentDays:1,paidLeaveDays:0,unpaidLeaveDays:0,workedHours:152,lateMinutes:10,earlyLeaveMinutes:0,overtimeHours:2,missingCheckOut:0,eventAttended:0,eventShifts:0,proposedDeductions:1000}]};else if(path==="/api/settings")data={site_name:"AJN ERP"};await route.fulfill({contentType:"application/json",body:JSON.stringify(data)});});
  await desk.goto(`${origin}/admin/attendance`);await desk.getByText("إجمالي الموظفين",{exact:true}).waitFor();assert.ok(await desk.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await desk.screenshot({path:resolve(artifacts,`attendance-dashboard-${width}.png`),fullPage:true});
  await desk.getByRole("tab",{name:"شاشة QR",exact:true}).click();await desk.getByText("شاشة المكتب",{exact:true}).waitFor();await desk.getByLabel("موقع العمل لشاشة QR",{exact:true}).selectOption("1");await desk.getByRole("button",{name:"إنشاء رابط الشاشة",exact:true}).click();await desk.getByRole("link",{name:"فتح شاشة QR",exact:true}).waitFor();assert.ok((await desk.getByRole("link",{name:"فتح شاشة QR",exact:true}).getAttribute("href"))?.endsWith("/attendance-kiosk/test-created-device"));
  await desk.getByRole("tab",{name:"التقارير",exact:true}).click();await desk.getByText(/خصومات الحضور مقترحة فقط/).waitFor();await desk.getByRole("button",{name:"شهري",exact:true}).click();assert.equal(await desk.getByRole("button",{name:"Excel",exact:true}).isEnabled(),true);assert.equal(await desk.getByRole("button",{name:"A4",exact:true}).isEnabled(),true);assert.deepEqual(adminErrors,[]);await admin.close();
 }
 console.log("PASS original attendance UI: rotating/expired/offline kiosk and fullscreen; portal login QR handoff; explicit punch with one GPS request; duplicate taps, denial/retry, QR scan confirmation, self history, dashboard/reports and Arabic RTL at 390/768/1440px.");
}finally{await browser.close();await new Promise<void>(done=>server.close(()=>done()));}
