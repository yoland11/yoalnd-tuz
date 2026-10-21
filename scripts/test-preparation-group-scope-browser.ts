import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve} from 'node:path';

// Real React/Query/action dialog. Network is controlled locally, not Production.
// A missing scope key or live-scope callback guard must fail these tests.
const runtime=process.env.AJN_BROWSER_RUNTIME;assert.ok(runtime,'AJN_BROWSER_RUNTIME is required');
const {chromium}=createRequire(runtime)('playwright');
const esbuild=createRequire(realpathSync(resolve('lib/db/node_modules/tsx/package.json')))('esbuild');
const bundle=await esbuild.build({stdin:{contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {PreparationGroupAction} from './src/components/preparation-group-action';
function App(){const [scope,setScope]=useState({endpoint:'/admin/booking-operations/kosha/12/preparation',actorId:1}),[draft,setDraft]=useState(null),[done,setDone]=useState(0);window.scope=next=>{setScope(next);setDraft(null)};window.newDraft=()=>setDraft({department:'lighting',command:'confirm',keys:['manual:light'],label:'الإضاءة'});return <><output data-testid="scope">{scope.actorId}:{scope.endpoint}</output><output data-testid="done">{done}</output><PreparationGroupAction {...scope} canManage={true} draft={draft} onClose={()=>setDraft(null)} onDone={()=>setDone(n=>n+1)} onBusyChange={()=>{}} labelForDepartment={()=>'الإضاءة'}/></>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text)}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<html lang="ar" dir="rtl"><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${(server.address() as any).port}`,endpoint='/admin/booking-operations/kosha/12/preparation';
const oldKey=`ajn:preparation-group:v1:1:${endpoint}`,command={action:'group',confirmation:true,requestId:'old-scope-command-12',department:'lighting',command:'confirm',keys:['manual:light']};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
  for(const target of [{endpoint:'/admin/booking-operations/service/12/preparation',actorId:1},{endpoint,actorId:8}]){
    await test(`unresolved group retry does not cross ${target.actorId===1?'booking/source':'employee'} boundary`,async()=>{
      const context=await browser.newContext();const page=await context.newPage(),posts:any[]=[];
      await page.addInitScript(({key,value}:any)=>sessionStorage.setItem(key,JSON.stringify(value)),{key:oldKey,value:command});
      await page.route('**/api/**',async(route:any)=>{posts.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});await route.fulfill({json:{ok:true,updated:1}})});
      try{
        await page.goto(origin);await page.getByRole('button',{name:'إعادة إجراء المجموعة نفسه دون تكرار',exact:true}).waitFor();
        await page.evaluate((next:any)=>(window as any).scope(next),target);
        await page.getByRole('dialog').waitFor({state:'detached',timeout:2000});
        assert.equal(posts.length,0);assert.equal(await page.evaluate(key=>!!sessionStorage.getItem(key),oldKey),true,'original unresolved receipt stays recoverable only in original scope');
        await page.evaluate(()=>(window as any).newDraft());await page.getByRole('checkbox').check();await page.getByRole('button',{name:'تأكيد تجهيز المجموعة',exact:true}).click();
        await page.getByText('تم حفظ إجراء مجموعة التجهيز',{exact:true}).waitFor();assert.equal(posts.length,1);assert.equal(posts[0].path,`/api${target.endpoint}`);assert.notEqual(posts[0].body.requestId,command.requestId);
      }finally{await context.close()}
    });
  }
  await test('late old-scope success cannot close/refresh or clear a new booking command',async()=>{
    const context=await browser.newContext(),page=await context.newPage();let release!:()=>void,received!:()=>void;
    const arrival=new Promise<void>(r=>received=r),response=new Promise<void>(r=>release=r);
    await page.addInitScript(({key,value}:any)=>sessionStorage.setItem(key,JSON.stringify(value)),{key:oldKey,value:command});
    await page.route('**/api/**',async(route:any)=>{if(new URL(route.request().url()).pathname===`/api${endpoint}`){received();await response;await route.fulfill({json:{ok:true,updated:1}})}else await route.fulfill({status:503,json:{message:'محاولة الحجز الجديد معلقة',requestId:'new-booking-request'}})});
    try{
      await page.goto(origin);await page.getByRole('button',{name:'إعادة إجراء المجموعة نفسه دون تكرار',exact:true}).click();await arrival;
      await page.evaluate(()=>(window as any).scope({endpoint:'/admin/booking-operations/service/13/preparation',actorId:2}));
      await page.evaluate(()=>(window as any).newDraft());await page.getByRole('dialog').waitFor();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'تأكيد تجهيز المجموعة',exact:true}).click();await page.getByText('محاولة الحجز الجديد معلقة',{exact:true}).waitFor();
      const newKey='ajn:preparation-group:v1:2:/admin/booking-operations/service/13/preparation',newCommand=await page.evaluate(key=>sessionStorage.getItem(key),newKey);assert.ok(newCommand);release();
      await page.waitForFunction(key=>sessionStorage.getItem(key)===null,oldKey,{timeout:3000});
      assert.equal(await page.getByTestId('done').textContent(),'0','old request must not invoke the current parent callbacks');
      assert.equal(await page.getByRole('dialog').isVisible(),true);assert.equal(await page.getByText('تم حفظ إجراء مجموعة التجهيز',{exact:true}).count(),0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),newKey),newCommand,'late old success must not clear the new booking receipt');
    }finally{release();await context.close()}
  });
}finally{await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()))}
