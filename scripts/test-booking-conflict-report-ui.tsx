import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {BookingConflictReport} from "../src/lib/booking-conflict-report";
(globalThis as any).React=React;
assert.ok(existsSync("src/components/booking-conflict-report.tsx"),"Assets must expose a real conflict report, not only reject writes");
const {BookingConflictReportView}=await import("../src/components/booking-conflict-report");
const data:BookingConflictReport={source:"kosha",id:7,checkedAt:"2026-10-22T10:00:00Z",timingComplete:true,coverage:"partial",rows:[{key:"quantity:30",kind:"quantity",name:"إضاءة مشتركة",state:"conflict",reason:"ناقص 3",quantities:{required:10,available:7,reserved:8,missing:3,unit:"قطعة"}},{key:"staff:2",kind:"staff",name:"أحمد محمد",state:"incomplete",reason:"مواعيد ناقصة",booking:{source:"service",id:7}}]};
const render=(props:any)=>renderToStaticMarkup(<BookingConflictReportView onRefresh={()=>{}} {...props}/>);
const html=render({data});assert.match(html,/dir="rtl"/);assert.match(html,/إضاءة مشتركة/);assert.match(html,/أحمد محمد/);assert.match(html,/المطلوب/);assert.match(html,/المتاح خلال الفترة/);assert.match(html,/المشغول/);assert.match(html,/الناقص/);assert.match(html,/\/admin\/bookings\/service\/7\?tab=assets/);assert.match(html,/جزئي/);assert.match(html,/لا يعتمد جاهزية الحجز/);assert.doesNotMatch(html.replace(/<[^>]*>/g,""),/جاهز للتنفيذ|100%|جميع الموارد متاحة/);
assert.match(html,/يشمل تكليفات التصوير المستقلة/);assert.match(html,/السجلات القديمة ذات المواعيد الناقصة/);assert.doesNotMatch(html,/مواعيد التصوير المستقلة وبعض مسارات الإسناد لم تُستكمل/);
for(const state of [{error:new Error("storage failed"),data},{loading:true,data}]){const current=render(state);assert.doesNotMatch(current,/إضاءة مشتركة|أحمد محمد/,"stale successful results cannot remain authoritative during a failed or pending refresh")}
assert.match(render({error:new Error("storage failed")}),/role="alert"/);assert.match(render({loading:true}),/تحميل فحص التعارضات/);assert.match(render({data:{...data,rows:[],timingComplete:false}}),/مواعيد التشغيل غير مكتملة/);assert.match(render({data:{...data,rows:[]}}),/لم تُسجل موارد/);
assert.match(render({data:{...data,rows:[{...data.rows[1],booking:{source:"photography",id:7}}]}}),/\/staff\/photography\/events\/7\/register/,"standalone conflict must open the original authorized event by numeric ID, not a fake central booking or private client token");
console.log("PASS actual Arabic RTL report: shortages, exact cross-source links, incomplete coverage, error/loading hide stale availability and no fabricated readiness");
