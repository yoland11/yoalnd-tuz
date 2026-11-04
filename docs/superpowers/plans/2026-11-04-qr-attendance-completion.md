# Complete existing AJN QR employee attendance

> **For agentic workers:** Use executing-plans inline; one fresh-context review at the end. DO NOT COMMIT, PUSH OR DEPLOY.

**Goal:** Deliver the requested end-to-end attendance experience inside the existing attendance center and employee portal, closing inspected gaps rather than building another system.

**Architecture:** Reuse `/admin/attendance`, `/attendance-kiosk/:token`, `/staff`, the original `/api/admin/attendance/*` APIs, `attendance_records`, location/shift/kiosk/evidence tables, and original payroll approval. QR remains server-signed with 30-second rotation and bounded grace; GPS is checked by the server against the assigned workplace. No new tables, financial transactions or production writes.

**Tech Stack:** Existing React/Wouter, Next.js API, Drizzle/PostgreSQL, QRCode, LiveScanner, shadcn, Arabic RTL.

## Existing requirement coverage inspected

- Dashboard, employee search, date/location/status filters and counts: `attendance-center.tsx`, `attendanceDashboard`.
- Office, warehouse and approved booking-event locations: `attendance_locations`, `attendance_shifts`, existing booking attendance panel.
- Weekly/rotating/flexible/overnight schedules, lateness, worked time and overtime approval: `attendance.ts`, `attendance-rules.ts`, `attendance-payroll.ts`.
- Payroll proposals, protected historical payroll, bonuses and manager-only approval: `hr-intelligence.ts`; attendance never posts to Cash Box.
- Daily/monthly reports, employee filters, A4/PDF and Excel: original attendance report tab.
- Authentication, signed QR expiry, location evidence, replay guard and per-employee database lock already exist.

## Design decisions

Extend the original screens; a new standalone attendance system would duplicate identities and payroll. Keep existing authorized QR/GPS method configuration and default QR+GPS. No new financial calculation engine or salary posting path. Existing salary deductions remain proposals until the original manager payroll approval and financial payment execution.

Tablet kiosk: white/pink/burgundy, AJN logo, workplace and Baghdad clock, large contained QR, countdown, fullscreen control. Hide expired codes immediately, recover visibly from network failures, and validate display responses. No employee information on the kiosk.

Employee: retain only a syntactically valid bounded attendance token through the existing login route; never extend its server expiry or introduce open redirects. Scan, review, then explicitly press attendance action. Request fresh GPS once per submission. Keep a synchronous in-flight guard and stop old scanner callbacks. Add self-only recent history from the existing `me` response.

Shared server changes are limited to attendance callers: punch POST, today/dashboard/report and payroll schedule adapters. Preserve zero-minute shift grace and the original open-shift checkout workplace. Strictly validate submitted actions; no silent fallback to check-in. List all callers before changing their data shape.

## Review focus

- Login redirect must retain attendance QR while excluding arbitrary redirect parameters.
- Expired/offline/malformed kiosk data must never leave a scannable stale code.
- Fast repeated taps or delayed GPS/scanner results must not produce a second punch.
- A zero-grace or overnight shift must use its own time/location rules.
- No attendance action may settle money or bypass payroll manager approval.

## Tasks

- [x] Add failing focused tests for kiosk display validation, portal return query and submission schema.
- [x] Complete kiosk and mobile interaction paths using existing APIs and scanner.
- [x] Add regression tests and fixes for zero-grace/open-shift context; preserve financial and legacy records.
- [x] Verify actual React kiosk/portal/dashboard at mobile/tablet/desktop with controlled API/GPS/camera; use isolated PostgreSQL for security/shift/payroll tests.
- [x] Run typecheck, build, payment-state and verify:strict with separately verified TEST_DATABASE_URL; independent final review; leave changes uncommitted.


## Regression ledger

- Focused client/display contract RED→GREEN, including timezone-safe kiosk heartbeat timestamp.
- Real TEST PostgreSQL RED→GREEN: explicit zero shift grace, overdue event checkout context, same-day split shift and completed previous-day overnight shift followed by early next shift at a second location.
- Real original portal/browser RED→GREEN: late successful punch after component unmount and QueryClient.clear cannot reintroduce former employee data.
- Original UI PASS at 390/768/1440px with controlled HTTP/GPS/camera: fullscreen/expiry/offline/malformed QR, login handoff, explicit action, duplicate taps, GPS denial/retry, self history, kiosk list and reports.
- Original payroll gate tested: employee cannot approve, draft cannot skip manager submission/approval, and payroll cannot be paid before approval. Attendance creates no financial transaction.
- Shared caller review completed before server changes: punch caller = AttendanceTodayCard; shiftsBetween consumers = center, booking panel, today/dashboard/report and payrollScheduleInputs; payrollScheduleInputs consumer = original hr-intelligence and report. No public existing identifier, payment executor or original payroll formula replaced.
- Independent final review: all scoped session/shift findings fixed with real regressions; reviewer reported no remaining actionable findings.
- No commit, push, deployment, new schema objects, Production diagnostic writes or shared payment changes.

Final gate: pnpm run verify:strict PASS, exit 0, including production build, TypeScript, payment-state and all isolated save-smoke phases. Browser regression PASS. No commit, push or deployment performed.

Release authorization: after local completion, the owner explicitly requested upload and publication. This supersedes the original no-commit/push/deploy delivery boundary for the completed attendance feature only. Recheck the current tree, preserve hooks, and verify the exact deployed commit.
