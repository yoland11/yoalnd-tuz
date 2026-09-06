# Task 1 report — Kosha manager instruction schema

## Files changed

- `lib/db/src/schema/kosha-manager-instructions.ts`
- `lib/db/src/schema/index.ts`
- `lib/db/migrations/0110_kosha_manager_instructions.sql`
- `scripts/test-kosha-manager-instructions-schema.cjs`
- `package.json`

## Decisions

- Added two tables only; no existing `kosha_media`, booking, finance, inventory, or timeline table is altered.
- Modelled booking identity as the required `(booking_source, booking_id)` pair without a polymorphic foreign key.
- Constrained both tables' booking sources to `kosha | service`; constrained instruction kind and channel values; image instructions require a non-empty media URL and note instructions require no media URL.
- Kept nullable instruction staff attribution on `ON DELETE SET NULL`; used `ON DELETE RESTRICT` for the required read-state staff owner so a staff deletion cannot silently discard read state.
- Exported Drizzle relations and select/insert inferred types for both tables.
- Added the required active-instruction, unique read-state, and booking/channel lookup indexes.
- The focused test loads the actual TypeScript schema through a small local CommonJS TypeScript loader because the worktree does not contain the optional Windows esbuild package required by `tsx`.

## TDD evidence

1. Added the schema contract test before the schema. `pnpm run test:kosha-manager-schema` failed as expected with:

   ```text
   AssertionError [ERR_ASSERTION]: koshaManagerInstructionsTable must be exported as a Drizzle table
   ```

2. Added the two table definitions, relations, index export, and the single additive migration. The focused test then passed.
3. Added the missing read-state `booking_source` check assertion. The focused test failed as expected with:

   ```text
   AssertionError [ERR_ASSERTION]: reads must constrain booking source and channels
   ```

4. Added that check to both Drizzle schema and migration. The focused test passed again.

## Verification

```text
$ pnpm run test:kosha-manager-schema
PASS: Kosha manager instruction and channel read schema contracts

$ pnpm run typecheck
$ tsc --noEmit

$ git diff --check
(no output; exit 0)
```

## Concerns

- No isolated `TEST_DATABASE_URL` was configured, so no database write/migration apply was run. The migration remains reviewed additive DDL only and must be applied through the repository's reviewed migration process.
- `pnpm run test:db-contracts` uses `tsx`, which cannot start in this worktree because `@esbuild/win32-x64` is absent. The new focused test avoids that unavailable optional binary and executes against the real exported Drizzle schema.

## Review round 1 — 2026-09-06

### Changes

- Strengthened `test-kosha-manager-instructions-schema.cjs` to assert rendered Drizzle check SQL, FK targets and delete actions, `revision`'s exact default, index names/columns/uniqueness, inferred enum values, and the reviewed migration's actual DDL clauses.
- Added `KOSHA_BOOKING_SOURCES` and passed the source, kind, and channel literals to Drizzle `varchar(..., { enum })` definitions so the inferred insert/select types are narrow unions.

### TDD evidence

The strengthened test failed before the schema enum update with:

```text
AssertionError [ERR_ASSERTION]: kosha_manager_instructions.booking_source must retain its inferred union
actual: undefined
expected: [ 'kosha', 'service' ]
```

After adding the enum options, it passed.

### Verification evidence

```text
$ pnpm run test:kosha-manager-schema
PASS: Kosha manager instruction and channel read schema contracts

$ pnpm run typecheck
$ tsc --noEmit

$ pnpm run build
✓ Compiled successfully in 8.2s
(command exit 0)

$ pnpm run verify:critical
AJN DATABASE INTEGRATION TESTS SKIPPED — no valid isolated TEST_DATABASE_URL is configured.
...
[AJN] TypeScript
$ tsc --noEmit
...
[AJN] Database contracts
$ node ./scripts/run-tsx.mjs --tsconfig ./tsconfig.json ./scripts/test-db-contracts.ts
Error: The package "@esbuild/win32-x64" could not be found, and is needed by esbuild.
...
AJN CRITICAL REGRESSION
Subsystem: Database contracts
Deployment: BLOCKED
```

`pnpm run test:save-smoke`: **SKIPPED**. No separately verified `TEST_DATABASE_URL` is configured; it was not run against `DATABASE_URL` or Production.

### Round-1 release concern

`verify:critical` cannot pass on this Windows worktree because `pnpm-workspace.yaml` intentionally overrides `esbuild>@esbuild/win32-x64` to `-`; therefore the shared `tsx` runner used by `test:db-contracts` cannot start. This infrastructure-level issue is outside the isolated Task 1 schema scope. Per AJN policy, the round-1 changes are not committed while the mandatory critical verification remains blocked.

## Review round 1 — critical gate unblocked

The established local binary workaround was used only for the verification process:

```powershell
$env:ESBUILD_BINARY_PATH='C:\project\yoalnd-tuz-main\tmp\esbuild-windows-0.27.3\package\esbuild.exe'
pnpm run verify:critical
```

Exact verification result excerpts:

```text
AJN DATABASE INTEGRATION TESTS SKIPPED — no valid isolated TEST_DATABASE_URL is configured.
Run `pnpm run verify:strict` with AJN_ENV=test, ALLOW_TEST_WRITES=true, and a separate TEST_DATABASE_URL to include write/integration tests.

PASS  22 critical AJN database table contracts are backward-compatible
PASS  Additive tables/columns and harmless indexes remain allowed
PASS  AJN database write guard fails closed and rejects production aliases
PASS  application server request code performs no DDL
PASS  Phase 2 migration includes distributed limiter and schema revision marker
PASS  Critical-file change policy (standard)
AJN FINANCIAL APPROVAL CONTRACT PASSED — cash-box posting remains approval-first.
AJN PAYMENT STATE CONTRACT PASSED — approved payment snapshots reconcile centrally.
✓ Compiled successfully in 5.6s
```

The command exited successfully. The focused schema contract was also rerun:

```text
$ pnpm run test:kosha-manager-schema
PASS: Kosha manager instruction and channel read schema contracts

$ git diff --check
(no output; exit 0)
```

`pnpm run test:save-smoke`: **SKIPPED**; no verified isolated `TEST_DATABASE_URL` is configured, and it was not run against Production.

## Review round 2 — exact migration contract

Covering test file: `scripts/test-kosha-manager-instructions-schema.cjs`.

The migration assertion now strips line comments, rejects destructive statement starts (`ALTER`, `DELETE`, `DROP`, `TRUNCATE`, `UPDATE`), splits SQL into statements, and compares the complete normalized statement list to the reviewed contract. The contract contains exactly the two `CREATE TABLE` statements and three named index statements; it therefore detects omitted or nullable columns, altered defaults/checks/FKs, index drift, commented-out DDL, destructive DDL, and any unreviewed extra statement. Negative fixtures exercise nullable drift, `DROP TABLE`, an extra index, and a commented-out table declaration.

Verification:

```text
$ pnpm run test:kosha-manager-schema
PASS: Kosha manager instruction and channel read schema contracts

$ pnpm run typecheck
$ tsc --noEmit

$ pnpm run build
✓ Compiled successfully in 6.3s
(command exit 0)

$env:ESBUILD_BINARY_PATH='C:\project\yoalnd-tuz-main\tmp\esbuild-windows-0.27.3\package\esbuild.exe'; pnpm run verify:critical
AJN DATABASE INTEGRATION TESTS SKIPPED — no valid isolated TEST_DATABASE_URL is configured.
PASS  22 critical AJN database table contracts are backward-compatible
PASS  Additive tables/columns and harmless indexes remain allowed
PASS  AJN database write guard fails closed and rejects production aliases
PASS  application server request code performs no DDL
PASS  Critical-file change policy (standard)
AJN FINANCIAL APPROVAL CONTRACT PASSED — cash-box posting remains approval-first.
AJN PAYMENT STATE CONTRACT PASSED — approved payment snapshots reconcile centrally.
✓ Compiled successfully in 6.2s
(command exit 0)
```

`pnpm run test:save-smoke`: **SKIPPED**; no verified isolated `TEST_DATABASE_URL` is configured, and it was not run against Production.
