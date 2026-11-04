# Customer Follow-up Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans, with test-first implementation and task/whole-scope review.

**Goal:** Implement the supplied customer followup specification and mockup within AJN, preserving canonical customer, booking, staff, permissions and financial records.

**Architecture:** One shared contract, feature-owned additive storage/read/write module, original API authentication, shared admin/staff UI, and a narrow original booking transaction callback. No duplicate customer, booking, operational task, communication or accounting system.

**Tech Stack:** Existing TypeScript/React/TanStack Query/Wouter/shadcn, Drizzle/PostgreSQL, Zod and AJN structured errors.

**Spec:** `docs/superpowers/specs/2026-11-03-customer-followup-design.md` and the user's full functional request/mockup.

## Global constraints

- No commit, push, deploy, Production diagnostic/write tests, destructive migration or financial-record changes.
- Reuse original customer creation; do not call historical backfill GET /admin/customers for new read-only pickers.
- Explicit canonical customer/booking IDs, server-side assignment scope, durable idempotency, transactional multi-record changes.
- Followup reminders and suggestion computations do not contact customers or write notifications automatically.
- No hidden API/DB failures or invented missing booking occasions.

## Shared interface contract

Canonical API base: `/admin/customer-followups`, cookie/Bearer session as existing staff/admin API. Active employees may access assigned records; original customer permission gates global picker/create; admin/manager can manage all. Staff mode sends `scope=mine`, which also restricts a manager's staff view. Root passes `FollowupActor {id:number,role:string,permissions:string[],canBook:boolean,canCreateCustomer:boolean}` using original hasPermission, and maps module errors to original AJN payload/request ID.

`src/lib/customer-followups.ts` exports:

- `FOLLOWUP_SERVICES`: `{key,label}[]` with keys `photography,kosha,sound,wedding,henna,engagement,graduation,album,printing,booking_confirmation,other` (interest categories, not duplicate service records).
- `FollowupStatus = 'interested'|'waiting'|'converted'|'uninterested'` and labels, date/WhatsApp helpers as needed.
- `FollowupCustomer {id,name,phone,avatarUrl?:string|null}`; `FollowupEmployee {id,fullName,department?:string|null,avatarUrl?:string|null}`.
- `FollowupBooking {source:'service'|'kosha',id,number,href}`.
- `FollowupRow {id,customer,serviceKey,followupAt,status,employee,note,completedAt:string|null,version,contactBlocked:boolean,booking:FollowupBooking|null,createdAt:string}`.
- `FollowupSuggestion {key,customer,serviceKey,reason,sourceBooking:FollowupBooking|null}`.
- `FollowupSummary {today,overdue,upcoming,converted,total,completed}` numbers.
- `FollowupList {rows:FollowupRow[],summary:FollowupSummary,suggestions:FollowupSuggestion[],page,pageSize,total,capabilities:{canManage,canCreate,canBook,canCreateCustomer,canOpenCustomer}}`.

API:

- GET base: `q,serviceKey,status,employeeId,bucket,page,pageSize,scope=mine`. Bounded, same scope for counts and suggestions. Bucket affects rows, not KPI totals for other filters. Four KPI cards only; report uses same summary.
- GET `/options?q=`: `{customers:FollowupCustomer[],employees:FollowupEmployee[]}` minimal projections; manager sees assignment roster, ordinary creator self only. Requires canCreate.
- GET `/employees`: existing followup assignee filter roster, including former/inactive assignees; manager/all only. Does not grant customer-directory access.
- GET `/:id/assignees`: active reassignment candidates, manager/all only; source checked before returning the roster.
- GET `/summary?scope=mine`: one assigned-only aggregate query for portal reminders; no suggestion/list reads or notification writes.
- GET `/:id`: `{followup:FollowupRow}` (booking prefill); access checked.
- GET `/:id/customer`: `{customer:FollowupCustomer}` scoped, for read-only open-client preview without broad customer permission.
- POST base: `{customerId,serviceKey,followupAt,assignedStaffId,note?,idempotencyKey,suggestionKey?,sourceBooking?}` → `{followup:FollowupRow}`.
- POST `/:id/actions`: `{action:'complete'|'postpone'|'status'|'link_booking'|'stop_contact'|'resume_contact'|'assign',expectedVersion,idempotencyKey,note?,nextFollowupAt?,followupAt?,status?,booking?,assignedStaffId?}` → `{followup:FollowupRow,nextFollowup?:FollowupRow}`. `status='converted'` alone is rejected; conversion needs canonical booking. Managers explicitly confirm restored contact for resume_contact; uninterested is service-specific. Reassignment can repair an inactive former employee without reactivating that account; the new assignee must be active.

`src/server/customer-followups.ts` exports `CustomerFollowupError` (status, code, message, retryable optional, existingBooking optional), `handleCustomerFollowupRequest(db,actor,{method,parts,query,readBody}) -> Promise<{status:number,data:unknown}>`, `completeFollowupConversion(tx,{actor,followupId,customerId,booking:{source:'service',id:number}})` for original admin afterCreate callback. Ordinary calls with no source do not use new storage; no shared booking helper modification.

## Review focus

- Unauthorized employees cannot infer others' rows/customers/counts/suggestions or mutate by guessing IDs.
- Lost responses/parallel create/complete+next/conversion cannot leave duplicate records or partially committed source state.
- Declining one service is distinct from explicit global contact stop; neither creates communications.
- Missing schema/failed query cannot turn into zero KPIs/empty records or DDL.
- Unknown occasions and booking fields remain unknown; canonical identity/provenance, not fuzzy matching, governs conversions.

## Tasks

### 1. Foundation and feature storage (backend worker)

Ownership: shared contract, new followup server module, new schema module/export, one isolated additive migration and focused domain/repository/schema tests. No API.ts or UI edits.

- [x] Test-first shared types/date/status/suggestion rules and actual persistence interface.
- [x] Transactional create/actions/consent, durable replay and duplicate indexes; scoped read/list/options/customer/suggestions/report.
- [x] Source-owned conversion helper in same module for root integration; lock/identity checks and typed already-converted recovery.
- [x] Focused controlled-I/O tests and task review; no database connections or Production writes.

### 2. One clean shared admin/staff page (UI worker)

Ownership: `src/views/admin/customer-followups.tsx` and focused UI/browser tests only. Root owns routes/sidebar/staff portal and booking form.

- [x] Test-first four compact KPIs, real errors, table/cards responsive, customer/employee picker, one-button save, complete/postpone, optional note/next, status/conversion, manual contact links and scoped customer preview.
- [x] Export default `CustomerFollowupsPage({mode?:'admin'|'staff'})`; staff mode uses `scope=mine`, original session and same API; capability gates hide global creation/management.
- [x] Suggested followup selection prefills the same dialog, never contacts/saves automatically; footer report from real summary.
- [x] Stable per-attempt idempotency; no false success or swallowed errors; targeted tests and task review.

### 3. Original app integration (root)

Ownership: `src/server/api.ts`, `src/views/admin/index.tsx`, `_layout.tsx`, `src/views/staff/{unified-portal,index}.tsx`, `src/views/admin/booking-center.tsx`, `src/lib/booking-repeat.ts`, focused integration tests/package test registration/docs.

- [x] Add auth/error/permission wrapper routing to module; no runtime DDL, private no-store replies, safe request ID logs.
- [x] Place sidebar entry under العملاء, preserve old customer routes. Shared assigned-only staff page and in-app reminder badge; do not broaden unrelated staff portal access.
- [x] Followup booking context prefill/locked canonical customer; original admin booking afterCreate callback calls source conversion helper before existing photography callback. Preserve typed conflicts before generic booking-save mapping. Strip conversion metadata in repeats.
- [x] Controlled-I/O tests cover no-source legacy behavior, canonical mismatch/retry rollback, customer identity and original financial source bodies unchanged. Actual PostgreSQL concurrency is not claimed.

### 4. Final verification and report

- [x] Independent reviews and introduced issues resolved. Final patch review clean; source customer preserved before phone resolution, saved source recovery precedes resource validation, and followup routes skip unrelated financial/customer bootstrap. No live PostgreSQL validation claimed.
- [x] Mounted local/synthetic desktop/mobile tests (1440/390px), no real outbound WhatsApp or Production mutations. Actual shared page, original Booking Center and original Staff Portal tested; query-only reminder navigation and single-row mobile footer checked.
- [x] Final `pnpm run verify:critical` exit 0 after all review fixes, including actual typecheck/build/payment-state and 13 focused suites. Full synthetic browser acceptance passed. DB smoke/PG concurrency/migration execution SKIPPED without a separately verified TEST database, never PASS. Lint not configured.
- [x] Full file/migration/limits report: `docs/reports/2026-11-04-customer-followup-center.md`. All code remains local, uncommitted, unpushed and undeployed; migration 0134 not applied.
