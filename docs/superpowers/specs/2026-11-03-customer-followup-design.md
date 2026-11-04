# AJN Simple Customer Follow-up Center

User specification and attached mockup define the requested UI and behavior. Implementation stays in the existing isolated workspace, without commit, push, deployment, financial changes or Production diagnostic writes.

## Existing architecture audit

No CRM follow-up/inquiry persistence currently exists. Payment/order followup notifications concern other workflows. Public `message_threads` changes communication state and notifies customers; operational `tasks` participates in preparation, booking and approval lifecycles. Reusing either as a CRM database would change unrelated behavior. Existing customer identities, staff sessions, customer creation, Booking Center, avatar/employee controls, phone helpers and error contract are reusable.

Implement only missing followup records and their audit/retry and contact-preference data, in one isolated additive migration. Do not copy customer/staff/bookings or modify existing table definitions. No migration is applied to Production for UI testing.

## Page and reuse

`/admin/customer-followups` appears beneath العملاء alongside existing customer management/search links. Four compact KPI buttons (today/overdue/upcoming/converted), one searchable/paginated responsive table, small add/complete-with-options/postpone dialogs, secondary report disclosure and bounded suggestions strip. Reuse AJN controls, EmployeeSelect, customer quick creation, avatars, existing phone formatting and literal manual WhatsApp links. No automated message sending.

Staff see the same component in assigned-only mode at `/staff?tab=followups`, with a badge/link inside the original portal. No global role grants; ordinary staff can read/contact/complete/postpone only their assigned rows. Managers/admin can see/assign all. Global customer search/create requires original customer access; scoped contact details do not expose financial or administrative customer data.

Separate inquiry status (`interested`, `waiting`, `converted`, `uninterested`) from completion and date-derived overdue/upcoming state. Plain completion is one click. Optional note/next date is a separate small action; next date creates a linked followup preserving the completed record. Ineligible/declined/converted/completed items are excluded from due reminders. Distinct booking references determine conversion statistics.

`uninterested` ends this service inquiry and suppresses that service's suggestions. An explicit «إيقاف التواصل» action records a customer-wide stop, suppresses all suggestions and contact actions. It is separate from declining one service. Consent state must not be inferred from payments or notes. No permanent deletion UI is introduced.

## Data and operations

Feature tables: `customer_followups` (canonical customer FK, interest key, assignee, due timestamp, note, inquiry status, completion, source/linked booking refs, parent, version, creator/timestamps, create nonce/hash, suggestion key); `customer_followup_events` (immutable action/audit, unique request token/hash and replay result); `customer_followup_contact_preferences` (customer PK, contact opt-out, actor/time/version). Existing tables remain authoritative for identities and bookings.

An open customer/service pair is unique. Suggestion source keys are unique and preserve completed/declined history. Every mutation validates source, actor, active assignee and optimistic version under transaction locks; durable request replay is checked before stale-version rejection. Multi-record complete+next and conversion writes are atomic. No notification records are produced repeatedly: in-app reminders/badges are derived from live scoped due records.

Read queries are bounded and paginated; all counts/suggestions/mutations use the same manager/all versus employee/assigned policy. No tenant/branch fields are invented: current customer/staff/auth records lack those fields. Missing migration/database faults return structured errors and safe request-ID logs, never an empty list or runtime DDL.

## Booking conversion

Followup action opens `/admin/bookings?followup=<id>`. Resolve canonical current customer through the followup API and prefill/lock that customer in the original unified form; propose real existing departments where applicable. Album/printing remain interests unless an actual service is selected, since they are not Booking Center departments.

Pass only `customFields.customerFollowupId` as conversion provenance (alongside the existing customer metadata and explicit occasion). The existing admin `POST /admin/service-orders` supplies an optional source customer resolver inside the original transaction: check source scope/eligibility, recover an already-converted booking before any booking/resource writes, lock the existing customer and validate its current normalized phone. Reuse the source customer ID without updating its stored phone/name or resolving another customer by phone variants. Then the original afterCreate callback sets the converted reference/audit in the same transaction before the existing photography callback. Public/no-source callers keep their original phone resolver and booking behavior. Repeat-booking removes the source metadata. No financial fields, formulas, approvals, receipts or cash entries change.

Blast radius: `createServiceOrderWithHistory` has exactly two callers in `src/server/api.ts`, original public service-order creation and original admin service-order creation. Only the latter supplies the optional resolver, and only when a followup source is present. The original insertion, resource validation, status history and photography synchronization remain in their original transaction. No-source requests must not query feature storage. Feature-owned `/admin/customer-followups` requests bypass broad admin schema/payment/customer backfills (including the separate staff/product probes), while retaining the original global schema revision and active-session validation.

The page can explicitly link an existing eligible booking through the original customer identity, without modifying that booking. Such links require exact customer/source checks; conversions are never guessed from names/phone or from a booking that predates the followup.

## Suggestions

Use explicit native kosha `event_type` or existing service `customFields.eventType/eventName`; unknown stays unknown, and kosha is not inferred to mean wedding. Known engagement → henna/wedding; henna → wedding; wedding/graduation → photography/album/printing as appropriate. Suppress already included departments, album delivery, existing graduation photography links, declined service interests, contact stop, existing open followups and the same accepted suggestion source. A customer inquiry can suggest booking confirmation. Suggestions are read-only until chosen; no automatic followup or booking creation.

## Acceptance and validation

Test status/date/KPI logic, Iraq time rendering, scope/permission rules, query errors, creation and action replay, stale/concurrent duplicates, complete+next atomicity, stop-contact, suggestion provenance/dedupe, canonical conversion rollback/retry, repeat provenance stripping, mobile/desktop and one-click completion. Use controlled adapters and synthetic HTTP for UI; PostgreSQL write integration is SKIPPED without separately verified TEST configuration. Run actual package commands typecheck/build/verify:critical and relevant tests. No commit/push/deploy.

Final-review regressions additionally execute the original booking helper/insertion/options and API bootstrap predicates with controlled SQL, covering formatted/Unicode/duplicate phone variants, changed source phone, unauthorized source, saved-booking recovery before equipment conflicts, and no-source compatibility. Browser acceptance mounts the actual shared screen, Booking Center and Staff Portal at 1440px/390px; no API request reaches a real backend.
