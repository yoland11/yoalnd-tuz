const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('api.ts', fs.readFileSync('src/server/api.ts','utf8'), ts.ScriptTarget.Latest, true);
const handler = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handleEnterpriseAdmin');
const compiled = ts.transpileModule(handler.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
async function run(auth, method='GET', query='') {
  let reads=0, preflights=0;
  const context = vm.createContext({
    requirePermission: async () => auth || { status:401 }, requireAnyPermission: async () => auth || {status:401},
    isResponse: value => value && typeof value.status === 'number',
    hasPermission: (user,permission) => user.permissions.includes(permission),
    parseDailyOperationsFilters: params => { if(params.has('bad')) throw Error('invalid filter'); return { period:'today' }; },
    loadDailyOperations: async (_db,filters,sources) => { reads++; return { sources,filters }; }, db:{},
    json: (data) => ({status:200,data,headers:new Map()}),
    error: (message,status,extra) => ({status,message,extra}),
    ensureEnterprisePhase5Tables: async () => { preflights++; }, getCachedEnterpriseCommandCenter: async () => ({legacy:true}),
  });
  vm.runInContext(compiled,context);
  const response = await context.handleEnterpriseAdmin({ method, nextUrl:{ searchParams: new URLSearchParams(query) } }, ['daily-operations']);
  return { response,reads,preflights };
}
(async () => {
  assert.equal((await run(null)).response.status,401);
  const denied = await run({id:8,role:'staff',permissions:['dashboard','koshas']});
  assert.equal(denied.response.status,403,'department permission alone cannot expose all bookings');
  assert.equal(denied.reads,0);
  const allowed = await run({id:8,role:'staff',permissions:['dashboard','booking_operations_view']});
  assert.equal(allowed.response.status,200);
  assert.equal(allowed.reads,1);
  assert.equal(allowed.preflights,0,'read room does not run legacy schema initializers');
  assert.equal(allowed.response.headers.get('Cache-Control'),'private, no-store','never global-cache user booking data');
  assert.equal((await run({id:1,role:'admin',permissions:[]},'POST')).response.status,405);
  assert.equal((await run({id:1,role:'admin',permissions:[]},'GET','bad=1')).response.status,422);
  console.log('PASS daily operations route authentication, authorization, method validation and private caching');
})().catch(err => {console.error(err);process.exitCode=1;});
