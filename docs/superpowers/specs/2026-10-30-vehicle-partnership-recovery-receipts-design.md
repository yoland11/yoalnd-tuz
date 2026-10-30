# Vehicle partnership recovery and current advance receipts

Continues the owner's approved single-vehicle partnership, historical settlement and early/ended-ownership advance workflows. The owner asked to complete the most important remaining work. Two reachable omissions were established by tracing existing callers; no new financial policy is introduced.

## Existing failures and chosen approach

1. Current source-only advance requests use proposal v2, but the existing 80mm receipt proof admits only v1. Admit the exact existing v2 advance contract, retaining executed/nonreversed FIN, money, cash difference, original journal, immutable audit digest and original right/payee proof. Keep v1 behavior; do not admit future/unknown versions or v2 driver/profit requests. Preview and print reuse the same existing prover and template.
2. The original monthly UI exposes approval but no cancel/reopen actions for zero-journal periods. Expose existing `cancel_zero` and admin-only `reopen_zero` commands from persisted workspace closing headers. Use original version/digest, never a recalculated preview or assumed zero result. Require explicit reason and confirmation. Freeze the original body/nonce on first attempt and keep exact retry after a lost response or changed selected month. Preserve all server-side journal/approval/unused-period/canonical guards.

Alternative: alter payment/closing storage or financial posting to accommodate the UI. Rejected because original server workflows already support both operations and no new financial state is needed. Alternative: accept any proposal version for printing. Rejected because only the specific current source-only advance format is proven.

## Boundaries

No financial producer, journal, Cash Box, canonical paid/remaining, agreement percentage, historical amount, database schema or protected invoice appearance changes. No Production business writes during diagnosis/QA. Existing component/printing/error/approval architecture is reused.

Audit also identified a separate existing monetary-closing reopening boundary: MASTER does not pass the required expected version/digest. That shared financial HTTP/UI integration is recorded for a separate caller-reviewed change; zero recovery must never bypass it or impersonate a monetary reversal.

## Verification

Witness RED then GREEN with actual receipt proof and actual recovery component/command behavior. Cover v1 compatibility, current v2 advance, invalid variants, tampered evidence, reversed/pending payouts, pending/approved/no-FIN eligibility, financial-FIN denial, permission, persisted header identity, stale preview independence, exact retry and visible structured errors. Run original partnership suite and required typecheck/payment-state/build/critical checks. Isolated DB write/concurrency/save-smoke is SKIPPED without separately verified TEST configuration; never use Production as a fallback. Release only complete reviewed verified code under the owner's auto-release policy.
