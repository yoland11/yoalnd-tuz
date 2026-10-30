# AJN Booking Transport Receipt — Design

Date: 2026-10-24
Status: APPROVED — owner replied `نفذ` after receiving the written design
Release authorization update: owner subsequently requested `كمل ارفع وانشر`.
Commit/push/deploy are now authorized ONLY on full intended feature completion
and passing required gates; no partial release or Production diagnostics/writes.
Inspected code baseline: c7892e7baf9546f0fefa2e4f43a53122263d80e4

## Intent and agreed decisions

Add a dedicated Arabic 80mm transport receipt to the existing Booking Center,
booking transportation card and fleet trip history. Staff select one transport
operation, preview it, select copies/recipient, then request browser printing.
Printing is not payment, checkout, dispatch completion or proof of physical output.

The owner explicitly chose BOTH pricing modes, selectable per booking:

1. Per-trip customer charges: each active trip has its own charge; their sum is
   the booking's transportation charge, included only once in its total.
2. One overall customer charge: one charge covers the booking's transport trips.
   Each receipt labels it `أجرة النقل الكلية للحجز`; it is not a per-trip charge.

The owner accepted extending existing transportation data and preserving the
separation between customer charge, driver payment and vehicle expenses.

DO NOT COMMIT, PUSH OR DEPLOY. No Production data changes, configuration/secret
changes, historical backfill, destructive migration or write diagnostics.

## Existing architecture / reuse audit

| Concern | Current implementation | Consequence |
| --- | --- | --- |
| Booking workspace | `src/views/admin/booking-operations-workspace.tsx` | Reuse original source/id, transportation card, print menu, permissions and query invalidation. |
| Booking Center | `src/views/admin/booking-center.tsx` | Add one secondary action, not a new row of buttons. |
| Service transportation | `src/server/api.ts`: `BookingTransportationSchema`, booking-operations `/transportation` GET/POST/PATCH | One config in `custom_fields.bookingOperations.transportation`; replacement writer must preserve additive trip data. |
| Kosha transportation | Original Kosha PATCH in `api.ts`; `lib/db/src/schema/koshas.ts` | Columns are authoritative: mode/fee/vehicle/driver/notes. Original route deliberately rejects transport changes after executed payments. Preserve that rule. |
| Booking JSON | `saveBookingOperations`, `bookingEvidenceWriteSql`, `routedKoshaCustomFieldsSql` | Use existing JSON storage and merge contracts, not a second transport database. |
| Financial aggregation | `src/lib/booking-transport.ts`, original Kosha/service total writers, canonical payment reconciliation | Persist one aggregate customer charge; print only consumes it. |
| Resource occupancy | `booking-resource-period.ts`, `booking-resource-availability.ts`, `booking-dispatch.ts`, `booking-conflict-report.ts` | Reuse locks, operating windows and conflict errors. Current reads only identify one transport vehicle/driver and must include additional trips. |
| Dispatch | `dispatch_assignments`, unique `(entity_type,entity_id)` | Remains one booking dispatch; never create one dispatch row per receipt/trip. |
| Fleet trips | `src/views/admin/vehicles.tsx`, fleet financial API in `api.ts` | Trips are projections of booking transportation, not an existing standalone trip table. Extend this projection. |
| Vehicle expenses | `vehicle_expenses` and canonical financial transactions | Approved/executed expense references remain unchanged; do not infer driver payable from an expense's driver ID. |
| Driver settlement | No dedicated due/paid/remaining driver settlement source found in inspected modules | Show unavailable rather than invent balances or add a parallel settlement ledger. |
| Delivery | `delivery.tsx`, `delivery-orders.tsx`, `schema/delivery.ts` | Shop/POS/province shipment flow, not booking transportation. Do not attach booking transport to these unrelated sales records. |
| Printing | `print-format-dialog.tsx`: `printHtmlDocument`, existing thermal preview/helpers | Reuse popup/image-ready machinery; add a feature-specific preview wrapper for recipient/copies/settings. |
| Remote print queue | `src/server/remote-printing.ts` | Sales-only payload/queue. Do not submit transport IDs as sales invoices or change Print Agent protocol. |
| Settings/branding | `settingsTable`, public company settings, existing admin authorization | Separate namespaced receipt settings in the same settings infrastructure. Do not overwrite global printer settings. |
| Audit | `entity_timeline`, `logAdminActivity` | Log receipt print request, not physical success. No financial postings. |

The screenshots illustrate the intended receipt and interaction, not existing
trip records, example values, a new module or authorization to redesign A4.

## Approaches and selection

Selected: extend the existing booking transport aggregate with an optional
operational trip plan, and render a dedicated transport document through existing
browser printing. This preserves original pricing/accounting and historical data
while supporting the owner's two pricing modes.

Rejected: receipt-only rendering of the original single config cannot represent
multiple selected operations. A standalone transportation/driver ledger or new
print queue would duplicate existing systems and violate the requested scope.

The implementation stays in the existing TypeScript/React/Next/Drizzle stack.
No new printing dependency or ERP module is planned.

## Additive operational data, no schema migration planned

Use optional `bookingOperations.transportPlan` in the existing booking JSON
(`booking_details` for Kosha; `custom_fields` for service). This is an extension
of existing transport, not a second financial source. Proposed versioned shape:

- version, optimistic revision, feeMode (`per_trip` / `overall`).
- trips: bounded list, maximum 50, immutable internal ID, immutable display
  sequence, optional transport type/assigned work, origin, destination, transport
  date, departure time, estimated arrival, vehicle ID, driver staff ID, dedicated
  printable transport notes and per-trip customer charge only in per-trip mode.
- optional explicit resource-occupancy start/end timestamps per trip, using the
  existing operating-window validation conventions; these cover loading through
  return/release, not just departure and estimated arrival.
- existing known status may be referenced; do not introduce incompatible enums.
- dedicated printable notes never fall back to admin/internal accounting notes.
- canceled historical operations remain identifiable; no destructive trip deletion
  or implicit financial removal. Do not add cancellation/financial reversal flows.

These are proposed JSON properties, not claims about existing database columns.
The authoritative aggregate remains the original transport fee field/column.
No due/paid/remaining driver snapshots are introduced.

If no plan exists, a read-only adapter exposes the saved single transportation
configuration as a legacy operation. No GET/preview/print creates records. Its
stable reference is based on the existing display booking reference plus a trip
sequence, never a new invoice/booking number. Internal IDs are not printed.
First explicit authorized plan save preserves that operation as trip 1; retries
use its stable identity and a revision check, not another append.

Missing fields show `غير مسجل`. Existing event/customer/location information may
prefill an explicit edit form, with its source visible; do not label an event time
as a known departure/arrival. Unknown transportation is not fabricated from a
dispatch assignment alone. A booking without transport shows the requested empty
state and an authorized link to its current transportation editor.

## Customer-charge safety

Resolve the plan and aggregate on the server, never trust a client-provided sum.
Amounts are validated finite, non-negative and within existing limits; use the
project's existing money precision/rounding rules.

- Per-trip: sum recorded active trip charges once. For legacy trip 1 its initial
  charge is the existing transport charge, not an additional charge.
- Overall: authoritative original transportation fee is the one total. No
  automatic split between trips, vehicles or drivers.
- Mode switch is an explicit preview-and-confirm financial edit. It never
  duplicates the existing charge or silently divides the overall charge.
- Saving routes retain original financial-edit permissions, paid-booking guards,
  transactional aggregate delta and canonical payment-state reconciliation.
- Same revision + same intended state is replay/no-op; stale different state is
  a structured 409 with refresh guidance. Never repeatedly add a delta on retry.
- Generic legacy transportation editors cannot overwrite a multi-trip plan or
  silently replace its aggregate: direct users to the current trip editor when
  their single-config mutation would conflict with the saved plan.
- Printing, settings, previews and copy selection never invoke a financial writer.
- No customer receipt is presented as proof that the amount was paid.

For financial reporting, per-trip revenue can be attributed by the recorded
charge using existing recognized-revenue rules. In overall mode, a multi-vehicle
total is explicitly unallocated: never book the full fee as revenue on every
vehicle or invent a split. Vehicle-specific executed expenses retain their one
underlying transaction. Booking profitability continues to use the one booking
aggregate and deduplicated canonical costs.

## Assignment, concurrency and shared-helper impact

Extend existing resource reads to collect all active trip driver/vehicle IDs,
retaining legacy singular fields for current consumers. Use existing booking
operating windows conservatively for resource occupancy; explicit trip dates and
times must be compatible with that window. Missing period/end information is not
silently conflict-free, and no synthetic travel duration is introduced.

Builder's safety decision, to be visible in the owner review: the same driver or
vehicle MAY serve successive trips of the same booking only when both trips have
explicit, valid, non-overlapping resource-occupancy intervals within the booking's
operating window. Touching endpoints follow the existing half-open overlap rule.
An ETA is not automatically a resource release time. When either interval is
missing, conservatively use the full booking operating window and block that
same-resource reuse with a precise Arabic instruction to document the intervals
or select another resource. Do not guess a return time. Offer these interval
fields as advanced scheduling controls only when needed. Across bookings, retain
the existing full booking occupancy protection; this feature does not loosen it.

Original driver/vehicle selection checks, disabled/inactive checks, source locks
and sorted resource locks must cover every affected ID. Same-booking overlapping
trips cannot double-assign a driver/vehicle. All current booking/photography/
dispatch paths must detect reservations made by the new trip plan and vice versa.
Time edits and booking restore must validate the complete plan atomically.
No automatic edits to a conflicting booking or new stock reservations.

Before implementation, enumerate callers of every modified shared helper,
including resource window/create/edit/restore guards, photography allocation,
direct teams, dispatch, conflict report and read-only readiness. Preserve errors,
legacy missing optional fields and the current full occupancy semantics. Invalid
stored trip data must be reported, not converted into `[]` or omitted conflicts.

Known original writers to accommodate: Kosha create/PATCH, service transportation
POST/PATCH, operations JSON mutations, service booking edit/creation, operating
window updates and dispatch assignment. Known readers: transport GET, workspace,
Booking Center, fleet financial trip projection, resource guards/report,
profitability and existing booking invoice/thermal adapters. Unrelated invoices
and financial core must not be refactored.

## Server-authorized read model and API behavior

Extend the existing booking transportation API, not a duplicate transport API.
Kosha plan saves enter its original authorized PATCH; service saves enter its
original transportation mutation. A common feature-domain normalizer may be
extracted, but it must not become a new generic financial/booking mutation layer.

Resolve exact `(source,id,tripId)` on the server, enforce current source/branch/
booking access, and join existing staff/vehicle/company records. Return only
permitted fields for the selected receipt variant. Financial values are stripped
server-side when unauthorized, not hidden with CSS. Settings that show an amount
cannot override permissions. Forged trip IDs, unsupported variants, copied IDs
from another booking and malformed plans fail explicitly with AJN errors.

Use current booking view/edit/finance, fleet and settings permissions; verify
their actual server predicates when planning the route changes. No new role or
permission system. If a real separate driver settlement source is discovered,
document it before use and consume approved values only. Otherwise the driver
copy omits money and management sees `مستحق السائق غير مسجل في تسوية مستقلة`.

## Entry points and UX

1. Booking Details print dropdown: add `طباعة وصل نقل 80mm`, retaining every
   existing A4/A5/label/general thermal action unchanged.
2. Booking Center actions dropdown: same action, no extra crowded card buttons.
3. Existing transportation card/history: one print action per saved operation.
4. Fleet trip history: same component with exact source/id/trip identity.

One operation opens its preview immediately. Multiple operations open a compact
Arabic selectable list; empty state: `لا توجد عملية نقل مرتبطة بهذا الحجز.`
Unauthorized users do not get edit shortcuts. Network failures show an error
with retry, never the no-operation state.

Transport editing remains within the booking transportation card. It has pricing
mode, editable overall charge or per-trip charges, existing staff/vehicle pickers,
optional trip fields, history and a clear confirmation. Reuse current UI primitives
and AJN off-white/burgundy/soft-border tokens; mobile touch targets and scrollable
dialogs. Only current transport information appears; no unrelated service data.

Preview title: `معاينة وصل النقل — 80mm`. Recipient: customer, driver or internal;
copies 1–5, default 1. Each copy uses the same source operation and reference,
with a visible copy label. Settings and changes update the preview. Printing is
an explicit action, with popup-blocked/image failures visible and retryable.

## Receipt composition and settings

Dedicated black-and-white RTL template, not a scaled A4 or modified booking
receipt. Paper 80mm; printable content approximately 72mm with safe hardware
padding, border-box sizing, no horizontal overflow. Arabic-friendly existing
font stack, isolated LTR numeric/code/phone runs, wrapping for long names/notes.

Header uses existing company logo/name/contact settings; title `وصل نقل` or
`وصل السائق`, stable transport reference and booking display reference. Body:
customer/contact when permitted, transport date/type, origin/destination, driver/
phone, vehicle/name/plate, departure/estimated arrival, assigned work and dedicated
transport notes. No field is fabricated. Customer amount is highlighted with its
proper per-trip/overall caption. Driver copy NEVER includes customer charge,
even if the operator may view it. Driver money is present only from an authorized
explicit driver settlement source; vehicle costs never appear as driver payment.
Footer includes configured company contact and a short neutral thank-you.

QR is optional and disabled when no authorized target can be safely constructed.
If enabled, it references the existing protected booking transportation tab and
the stable operation selector, requiring authentication/authorization; it embeds
no PII, amount, token, secret or public financial data. Do not create a public
receipt endpoint. Use the installed QR library.

Use `@page { size: 80mm auto; margin: 0; }`. Before printing, wait for fonts/images,
measure actual content and set a finite 80mm-by-measured-height fallback for
browsers that reject auto height. Each bounded copy is its own receipt/page; long
content must paginate without a forced blank page. No navigation/modal/buttons
in the standalone HTML, text is escaped, image URLs follow existing safe rules.
Physical cutter/hardware margins still require printer-driver validation.

Store validated field-visibility preferences in an independent namespaced value
in existing `settingsTable` (not replacing `printerSettings`). Allow logo, company,
customer, booking, transport type, origin/destination, driver/phone, vehicle,
date/time, amount, notes and QR toggles, plus restore defaults. Reuse authorized
settings storage. Preferences do not grant financial access; do not save copies
as transactions. No new DB table required.

## Print audit

After the print document is prepared and popup creation succeeds, record a print
REQUEST with booking identity, stable operation ID/reference, actor, timestamp,
format, recipient and copies through existing audit infrastructure. Never record
`printed successfully` from a browser event. Reprint is another request only.
An audit failure remains visible; never retry by creating another transport or
financial transaction. No print history backfill for old records.

## Verification and acceptance

Implementation must use TDD for domain/permission/fee behavior and UI tests:

- legacy no-plan operation, missing transport, multiple trips, stable IDs and
  cross-booking ID rejection; malformed data/error vs empty-state distinction;
- per-trip 30,000 + 20,000 => aggregate 50,000 once; repeat save no change;
  overall 50,000 stays 50,000 across multiple copies/trips; mode-switch confirmation;
- original paid-booking guards, authoritative paid/remaining, approval-first
  cashbox behavior; no print/settings financial writes;
- customer charge never leaks in driver DTO/HTML/preview/QR, authorized fields
  only, unauthorized edit/settings/amount rejected server-side;
- shared driver/vehicle overlaps, dates/period edits, missing periods, concurrent
  reservations and revision conflicts; original dispatch/photography regressions;
- same-booking sequential reuse accepted only with explicit non-overlapping
  occupancy intervals; missing return/release or overlap blocked, ETA not used
  as an invented return time;
- total-mode multi-vehicle attribution unavailable rather than double counted;
  approved expense deduplication and unsupported driver settlement clearly shown;
- preview/select/cancel, recipient, 1–5 copies, exact trip identity, fleet action,
  reprint, popup/image failure, keyboard focus and mobile layout;
- print media at actual 80mm, long Arabic name/notes, large IQD values, no clipped
  text/admin UI/blank extra page, measured-height fallback; existing A4 unchanged.

Mandatory real project commands after implementation:

`pnpm run typecheck`
`pnpm run build`
`pnpm run verify:critical`
`pnpm run test:payment-state`
`pnpm run test:booking-transport`
`pnpm run test:booking-finance`
`pnpm run test:booking-resource-period`
`pnpm run test:booking-resource-transition`
`pnpm run test:booking-conflicts`

Add a focused transport receipt test script using the existing runner. Run a lint
script only if package.json actually defines it (none identified so far).
`test:save-smoke` is SKIPPED unless a separately verified isolated TEST database
is configured. Never create one, use Production, or claim skipped checks passed.
Use `verify:strict` only for authorized isolated full integration coverage.

No implementation tests have been run for this design-only change. No migration,
commit, push, deployment or Production write is authorized by document approval.

## Builder-owned decisions / delivery limits

The builder may choose file names, reusable pure helper boundaries, accessible
component layout and existing test fixtures. Before editing shared code, list its
callers and confirm no new baseline changes conflict with the design. Preserve
unrelated dirty work in the primary checkout.

Do not invent driver settlement support: optional integration remains unavailable
if the existing system has no explicit payable/settlement source. Browser/device
simulation is not a physical thermal printer test. Missing isolated DB tests and
unverified hardware behavior must be reported honestly in the final delivery.

## Proposed implementation sequence (not an approved execution plan yet)

1. Recheck baseline/callers; build legacy/plan normalization and pricing tests.
2. Extend original save/read paths transactionally and include trip resources in
   existing conflict readers/writers; prove backward compatibility.
3. Implement redacted receipt read model, pure thermal renderer and audit/settings.
4. Wire preview/actions into workspace, Booking Center and fleet trip history.
5. Verify money/permissions, desktop/mobile/print behavior, required regressions;
   deliver uncommitted work and explicit limitations. No release actions.

## Design builder check

An independent read-only builder check identified one important ambiguity:
sequential reuse of a vehicle/driver within one booking. The conservative interval
rule above resolves it as a proposed builder decision for owner approval. No other
planning questions were reported. Review is of the design, not implementation,
tests, Production behavior or physical printer certification.
