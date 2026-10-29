# Full recorded transport fees in vehicle income

Owner rule: a saved 15,000 IQD transport fee must appear as 15,000 vehicle income, without reduction by the amount collected against the whole booking. Previously a booking paid 150,000 of 195,000 displayed approximately 11,538.46 of its 15,000 fee as vehicle income.

## Behavior

- Original vehicle financial GET and fleet-list SQL now use the full existing AJN transport fee once per eligible original trip, independently of booking paid/total. Both Kosha and service-order sources retain their vehicle, mode, archive/cancellation and date scopes.
- Trip and vehicle analytical profit use the full fee less the same original approved-effective expenses. Expenses do not reduce the displayed gross transport income; signed losses remain visible. Detail trip count reflects the recorded eligible trips, consistent with the fleet list.
- Existing `executedTransportationRevenue`, `executionStatus` and `executedTransportRevenue()` remain legacy collection-attribution fields/helper with their original calculation. Their misleading visible column was removed from the two original vehicle views. Command-center totals/count labels now say recorded rather than executed cash.
- Booking total, customer paid/remaining, saved fees, financial approvals, Cash Box, journals and historical records are untouched. No financial entry or second customer charge is created. Partnership monthly recognition, source snapshots, rights, distributions and separate cash-attribution indicator are unchanged.

## Reused boundaries and files

The existing API, vehicle views, full-fee source columns/bookingOperations, Drizzle query, shared formatter and original transport test command are reused. No migration or dependency is required. Source changes are limited to `src/server/api.ts`, `src/views/admin/vehicles.tsx`, `src/views/admin/enterprise.tsx` and a clarifying helper comment in `src/lib/booking-transport.ts`. Regression changes cover the original booking/vehicle transport scripts and new `scripts/test-vehicle-full-transport-fee.mjs`; the existing critical gate already runs this package command.

## Evidence and limits

Actual mapper/loop/summary RED: 11,538.461538… instead of 15,000. Actual JSX RED: the previous collection-share column remained visible. GREEN covers both original sources with unpaid/partial/fully paid bookings, changed booking totals, the same original source/collection values, mixed distinct trips counted once, decimal/zero/negative fee input handling, expenses affecting only profit, signed loss, actual Drizzle SQL construction/scope, original JSX/metric/formatter and corrected column spans.

Both actual `pnpm run test:vehicle-transportation` and `pnpm run test:booking-transport` pass. One fresh independent whole-change review found no actionable findings and independently passed equivalent Node entrypoints. Required TypeScript, payment-state, full critical and Production build gates must pass before release. No lint package script is configured. Isolated database write/concurrency/save-smoke coverage is **SKIPPED** without separately verified TEST configuration; SQL construction tests are not reported as real PostgreSQL execution. Deployed verification uses normal read-only API/UI navigation only.

Reviewed-source full pnpm run verify:critical exited 0 on 2026-10-30, including TypeScript, payment-state, original booking transport, full-fee/signed-loss vehicle regressions, the complete partnership/legacy suites, Production build and whitespace integrity. Isolated database integration remains explicitly SKIPPED.
