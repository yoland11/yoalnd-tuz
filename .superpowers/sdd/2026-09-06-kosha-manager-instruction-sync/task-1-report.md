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
