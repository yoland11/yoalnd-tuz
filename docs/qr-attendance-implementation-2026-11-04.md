# AJN — QR employee attendance completion

## Delivery boundary

Implementation was completed and verified locally under the original no-release instruction. The owner subsequently requested commit/push/Production publication. This release includes only the completed attendance change; no Production diagnostic writes, schema migration, duplicate employee directory or new financial posting path.

## Where to use it

1. الموظفون → الحضور والانصراف (`/admin/attendance`). The original attendance center is also under الموارد البشرية.
2. مواقع العمل: configure the actual office/warehouse/event coordinates, radius and acceptable GPS accuracy. Select an existing warehouse when applicable.
3. إعدادات الموظفين / الورديات: enable verification for the intended employee, assign a workplace and schedule. QR + GPS remains the default combined verification method; existing authorized alternatives remain intact.
4. شاشة QR: select the workplace, create a device link and open it on the tablet. The original link is shown once; it can be revoked through the same manager screen. Fullscreen is available when the device browser supports it.
5. Employee scans the displayed QR, signs into the original `/staff` portal, reviews the attendance card and presses تسجيل حضور / تسجيل انصراف. QR syntax is not considered proof: the server still verifies its signature, time window, workplace and GPS.

## Requirement coverage

| Requirement | Existing system reused / completed behavior |
| --- | --- |
| Tablet kiosk | Original `/attendance-kiosk/:token`; AJN logo/fallback, workplace, Baghdad clock, fullscreen button, QR countdown and burgundy progress. |
| QR rotation | Original per-device HMAC signature and 30-second server window; bounded original 15-second submission grace. Screen hides the old image immediately at rotation while refresh is pending. |
| Connection failures | Structured AJN request errors, explicit retry, automatic recovery, invalid-payload rejection, abort on unmount and monotonic elapsed time. |
| Employee authentication | Original login/session APIs; only bounded valid QR and approved portal-tab state survives login. No arbitrary redirects are forwarded. |
| Employee actions | Explicit confirmation after scanning, fresh one-shot GPS, synchronous in-flight guard, scanner-generation protection, self history and synchronized original dashboard. |
| Location verification | Original server distance/radius/accuracy checks, assigned workplace and approved booking-event shift locations. No location watch or new tracking service. |
| Dashboard | Original total/present/absent/late/checked-out/mission counters, employee/date/department/location/method/status filters and original tables. |
| Schedules | Original fixed/rotating/flexible/event/part-time/overnight schedules. Fixed explicit zero-grace handling and original open-session checkout context. Used-shift lookup is shared between displayed selection and punch admission, including closed previous-day overnight shifts. |
| Payroll | Original payroll calculation and cycle approval; attendance creates no Cash Box movement. Deductions remain proposed until the original manager approval; draft/unapproved payment refusal is tested. Existing bonuses, overtime approval and protected historical payroll remain in place. |
| Reports | Original daily/weekly/monthly and per-employee reports, Excel and A4/PDF report engine. Exports are disabled on failed or pending report reads. |
| Security/data | Original employee authentication, QR expiry/replay guards, per-employee database lock, location evidence and unique-open-session index. Added strict punch action/GPS schema and fail-closed attendance result parsing. |

## Changes and reuse

- `src/views/attendance-kiosk.tsx`: original kiosk refactored for fullscreen, valid-only QR display and recoverable connection states; uses existing logo fallback, Button and Progress.
- `src/lib/attendance-client.ts`: bounded QR extraction, safe login return query, timestamp formatting and kiosk payload validation.
- `src/lib/attendance-submission.ts`: strict Zod punch contract, reused by the route and original attendance service.
- `src/components/attendance-today-card.tsx`: original mobile card/scanner, explicit action, one GPS request, guarded asynchronous callbacks, authoritative result cache update and self-only recent history. A delayed success after logout cannot recreate the prior employee's cache.
- `src/views/staff/unified-portal.tsx`: original login navigation carries the QR to the existing attendance card.
- `src/server/attendance.ts`: preserves zero-minute grace, original checkout location/method and next unused eligible shift across midnight; original transaction/replay/financial boundaries retained.
- `src/server/api.ts`: strict punch input validation and original structured error contract; local attendance query adapter now throws on malformed database results.
- `src/views/admin/attendance-center.tsx`: fixes ISO/legacy heartbeat timestamps, explicit open-kiosk link, real clipboard error handling and honest payroll proposal/export states.
- `src/views/admin/staff.tsx`: permission-aware attendance shortcut in the existing employee page.
- `next.config.mjs`: kiosk links use no-referrer and noindex headers while retaining existing camera/GPS policy.
- `package.json`: focused client checks join the existing attendance test command; adds the opt-in original-screen browser test.
- `scripts/test-attendance-client.ts`, `scripts/test-attendance-browser.ts`, `scripts/test-attendance-integration.ts`: focused regression coverage and fail-closed test database guard.

Shared caller review: the punch API has one production UI caller (AttendanceTodayCard). Attendance shift reads are consumed by the original attendance center, booking attendance panel, today/dashboard and payroll schedule adapter. `payrollScheduleInputs` is read by original attendance reports and `hr-intelligence.ts`; no payroll formula or payment executor was replaced. The added nullable override indicator is additive; original shift IDs and fields remain intact.

## Database and images

No new migration, table, storage bucket or image uploader. Reuses the existing `0133_attendance_system.sql` schema and original employee/payroll records. QR PNGs are generated through the original QRCode endpoint; no employee data appears on the public kiosk. Uses the existing AJN logo and fallback asset.

## Verification evidence

- Focused client tests: QR/login handoff, whitelisted return state, malformed kiosk display, ISO/legacy heartbeat timestamps and strict punch input.
- Existing attendance rules and real PostgreSQL integration: signatures, expiration, revoked/wrong-workplace codes, reuse prevention, GPS radius/accuracy/refusal, overnight hours, correction approval, reports, bonuses and protected payroll.
- Added PostgreSQL regressions: explicit zero grace; overdue event checkout workplace; same-day two shifts at different sites; completed previous-day overnight shift followed by early next-shift check-in; manager-only payroll approval and no payment before approval.
- Actual original React screens, controlled HTTP/GPS/camera, PASS at 390/768/1440px: rotating/expired/offline/malformed kiosk, fullscreen, login QR preservation, explicit action, one GPS request on repeated taps, denial/retry, manual scanner fallback, history, original dashboard/reports and RTL/no page overflow.
- Delayed-session regression reproduced before the fix and passed afterwards: unmount + clear QueryClient + late punch response cannot restore former employee attendance.
- Independent read-only review found the session and shift-selection edge cases; all were fixed with failing-then-passing regressions and the reviewer reported no remaining scoped findings.

Final verification PASS: `pnpm run verify:strict` completed with exit 0, including TypeScript, production build, payment-state, critical regressions and all isolated `test:save-smoke` phases. The focused `pnpm run test:attendance` and original-screen `pnpm run test:attendance-browser` both passed. `git diff --check` passed. Lint is not configured in this repository (SKIPPED, not reported as passed).

Local evidence: `C:/Users/ALIJAN/AppData/Local/Temp/ajn-attendance-final-verified-20261104.log`, `ajn-attendance-final-tests-20261104.log`, and `ajn-attendance-browser-20261104.log`. Screenshots are under `C:/Users/ALIJAN/AppData/Local/Temp/ajn-attendance-browser-20261104`.

Release base: `db6608600f8c8bd7d99b4086ed0dd3a0e5e4fd20` (prior rental release). Publication follows a fresh verification gate and the existing non-force Git/Vercel integration.

## Practical limits

- Actual workplace coordinates, radius, approved event assignments and employee schedules must be configured with the company's real data.
- Browser/GPS tests use controlled local media and coordinates; a physical iPad/iPhone/Android field test was not performed.
- No QR attendance mockup was attached to this request; the implementation follows the existing AJN Arabic RTL components and requested white/pink/burgundy direction.
- Publication is authorized by the owner’s later release request; Vercel status and public HTTP/auth checks must be confirmed after Git push.
