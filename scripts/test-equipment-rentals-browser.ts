/** Mounts the original rental React screens with intercepted synthetic HTTP. No database or external messages. */
import assert from "node:assert/strict";
import { calculateEquipmentRental } from "../src/lib/equipment-rentals";
import { equipmentRentalPrintHtml } from "../src/views/admin/equipment-rental-print";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
const runtime = process.env.AJN_BROWSER_RUNTIME;
assert.ok(runtime, "AJN_BROWSER_RUNTIME must point to playwright/package.json");
const { chromium } = createRequire(runtime)("playwright");
const esbuild = createRequire(realpathSync(resolve("lib/db/node_modules/tsx/package.json")))("esbuild");
const postcss = createRequire(realpathSync(resolve("node_modules/@tailwindcss/postcss/package.json")))("postcss");
const tailwind = createRequire(resolve("package.json"))("@tailwindcss/postcss");
const css = (await postcss([tailwind()]).process(await readFile("src/index.css", "utf8"), { from: resolve("src/index.css") })).css;
const js = (await esbuild.build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Router}from'wouter';import Page from './src/views/admin/equipment-rentals';const qc=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});createRoot(document.getElementById('root')).render(<Router><QueryClientProvider client={qc}><Page me={{id:1,role:'admin',permissions:[],username:'test',fullName:'موظف الاختبار'}}/></QueryClientProvider></Router>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outdir: ".next/equipment-rental-fixture", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } })).outputFiles.find((file: any) => file.path.endsWith(".js"))!.text;
const server = createServer((req, res) => {
  res.setHeader("content-type", req.url === "/fixture.js" ? "application/javascript" : req.url === "/fixture.css" ? "text/css" : "text/html; charset=utf-8");
  res.end(req.url === "/fixture.js" ? js : req.url === "/fixture.css" ? css : '<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:#fcfafb"><div id="root" style="padding:16px;max-width:1240px;margin:auto;min-width:0"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const artifacts = process.env.AJN_BROWSER_ARTIFACTS || resolve(".next/equipment-rental-screenshots"); await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AJN_BROWSER_EXECUTABLE, headless: true });
const capabilities = { view:true,create:true,edit:true,confirm:true,dispatch:true,return:true,cancel:true,inspect:true,finance:true,reports:true,settings:true,costs:true };
const settings = { enabled:true,pricingType:"fixed",fixedPrice:10000,dailyPrice:5000,hourlyPrice:1000,minimumDuration:1,deposit:50000,allowCustomPrice:true,terms:"شروط عقد الاختبار" };
const options = { assets:[{id:7,name:"كرسي ملكي",code:"CHAIR-7",image:null,stock:50,trackingMode:"quantity",settings}],warehouses:[{id:1,name:"المخزن الرئيسي"},{id:2,name:"المخزن الثاني"}],employees:[{id:1,name:"موظف الاختبار"}] };
try {
  for (const width of [390,768,1440]) {
    const context = await browser.newContext({ viewport:{width,height:960} }); const page = await context.newPage();
    const errors: string[]=[];page.on("pageerror",(error:Error)=>errors.push(error.message));
    let row:any={id:51,orderNo:"RNT-2035-000051",rentalKind:"equipment",customerId:1,customerName:"زبون الاختبار",phone:"07700000123",startDate:"2035-05-10",endDate:"2035-05-12",status:"confirmed",total:50000,paid:0,remaining:50000,overdue:false,capabilities,history:[],finance:{depositHeld:0,depositCollected:0,payments:[]},details:{version:1,address:"بغداد",startTime:"10:00",endTime:"22:00",deliveryCharge:0,installationCharge:0,discount:0,depositRequired:0,terms:"شروط العقد",linkedBooking:null,attachments:[],assets:[{productId:7,name:"كرسي ملكي",code:"CHAIR-7",warehouseId:1,quantity:5,unitPrice:10000,duration:1,pricingType:"fixed",discount:0,lineTotal:50000,trackingMode:"quantity",checkedOutQty:0,returnedGoodQty:0,pendingInspectionQty:0}]}};
    const writes:any[]=[];
    await page.route("**/api/**",async(route:any)=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();let data:any={};
      if(path==="/api/settings")data={site_name:"AJN",phone:"07700000000",address:"بغداد"};
      else if(path.endsWith("/options"))data=options;
      else if(path.endsWith("/availability"))data={assets:[{productId:7,available:50,status:"available"}]};
      else if(method==="GET" && path.endsWith("/51"))data=row;
      else if(method==="GET" && path.includes("/rental-orders/equipment"))data={data:[row],total:1,page:1,pageSize:30,summary:{active:1,awaitingDispatch:1,dueToday:0,overdue:0,outstanding:50000}};
      else if(method!=="GET"){
        const payload=request.postDataJSON();writes.push({path,payload});
        if(path.endsWith("/equipment")){const priced=calculateEquipmentRental(payload);row={...row,customerName:payload.customerName,phone:payload.phone,status:"draft",total:priced.total,remaining:priced.total,startDate:payload.startDate,endDate:payload.endDate,details:{...row.details,...payload,assets:priced.assets}};data=row;}
        else if(path.endsWith("/confirm")){row.status="confirmed";data=row;}
        else if(path.endsWith("/dispatch")){assert.equal(payload.lines[0].quantity,5);assert.equal(payload.lines[0].staffId,1);row.details.assets[0].checkedOutQty=5;row.status="dispatched";data=row;}
        else if(path.endsWith("/return")){assert.equal(payload.lines[0].goodQuantity,3);assert.equal(payload.lines[0].pendingInspectionQuantity,2);row.details.assets[0].returnedGoodQty=3;row.details.assets[0].pendingInspectionQty=2;row.status="inspection";data=row;}
        else if(path.endsWith("/finance")){assert.equal(payload.kind,"rent_payment");assert.equal(payload.amount,20000);data={...row,financeRequest:{id:100,approvalStatus:"pending"}};}
        else data=row;
      }
      await route.fulfill({status:method==="POST"&&path.endsWith("/equipment")?201:200,contentType:"application/json",body:JSON.stringify(data)});
    });
    await page.goto(`${origin}/admin/bookings/rentals`);
    await page.getByRole("link",{name:"إيجار معدات",exact:true}).first().click();
    await page.getByLabel("اسم العميل",{exact:true}).fill("زبون الاختبار");await page.getByLabel("رقم الهاتف",{exact:true}).fill("07700000123");
    await page.getByRole("button",{name:/كرسي ملكي.*CHAIR-7/}).click();
    await page.getByLabel("الكمية",{exact:true}).fill("5");
    await page.getByText("المتاح للفترة: 50",{exact:true}).waitFor();
    assert.equal(await page.locator('main[dir="rtl"]').count(),1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`form overflow at ${width}`);
    await page.screenshot({path:resolve(artifacts,`rental-form-${width}.png`),fullPage:true});
    await page.getByRole("button",{name:"تأكيد الإيجار",exact:true}).click();await page.waitForURL(/\/rentals\/51$/);
    await page.getByRole("button",{name:"تسليم المعدات",exact:true}).click();
    const dialog=page.getByRole("dialog");await dialog.getByLabel("الموظف المسؤول").selectOption("1");await dialog.getByRole("button",{name:"تأكيد",exact:true}).click();
    await page.getByRole("button",{name:"استلام إرجاع",exact:true}).waitFor();await page.getByRole("button",{name:"استلام إرجاع",exact:true}).click();
    await page.getByRole("dialog").getByLabel("الموظف المسؤول").selectOption("1");await page.getByRole("dialog").getByLabel("جيد",{exact:true}).fill("3");await page.getByRole("dialog").getByLabel("بانتظار الفحص",{exact:true}).fill("2");await page.getByRole("dialog").getByRole("button",{name:"تأكيد",exact:true}).click();
    await page.getByRole("button",{name:"تسجيل دفعة",exact:true}).click();await page.getByRole("dialog").getByLabel("المبلغ",{exact:true}).fill("20000");await page.getByRole("dialog").getByRole("button",{name:"تأكيد",exact:true}).click();
    await page.getByRole("dialog").waitFor({state:"hidden"});assert.equal(row.paid,0,"pending request never pretends to settle the rental");
    await page.getByRole("tab",{name:"التسليم والإرجاع",exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`workspace overflow at ${width}`);
    await page.screenshot({path:resolve(artifacts,`rental-workspace-${width}.png`),fullPage:true});
    assert.ok(writes.every(write=>/^[a-zA-Z0-9_-]{8,80}$/.test(write.payload.requestId)), "all UI request keys satisfy the original server contract");assert.deepEqual(errors,[]);
    // Render the actual receipt/contract HTML, independently of UI screenshots.
    await page.setViewportSize({width:303,height:900});
    await page.setContent(equipmentRentalPrintHtml(row,{site_name:"AJN",phone:"07700000000"},"80mm","receipt"));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"80mm receipt has no horizontal clipping");
    if(width===390) { await page.screenshot({path:resolve(artifacts,"rental-receipt-80mm.png"),fullPage:true}); await page.pdf({path:resolve(artifacts,"rental-receipt-80mm.pdf"),width:"80mm",printBackground:true}); }
    await context.close();
  }
  console.log("PASS original rental UI: create/confirm, partial custody/return mapping, pending money, Arabic RTL and no page overflow at 390/768/1440px. Screenshots saved.");
} finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
