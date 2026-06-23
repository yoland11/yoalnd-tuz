---
name: ajn-invoice-print
description: >-
  The single source of truth for designing and standardizing every printable
  document in the AJN site (مجموعة علي جان نهاد): customer invoices, POS
  receipts, photography order vouchers (وصل تصوير), kosha booking receipts,
  payment/collection vouchers, financial & daily reports, and QR labels. Each
  paper format gets its OWN professional design — thermal 58mm/80mm, A4, A5, and
  PDF — because a thermal printer and an A4 sheet are physically different media.
  USE THIS SKILL whenever the user mentions a فاتورة، وصل، إيصال، طباعة، طابعة،
  حرارية، ريسيت، invoice, receipt, voucher, print, thermal, A4, A5, "صمم
  الفاتورة", "رتب الفواتير", "وحّد شكل الطباعة", or asks to design, restyle,
  clean up, unify, or fix how anything prints — even if they don't name the
  format. If a print job currently builds its own inline HTML/CSS, this skill
  applies: route it through the shared toolkit instead.
---

# AJN Invoice & Print Design

You design and standardize **everything AJN prints**. The goal is one coherent,
professional identity across all documents, with a layout tailored to each paper
size. Today many flows hand-roll their own inline `<style>` (e.g. the photography
receipt uses Arial and ad-hoc CSS while the POS receipt uses the polished
`thermalReceiptCss`). That drift is the problem you exist to remove.

## The one rule that prevents drift

**All print output goes through `src/views/admin/print-helpers.ts`.** It is the
single source of truth. Never paste a fresh `<style>` block into a `window.open`
call. If a document needs a format that isn't covered yet, **add a builder to
`print-helpers.ts`** and call it — don't fork the CSS into a view file.

Why: thermal receipts must be 100% pure black with heavy weights and thick
borders (thermal heads can't render anti-aliased grays or hairlines), while A4/A5
are full sheets with the logo, tables, and breathing room. Centralizing the CSS
is the only way every printer in every branch produces the same clean result.

## Format matrix — pick the right design per document

| Document | Default format | Builder / reference |
|---|---|---|
| POS sale receipt | 80mm thermal (58mm option) | `thermalReceiptCss` · [references/thermal.md](references/thermal.md) |
| Photography order voucher (وصل تصوير) | 80mm thermal | `thermalReceiptCss` · [references/thermal.md](references/thermal.md) |
| Kosha booking receipt | 80mm thermal | `thermalReceiptCss` · [references/thermal.md](references/thermal.md) |
| Payment / collection voucher (سند قبض) | 80mm thermal | `thermalReceiptCss` · [references/thermal.md](references/thermal.md) |
| QR label | 58mm/80mm | `openQrPrintWindow` (already standard) |
| Customer invoice (order / booking) | A4 | [references/sheet.md](references/sheet.md) (A4) |
| Compact invoice / delivery note | A5 | [references/sheet.md](references/sheet.md) (A5) |
| Financial / daily / accounting reports | A4 | [references/sheet.md](references/sheet.md) (A4 report) |
| Downloadable invoice | PDF | `downloadElementPdf` (`src/lib/pdf.ts`) over the A4 layout |

When the user asks to design a document, confirm which format(s) it should
support, then follow the matching reference. A single document can support
several formats (e.g. an invoice printable as both A4 and 80mm) — design each
variant deliberately, never scale one into the other.

## The shared AJN print identity

Every document, regardless of size, shares this DNA so they read as one brand:

- **Direction & font:** `direction: rtl`, `Cairo` (Tahoma/Arial fallback). Arabic
  numerals where the surrounding app uses them, but money/totals use
  `tabular-nums` so columns align.
- **Color:** pure black on white. No grays, no brand gold on the printed page —
  gold survives on screen but muddies on paper and dies on thermal. Color lives
  in the header logo only on A4/A5; thermal logos are grayscaled with high
  contrast.
- **Header:** logo (from `usePublicSettings`/`logoSrc`) → company name "مجموعة
  علي جان نهاد" → document title (فاتورة / وصل تصوير / سند قبض …) → number + date.
- **Body:** key/value meta block, then the items/details, then a totals block.
- **Totals block:** the grand total is the visual anchor — boxed and largest.
  Show المبلغ / المدفوع / المتبقي consistently.
- **Footer:** QR (when the document is trackable) + a short thanks/contact line.
- **Print trigger:** always `printWhenImagesReadyScript()` so the logo/QR finish
  loading before the print dialog fires. Never a bare `window.onload=print`.

Full skeletons live in the reference files — read the one for the format you're
designing before writing markup.

## Where the code lives

- `src/views/admin/print-helpers.ts` — the toolkit. Functions you build on or extend:
  - `thermalReceiptCss("58mm" | "80mm")` — the dedicated thermal stylesheet (classes
    `.receipt .r-head .r-logo .r-company .rule .kv table.items .totals .grand
    .payline .qr .thanks`). Use this for ALL thermal receipts.
  - `thermalBaseCss(size, fontSize?)` — general print CSS for simpler labels/sheets.
  - `printWhenImagesReadyScript(closeAfterPrint?)` — the required print trigger.
  - `openQrPrintWindow(...)`, `downloadDataUrl(...)` — QR helpers.
- `src/views/admin/invoice.tsx` — the on-screen A4 invoice (order/booking).
- `src/lib/pdf.ts` — `downloadElementPdf` for the PDF variant.
- Flows that currently print and may still be ad-hoc (migrate these to the toolkit
  when touched): `pos.tsx` (standard), `staff/photography/index.tsx`,
  `koshas.tsx`, `accounting.tsx`, `finance.tsx`, `reports.tsx`, `daily-cash.tsx`,
  `daily-report.tsx`, `expenses.tsx`, `inventory-value-report.tsx`.

## Designing or restyling a document — the workflow

1. **Identify** the document and its format(s) from the matrix above.
2. **Read** the matching reference file for the skeleton, type scale, and margins.
3. **Build through the toolkit.** Thermal → `thermalReceiptCss` + the thermal
   skeleton. A4/A5 → the sheet template. If the needed builder doesn't exist, add
   it to `print-helpers.ts` (e.g. a `sheetInvoiceCss("a4" | "a5")`) and reuse it
   everywhere — don't inline CSS in the view.
4. **Wire the print trigger** with `printWhenImagesReadyScript()`.
5. **Preserve the data.** Restyling must not change which fields print or their
   values — only the layout/typography. Money formatting and totals stay correct.
6. **Verify** with `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/next build`.
   (The browser preview tool is bound to a different project, so confirm compile
   + describe the print result; don't claim a visual you can't see.)

## Converting an ad-hoc print flow to the standard

Many flows write `window.open("",...)` then a custom `<style>`. To standardize one:

1. Find the inline `<style>` and the HTML it wraps.
2. Map the document to a format and its skeleton.
3. Replace the inline CSS with the toolkit builder (`thermalReceiptCss` /
   `sheetInvoiceCss`) and re-mark the HTML with the standard classes
   (`.r-head`, `.kv`, `.grand`, …).
4. Swap the print trigger to `printWhenImagesReadyScript()`.
5. Keep every field; only the wrapper/markup changes.

Worked example to look at first: the photography voucher in
`staff/photography/index.tsx` (`printReceipt`) is a textbook ad-hoc case —
Arial, inline rows, bare `window.print()`. Converting it to `thermalReceiptCss` +
the thermal skeleton is the canonical demonstration of this skill.

## Golden rules (the "why" behind each)

- **One builder per format, reused everywhere** — so fixing a margin fixes it for
  every branch and every document at once.
- **Thermal is built from scratch, never a shrunk A4** — different physics: pure
  black, ≥1.5px borders, tabular numerals, page height = content, tiny margins.
- **The grand total is the hero of any money document** — boxed, largest weight,
  unambiguous. A receipt exists to communicate المتبقي clearly.
- **Logo/QR must load before printing** — hence `printWhenImagesReadyScript()`.
- **Design changes never touch the data** — same fields, same numbers, new look.
