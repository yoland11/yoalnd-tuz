# Vehicle losses remain negative

The existing vehicle API suppressed a loss by passing its derived profit through the positive-only `money()` source/input sanitizer. For example, displayed transport income of 11,029.41 IQD against effective expenses of 280,000 IQD appeared as zero profit. The previous transport test exercised a separately implemented arithmetic model, which supported losses and missed this production behavior.

The fix removes only four wrappers: Kosha-trip result, service-trip result, vehicle detail summary and vehicle-list stats. Original source reads, approval/recognition rules, proportional income, subtraction, numeric DTOs and shared IQD formatting remain unchanged. Negative results now reach the original UI and vehicle statement. This is an analytical result correction, not a change to approved partnership allocations or financial records.

No global money sanitizer, booking price, expense, approval, payment, ledger, Cash Box, inventory, schema or historical record is modified. Existing vehicle selector consumers retain their response shape. Detailed caller boundaries are in the design document.

## Verification

`scripts/test-vehicle-loss-display.mjs` executes the actual four TypeScript API initializer expressions and actual shared currency formatter. RED was witnessed: 100,000 minus 150,000 returned 0 instead of -50,000. GREEN covers all four loss/profit/zero cases, costs with no income, fractional proportional income, large original numeric DTOs and the unchanged positive-only sanitizer. The original `pnpm run test:vehicle-transportation` suite passes and now includes this regression. Its existing package command is added to the critical pre-push gate; no earlier check is removed or weakened.

One fresh independent whole-change review reported no Critical, Important or Minor findings. Full TypeScript/payment-state/critical/build verification is required before release. Lint has no configured package script. Isolated database integration/write/concurrency/save-smoke coverage remains **SKIPPED** without a separately verified TEST configuration. No Production business writes are performed for diagnosis or deployed verification.

Final reviewed-source verification: pnpm run verify:critical exited 0 on 2026-10-29, including TypeScript, actual payment-state/transport/partnership and existing regression suites, Production build and whitespace integrity. Isolated database integration is explicitly SKIPPED under the normal policy.
