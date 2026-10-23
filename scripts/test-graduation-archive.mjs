import {spawnSync} from 'node:child_process';

// Controlled I/O and SQL contracts only. This runner never opens a database;
// real write/concurrency smoke remains restricted to the isolated TEST gate.
for (const name of [
  'graduation-archive-atomic', 'graduation-update-atomic',
  'graduation-payment-atomic', 'source-financial-executor',
  'graduation-payment-projection', 'graduation-financial-guard',
  'graduation-receipt-admission', 'graduation-approval-fresh',
  'graduation-production-atomic', 'graduation-scan-archive-guard',
  'graduation-enterprise-archive-guard', 'graduation-active-queues',
  'graduation-bulk-archive-guard',
  'graduation-financial-cancel-race', 'graduation-original-stock-return',
  'graduation-material-release',
  'graduation-installment-admission',
  'graduation-linked-invoice-cancel',
]) {
  const result=spawnSync(process.execPath,[`scripts/test-${name}.mjs`],{stdio:'inherit',env:process.env});
  if(result.status!==0) process.exit(result.status??1);
}
console.log('Graduation archive regression suite passed (controlled I/O, no database writes).');
