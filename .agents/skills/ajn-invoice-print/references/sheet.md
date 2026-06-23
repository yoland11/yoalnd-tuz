# Full-sheet documents — A4 & A5

Use for: customer invoices (order/booking), compact invoices / delivery notes,
and financial/daily/accounting reports. These are real sheets — they get the
logo in color, generous margins, and proper tables. The on-screen reference is
`src/views/admin/invoice.tsx`; the PDF variant prints the same layout via
`downloadElementPdf` (`src/lib/pdf.ts`).

Prefer a shared builder. If `print-helpers.ts` has no sheet builder yet, add one
(e.g. `sheetInvoiceCss("a4" | "a5")`) so A4 and A5 share margins, type scale, and
the header/footer, differing only in size. Don't inline a `<style>` per view.

## A4 vs A5 — same identity, different scale

| | A4 | A5 |
|---|---|---|
| `@page` | `size: A4; margin: 14mm` | `size: A5; margin: 10mm` |
| Base font | 12px | 11px |
| Use | full invoice, reports | compact invoice, delivery note |
| Logo height | ~52px | ~40px |
| Items table | full columns | trim to essentials |

A5 is not a shrunk A4 screenshot — it's the same template with the smaller scale
and fewer columns. Reformat, don't zoom.

## Shared sheet structure (top → bottom)

1. **Header band** — logo (color) on one side, company block on the other:
   "مجموعة علي جان نهاد" + branch/contact line. Color is allowed here only.
2. **Title + meta row** — document title (فاتورة) large; on the opposite side the
   number, date, and payment status (مدفوع / جزئي / غير مدفوع).
3. **Parties** — "إلى: ${customer}" + phone/address; optional "من: الفرع".
4. **Items table** — header row with a subtle fill (`#f2f2f2`, prints fine),
   1px borders, right-aligned Arabic text, `tabular-nums` for numeric columns
   (الكمية / السعر / المبلغ). Zebra rows optional and very light.
5. **Totals panel** — bottom-left block: المجموع، الخصم، التوصيل، then a boxed
   **الإجمالي** (largest, weight 700) and المدفوع / المتبقي under it.
6. **Footer** — QR (trackable docs) + terms/thanks + contact line, separated by a
   thin rule.

## Type scale (A4 base 12px)

- Company name — 18px / 700
- Document title — 20px / 700
- Section labels — 12px / 700, muted-but-black
- Table header — 12px / 700
- Grand total — 16–18px / 700, boxed

## Color on sheets

Unlike thermal, A4/A5 may keep the **logo in color** and use one restrained ink
accent (a thin rule or the brand gold for the title underline). Keep body text
black for legibility and toner economy. Never rely on color to convey meaning
(status also gets a text label), so a black-and-white printer still reads right.

## Reports (A4)

Financial/daily/accounting reports follow the same header/footer but replace the
invoice body with the report's tables and summary cards. Keep the AJN header so a
printed report is unmistakably from the same system. Totals/summary use the same
boxed-emphasis treatment as an invoice grand total.

## PDF

The PDF is the A4 layout rendered to file via `downloadElementPdf`. Design the A4
once; the PDF inherits it. Ensure fonts/logo are loaded before capture (same
reason as `printWhenImagesReadyScript` for print).
