// Presentation-only fixtures. Every API request is intercepted; no database writes.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const require=createRequire(process.env.AJN_BROWSER_RUNTIME);
const { chromium }=require("playwright");
const origin="http://127.0.0.1:3105";
const b={id:11,source:"kosha",number:"K-11",koshaId:2,koshaName:"كوشة الأعراس البيضاء — اختبار واجهة",koshaImage:null,customerName:"أحمد محمد عبد الرحمن وزهراء علي",phone:"07700000000",brideName:"زهراء",groomName:"أحمد",eventDate:"2026-09-16",eventTime:"16:00",eventType:"زفاف",status:"confirmed",paymentStatus:"partial",totalAmount:125000,paidAmount:50000,remainingAmount:75000,executionStage:"preparing",createdAt:"2026-08-01",updatedAt:"2026-09-05",bookingDetails:{},venueImages:[],assignedEmployees:[],activity:{photos:4,notes:1,problems:1,openProblems:1,latestAt:"2026-09-05",latestBy:null,latestLabel:null},transportationMode:"customer"};
const detail={booking:b,media:[
 {id:"media:1",url:"/uploads/staff/execution-one.webp",kind:"image",purpose:"execution",stage:"executing",staffName:"منفذ اختبار",createdAt:"2026-09-06T09:00:30.000Z"},
 {id:"media:2",url:"/uploads/staff/execution-later.webp",kind:"image",purpose:"execution",stage:"executing",staffName:"منفذ اختبار",createdAt:"2026-09-06T09:04:00.000Z"},
 {id:"media:3",url:"/uploads/staff/problem.webp",kind:"image",purpose:"damage",stage:"before_return",staffName:"منفذ اختبار",createdAt:"2026-09-06T09:05:00.000Z"},
 {id:"media:4",url:"/uploads/staff/execution-video.mp4",kind:"video",purpose:"execution",stage:"executing",staffName:"منفذ اختبار",createdAt:"2026-09-06T09:08:00.000Z"}
],timeline:[
 {id:"note:1",type:"note",title:"ملاحظة الكادر",note:"اختبار عرض ملاحظة التنفيذ",staffName:"موظف اختبار",createdAt:"2026-09-05T12:00:00Z"},
 {id:"event:2",type:"stage_changed",title:"تحديث مرحلة",note:"أحدث نشاط موظف يجب الإقرار به",staffName:"موظف اختبار",createdAt:"2026-09-06T09:10:00.000Z"},
 {id:"instruction-audit:33",type:"instruction_edited",title:"تعديل تعليمات المدير",note:"لا تظهر هذه كملاحظة موظف",staffName:"مدير اختبار",createdAt:"2026-09-06T09:12:00.000Z"}
],damages:[{id:1,kind:"damage",description:"مشكلة اختبار — دون تغيير بيانات",status:"open",priority:"low",photoUrl:"/uploads/staff/problem-report.webp",staffName:"منفذ اختبار",createdAt:"2026-09-06T09:06:00.000Z",resolvedAt:null,canResolve:false}],referencePhotos:[],assignedStaff:[{id:7,name:"سارة علي",role:"leader"},{id:8,name:"حيدر حسن",role:"assistant"}],delivery:null,workOrder:null,permissions:{execution:true,resolveProblems:false,manageInstructions:true}};
const instructions={instructions:[
 {id:31,bookingSource:"kosha",bookingId:11,kind:"image",mediaUrl:"/uploads/kosha/instructions/reference-one.webp",caption:"اجعل الورود البيضاء أعلى القوس",uploadedByStaffId:1,uploadedByName:"مدير اختبار",revision:1,createdAt:"2026-09-06T08:00:00.000Z",updatedAt:"2026-09-06T08:00:00.000Z",archivedAt:null,archivedByStaffId:null},
 {id:32,bookingSource:"kosha",bookingId:11,kind:"note",mediaUrl:null,caption:"ترك مسافة واضحة للمرور خلف الكوشة.",uploadedByStaffId:1,uploadedByName:"مدير اختبار",revision:2,createdAt:"2026-09-06T08:05:00.000Z",updatedAt:"2026-09-06T08:06:00.000Z",archivedAt:null,archivedByStaffId:null}
],latestAt:"2026-09-06T08:06:00.000Z",viewedAt:null,unreadCount:2};
const reads={latestAt:instructions.latestAt,staff:[{id:7,name:"سارة علي",viewedAt:"2026-09-06T08:10:00.000Z",hasViewedLatest:true},{id:8,name:"حيدر حسن",viewedAt:null,hasViewedLatest:false}]};
const browser=await chromium.launch({channel:"msedge",headless:true});
try {
const context=await browser.newContext({viewport:{width:1536,height:1024}});
await context.addCookies([{name:"ajn_admin_session",value:"presentation-fixture-only",url:origin}]);
const page=await context.newPage();const errors=[];const executionViewed=[];const uploadCreates=[];let currentUser={id:1,role:"admin",username:"fixture",fullName:"مدير اختبار",isActive:true,permissions:[]};let canManageInstructions=true;let authMeCalls=0;let failNextAck=false;let uploadCreateIndex=0;let resolveViewed;const viewedPromise=new Promise(resolve=>{resolveViewed=resolve;});page.on("pageerror",e=>errors.push(e.message));let failed=false;
await page.route("**/api/**",async route=>{
 const u=new URL(route.request().url());const p=u.pathname;
 if(p.endsWith("/admin/auth/me")){authMeCalls++;return route.fulfill({json:{user:currentUser}});}
 if(p.endsWith("/uploads/images/init"))return route.fulfill({json:{url:`/uploads/kosha/instructions/test-${Date.now()}-${Math.random().toString(36).slice(2)}.webp`}});
 if(p.endsWith("/kosha-bookings/manager-view"))return failed?route.fulfill({status:500,json:{error:{message:"اختبار فشل التحميل",code:"TEST_ERROR"}}}):route.fulfill({json:{items:u.searchParams.get("search")==="لايوجد"?[]:[b],total:u.searchParams.get("search")==="لايوجد"?0:1,page:1,pageSize:10,stats:{total:1,completed:0,inProgress:0,upcoming:1,cancelled:0},koshas:[{id:2,name:"البيضاء"}]}});
 if(p.endsWith("/11/manager-view"))return route.fulfill({json:{...detail,permissions:{...detail.permissions,manageInstructions:canManageInstructions}}});
 if(p.endsWith("/11/manager-view/instructions")&&route.request().method()==="GET")return route.fulfill({json:instructions});
 if(p.endsWith("/11/manager-view/instructions")&&route.request().method()==="POST"){const payload=route.request().postDataJSON();uploadCreates.push(payload);uploadCreateIndex++;return uploadCreateIndex%2===0?route.fulfill({status:500,json:{message:"فشل حفظ صورة اختبار",code:"TEST_ERROR"}}):route.fulfill({json:{instruction:{...instructions.instructions[0],id:90+uploadCreateIndex,mediaUrl:payload.mediaUrl,caption:payload.caption??null}}});}
 if(p.endsWith("/11/manager-view/instruction-reads"))return route.fulfill({json:reads});
 if(p.endsWith("/11/manager-view/execution-viewed")){const payload=route.request().postDataJSON();executionViewed.push(payload);resolveViewed();if(failNextAck){failNextAck=false;return route.fulfill({status:500,json:{message:"تعذر تسجيل القراءة",code:"TEST_ERROR"}});}return route.fulfill({json:{viewedAt:payload.viewedThrough}});}
 if(p.includes("settings"))return route.fulfill({json:{}});
 if(p.includes("notifications"))return route.fulfill({json:{items:[],unreadCount:0}});
 return route.fulfill({json:[]});
});
await page.goto(`${origin}/admin/kosha-bookings`);
await page.getByRole("heading",{name:"حجوزات الكوشات",exact:true}).waitFor({timeout:60000});
await page.getByRole("button",{name:"تفاصيل",exact:true}).first().waitFor();
mkdirSync("output/kosha-manager",{recursive:true});
await page.screenshot({path:"output/kosha-manager/desktop.png",fullPage:true});
const authMeCallsBeforeDetails=authMeCalls;
await page.getByRole("button",{name:"تفاصيل",exact:true}).first().click();
await page.getByRole("heading",{name:"تفاصيل الحجز",exact:true}).waitFor();
await page.getByText("40% مدفوع",{exact:false}).waitFor();
await page.getByRole("heading",{name:"تنفيذ الكادر",exact:true}).waitFor();
await page.getByRole("heading",{name:"تعليمات المدير",exact:true}).waitFor();
await page.getByRole("button",{name:"إضافة صورة",exact:true}).waitFor();
await page.getByRole("button",{name:"إضافة ملاحظة",exact:true}).waitFor();
assert.equal(authMeCalls,authMeCallsBeforeDetails,"Instruction controls must use manager detail permissions without an extra /admin/auth/me dependency");
await page.getByRole("button",{name:"تكبير صورة تعليمات المدير: اجعل الورود البيضاء أعلى القوس",exact:true}).waitFor();
await page.getByText("ترك مسافة واضحة للمرور خلف الكوشة.",{exact:true}).waitFor();
await page.getByText("سارة علي · شوهد",{exact:false}).waitFor();
await page.getByText("حيدر حسن · لم يشاهد بعد",{exact:true}).waitFor();
await page.getByText("اختبار عرض ملاحظة التنفيذ",{exact:true}).first().waitFor();
assert.equal(await page.getByText("لا تظهر هذه كملاحظة موظف",{exact:true}).count(),1,"Manager instruction audit events must stay in history only, not be duplicated as employee notes");
await page.getByRole("button",{name:"تكبير صورة تعليمات المدير: اجعل الورود البيضاء أعلى القوس",exact:true}).click();
await page.getByRole("dialog",{name:"عارض صور تعليمات المدير"}).waitFor();
await page.keyboard.press("Escape");
await Promise.race([viewedPromise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("execution-viewed request was not sent")),5000))]);
assert.deepEqual(executionViewed,[{viewedThrough:"2026-09-06T09:10:00.000Z"}],"Manager render acknowledgement must use the latest eligible staff activity snapshot and exclude later manager instruction audits");
await page.getByRole("button",{name:"إضافة صورة",exact:true}).click();
await page.getByLabel("تسمية أو ملاحظة مشتركة للصور").fill("دفعة رفع اختبار");
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luzp7wAAAABJRU5ErkJggg==","base64");
await page.getByLabel("اختيار صور تعليمات المدير").setInputFiles([{name:"ok.png",mimeType:"image/png",buffer:png},{name:"fail.png",mimeType:"image/png",buffer:png}]);
await page.getByText("تم الحفظ",{exact:true}).waitFor();
await page.getByText("فشل جزئي",{exact:true}).waitFor();
assert.equal(uploadCreates.filter(item=>item.kind==="image"&&item.caption==="دفعة رفع اختبار").length,2,"Each selected file keeps the caption captured for its own upload batch");
await page.screenshot({path:"output/kosha-manager/details.png",fullPage:true});
await page.getByRole("button",{name:"طباعة ملصق",exact:true}).click();
await page.getByRole("heading",{name:"معاينة طباعة الحجز"}).waitFor();
await page.getByRole("button",{name:"80mm",exact:true}).click();
await page.getByRole("button",{name:"إلغاء",exact:true}).click();
await page.getByRole("button",{name:"إغلاق",exact:true}).last().click();
await page.setViewportSize({width:390,height:844});
await page.getByRole("button",{name:"تفاصيل",exact:true}).first().click();
await page.getByRole("heading",{name:"تعليمات المدير",exact:true}).waitFor();
await page.getByRole("button",{name:"تكبير صورة تعليمات المدير: اجعل الورود البيضاء أعلى القوس",exact:true}).click();
await page.getByRole("dialog",{name:"عارض صور تعليمات المدير"}).waitFor();
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"Mobile quick details viewer must not overflow horizontally");
await page.keyboard.press("Escape");
await page.getByRole("button",{name:"إغلاق",exact:true}).last().click();
await page.screenshot({path:"output/kosha-manager/mobile.png",fullPage:true});
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"Mobile document must not overflow horizontally");
currentUser={id:2,role:"employee",username:"viewer",fullName:"مشاهد فقط",isActive:true,permissions:["orders","booking_operations_view","koshas"]};
canManageInstructions=false;
await page.reload();
await page.getByRole("heading",{name:"حجوزات الكوشات",exact:true}).waitFor();
await page.getByRole("button",{name:"تفاصيل",exact:true}).first().click();
await page.getByRole("heading",{name:"تعليمات المدير",exact:true}).waitFor();
assert.equal(await page.getByRole("button",{name:"إضافة صورة",exact:true}).count(),0,"View-only sessions must not see image mutation controls");
assert.equal(await page.getByRole("button",{name:"إضافة ملاحظة",exact:true}).count(),0,"View-only sessions must not see note mutation controls");
assert.equal(await page.getByRole("button",{name:"أرشفة التعليمات",exact:true}).count(),0,"View-only sessions must not see archive controls");
assert.equal(await page.getByRole("button",{name:"تعديل الملاحظة أو التسمية",exact:true}).count(),0,"View-only sessions must not see edit controls");
await page.getByRole("button",{name:"إغلاق",exact:true}).last().click();
currentUser={id:1,role:"admin",username:"fixture",fullName:"مدير اختبار",isActive:true,permissions:[]};
canManageInstructions=true;
failNextAck=true;
executionViewed.length=0;
await page.reload();
await page.getByRole("heading",{name:"حجوزات الكوشات",exact:true}).waitFor();
await page.getByRole("button",{name:"تفاصيل",exact:true}).first().click();
await page.getByRole("alert").filter({hasText:"تعذر تسجيل قراءة تنفيذ الكادر"}).waitFor();
assert.deepEqual(executionViewed,[{viewedThrough:"2026-09-06T09:10:00.000Z"}],"Ack failure must wait for the visible retry control before resending");
await page.getByRole("button",{name:"إعادة تسجيل القراءة",exact:true}).click();
await page.waitForFunction(()=>document.body.innerText.includes("تم تسجيل قراءة تنفيذ الكادر"),null,{timeout:5000});
assert.deepEqual(executionViewed,[{viewedThrough:"2026-09-06T09:10:00.000Z"},{viewedThrough:"2026-09-06T09:10:00.000Z"}],"Retry must resend the captured staff execution snapshot exactly");
await page.getByRole("button",{name:"إغلاق",exact:true}).last().click();
await page.getByPlaceholder("ابحث بالاسم أو الهاتف أو رقم الحجز…").fill("لايوجد");
await page.getByText("لا توجد حجوزات مطابقة",{exact:true}).waitFor();
assert.deepEqual(errors,[],"No runtime React errors");
console.log("PASS: presentation fixtures — desktop/mobile, quick details, canonical amount display, thermal preview and empty state");
}finally{await browser.close();}
