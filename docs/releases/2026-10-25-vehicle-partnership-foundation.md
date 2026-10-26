# Vehicle partnership foundation — release scope

This release delivers the completed backend foundation. It does **not** enable a monthly close, a partner/driver cash payout or a new vehicle dashboard.

## Included

- One original vehicle relationship with two existing typed parties, independently validated ownership/profit/expense percentages, dated agreement revisions, permissions and the existing approval/audit rules.
- Read-only original vehicle/trip/cost attribution with exact IQD arithmetic, approved-source evidence and explicit incomplete/error states.
- Trusted noncash source-request/approval/rejection/reversal adapters for internal transport entitlement, external attribution, partner-funded original costs, capital declaration and original per-trip driver accrual.
- Canonical approved cash/remaining derivation for foundational rights and original employee-fee sources; generic forms cannot impersonate the new financial namespace.
- Original cash/operating report classification protects against counting noncash attribution as a customer receipt or capital/settlement as operating revenue.
- Immutable original-cost and driver-wage source metadata survives a corrected unused request.
- Release-review safeguards: income-only readers exclude cost reversals and all partnership memos; operating reports net cost reversals; cash reconciliation and footer use actual cash classification; historical payroll linking excludes per-trip partnership fees. Rejected/reversed driver fees never imply a free trip without an explicit approved no-fee decision.

The public partnership routes cover agreement configuration/history/approval and read-only activity. Financial source-request POSTs are intentionally absent. Unsupported monthly/settlement execution fails closed.

## Excluded and preserved locally

Monthly calculation/preview, gross-entitlement conversion, monthly transition/posting, controlled reopening, actual partner/driver settlements, the partnership UI and partnership reports/printing remain outside this release. They require their own complete review and verification before activation.

## Database and production data

Migration 0129 is an isolated additive **artifact**, not a deployment-time action. It is not applied by this release. Existing endpoints retain their original tables/contracts. New configuration endpoints return an explicit setup error when the feature schema is unavailable. Existing original vehicle-expense approval checks skip the feature-specific guard when its tables are absent; they never create tables at runtime.

No production records, historical amounts, vehicle identities or existing invoice designs are changed. No new transportation, payroll, cashbox or inventory system is introduced.

## Validation

Use the actual project commands: pnpm run typecheck, pnpm run test:payment-state, pnpm run verify:critical (includes production build and feature contracts).

Real PostgreSQL migration/write/concurrency/save-smoke tests require the existing isolated test guard. When that configuration is absent, report SKIPPED, never passed. No production database may be used as a substitute.

2026-10-26 release verification: focused feature contracts, TypeScript, payment-state regressions, full `verify:critical` and production build passed after the review fixes. Lint is not configured in package.json. Live PostgreSQL migration/write/concurrency/save-smoke tests were SKIPPED because a separately verified TEST configuration is unavailable. Controlled SQL/transaction/component tests are not represented as live database or physical-printer testing. A targeted independent review of the corrected report SQL found no remaining important blocker.

The first pre-push comparison blocked on the exporter's redundant `ON UPDATE NO ACTION` foreign-key clauses. The migration now omits those clauses (the PostgreSQL default is unchanged). Its drift test compares that exact default equivalence. The global destructive-migration guard and Git hooks remain unchanged; verification is rerun against the actual origin baseline before retrying publication. No migration was executed.
