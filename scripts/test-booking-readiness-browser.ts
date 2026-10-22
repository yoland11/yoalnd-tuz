// Real Booking Center/workspace + AJN CSS. Controlled API fixtures, never Production writes.
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
    const page=await context.newPage();let fail=false;let optedIn=false;const errors:string[]=[];let batchId="",batchWrites=0,batchAttempts=0,reminderId="",reminderWrites=0,reminderAttempts=0,groupId="",groupWrites=0,groupAttempts=0;
    page.on("pageerror",(cause:any)=>errors.push(cause.message));
    await page.route("**/api/**",async(route:any)=>{
      const request=route.request();const url=new URL(request.url());
      if(url.pathname.endsWith('/booking-operations/bulk')){assert.equal(request.method(),'POST');const command=request.postDataJSON();assert.deepEqual(command.refs,[{source:'kosha',id:12}]);assert.equal(command.confirmation,true);
        if(command.action==='send_reminder'){assert.equal(command.message,'راجع تجهيز الكوشة');reminderAttempts++;if(!reminderId){reminderId=command.requestId;reminderWrites++;return route.fulfill({status:503,json:{message:'انقطع الرد بعد إرسال التذكير',requestId:'reminder-fixture'}})}assert.equal(command.requestId,reminderId);return route.fulfill({json:{requestId:reminderId,results:[{source:'kosha',id:12,status:'success',replayed:true,updated:2,requestId:reminderId}]}})}
        assert.deepEqual(command.patch,{priority:'urgent',note:'تجهيز عاجل للحجز',assigneeId:8});batchAttempts++;if(!batchId){batchId=command.requestId;batchWrites++;return route.fulfill({status:503,json:{message:'انقطع الرد بعد حفظ التجهيز',requestId:'batch-fixture'}})}assert.equal(command.requestId,batchId,'reload retry must preserve durable batch identity');return route.fulfill({json:{requestId:batchId,results:[{source:'kosha',id:12,status:'success',replayed:true,updated:2,requestId:batchId}]}})}
      if(url.pathname.endsWith('/preparation')&&request.method()==='POST'){const command=request.postDataJSON();assert.equal(command.action,'group');assert.equal(command.department,'lighting');assert.equal(command.command,'confirm');assert.deepEqual(command.keys,['manual:light']);assert.equal(command.confirmation,true);groupAttempts++;if(!groupId){groupId=command.requestId;groupWrites++;return route.fulfill({status:503,json:{message:'انقطع الرد بعد تأكيد المجموعة',requestId:'group-fixture'}})}assert.equal(command.requestId,groupId);return route.fulfill({json:{ok:true,updated:1,replayed:true}})}
      assert.equal(request.method(),"GET","other readiness/profitability reads never mutate a booking");
      const path=url.pathname;
      if(path.endsWith('/preparation'))return route.fulfill({json:{source:'kosha',id:12,items:[{key:'manual:light',kind:'manual',manual:true,productId:null,name:'تجهيز إضافي',sku:null,department:'lighting',required:1,totalStock:0,available:0,reservedByOthers:0,shortfall:0,status:groupWrites?'ready':'preparing',preparationState:groupWrites?'ready':null,assigneeId:null,assigneeName:null,priority:'normal',deadline:null,note:null,purchaseRequested:false,evidenceCount:0},{key:'20:0',kind:'product',productId:20,name:'ورد ناقص',department:'flowers',required:2,totalStock:0,available:0,reservedByOthers:0,shortfall:2,status:'shortage',preparationState:null},{key:'21:0',kind:'product',productId:21,name:'مادة مصروفة',department:'flowers',required:3,totalStock:0,available:0,reservedByOthers:0,shortfall:3,status:'completed',preparationState:'completed',stockIssued:true}],rollup:{total:3,ready:groupWrites?1:0,completed:1,preparing:groupWrites?0:1,shortage:1,needsPurchase:0,progress:33}}});
      if(path.endsWith("/auth/me"))return route.fulfill({json:{user:{id:1,role:"admin",username:"fixture",fullName:"مدير الاختبار",isActive:true,permissions:[]}}});
      if(path.endsWith('/loading'))return route.fulfill({json:{facts:{source:'kosha',id:12,status:'confirmed',vehicle:null,staff:[],lines:[],blockers:['أكمل الصرف الأصلي']},record:null,blockers:['أكمل الصرف الأصلي'],actorId:1,canManage:true,canAct:true,returns:null}});
      if(path.endsWith('/assets'))return route.fulfill({json:{assets:[]}});
      if(path.endsWith('/conflicts'))return route.fulfill({json:{source:'kosha',id:12,checkedAt:now.toISOString(),timingComplete:false,coverage:'partial',rows:[]}});
      if(path.endsWith('/catalog'))return route.fulfill({json:{data:[]}});
      if(path.endsWith('/kosha-equipment'))return route.fulfill({json:{koshaId:null,items:[]}});
      if(path.endsWith('/custody'))return route.fulfill({json:{employeeIds:[],assets:[],reservations:[]}});
      if(path.endsWith('/admin/staff'))return route.fulfill({json:[{id:8,fullName:'موظف التجهيز',isActive:true,department:'kosha'}]});
      if(path.endsWith("/booking-center")){optedIn=url.searchParams.get("readiness")==="1";return route.fulfill({json:[centerRow]})}
      if(path.endsWith("/readiness"))return fail?route.fulfill({status:503,json:{message:"تعذر قراءة المتطلبات",code:"DATABASE_ERROR",requestId:"readiness-fixture"}}):route.fulfill({json:readiness});
      if(path.endsWith("/profitability"))return route.fulfill({json:{source:"kosha",id:12,contractValue:50000,collected:10000,receivable:40000,recognizedRevenue:null,approvedOperatingCost:5000,provisionalOperatingCost:2000,capitalInvestment:80000,estimatedMargin:43000,actualProfit:null,complete:false,reasons:["الإيراد المعترف به غير متاح؛ الربح الفعلي غير مكتمل"],costs:[{key:"transaction:9",label:"أجرة النقل",amount:5000,status:"executed",category:"operating",kind:"expense"}]}});
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
    await page.getByRole('checkbox',{name:`تحديد الحجز ${fact.number}`,exact:true}).check();
    await page.getByRole('button',{name:'تعديل حقول التجهيز',exact:true}).click();
    await page.getByRole('dialog').getByRole('combobox',{name:'موظف التجهيز (اختياري)',exact:true}).click({timeout:5000});
    await page.getByRole('option',{name:/موظف التجهيز/}).click();await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).click();
    await page.getByRole('checkbox',{name:`تحديد الحجز ${fact.number}`,exact:true}).check();await page.getByRole('button',{name:'تعديل حقول التجهيز',exact:true}).click();const batchDialog=page.getByRole('dialog');await batchDialog.getByLabel('الأولوية',{exact:true}).click();await page.getByRole('option',{name:'عاجل',exact:true}).click();await batchDialog.getByLabel('ملاحظة التجهيز (فارغ: دون تغيير)',{exact:true}).fill('تجهيز عاجل للحجز');assert.ok(await batchDialog.getByRole('button',{name:'تأكيد تحديث التجهيز',exact:true}).isDisabled());await batchDialog.getByRole('checkbox').check();await batchDialog.getByRole('button',{name:'تأكيد تحديث التجهيز',exact:true}).click();await batchDialog.getByText('انقطع الرد بعد حفظ التجهيز',{exact:true}).waitFor();await page.reload({waitUntil:'networkidle'});await page.getByRole('dialog').getByRole('button',{name:'إعادة نفس المحاولة دون تكرار',exact:true}).click();await page.getByRole('dialog').getByText(/تم سابقاً — دون تكرار/).waitFor();assert.equal(batchAttempts,2);assert.equal(batchWrites,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`bulk modal overflow ${width}`);await page.screenshot({path:`${output}/bulk-${width}.png`,fullPage:true});
    await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).click();
    await page.getByRole('checkbox',{name:`تحديد الحجز ${fact.number}`,exact:true}).check();await page.getByRole('button',{name:'إرسال تذكير تشغيلي',exact:true}).click();
    let reminderDialog=page.getByRole('dialog');await reminderDialog.getByLabel('نص التذكير',{exact:true}).fill('راجع تجهيز الكوشة');assert.ok(await reminderDialog.getByRole('button',{name:'تأكيد إرسال التذكير',exact:true}).isDisabled());await reminderDialog.getByRole('checkbox').check();await reminderDialog.getByRole('button',{name:'تأكيد إرسال التذكير',exact:true}).click();await reminderDialog.getByText('انقطع الرد بعد إرسال التذكير',{exact:true}).waitFor();
    await page.reload({waitUntil:'networkidle'});reminderDialog=page.getByRole('dialog');await reminderDialog.getByRole('button',{name:'إعادة التذكير نفسه دون تكرار',exact:true}).click();await reminderDialog.getByText(/أُرسل سابقاً — دون تكرار/).waitFor();assert.equal(reminderAttempts,2);assert.equal(reminderWrites,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`reminder modal overflow ${width}`);await page.screenshot({path:`${output}/reminder-${width}.png`,fullPage:true});
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
    await page.getByRole("tab",{name:"ربحية الحجز",exact:true}).click();
    const profit=page.getByRole("region",{name:"ربحية الحجز",exact:true});await profit.waitFor();await profit.getByText("الربحية الفعلية غير مكتملة",{exact:true}).waitFor();assert.ok(await profit.getByText("أجرة النقل",{exact:true}).isVisible());
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`profitability overflow ${width}`);await page.screenshot({path:`${output}/profitability-${width}.png`,fullPage:true});
    await page.getByRole('tab',{name:/^الأصول/}).click();const loading=page.getByRole('region',{name:'تحميل المركبة والعهدة',exact:true});await loading.waitFor();await loading.getByText('أكمل الصرف الأصلي',{exact:true}).waitFor();assert.ok(await loading.getByRole('button',{name:'إنشاء قائمة التحميل من الصرف الأصلي',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`workspace loading overflow ${width}`);await page.screenshot({path:`${output}/workspace-loading-${width}.png`,fullPage:true});
    const groups=page.getByRole('region',{name:'مجموعات التجهيز',exact:true});await groups.waitFor({timeout:5000});const lighting=groups.locator('header[aria-label="ملخص مجموعة الإضاءة"]');await lighting.getByText('تجهيز مسجّل: 0 من 1',{exact:true}).waitFor();
    const flowers=groups.locator('header[aria-label="ملخص مجموعة الزهور"]').locator('..');await flowers.getByRole('button',{name:'عرض النواقص',exact:true}).click();assert.equal(await flowers.getByText('مادة مصروفة',{exact:true}).count(),0);assert.ok(await flowers.getByText('ورد ناقص',{exact:true}).isVisible());await flowers.getByRole('button',{name:'عرض كل العناصر',exact:true}).click();
    await lighting.getByRole('button',{name:'تحديد المجموعة',exact:true}).click();await groups.getByText('تم تحديد 1',{exact:true}).waitFor();await lighting.getByRole('button',{name:'تأكيد تجهيز المجموعة',exact:true}).click();let groupDialog=page.getByRole('dialog');assert.ok(await groupDialog.getByRole('button',{name:'تأكيد تجهيز المجموعة',exact:true}).isDisabled());await groupDialog.getByRole('checkbox').check();await groupDialog.getByRole('button',{name:'تأكيد تجهيز المجموعة',exact:true}).click();await groupDialog.getByText('انقطع الرد بعد تأكيد المجموعة',{exact:true}).waitFor();
    await page.reload({waitUntil:'networkidle'});groupDialog=page.getByRole('dialog');await groupDialog.getByRole('button',{name:'إعادة إجراء المجموعة نفسه دون تكرار',exact:true}).click();await page.getByText('تأكيد المجموعة محفوظ سابقاً دون تكرار',{exact:true}).waitFor();assert.equal(groupAttempts,2);assert.equal(groupWrites,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`preparation groups overflow ${width}`);await page.screenshot({path:`${output}/groups-${width}.png`,fullPage:true});
    await page.getByRole('region',{name:'مجموعات التجهيز',exact:true}).screenshot({path:`${output}/groups-detail-${width}.png`});
    assert.equal(errors.length,0,errors.join("\n"));await context.close();
    console.log(`PASS Booking Center/workspace ${width}px: original evidence, RTL, resolution links, no overflow/writes, retry recovery`);
  }
}finally{await browser.close();await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}
