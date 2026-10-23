# Graduation archive integrity

Spec: user-approved individual/student cancellation and archival, blocking all payments and started production, preserving groups and history. User approved extending this fix to payment/inventory serialization. No production diagnostic writes or isolated database creation.

## Global constraints
Reuse existing stock movements, financial requests, canonical payment reconciliation, permissions and invoice identities. Keep existing pending-approval behavior. No schema changes. Work in the existing clean isolated checkout based on 95a867f81; preserve the dirty primary checkout.

## Tasks
1. Add failing executable regression tests for archive transaction rollback, stale inputs, duplicate archive, pending payments, production history and exact group scope. Implement the dedicated atomic archive workflow.
2. Serialize competing graduation payment and production writers with the same order row. Thread an optional transaction through the existing source financial helpers without changing legacy callers. Reconcile paid snapshots from approved records. Cover rollback, archived-source rejection and pending approval with controlled I/O tests.
3. Verify existing individual/group UI permissions, actions and preserved history. Run graduation regressions, payment-state, typecheck, build and verify:critical. Isolated write smoke remains SKIPPED without a verified TEST database.
4. One fresh final review, test/fix important findings, rerun required gates, commit only this completed increment and push through existing gates. Verify exact Vercel Production commit and health read-only.

## Review focus
Payment approval vs archive ordering; direct invoice allocations; duplicate retries; inventory restoration owner and atomic rollback; immutable group identity; legacy nullable fields; one-connection executor escape; authorization on all callers; no pending money counted as approved.

## Shared callers / blast radius
cancelAndArchiveGraduationOrder: individual DELETE and group-student DELETE only. updateOrder: admin PATCH, graduation operations payments/bulk/stage/scan/delivery. Tailoring production writes bypass updateOrder and need the same row lock. Financial helpers have callers in api.ts, employee-advances.ts, hr-intelligence.ts and graduation modules; optional executor defaults must preserve all other behavior. No financial formulas or cashbox posting rules change.

## Final review corrections
- Preserve independent installment authority on linked invoices; any installment contract/history blocks archival. Conversion, collection and reconciliation lock the original graduation source first.
- Reject single-order payments exceeding pending-adjusted headroom; never approve a smaller amount silently.
- Fresh financial-row locks follow sorted original-source locks for synchronization, approval, cancellation, rejection and reversal. Cancellation audit remains atomic and cannot overwrite an executed approval.
- Resolve all receipt allocation aliases into one sorted original graduation row set. Linked sales cancellation preloads shared receipt sources before invoice/stock/financial locks; no sales calculations or presentation changes.
- Restore only the outstanding quantities from original stock movements, to their recorded stock owner. Preserve decimal thousandths. Missing or inconsistent historical evidence requires manual inventory review rather than guessing.
- Release enterprise reservations/material demand in the archive transaction without another stock movement. Exclude released and inactive orders from operational material demand; retain historical rows.

## Verification boundaries
Executable tests use the original handlers/helpers with controlled I/O, plus real Drizzle SQL compilation where appropriate. They are not live PostgreSQL concurrency proof. No isolated TEST database is configured: save-smoke and real database concurrency coverage are SKIPPED, never PASS. No schema changes, production diagnostic writes, UI/print design changes or historical financial repair. Generic draft financial metadata redesign and unrelated permission workflows are intentionally outside this increment; archived graduation sources remain blocked at payment execution.

## Release checklist / rollback (2026-10-23)
Approver: AJN project owner through the explicit continue/release authorization and AGENTS.md normal safe auto-release policy. Release coordinator: Codex. Scope: graduation archival and its financial/inventory writer admission; medium-risk shared financial helpers, no new dependencies or migrations.

- Required before commit: final `verify:critical` exit 0 (includes typecheck, payment-state, installment/archive and existing booking regressions, production build and whitespace). Earlier review-fix gate passed; final linked-invoice caller change requires a fresh full gate.
- Required before remote update: existing pre-push hook must pass; normal fast-forward only. Preserve unrelated dirty primary worktree.
- Required after push: exact new commit Ready / Production on the existing Vercel project, then read-only health/login/auth-boundary checks. Do not infer deployment success from an older healthy alias.
- Database write/concurrency smoke: SKIPPED, no separately verified isolated configuration; no fallback or new TEST database. Full staging write E2E, rollback rehearsal, telemetry/performance baseline and security dependency audit are not claimed. No dependency, frontend or schema changes require new visual/a11y/migration verification for this increment.
- No canary/feature-flag infrastructure changes: use existing owner-authorized Git-to-Vercel release. No new notification recipients or external messages.
- Previous verified Ready deployment: commit `95a867f816892e1befe24216ef931bdfdb4a234c`, Vercel deployment `AktZA3LTu5BPEAewLVXRW8kpWTop`. If deployment is not Ready, health fails repeatedly, auth boundaries regress, or data-integrity errors appear, stop further release/actions and evaluate promoting that existing artifact with the owner. Do not reset Git, rewrite history or roll back database records. No automated rollback was exercised.
- Long-lived production monitoring is not configured or claimed by this task. Existing API structured errors retain request IDs for operational diagnosis.

Release-candidate sign-off: Codex, 2026-10-23 21:30 Asia/Baghdad. Final full `pnpm run verify:critical` PASS after all review/caller fixes, including typecheck, payment-state, installment/archive regressions and production build. Isolated write smoke remains SKIPPED under the owner's normal release policy. GO for normal gated Git push only; exact Production deployment and read-only post-deploy checks still require separate confirmation.
