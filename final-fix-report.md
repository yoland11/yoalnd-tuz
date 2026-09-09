# Final Kosha Instruction Security Fix Report

Date: 2026-09-09

## Scope completed

- Staff booking-detail serializers now filter `instruction_*` timeline entries both at the top level and inside `booking.bookingDetails.koshaPortalTimeline` unless the viewer is assigned to the booking or is a manager/admin.
- Native and routed Kosha detail responses use the same authorization-aware serializer for GET, stage, media, and delivery paths. Routed formatter metadata is retained while applying the filter.
- Service-order writers that can carry routed Kosha data now use the atomic JSONB preservation expression for instruction timelines and staff media: sound synchronization/direct updates, collections, photography event updates, and photography central/stage synchronization.
- Added focused persistence and staff-detail regression commands and made them part of the critical verification gate.

## Verification evidence

- `pnpm run test:kosha-instruction-store` — passed.
- `pnpm run test:kosha-staff-detail` — passed 24 native/routed detail cases across unassigned, assigned, manager, and admin viewers; stage success, idempotency, and concurrent-retry responses were exercised. The script statically binds GET, stage, media, and delivery response branches to the assignment-aware loaders.
- `pnpm run test:kosha-manager` — passed.
- `pnpm run typecheck` — passed.
- `pnpm run build` — passed with the local `ESBUILD_BINARY_PATH` workaround.
- `pnpm run test:payment-state` — passed.
- `pnpm run verify:critical` — passed with the same esbuild workaround.
- Isolated database save smoke coverage — **SKIPPED**: no valid `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and separate `TEST_DATABASE_URL` configuration was present. No production data was touched.
