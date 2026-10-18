# Equipment custody safety — 2026-10-18

## Scope and baseline

Continuation of the approved Smart Booking operations plan, Phase 2 custody
safety, on `944f42d95` (the published installment-only fix). The old mixed
operations worktree and primary checkout's unrelated graduation changes are not
copied over current main. This is not delivery of all five phases.

No migration, database connection, Production data repair, historical backfill,
new stock movement system, accounting posting or invoice/print change is needed.
Original `equipment_custody`, `asset_passports`, `asset_profiles`, `asset_links`
and `employee_custody_audit` remain authoritative. Quantity assets retain their
existing reservation/checkout/return engine and are refused by individual routes.

## Caller and lock audit (before changes)

- Enterprise custody POST/PATCH: separate unprotected global writes; returned-ID
  retry could bypass source proof.
- Admin asset-links checkout/return: global writes and no exact source ownership
  proof before return; client checkbox alone could claim lost-item approval.
- Field-shoot assets helper and its sole staff-portal caller: same race; reducing
  session to actor id/name discarded damage/loss permissions.
- Photography order assets: same source/transaction/approval defects.
- Normal booking assets (`executeBookingAssetAction`): already owns booking then
  original product locks and passes its transaction to the action. Keep it.
- Fixed employee-custody booking reserve/checkout/return: remaining competing
  writer requiring the same lock protocol and fresh source validation.
- Mobile Kosha assets already call the normal booking action; no parallel mobile
  movement system is introduced.

`logCustodyAudit` has nine original callers: group create/update, membership
add/remove, booking employee selection, reserve, release, checkout and return.
Its optional executor defaults to the original global connection for unchanged
callers; transactional callers explicitly pass their open transaction. The
availability and preview readers likewise accept an optional executor, preserving
existing read callers while enabling fresh in-transaction validation.

## Individual custody safeguards

- One transaction-only executor locks original `products.id`, then re-reads
  quantity tracking, exact source link, original custody, passport and profile.
- A return closes only its own original issued row. Multiple active rows and
  conflicting passport holder require review rather than a guessed repair.
- A returned custody-ID retry cannot clear a subsequent holder or change costs.
- New standalone notes cannot impersonate protected booking/order source notes.
- Server session supplies actor and damage/loss capability, never client flags.
- Lost-item approval still requires explicit confirmation as well as permission.
- Deleted/terminal/inspection/damage holds and other passport metadata survive.
- Damage cost is applied once with the original return. Existing lost-custody
  liability behavior is preserved; a lost asset is not labeled inside warehouse.
- Media and schema preflights run before the transaction. Notifications and
  global timeline/activity helpers run after commit, not on a pooled connection
  held by the transaction. Replay does not duplicate those side effects.
- Known rule failures use AJN's structured error contract and request-id logging.
  Database errors propagate to the existing safe error boundary.

## Verification history (initial failures superseded below)

- Admin route regression initially RED: conflicting checkout still succeeded
  through global writes. GREEN after the transaction adapter was connected.
- Linked route regression initially RED: checkout made two global writes.
  GREEN after all three routes and actual shoot caller delegated to the executor.
- Actual executor tests: original SQL lock order, source identity, closed-ID
  replay/later holder, rollback, legacy null holder, quantity separation, holds,
  trusted loss approval, terminal/deleted profiles, once-only damage/loss effects.
- `pnpm run typecheck`: PASS after initial adapter type errors were corrected.
- Focused individual service, admin route and linked route suites: PASS.
- `pnpm run build`: PASS (production compile, TypeScript and page generation).
- `pnpm run test:quantity-assets`: PASS. Replaced the stale exact-message
  assertion after extraction with actual individual-executor quantity rejection,
  proving the product lock precedes the refusal and no custody write occurs.
- Initial `pnpm run verify:critical`: **FAIL**, exit 1 at Equipment custody transactions
  and ownership. The fixed-custody regression reports `global database IO is
  forbidden in a custody transaction`; the unmodified path is not serialized.
  Typecheck, financial approval/payment-state/installment, booking preparation,
  equipment/decimal inventory and quantity-asset checks before that point PASS.
  Later critical steps did not run; the independent build above did PASS.
- `git diff --check`: PASS. No commit, push or deployment in this continuation.
- No configured lint script. No lint command invented.
- Save-smoke / real PostgreSQL concurrent writers: **SKIPPED**, not passed; no
  separate verified TEST database is configured or created. Controlled executors
  do not certify real database concurrency.

## Remaining project work (not published by this slice)

Integrate the old development operations work onto newer quantity-asset main without overwriting upstream
changes, then finish daily operations/bulk, canonical profitability and final
desktop/mobile/authenticated regression gates. A separate pre-existing global
asset-status writer also needs coordinated locking before claiming universal
asset-status concurrency safety. Do not claim all phases complete from this
bounded correction or publish the mixed unfinished branch.

## Earlier safety-review hold — resolved by direct user approval

The fixed-custody transaction patch was rejected twice by automatic approval
review, including after the original user scope and approved plan were supplied.
The root stopped without applying that patch and asked for direct user guidance.
The user's subsequent **"موافق كمل"** expressly approved the single-transaction
fixed-custody change, permission checks and original-custody return binding. It
was then applied normally, not through an alternative approval-bypass mechanism.

Independent review also identified a separate remaining linked-route lifecycle
issue: those callers did not send the original custody ID. A delayed return
for a source that has subsequently checked out the same asset again can refer
to the newer issue. Exact cross-source checks and the explicit returned-ID path
are protected, but this legacy same-source retry must not be advertised as
solved at that point. The final read DTOs, route adapters and clients now carry
the original custody ID; ambiguous legacy requests fail safely.

## Completed bounded correction

- Fixed custody now locks the fresh booking followed by sorted original product
  IDs. Reservations, checkout/return, existing per-use depreciation markers,
  booking state and audit use one transaction; failures roll back together.
- Shared booking workspace checkout/return uses the same fixed reservation and
  original custody ID, not a second movement. Closed reservation history cannot
  be silently reopened. Unrelated booking fields survive.
- A real-engine inspection regression was RED: a sold asset became active.
  Inspection now refuses any issued custody or passport holder, preserves
  deleted/terminal/maintenance/damage holds and lost location, and does not count
  group-return usage twice. Existing depreciation formulas are unchanged.
- All six actual-executor/route/read-DTO/client custody suites: PASS.
- Independent `custody_safety_review`: approved after rerunning all six suites;
  no remaining confirmed Critical, Important or Minor findings in this slice.

## Release checklist — 2026-10-18

Owner authorized publishing the completed custody correction separately, then
continuing remaining operations work. This is the normal safe release policy,
not certification of all five phases or full PostgreSQL write integration.

- Final `pnpm run verify:critical`: **PASS**, exit 0. Includes `typecheck`,
  `test:payment-state`, all six custody suites, equipment/quantity regressions,
  production `build` and `git diff --check`.
- Save-smoke / real PostgreSQL concurrent writers: **SKIPPED**, not passed.
  No separate verified TEST database is configured or created.
- Lint is not configured. No schema, dependency, financial formula, accounting,
  invoice layout or Production diagnostic data changes are included.
- Risk: shared custody writer correction across the audited callers above;
  no generic universal asset-status concurrency guarantee is made.
- Release target is remote main, verified at `944f42d958e` before publication.
  Use the original pre-push gate and connected Vercel Git deployment, without
  force push or touching the dirty primary checkout.
- Staging/canary infrastructure, authenticated browser write smoke, error-rate
  baseline and rollback drill were not verified. Hidden custody-ID payloads are
  covered by tests; no visual redesign is included.
- After push, verify the exact SHA's Vercel status and public HTML routes.
  Public HTTP 200 is not authenticated end-to-end custody verification.
- Rollback criterion: failed deployment/health check or confirmed new custody
  regression. Restore the previous Vercel deployment for `944f42d958e`
  (`HwVAouRe36RZMaC3bhApo9QuRgaq`), then investigate. No schema rollback or
  historical-data rewrite is required or authorized. This rollback has not been
  executed or rehearsed against Production.
