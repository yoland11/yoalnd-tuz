// Exercise actual view functions with rejected read-query snapshots; no network/DB.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const primitive=tag=>({children,...props})=>React.createElement(tag,props,children);
const error=new Error('Synthetic unavailable');
function view(file,names,extra={}){
 const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const functions=names.map(name=>{const n=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name);assert.ok(n,name);return n.getText(ast).replace(/^export\s+/,'')}).join('\n');
 const context={React,useState:v=>[typeof v==='function'?v():v,()=>{}],useEffect:()=>{},useCallback:f=>f,useQuery:()=>({isError:true,error,isLoading:false,isPending:false,isFetching:false,refetch:()=>{}}),useT:()=>v=>v,useContentLocalizer:()=>({name:r=>r.name}),apiErrorMessage:e=>e.message,formatCurrency:n=>`IQD ${n}`,Button:primitive('button'),Link:primitive('a'),ReadFailure:({title,detail})=>React.createElement('div',{role:'alert'},title,detail),...extra};
 for(const name of ['Bell','Package','User','Wallet','Receipt','Check','Heart','LogOut','ShieldCheck','Grid3X3','Filter','ChevronLeft','Loader2'])context[name]=()=>null;
 vm.runInNewContext(ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText+`;globalThis.subject=${names[0]};`,context);
 return context.subject;
}
let failed=0;
function check(name,run){try{run();console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e.message)}}
for(const name of ['CategoryGrid','ProductsGrid'])check(`${name} exposes read failure instead of empty catalog`,()=>{
 const C=view('src/views/store/index.tsx',[name]);const html=renderToStaticMarkup(React.createElement(C,{isLoading:false,isError:true,error,onRetry:()=>{},categories:[],products:[],onClearSearch:()=>{}}));
 assert.match(html,/role="alert"/);assert.doesNotMatch(html,/لا توجد (أقسام|منتجات)/);
});
check('Customer account does not claim no debt when orders query fails',()=>{
 const C=view('src/views/customer-portal.tsx',['Dashboard','Card']);const html=renderToStaticMarkup(React.createElement(C,{account:{customerId:1,customerCode:'C-1',fullName:'Fixture',linkStatus:'linked'},logout:async()=>{},profile:()=>{}}));
 assert.match(html,/role="alert"/);assert.doesNotMatch(html,/لا توجد إجراءات مالية معلقة|IQD 0|لا توجد طلبات مرتبطة/);
});
check('Staff approvals do not show empty queue after failed query',()=>{
 const C=view('src/views/staff/index.tsx',['Approvals'],{staffApi:{paymentRequests:()=>Promise.reject(error)}});const html=renderToStaticMarkup(React.createElement(C));
 assert.match(html,/role="alert"/);assert.doesNotMatch(html,/لا توجد طلبات بانتظار الموافقة/);
});
if(failed)process.exitCode=1;
(async()=>{
 const request=view('src/views/customer-portal.tsx',['request'],{fetch:async()=>({ok:false,status:503,headers:{get:()=>null},json:async()=>({error:{message:'Service unavailable'},requestId:'REQ-fixture'})})});
 await assert.rejects(()=>request('/fixture'),e=>e.status===503&&e.requestId==='REQ-fixture'&&e.message==='Service unavailable','customer session must distinguish transport failure from 401');
 console.log('PASS customer request preserves HTTP status, structured error and request ID');
})().catch(e=>{console.error('FAIL customer HTTP failure contract',e.message);process.exitCode=1});
