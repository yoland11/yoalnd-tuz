type RentalScanLine = {
  productId: number;
  code?: string | null;
  scanCodes?: readonly string[];
  reservedQty?: number;
  quantity: number;
  checkedOutQty?: unknown;
  returnedGoodQty?: unknown;
  returnedDamagedQty?: unknown;
  missingQty?: unknown;
  pendingInspectionQty?: unknown;
};

export const rentalAssetCode = (productId: number) => "AJN-A" + String(productId).padStart(6, "0");

export function matchesRentalEquipment(query: string, line: RentalScanLine & { name: string }) {
  const term = query.trim().toLowerCase();
  return [line.name, line.code, rentalAssetCode(line.productId), ...(line.scanCodes ?? [])]
    .some(value => value?.toLowerCase().includes(term));
}

/** The code a scanner read, with an asset page URL reduced to its last path segment. */
export function normalizeRentalScanCode(raw: string) {
  let code = String(raw ?? "").trim();
  // Keep slashes inside ordinary barcodes; only extract a path from actual URLs.
  if (/^(?:https?:\/\/|\/assets\/|\/api\/qr\/)/i.test(code)) {
    code = code.split(/[?#]/)[0].split("/").filter(Boolean).at(-1) ?? "";
    // Decode the segment only: %2F, %3F and %23 can belong to the barcode itself.
    try { code = decodeURIComponent(code); } catch { /* Preserve literal malformed escapes. */ }
  }
  return code;
}

/** The product an AJN asset code names, as printed on its label; null for any other code. */
export function rentalAssetIdFromCode(code: string) {
  const id = /^AJN-A0*(\d+)(?:-[a-f\d]+)?$/i.exec(code)?.[1];
  return id == null ? null : Number(id);
}

/** Identification only: restrict matches to the current contract, never mutate custody. */
export function resolveRentalScan(raw: string, assets: readonly RentalScanLine[], action: "dispatch" | "return"): { productId: number } | { error: string } {
  const code = normalizeRentalScanCode(raw);
  const normalized = code.toLowerCase();
  const assetId = rentalAssetIdFromCode(code);
  const matches = normalized ? assets.filter(line =>
    ([line.code, ...(line.scanCodes ?? [])].some(alias => alias?.trim().toLowerCase() === normalized))
    || (assetId != null && line.productId === Number(assetId))) : [];
  if (!matches.length) return { error: "هذه المعدة غير موجودة في الإيجار الحالي." };
  if (matches.length !== 1) return { error: "الباركود مكرر بين معدات الإيجار؛ اختر المعدة يدوياً." };
  const line = matches[0];
  const count = (value: unknown) => Number(value || 0);
  const available = action === "dispatch"
    ? Math.min(line.quantity, line.reservedQty ?? line.quantity) - count(line.checkedOutQty)
    : count(line.checkedOutQty) - count(line.returnedGoodQty) - count(line.returnedDamagedQty) - count(line.missingQty) - count(line.pendingInspectionQty);
  if (available <= 0) return { error: action === "dispatch" ? "اكتمل تسليم هذه المعدة." : "لا توجد كمية متبقية لدى العميل لهذه المعدة." };
  return { productId: line.productId };
}
