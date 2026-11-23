# Staff mobile and booking WhatsApp recipients

Add one nullable staff.phone column; preserve legacy identities. Reuse existing Iraqi phone normalization, staff create/edit permissions and identity directory. Add the optional mobile field to the staff editor/cards and prefill the existing BookingShareDialog recipient field. Manual overrides apply only to the current send.

Blast radius reviewed: staffTable implicit selects and formatStaff responses, staff POST/PATCH and directory GET, staff editor and booking-share recipient selection. Existing callers in salary settings, employee salaries/advances, HR, assignments, warehouse/assets, vehicles and booking operations keep their current contracts; omitted phone must never clear it. No changes to payroll, authentication, permission grants, financial writes or generic employee selector behavior.

Verification: contact validation/legacy mutation tests, actual directory branch, real local browser UI for staff edit and WhatsApp selection/switch/manual override, typecheck, build, payment-state and verify:critical. Production write smoke tests only with a separately verified TEST database; otherwise SKIPPED. Apply only 0140_staff_phone.sql and verify its nullable text column before release. Follow the existing safe auto-release policy.
