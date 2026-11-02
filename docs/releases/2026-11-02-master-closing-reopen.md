# Reopen a monetary vehicle-partnership closing from MASTER

The existing MASTER reverse action previously sent only a reason, so the original monthly reversal rejected it for missing displayed version/digest. The financial detail now reads bounded original closing context; the client freezes that exact context, reason and nonce. The original HTTP route passes only validated version/digest/nonce to the original transactional reversal. New client amount/source overrides are not accepted. Ordinary reason-only reversals retain their contract.

The original FIN is checked as a monthly-closing source/event before any other adapter or generic idempotency lookup can receive closing options. Existing original journal/approval proof, locked version/digest, unused-rights and later-period guards, canonical reconciliation, audit and full opposite NONCASH journal remain unchanged. No schema, financial formulas, original amounts or Production business records were modified.

## Use

Open the original monthly FIN under **الصندوق الرئيسي → تفاصيل السند**. Its month/version appears with **إعادة فتح الإغلاق المالي** for eligible current approved headers. Enter a reason and confirm. The server still rejects used rights or a changed version; correct these through their authorized original workflow. A lost response offers **إعادة المحاولة بنفس المرجع**, preserving the original command even after changing the selected detail. Explicitly leaving the attempt is required before initiating another reversal from the detail controls.

Read failures show an error/reload control. Known context failures retain their HTTP status/code/request ID; unexpected database details are hidden. A genuine missing transaction retains the original404 behavior.

## Verification and limits

Focused tests execute the actual HTTP branch and mutation, real detail rendering, original read helper and original MASTER reversal function under controlled adapters. They cover original source/FIN identity, exact frozen request, permission/blocked states, source errors, forbidden financial overrides and unchanged legacy reversals. Existing monthly reversal, unused-period, financial approval, canonical and cash suites are required by the complete critical gate.

Independent review found two boundary issues (cross-source options and GET failure handling); both were corrected and independently rechecked. No remaining actionable review findings. Latest upstream booking links, RTL/date controls and other published features were preserved during integration.

No Production financial operation is executed for QA. Isolated PostgreSQL write/concurrency/save-smoke tests are SKIPPED when no separately verified TEST configuration exists; controlled tests do not prove database concurrency. No database migration is required.

Final integrated `pnpm run verify:critical` passed on2026-11-02 against upstream bcd5d969c, including TypeScript, payment-state, full partnership and legacy regressions, new actual MASTER source/route/detail tests, production build and whitespace integrity. No lint script is configured. An earlier typecheck failure in error-code typing was corrected before this passing gate; it was not released.
