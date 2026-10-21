import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
const runtime=process.env.AJN_BROWSER_RUNTIME;assert.ok(runtime,'AJN_BROWSER_RUNTIME is required');
const {chromium}=createRequire(runtime)('playwright');
const esbuild=createRequire(realpathSync(resolve('lib/db/node_modules/tsx/package.json')))('esbuild');
const postcss=createRequire(realpathSync(resolve('node_modules/@tailwindcss/postcss/package.json')))('postcss');
const tailwind=createRequire(resolve('package.json'))('@tailwindcss/postcss');
const css=await postcss([tailwind()]).process(await readFile('src/index.css','utf8'),{from:resolve('src/index.css')});
const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClientProvider} from '@tanstack/react-query';import {queryClient} from './src/lib/query-client';import {TooltipProvider} from './src/components/ui/tooltip';import {Toaster} from './src/components/ui/toaster';import Portal from './src/views/staff/unified-portal';createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><TooltipProvider><Portal/><Toaster/></TooltipProvider></QueryClientProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'.superpowers/staff-groups-bundle',loader:{'.css':'empty'},platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const javascript=bundle.outputFiles.find((file:any)=>file.path.endsWith('.js'))!.text,output='output/staff-groups-review';await mkdir(output,{recursive:true});
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(javascript)}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css.css)}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{for(const width of [1440,768,390]){
  const context=await browser.newContext({viewport:{width,height:950}});await context.addCookies([{name:'ajn_admin_session',value:'staff-fixture',url:origin}]);
  const page=await context.newPage(),errors:string[]=[],writes:any[]=[];page.on('pageerror',(error:any)=>errors.push(error.message));let taskStatus='new',failStart=true;
  const task=(id:number,status:string,extra:any={})=>({id,title:`تجهيز العنصر ${id}`,description:'تعليمات التجهيز الأصلية',taskType:'preparation',status,priority:'normal',relatedType:'kosha_booking',relatedId:12,department:'lighting',assignedStaffIds:[8],customerName:'أحمد محمد حسين واسم طويل للتأكد من التفاف النص',dueAt:null,startAt:null,...extra});
  const tasks=()=>[task(1,'completed'),task(2,'review'),task(3,taskStatus),task(4,'new',{relatedType:'service_order'}),task(5,'new',{assignedStaffIds:[9]}),task(6,'new',{taskType:'other'})];
  await page.route('**/api/**',async(route:any)=>{const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='POST'){assert.equal(path,'/api/admin/tasks/3/progress');const body=request.postDataJSON();assert.deepEqual(body.items,[]);writes.push(body);if(body.statusAction==='start'&&failStart){failStart=false;return route.fulfill({status:503,json:{message:'تعذر بدء التجهيز الآن',requestId:'staff-group-fixture'}})}assert.ok(['accept','start'].includes(body.statusAction));taskStatus=body.statusAction==='accept'?'accepted':'in_progress';return route.fulfill({json:{ok:true}})}
    assert.equal(request.method(),'GET');
    if(path.endsWith('/auth/me'))return route.fulfill({json:{user:{id:8,role:'staff',username:'fixture',fullName:'موظف التجهيز',department:'kosha',isActive:true,permissions:['staff_portal']}}});
    if(path.endsWith('/portal/dashboard'))return route.fulfill({json:{staff:{id:8,fullName:'موظف التجهيز',department:'kosha'},tasks:tasks(),today:'2026-10-21',stats:{}}});
    if(path.endsWith('/portal/bookings'))return route.fulfill({json:{today:'2026-10-21',data:[]}});
    if(path.endsWith('/portal/notifications'))return route.fulfill({json:{data:[],unreadCount:0}});
    if(path.endsWith('/portal/salary'))return route.fulfill({json:{data:[],current:null}});
    if(path.endsWith('/tasks/2'))return route.fulfill({json:task(2,'review',{checklistItems:[],comments:[],timeline:[]})});
    return route.fulfill({json:{data:[]}});
  });
  try{
    await page.goto(`${origin}/staff?tab=tasks`,{waitUntil:'networkidle'});const groups=page.getByRole('region',{name:'مجموعات تجهيزي',exact:true});await groups.waitFor({timeout:3000});
    await groups.getByRole('button',{name:/حجز كوشة.*الإضاءة/}).click({timeout:2000});assert.equal(await groups.getByText('تجهيز العنصر 5',{exact:true}).count(),0);assert.equal(await groups.getByText('تجهيز العنصر 6',{exact:true}).count(),0);
    const progress=groups.getByRole('progressbar');assert.equal(await progress.getAttribute('aria-valuenow'),'33');await groups.getByText('1 من 3 معتمدة',{exact:true}).waitFor();
    await groups.getByRole('button',{name:'استلام المهمة',exact:true}).click();await groups.getByRole('button',{name:'بدء التجهيز',exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].statusAction,'accept');
    await groups.getByRole('button',{name:'بدء التجهيز',exact:true}).click();await page.getByText('تعذر بدء التجهيز الآن',{exact:true}).waitFor();assert.ok(await groups.getByRole('button',{name:'بدء التجهيز',exact:true}).isEnabled());
    await groups.getByRole('button',{name:'بدء التجهيز',exact:true}).click();await groups.getByRole('button',{name:'بدء التجهيز',exact:true}).waitFor({state:'detached'});assert.equal(writes.length,3);assert.equal(taskStatus,'in_progress');assert.equal(await progress.getAttribute('aria-valuenow'),'33','starting work is not manager approval');
    await groups.getByRole('button',{name:'فتح مهمة تجهيز العنصر 2',exact:true}).click();await page.getByRole('dialog').getByText('تجهيز العنصر 2',{exact:true}).first().waitFor();assert.equal(writes.length,3,'viewing details must not submit or approve');
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(errors.length,0,errors.join('\n'));await groups.screenshot({path:`${output}/groups-${width}.png`});
    console.log(`PASS original staff portal ${width}px: assigned/source groups, approval-safe progress, original accept/start/details, recoverable errors and RTL`);
  }finally{await context.close()}
}}finally{await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()))}
