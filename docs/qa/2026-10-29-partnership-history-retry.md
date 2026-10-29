# Vehicle partnership history — mounted retry regression

Scope: the actual `VehiclePartnershipHistory` React component, mounted in a local browser fixture with fabricated API records. No Production requests, financial approvals, payments, reversals or database writes were performed.

## Review finding and disposition

The fresh whole-change review reported one P2 issue: a query-dependent branch unmounted `HistoryAction` when changing month or showing a query error. An ambiguous saved request then lost its frozen command and idempotency key. The original server guards still prevented duplicate classification, but the exact-retry UI promise was broken.

Fixed in one review pass: all three history action components remain mounted independently of the query result. A hidden idle action returns no UI, while an unresolved or saved action retains its original command, route, summary and key. New attempts require a current successful source review. Only the explicit new-attempt/new-review action clears retained state. Financial source/proof/approval behavior is unchanged.

## RED — observed before the fix

1. Mount the real history component with fake original financial source 71, amount 10,000.00 IQD, version 3, target month 2026-10.
2. Select source 71, enter evidence reference and reason, and submit classification.
3. The local API records the classification, then throws a simulated lost-response error.
4. Change the month with the actual month input keyboard control to an uncached month, forcing query loading and a new source review.
5. Observe that the source is now classified and no longer eligible, but the retry form has disappeared.

Observed: one POST recorded, selected month changed to 2026-12, **zero** exact-retry buttons. The frozen attempt was lost. This was a mounted interaction failure, not inferred from a pure helper test.

## GREEN — classification after the fix

Repeat steps 1–4, changing to 2026-11. The original summary still identifies October and source 71. The retry form remains visible with its original disabled evidence inputs. Click **إعادة المحاولة بالمرجع نفسه**.

Observed: two POSTs to the identical classification route with byte-equivalent serialized bodies, the same generated `idempotencyKey`, source 71, original version/digest and **targetMonth 2026-10**, despite the selected review month being 2026-11. The UI reports **حُفظت العملية**.

## GREEN — revocation after the fix

1. Save a fabricated unused classification normally.
2. Open its revocation review, enter a reason and submit.
3. The local API removes the classification, then throws a simulated lost response.
4. Change to an uncached month. Its new query returns no classification, so the original source is absent from the view.
5. The original revocation attempt remains visible. Retry it.

Observed: the two revocation POSTs have the identical route, original classification ID 95, reason and `idempotencyKey`. Both saved-operation summaries remain visible. No second financial event is created by the local fixture.

## Other evidence and limits

The full focused history UI/helper suite passes, including frozen commands, source identity, status/approval links, structured errors and saved-before-refresh-failure behavior. The complete `verify:critical` gate must also pass before release.

Desktop and 375px mobile inspections used the actual history/balances/coverage components. Page width matched scroll width; wide results stayed inside their own horizontal scroller. No console errors were observed. This mock UI evidence does **not** certify PostgreSQL concurrency or physical financial execution. Isolated DB write/save-smoke/concurrency coverage is **SKIPPED** without separately verified TEST configuration.
