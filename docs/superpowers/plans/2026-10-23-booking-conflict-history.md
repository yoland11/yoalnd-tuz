# Booking conflict history retention Implementation Plan

> Execute inline with superpowers:executing-plans and TDD, followed by one fresh whole-increment review. Continue the owner's explicitly approved remaining conflict work; no new design questionnaire or partial release.

**Goal:** Settled quantity history must not exhaust the report's live-evidence allowance.

**Architecture:** One bounded original-source read of at most 5,001 rows; reject over 5,000 total records. Exclude only explicitly tracked, safely counted, balanced closed quantity lines through original normalization/outstanding/reserved helpers. Keep the existing 500 live/uncertain cap and original evaluator. No shared writer, API/UI DTO, stock movement, schema or financial changes.

**Tech Stack:** Existing TypeScript, Drizzle SQL and AJN test/browser infrastructure.

**Spec:** Owner's approved Smart Booking Operations resource-conflict requirements and latest continuation of the reported history-limit limitation.

## Global Constraints

- Same original source/booking/product identities; validate identity before any discard.
- Unknown, malformed, legacy, fractional, outstanding or over-returned evidence is retained, never silently converted to availability.
- No Production write tests or new database. Isolated TEST coverage is SKIPPED when unavailable.
- Preserve latest published scheduling/photography changes and unrelated dirty worktrees. No partial commit/release before required checks and review.

## Task 1: Report-only history adapter

Files: create `src/server/booking-conflict-history.ts`; modify `src/server/booking-conflict-report.ts` and `scripts/test-booking-conflict-report.ts`.

Interface: `readConflictQuantityHistory(result: unknown, productIds: number[]): any[]`; consumed only by the existing authorized report GET's loader. Shared resourceRows/quantity evaluators/reservation writers stay unchanged.

- [ ] RED actual report with 1,000 settled rows plus active demand; retain original shortage 10 required/7 available/8 reserved/3 missing after GREEN.
- [ ] RED→GREEN safe closed counters vs booleans, empty strings/arrays/objects, fractions, invalid identities, outstanding cancelled rows and over-returns.
- [ ] Verify 500/501 live and 5,000/5,001 total boundaries, one SQL overflow sentinel and propagated DB failures. Never claim unlimited historical support.

## Task 2: Validate, review and release

- [ ] Run report suite, actual workspace browser 1440/768/390 RTL, typecheck/build/payment-state/verify:critical. No lint script; isolated TEST checks SKIPPED without verified configuration.
- [ ] One fresh whole-increment review; one Important/Critical tested fix pass; document rulings/deferred minors.
- [ ] Normal gated main push and exact-SHA Vercel Ready; read-only health/auth checks only. Preserve host worktree.

## Review Focus

- No terminal status or malformed counter may hide physically outstanding or uncertain units.
- Numeric coercion must not accept booleans/empty text/arrays as safe settled counters.
- Cap overflow, even all settled rows, fails explicitly; invalid source/product/booking fails before filtering.
- Dropping a row must leave original quantity evaluator results and global checkout reconciliation unchanged.
- Controlled IO is not PostgreSQL concurrency/performance certification; no invented TEST pass.
