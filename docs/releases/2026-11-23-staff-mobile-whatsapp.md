# Employee mobile and booking WhatsApp recipients

## Behavior

- `/admin/staff`: optional mobile in employee creation/editing and employee cards. Legacy employees without a phone remain valid.
- Existing staff POST/PATCH validates and stores the Iraqi mobile in canonical international digits. Arabic/Persian digits and local/international formatting are supported. Omitted fields preserve contacts; an explicit blank/null clears only the phone.
- Existing Booking Center share dialog loads the selected employee's mobile, displays the saved number and permits a per-send override. Selecting another employee or reselecting the current employee uses that employee's contact; employees without a saved phone support manual input. Directory reads refresh on reopening and retain existing staff.view access.
- No changes to employee identities, salary logic, grants, booking financial data, images or messaging providers. Sending remains an explicit user action in WhatsApp.

## Schema

Applied only `lib/db/migrations/0140_staff_phone.sql` through the controlled additive migration runner using the existing owner DATABASE_URL. It adds nullable text `staff.phone` and verifies its type/nullability in the same transaction. No employee rows were updated and no historical values were backfilled. No runtime DDL was introduced.

## Validation

- Staff mobile normalization/validation and actual existing PATCH handler with controlled DB I/O: omission, clear, correct save, invalid numbers, permission denial and visible DB failure.
- Existing staff permission, password visibility and employee identity tests passed.
- Actual directory projection and existing Booking Center WhatsApp/receipt/preparation regressions passed.
- 29 local Chrome browser checks passed, including actual staff creation/editing/clearing, saved recipient selection, same-employee reselection, manual recipient override, employee switching, financial privacy and 390px Arabic RTL. All external requests were blocked; messaging/clipboard were mocked at the OS boundary. No real WhatsApp messages were sent and no production employee records were changed.
- Typecheck, production build and `verify:critical` run as the mandatory release gate, including payment-state reconciliation.
- `test:save-smoke` / isolated PostgreSQL write integration: **SKIPPED**, because a separately verified TEST_DATABASE_URL and write flags are not configured in this worktree. This is not reported as a pass. No standalone lint command is configured.

Release base: `11fd4901250a196f2b8565a13fef49d3e237d71e`, including the published Work Command Center upgrade. The complete verification gate is rerun on the combined code before release.
