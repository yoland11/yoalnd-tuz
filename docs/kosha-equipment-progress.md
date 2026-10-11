# Koshah equipment execution ledger

Plan: docs/superpowers/plans/2026-10-11-kosha-equipment.md (primary checkout).

User approved implementation and subsequently authorized commit, push and deploy after verification.

Ruling: Preserve unrelated primary-checkout graduation edits by using the native isolated worktree based on origin/main.

Task 1 in progress: architecture inspection. Existing kosha_asset_assignments already supports shared product references and decimal quantities; extend/reuse this relation rather than creating duplicate equipment templates. Variant, return policy, unit and required flag are currently absent.

No product, inventory, booking or Production data has been modified.

Task 1/2: implemented template normalization, existing-assignment persistence, additive equipment_config migration and Arabic equipment editor. Legacy associations remain readable without applying the migration; writes report migration-required explicitly. No runtime DDL.

Task 3: implemented explicit booking preview/append on the existing booking operations and stock_reservations tables, preserving money/other JSON fields and using transactional booking/product locks. Duplicate retry and audit rollback tested with the real service and Drizzle query generation; this is not a PostgreSQL integration pass.

Ruling: Existing custody quantities and asset action schema require whole units. Returnable equipment therefore uses whole quantities; consumable materials retain decimals. Do not widen the shared custody schema as an incidental change.

Ruling: Reuse the existing physical-asset conflict guard: the same product identity cannot be reserved for two overlapping event days. The template can be shared by multiple Koshat; legacy dedicated assignments are not silently reassigned.

Proven inventory defect: adjustVariantStock floors delta. Reproduction: stock 2, checkout -0.5 => stock 1, ledger -0.5. Callers inspected: applyOrderItemsStock (store order execution/reversal), consumeReservations and releaseReservations (Koshah/service reservations). Minimal fix passes the exact delta to the existing UPDATE; no historical quantities, formulas, or transactions rewritten. Regression covers checkout and reversal against the actual extracted helper.

Verification so far: first typecheck and critical gate passed; isolated database integration SKIPPED by that gate. Subsequent changes require rerunning gates before release. New pure/service tests pass; decimal stock test observed RED before applying the one-line fix.

Final review findings addressed: import and existing asset actions now share booking-then-product row lock order and fresh booking state; custody, passport, booking and timeline writes use one transaction. Import checks legacy linkedAssets and physical holds even for consumables. Policy changes between returnable/consumable cannot create a second representation on an existing booking. Regression covers both directions and routed service staff media/timeline preservation.

Shared helper blast radius inspected: executeBookingAssetAction has two callers (admin booking operations and authorized staff Kosha assets); assetConflictForBooking is only called by this action. saveBookingOperations callers include warehouse/products, manual preparation, transportation, attendees, booking stages and staff product metadata. stampBookingSoundDepartment also has a booking-products caller. Their new optional connection defaults preserve all other callers; only the asset action supplies its transaction. No authentication, permission definitions, payment formulas or accounting entries changed.

UI verification: real components rendered with fixture query data at 1280px and 390px using existing production CSS; screenshots inspected, no horizontal overflow. Covered long Arabic names, optional/consumable quantities, shortages and existing imports. This is a component visual check, not a live authenticated production write test.

Isolated database connection was separately guarded but unavailable (tenant/user not found). Write integration/save-smoke is SKIPPED, never PASS; no Production smoke writes performed.

Migration 0122 applied alone through the existing reviewed additive runner on the owner connection; verified equipment_config exists as nullable JSONB. No historical booking, stock, payment or accounting rows changed by migration.

Final verification: pnpm run verify:critical PASSED on the final code (includes pnpm typecheck, production build, payment-state and equipment regression tests); pnpm run test:kosha-operations PASSED; git diff --check PASSED. Read-only final code reviewer reports all findings addressed and no remaining release blocker. Full PostgreSQL write integration remains SKIPPED as documented above.
