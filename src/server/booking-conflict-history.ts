import { CLOSED_LINE_STAGES, lineOutstanding, lineReservedNotOut, lineReturnedQty, normalizeQuantityLine } from "@/lib/quantity-assets";
import { BookingResourceConflictError, resourceRows } from "./booking-resource-availability";

const counters = ["quantity", "requiredQty", "reservedQty", "preparedQty", "checkedOutQty", "returnedGoodQty", "returnedDamagedQty", "missingQty"];
// JSON counters may be numbers or serialized decimal integers, never booleans,
// empty text, arrays or objects that Number() would silently turn into 0/1.
const safeCount = (value: unknown): boolean =>
  (typeof value === "number" || typeof value === "string" && /^\d+$/.test(value)) &&
  Number.isSafeInteger(Number(value)) && Number(value) >= 0;

/** Optional legacy counters keep the original zero/default interpretation. */
export function hasSafeConflictQuantityCounters(raw: Record<string, unknown>): boolean {
  if (!counters.every(key => raw[key] == null || safeCount(raw[key]))) return false;
  if (raw.trackingMode !== "quantity") return true;
  const line = normalizeQuantityLine(raw), returned = lineReturnedQty(line);
  return Number.isSafeInteger(returned) && returned <= line.checkedOutQty;
}

/** Report-only retention. Unknown history still consumes the original live
 * evidence budget; neither status nor a planned return proves actual custody. */
export function readConflictQuantityHistory(result: unknown, productIds: number[]): any[] {
  const rows = (result as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) throw Error("Invalid quantity history database response");
  if (rows.length > 5000) throw new BookingResourceConflictError("سجلات المعدات التاريخية كثيرة؛ راجع سجل المستودع قبل تأكيد التوفر");
  const retained = [];
  for (const row of rows) {
    const raw = row?.line;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      !safeCount(raw.productId) || !productIds.includes(Number(raw.productId)) ||
      !safeCount(row.booking_id) || Number(row.booking_id) <= 0 ||
      !["kosha_booking", "service_order"].includes(row.source)) {
      throw Error("Invalid quantity commitment database response");
    }
    const supported = safeCount(raw.quantity) && Number(raw.quantity) > 0 && hasSafeConflictQuantityCounters(raw);
    if (raw.trackingMode === "quantity" && CLOSED_LINE_STAGES.includes(raw.stage) && supported) {
      const line = normalizeQuantityLine(raw);
      const returned = lineReturnedQty(line);
      if (Number.isSafeInteger(returned) && line.checkedOutQty === returned &&
        lineOutstanding(line) === 0 && lineReservedNotOut(line, String(row.status ?? "")) === 0) continue;
    }
    retained.push(row);
  }
  return resourceRows({ rows: retained });
}
