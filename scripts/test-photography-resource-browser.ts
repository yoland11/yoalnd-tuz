import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {realpathSync} from "node:fs";
import {readFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve} from "node:path";
const runtime=process.env.AJN_BROWSER_RUNTIME;assert.ok(runtime);
const {chromium}=createRequire(runtime)("playwright"),esbuild=createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss=createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss"),tailwind=createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css=(await postcss([tailwind()]).process(await readFile("src/index.css","utf8"),{from:resolve("src/index.css")})).css;
const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {EventForm,RegistrationPage} from './src/views/staff/photography/index';const me={id:4,role:'manager',username:'local',fullName:'مصور تجربة',permissions:['photography']};function Fixture(){const[ref,setRef]=React.useState('local-event');return location.search?<><button onClick={()=>setRef('different-event')}>تبديل المناسبة</button><RegistrationPage eventRef={ref} me={me}/></>:<EventForm me={me}/>;}createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Fixture/></QueryClientProvider>);`,loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'}});
const server=createServer((req,res)=>{if(req.url==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(bundle.outputFiles[0].text);}else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);}else{res.setHeader("Content-Type","text/html;charset=utf-8");res.end('<html dir="rtl" lang="ar"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1200px;margin:auto"></main><script src="/fixture.js"></script></body></html>');}});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const origin=`http://127.0.0.1:${(server.address() as any).port}`,browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
await mkdir("tmp/photography-resource-review",{recursive:true});
try{for(const width of [1440,768,390]){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();const posts:any[]=[],errors:string[]=[];let failEmployees=true,failSave=true,release!:()=>void,arrived!:()=>void;
 const arrival=new Promise<void>(done=>arrived=done),response=new Promise<void>(done=>release=done);page.on("pageerror",(e:any)=>errors.push(e.message));
 await page.route("**/api/**",async(route:any)=>{const request=route.request(),path=new URL(request.url()).pathname;
  if(path.endsWith("/photographers"))return failEmployees?route.fulfill({status:503,json:{message:"تعذر تحميل المصورين",requestId:"local-employee-read"}}):route.fulfill({json:[{id:4,name:"مصور تجربة"}]});
  assert.ok(path.endsWith("/photography/events"));assert.equal(request.method(),"POST");const body=request.postDataJSON();posts.push(body);if(failSave)return route.fulfill({status:409,json:{message:"المصور مشغول خلال فترة التشغيل",requestId:"local-photo-write"}});
  arrived();await response;return route.fulfill({json:{...body,id:7,assignedStaffId:4,assignedStaffName:"مصور تجربة",status:"active",orderCount:0,createdAt:"2026-10-22T10:00:00Z"}});
 });
 try{await page.goto(origin);await page.getByRole("alert").filter({hasText:"تعذر تحميل المصورين"}).waitFor();failEmployees=false;await page.getByRole("button",{name:"إعادة تحميل المصورين",exact:true}).click();await page.getByRole("combobox",{name:"المصور المسؤول"}).filter({hasText:"مصور تجربة"}).waitFor();
  await page.getByLabel("اسم العريس *",{exact:true}).fill("عميل تجربة محلية باسم عربي طويل للتحقق من عرض الهاتف");
  await page.getByLabel("بداية التجهيز",{exact:true}).fill("2026-10-25T12:00");await page.getByLabel("بداية المناسبة",{exact:true}).fill("2026-10-25T20:00");await page.getByLabel("نهاية المناسبة",{exact:true}).fill("2026-10-26T01:00");await page.getByLabel("اكتمال الإرجاع",{exact:true}).fill("2026-10-25T10:00");
  const save=()=>page.getByRole("button",{name:"بدء المناسبة",exact:true});await save().click();await page.getByRole("alert").filter({hasText:"ترتيب المواعيد"}).waitFor();assert.equal(posts.length,0);
  await page.getByLabel("اكتمال الإرجاع",{exact:true}).fill("2026-10-26T12:00");await save().click();await page.getByRole("alert").filter({hasText:"المصور مشغول"}).waitFor();assert.equal(await page.getByLabel("بداية المناسبة",{exact:true}).inputValue(),"2026-10-25T20:00");assert.equal(posts[0].eventDate,"2026-10-25");assert.equal(posts[0].resourceWindow.eventStart,"2026-10-25T20:00:00+03:00");
  await page.screenshot({path:`tmp/photography-resource-review/create-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`photo RTL overflow ${width}`);
  failSave=false;await save().click();await arrival;await page.locator("form").evaluate((form:HTMLFormElement)=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));release();await page.waitForURL(/\/staff\/photography\/events\/.+\/register/);assert.equal(posts.length,2);assert.equal(posts[0].clientToken,posts[1].clientToken,"retry stays the same original event token");assert.equal(errors.length,0,errors.join("\n"));
  console.log(`PASS actual photo event form ${width}px: explicit full period, visible failed read/retry, retained draft, original token, duplicate-submit protection and RTL`);
 }finally{await context.close();}
}
for(const width of [1440,768,390]) {
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
 const event={id:7,clientToken:"local-event",groomName:"عميل عربي",eventName:"مناسبة مرتبطة",eventDate:"2026-10-25",assignedStaffId:4,assignedStaffName:"مصور تجربة",status:"active",orderCount:0,orders:[],summary:{orders:0,copies:0,total:0,paid:0,remaining:0,paidCount:0,unpaidCount:0}};
 let failed=true,pending=true,reads=0;const puts:any[]=[],patches:any[]=[];
 await context.addInitScript(()=>localStorage.setItem("ajn-photo-event-local-event",JSON.stringify({id:0,clientToken:"local-event",groomName:"مسودة",eventDate:"2026-10-25",assignedStaffId:4,status:"pending_sync"})));
 await page.route("**/api/**",async(route:any)=>{const path=new URL(route.request().url()).pathname;
  if(path.endsWith("/events/different-event"))return route.fulfill({status:503,json:{message:"تعذر قراءة المناسبة الجديدة",requestId:"local-switch"}});
  if(path.endsWith("/prices"))return route.fulfill({json:[{id:"p3000",amount:3000}]});
  if(path.endsWith("/photographers"))return route.fulfill({json:[{id:4,name:"مصور تجربة"}]});
  if(path.endsWith("/resource-window")) {
   if(route.request().method()==="PUT"){const body=route.request().postDataJSON();puts.push(body);event.eventDate=body.calendar.eventDate;return route.fulfill({json:{eventDate:event.eventDate,eventTime:"20:00"}});}
   return route.fulfill({json:{resourceWindow:null,expectedWindow:null,eventDate:event.eventDate,eventTime:null,canEdit:true,canReschedule:true}});
  }
  assert.ok(path.endsWith("/events/local-event"),path);if(route.request().method()==="PATCH"){patches.push(route.request().postDataJSON());return route.fulfill({json:event});}reads++;
  return failed?route.fulfill({status:pending?404:503,json:{message:pending?"المناسبة لم تؤكد بعد":"تعذر تحميل المناسبة",requestId:"local-read"}}):route.fulfill({json:event});
 });
 try {
  await page.goto(`${origin}/?register`);await page.getByRole("heading",{name:"تأكيد مسودة المناسبة"}).waitFor();assert.equal(await page.getByRole("heading",{name:"التسجيل السريع"}).count(),0,"pending local draft cannot create orders before server confirmation");
  failed=false;await page.getByRole("button",{name:"إعادة تحميل المناسبة",exact:true}).click();await page.getByRole("heading",{name:"التسجيل السريع"}).waitFor();await page.getByRole("heading",{name:"فترة تشغيل الموارد",exact:true}).waitFor();
  await page.getByRole("checkbox",{name:"تعديل موعد الحجز مع فترة الموارد"}).check();
  for(const [label,value] of [["بداية التجهيز","2026-10-27T12:00"],["بداية المناسبة","2026-10-27T20:00"],["نهاية المناسبة","2026-10-28T01:00"],["اكتمال الإرجاع","2026-10-28T12:00"]])await page.getByLabel(label,{exact:true}).fill(value);
  const previous=reads;await page.getByRole("button",{name:"حفظ موعد الحجز والفترة",exact:true}).click();await page.getByRole("status").filter({hasText:"تم حفظ موعد الحجز"}).waitFor();assert.deepEqual(puts[0].calendar,{eventDate:"2026-10-27",expectedEventDate:"2026-10-25"});await page.waitForFunction(()=>document.body.textContent?.includes("2026-10-27"));assert.ok(reads>previous,"period save refreshes original event header");
  await page.getByRole("button",{name:"تعديل",exact:true}).click();assert.equal(await page.getByLabel("التاريخ",{exact:true}).isDisabled(),true,"calendar edit uses the atomic period editor, not a competing day-only field");await page.getByLabel("اسم العريس",{exact:true}).fill("تصحيح الاسم");await page.getByRole("button",{name:"حفظ التعديلات",exact:true}).click();await page.getByRole("button",{name:"حفظ التعديلات",exact:true}).waitFor({state:"hidden"});assert.equal(patches.length,1);assert.equal(Object.hasOwn(patches[0],"eventDate"),false,"descriptive edit cannot replay a stale date after period reschedule");
  await page.screenshot({path:`tmp/photography-resource-review/register-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.getByLabel("اسم الزبون *",{exact:true}).fill("مسودة للطلب الأول");await page.getByRole("button",{name:"تبديل المناسبة",exact:true}).click();await page.getByRole("alert").filter({hasText:"تعذر قراءة المناسبة الجديدة"}).waitFor();assert.equal(await page.getByRole("heading",{name:"التسجيل السريع"}).count(),0,"new event must not inherit previous event identity or customer/payment drafts after a failed read");
  console.log(`PASS actual photo registration ${width}px: pending draft blocked, explicit read retry, original period editor and refreshed event header`);
 }finally{await context.close();}
}
}finally{await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));}
