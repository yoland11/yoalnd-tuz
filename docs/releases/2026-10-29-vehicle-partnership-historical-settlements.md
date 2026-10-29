# Vehicle partnership: historical settlements and original advance liabilities

Scope: the existing single-vehicle partnership only. No booking, transport, driver, payroll, inventory or Cash Box system is duplicated. Existing protected invoice designs remain unchanged.

## Operator workflow

- **تسويات الفترات → إثبات الخسارة الافتتاحية** reads the first approved agreement's exact declared loss and original expense shares. Enter an evidence reference/reason, submit the original financial request, then use its exact FIN link in the existing principal approvals. Approval is one noncash `VP-LOSS / VP-OPENING-CLEAR` journal. It creates no operating expense, revenue or cash movement.
- The first actual monthly approval creates original-party opening loss rights through immutable adjustment lines, including a month with no activity. Recovery uses these real rights in the first or later months. Controlled unused reopening reverses derived revision rights and retains the opening source. Used or pending-frozen opening evidence cannot be reversed.
- **تسويات الفترات السابقة** classifies an already executed, financially applicable, unconsumed original FIN into a selected later open month. It preserves original amount, financial date, basis date, dated agreement and payee. Confirmation and unused-only revocation append audit evidence. No free-form historical profit edit, reused source or new money is allowed.
- **المستحقات والتسويات → طلب تسديد سلفة** now supports an approved original advance before closing and after ownership ends. New UI requests opt in to immutable proposal v2. Existing v1 proposals retain their original command/money/hash. Canonical available/reserved/paid balances prevent overpayment. A pending request reserves capacity; only original approval and MASTER execution pay cash.
- **الكشوف والطباعة → ربط دفعات السلف بالشهر** classifies the same executed v2 FIs inside real approved internal conversion capacity. It appends immutable coverage and audit evidence, preserving original primary allocations and requests. Results show partial/no capacity and already-paid-outside-conversion amounts. Uncovered cash never becomes another payable. Verified full returns are excluded; replacement repayments still require approval.

## Reused boundaries and safeguards

Original agreements/dated parties, vehicle expenses and advances, monthly lines/rights, financial requests, principal approval, actual journals, MASTER cash, canonical reconciliation, source locks, audit logs and the existing driver-coverage confirmation/result components are reused. New endpoints extend only the original vehicle partnership routes. Shared closing source locks preserve their default active-ownership behavior; the server-only historical-settlement opt-in admits only existing approved/distributed periods.

All multi-record changes and audits remain transactional and retry-safe. Exact decimal strings/BigInt preserve money. Original FI/right/payee identities remain stable. Full cash return retains immutable late-mapping proof and reconciles the same underlying balances. New optional metadata is absent from old saved snapshots/proof hashes.

## Database and validation

No schema migration, new storage system or historical data rewrite is required. A chart account is created only by the existing approved financial posting helper when actually needed. No Production business writes were used for diagnosis or QA.

Focused tests cover original source/dated party, noncash opening approval/rejection/reversal, zero-month rights/reopening, partial/full/later loss recovery, prior-source use and stale/future-refund guards, v1/v2 compatibility, early and ended-ownership advance settlement, pending capacity, late same-FI mapping, canonical balances, full return/replacement proof, financial permissions, structured errors and transactional audit failure. The original MASTER cash writer and canonical adapters remain covered by the existing full partnership suite.

`pnpm run verify:critical` includes TypeScript, payment-state, the complete partnership and existing regression suites, production build and whitespace integrity. Desktop and375px mobile UI were inspected using the actual React components and fabricated local data, with no horizontal page overflow or console errors. Browser testing did not execute real approvals, payments or returns.

Isolated PostgreSQL write/concurrency/save-smoke tests are **SKIPPED**, never passed, without a separately verified TEST configuration. No Production connection is used as a fallback. Normal release follows the existing pre-push critical gate.

## Deliberate limits

Historical monetary corrections must first exist in their original authorized source; no amount or historical cost is invented. An opening loss can use only the first approved agreement's declared amount and original loss shares. Used approved periods cannot be silently rewritten. Existing nonzero conversion mappings stay immutable; there is no silent top-up. Cash returns remain full-original-payment only. Missing original evidence blocks the operation explicitly.

User guide: [vehicle-partnership-reimbursements-reports.md](../vehicle-partnership-reimbursements-reports.md).

## Final review

One fresh whole-change financial review found no additional confirmed accounting blocker and one P2 UI retry-state issue. Fixed in the single review pass and witnessed RED → GREEN using mounted browser interactions for both classification and revocation after a lost response and month change. [Reproduction and evidence](../qa/2026-10-29-partnership-history-retry.md). PostgreSQL concurrency and rollback/save-smoke coverage remain explicitly skipped without isolated configuration.

Final reviewed-source gate: pnpm run verify:critical exited 0 on 2026-10-29, including TypeScript, canonical payment-state tests, full partnership/legacy regression suites, Production build and whitespace integrity. No lint script is configured. Isolated database integration/save-smoke remains SKIPPED under the normal release policy.
