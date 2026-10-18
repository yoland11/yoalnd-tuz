/** Source routes own the custody note they issued. A product ID or asset link
 * alone is not proof that a custody belongs to the request's booking/order. */
export function custodyReturnBelongsToSource(custody: { notes?: string | null } | null | undefined, expectedNote?: string): boolean {
  if (!custody) return false;
  if (expectedNote !== undefined) return custody.notes === expectedNote;
  // The standalone employee-custody route keeps untyped legacy records valid,
  // but must not close booking, fixed-custody or linked-order/shoot lifecycles.
  const note = String(custody.notes ?? "").trim();
  return !/^(?:(?:kosha_booking|service_order) #[1-9]\d*|حجز (?:kosha_booking|service_order) #[1-9]\d*|إخراج · .+ #[1-9]\d*)(?:$|\s)/u.test(note);
}

export function assetPassportHasCustodyHold(passport: { metadata?: unknown } | null | undefined): boolean {
  const metadata = passport?.metadata;
  return Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata)
    && ((metadata as Record<string, unknown>).inspectionBlocked === true || (metadata as Record<string, unknown>).damageHold === true));
}

/** Read DTOs expose an identity only for a single open issue owned by this source. */
export function sourceCustodyIds(rows: ReadonlyArray<{ id: number; productId: number; status: string; notes?: string | null }>, issueNote: string): Map<number, number> {
  const ids = new Map<number, number>();
  const seen = new Set<number>();
  for (const row of rows) {
    if (row.status !== "issued") continue;
    if (seen.has(row.productId)) { ids.delete(row.productId); continue; }
    seen.add(row.productId);
    if (row.notes === issueNote && Number.isSafeInteger(row.id) && row.id > 0) ids.set(row.productId, row.id);
  }
  return ids;
}
