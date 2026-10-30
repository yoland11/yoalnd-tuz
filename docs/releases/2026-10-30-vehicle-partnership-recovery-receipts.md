# Vehicle partnership: current advance receipts and zero-journal recovery

Two verified omissions in existing vehicle partnership consumers are repaired. No financial producer, approved amount, payment, accounting journal, database schema or historical record is rewritten.

## Behavior

The original receipt prover accepts the current v2 source-only advance repayment format only for the original advance event/type. It retains actual execution/nonreversal, exact cash difference, original VP-ADVANCE/1000 journal, immutable request digest and right/payee checks. The original advance amount/date/source identity and empty request coverage/snapshot remain required. Legacy v1 profit/driver/advance receipts are preserved. The existing 80mm template and both original preview/print callers are reused without visual changes.

The original partnership page exposes existing `cancel_zero` and admin-only `reopen_zero` server commands from persisted closing headers. Recovery requires reason and explicit confirmation; original server permissions, frozen source/journal, approval audit, unused-period guards, canonical reconciliation, revision history and durable replay are unchanged. The recovery controller remains mounted outside mutable preview/query content, freezes the exact original command and retains a lost-response retry. A monetary FIN never enters this path.

## Scope and callers

Receipt proof has one production consumer: `VehiclePartnershipReports.currentPayoutHtml`, shared by preview and print. Recovery adds a consumer of the existing source-owned `/closings/transition` route; that server handler and financial code are unchanged. No new ERP, payment, expense, printing or database system is introduced.

## Validation and limits

Actual receipt RED reproduced rejection of a valid v2 source; GREEN covers v1 compatibility, early advances, unchanged original proof after later mapping, unknown versions, wrong source/mode/coverage, tampered original amount/date/member/hash, pending/reversed payouts and journal mismatches. Original partnership focused tests pass. New zero recovery tests exercise actual component output and the original HTTP client, eligibility/permission, persisted header identity, immutable retry, explicit source errors and saved-before-refresh failure. Original server lifecycle/unused/opening-loss reopening tests remain authoritative for financial guards.

The fresh whole-change review found one P2 parent setup-refresh error that could unmount the retained recovery. An actual mounted page reproduced the lost retry, and a cached-query/error regression failed before the fix. The same scoped controller now survives background setup errors while the source failure remains visible and new data-dependent actions are hidden. No financial guard is relaxed.

Mounted original-page GREEN verification covered lost response, failing setup refresh, restoration with the old source now draft, changing the selected month to November, and retrying the original August header. Both local POSTs had byte-identical route/body/nonce. Saved acknowledgement also remained visible through a later setup error. The approved zero-month reopen form was exercised at375px; document client/scroll widths both360px (scrollbar excluded), dialog within viewport, and viewport restored. Local fixture data/API responses were fabricated and used no database. These browser checks do not certify PostgreSQL transactions.

Required full verification is recorded in the task's final evidence. Isolated PostgreSQL write/concurrency/save-smoke is **SKIPPED**, not passed, without separately verified TEST configuration. No Production business writes are used for diagnosis or QA. Physical thermal printer operation is not certified by HTML/layout checks.

Final integrated `pnpm run verify:critical` exited0 on2026-10-30 after preserving upstream `dd7dee772` (the independent sales-return fix). TypeScript, payment-state, original full partnership/legacy suites, new receipt/recovery regressions, production build and whitespace integrity passed. No lint script is configured. Database integration/save-smoke remained explicitly SKIPPED under normal policy.

Separate outstanding work: monetary monthly reopening through MASTER needs caller-reviewed forwarding of the required version/digest. Zero-period recovery deliberately cannot bypass that existing financial barrier. Partial cash returns and immutable mapping top-ups remain outside the approved existing workflows.
