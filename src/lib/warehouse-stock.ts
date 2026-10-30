/**
 * Multi-warehouse rules shared by the server, the admin UI and the tests.
 *
 * products.stock and asset_quantity_profiles stay the COMPANY figures, written by every
 * existing stock path. warehouse_stock holds what each NON-main warehouse has, and the main
 * warehouse owns the remainder. A path that knows nothing about warehouses therefore moves
 * main-warehouse stock, and the company total can never double or drift.
 */
import { normalizeQuantityLine } from "./quantity-assets";

export const WAREHOUSE_BUCKETS = ["inWarehouse", "checkedOut", "damaged", "maintenance", "missing"] as const;
export type WarehouseBucket = (typeof WAREHOUSE_BUCKETS)[number];
export type WarehouseBuckets = Record<WarehouseBucket, number>;
export type WarehouseDelta = { warehouseId: number } & Partial<WarehouseBuckets>;
export type WarehouseRef = { id: number; name: string; code?: string | null; isActive?: boolean };
export type WarehouseShare = WarehouseBuckets & { warehouseId: number; name: string; code: string | null; isMain: boolean; isActive: boolean; total: number };

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const finite = (value: unknown) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
};

export const EMPTY_WAREHOUSE_BUCKETS: WarehouseBuckets = { inWarehouse: 0, checkedOut: 0, damaged: 0, maintenance: 0, missing: 0 };

export function bucketsTotal(buckets: WarehouseBuckets) {
  return round3(WAREHOUSE_BUCKETS.reduce((sum, key) => sum + finite(buckets[key]), 0));
}

/**
 * Splits company figures across warehouses. `overdrawn` reports units that other warehouses
 * claim beyond the company figure: the main share shows 0 and the gap is surfaced, never hidden.
 */
export function warehouseBreakdown(input: {
  company: WarehouseBuckets;
  rows: Array<{ warehouseId: number } & Partial<WarehouseBuckets>>;
  warehouses: WarehouseRef[];
  mainId: number;
}): { shares: WarehouseShare[]; overdrawn: WarehouseBuckets } {
  const byWarehouse = new Map(input.rows.filter((row) => row.warehouseId !== input.mainId).map((row) => [row.warehouseId, row]));
  const overdrawn = { ...EMPTY_WAREHOUSE_BUCKETS };
  const mainShare = { ...EMPTY_WAREHOUSE_BUCKETS };
  for (const key of WAREHOUSE_BUCKETS) {
    const others = [...byWarehouse.values()].reduce((sum, row) => sum + finite(row[key]), 0);
    const remainder = round3(finite(input.company[key]) - others);
    mainShare[key] = Math.max(0, remainder);
    overdrawn[key] = Math.max(0, round3(-remainder));
  }
  const shares = input.warehouses.map((warehouse) => {
    const isMain = warehouse.id === input.mainId;
    const row = byWarehouse.get(warehouse.id);
    const buckets: WarehouseBuckets = isMain
      ? mainShare
      : { inWarehouse: round3(finite(row?.inWarehouse)), checkedOut: finite(row?.checkedOut), damaged: finite(row?.damaged), maintenance: finite(row?.maintenance), missing: finite(row?.missing) };
    return { warehouseId: warehouse.id, name: warehouse.name, code: warehouse.code ?? null, isMain, isActive: warehouse.isActive !== false, ...buckets, total: bucketsTotal(buckets) };
  });
  return { shares, overdrawn };
}

/**
 * One operation's per-warehouse changes. Each bucket's deltas must add up to the company change,
 * so a transfer nets to zero and an adjustment cannot move units that no warehouse accounts for.
 */
export function assertDeltasMatchCompany(deltas: WarehouseDelta[], before: WarehouseBuckets, after: WarehouseBuckets) {
  for (const key of WAREHOUSE_BUCKETS) {
    const sum = round3(deltas.reduce((total, delta) => total + finite(delta[key]), 0));
    const company = round3(finite(after[key]) - finite(before[key]));
    if (sum !== company) return `فرق ${key}: المخازن ${sum}، الشركة ${company}`;
  }
  return null;
}

export type TransferPlan =
  | { ok: true; deltas: [WarehouseDelta, WarehouseDelta] }
  | { ok: false; message: string; status: number };

/** Moves shelf units only; the company figure never changes. Commitments stay coverable at the source. */
export function planWarehouseTransfer(input: {
  fromWarehouseId: number | null;
  toWarehouseId: number | null;
  quantity: number;
  sourceShelf: number;
  sourceCommitted?: number;
  sourceUsable?: number;
  unit?: string;
}): TransferPlan {
  const unit = input.unit || "قطعة";
  const quantity = finite(input.quantity);
  if (!input.fromWarehouseId || !input.toWarehouseId) return { ok: false, message: "اختر المخزن المصدر والمخزن المستلم", status: 422 };
  if (input.fromWarehouseId === input.toWarehouseId) return { ok: false, message: "المخزن المصدر والمستلم يجب أن يكونا مختلفين", status: 422 };
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, message: "أدخل كمية صحيحة أكبر من صفر", status: 422 };
  if (quantity > input.sourceShelf)
    return { ok: false, message: `الكمية غير متوفرة في المخزن المصدر. المتاح ${input.sourceShelf} ${unit}، والمطلوب ${quantity} ${unit}.`, status: 409 };
  const usable = input.sourceUsable ?? input.sourceShelf;
  const committed = input.sourceCommitted ?? 0;
  if (usable - quantity < committed)
    return { ok: false, message: `لا يمكن تحويل ${quantity} ${unit}: ${committed} ${unit} محجوزة من هذا المخزن، والمتاح للتحويل ${Math.max(0, usable - committed)} ${unit}.`, status: 409 };
  return { ok: true, deltas: [{ warehouseId: input.fromWarehouseId, inWarehouse: -quantity }, { warehouseId: input.toWarehouseId, inWarehouse: quantity }] };
}

export type LineAllocation = { reserved: number; checkedOut: number; returned: number };
export type LineAllocations = Record<string, LineAllocation>;

const count = (value: unknown) => {
  const amount = Math.floor(finite(value));
  return amount > 0 ? amount : 0;
};

/** A booking line's units per source warehouse. A line saved before warehouses stays in its fallback. */
export function lineAllocations(raw: any, fallbackWarehouseId: number): LineAllocations {
  const stored = raw?.warehouseAllocations;
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const result: LineAllocations = {};
    for (const [key, value] of Object.entries(stored as Record<string, any>)) {
      if (!Number(key)) continue;
      result[key] = { reserved: count(value?.reserved), checkedOut: count(value?.checkedOut), returned: count(value?.returned) };
    }
    if (Object.keys(result).length) return result;
  }
  const line = normalizeQuantityLine(raw);
  const home = Number(raw?.warehouseId) || fallbackWarehouseId;
  return { [String(home)]: { reserved: line.reservedQty, checkedOut: line.checkedOutQty, returned: line.returnedGoodQty + line.returnedDamagedQty + line.missingQty } };
}

/** The same line as seen by one warehouse, in the shape the shared availability rules read. */
export function lineForWarehouse(raw: any, warehouseId: number, fallbackWarehouseId: number) {
  const allocation = lineAllocations(raw, fallbackWarehouseId)[String(warehouseId)];
  if (!allocation || (allocation.reserved === 0 && allocation.checkedOut === 0)) return null;
  return {
    productId: raw?.productId,
    trackingMode: "quantity",
    stage: raw?.stage,
    quantity: allocation.reserved,
    reservedQty: allocation.reserved,
    preparedQty: Math.min(count(raw?.preparedQty), allocation.reserved),
    checkedOutQty: allocation.checkedOut,
    returnedGoodQty: allocation.returned,
    returnedDamagedQty: 0,
    missingQty: 0,
  };
}

/** Takes a return out of the warehouses the units left from, oldest allocation first. */
export function consumeOutstanding(allocations: LineAllocations, quantity: number): Array<{ warehouseId: number; quantity: number }> {
  const taken: Array<{ warehouseId: number; quantity: number }> = [];
  let left = quantity;
  for (const [key, allocation] of Object.entries(allocations)) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, allocation.checkedOut - allocation.returned));
    if (take <= 0) continue;
    taken.push({ warehouseId: Number(key), quantity: take });
    left -= take;
  }
  if (left > 0) taken.push({ warehouseId: Number(Object.keys(allocations)[0]), quantity: left });
  return taken;
}

/** Keeps the warehouses' reservations equal to the line's total without touching units already out. */
export function rebalanceAllocations(allocations: LineAllocations, total: number, preferId: number): LineAllocations {
  const result: LineAllocations = {};
  for (const [key, value] of Object.entries(allocations)) result[key] = { ...value, reserved: Math.max(value.reserved, value.checkedOut) };
  const prefer = String(preferId);
  result[prefer] ??= { reserved: 0, checkedOut: 0, returned: 0 };
  const sum = () => Object.values(result).reduce((amount, value) => amount + value.reserved, 0);
  for (const [key, value] of Object.entries(result)) {
    if (key === prefer) continue;
    const excess = sum() - total;
    if (excess <= 0) break;
    value.reserved -= Math.min(excess, value.reserved - value.checkedOut);
  }
  const excess = sum() - total;
  if (excess > 0) result[prefer].reserved -= Math.min(excess, result[prefer].reserved - result[prefer].checkedOut);
  const missing = total - sum();
  if (missing > 0) result[prefer].reserved += missing;
  return result;
}

export const WAREHOUSE_MOVEMENT_LABELS: Record<string, string> = {
  warehouse_transfer_executed: "تحويل بين المخازن",
  warehouse_count_adjustment: "تسوية جرد مخزن",
};
