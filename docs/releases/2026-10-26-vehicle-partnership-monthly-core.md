# Vehicle partnership monthly core — scoped release

This completes the backend core for monthly draft/review/submission and principal financial approval/rejection. It does not complete or activate the entire vehicle-partnership product.

## Included

- Exact monthly calculations, original dated partner/loss identities, explicit depreciation/reserve/accounting policy and immutable original financial/reversal evidence.
- Bounded original-source locks and digest revalidation before submission/approval, respecting original invoice → details → delivery and fleet → dispatch writer orders.
- Original service resource guard serializes both JSON-selected and dispatch vehicle identities, including historical edits, without rerunning legacy eligibility checks.
- Durable draft/review/submit replay, stale-version/digest refusal, revision-preserving rejection and zero-month cancellation.
- Source-derived pending monthly financial request, balanced noncash journal nominal, principal-only execution, exact approved profit/loss/recovery rights and canonical original-entitlement conversion holds.
- Empty journals use an explicit admin/audit approval with no financial transaction. A zero-net month with real journal legs still uses the positive journal nominal. Existing positive-amount database constraints remain intact.
- Frozen approved evidence verifies its source digest, exact journal nominal/type/date and either actual executed financial identity or zero-approval audit proof.
- Real original vehicle-expense refund events remain compatible; unknown/partnership reversal events stay strict.

## Intentionally unavailable

No public monthly source-request POST route, partnership dashboard, actual partner/driver payout, monthly controlled reopening/reversal, late-period adjustment writer, partnership reports or printing are enabled. Unsupported monthly reversal still fails closed. These remain local follow-up tasks; this release must not be described as a finished partnership system. Original Booking Center/A4 output is unchanged.

## Database

The feature's isolated additive migration 0129 now includes monthly financial identity and same-right conversion metadata. It remains an artifact and is **not applied by this release**. No original table constraints are relaxed, historical records rewritten or Production diagnostic writes performed. Existing endpoints preserve their contracts; feature setup errors remain explicit when its schema is unavailable.

## Verification scope

Actual project checks are `pnpm run typecheck`, `pnpm run test:payment-state` and `pnpm run verify:critical` (including production build and the feature aggregate). Lint is not configured. Controlled transaction/SQL tests cover rollback, durable retry, journal/rights proof, source/version mismatches and original-writer ordering; they do not certify live PostgreSQL concurrency. Migration/write/save-smoke integration is SKIPPED unless the existing separately verified TEST configuration is available. No Production connection substitutes for TEST.

A fresh core review found three Important defects (original refund event compatibility and two delivery lock inversions). Each was reproduced before its fix; targeted verification after the single fix pass passed with no remaining blocker reported. Final whole-project verification must pass before publication.

Final release candidate: `pnpm run verify:critical` exited 0 after staging all 35 scoped files, including TypeScript, canonical payment-state/approval regressions, complete partnership aggregate, original booking/inventory suites and production build. Isolated PostgreSQL migration/write/concurrency/save-smoke tests were SKIPPED, not passed. No Production database or physical printer was used for testing. The existing Git pre-push gate remains mandatory for the release commit.
