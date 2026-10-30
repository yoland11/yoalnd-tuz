import {spawnSync} from "node:child_process";
const tests=[
  "test-booking-transport-plan.ts","test-booking-transport-plan-resources.ts","test-booking-transport-plan-store.ts",
  "test-booking-transport-plan-route.ts","test-kosha-transport-plan-route.ts","test-transport-receipt-projection.ts",
  "test-transport-receipt-route.ts","test-transport-receipt.ts","test-transport-print-request.ts",
  "test-transport-receipt-ui.tsx","test-booking-transport-plan-ui.tsx","test-transport-receipt-entry-points.ts",
  "test-vehicle-transport-plans.ts","test-vehicle-transport-plan-routes.ts","test-vehicle-transport-ui.tsx",
  "test-vehicle-expense-transport-plan.ts",
];
for(const test of tests){
  const result=spawnSync(process.execPath,["scripts/run-tsx.mjs","--tsconfig","tsconfig.json",`scripts/${test}`],{stdio:"inherit",env:process.env});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
console.log(`AJN transport receipt contracts passed (${tests.length} suites). Database writes: not executed.`);
