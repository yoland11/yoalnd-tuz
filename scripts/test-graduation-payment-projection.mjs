import {spawnSync} from "node:child_process";
// Keep the existing command; load the real engine and its source adapters
// through AJN's existing TypeScript runner instead of rebasing its imports.
const result=spawnSync(process.execPath,["scripts/run-tsx.mjs","--tsconfig","tsconfig.json","scripts/test-graduation-payment-projection.ts"],{stdio:"inherit",env:process.env});
if(result.error)throw result.error;
process.exit(result.status??1);
