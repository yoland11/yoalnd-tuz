# Scientific Research Department Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. No commits, pushes or deployments are authorized in this task.

**Goal:** Complete the existing Scientific Research Department, including operations, receivables and approved financial integration.

**Architecture:** Extend existing research records and routes. Central approvals, canonical payment-state, customers, invoices, expenses and private file storage remain authoritative.

**Tech Stack:** Existing Next.js, React, TypeScript, Drizzle/PostgreSQL, shadcn, Supabase and AJN printing/export utilities.

**Spec:** docs/superpowers/specs/2026-11-16-scientific-research-design.md and user's complete specification/image.

## Global Constraints
- DO NOT COMMIT, PUSH, OR DEPLOY.
- No Production writes or destructive migrations; one additive migration file only.
- Preserve existing records, IDs, public/admin routes and specialist source/AI functions.
- Structured errors must remain visible. Failed reads never become empty data or zero balances.

## Review Focus
- Legacy status/category/null due dates remain accessible and never fabricate overdue debt.
- Parallel/pending/retried payments and mirror invoices cannot overcollect or double-post.
- Nonfinancial staff cannot read money; chapter/file IDs cannot reference another order.
- Partial failures never produce broken order/invoice/assignment histories.
- Real controls work at narrow widths, and exports contain selected actual records with clear period scope.

### Task 1: Shared domain and analytics (root)
Files: src/lib/research-contract.ts, src/server/research-analytics.ts, scripts/test-research-domain.ts.
- [x] Write and observe failing stage/date/filter/money tests, implement common stage/category/date contracts.
- [x] Implement bounded joined order/board/receivable/dashboard/report queries and notifications derived from actual records; financial projection gated.
- [x] Verify domain and query behavior, no Production calls.

### Task 2: Research operations and additive schema (worker)
Files: src/server/research-center.ts, lib/db/src/schema/research-center.ts, lib/db/migrations/0139_scientific_research_department.sql, research operation tests.
- [x] Extend validated form fields/customer selection/creation idempotency/assigned staff.
- [x] Make update/assignment/status/chapter/file version writes transactional; enforce grant matrix and owned child references; private upload metadata/checksum.
- [x] Add safe version reads, supervisor/revision messages, final delivery, root analytics and finance module routes.
- [x] Verify tests before and after changes; preserve legacy routes/specialist functionality.

### Task 3: Canonical research money (worker)
Files: src/server/research-finance.ts, narrow research-specific edits in payment-state.ts/master-cash-box.ts, existing expenses schema link, financial tests.
- [x] Test excessive payment/pending reservation/idempotency mismatch/rejected retry/approved reversals.
- [x] Implement approval-first receipt and expense requests in transactions, configurable payment metadata, authoritative history/statements.
- [x] Add proven research approval guard and canonical mirror reconciliation; inspect callers and preserve other sources.
- [x] Run payment-state and new financial tests.

### Task 4: Complete Arabic department UI (worker)
Files: existing research UI and new research components, admin route/sidebar, research print helper.
- [x] Implement ten-card dashboard and six-stage Kanban; navy/gold scoped theme and visible fetch errors.
- [x] Complete new/edit form, workspace including immutable versions, secure upload/feedback/delivery and approved/pending money.
- [x] Add receivables/statement/payment/expense/reports pages with filters, print/PDF/Excel and manually reviewed WhatsApp.
- [x] Gate actions using existing user grants; preserve existing catalog/sources/AI pages.
- [x] Add meaningful component/interaction tests.

### Task 5: Review, integration and evidence (root + independent review)
- [x] Review each changed boundary, then run independent final review and fix actionable findings.
- [x] Run typecheck, build, existing/new research and payment-state tests, verify:critical.
- [x] Run test:save-smoke only with verified isolated flags/URL, otherwise report SKIPPED.
- [x] Browser-check actual UI with isolated fixtures, mobile/RTL and print outputs; no Production mutations.
- [x] Deliver changed file/migration/storage/verification/limitations report; leave changes uncommitted.
