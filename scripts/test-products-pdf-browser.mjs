// Browser-only presentation fixtures. All /api calls are intercepted; no database writes.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require=createRequire(process.env.AJN_BROWSER_RUNTIME);
const {chromium}=require("playwright");
const origin="http://127.0.0.1:3105";
const products=[
 {id:1,name:"RCF 745",nameAr:"سماعة RCF 745",price:30000,stock:2,minStock:5,barcode:"AJN-001",category:"sound",categoryId:10,isActive:true,images:[]},
 {id:2,name:"Rose",nameAr:"باقة ورد",price:25000,stock:9,minStock:2,barcode:"AJN-002",category:"flowers",categoryId:20,isActive:true,images:[]},
];
const categories=[{id:10,name:"Sound",nameAr:"الصوتيات",slug:"sound",parentId:null,sortOrder:1,isActive:true},{id:20,name:"Flowers",nameAr:"الورد",slug:"flowers",parentId:null,sortOrder:2,isActive:true}];
const browser=await chromium.launch({channel:"msedge",headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
 await context.addCookies([{name:"ajn_admin_session",value:"presentation-fixture-only",url:origin}]);
 const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/**",route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith("/admin/auth/me"))return route.fulfill({json:{user:{id:1,role:"admin",username:"fixture",fullName:"مدير اختبار",isActive:true,permissions:[]}}});if(path.endsWith("/admin/categories"))return route.fulfill({json:categories});if(path.endsWith("/admin/products"))return route.fulfill({json:products});if(path.includes("settings"))return route.fulfill({json:{}});if(path.includes("notifications"))return route.fulfill({json:{items:[],unreadCount:0}});return route.fulfill({json:[]});});
 await page.goto(`${origin}/admin/products`);await page.getByRole("heading",{name:"إدارة المتجر",exact:true}).waitFor({timeout:60000});
 await page.getByLabel("كل التصنيفات").selectOption("sound").catch(async()=>page.locator("select").filter({has:page.locator('option[value="sound"]')}).selectOption("sound"));
 await page.getByRole("table").getByText("سماعة RCF 745",{exact:true}).waitFor();assert.equal(await page.getByRole("table").getByText("باقة ورد",{exact:true}).count(),0,"Selected category hides other categories");
 const button=page.getByRole("button",{name:"حفظ PDF",exact:true});await button.waitFor();
 const downloadPromise=page.waitForEvent("download",{timeout:60000});await button.click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/products-.*2026|products-/);
 assert.deepEqual(errors,[],"No browser runtime errors");console.log(`PASS: category-filtered PDF download (${download.suggestedFilename()})`);
}finally{await browser.close();}
