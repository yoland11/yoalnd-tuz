# Graduation archival UI completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this already-authorized continuation.

**Goal:** Finish the existing individual and group-student archive controls on desktop/mobile using the published safe DELETE routes.

**Architecture:** One shared confirmation/controller per list, existing AlertDialog/Button/Alert primitives, existing permissions and query invalidation. No new server, inventory, payment, printing or schema implementation.

**Tech Stack:** Existing React, TanStack Query, Radix/shadcn and Arabic RTL tokens. No dependency changes.

**Spec:** User-approved individual/student-only cancellation and archival with retained history, exact server reasons and protection for paid/started orders. This is the UI remainder of the previously implemented archive workflow, not a new business rule.

## Global Constraints
- Preserve primary dirty checkout and existing print/receipt designs.
- Group students use `/admin/graduation/groups/{groupId}/students/{id}`; individual orders use `/admin/graduation/orders/{id}`.
- Server remains authoritative; do not locally infer payment or production eligibility.
- Permission-loading/missing users cannot archive. Require explicit confirmation; no optimistic removal or request retry.
- Pending confirmation cannot be dismissed or double-submitted. Errors retain target and show server reason; success invalidates graduation views.
- Run typecheck, build, verify:critical and payment-state. Isolated DB write tests SKIPPED without verified test configuration. Publish only after required gates and review.

## Review Focus
Unknown permissions; same numeric IDs in different groups; repeated confirmation before render; rejected request retaining the target; long Arabic names/mobile overflow and keyboard cancellation.

### Task 1 — Complete archive UI
**Files:** create `src/views/admin/graduation-archive.tsx`, `scripts/test-graduation-archive-ui.mjs`; narrowly modify the existing two graduation list views, package script and critical runner.
**Interfaces:** `GraduationArchiveTarget = {id:number;groupId?:number|null;orderNo:string;customerName:string}`; `useGraduationOrderArchive(user:AdminMe|null|undefined)` returns permission predicate, request callback, pending state and confirmation element.
- [x] Write executable controlled-UI regressions: independent permissions, exact routes, no pre-confirm DELETE, refusal/network retention, cancel without mutation, successful invalidation and rapid duplicate prevention. Verify RED.
- [x] Implement shared RTL confirmation with existing primitives and integrate desktop/mobile actions without copying older whole-file drafts. Verify GREEN and original archive suite.
- [x] Run required gate and one fresh final review. No Important/Critical findings. Preserve the deferred non-blocking browser-coverage suggestion.
- Release: integrate latest main, rerun required gates, commit/push through existing hooks and verify exact Production SHA/health; record deployment evidence in the local task ledger.

### Browser regression
`pnpm run test:graduation-archive-browser` uses an already-installed Playwright runtime specified by `AJN_BROWSER_RUNTIME` (path to its package.json) and optionally `AJN_BROWSER_EXECUTABLE`. No dependencies are installed. It mounts the original list/group components against controlled local API responses at 1440/768/390px, checks exact DELETE scope, cancellation focus, blocked response retention, pending dismissal prevention and successful refetch. No Production or real database writes.

Deferred minor from final review: add substantially longer Arabic names and non-pending Escape cancellation to the browser fixture. Normal-name layout, mouse cancellation/focus and pending Escape are covered; no corresponding implementation defect was found.
