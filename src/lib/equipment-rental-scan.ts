type RentalScanLine = {
  productId: number;
  code?: string | null;
  quantity: number;
  checkedOutQty?: unknown;
  returnedGoodQty?: unknown;
  returnedDamagedQty?: unknown;
  missingQty?: unknown;
  pendingInspectionQty?: unknown;
};

/** Identification only: restrict matches to the current contract, never mutate custody. */
export function resolveRentalScan(raw: string, assets: readonly RentalScanLine[], action: "dispatch" | "return"): { productId: number } | { error: string } {
  let code = String(raw ?? "").trim();
  // Keep slashes inside ordinary barcodes; only extract a path from actual URLs.
  if (/^(?:https?:\/\/|\/assets\/)/i.test(code)) {
    code = code.split(/[?#]/)[0].split("/").filter(Boolean).at(-1) ?? "";
    // Decode the segment only: %2F, %3F and %23 can belong to the barcode itself.
    try { code = decodeURIComponent(code); } catch { /* Preserve literal malformed escapes. */ }
  }
  const normalized = code.toLowerCase();
  const assetId = /^AJN-A0*(\d+)(?:-[a-f\d]+)?$/i.exec(code)?.[1];
  const matches = normalized ? assets.filter(line =>
    (!!line.code?.trim() && line.code.trim().toLowerCase() === normalized)
    || (assetId != null && line.productId === Number(assetId))) : [];
  if (!matches.length) return { error: "هذه المعدة غير موجودة في الإيجار الحالي." };
  if (matches.length !== 1) return { error: "الباركود مكرر بين معدات الإيجار؛ اختر المعدة يدوياً." };
  const line = matches[0];
  const count = (value: unknown) => Number(value || 0);
  const available = action === "dispatch"
    ? line.quantity - count(line.checkedOutQty)
    : count(line.checkedOutQty) - count(line.returnedGoodQty) - count(line.returnedDamagedQty) - count(line.missingQty) - count(line.pendingInspectionQty);
  if (available <= 0) return { error: action === "dispatch" ? "اكتمل تسليم هذه المعدة." : "لا توجد كمية متبقية لدى العميل لهذه المعدة." };
  return { productId: line.productId };
}
