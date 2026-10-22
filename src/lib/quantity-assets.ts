/**
 * Quantity-based asset rules shared by the server, the admin UI and the tests.
 *
 * Physical states are mutually exclusive and always add up to the total:
 *   inWarehouse (products.stock) + checkedOut + damaged + maintenance + missing.
 * Reservations are scheduling commitments against usable units for a booking day,
 * never extra physical units, so they are not part of the total.
 */

export const TRACKING_MODES = ["individual", "quantity"] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const TRACKING_MODE_LABELS: Record<TrackingMode, string> = {
  individual: "أصل فردي",
  quantity: "أصل متعدد الكمية",
};

export const DEFAULT_QUANTITY_UNIT = "قطعة";

export type QuantityBuckets = {
  inWarehouse: number;
  checkedOut: number;
  damaged: number;
  maintenance: number;
  missing: number;
};

const whole = (value: unknown) => {
  const amount = Math.floor(Number(value ?? 0));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

export function normalizeBuckets(input: Partial<Record<keyof QuantityBuckets, unknown>>): QuantityBuckets {
  return {
    inWarehouse: whole(input.inWarehouse),
    checkedOut: whole(input.checkedOut),
    damaged: whole(input.damaged),
    maintenance: whole(input.maintenance),
    missing: whole(input.missing),
  };
}

export function totalQuantity(buckets: QuantityBuckets) {
  return (
    buckets.inWarehouse +
    buckets.checkedOut +
    buckets.damaged +
    buckets.maintenance +
    buckets.missing
  );
}

/** Units that can serve bookings: on the shelf now or out and expected back. */
export function usableQuantity(buckets: QuantityBuckets) {
  return buckets.inWarehouse + buckets.checkedOut;
}

/** Booking-line stages after which nothing is scheduled any more. */
export const CLOSED_LINE_STAGES = ["returned", "inspection", "completed", "released"];
export const INACTIVE_BOOKING_STATUSES = [
  "cancelled",
  "canceled",
  "deleted",
  "completed",
  "delivered",
  "closed",
];

export type QuantityLine = {
  requiredQty: number;
  reservedQty: number;
  preparedQty: number;
  checkedOutQty: number;
  returnedGoodQty: number;
  returnedDamagedQty: number;
  missingQty: number;
  stage: string;
};

/**
 * Reads a booking asset line. Lines written by the quantity flow carry explicit
 * counters; an older individual line is interpreted from its stage so a legacy
 * record never becomes an invalid or negative quantity state.
 */
export function normalizeQuantityLine(raw: any): QuantityLine {
  const stage = String(raw?.stage ?? "linked");
  const quantity = Math.max(1, whole(raw?.quantity) || 1);
  if (raw?.trackingMode === "quantity") {
    const checkedOutQty = whole(raw.checkedOutQty);
    const returnedGoodQty = whole(raw.returnedGoodQty);
    const returnedDamagedQty = whole(raw.returnedDamagedQty);
    const missingQty = whole(raw.missingQty);
    return {
      requiredQty: whole(raw.quantity),
      reservedQty: whole(raw.reservedQty),
      preparedQty: whole(raw.preparedQty),
      checkedOutQty,
      returnedGoodQty,
      returnedDamagedQty,
      missingQty,
      stage,
    };
  }
  const returned = ["returned", "inspection", "completed"].includes(stage);
  const problemQty = Math.min(quantity, whole(raw?.problemQuantity ?? (raw?.problem && raw.problem !== "none" ? quantity : 0)));
  return {
    requiredQty: quantity,
    reservedQty: ["reserved", "picked", "out"].includes(stage) || returned ? quantity : 0,
    preparedQty: ["picked", "out"].includes(stage) || returned ? quantity : 0,
    checkedOutQty: stage === "out" || returned ? quantity : 0,
    returnedGoodQty: returned ? quantity - problemQty : 0,
    returnedDamagedQty: returned && raw?.problem === "damaged" ? problemQty : 0,
    missingQty: returned && raw?.problem === "missing" ? problemQty : 0,
    stage,
  };
}

export function lineReturnedQty(line: QuantityLine) {
  return line.returnedGoodQty + line.returnedDamagedQty + line.missingQty;
}

/** Units of this line that are physically outside the warehouse right now. */
export function lineOutstanding(line: QuantityLine) {
  return Math.max(0, line.checkedOutQty - lineReturnedQty(line));
}

/** Reserved units that have not left yet; a checked-out unit is never counted twice. */
export function lineReservedNotOut(line: QuantityLine, bookingStatus = "") {
  if (CLOSED_LINE_STAGES.includes(line.stage)) return 0;
  if (INACTIVE_BOOKING_STATUSES.includes(String(bookingStatus).toLowerCase())) return 0;
  return Math.max(0, line.reservedQty - line.checkedOutQty);
}

/**
 * Stage shown for a quantity line, derived from its counters. A line is "returned"
 * only when everything reserved went out and came back; units still reserved but
 * never taken keep the line open until it is inspected.
 */
export function quantityLineStage(line: QuantityLine, inspected = false) {
  if (inspected) return "completed";
  if (lineOutstanding(line) > 0) return "out";
  if (line.checkedOutQty > 0 && line.reservedQty <= line.checkedOutQty) return "returned";
  if (line.preparedQty > line.checkedOutQty) return "picked";
  if (line.reservedQty > 0) return "reserved";
  return "linked";
}

export type CommitmentRow = {
  source: string;
  bookingId: number;
  day: string | null;
  status: string;
  line: any;
};

const dayOf = (value: unknown) => {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

/**
 * A reservation without a saved period whose booking day has passed while
 * nothing was taken out: the event is over, so it no longer holds units (the
 * date-only rule in commitmentFor already ignores it). Rows with a saved period
 * are judged by that period; units still out always count.
 */
export function lapsedLegacyReservation(row: CommitmentRow & { interval?: unknown }, today: string) {
  if (row.interval) return false;
  const day = dayOf(row.day);
  return Boolean(day && day < today && lineOutstanding(normalizeQuantityLine(row.line)) === 0);
}

/**
 * How many units another booking line holds against `targetDay`.
 * - Reserved-but-not-out units count only when the booking is on the same day
 *   (bookings without a date are treated as overlapping, conservatively).
 * - Units physically out count unless that booking ends before the target day and
 *   is not overdue yet (its units are expected back in time).
 */
export function commitmentFor(row: CommitmentRow, targetDay: string | null, today: string) {
  const line = normalizeQuantityLine(row.line);
  const bookingDay = dayOf(row.day);
  const target = dayOf(targetDay);
  const overlaps = !bookingDay || !target || bookingDay === target;
  const reserved = overlaps ? lineReservedNotOut(line, row.status) : 0;
  const outstanding = lineOutstanding(line);
  const expectedBack = Boolean(
    bookingDay && target && bookingDay < target && bookingDay >= today,
  );
  return { reserved, out: expectedBack ? 0 : outstanding };
}

export type Availability = {
  usable: number;
  reserved: number;
  out: number;
  otherHolds: number;
  committed: number;
  available: number;
};

export function availabilityForDay(input: {
  buckets: QuantityBuckets;
  rows: CommitmentRow[];
  targetDay: string | null;
  today: string;
  otherHolds?: number;
  exclude?: { source: string; bookingId: number } | null;
}): Availability {
  let reserved = 0;
  let out = 0;
  for (const row of input.rows) {
    if (input.exclude && row.source === input.exclude.source && row.bookingId === input.exclude.bookingId) continue;
    const hold = commitmentFor(row, input.targetDay, input.today);
    reserved += hold.reserved;
    out += hold.out;
  }
  const usable = usableQuantity(input.buckets);
  const otherHolds = whole(input.otherHolds);
  const committed = reserved + out + otherHolds;
  return { usable, reserved, out, otherHolds, committed, available: Math.max(0, usable - committed) };
}

/** Units one line of THIS booking holds for its own day. */
export function ownHold(line: QuantityLine, bookingStatus = "") {
  return lineReservedNotOut(line, bookingStatus) + lineOutstanding(line);
}

export function insufficientQuantityMessage(available: number, requested: number, unit = DEFAULT_QUANTITY_UNIT) {
  return `الكمية المطلوبة غير متوفرة.\nالمتاح ${available} ${unit}، والمطلوب ${requested} ${unit}.`;
}

export type ReturnSplit = { good: number; damaged: number; missing: number };

/** A return must account for real units only: never more than what is still out. */
export function validateReturnSplit(line: QuantityLine, split: ReturnSplit, unit = DEFAULT_QUANTITY_UNIT) {
  const good = whole(split.good);
  const damaged = whole(split.damaged);
  const missing = whole(split.missing);
  const total = good + damaged + missing;
  const outstanding = lineOutstanding(line);
  if (total <= 0) return { ok: false as const, message: "أدخل كمية الإرجاع (سليم أو تالف أو مفقود)" };
  if (total > outstanding)
    return {
      ok: false as const,
      message: `لا يمكن إرجاع أكثر من الكمية الخارجة. الخارج حالياً ${outstanding} ${unit}، والمدخل ${total} ${unit}.`,
    };
  return { ok: true as const, good, damaged, missing, total, remaining: outstanding - total };
}

export const QUANTITY_ADJUSTMENT_KINDS = [
  "add",
  "reduce",
  "count",
  "damage",
  "loss",
  "send_maintenance",
  "repaired",
  "found",
  "write_off",
] as const;
export type QuantityAdjustmentKind = (typeof QUANTITY_ADJUSTMENT_KINDS)[number];

export const QUANTITY_ADJUSTMENT_LABELS: Record<QuantityAdjustmentKind, string> = {
  add: "إضافة كمية",
  reduce: "تخفيض كمية",
  count: "تصحيح جرد",
  damage: "تسجيل تلف",
  loss: "تسجيل فقدان",
  send_maintenance: "إرسال التالف للصيانة",
  repaired: "إكمال الصيانة وإرجاعها للمستودع",
  found: "العثور على قطع مفقودة",
  write_off: "شطب نهائي",
};

const QUANTITY_MOVEMENT_LABELS: Record<string, string> = {
  quantity_asset_checkout: "إخراج كمية لحجز",
  quantity_asset_return: "إرجاع كمية من حجز",
  quantity_asset_damage: "تلف كمية عند الإرجاع",
  quantity_asset_loss: "نقص كمية عند الإرجاع",
};

/** Arabic label for a quantity-asset ledger reason, or null for other reasons. */
export function quantityMovementLabel(reason: string): string | null {
  if (QUANTITY_MOVEMENT_LABELS[reason]) return QUANTITY_MOVEMENT_LABELS[reason];
  const kind = reason.startsWith("quantity_asset_") ? reason.slice("quantity_asset_".length) : "";
  return (QUANTITY_ADJUSTMENT_LABELS as Record<string, string>)[kind] ?? null;
}

/** Adjustments that change the total quantity; they need manager authority. */
export const TOTAL_CHANGING_ADJUSTMENTS: QuantityAdjustmentKind[] = ["add", "reduce", "count", "write_off"];

export type AdjustmentPlan =
  | { ok: false; message: string; status: number }
  | {
      ok: true;
      before: QuantityBuckets;
      after: QuantityBuckets;
      stockDelta: number;
      change: number;
      totalBefore: number;
      totalAfter: number;
      commitmentWarning: string | null;
    };

export function planQuantityAdjustment(input: {
  buckets: QuantityBuckets;
  kind: QuantityAdjustmentKind;
  quantity: number;
  countedQuantity?: number | null;
  writeOffFrom?: "damaged" | "missing" | "maintenance";
  /** Highest number of usable units committed on any upcoming day. */
  peakCommitment: number;
  unit?: string;
}): AdjustmentPlan {
  const unit = input.unit || DEFAULT_QUANTITY_UNIT;
  const before = { ...input.buckets };
  const after = { ...input.buckets };
  const q = whole(input.quantity);
  const need = (amount: number, available: number, label: string) =>
    amount > available
      ? `الكمية غير كافية في ${label}. المتاح ${available} ${unit}، والمطلوب ${amount} ${unit}.`
      : null;
  let problem: string | null = null;
  if (input.kind !== "count" && q <= 0) return { ok: false, message: "أدخل كمية صحيحة أكبر من صفر", status: 422 };
  switch (input.kind) {
    case "add":
      after.inWarehouse += q;
      break;
    case "reduce":
      problem = need(q, before.inWarehouse, "المستودع");
      after.inWarehouse -= q;
      break;
    case "count": {
      const counted = Math.floor(Number(input.countedQuantity));
      if (!Number.isFinite(counted) || counted < 0)
        return { ok: false, message: "أدخل الكمية المعدودة فعلياً في المستودع", status: 422 };
      if (counted === before.inWarehouse)
        return { ok: false, message: "الكمية المعدودة مطابقة للرصيد الحالي؛ لا يوجد فرق لتصحيحه", status: 409 };
      after.inWarehouse = counted;
      break;
    }
    case "damage":
      problem = need(q, before.inWarehouse, "المستودع");
      after.inWarehouse -= q;
      after.damaged += q;
      break;
    case "loss":
      problem = need(q, before.inWarehouse, "المستودع");
      after.inWarehouse -= q;
      after.missing += q;
      break;
    case "send_maintenance":
      problem = need(q, before.damaged, "التالف");
      after.damaged -= q;
      after.maintenance += q;
      break;
    case "repaired":
      problem = need(q, before.maintenance, "الصيانة");
      after.maintenance -= q;
      after.inWarehouse += q;
      break;
    case "found":
      problem = need(q, before.missing, "المفقود");
      after.missing -= q;
      after.inWarehouse += q;
      break;
    case "write_off": {
      const from = input.writeOffFrom ?? "damaged";
      const label = from === "missing" ? "المفقود" : from === "maintenance" ? "الصيانة" : "التالف";
      problem = need(q, before[from], label);
      after[from] -= q;
      break;
    }
  }
  if (problem) return { ok: false, message: problem, status: 409 };
  const usableAfter = usableQuantity(after);
  const shortage = Math.max(0, input.peakCommitment - usableAfter);
  // Administrative reductions may not break existing commitments. A physical
  // event (damage/loss) is still recorded, with a visible shortage warning.
  if (shortage > 0 && (input.kind === "reduce" || input.kind === "count"))
    return {
      ok: false,
      status: 409,
      message: `لا يمكن تخفيض الكمية دون الالتزامات الحالية. المحجوز أو الخارج ${input.peakCommitment} ${unit}، وسيبقى ${usableAfter} ${unit} فقط.`,
    };
  const totalBefore = totalQuantity(before);
  const totalAfter = totalQuantity(after);
  return {
    ok: true,
    before,
    after,
    stockDelta: after.inWarehouse - before.inWarehouse,
    change: totalAfter - totalBefore,
    totalBefore,
    totalAfter,
    commitmentWarning:
      shortage > 0
        ? `تنبيه: الحجوزات القادمة تحتاج ${input.peakCommitment} ${unit} والمتاح للاستخدام ${usableAfter} ${unit}. راجع الحجوزات المتأثرة.`
        : null,
  };
}

/**
 * Proportional valuation for units entering or leaving the total. Acquisition cost
 * and book value move together so existing depreciation ratios are preserved.
 */
export function adjustQuantityValuation(input: {
  purchasePrice: number;
  currentValue: number;
  totalBefore: number;
  totalAfter: number;
  unitCost: number;
}) {
  const purchase = Math.max(0, Number(input.purchasePrice) || 0);
  const current = Math.max(0, Number(input.currentValue) || 0);
  const delta = input.totalAfter - input.totalBefore;
  if (delta === 0) return { purchasePrice: purchase, currentValue: current };
  if (delta > 0) {
    const added = delta * Math.max(0, Number(input.unitCost) || 0);
    return { purchasePrice: round2(purchase + added), currentValue: round2(current + added) };
  }
  if (input.totalBefore <= 0) return { purchasePrice: purchase, currentValue: current };
  const keep = Math.max(0, input.totalAfter) / input.totalBefore;
  return { purchasePrice: round2(purchase * keep), currentValue: round2(current * keep) };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function lowAvailability(input: { available: number; total: number; minStock?: number | null }) {
  if (input.total <= 0) return false;
  const threshold = Math.max(Number(input.minStock ?? 0) || 0, Math.ceil(input.total * 0.2));
  return input.available <= threshold;
}
