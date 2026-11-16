const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const file='src/views/admin/booking-center.tsx',src=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='bookingListPage');assert.ok(fn,'booking list must bound rendered rows');
const ctx={};vm.runInNewContext(ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const rows=Array.from({length:101},(_,id)=>({id}));
for(const [page,wantFirst,wantLength] of [[1,0,24],[2,24,24],[5,96,5],[999,96,5],[0,0,24],[NaN,0,24]]){
 const result=ctx.bookingListPage(rows,page);assert.equal(result.items[0].id,wantFirst);assert.equal(result.items.length,wantLength);assert.equal(result.totalPages,5);
}
assert.equal(ctx.bookingListPage([],20).items.length,0);assert.equal(ctx.bookingListPage(rows.slice(0,2),5).page,1);
assert.equal(rows.length,101,'paging must not truncate report or selection input');
console.log('PASS booking pages: bounded rows, distinct pages, clamped filters, invalid URLs, empty results and unchanged source');
