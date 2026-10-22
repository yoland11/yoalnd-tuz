import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { quantityPeriodAvailability, type PeriodCommitment } from "@/lib/quantity-asset-period";
import { readBookingResourceWindow,bookingResourceOccupancy } from "@/lib/booking-resource-window";
import { resourceOccupancyTimestamps, type ResourceOccupancy } from "@/lib/booking-resource-conflicts";
import {
  CLOSED_LINE_STAGES,
  DEFAULT_QUANTITY_UNIT,
  INACTIVE_BOOKING_STATUSES,
  QUANTITY_ADJUSTMENT_LABELS,
  adjustQuantityValuation,
  availabilityForDay,
  insufficientQuantityMessage,
  lineOutstanding,
  lineReservedNotOut,
  lowAvailability,
  normalizeBuckets,
  normalizeQuantityLine,
  ownHold,
  planQuantityAdjustment,
  quantityLineStage,
  totalQuantity,
  validateReturnSplit,
  type CommitmentRow,
  type QuantityAdjustmentKind,
  type QuantityBuckets,
  type QuantityLine,
} from "@/lib/quantity-assets";

/**
 * Quantity-based assets on top of the existing asset, warehouse and booking systems:
 * - warehouse units: products.stock, changed only together with a stock_movements row;
 * - units outside the warehouse: asset_quantity_profiles counters;
 * - reservations: the existing booking asset lines (bookingOperations.assets).
 * Every write runs inside the caller's transaction after the product row is locked,
 * so two users cannot commit the same units.
 */

export class QuantityAssetError extends Error {
  constructor(
    message: string,
    public status = 422,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "QuantityAssetError";
  }
}

type Executor = Pick<typeof db, "execute">;
type Actor = { id: number | null; name: string };

const BLOCKED_PROFILE_STATUSES = ["maintenance", "lost", "retired", "locked", "sold", "disposed"];

const rowsOf = (result: any): any[] => result?.rows ?? result ?? [];
const whole = (value: unknown) => {
  const amount = Math.floor(Number(value ?? 0));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};
const idList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
const textIdList = (ids: number[]) => sql.join(ids.map((id) => sql`${String(id)}`), sql`, `);

export function baghdadDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function bookingDay(value: unknown) {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

let schemaReady = false;

/** The feature is inert until the reviewed additive migration 0124 is applied. */
export async function quantityAssetsSchemaReady(executor: Executor = db) {
  if (schemaReady) return true;
  const result = await executor.execute(
    sql`select exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'asset_quantity_profiles') as ready`,
  );
  schemaReady = rowsOf(result)[0]?.ready === true;
  return schemaReady;
}

async function requireQuantitySchema(executor: Executor) {
  if (!(await quantityAssetsSchemaReady(executor)))
    throw new QuantityAssetError(
      "يلزم تطبيق ترقية قاعدة البيانات 0124_quantity_assets قبل استخدام الأصول متعددة الكمية",
      503,
    );
}

export type QuantityProfile = {
  productId: number;
  unit: string;
  checkedOut: number;
  damaged: number;
  maintenance: number;
  missing: number;
};

function profileFromRow(row: any): QuantityProfile {
  return {
    productId: Number(row.product_id),
    unit: String(row.unit_of_measure || DEFAULT_QUANTITY_UNIT),
    checkedOut: whole(row.quantity_checked_out),
    damaged: whole(row.quantity_damaged),
    maintenance: whole(row.quantity_maintenance),
    missing: whole(row.quantity_missing),
  };
}

/** Quantity-tracked products among `productIds`; every other asset is individual. */
export async function quantityProfilesFor(executor: Executor, productIds: number[]) {
  const ids = [...new Set(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const map = new Map<number, QuantityProfile>();
  if (!ids.length || !(await quantityAssetsSchemaReady(executor))) return map;
  const result = await executor.execute(
    sql`select product_id, unit_of_measure, quantity_checked_out, quantity_damaged, quantity_maintenance, quantity_missing from asset_quantity_profiles where tracking_mode = 'quantity' and product_id in (${idList(ids)})`,
  );
  for (const row of rowsOf(result)) map.set(Number(row.product_id), profileFromRow(row));
  return map;
}

export function bucketsOf(profile: QuantityProfile, stock: unknown): QuantityBuckets {
  return normalizeBuckets({
    inWarehouse: stock,
    checkedOut: profile.checkedOut,
    damaged: profile.damaged,
    maintenance: profile.maintenance,
    missing: profile.missing,
  });
}

type LockedQuantityAsset = {
  product: { id: number; name: string; stock: number; costPrice: number; minStock: number; isAsset: boolean };
  profile: QuantityProfile;
  assetProfile: { purchasePrice: number; currentValue: number; status: string; deleted: boolean } | null;
  warehouseId: number | null;
  buckets: QuantityBuckets;
};

/** Locks the product row (the same lock every stock writer takes) and the quantity row. */
export async function lockQuantityAsset(executor: Executor, productId: number): Promise<LockedQuantityAsset | null> {
  const productRows = rowsOf(
    await executor.execute(
      sql`select id, coalesce(name_ar, name) as name, stock, cost_price, min_stock, is_asset from products where id = ${productId} for update`,
    ),
  );
  const product = productRows[0];
  if (!product) throw new QuantityAssetError("الأصل غير موجود", 404);
  const quantityRows = rowsOf(
    await executor.execute(
      sql`select product_id, unit_of_measure, quantity_checked_out, quantity_damaged, quantity_maintenance, quantity_missing from asset_quantity_profiles where product_id = ${productId} and tracking_mode = 'quantity' for update`,
    ),
  );
  if (!quantityRows[0]) return null;
  const [assetRows, passportRows] = await Promise.all([
    executor.execute(
      sql`select purchase_price, current_value, status, deleted_at from asset_profiles where product_id = ${productId}`,
    ),
    executor.execute(sql`select warehouse_id from asset_passports where product_id = ${productId}`),
  ]);
  const asset = rowsOf(assetRows)[0];
  const profile = profileFromRow(quantityRows[0]);
  return {
    product: {
      id: Number(product.id),
      name: String(product.name ?? `#${productId}`),
      stock: Number(product.stock ?? 0),
      costPrice: Number(product.cost_price ?? 0),
      minStock: Number(product.min_stock ?? 0),
      isAsset: product.is_asset === true,
    },
    profile,
    assetProfile: asset
      ? {
          purchasePrice: Number(asset.purchase_price ?? 0),
          currentValue: Number(asset.current_value ?? 0),
          status: String(asset.status ?? "active"),
          deleted: Boolean(asset.deleted_at),
        }
      : null,
    warehouseId: Number(rowsOf(passportRows)[0]?.warehouse_id ?? 0) || null,
    buckets: bucketsOf(profile, product.stock),
  };
}

export type QuantityCommitmentRow = PeriodCommitment & { productId: number; customerName: string | null };

const assetsArray = (column: SQL) =>
  sql`(case when jsonb_typeof(${column}->'bookingOperations'->'assets') = 'array' then ${column}->'bookingOperations'->'assets' else '[]'::jsonb end)`;

/** Every non-archived booking line that references these products. */
export async function quantityCommitmentRows(executor: Executor, productIds: number[]) {
  const ids = [...new Set(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const map = new Map<number, QuantityCommitmentRow[]>();
  if (!ids.length) return map;
  const result = await executor.execute(sql`
    select 'kosha_booking' as source, b.id as booking_id, b.event_date::text as day, b.status, b.customer_name, a.value as line,
      b.booking_details->'bookingOperations'->'resourceWindow' as resource_window
    from kosha_bookings b
    cross join lateral jsonb_array_elements(${assetsArray(sql`b.booking_details`)}) as a(value)
    where b.archived_at is null and a.value->>'productId' in (${textIdList(ids)})
    union all
    select 'service_order', s.id, s.event_date::text, s.status, s.customer_name, a.value,
      s.custom_fields->'bookingOperations'->'resourceWindow'
    from service_orders s
    cross join lateral jsonb_array_elements(${assetsArray(sql`s.custom_fields`)}) as a(value)
    where s.archived_at is null and a.value->>'productId' in (${textIdList(ids)})
  `);
  if (!Array.isArray(result?.rows)) throw new Error("Invalid quantity commitment database response");
  for (const row of result.rows as any[]) {
    const line = row.line ?? {};
    const productId = Number(line.productId);
    if (!productId) continue;
    const window = readBookingResourceWindow({resourceWindow:row.resource_window}, row.day);
    map.set(productId, [
      ...(map.get(productId) ?? []),
      {
        productId,
        source: String(row.source),
        bookingId: Number(row.booking_id),
        day: bookingDay(row.day),
        status: String(row.status ?? ""),
        customerName: row.customer_name ?? null,
        line,
        interval: window ? {start:window.preparationStart,end:window.returnEnd} : null,
        hasResourceWindow: row.resource_window != null,
      },
    ]);
  }
  return map;
}

/** Product-level stock holds from the store-product reservation system (not date-aware). */
async function otherStockHolds(executor: Executor, productId: number, exclude?: { source: string; bookingId: number } | null) {
  const result = await executor.execute(
    exclude
      ? sql`select coalesce(sum(quantity), 0) as quantity from stock_reservations where product_id = ${productId} and status = 'reserved' and not (source_type = ${exclude.source} and source_id = ${exclude.bookingId})`
      : sql`select coalesce(sum(quantity), 0) as quantity from stock_reservations where product_id = ${productId} and status = 'reserved'`,
  );
  if (!Array.isArray(result?.rows) || !result.rows.length) throw new Error("Invalid quantity stock hold database response");
  return whole(result.rows[0].quantity);
}

/** Peak demand for administrative reductions. Preserve all-legacy day scheduling;
 * once periods exist, unknown legacy holds overlap conservatively. Physical out
 * units stay committed until returned, independent of a planned return date. */
export function peakCommitment(rows: (CommitmentRow & {interval?:ResourceOccupancy|null;hasResourceWindow?:boolean})[], buckets: QuantityBuckets, today: string, otherHolds = 0) {
  if(rows.some(row=>row.hasResourceWindow||row.interval)){
    const floor=Date.parse(`${today}T00:00:00+03:00`);
    const events:{at:number;delta:number}[]=[];
    let unknown=0,out=0;
    for(const row of rows){
      const line=normalizeQuantityLine(row.line);
      out+=lineOutstanding(line);
      const reserved=lineReservedNotOut(line,row.status);
      if(!reserved)continue;
      const period=resourceOccupancyTimestamps(row.interval??null);
      if(!period){unknown+=reserved;continue;}
      if(period[1]<=floor)continue;
      events.push({at:Math.max(floor,period[0]),delta:reserved},{at:period[1],delta:-reserved});
    }
    events.sort((a,b)=>a.at-b.at||a.delta-b.delta);
    // Do not hide unmatched real checkout evidence or count it twice.
    let current=Math.max(out,buckets.checkedOut)+unknown+otherHolds,peak=current;
    for(const event of events){current+=event.delta;peak=Math.max(peak,current);}
    return peak;
  }
  const days = new Set<string>([today]);
  for (const row of rows) if (row.day && row.day >= today) days.add(row.day);
  let peak = 0;
  for (const day of days)
    peak = Math.max(peak, availabilityForDay({ buckets, rows, targetDay: day, today, otherHolds }).committed);
  return peak;
}

export async function quantityAvailability(
  executor: Executor,
  input: { productId: number; day: string | null; exclude?: { source: string; bookingId: number } | null; buckets: QuantityBuckets; interval?:ResourceOccupancy|null },
) {
  const [rowsMap, holds] = await Promise.all([
    quantityCommitmentRows(executor, [input.productId]),
    otherStockHolds(executor, input.productId, input.exclude),
  ]);
  const rows = rowsMap.get(input.productId) ?? [];
  if (input.interval !== undefined) {
    const source=input.exclude?.source === "kosha_booking" ? "kosha" : input.exclude?.source === "service_order" ? "service" : null;
    if(!source || !input.exclude)throw new QuantityAssetError("يلزم تحديد الحجز الأصلي لفحص فترة المعدات",422);
    const result=quantityPeriodAvailability({booking:{source,id:input.exclude.bookingId},buckets:input.buckets,rows,interval:input.interval,otherHolds:holds});
    if(!result.complete || !result.availability)throw new QuantityAssetError("لا يمكن تأكيد التوفر: راجع فترات الحجوزات المرتبطة وتطابق الكميات الخارجة قبل الحجز",409);
    return {rows,otherHolds:holds,availability:result.availability};
  }
  const today = baghdadDay();
  return {
    rows,
    otherHolds: holds,
    availability: availabilityForDay({
      buckets: input.buckets,
      rows,
      targetDay: input.day,
      today,
      otherHolds: holds,
      exclude: input.exclude ?? null,
    }),
  };
}

async function movementExists(executor: Executor, key: string) {
  const result = await executor.execute(
    sql`select id from stock_movements where idempotency_key = ${key} limit 1`,
  );
  return rowsOf(result).length > 0;
}

async function insertMovement(
  executor: Executor,
  input: {
    productId: number;
    quantityChange: number;
    reason: string;
    relatedType: string;
    relatedId: number;
    warehouseId: number | null;
    idempotencyKey: string | null;
    metadata: Record<string, unknown>;
    actor: Actor;
  },
) {
  await executor.execute(sql`
    insert into stock_movements (product_id, stock_source_product_id, quantity_change, reason, related_type, related_id, warehouse_id, movement_type, idempotency_key, metadata, created_by, created_by_name)
    values (${input.productId}, ${input.productId}, ${String(input.quantityChange)}, ${input.reason}, ${input.relatedType}, ${input.relatedId}, ${input.warehouseId}, 'quantity_asset', ${input.idempotencyKey}, ${JSON.stringify(input.metadata)}::jsonb, ${input.actor.id}, ${input.actor.name})
  `);
}

async function changeWarehouseStock(executor: Executor, productId: number, delta: number) {
  if (delta === 0) return;
  const updated = rowsOf(
    await executor.execute(
      sql`update products set stock = stock::numeric + ${delta}, updated_at = now() where id = ${productId} and stock::numeric + ${delta} >= 0 returning stock`,
    ),
  );
  if (!updated.length)
    throw new QuantityAssetError("رصيد المستودع لا يكفي لتنفيذ الحركة", 409);
}

/** warehouse_stock is the existing per-warehouse mirror of the asset's home warehouse. */
async function mirrorWarehouseStock(executor: Executor, warehouseId: number | null, productId: number, delta: number) {
  if (!warehouseId || delta === 0) return;
  await executor.execute(sql`
    insert into warehouse_stock (warehouse_id, product_id, quantity, updated_at)
    values (${warehouseId}, ${productId}, ${Math.max(0, delta)}, now())
    on conflict (warehouse_id, product_id) do update
    set quantity = greatest(0, warehouse_stock.quantity::numeric + ${delta}), updated_at = now()
  `);
}

async function writeBuckets(executor: Executor, productId: number, buckets: QuantityBuckets) {
  await executor.execute(sql`
    update asset_quantity_profiles
    set quantity_checked_out = ${buckets.checkedOut}, quantity_damaged = ${buckets.damaged},
        quantity_maintenance = ${buckets.maintenance}, quantity_missing = ${buckets.missing}, updated_at = now()
    where product_id = ${productId}
  `);
}

async function assetTimeline(
  executor: Executor,
  input: { entityType: string; entityId: number; type: string; title: string; body?: string | null; actor: Actor; metadata: Record<string, unknown> },
) {
  await executor.execute(sql`
    insert into entity_timeline (entity_type, entity_id, type, title, body, actor_id, actor_name, metadata)
    values (${input.entityType}, ${input.entityId}, ${input.type}, ${input.title}, ${input.body ?? null}, ${input.actor.id}, ${input.actor.name}, ${JSON.stringify(input.metadata)}::jsonb)
  `);
}

// ─── Booking lines ──────────────────────────────────────────────────────────

export type QuantityBookingInput = {
  mode: "link" | "unlink" | "reserve" | "pick" | "checkout" | "return" | "inspect";
  productId: number;
  quantity: number;
  problem: "none" | "damaged" | "missing";
  description?: string;
  estimatedCost: number;
  photoUrls: string[];
  managerApproval: boolean;
  scannedCode?: string;
  requestId?: string;
  goodQuantity?: number;
  damagedQuantity?: number;
  missingQuantity?: number;
  warehouseId?: number;
  vehicle?: string;
  note?: string;
  usageHours?: number;
};

export type QuantityBookingReference = {
  source: string;
  entityType: string;
  id: number;
  eventDate: string | null;
  status: string;
  customerName: string;
  operations: Record<string, any>;
  details: Record<string, any>;
};

const MODE_TITLES: Record<QuantityBookingInput["mode"], string> = {
  link: "تمت إضافة أصل متعدد الكمية للحجز",
  unlink: "تمت إزالة أصل متعدد الكمية من الحجز",
  reserve: "تم حجز كمية من الأصل",
  pick: "تم تجهيز كمية من الأصل",
  checkout: "خرجت كمية من الأصل من المستودع",
  return: "تم إرجاع كمية من الأصل",
  inspect: "اكتمل فحص كمية الأصل",
};

export function quantityLineSummary(raw: any) {
  const line = normalizeQuantityLine(raw);
  return {
    required: line.requiredQty,
    reserved: line.reservedQty,
    prepared: line.preparedQty,
    checkedOut: line.checkedOutQty,
    outstanding: lineOutstanding(line),
    returnedGood: line.returnedGoodQty,
    damaged: line.returnedDamagedQty,
    missing: line.missingQty,
    returned: line.returnedGoodQty + line.returnedDamagedQty + line.missingQty,
    stage: raw?.stage === "completed" ? "completed" : quantityLineStage(line),
  };
}

/** Units one booking line holds for its own day (same rule the availability check uses). */
export function quantityLineHold(raw: any, bookingStatus = "") {
  return ownHold(normalizeQuantityLine(raw), bookingStatus);
}

/**
 * One booking action for a quantity asset. The caller has already locked the booking
 * row and the product row in this transaction and supplies `saveOperations`, the
 * canonical booking JSON writer.
 */
export async function executeQuantityBookingAction(
  executor: Executor,
  input: {
    reference: QuantityBookingReference;
    action: QuantityBookingInput;
    actor: Actor;
    saveOperations: (operations: Record<string, any>) => Promise<void>;
  },
) {
  const { reference, action, actor } = input;
  const locked = await lockQuantityAsset(executor, action.productId);
  if (!locked) throw new QuantityAssetError("الأصل ليس متعدد الكمية", 409);
  const unit = locked.profile.unit;
  const bookingRef = { source: reference.entityType, bookingId: reference.id };
  const requestKey = action.requestId ? `qasset:${action.productId}:${action.requestId}` : null;
  if (requestKey && ["checkout", "return"].includes(action.mode) && (await movementExists(executor, requestKey)))
    return { ok: true, replayed: true, productId: action.productId, name: locked.product.name };

  const bookingStatus = String(reference.status ?? "").toLowerCase();
  if (["reserve", "pick", "checkout"].includes(action.mode)) {
    if (INACTIVE_BOOKING_STATUSES.includes(bookingStatus))
      throw new QuantityAssetError("لا يمكن حجز أو إخراج معدات لحجز ملغي أو مكتمل", 409);
    if (locked.assetProfile && BLOCKED_PROFILE_STATUSES.includes(locked.assetProfile.status))
      throw new QuantityAssetError(`حالة الأصل (${locked.assetProfile.status}) تمنع الحجز`, 423);
  }

  const assets: any[] = Array.isArray(reference.operations.assets) ? [...reference.operations.assets] : [];
  const index = assets.findIndex((item) => Number(item?.productId) === action.productId);
  const currentRaw = index >= 0 ? assets[index] : null;
  const line: QuantityLine = currentRaw
    ? normalizeQuantityLine(currentRaw)
    : normalizeQuantityLine({ trackingMode: "quantity", quantity: action.quantity, stage: "linked" });
  const now = new Date().toISOString();
  const quantity = whole(action.quantity);
  const day = bookingDay(reference.eventDate);
  const today = baghdadDay();
  const interval = bookingResourceOccupancy(reference.operations,reference.eventDate);
  const buckets = { ...locked.buckets };
  let warning: string | null = null;
  let stockDelta = 0;
  let movement: { reason: string; metadata: Record<string, unknown> } | null = null;
  const extraMovements: Array<{ reason: string; key: string; metadata: Record<string, unknown> }> = [];
  const next: QuantityLine = { ...line };
  const warehouseId = action.warehouseId ?? locked.warehouseId;

  const availabilityFor = async (holdNeeded: number) => {
    const { availability } = await quantityAvailability(executor, {
      productId: action.productId,
      day,
      exclude: bookingRef,
      buckets,
      interval,
    });
    if (holdNeeded > availability.available)
      throw new QuantityAssetError(insufficientQuantityMessage(availability.available, holdNeeded, unit), 409, {
        available: availability.available,
        requested: holdNeeded,
        unit,
      });
    return availability;
  };

  switch (action.mode) {
    case "link":
      next.requiredQty = Math.max(quantity, 1);
      break;
    case "reserve": {
      if (quantity < line.checkedOutQty)
        throw new QuantityAssetError(
          `لا يمكن أن تقل الكمية المحجوزة عن الكمية الخارجة لهذا الحجز (${line.checkedOutQty} ${unit})`,
          409,
        );
      next.requiredQty = quantity;
      next.reservedQty = quantity;
      next.preparedQty = Math.min(next.preparedQty, quantity);
      next.stage = quantityLineStage(next);
      await availabilityFor(ownHold(next, bookingStatus));
      break;
    }
    case "pick": {
      if (line.reservedQty <= 0) throw new QuantityAssetError("احجز الكمية قبل التجهيز", 409);
      if (quantity > line.reservedQty)
        throw new QuantityAssetError(
          `لا يمكن تجهيز أكثر من الكمية المحجوزة (${line.reservedQty} ${unit})`,
          409,
        );
      next.preparedQty = Math.max(quantity, line.checkedOutQty);
      if (interval !== undefined) await availabilityFor(ownHold(next, bookingStatus));
      break;
    }
    case "checkout": {
      if (quantity > buckets.inWarehouse)
        throw new QuantityAssetError(
          `الكمية غير متوفرة في المستودع.\nالمتاح ${buckets.inWarehouse} ${unit}، والمطلوب ${quantity} ${unit}.`,
          409,
          { available: buckets.inWarehouse, requested: quantity, unit },
        );
      next.checkedOutQty = line.checkedOutQty + quantity;
      if (next.checkedOutQty > next.reservedQty) {
        // Checking out beyond the reservation extends it, under the same availability rule.
        next.reservedQty = next.checkedOutQty;
        next.requiredQty = Math.max(next.requiredQty, next.reservedQty);
        next.stage = quantityLineStage(next);
      }
      if (next.checkedOutQty > line.reservedQty || interval !== undefined)
        await availabilityFor(ownHold(next, bookingStatus));
      next.preparedQty = Math.max(next.preparedQty, next.checkedOutQty);
      stockDelta = -quantity;
      buckets.inWarehouse -= quantity;
      buckets.checkedOut += quantity;
      movement = {
        reason: "quantity_asset_checkout",
        metadata: {
          action: "checkout",
          quantity,
          bookingType: reference.entityType,
          bookingId: reference.id,
          vehicle: action.vehicle ?? null,
          note: action.note ?? null,
          scannedCode: action.scannedCode ?? null,
        },
      };
      break;
    }
    case "return": {
      const hasSplit = [action.goodQuantity, action.damagedQuantity, action.missingQuantity].some((value) => value !== undefined);
      const split = hasSplit
        ? { good: whole(action.goodQuantity), damaged: whole(action.damagedQuantity), missing: whole(action.missingQuantity) }
        : action.problem === "damaged"
          ? { good: 0, damaged: quantity, missing: 0 }
          : action.problem === "missing"
            ? { good: 0, damaged: 0, missing: quantity }
            : { good: quantity, damaged: 0, missing: 0 };
      const checked = validateReturnSplit(line, split, unit);
      if (!checked.ok) throw new QuantityAssetError(checked.message, 409);
      if ((checked.damaged > 0 || checked.missing > 0) && !String(action.description ?? "").trim())
        throw new QuantityAssetError("اكتب وصف التلف أو النقص", 422);
      if (checked.missing > 0 && !action.managerApproval)
        throw new QuantityAssetError("تسجيل النقص يتطلب اعتماد المدير", 422);
      if (buckets.checkedOut < checked.total)
        throw new QuantityAssetError("رصيد الكمية الخارجة لا يطابق الإرجاع؛ راجع حركات الأصل", 409);
      next.returnedGoodQty += checked.good;
      next.returnedDamagedQty += checked.damaged;
      next.missingQty += checked.missing;
      stockDelta = checked.good;
      buckets.checkedOut -= checked.total;
      buckets.inWarehouse += checked.good;
      buckets.damaged += checked.damaged;
      buckets.missing += checked.missing;
      const details = {
        bookingType: reference.entityType,
        bookingId: reference.id,
        description: action.description ?? null,
        estimatedCost: action.estimatedCost,
        photoUrls: action.photoUrls,
        managerApproval: action.managerApproval,
      };
      movement = {
        reason: "quantity_asset_return",
        metadata: { action: "return", good: checked.good, damaged: checked.damaged, missing: checked.missing, remainingOut: checked.remaining, ...details },
      };
      const baseKey = requestKey ?? `qasset:${action.productId}:${reference.entityType}:${reference.id}:${now}`;
      if (checked.damaged > 0)
        extraMovements.push({ reason: "quantity_asset_damage", key: `${baseKey}:damaged`, metadata: { action: "return_damaged", quantity: checked.damaged, ...details } });
      if (checked.missing > 0)
        extraMovements.push({ reason: "quantity_asset_loss", key: `${baseKey}:missing`, metadata: { action: "return_missing", quantity: checked.missing, ...details } });
      break;
    }
    case "inspect":
      if (line.checkedOutQty <= 0 || lineOutstanding(line) > 0)
        throw new QuantityAssetError("يجب تسجيل إرجاع كامل الكمية الخارجة قبل الفحص", 409);
      break;
    case "unlink":
      if (line.checkedOutQty > 0)
        throw new QuantityAssetError("لا يمكن إزالة أصل خرجت منه كميات ضمن هذا الحجز؛ أكمل الإرجاع والفحص", 409);
      break;
  }

  const history = Array.isArray(currentRaw?.quantityHistory) ? currentRaw.quantityHistory.slice(-49) : [];
  const nextRaw = {
    ...(currentRaw ?? {}),
    productId: action.productId,
    trackingMode: "quantity",
    unit,
    quantity: next.requiredQty,
    reservedQty: next.reservedQty,
    preparedQty: next.preparedQty,
    checkedOutQty: next.checkedOutQty,
    returnedGoodQty: next.returnedGoodQty,
    returnedDamagedQty: next.returnedDamagedQty,
    missingQty: next.missingQty,
    stage: action.mode === "inspect" ? "completed" : quantityLineStage(next),
    updatedAt: now,
    ...(action.mode === "reserve" ? { reservedAt: now } : {}),
    ...(action.mode === "pick" ? { pickedAt: now, scannedCode: action.scannedCode ?? null } : {}),
    ...(action.mode === "checkout" ? { checkedOutAt: now, scannedCode: action.scannedCode ?? null } : {}),
    ...(action.mode === "return" ? { returnedAt: now, description: action.description ?? null, estimatedCost: action.estimatedCost } : {}),
    ...(action.mode === "inspect" ? { inspectedAt: now, usageHours: action.usageHours ?? null } : {}),
    quantityHistory: [
      ...history,
      { at: now, mode: action.mode, quantity, by: actor.name, ...(movement?.metadata ?? {}) },
    ],
  };
  if (action.mode === "unlink") {
    if (index >= 0) assets.splice(index, 1);
  } else if (index >= 0) assets[index] = nextRaw;
  else assets.push(nextRaw);

  if (stockDelta !== 0) await changeWarehouseStock(executor, action.productId, stockDelta);
  if (movement) {
    await writeBuckets(executor, action.productId, buckets);
    await mirrorWarehouseStock(executor, warehouseId, action.productId, stockDelta);
    await insertMovement(executor, {
      productId: action.productId,
      quantityChange: stockDelta,
      reason: movement.reason,
      relatedType: reference.entityType,
      relatedId: reference.id,
      warehouseId,
      idempotencyKey: requestKey,
      metadata: { ...movement.metadata, before: locked.buckets, after: buckets, unit },
      actor,
    });
    for (const extra of extraMovements)
      await insertMovement(executor, {
        productId: action.productId,
        quantityChange: 0,
        reason: extra.reason,
        relatedType: reference.entityType,
        relatedId: reference.id,
        warehouseId,
        idempotencyKey: extra.key,
        metadata: { ...extra.metadata, before: locked.buckets, after: buckets, unit },
        actor,
      });
  }
  const operations = { ...reference.operations, assets };
  await input.saveOperations(operations);
  const summary = quantityLineSummary(nextRaw);
  await assetTimeline(executor, {
    entityType: reference.entityType,
    entityId: reference.id,
    type: `booking_quantity_asset_${action.mode}`,
    title: MODE_TITLES[action.mode],
    body: `${locked.product.name} · ${quantity} ${unit}`,
    actor,
    metadata: { productId: action.productId, quantity, line: summary },
  });
  await assetTimeline(executor, {
    entityType: "asset",
    entityId: action.productId,
    type: `quantity_booking_${action.mode}`,
    title: MODE_TITLES[action.mode],
    body: `حجز #${reference.id} · ${reference.customerName} · ${quantity} ${unit}`,
    actor,
    metadata: { bookingType: reference.entityType, bookingId: reference.id, quantity, before: locked.buckets, after: buckets },
  });
  if (action.mode === "reserve" || action.mode === "checkout") {
    const remaining = await quantityAvailability(executor, { productId: action.productId, day, exclude: null, buckets });
    if (remaining.availability.available === 0) warning = "تم استخدام كامل الكمية المتاحة لهذا التاريخ.";
  }
  return {
    ok: true,
    replayed: false,
    productId: action.productId,
    name: locked.product.name,
    trackingMode: "quantity" as const,
    unit,
    line: summary,
    buckets,
    damaged: movement?.reason === "quantity_asset_return" ? Number((movement.metadata as any).damaged ?? 0) : 0,
    missing: movement?.reason === "quantity_asset_return" ? Number((movement.metadata as any).missing ?? 0) : 0,
    warning,
  };
}

// ─── Adjustments ────────────────────────────────────────────────────────────

export async function adjustQuantityAsset(
  executor: Executor,
  input: {
    productId: number;
    kind: QuantityAdjustmentKind;
    quantity: number;
    countedQuantity?: number | null;
    writeOffFrom?: "damaged" | "missing" | "maintenance";
    unitCost?: number | null;
    reason: string;
    relatedType?: string | null;
    relatedId?: number | null;
    /** Free notes, the employee responsible (count, damage, loss) and evidence photos. */
    notes?: string | null;
    responsibleStaffId?: number | null;
    photos?: string[];
    /** Damage/loss found after the booking's return was already recorded. */
    additionalToReturn?: boolean;
    requestId: string;
    actor: Actor;
  },
) {
  await requireQuantitySchema(executor);
  const locked = await lockQuantityAsset(executor, input.productId);
  if (!locked) throw new QuantityAssetError("الأصل ليس متعدد الكمية", 409);
  const key = `qasset:${input.productId}:${input.requestId}`;
  if (await movementExists(executor, key))
    return { ok: true, replayed: true, productId: input.productId, buckets: locked.buckets, total: totalQuantity(locked.buckets) };
  const [rowsMap, holds] = await Promise.all([
    quantityCommitmentRows(executor, [input.productId]),
    otherStockHolds(executor, input.productId, null),
  ]);
  const today = baghdadDay();
  const peak = peakCommitment(rowsMap.get(input.productId) ?? [], locked.buckets, today, holds);
  const guards = await adjustmentGuards(executor, input);
  const plan = planQuantityAdjustment({
    buckets: locked.buckets,
    kind: input.kind,
    quantity: input.quantity,
    countedQuantity: input.countedQuantity,
    writeOffFrom: input.writeOffFrom,
    peakCommitment: peak,
    unit: locked.profile.unit,
  });
  if (!plan.ok) throw new QuantityAssetError(plan.message, plan.status);
  const unitCost = input.unitCost != null && Number(input.unitCost) >= 0 ? Number(input.unitCost) : locked.product.costPrice;
  const valuationBefore = locked.assetProfile
    ? { purchasePrice: locked.assetProfile.purchasePrice, currentValue: locked.assetProfile.currentValue }
    : null;
  const valuationAfter =
    valuationBefore && !locked.assetProfile?.deleted && plan.change !== 0
      ? adjustQuantityValuation({ ...valuationBefore, totalBefore: plan.totalBefore, totalAfter: plan.totalAfter, unitCost })
      : valuationBefore;

  await changeWarehouseStock(executor, input.productId, plan.stockDelta);
  await writeBuckets(executor, input.productId, plan.after);
  await mirrorWarehouseStock(executor, locked.warehouseId, input.productId, plan.stockDelta);
  if (valuationBefore && valuationAfter && (valuationAfter.purchasePrice !== valuationBefore.purchasePrice || valuationAfter.currentValue !== valuationBefore.currentValue))
    await executor.execute(sql`
      update asset_profiles set purchase_price = ${String(valuationAfter.purchasePrice)}, current_value = ${String(valuationAfter.currentValue)}, updated_at = now()
      where product_id = ${input.productId}
    `);
  const label = QUANTITY_ADJUSTMENT_LABELS[input.kind];
  const metadata = {
    action: "adjustment",
    kind: input.kind,
    label,
    quantity: whole(input.quantity),
    countedQuantity: input.countedQuantity ?? null,
    writeOffFrom: input.kind === "write_off" ? (input.writeOffFrom ?? "damaged") : null,
    reason: input.reason,
    document: input.relatedType && input.relatedId ? { type: input.relatedType, id: input.relatedId } : null,
    notes: input.notes?.trim() || null,
    responsible: guards.responsible,
    photos: guards.photos,
    additionalToReturn: input.additionalToReturn === true,
    before: plan.before,
    after: plan.after,
    totalBefore: plan.totalBefore,
    totalAfter: plan.totalAfter,
    change: plan.change,
    unitCost,
    valuationBefore,
    valuationAfter,
    unit: locked.profile.unit,
  };
  await insertMovement(executor, {
    productId: input.productId,
    quantityChange: plan.stockDelta,
    reason: `quantity_asset_${input.kind}`,
    relatedType: input.relatedType || "asset",
    relatedId: input.relatedId || input.productId,
    warehouseId: locked.warehouseId,
    idempotencyKey: key,
    metadata,
    actor: input.actor,
  });
  await assetTimeline(executor, {
    entityType: "asset",
    entityId: input.productId,
    type: `quantity_${input.kind}`,
    title: label,
    body: `${input.reason} · قبل ${plan.totalBefore} · التغيير ${plan.change >= 0 ? "+" : ""}${plan.change} · بعد ${plan.totalAfter} ${locked.profile.unit}`,
    actor: input.actor,
    metadata,
  });
  return {
    ok: true,
    replayed: false,
    productId: input.productId,
    kind: input.kind,
    label,
    before: plan.before,
    after: plan.after,
    totalBefore: plan.totalBefore,
    totalAfter: plan.totalAfter,
    change: plan.change,
    warning: plan.commitmentWarning,
  };
}

// ─── Tracking mode ──────────────────────────────────────────────────────────

/**
 * Explicit, guarded tracking-mode changes. An individual asset with an active
 * reservation, custody or checkout is never converted; one with history needs an
 * explicit manager confirmation. Rows are never deleted.
 */
export async function configureQuantityTracking(
  executor: Executor,
  input: {
    productId: number;
    trackingMode: "individual" | "quantity";
    unitOfMeasure?: string | null;
    confirmConversion: boolean;
    isManager: boolean;
    actor: Actor;
  },
) {
  await requireQuantitySchema(executor);
  const product = rowsOf(
    await executor.execute(
      sql`select id, coalesce(name_ar, name) as name, stock, is_asset, shared_stock_product_id from products where id = ${input.productId} for update`,
    ),
  )[0];
  if (!product || product.is_asset !== true) throw new QuantityAssetError("الأصل غير موجود", 404);
  const existing = rowsOf(
    await executor.execute(
      sql`select * from asset_quantity_profiles where product_id = ${input.productId} for update`,
    ),
  )[0];
  const unit = String(input.unitOfMeasure ?? "").trim().slice(0, 40) || String(existing?.unit_of_measure ?? "") || DEFAULT_QUANTITY_UNIT;
  const isQuantity = existing?.tracking_mode === "quantity";
  const stock = Number(product.stock ?? 0);

  if (input.trackingMode === "quantity" && isQuantity) {
    if (unit !== existing.unit_of_measure)
      await executor.execute(
        sql`update asset_quantity_profiles set unit_of_measure = ${unit}, updated_at = now() where product_id = ${input.productId}`,
      );
    return { ok: true, changed: false, trackingMode: "quantity" as const, unit };
  }
  if (input.trackingMode === "individual" && !isQuantity)
    return { ok: true, changed: false, trackingMode: "individual" as const, unit };

  const rowsMap = await quantityCommitmentRows(executor, [input.productId]);
  const lines = rowsMap.get(input.productId) ?? [];
  const activeLines = lines.filter((row) => {
    const line = normalizeQuantityLine(row.line);
    return lineOutstanding(line) > 0 || lineReservedNotOut(line, row.status) > 0 ||
      (!CLOSED_LINE_STAGES.includes(line.stage) && !INACTIVE_BOOKING_STATUSES.includes(row.status.toLowerCase()));
  });
  if (activeLines.length)
    throw new QuantityAssetError(
      `الأصل مرتبط بحجوزات نشطة (${activeLines.map((row) => `#${row.bookingId}`).join("، ")})؛ أكمل أو حرر الحجز قبل تغيير طريقة التتبع`,
      409,
    );

  if (input.trackingMode === "quantity") {
    if (Number(product.shared_stock_product_id ?? 0) > 0)
      throw new QuantityAssetError("الأصل يستخدم مخزوناً مشتركاً ولا يمكن تتبعه بالكمية", 409);
    if (!Number.isInteger(stock) || stock < 0)
      throw new QuantityAssetError("رصيد الأصل يجب أن يكون عدداً صحيحاً قبل تتبعه بالكمية", 409);
    const status = rowsOf(
      await executor.execute(sql`select status, deleted_at from asset_profiles where product_id = ${input.productId}`),
    )[0];
    if (status && ["sold", "disposed", "retired", "lost", "maintenance", "locked"].includes(String(status.status)))
      throw new QuantityAssetError(`حالة الأصل (${status.status}) لا تسمح بتحويله إلى أصل متعدد الكمية`, 409);
    const [custody, reservations, history] = await Promise.all([
      executor.execute(sql`select count(*)::int as count from equipment_custody where product_id = ${input.productId} and status = 'issued'`),
      executor.execute(sql`select count(*)::int as count from employee_custody_reservations where product_id = ${input.productId} and status in ('reserved', 'checked_out')`),
      executor.execute(
        sql`select count(*)::int as count from stock_movements where coalesce(stock_source_product_id, product_id) = ${input.productId} and reason <> 'product_initial_stock'`,
      ),
    ]);
    if (whole(rowsOf(custody)[0]?.count) > 0)
      throw new QuantityAssetError("الأصل بعهدة موظف حالياً؛ سجّل إرجاعه قبل تحويله", 409);
    if (whole(rowsOf(reservations)[0]?.count) > 0)
      throw new QuantityAssetError("الأصل محجوز ضمن عهدة موظف لحجز قادم؛ حرر الحجز قبل تحويله", 409);
    const historyCount = whole(rowsOf(history)[0]?.count) + lines.length;
    if (historyCount > 0 && !input.confirmConversion)
      throw new QuantityAssetError(
        "لهذا الأصل سجل حركات أو حجوزات سابقة. التحويل إلى أصل متعدد الكمية يحتاج تأكيداً صريحاً من المدير، ويبقى السجل السابق كما هو.",
        409,
        { requiresConfirmation: true, historyCount },
      );
    if (historyCount > 0 && !input.isManager)
      throw new QuantityAssetError("تحويل أصل له سجل سابق متاح للمدير فقط", 403);
    if (existing)
      await executor.execute(sql`
        update asset_quantity_profiles set tracking_mode = 'quantity', unit_of_measure = ${unit}, configured_by = ${input.actor.id}, updated_at = now()
        where product_id = ${input.productId}
      `);
    else
      await executor.execute(sql`
        insert into asset_quantity_profiles (product_id, tracking_mode, unit_of_measure, configured_by)
        values (${input.productId}, 'quantity', ${unit}, ${input.actor.id})
      `);
    await assetTimeline(executor, {
      entityType: "asset",
      entityId: input.productId,
      type: "tracking_mode_quantity",
      title: "تفعيل التتبع بالكمية",
      body: `الكمية الحالية في المستودع: ${stock} ${unit}`,
      actor: input.actor,
      metadata: { trackingMode: "quantity", unit, stock, historyCount, confirmed: input.confirmConversion },
    });
    return { ok: true, changed: true, trackingMode: "quantity" as const, unit, historyCount };
  }

  const profile = profileFromRow(existing);
  if (profile.checkedOut + profile.damaged + profile.maintenance + profile.missing > 0)
    throw new QuantityAssetError("توجد كميات خارجة أو تالفة أو بالصيانة أو مفقودة؛ سوّها قبل التحويل إلى أصل فردي", 409);
  if (stock > 1)
    throw new QuantityAssetError("الأصل الفردي يمثل قطعة واحدة؛ خفّض الكمية إلى 1 أولاً أو أبقِه متعدد الكمية", 409);
  if (!input.isManager) throw new QuantityAssetError("تغيير طريقة التتبع متاح للمدير فقط", 403);
  await executor.execute(sql`
    update asset_quantity_profiles set tracking_mode = 'individual', configured_by = ${input.actor.id}, updated_at = now()
    where product_id = ${input.productId}
  `);
  await assetTimeline(executor, {
    entityType: "asset",
    entityId: input.productId,
    type: "tracking_mode_individual",
    title: "إعادة الأصل إلى التتبع الفردي",
    body: null,
    actor: input.actor,
    metadata: { trackingMode: "individual", stock },
  });
  return { ok: true, changed: true, trackingMode: "individual" as const, unit };
}

// ─── Read models ────────────────────────────────────────────────────────────

export function describeLines(rows: QuantityCommitmentRow[]) {
  return rows
    .map((row) => ({
      source: row.source,
      bookingId: row.bookingId,
      day: row.day,
      status: row.status,
      customerName: row.customerName,
      ...quantityLineSummary(row.line),
    }))
    .sort((a, b) => String(b.day ?? "").localeCompare(String(a.day ?? "")));
}

const PHOTO_URL = /^(https:\/\/|\/api\/media\/)/i;

/**
 * Checks that keep a manual adjustment from counting something twice:
 * stock from a purchase invoice is received with the invoice, and damage or
 * loss recorded at a booking's return is already in the buckets.
 */
async function adjustmentGuards(
  executor: Executor,
  input: {
    productId: number;
    kind: QuantityAdjustmentKind;
    relatedType?: string | null;
    relatedId?: number | null;
    responsibleStaffId?: number | null;
    photos?: string[];
    additionalToReturn?: boolean;
  },
) {
  const photos = (input.photos ?? []).map((url) => String(url).trim()).filter(Boolean);
  if (photos.length > 10) throw new QuantityAssetError("الحد الأقصى 10 صور", 422);
  if (photos.some((url) => !PHOTO_URL.test(url) || url.length > 4000))
    throw new QuantityAssetError("الصور يجب أن تكون مرفوعة إلى التخزين", 422);
  let responsible: { id: number; name: string } | null = null;
  if (input.responsibleStaffId) {
    const staff = rowsOf(
      await executor.execute(
        sql`select id, coalesce(nullif(full_name, ''), username) as name from staff where id = ${input.responsibleStaffId} and is_active = true`,
      ),
    )[0];
    if (!staff) throw new QuantityAssetError("الموظف المسؤول غير موجود أو غير نشط", 422);
    responsible = { id: Number(staff.id), name: String(staff.name) };
  }
  if (input.kind === "add" && input.relatedType === "purchase_invoice" && input.relatedId) {
    const invoice = rowsOf(await executor.execute(sql`select id, status from purchase_invoices where id = ${input.relatedId}`))[0];
    if (!invoice || invoice.status === "deleted") throw new QuantityAssetError(`فاتورة الشراء #${input.relatedId} غير موجودة`, 422);
    // The invoice's own lines receive stock when it is saved (net of edits);
    // a manual add may reference an invoice only once and only if it received nothing.
    const received = rowsOf(
      await executor.execute(sql`
        select
          coalesce(sum(quantity_change::numeric) filter (where reason like 'purchase_invoice%'), 0) as from_invoice,
          count(*) filter (where reason = 'quantity_asset_add') as manual
        from stock_movements
        where coalesce(stock_source_product_id, product_id) = ${input.productId}
          and related_type = 'purchase_invoice' and related_id = ${input.relatedId}
      `),
    )[0];
    if (Number(received?.manual ?? 0) > 0)
      throw new QuantityAssetError(`أُضيفت كمية من فاتورة الشراء #${input.relatedId} لهذا الأصل سابقاً؛ لا تُضاف مرة ثانية`, 409);
    if (Number(received?.from_invoice ?? 0) > 0)
      throw new QuantityAssetError(
        `كمية فاتورة الشراء #${input.relatedId} (${Number(received.from_invoice)}) استُلمت تلقائياً عند حفظها؛ لا تُضاف مرة ثانية`,
        409,
      );
  }
  if (
    (input.kind === "damage" || input.kind === "loss") &&
    (input.relatedType === "kosha_booking" || input.relatedType === "service_order") &&
    input.relatedId &&
    !input.additionalToReturn
  ) {
    const action = input.kind === "damage" ? "return_damaged" : "return_missing";
    const recorded = Number(
      rowsOf(
        await executor.execute(sql`
          select coalesce(sum((metadata->>'quantity')::numeric), 0) as qty from stock_movements
          where coalesce(stock_source_product_id, product_id) = ${input.productId}
            and metadata->>'action' = ${action}
            and metadata->>'bookingType' = ${input.relatedType}
            and metadata->>'bookingId' = ${String(input.relatedId)}
        `),
      )[0]?.qty ?? 0,
    );
    if (recorded > 0)
      throw new QuantityAssetError(
        `سُجّل ${input.kind === "damage" ? "تلف" : "فقدان"} ${recorded} عند إرجاع هذا الحجز. إذا كان ما تسجله إضافياً غير المسجل عند الإرجاع فحدد «إضافي» حتى لا يُحسب مرتين.`,
        409,
      );
  }
  return { responsible, photos };
}

export async function quantityAssetSummary(executor: Executor, productId: number, day?: string | null) {
  const profiles = await quantityProfilesFor(executor, [productId]);
  const profile = profiles.get(productId);
  if (!profile) return null;
  const product = rowsOf(
    await executor.execute(sql`select stock, cost_price, min_stock from products where id = ${productId}`),
  )[0];
  const buckets = bucketsOf(profile, product?.stock);
  const today = baghdadDay();
  const [rowsMap, holds] = await Promise.all([
    quantityCommitmentRows(executor, [productId]),
    otherStockHolds(executor, productId, null),
  ]);
  const rows = rowsMap.get(productId) ?? [];
  const target = bookingDay(day) ?? today;
  const forDay = availabilityForDay({ buckets, rows, targetDay: target, today, otherHolds: holds });
  const reservedUpcoming = rows.reduce((sum, row) => {
    if (row.day && row.day < today) return sum;
    return sum + lineReservedNotOut(normalizeQuantityLine(row.line), row.status);
  }, 0);
  const outstandingInLines = rows.reduce((sum, row) => sum + lineOutstanding(normalizeQuantityLine(row.line)), 0);
  const total = totalQuantity(buckets);
  const unitCost = Number(product?.cost_price ?? 0);
  const warehouse = rowsOf(
    await executor.execute(sql`
      select w.id, w.name from asset_passports ap join warehouses w on w.id = ap.warehouse_id where ap.product_id = ${productId} limit 1
    `),
  )[0];
  return {
    productId,
    trackingMode: "quantity" as const,
    unit: profile.unit,
    warehouse: warehouse ? { id: Number(warehouse.id), name: String(warehouse.name) } : null,
    total,
    inWarehouse: buckets.inWarehouse,
    checkedOut: buckets.checkedOut,
    damaged: buckets.damaged,
    maintenance: buckets.maintenance,
    missing: buckets.missing,
    reserved: reservedUpcoming,
    available: forDay.available,
    availabilityDay: target,
    committedOnDay: forDay.committed,
    otherHolds: holds,
    peakCommitment: peakCommitment(rows, buckets, today, holds),
    unitCost,
    totalValue: Math.round(total * unitCost * 100) / 100,
    lowAvailability: lowAvailability({ available: forDay.available, total, minStock: Number(product?.min_stock ?? 0) }),
    // Booking lines are the source for units out; a mismatch means a movement was
    // recorded outside the quantity flow and needs review (never auto-corrected).
    reconciliation: { outstandingInBookings: outstandingInLines, matches: outstandingInLines === buckets.checkedOut },
    bookings: describeLines(rows),
  };
}

export async function quantityMovements(
  executor: Executor,
  productId: number,
  options: { from?: string | null; to?: string | null; page?: number; pageSize?: number } = {},
) {
  const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const from = day(options.from);
  const to = day(options.to);
  const pageSize = Math.max(1, Math.min(200, Math.floor(options.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const where = sql`
    coalesce(m.stock_source_product_id, m.product_id) = ${productId}
    ${from ? sql`and (m.created_at + interval '3 hours')::date >= ${from}::date` : sql``}
    ${to ? sql`and (m.created_at + interval '3 hours')::date <= ${to}::date` : sql``}
  `;
  const [result, counted] = await Promise.all([
    executor.execute(sql`
      select m.id, m.quantity_change, m.reason, m.movement_type, m.related_type, m.related_id, m.warehouse_id, w.name as warehouse_name,
             m.metadata, m.created_by_name, m.created_at
      from stock_movements m left join warehouses w on w.id = m.warehouse_id
      where ${where}
      order by m.created_at desc, m.id desc
      limit ${pageSize} offset ${(page - 1) * pageSize}
    `),
    executor.execute(sql`select count(*)::int as total from stock_movements m where ${where}`),
  ]);
  const total = Number(rowsOf(counted)[0]?.total ?? 0);
  const data = rowsOf(result).map((row) => ({
    id: Number(row.id),
    quantityChange: Number(row.quantity_change ?? 0),
    reason: String(row.reason ?? ""),
    movementType: row.movement_type ?? null,
    relatedType: row.related_type ?? null,
    relatedId: row.related_id == null ? null : Number(row.related_id),
    warehouseId: row.warehouse_id == null ? null : Number(row.warehouse_id),
    warehouseName: row.warehouse_name ?? null,
    metadata: row.metadata ?? {},
    actorName: row.created_by_name ?? "",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
  }));
  return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** List-page figures for many assets with one profile query and one booking scan. */
export async function quantityListFigures(
  executor: Executor,
  products: Array<{ id: number; stock: unknown; minStock?: unknown }>,
) {
  const profiles = await quantityProfilesFor(executor, products.map((row) => row.id));
  const figures = new Map<number, {
    trackingMode: "quantity";
    unit: string;
    total: number;
    inWarehouse: number;
    checkedOut: number;
    damaged: number;
    maintenance: number;
    missing: number;
    reserved: number;
    available: number;
    lowAvailability: boolean;
  }>();
  if (!profiles.size) return figures;
  const rowsMap = await quantityCommitmentRows(executor, [...profiles.keys()]);
  const today = baghdadDay();
  for (const product of products) {
    const profile = profiles.get(product.id);
    if (!profile) continue;
    const buckets = bucketsOf(profile, product.stock);
    const rows = rowsMap.get(product.id) ?? [];
    const forToday = availabilityForDay({ buckets, rows, targetDay: today, today });
    const total = totalQuantity(buckets);
    figures.set(product.id, {
      trackingMode: "quantity",
      unit: profile.unit,
      total,
      ...buckets,
      reserved: rows.reduce((sum, row) => (row.day && row.day < today ? sum : sum + lineReservedNotOut(normalizeQuantityLine(row.line), row.status)), 0),
      available: forToday.available,
      lowAvailability: lowAvailability({ available: forToday.available, total, minStock: Number(product.minStock ?? 0) }),
    });
  }
  return figures;
}
