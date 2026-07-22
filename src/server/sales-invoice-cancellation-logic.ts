export type SalesInvoiceMovementCandidate = {
  id: number | string;
  product_id?: number | string | null;
  stock_source_product_id?: number | string | null;
  quantity_change: number | string;
  sales_invoice_item_id?: number | string | null;
  warehouse_id?: number | string | null;
  metadata?: Record<string, unknown> | null;
  match_priority: number | string;
};

export type SalesInvoiceMovementMatch =
  | { kind: "matched"; movement: SalesInvoiceMovementCandidate; priority: number }
  | { kind: "missing" }
  | { kind: "ambiguous"; priority: number };

export function selectSalesInvoiceOriginalMovement(input: {
  invoiceItemId: number;
  productId: number;
  stockProductId: number;
  quantity: number;
  candidates: SalesInvoiceMovementCandidate[];
  usedMovementIds: ReadonlySet<number>;
}): SalesInvoiceMovementMatch {
  const matches = input.candidates.filter((movement) => {
    if (input.usedMovementIds.has(Number(movement.id))) return false;
    const movementItemId = Number(movement.sales_invoice_item_id ?? 0);
    if (movementItemId && movementItemId !== input.invoiceItemId) return false;
    const movementProductId = Number(movement.product_id ?? 0);
    const movementStockProductId = Number(
      movement.stock_source_product_id ?? movementProductId,
    );
    const productMatches =
      movementProductId === input.productId ||
      movementProductId === input.stockProductId ||
      movementStockProductId === input.stockProductId;
    const quantityMatches =
      Math.abs(Math.abs(Number(movement.quantity_change)) - input.quantity) <
      0.0005;
    return productMatches && quantityMatches;
  });
  if (!matches.length) return { kind: "missing" };
  const priority = Number(matches[0].match_priority);
  const bestMatches = matches.filter(
    (movement) => Number(movement.match_priority) === priority,
  );
  const exactItemMatch = bestMatches.find(
    (movement) =>
      Number(movement.sales_invoice_item_id ?? 0) === input.invoiceItemId,
  );
  if (exactItemMatch)
    return { kind: "matched", movement: exactItemMatch, priority };
  if (bestMatches.length > 1 && priority >= 4)
    return { kind: "ambiguous", priority };
  return { kind: "matched", movement: bestMatches[0], priority };
}

export function salesInvoiceCancellationIdempotencyKey(
  invoiceId: number,
  invoiceItemId: number,
) {
  return `sales-invoice-cancel:${invoiceId}:${invoiceItemId}`;
}
