// Actual BookingOperationsWorkspace, report, period editor and AJN CSS.
// External API IO is controlled; no Production or PostgreSQL writes.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {realpathSync} from "node:fs";
import {readFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve} from "node:path";
import {evaluateBookingReadiness} from "../src/lib/booking-operational-readiness";
const runtime=process.env.AJN_BROWSER_RUNTIME;assert.ok(runtime,"Set AJN_BROWSER_RUNTIME to installed Playwright package.json");
const {chromium}=createRequire(runtime)("playwright");
const esbuild=createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss=createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind=createRequire(resolve("package.json"))("@tailwindcss/postcss");
const styles=(await postcss([tailwind()]).process(await readFile("src/index.css","utf8"),{from:resolve("src/index.css")})).css+await readFile("src/views/admin/booking-operations-workspace.css","utf8");
const booking={source:"kosha",id:7,number:"AJN-KOSHA-0007",customerName:"أحمد محمد حسين",phone:"07700000000",eventDate:"2026-10-22",eventTime:"20:00",hall:"بغداد",status:"confirmed",total:200000,paid:0,remaining:200000,paymentStatus:"unpaid",services:[{type:"kosha",status:"waiting"}],raw:{}};
const bundle=await esbuild.build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {PrintProvider} from './src/components/print/print-provider';import {TooltipProvider} from './src/components/ui/tooltip';import {BookingOperationsWorkspace} from './src/views/admin/booking-operations-workspace';function App(){const [booking,setBooking]=useState(${JSON.stringify(booking)});window.switchBooking=source=>setBooking(b=>({...b,source,number:source==='kosha'?'AJN-KOSHA-0007':'BK-0007'}));return <BookingOperationsWorkspace booking={booking}/>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TooltipProvider><PrintProvider><App/></PrintProvider></TooltipProvider></QueryClientProvider>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:".next/conflict-report-browser-bundle",platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"development"'}});
const javascript=bundle.outputFiles.find((file:any)=>file.path.endsWith(".js"))!.text;
const output="output/booking-conflict-report-review";await mkdir(output,{recursive:true});
const server=createServer((req,res)=>{
 if(req.url==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(javascript)}
 else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(styles)}
 else {res.setHeader("Content-Type","text/html;charset=utf-8");res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1440px;margin:auto"></main><script src="/fixture.js"></script></body></html>')}
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
try{for(const width of [1440,768,390]){
 const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:"ajn_admin_session",value:"conflict-fixture",url:origin}]);const page=await context.newPage();
 let fail=false,version=0,reads=0,writes=0,delay=false,arrived!:()=>void,release!:()=>void;let arrival=Promise.resolve(),pending=Promise.resolve();
 const errors:string[]=[];page.on("pageerror",(error:any)=>errors.push(error.message));page.setDefaultTimeout(10000);
 const window={preparationStart:"2026-10-22T12:00:00+03:00",eventStart:"2026-10-22T20:00:00+03:00",eventEnd:"2026-10-23T01:00:00+03:00",returnEnd:"2026-10-23T12:00:00+03:00"};
 await page.route("**/api/**",async(route:any)=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path.endsWith("/resource-window")){
   if(request.method()==="PUT"){writes++;Object.assign(window,request.postDataJSON().window);version++;return route.fulfill({json:{ok:true,resourceWindow:window}})}
   return route.fulfill({json:{resourceWindow:window,expectedWindow:window,eventDate:"2026-10-22",eventTime:"20:00",canEdit:true}});
  }
  assert.equal(request.method(),"GET","report browsing must not mutate booking, inventory or finance");
  if(path.endsWith("/conflicts")){
   reads++;if(delay){delay=false;arrived();await pending}
   if(fail)return route.fulfill({status:503,json:{message:"تعذر اتصال قاعدة البيانات — REQ-fixture",requestId:"REQ-fixture"}});
   const source=path.includes("/service/")?"service":"kosha";
   return route.fulfill({json:{source,id:7,checkedAt:new Date().toISOString(),timingComplete:true,coverage:"partial",rows:[{key:"quantity:30",kind:"quantity",name:source==="service"?"إضاءة الخدمة":version?"إضاءة بعد تحديث المواعيد":"إضاءة مشتركة طويلة الاسم لاختبار عرض التفاصيل في الموبايل",state:"conflict",reason:"تعارض بالمعدات — ناقص 3",quantities:{required:10,available:7,reserved:8,missing:3,unit:"قطعة"}},{key:"staff:2",kind:"staff",name:"أحمد محمد",state:"incomplete",reason:"مواعيد الحجز الآخر غير مكتملة",booking:{source:source==="service"?"kosha":"service",id:7}},{key:"vehicle:4",kind:"vehicle",name:"سيارة النقل",state:"no_conflict",reason:"لم يظهر تعارض ضمن الفحوص المتاحة"}]}});
  }
  if(path.endsWith("/auth/me"))return route.fulfill({json:{user:{id:1,role:"admin",username:"fixture",fullName:"مدير",isActive:true,permissions:[]}}});
  if(path.endsWith("/overview"))return route.fulfill({json:{bookingStage:"booked",warehouseStage:"reserved",warehouseHistory:[],counts:{products:0,assets:0,tasks:0,completedTasks:0,documents:0,alerts:0},alerts:[],recentActivity:[]}});
  if(path.endsWith("/readiness"))return route.fulfill({json:{...evaluateBookingReadiness([]),generatedAt:new Date().toISOString()}});
  if(path.endsWith("/branches"))return route.fulfill({json:{data:[],assignments:[]}});
  if(path.endsWith("/staff-assignment"))return route.fulfill({json:{types:["kosha"],assignedStaff:[],eligibleStaff:[]}});
  if(path.endsWith("/penalties/indicators"))return route.fulfill({json:{indicators:{}}});
  if(path.endsWith("/transportation"))return route.fulfill({json:{transportation:{mode:"customer",fee:0}}});
  if(path.endsWith("/group-attendees"))return route.fulfill({json:{attendees:[]}});
  if(path.endsWith("/assets"))return route.fulfill({json:{assets:[]}});
  if(path.endsWith("/catalog"))return route.fulfill({json:{data:[]}});
  if(path.endsWith("/kosha-equipment"))return route.fulfill({json:{koshaId:null,items:[]}});
  if(path.endsWith("/custody"))return route.fulfill({json:{employeeIds:[],assets:[],reservations:[]}});
  if(path.endsWith("/preparation"))return route.fulfill({json:{source:"kosha",id:7,items:[],rollup:{total:0,ready:0,completed:0,preparing:0,shortage:0,needsPurchase:0,progress:0}}});
  if(path.endsWith("/loading"))return route.fulfill({json:{facts:{source:"kosha",id:7,status:"confirmed",vehicle:null,staff:[],lines:[],blockers:["أكمل الصرف الأصلي"]},record:null,blockers:["أكمل الصرف الأصلي"],actorId:1,canManage:true,canAct:true,returns:null}});
  if(path.endsWith("/admin/staff"))return route.fulfill({json:[]});
  if(/notifications/.test(path))return route.fulfill({json:{data:[],unreadCount:0}});
  return route.fulfill({json:{}});
 });
 try{
  await page.goto(`${origin}/admin/bookings/kosha/7?tab=assets`,{waitUntil:"networkidle"});
  const panel=()=>page.getByRole("region",{name:"فحص تعارضات الموارد",exact:true});
  await panel().getByText("تعارض بالمعدات — ناقص 3",{exact:true}).waitFor();
  const link=panel().getByRole("link",{name:/مراجعة الحجز الآخر/});assert.equal(await link.getAttribute("href"),"/admin/bookings/service/7?tab=assets");
  const checkbox=panel().getByRole("checkbox");await checkbox.focus();await checkbox.press("Space");await panel().getByText("سيارة النقل",{exact:true}).waitFor();
  const contrast=await panel().evaluate(new Function("root",`
    const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const ctx=canvas.getContext("2d");
    const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};
    const lum=rgb=>rgb.slice(0,3).map(c=>{const s=c/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;let worst={ratio:99,text:""};
    while(node=walker.nextNode()){const parent=node.parentElement;if(!parent||!node.textContent?.trim()||parent.closest("svg,style,script"))continue;const foreground=rgba(getComputedStyle(parent).color);let ancestor=parent,background=[255,255,255,255];while(ancestor){const bg=rgba(getComputedStyle(ancestor).backgroundColor);if(bg[3]===255){background=bg;break}ancestor=ancestor.parentElement}const fg=foreground.map((c,i)=>i===3?255:c*foreground[3]/255+background[i]*(1-foreground[3]/255));const a=lum(fg),b=lum(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);if(ratio<worst.ratio)worst={ratio,text:node.textContent.trim()}}
    return worst;
  `) as any);assert.ok(contrast.ratio>=4.5,`report text contrast ${JSON.stringify(contrast)}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`workspace RTL overflow ${width}`);
  await panel().screenshot({path:`${output}/report-${width}.png`});await page.screenshot({path:`${output}/workspace-${width}.png`,fullPage:true});
  const before=reads;await page.getByLabel("اكتمال الإرجاع",{exact:true}).fill("2026-10-24T12:00");await page.getByRole("button",{name:"حفظ فترة التشغيل",exact:true}).click();
  await panel().getByText("إضاءة بعد تحديث المواعيد",{exact:true}).waitFor();assert.ok(reads>before,"period save invalidates the same original booking report");assert.equal(writes,1);
  fail=true;await panel().getByRole("button",{name:"تحديث فحص التعارضات",exact:true}).click();await panel().getByText("تعذر فحص التعارضات",{exact:true}).waitFor();assert.equal(await panel().getByText("إضاءة بعد تحديث المواعيد",{exact:true}).count(),0);
  fail=false;await panel().getByRole("button",{name:"تحديث فحص التعارضات",exact:true}).click();await panel().getByText("إضاءة بعد تحديث المواعيد",{exact:true}).waitFor();
  delay=true;arrival=new Promise<void>(done=>arrived=done);pending=new Promise<void>(done=>release=done);await panel().getByRole("button",{name:"تحديث فحص التعارضات",exact:true}).click();await arrival;
  await page.evaluate(()=>(window as any).switchBooking("service"));await panel().getByText("إضاءة الخدمة",{exact:true}).waitFor();release();
  await panel().getByRole("button",{name:"تحديث فحص التعارضات",exact:true}).waitFor();assert.equal(await panel().getByText("إضاءة بعد تحديث المواعيد",{exact:true}).count(),0,"late old-source response cannot show on the new source");
  assert.equal(await panel().getByRole("link",{name:/مراجعة الحجز الآخر/}).getAttribute("href"),"/admin/bookings/kosha/7?tab=assets");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`source change overflow ${width}`);assert.equal(errors.length,0,errors.join("\n"));
  console.log(`PASS actual Booking Workspace ${width}px: original report/period integration, cross-source links, keyboard filter, read failure recovery, late-source isolation, no overflow or uncontrolled writes`);
 }catch(error){console.error("Fixture page errors:",errors.join(" | "));console.error("Fixture body:",(await page.locator("body").innerText()).slice(0,900));await page.screenshot({path:`${output}/failure-${width}.png`,fullPage:true});throw error}finally{release?.();await context.close()}
}}finally{await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()))}
