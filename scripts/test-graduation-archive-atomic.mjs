import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual archive entry point. Only external database I/O is
// controlled: rollback and fresh-row ordering must be owned by the handler.
const ast = ts.createSourceFile('graduation.ts', readFileSync('src/server/graduation.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'cancelAndArchiveGraduationOrder');
assert.ok(fn);
const code = ts.transpileModule(fn.getText(ast).replace(/^export /, '') + '\nglobalThis.run = cancelAndArchiveGraduationOrder;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const table = name => ({ name, id: `${name}.id` });
for (const mode of ['pending', 'installment_history', 'production_history', 'stale_paid', 'wrong_group', 'missing_invoice', 'clear', 'already_restored', 'repeat', 'inventory_failure', 'reservation_failure', 'audit_failure']) {
  let order = { id: 42, groupId: 8, orderNo: 'GR-42', status: 'new', productionStage: 'new', paidAmount: '0', invoiceId: 91, inventoryApplied: true, inventoryItems: [{productId: 5, quantity: 2}], archivedAt: null };
  if (mode === 'stale_paid') order.paidAmount = '100';
  if (mode === 'wrong_group') order.groupId = 9;
  if (mode === 'already_restored') order.inventoryApplied = false;
  if (mode === 'repeat') order = {...order, status: 'cancelled', archivedAt: new Date(), inventoryApplied: false};
  let active = false, locked = false, commits = 0, restores = 0, invoiceStatus = 'active';
  const writes = [];
  const graduationOrdersTable = table('order'), salesInvoicesTable = table('invoice'), tasksTable = table('tasks');
  const tx = {
    select: () => ({ from: t => ({ where: () => ({ limit: () => ({ for: async kind => {
      assert.equal(kind, 'update'); assert.ok(active); locked = true;
      return t === graduationOrdersTable ? [{...order}] : mode === 'missing_invoice' ? [] : [{id:91, paidAmount:'0'}];
    } }) }) }) }),
    execute: async query => {
      assert.ok(active && locked, 'eligibility must be checked after the fresh order lock');
      assert.match(query.parts.join('?'),/count\(\*\) FROM installment_contracts WHERE sales_invoice_id/,'installment history must block archive before cancellation');
      return { rows: [{ payment_count: ['pending','installment_history'].includes(mode) ? 1 : 0, production_count: mode === 'production_history' ? 1 : 0 }] };
    },
    update: t => ({ set: values => ({ where: () => {
      assert.ok(active && locked); writes.push({table:t.name, values});
      if (t === graduationOrdersTable) Object.assign(order, values);
      if (t === salesInvoicesTable) invoiceStatus = values.status;
      const result = Promise.resolve([]); result.returning = async () => [{...order}]; return result;
    } }) }),
  };
  const db = { transaction: async callback => {
    const before = structuredClone(order), oldInvoice = invoiceStatus; active = true;
    try { const value = await callback(tx); commits++; return value; }
    catch (cause) { order = before; invoiceStatus = oldInvoice; restores = 0; writes.length = 0; throw cause; }
    finally { active = false; }
  }, query: {salesInvoicesTable:{findFirst:async()=>({id:91,paidAmount:'0'})}} };
  const context = vm.createContext({ db, graduationOrdersTable, salesInvoicesTable, tasksTable, Date,
    eq: (...args)=>args, and:(...args)=>args, isNull:v=>v, sql:(parts,...values)=>({parts,values}),
    money:v=>Number(v), error:(message,status)=>({message,status}),
    reconcilePaymentState: async (connection, source) => { assert.equal(connection, tx); assert.ok(locked); return {paid:0}; },
    restoreGraduationInventoryFromMovements: async (fresh, _user, connection) => {
      assert.equal(connection, tx, 'stock must share the archive transaction'); assert.ok(active && locked);
      if(!fresh.inventoryApplied)return;assert.equal(fresh.inventoryItems[0].quantity,2); restores++;
      if (mode === 'inventory_failure') throw Error('stock unavailable');
    },
    releaseGraduationMaterialReservations: async (connection,id) => {assert.equal(connection,tx);assert.equal(id,42);writes.push({table:'reservations'});if(mode==='reservation_failure')throw Error('reservations unavailable');},
    addTimeline: async (...args) => { assert.equal(args.at(-1),tx); assert.ok(active); writes.push({table:'timeline'}); },
    addActivity: async (...args) => { assert.equal(args.at(-1),tx); assert.ok(active); if(mode==='audit_failure')throw Error('audit unavailable'); writes.push({table:'audit'}); },
    updateOrder: async()=>({order}),
  });
  vm.runInContext(code, context);
  const stale = {...order, paidAmount:'0', groupId:8, archivedAt:null, productionStage:'new'};
  if (mode.endsWith('_failure')) {
    await assert.rejects(()=>context.run(stale,{id:1},{timelineType:'archived',timelineTitle:'أرشفة',activity:'archive'}), /unavailable/);
    assert.equal(commits,0); assert.equal(order.archivedAt,null); assert.equal(order.inventoryApplied,true); assert.equal(invoiceStatus,'active'); assert.equal(restores,0);
  } else {
    const result = await context.run(stale,{id:1},{timelineType:'archived',timelineTitle:'أرشفة',activity:'archive'});
    if (['pending','installment_history','production_history','stale_paid','wrong_group','missing_invoice','repeat'].includes(mode)) {
      assert.ok(result.response, `${mode}: unsafe archive must return a controlled rejection`);
      assert.equal(writes.length,0, `${mode}: rejection cannot leave partial writes`); assert.equal(restores,0);
    } else {
      assert.equal(result.order.status,'cancelled'); assert.ok(result.order.archivedAt); assert.equal(invoiceStatus,'cancelled');
      assert.equal(restores, mode==='already_restored'?0:1); assert.equal(commits,1); assert.equal(order.inventoryApplied,false);
      assert.ok(writes.some(w=>w.table==='timeline')); assert.ok(writes.some(w=>w.table==='audit'));
    }
  }
}
console.log('PASS actual graduation archive: locked eligibility, exact group, pending/production blockers, one stock restore, atomic invoice/tasks/audit rollback (controlled I/O; not a database concurrency test)');
