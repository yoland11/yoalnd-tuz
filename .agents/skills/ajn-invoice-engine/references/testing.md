# Verification matrix shared by every invoice skill

For each affected flow record PASS, FAIL, SKIPPED (with reason), or NOT APPLICABLE (with reason). Do not claim physical printer or browser success from compilation alone.

## Fixture and presentation cases

Verify Arabic RTL; English/LTR when supported; Kurdish RTL when relevant, including mixed digits, phone, SKU and currency.
Exercise long customer/item names, one item and many items, huge IQD values, zero and nonzero discount, paid/unpaid/partial, previous approved payment versus a new pending payment, remaining balance, absent optional fields, and exclusion of internal IDs/private data.
For applicable outputs verify multi-page A4, independent A5, separate 80mm and 58mm layouts, browser print and Print Agent payload compatibility. Test missing/slow images and fonts, print cancellation, failed PDF export and reprint retry. No new invoice or inventory movement should occur when rendering.

## Actual project commands

Inspect `package.json` again before running. At inspection there is NO lint script; report lint unavailable rather than inventing a command.

Production form/API/invoice/print changes require:
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm run verify:critical`

Payment/approval/ledger/cancellation changes additionally require `pnpm run test:payment-state`.
Select existing focused tests: `pnpm run test:sales-invoice-print-template`, `pnpm run test:wedding-invoice-layout`, `pnpm run test:remote-printing`, `pnpm run test:public-invoice-qr`, `pnpm run test:scanner-formats`, `pnpm run test:export-pdf`, `pnpm run test:sales-invoice-cancellation`, and relevant module contracts.

Database write smoke testing requires AJN_ENV=test, ALLOW_TEST_WRITES=true and a separately verified TEST_DATABASE_URL; otherwise `pnpm run test:save-smoke` is SKIPPED, not passed. Never fall back to production. Use `pnpm run verify:strict` when isolated full write coverage is required. Mandatory verification failure blocks commit/push/deploy per AGENTS.md. Missing optional AJN_SCHEMA_DATABASE_URL does not block normal release and never permits a fallback audit credential.

Documentation-only suite edits require frontmatter, link/path and behavioral validation; production build/print tests are not proof of skill quality. Report the distinction.

## Behavioral skill test cases

1. Repair a clipped photography receipt without redesign: locate live builder and adjust only proven overflow.
2. Purchase invoice to Agent: identify sales-only limitation, preserve existing browser/PDF flow; do not feed purchase IDs to sales.
3. Backend unpaid with pending 50,000: preserve unpaid, show pending separately; locate legacy render fallback rather than calling it authoritative.
4. 58mm receipt and long names: independent row composition; preserve printer profile; do not scale 80mm.
5. A4 wedding artwork: preserve 216×303 bleed and existing layout.
6. Reprint: inspect permission, reason, original job, idempotency, audit; no financial mutation.
7. Public QR: reuse safe token handler, not UUID/admin URL.
8. Broken historic purchase: stop empty save; no reconstruction from current stock.
9. Lifecycle: distinguish approval, payment and execution states; do not add generic refund enum.
10. Supplier OCR proposal: document confirmation/reconciliation design only, no dependency installs or inventory writes.
