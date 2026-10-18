# SDD ledger — plan: C:/project/yoalnd-tuz-main/docs/superpowers/plans/2026-10-11-smart-booking-operations.md

## Booking resource status safety — continuation of the approved five-phase plan

Baseline: published `e795208f4a07b6a867213c488e29c4ffa7239261`.
Plan: `C:/project/yoalnd-tuz-main/docs/superpowers/plans/2026-10-11-smart-booking-operations.md`.
This is a bounded remaining competing-writer audit, not all-phase acceptance.

## Current release and worktree

The baseline was verified again on remote main and Vercel SUCCESS. Reuse its
clean managed linked worktree and named `codex/` branch. The primary graduation
checkout and old mixed operations branch remain untouched. No TEST database,
Production data diagnosis, migration, or historical backfill is authorized.

Ruling: later user release-first instructions and current AGENTS normal-release
policy supersede the plan's earlier no-release/mandatory-TEST coding hold. Only
completed verified slices may release; missing real PostgreSQL coverage stays
SKIPPED, not passed. Cost if wrong: no final concurrency certification is claimed.

Ruling: keep this durable ledger rather than a Bash-only scratch helper. It
records the same plan identity and preserves the old progress ledger. Cost:
one documentation file, no runtime behavior.

## Before-change caller and blast-radius audit

`/admin/assets/action` is an existing `products`-authorized handler. Callers are
three action paths in `src/views/admin/asset-gate.tsx` (maintenance/loss), and the
movement action in `src/views/admin/operations.tsx` (including repair). Existing
enterprise, linked admin, photographer, fixed custody and booking writers lock
the original product; the status handler does not. It can overwrite a fresh
terminal state and records profile/repair cost/timeline as separate writes.

The repair action adds to existing passport `maintenanceCost`; it does not post
an approved expense, Cash Box or accounting entry. Preserve that formula and
metadata distinction; require durable request identity for nonzero repairs.
Non-cost legacy requests remain compatible. New IDs and explicit repair intent
are carried by the existing movement form, without changing its visual layout.

Other depreciation/profile edit/sale writers are not certified by this slice.
No claim of universal asset locking or final Phase 1/2 acceptance is made.

## Verification ledger

- Added a real-handler regression with controlled external IO, not a source-text
  assertion. Expected RED: `available` accepts a product with an issued custody.
- Additional cases cover lock freshness, repair retry cost once, changed-payload
  conflict, timeline failure rollback, revoked permissions, legacy holders,
  quantity separation, explicit repair holds and terminal state protection.
- Required final gate: typecheck, production build, payment-state and critical.
- TEST save-smoke / actual PostgreSQL concurrency: SKIPPED unless a separately
  verified configuration exists; never create one or fall back to Production.

## Completed implementation and review fix pass

- The status action now uses its original product lock and fresh transaction
  reads for quantity mode, profile, passport and issued custody. It does not
  close any custody or create a second stock movement. Existing field damage
  reporting remains possible without silently clearing its current holder.
- Profile, existing maintenance-cost addition and original timeline receipt
  commit together. The receipt binds product, actor and normalized payload.
  Replayed repair costs and post-commit side effects do not run twice; changed
  payload or actor is refused. No payment/Cash Box/accounting posting is added.
- Ruling: nonzero legacy repairs without requestId are refused with a reload
  instruction; cost-free legacy requests still work. The existing movement form
  supplies stable IDs across failed retries. Cost if wrong: an outdated caller
  must reload instead of risking a repeated maintenance-cost addition.
- Explicit permitted repair requires a reason and no current holder. It clears
  only damage/inspection hold flags and preserves all other passport metadata.
  Terminal/lost states need their own recovery/disposal workflow, not `available`.
- Actual handler/client regression RED→GREEN: issued asset incorrectly became
  available; form previously omitted requestId; failed repair replay is stable.
  A read-only mutation disabling the receipt check proved cost regression RED
  (45 rather than 25); unmodified implementation is GREEN.
- Fresh critical gate first failed TypeScript on nullable actor name. It now
  uses the original timeline helper's null/default contract. The next gate
  caught an old wiring assertion requiring `quantityProfilesFor(db, ...)`;
  changed to require the now-locked `tx` executor, with actual quantity refusal
  and rollback also covered by the new real-handler suite. Quantity suite PASS.
- Independent `asset_status_safety_review` found one Important legacy bypass:
  maintenance → reserved/transferred → available erased the only maintenance
  marker. Actual handler regression RED→GREEN; both intermediate shortcuts now
  refuse maintenance/held equipment. No other introduced finding was reported.
- Final: Ruling: the review set aside pre-existing late-success form clearing.
  Promote it to an in-scope Important issue because this form carries repair
  cost and a newer operator draft must survive. Actual callback regression was
  RED then GREEN; reset only the successful unchanged draft. Cost if wrong:
  no reset may leave an old draft visible, rather than lose a new one.

## Review rulings and certification limits

- Ruling: controlled IO verifies actual handler/callback decisions and rollback
  composition, not live PostgreSQL SQL/locking/concurrency. Leave DB integration
  SKIPPED under normal policy. Cost if wrong: no production race certification.
- Ruling: root must run a fresh typecheck/build/critical/payment-state gate after
  fixes; reviewer did not certify it. Failure blocks release. No migration or
  Production write test is required or permitted for this code-only slice.
- Ruling: other profile/depreciation/sale writers and all-five-phase acceptance
  remain outside this bounded correction. They still require integration and
  testing before universal resource-safety claims. Cost if wrong: remaining
  pre-existing races and incomplete operational screens are not concealed as done.
- Ruling: server receipt durability is proven by original product-scoped locks
  in source and controlled tests; the mounted form retains one active retry
  identity, not a persistent offline draft across refresh/unmount. Global admin
  activity/notification delivery is post-commit, not an outbox guarantee. The
  original transactional timeline remains the durable audit. Cost if wrong:
  a page reload needs operator review, or a delivery failure needs follow-up;
  neither is represented as guaranteed end-to-end delivery.
- Deferred minors: none reported.

## Final normal release gate

- Final post-fix `pnpm run verify:critical`: PASS exit 0, including fresh
  TypeScript, financial approval/payment-state/installment contracts, existing
  equipment/quantity/custody tests, both new status/client suites, production
  build and whitespace. Focused status and quantity suites also PASS separately.
- No configured lint script; no dependency/schema change. TEST/save-smoke and
  actual PostgreSQL integration/concurrency remain SKIPPED, not passed.
- Code review's single Important finding and the root-promoted client finding
  were both fixed through RED→GREEN in one fix pass. No remaining confirmed
  in-scope finding blocks this bounded correction.
- Normal safe auto-release is GO for this slice only. Keep the dirty primary
  checkout and old mixed development worktree intact. Use the original pre-push
  gate and connected Git→Vercel workflow, never force push or bypass verification.
- Rollback criterion: a failed deployment/health check or confirmed introduced
  status/repair regression. Restore prior Vercel deployment `4AkU7tiXA51UDhxfzoDW8XBS7Tqe`
  for `e795208f4`, then investigate. No schema rollback or historical rewrite is
  required. This rollback was not rehearsed or executed against Production.
- No staging/canary, authenticated live write smoke, browser/device UI, error
  telemetry baseline or universal stock-concurrency certification is claimed.
  After publication, verify the exact SHA's Vercel status and read-only public
  routes; a public HTML 200 does not establish authenticated operational E2E.
- The five-phase feature integration, daily/bulk workspace, profitability and
  final acceptance are still pending; this safety correction is not all-phase
  completion. Preserve existing newer quantity-asset main when integrating them.
