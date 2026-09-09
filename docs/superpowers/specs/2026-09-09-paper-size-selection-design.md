# AJN document paper-size selection

## Goal

Add a consistent paper-size choice to AJN document print actions while preserving existing data, permissions, audit behavior, printer routing, and specialized layouts. A4 and thermal 80mm render the same authoritative document facts through independent compositions.

## Scope

The first implementation wave covers printable financial and operational documents that can meaningfully support both A4 and 80mm:

- Sales invoices and POS receipts
- Purchase invoices
- Accounting receipts and vouchers
- Finance, expense, daily and operational reports
- Customer and supplier statements where a compact thermal summary is meaningful

Label-only outputs remain outside the A4/80mm toggle:

- QR and barcode labels
- Graduation 40×30 labels
- Warehouse and asset labels
- Booking identification labels

Their existing paper profiles remain available and unchanged.

## User experience

Each supported print action opens or includes a compact Arabic RTL selector:

`قياس الورق: [حراري 80mm] [A4]`

The selected size is explicit before printing. Existing screens that already expose a size selector retain their current interaction and are migrated only when the shared component improves consistency without losing options such as 58mm. The selector uses large touch targets and keyboard-accessible labels.

The default comes from an existing printer/document preference when available. Otherwise the existing document default is retained; the feature does not silently switch established output.

## Rendering architecture

The selector returns a presentation profile only. It never changes invoice, payment, stock, customer or accounting data.

```text
Existing module data
  → existing document adapter
  → selected paper profile
  → existing or new format-specific renderer
  → browser print / PDF / supported Print Agent route
```

A4 and 80mm share data adapters and safe formatting but not document markup. A4 uses sheet hierarchy, full metadata, appropriate table columns and pagination. Thermal 80mm uses compact metadata, narrow item rows, content-height paper and high-contrast output.

## Reusable UI boundary

Create a small reusable paper-size control for document flows, with an API shaped around supported options and current value. It must not assume every print action supports both sizes. Callers provide available profiles and accessible labels.

The control does not own printing, PDF export, server requests, printer selection or saved settings. Those remain with their current modules.

## Compatibility and routing

Sales already has independent A4, 80mm and 58mm rendering. Preserve it and reuse it as the reference behavior.

The standalone AJN Print Agent currently accepts only `documentType: sales_invoice`. Its paper-size field does not prove remote support for purchases, vouchers or reports. Unsupported remote documents stay on browser printing until a separately reviewed payload extension exists.

Direct sales printing must not map an A4 request to 80mm silently. If the selected remote printer or current Agent route cannot execute A4, the UI must explain the limitation and keep local A4 printing available instead of changing the requested size.

## Module migration rules

For each print button:

1. Identify whether it prints a document, report, receipt or label.
2. Record its current default, builder, route, permissions and audit call.
3. Add the selector only if both A4 and 80mm have purposeful layouts.
4. Create a missing layout only from the same authoritative adapter; do not duplicate business calculations.
5. Preserve current design unless the new paper size requires a separate composition.
6. Keep existing action visibility and server authorization.

No global search-and-replace of `window.print()` is allowed.

## Data and financial safety

- Render canonical totals, paid, remaining and payment status from existing backend flows.
- Printing and changing paper size create no invoice, payment, stock or ledger mutation.
- Preserve decimal quantities, invoice numbers, QR tokens and historical data.
- Keep print-audit failures visible according to existing AJN error contracts.
- Do not expose internal IDs or secrets in QR or printed metadata.

## Error handling

Unavailable renderer: disable that paper option with an Arabic explanation.

Unavailable remote printer: retain the requested profile and offer local browser printing; do not pick another printer or paper silently.

Popup blocked, render failure or audit failure: show the existing controlled error and preserve screen/form state.

## Test strategy

Start with failing contract tests for the shared selector and each migrated route. Verify:

- A4 selects an A4-specific builder and never thermal markup.
- 80mm selects an 80mm-specific builder and never sheet scaling.
- Existing 58mm sales support remains intact.
- Unsupported label flows do not display A4.
- Remote sales A4 is not silently rewritten to 80mm.
- Data values are identical across paper variants.
- Permissions and audit requests remain unchanged.
- Arabic RTL, long names/items, decimal quantities, huge IQD totals, many-item pagination and content-height thermal output.

Run focused print tests, `pnpm run typecheck`, `pnpm run build`, and `pnpm run verify:critical`. Physical-printer results require real device evidence. Database write smoke tests remain skipped unless the isolated test environment required by `AGENTS.md` is configured.

## Rollout

Implement in small verified waves: sales/POS, purchases, accounting/finance, then eligible statements/reports. A module is complete only when both purposeful layouts and its focused tests pass. Label-only flows are documented as intentionally excluded, not unfinished.
