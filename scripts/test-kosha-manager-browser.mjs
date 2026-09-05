// Presentation-only fixtures. Every API request is intercepted; no database writes.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const require=createRequire(process.env.AJN_BROWSER_RUNTIME);
const { chromium }=require("playwright");
const origin="http://127.0.0.1:3105";
const b={id:11,source:"kosha",number:"K-11",koshaId:2,koshaName:"كوشة الأعراس البيضاء — اختبار واجهة",koshaImage:null,customerName:"أحمد محمد عبد الرحمن وزهراء علي",phone:"07700000000",brideName:"زهراء",groomName:"أحمد",eventDate:"2026-09-16",eventTime:"16:00",eventType:"زفاف",status:"confirmed",paymentStatus:"partial",totalAmount:125000,paidAmount:50000,remainingAmount:75000,executionStage:"preparing",createdAt:"2026-08-01",updatedAt:"2026-09-05",bookingDetails:{},venueImages:[],assignedEmployees:[],activity:{photos:4,notes:1,problems:1,openProblems:1,latestAt:"2026-09-05",latestBy:null,latestLabel:null},transportationMode:"customer"};
const detail={booking:b,media:[],timeline:[{id:"note:1",type:"note",title:"ملاحظة الكادر",note:"اختبار عرض ملاحظة التنفيذ",staffName:"موظف اختبار",createdAt:"2026-09-05T12:00:00Z"}],damages:[{id:1,kind:"damage",description:"مشكلة اختبار — دون تغيير بيانات",status:"open",priority:"low",canResolve:false}],referencePhotos:[],assignedStaff:[],delivery:null,workOrder:null,permissions:{execution:true,resolveProblems:false}};
const browser=await chromium.launch({channel:"msedge",headless:true});
try {
const context=await browser.newContext({viewport:{width:1536,height:1024}});
await context.addCookies([{name:"ajn_admin_session",value:"presentation-fixture-only",url:origin}]);
const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));let failed=false;
await page.route("**/api/**",async route=>{
 const u=new URL(route.request().url());const p=u.pathname;
 if(p.endsWith("/admin/auth/me"))return route.fulfill({json:{user:{id:1,role:"admin",username:"fixture",fullName:"مدير اختبار",isActive:true,permissions:[]}}});
 if(p.endsWith("/kosha-bookings/manager-view"))return failed?route.fulfill({status:500,json:{error:{message:"اختبار فشل التحميل",code:"TEST_ERROR"}}}):route.fulfill({json:{items:u.searchParams.get("search")==="لايوجد"?[]:[b],total:u.searchParams.get("search")==="لايوجد"?0:1,page:1,pageSize:10,stats:{total:1,completed:0,inProgress:0,upcoming:1,cancelled:0},koshas:[{id:2,name:"البيضاء"}]}});
 if(p.endsWith("/11/manager-view"))return route.fulfill({json:detail});
 if(p.includes("settings"))return route.fulfill({json:{}});
 if(p.includes("notifications"))return route.fulfill({json:{items:[],unreadCount:0}});
 return route.fulfill({json:[]});
});
await page.goto(`${origin}/admin/kosha-bookings`);
await page.getByRole("heading",{name:"حجوزات الكوشات",exact:true}).waitFor({timeout:60000});
await page.getByRole("button",{name:"تفاصيل",exact:true}).first().waitFor();
mkdirSync("output/kosha-manager",{recursive:true});
await page.screenshot({path:"output/kosha-manager/desktop.png",fullPage:true});
await page.getByRole("button",{name:"تفاصيل",exact:true}).first().click();
await page.getByRole("heading",{name:"تفاصيل الحجز",exact:true}).waitFor();
await page.getByText("40% مدفوع",{exact:false}).waitFor();
await page.getByRole("heading",{name:"تنفيذ الكادر",exact:true}).waitFor();
await page.screenshot({path:"output/kosha-manager/details.png",fullPage:true});
await page.getByRole("button",{name:"طباعة ملصق",exact:true}).click();
await page.getByRole("heading",{name:"معاينة طباعة الحجز"}).waitFor();
await page.getByRole("button",{name:"80mm",exact:true}).click();
await page.getByRole("button",{name:"إلغاء",exact:true}).click();
await page.getByRole("button",{name:"إغلاق",exact:true}).last().click();
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:"output/kosha-manager/mobile.png",fullPage:true});
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"Mobile document must not overflow horizontally");
await page.getByPlaceholder("ابحث بالاسم أو الهاتف أو رقم الحجز…").fill("لايوجد");
await page.getByText("لا توجد حجوزات مطابقة",{exact:true}).waitFor();
assert.deepEqual(errors,[],"No runtime React errors");
console.log("PASS: presentation fixtures — desktop/mobile, quick details, canonical amount display, thermal preview and empty state");
}finally{await browser.close();}
