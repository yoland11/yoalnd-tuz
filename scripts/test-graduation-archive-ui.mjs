import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
const path='src/views/admin/graduation-archive.tsx';
assert.ok(existsSync(path),'archive lists need a shared, permission-aware confirmation before DELETE');
const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const source=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const require=createRequire(import.meta.url);
const primitives=Object.fromEntries(['AlertDialog','AlertDialogContent','AlertDialogHeader','AlertDialogTitle','AlertDialogDescription','AlertDialogFooter','AlertDialogCancel','Alert','AlertTitle','AlertDescription','Button','Loader2'].map(name=>[name,()=>null]));
const target={id:42,groupId:8,customerName:'أحمد '.repeat(30),orderNo:'GR-42'};
function fixture(permissions=['graduation.student.delete'],role='staff'){
  const states=[],requests=[],invalidations=[],notices=[];let cursor=0,mode='blocked',pending=false;
  const user={id:1,role,isActive:true,permissions};
  const context=vm.createContext({...primitives,require,exports:{},
    useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return[states[index],value=>states[index]=value];},
    useRef:initial=>{const index=cursor++;return states[index]??= {current:initial};},
    useQueryClient:()=>({invalidateQueries:args=>{invalidations.push(args);return Promise.resolve();}}),useToast:()=>({toast:v=>notices.push(v)}),
    hasPerm:(u,p)=>Boolean(u?.isActive&&(u.role==='admin'||u.permissions.includes('graduation')||u.permissions.includes(p))),apiErrorMessage:e=>e.message,
    adminFetch:async(url,options)=>{requests.push({url,options});await Promise.resolve();if(mode==='blocked')throw Error('لا يمكن الأرشفة: توجد دفعة معلقة');if(mode==='offline')throw Error('تعذر الاتصال');if(mode==='uncertain')return{};return{archived:true};},
    useMutation:options=>({isPending:pending,mutate:async item=>{pending=true;try{const result=await options.mutationFn(item);await options.onSuccess?.(result,item);}catch(error){options.onError?.(error,item);}finally{pending=false;options.onSettled?.();}}}),
  });vm.runInContext(code,context);
  const render=(current=user)=>{cursor=0;return context.exports.useGraduationOrderArchive(current);};
  const nodes=element=>{const result=[];function visit(n){if(!React.isValidElement(n))return;if(typeof n.type==='function'&&!Object.values(primitives).includes(n.type)){visit(n.type(n.props));return;}result.push(n);React.Children.forEach(n.props.children,visit);}visit(element);return result;};
  const controls=()=>{const list=nodes(render().confirmation);return{list,confirm:list.find(n=>n.type===primitives.Button&&n.props.variant==='destructive'),cancel:list.find(n=>n.type===primitives.AlertDialogCancel),dialog:list.find(n=>n.type===primitives.AlertDialog)};};
  return{render,controls,requests,invalidations,notices,setMode:v=>mode=v,user};
}
for(const user of [undefined,null,{isActive:false,role:'admin',permissions:[]},{isActive:true,role:'staff',permissions:[]}]){
  const f=fixture();const ui=f.render(user??null);assert.equal(ui.canArchive(target),false);ui.request(target);assert.equal(f.controls().dialog.props.open,false);assert.equal(f.requests.length,0);
}
const scoped=fixture();assert.equal(scoped.render().canArchive(target),true);assert.equal(scoped.render().canArchive({...target,groupId:null}),false);
for(const item of [{...target,id:0},{...target,id:NaN},{...target,id:1.5},{...target,groupId:0},{...target,groupId:-1}])assert.equal(scoped.render().canArchive(item),false,'invalid identity fails closed');
const individual=fixture(['graduation.delete']);assert.equal(individual.render().canArchive(target),false);assert.equal(individual.render().canArchive({...target,groupId:null}),true);
const f=fixture();f.render().request(target);assert.equal(f.requests.length,0,'selecting a target cannot submit DELETE');
let controls=f.controls();assert.equal(controls.dialog.props.open,true);assert.ok(controls.list.some(n=>JSON.stringify(n.props.children).includes('لن تُمسح المجموعة أو دفعاتها')));
const first=controls.confirm.props.onClick();const duplicate=controls.confirm.props.onClick();controls.dialog.props.onOpenChange(false);assert.equal(f.controls().dialog.props.open,true,'pending confirmation cannot dismiss');
await Promise.all([first,duplicate]);assert.equal(f.requests.length,1,'rapid confirmation submits once before React re-renders');assert.equal(f.requests[0].url,'/admin/graduation/groups/8/students/42');assert.equal(f.requests[0].options.method,'DELETE');assert.equal(f.invalidations.length,0,'failure must not hide the row');
controls=f.controls();assert.equal(controls.dialog.props.open,true);assert.ok(controls.list.some(n=>n.type===primitives.AlertDescription&&n.props.children==='لا يمكن الأرشفة: توجد دفعة معلقة'));
f.setMode('offline');await controls.confirm.props.onClick();assert.equal(f.controls().dialog.props.open,true);assert.equal(f.invalidations.length,0);
f.setMode('success');await f.controls().confirm.props.onClick();assert.equal(f.controls().dialog.props.open,false);assert.ok(f.invalidations.some(v=>JSON.stringify(v.queryKey)==='["admin","graduation"]'));
individual.render().request({...target,groupId:null});individual.setMode('success');await individual.controls().confirm.props.onClick();assert.equal(individual.requests[0].url,'/admin/graduation/orders/42');
const cancelled=fixture();cancelled.render().request(target);cancelled.controls().dialog.props.onOpenChange(false);assert.equal(cancelled.controls().dialog.props.open,false);assert.equal(cancelled.requests.length,0);
const uncertain=fixture();uncertain.render().request(target);uncertain.setMode('uncertain');await uncertain.controls().confirm.props.onClick();assert.equal(uncertain.controls().dialog.props.open,true);assert.equal(uncertain.invalidations.length,0);assert.ok(uncertain.controls().list.some(n=>n.type===primitives.AlertDescription&&n.props.children.includes('تعذر تأكيد أرشفة')));
const revoked=fixture();revoked.render().request(target);revoked.user.permissions=[];assert.equal(revoked.controls().confirm.props.disabled,true);await revoked.controls().confirm.props.onClick();assert.equal(revoked.requests.length,0,'permission revocation cannot submit an already-open confirmation');
for(const path of ['src/views/admin/graduation.tsx','src/views/admin/graduation-order-center.tsx'])assert.ok(readFileSync(path,'utf8').includes('useGraduationOrderArchive'),'both original lists must consume the shared archive controller');
console.log('PASS real archive UI controller: scoped permissions/routes, explicit confirmation, pending lock, duplicate suppression, error retention, cancel and successful invalidation (controlled UI/network).');
