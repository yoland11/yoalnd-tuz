# Installment approval safety release

## Scope

User authorized releasing the completed installments fix first, then continuing
the unfinished Smart Booking phases separately. Baseline:
`feea66db025c77ac09ee679d4d6a78a164ce792a` (`origin/main`).

The original completed financial slice was extracted from `codex/kosha-equipment`.
Its tracked financial baselines match upstream. No API, inventory, Smart Booking,
printing, schema, package or dependency changes are included. Historical records
are not repaired or migrated.

## Behavior and shared caller impact

- Pending payment requests reserve available balances, not official settlement.
  Approval posts contract, schedule and invoice once in the existing cash/ledger
  transaction. Rejection never settles money; full reversal restores the original
  allocations. Unsupported partial/ambiguous legacy reversals fail closed.
- Financial approval callers: central API, employee advances and HR intelligence.
  New posting side effects apply only to installment sources.
- Central rejection now locks the original transaction and changes source/status
  and audit atomically. Central reversal also locks the original for safe retries;
  callers include API handlers, salaries and HR intelligence.
- Canonical payment-state changes add executed installment sources only to sales
  invoice aggregation. Payments are not counted as extra revenue or duplicated
  receipt allocations.
- Independent review identified and reproduced multi-schedule allocation, final
  cent approval and unproven legacy paid-snapshot defects. Each received an
  actual-function RED-to-GREEN test and a minimal correction. A mismatched old
  balance now fails for manual review and rolls back the original transaction;
  it is never invented as new money or silently repaired. Only the existing
  explicit administrator reconciliation event may intentionally reconcile it.

## Evidence

- `pnpm run test:save-contracts`: PASS (read-only save/API/legacy and real form handlers).
- `pnpm run test:installments`: PASS (15 contracts, actual retry form,
  multi-schedule/pending-hold allocation and posting/legacy-history safeguards).
- `pnpm run test:payment-state`: PASS; repeated by final critical gate.
- `pnpm run verify:critical`: PASS, exit 0 after all runtime review fixes; includes
  TypeScript, financial invariants, existing regressions, production build and
  whitespace. The existing pre-push gate repeats these checks for the commit.
- Independent post-fix review: ACCEPT; no remaining Critical/Important findings
  in the bounded financial slice. In-memory mutation checks detect removing the
  four relevant guards. This does not certify PostgreSQL concurrency/rollback.
- Database write/save-smoke/concurrency: **SKIPPED**, not passed. User requested no
  TEST database; no Production diagnostic writes or database configuration changes.
  Prior exact-source isolated PostgreSQL evidence is recorded in the development
  ledger, not represented as a fresh integration run of this extraction.
- No lint command configured. No migration required.

## Release / rollback

Push only the verified commit to remote `main`, without force and through the
existing pre-push gate; Vercel's connected Git integration deploys it. Match the
exact SHA in deployment status and perform public read-only login/page checks.
Do not create a real payment as a production smoke test. Report unavailable
authenticated monitoring explicitly.

Failed deployment is not publication. Rollback uses the previous Vercel deployment
or a reviewed code revert, never financial-record deletion, automatic payment
reversal or destructive schema changes. Unfinished Smart Booking phases and the
primary checkout's unrelated graduation work remain outside this release.
