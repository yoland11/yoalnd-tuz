/** Where a request's record lives. The employee who asked came from that screen, so they can open it. */
export function approvalRecordHref(request: { type: string; entityType: string | null; entityId: number | null }) {
  if (request.type === "delete_document") return "/admin/documents";
  const id = request.entityId;
  if (request.entityType === "warehouse_transfer") return "/admin/warehouse-transfers";
  if (request.entityType === "warehouse_count") return "/admin/warehouses";
  if (request.entityType === "receipt_voucher" || request.entityType === "payment_voucher") return "/admin/accounting";
  if (!id) return null;
  if (request.entityType === "kosha_booking") return `/admin/kosha-bookings?booking=${id}`;
  if (request.entityType === "service_order") return `/admin/orders?serviceOrder=${id}`;
  if (request.entityType === "order") return `/admin/orders?order=${id}`;
  if (request.entityType === "product") return `/admin/products/${id}`;
  return null;
}
