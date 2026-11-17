# Scientific Research Department — implementation design

## Intent
Extend the existing AJN Research Center in place into قسم البحوث العلمية for مجموعة علي جان نهاد. The user's supplied specification and navy/gold dashboard are the approved functional and visual brief. Work stays local: DO NOT COMMIT, PUSH, OR DEPLOY. Do not write to Production.

## Architecture and decisions
Reuse /admin/research and its existing 14 research tables, customer IDs, service sales invoices, research_order financial source, central financial approvals/cashbox, canonical payment-state reconciliation, private Supabase research files, notifications, timeline and print/PDF toolkit. A parallel department/accounting implementation would duplicate existing authoritative records and is excluded by the brief.

Preserve research_type and historical statuses. Add nullable title_english, academic_level, research_category, payment_due_date and a unique optional creation_key on research_orders; link existing expenses and original purchase invoice headers with nullable research_order_id references. One isolated additive migration, supplied but not executed against Production. Payment due date is independent of delivery deadline; null is never overdue. A purchase is attributed once; later supplier payments remain settlements. Archived debt remains in receivables; restoring an archive clears its timestamp under the archive permission.

Present six workflow columns while preserving stored statuses: new=new; requirements_review=accepted; in_progress=searching_sources/writing; quality_review=review/formatting/plagiarism_check; ready=completed; completed=delivered. Archive remains accessible through existing history.

## Money and safety
Pending/rejected requests do not reduce receivables. Canonical executed payments and posted receipt allocations remain authoritative, with reversal and approved invoice credits preserved. Reject excessive amounts rather than clipping; pending requests reserve collection capacity. Use a source lock and revalidate outstanding at approval before any ledger/cash writes. Research expenses reference existing expenses and sourceType expense so they cannot subtract from customer receipts. Price edits, assignment changes, histories and invoice updates are transactional. Do not delete approved history; existing central reversal workflow handles corrections.

## UI
Scoped navy/gold/white styling in existing admin shell; Arabic RTL and mobile responsive. Dashboard ten metrics, six-column Kanban, explicit loading/error/empty states, compact order form, shared workspace with details/team/chapters/versions/files/messages/financial history/expenses/timeline. Dedicated receivables and student statement; genuine date-filtered reports, A4/PDF/Excel and 80mm receipts using existing print foundation. Show only authorized actions and financial fields.

## APIs
Keep existing endpoints. Add GET /admin/research/board; GET /admin/research/receivables; GET /admin/research/students/:customerId/statement; GET /admin/research/orders/:id/financials; GET/POST /admin/research/orders/:id/expenses. Extend existing /dashboard, /reports, /orders, /orders/:id/payment and files/chapters/messages. Bounded, server-filtered records with pagination. Financial history combines existing source transactions, receipt allocations and the original mirror invoice without counting duplicates.

## Verification
Test-first domain, financial and UI behavior; test legacy mappings, null due dates, pending reservations, duplicate retries, changed retry payloads, permissions, approved-only amounts, reversals, private relationship ownership and errors. Run typecheck, build, test:payment-state, existing research checks, new research behavioral tests and verify:critical. Database write tests require the three isolated test flags/URL, otherwise explicitly SKIPPED. No production test writes. Local browser fixtures verify RTL/responsiveness and interactions; storage integration remains dependent on configured private test storage.
