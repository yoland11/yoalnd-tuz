# Kosha Manager Instruction Sync Design

## Goal

Connect manager reference photos and notes with the existing Kosha staff execution flow using the same booking identity (`source` + `bookingId`). Files, bookings, and staff tasks are never duplicated.

## Data design

Add two backward-compatible tables:

- `kosha_manager_instructions`: one note or image reference, booking source/id, caption, uploader identity, revision, timestamps, and archival metadata. Image rows point to the single existing storage object.
- `kosha_booking_channel_reads`: per staff member and booking, stores the last real view time for `manager_instruction` or `staff_execution`.

Existing `kosha_media` remains the source for staff execution/problem media. Existing booking events remain the operational timeline. The polymorphic booking identity supports native Kosha bookings and routed service bookings without weakening existing foreign keys.

## Server behavior

- Manager create/edit/archive endpoints require the existing Kosha execution-management permission.
- Staff instruction reads first pass the existing portal authorization and then require assignment to that booking (or an authorized supervisor).
- Viewing the booking is read-only; the UI explicitly marks the instruction section viewed only after it renders.
- Manager writes add timeline entries and notify every assigned Kosha employee through the existing notification system.
- Archive replaces destructive deletion. Edits increment the revision and remain visible in audit history.
- Booking lists receive batched unread counts to avoid N+1 queries.

## UI behavior

Admin quick details shows four distinct areas: manager instructions, staff execution images, notes, and problems/damages. Manager instructions support multi-image upload, notes/captions, edit, archive, and a full-screen RTL viewer.

Staff booking details places “تعليمات من الإدارة” before workflow controls. It shows photos, captions, uploader/time, and unread count. Opening the rendered section clears only that employee's unread state.

## Safety

- No historical media or bookings are rewritten.
- No financial, inventory, payment, or booking status logic changes.
- Server authorization is authoritative; client-provided booking IDs are never trusted alone.
- API errors retain the AJN structured error contract and request IDs.

