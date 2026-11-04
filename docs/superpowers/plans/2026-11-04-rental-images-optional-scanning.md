# Rental pictures and optional dispatch/return scanning

> **For agentic workers:** Use executing-plans for the scoped change; delegate the independent picture component and review.

**Goal:** Show existing rental asset pictures and optionally identify rental lines by barcode when dispatching or receiving equipment.

**Architecture:** Reuse each original asset image and the existing LiveScanner. A scan selects and focuses a line already belonging to the authorized rental; it never posts a movement, increments quantities, adds assets or changes finances. Manual operation remains available and confirmation uses the same idempotent API.

**Tech Stack:** React, TypeScript, existing shadcn Dialog/Button, ZXing/native LiveScanner, Playwright fixtures.

## Design and scope

- Display asset thumbnails in selection, selected lines, list and movement dialogs, and reuse one accessible full-size preview component.
- Image editing remains in the existing asset editor (`/admin/assets/new?edit=ID`), with an authorized shortcut from the equipment view. No new upload storage or database fields.
- Optional scanning supports existing barcode strings, strict AJN asset QR codes and asset URLs. Only a unique matching rental line can be selected. Unknown/ambiguous/exhausted items show an explicit error.
- The scanner mounts only after an explicit click. Success focuses dispatch quantity or return-good quantity; it does not modify its value. Closing the dialog stops the camera.
- No financial, inventory, permission, write API or schema behavior changes. Rental response serialization reads current product images in one batch per list page, falling back to the saved picture. Callers inspected: list, create/retry, action responses and detail GET; historical snapshots remain untouched. Historical rentals without pictures/barcodes retain manual operation.

## Review focus

- Different rental's barcode must not select a line or write anything.
- Duplicate barcode values must not silently choose one asset.
- Camera denial must preserve manual entry and quantities.
- Full-size photo and movement dialogs must fit mobile RTL.
- Items fully dispatched or returned must not be offered as actionable by scanning.

## Tasks

- [x] Write and run failing local scan-resolution and image tests.
- [x] Implement rental-local scan resolver, picture component, and optional scan controls in existing rental UI.
- [x] Extend original browser fixture with photos and dispatch/return scan interactions, unknown/duplicate/error coverage, and unchanged manual confirmation.
- [x] Run focused tests, TypeScript/build/critical/payment-state and isolated DB smoke if verified test DB available. Review diff with independent agent.
- [x] Confirm AJN auto-release preconditions: required verification is green; no Production test writes or schema changes.

## Verification ledger

- Scan resolver RED (missing implementation), GREEN; added URL-encoding collision RED→GREEN after independent review.
- Picture component RED→GREEN, render contract verifies original URL, object-contain and accessible non-submit trigger.
- Isolated PostgreSQL RED→GREEN: original asset pictures appear on list/detail for existing contracts; saved snapshot stays unchanged; main passport photo wins and purchase-invoice photo is excluded.
- Actual React browser fixture PASS at 390/768/1440px: image preview, RTL/no overflow, unknown and successful scans, original manual confirmation, fake local camera decode, denial fallback, image refresh and broken picture fallback.
- Camera session race RED→GREEN: old delayed decoder result cannot close a newly started scanner.
- Independent read-only review: no remaining actionable issues after the URL and camera lifecycle fixes.
- No schema migration, Production database test writes, new storage, permission changes or financial/inventory posting changes.
- Scanning identifies a contract line only; staff review the quantity and confirm through the original API. Camera tests use synthetic local media, not physical phone hardware. Opaque QR-token links are not resolved; existing product barcodes and AJN asset-code labels are supported.

- Final pnpm run verify:strict PASS (TypeScript, production build, payment-state, critical suite and all isolated save-smoke phases), 2026-11-04. Lint is not configured in this repository (SKIPPED).
