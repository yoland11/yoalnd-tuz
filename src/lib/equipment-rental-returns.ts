import { normalizeQuantityLine } from "./quantity-assets";
import type { EquipmentRentalAssetLine, EquipmentRentalDetail, EquipmentRentalDetails } from "./equipment-rentals";

/** Equipment rentals persist explicit counters even for individual assets. Use
 * legacy stage inference only for records that predate those counters. */
export function rentalReturnCounts(line: EquipmentRentalAssetLine) {
  const legacy = normalizeQuantityLine(line);
  const count = (value: unknown) => Math.max(0, Number(value ?? 0));
  const explicit = line.checkedOutQty != null;
  const dispatched = explicit ? count(line.checkedOutQty) : legacy.checkedOutQty;
  const good = explicit ? count(line.returnedGoodQty) : legacy.returnedGoodQty;
  const damaged = explicit ? count(line.returnedDamagedQty) : legacy.returnedDamagedQty;
  const missing = explicit ? count(line.missingQty) : legacy.missingQty;
  const pending = count(line.pendingInspectionQty);
  const previouslyReturned = good + damaged + pending;
  return { dispatched, good, damaged, missing, pending, previouslyReturned, outstanding: Math.max(0, dispatched - previouslyReturned - missing) };
}

export function canReturnEquipment(rental: EquipmentRentalDetail) {
  return rental.rentalKind === "equipment" && rental.capabilities.return &&
    !["draft", "pending_approval", "completed", "cancelled", "canceled", "closed"].includes(rental.status) &&
    rental.details.assets.some(line => rentalReturnCounts(line).outstanding > 0);
}

/** Older rentals recorded approved individual losses without closing custody. */
export function hasOpenRentalLoss(line: EquipmentRentalAssetLine) {
  return line.trackingMode !== "quantity" && line.stage === "out" && Number(line.missingQty) > 0;
}

export function rentalEquipmentStatus(details: EquipmentRentalDetails): string {
  const counts = details.assets.map(rentalReturnCounts);
  const allOut = details.assets.every((line, i) => counts[i].dispatched >= line.quantity);
  if (counts.some(c => c.outstanding > 0)) return counts.some(c => c.previouslyReturned + c.missing > 0) ? "partially_returned" : allOut ? "dispatched" : "partially_dispatched";
  if (counts.some(c => c.pending > 0)) return "inspection";
  if (details.assets.some(hasOpenRentalLoss)) return "partially_returned";
  if (!allOut) return counts.some(c => c.dispatched > 0) ? "partially_dispatched" : "confirmed";
  return counts.some(c => c.dispatched > 0) ? "returned" : "confirmed";
}
