import { sql } from "drizzle-orm";
import {
  WAREHOUSE_BUCKETS,
  bucketsTotal,
  warehouseBreakdown,
  type WarehouseBuckets,
  type WarehouseDelta,
  type WarehouseRef,
  type WarehouseShare,
} from "../lib/warehouse-stock";

export type Executor = { execute: (query: any) => Promise<any> };
export type WarehouseActor = { id: number | null; name: string };

export class WarehouseError extends Error {
  constructor(message: string, public status = 409, public extra?: Record<string, unknown>) {
    super(message);
    this.name = "WarehouseError";
  }
}

export function rowsOf(result: any): any[] {
  if (!Array.isArray(result?.rows)) throw new Error("Invalid warehouse database response");
  return result.rows;
}
const idList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
const textOrNull = (value: unknown, max: number) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (text.length > max) throw new WarehouseError("أحد الحقول أطول من الحد المسموح", 422);
  return text || null;
};

/** The first warehouse is the main one: the seeded row every existing record already belongs to. */
export async function mainWarehouseId(executor: Executor): Promise<number> {
  const row = rowsOf(await executor.execute(sql`select id from warehouses order by id asc limit 1`))[0];
  if (!row) throw new WarehouseError("لا يوجد مخزن رئيسي؛ طبّق ترقية المخازن أولاً", 409);
  return Number(row.id);
}

export type WarehouseRow = WarehouseRef & {
  code: string | null;
  location: string | null;
  managerId: number | null;
  managerName: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  isMain: boolean;
  createdAt: string | null;
};

const fromRow = (row: any, mainId: number): WarehouseRow => ({
  id: Number(row.id),
  name: String(row.name ?? ""),
  code: row.code ?? null,
  location: row.location ?? null,
  managerId: row.manager_id == null ? null : Number(row.manager_id),
  managerName: row.manager_name ?? null,
  phone: row.phone ?? null,
  notes: row.notes ?? null,
  isActive: Number(row.is_active) === 1,
  isMain: Number(row.id) === mainId,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ? String(row.created_at) : null,
});

export async function listWarehouses(executor: Executor): Promise<WarehouseRow[]> {
  const mainId = await mainWarehouseId(executor);
  const result = await executor.execute(sql`
    select w.id, w.name, w.code, w.location, w.manager_id, s.full_name as manager_name, w.phone, w.notes, w.is_active, w.created_at
    from warehouses w left join staff s on s.id = w.manager_id
    order by w.id asc
  `);
  return rowsOf(result).map((row) => fromRow(row, mainId));
}

export type WarehouseInput = { name: unknown; code?: unknown; location?: unknown; managerId?: unknown; phone?: unknown; notes?: unknown; isActive?: unknown };

async function validateInput(executor: Executor, input: WarehouseInput, exceptId: number | null) {
  const name = textOrNull(input.name, 120);
  if (!name) throw new WarehouseError("اكتب اسم المخزن", 422);
  const code = textOrNull(input.code, 30);
  const managerId = input.managerId == null || input.managerId === "" ? null : Number(input.managerId);
  if (managerId !== null && (!Number.isSafeInteger(managerId) || managerId <= 0)) throw new WarehouseError("المسؤول غير صالح", 422);
  if (managerId !== null && !rowsOf(await executor.execute(sql`select id from staff where id = ${managerId} and is_active = true`)).length)
    throw new WarehouseError("الموظف المسؤول غير موجود أو غير نشط", 422);
  const clash = rowsOf(await executor.execute(sql`
    select id, name, code from warehouses
    where (lower(name) = lower(${name}) ${code ? sql`or lower(code) = lower(${code})` : sql``})
      ${exceptId ? sql`and id <> ${exceptId}` : sql``}
    limit 1
  `))[0];
  if (clash) throw new WarehouseError(String(clash.name).toLowerCase() === name.toLowerCase() ? "يوجد مخزن بهذا الاسم" : "رمز المخزن مستخدم لمخزن آخر", 409);
  return { name, code, managerId, location: textOrNull(input.location, 500), phone: textOrNull(input.phone, 40), notes: textOrNull(input.notes, 2000) };
}

export async function createWarehouse(executor: Executor, input: WarehouseInput, actor: WarehouseActor) {
  const value = await validateInput(executor, input, null);
  const isActive = input.isActive === false ? 0 : 1;
  const row = rowsOf(await executor.execute(sql`
    insert into warehouses (name, code, location, manager_id, phone, notes, is_active, created_by, updated_at)
    values (${value.name}, ${value.code}, ${value.location}, ${value.managerId}, ${value.phone}, ${value.notes}, ${isActive}, ${actor.id}, now())
    returning id
  `))[0];
  return Number(row.id);
}

/** Holds still in a warehouse block deactivating it, and the main warehouse always stays active. */
export async function updateWarehouse(executor: Executor, id: number, input: WarehouseInput) {
  const mainId = await mainWarehouseId(executor);
  if (!rowsOf(await executor.execute(sql`select id from warehouses where id = ${id} for update`)).length) throw new WarehouseError("المخزن غير موجود", 404);
  const value = await validateInput(executor, input, id);
  const isActive = input.isActive === false ? 0 : 1;
  if (isActive === 0) {
    if (id === mainId) throw new WarehouseError("لا يمكن إيقاف المخزن الرئيسي", 409);
    const held = rowsOf(await executor.execute(sql`
      select coalesce(sum(quantity::numeric + quantity_checked_out + quantity_damaged + quantity_maintenance + quantity_missing), 0) as units
      from warehouse_stock where warehouse_id = ${id}
    `))[0];
    if (Number(held?.units ?? 0) > 0) throw new WarehouseError("حوّل كميات هذا المخزن أولاً قبل إيقافه", 409);
  }
  await executor.execute(sql`
    update warehouses set name = ${value.name}, code = ${value.code}, location = ${value.location}, manager_id = ${value.managerId},
      phone = ${value.phone}, notes = ${value.notes}, is_active = ${isActive}, updated_at = now()
    where id = ${id}
  `);
}

export async function requireActiveWarehouse(executor: Executor, id: number) {
  const row = rowsOf(await executor.execute(sql`select id, name, is_active from warehouses where id = ${id}`))[0];
  if (!row) throw new WarehouseError("المخزن غير موجود", 404);
  if (Number(row.is_active) !== 1) throw new WarehouseError(`المخزن «${row.name}» غير نشط`, 409);
  return { id: Number(row.id), name: String(row.name) };
}

const bucketsFromRow = (row: any) => ({
  inWarehouse: Number(row.quantity ?? 0),
  checkedOut: Number(row.quantity_checked_out ?? 0),
  damaged: Number(row.quantity_damaged ?? 0),
  maintenance: Number(row.quantity_maintenance ?? 0),
  missing: Number(row.quantity_missing ?? 0),
});

export type ProductBreakdown = { company: WarehouseBuckets; shares: WarehouseShare[]; overdrawn: WarehouseBuckets };

/** Per-warehouse figures for many products: company figures come from their original tables. */
export async function warehouseBreakdowns(executor: Executor, productIds: number[]): Promise<Map<number, ProductBreakdown>> {
  const ids = [...new Set(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const map = new Map<number, ProductBreakdown>();
  if (!ids.length) return map;
  // In sequence: this also runs on a transaction's single connection.
  const mainId = await mainWarehouseId(executor);
  const warehouses = await listWarehouses(executor);
  const products = await executor.execute(sql`
    select p.id, p.stock, q.quantity_checked_out, q.quantity_damaged, q.quantity_maintenance, q.quantity_missing
    from products p left join asset_quantity_profiles q on q.product_id = p.id
    where p.id in (${idList(ids)})
  `);
  const others = await executor.execute(sql`select * from warehouse_stock where product_id in (${idList(ids)})`);
  const rowsByProduct = new Map<number, any[]>();
  for (const row of rowsOf(others)) {
    const id = Number(row.product_id);
    rowsByProduct.set(id, [...(rowsByProduct.get(id) ?? []), { warehouseId: Number(row.warehouse_id), ...bucketsFromRow(row) }]);
  }
  for (const row of rowsOf(products)) {
    const id = Number(row.id);
    const company: WarehouseBuckets = {
      inWarehouse: Number(row.stock ?? 0),
      checkedOut: Number(row.quantity_checked_out ?? 0),
      damaged: Number(row.quantity_damaged ?? 0),
      maintenance: Number(row.quantity_maintenance ?? 0),
      missing: Number(row.quantity_missing ?? 0),
    };
    const { shares, overdrawn } = warehouseBreakdown({ company, rows: rowsByProduct.get(id) ?? [], warehouses, mainId });
    map.set(id, { company, shares, overdrawn });
  }
  return map;
}

export async function warehouseShare(executor: Executor, productId: number, warehouseId: number) {
  const breakdown = (await warehouseBreakdowns(executor, [productId])).get(productId);
  if (!breakdown) throw new WarehouseError("المنتج غير موجود", 404);
  const share = breakdown.shares.find((row) => row.warehouseId === warehouseId);
  if (!share) throw new WarehouseError("المخزن غير موجود", 404);
  return { share, breakdown };
}

/**
 * The one writer of per-warehouse figures. Call it inside the transaction that holds the product
 * row lock, right after the company figure changed. A non-main row can never go negative; the
 * main warehouse has no row, so a decrease there is checked against the company figure.
 */
export async function applyWarehouseDeltas(
  executor: Executor,
  input: { productId: number; company: WarehouseBuckets; deltas: WarehouseDelta[] },
) {
  const mainId = await mainWarehouseId(executor);
  const merged = new Map<number, WarehouseBuckets>();
  for (const delta of input.deltas) {
    const current = merged.get(delta.warehouseId) ?? { inWarehouse: 0, checkedOut: 0, damaged: 0, maintenance: 0, missing: 0 };
    for (const key of WAREHOUSE_BUCKETS) current[key] += Number(delta[key] ?? 0);
    merged.set(delta.warehouseId, current);
  }
  const ordered = [...merged.entries()].sort((a, b) => a[0] - b[0]);
  for (const [warehouseId, delta] of ordered) {
    if (warehouseId === mainId || !WAREHOUSE_BUCKETS.some((key) => delta[key] !== 0)) continue;
    const row = rowsOf(await executor.execute(sql`
      select * from warehouse_stock where warehouse_id = ${warehouseId} and product_id = ${input.productId} for update
    `))[0];
    const before = row ? bucketsFromRow(row) : { inWarehouse: 0, checkedOut: 0, damaged: 0, maintenance: 0, missing: 0 };
    const after = { ...before };
    for (const key of WAREHOUSE_BUCKETS) {
      after[key] = Math.round((before[key] + delta[key]) * 1000) / 1000;
      if (after[key] < 0) {
        const warehouse = rowsOf(await executor.execute(sql`select name from warehouses where id = ${warehouseId}`))[0];
        throw new WarehouseError(`الكمية غير كافية في «${warehouse?.name ?? "المخزن"}». المتاح ${before[key]}، والمطلوب ${-delta[key]}.`, 409, { warehouseId, available: before[key], requested: -delta[key] });
      }
    }
    await executor.execute(sql`
      insert into warehouse_stock (warehouse_id, product_id, quantity, quantity_checked_out, quantity_damaged, quantity_maintenance, quantity_missing, updated_at)
      values (${warehouseId}, ${input.productId}, ${String(after.inWarehouse)}, ${after.checkedOut}, ${after.damaged}, ${after.maintenance}, ${after.missing}, now())
      on conflict (warehouse_id, product_id) do update set
        quantity = excluded.quantity, quantity_checked_out = excluded.quantity_checked_out, quantity_damaged = excluded.quantity_damaged,
        quantity_maintenance = excluded.quantity_maintenance, quantity_missing = excluded.quantity_missing, updated_at = now()
    `);
  }
  const mainDelta = merged.get(mainId);
  if (mainDelta && WAREHOUSE_BUCKETS.some((key) => mainDelta[key] < 0)) {
    const others = rowsOf(await executor.execute(sql`
      select coalesce(sum(quantity::numeric), 0) as in_warehouse, coalesce(sum(quantity_checked_out), 0) as checked_out, coalesce(sum(quantity_damaged), 0) as damaged,
             coalesce(sum(quantity_maintenance), 0) as maintenance, coalesce(sum(quantity_missing), 0) as missing
      from warehouse_stock where product_id = ${input.productId} and warehouse_id <> ${mainId}
    `))[0];
    const held: WarehouseBuckets = { inWarehouse: Number(others?.in_warehouse ?? 0), checkedOut: Number(others?.checked_out ?? 0), damaged: Number(others?.damaged ?? 0), maintenance: Number(others?.maintenance ?? 0), missing: Number(others?.missing ?? 0) };
    for (const key of WAREHOUSE_BUCKETS) {
      if (mainDelta[key] >= 0) continue;
      const remainder = Math.round((Number(input.company[key] ?? 0) - held[key]) * 1000) / 1000;
      if (remainder < 0) {
        const available = Math.max(0, Math.round((remainder - mainDelta[key]) * 1000) / 1000);
        throw new WarehouseError(`الكمية غير كافية في المخزن الرئيسي. المتاح ${available}، والمطلوب ${-mainDelta[key]}.`, 409, { warehouseId: mainId, available, requested: -mainDelta[key] });
      }
    }
  }
}

/** Store-product stock (no quantity profile): the shelf is the only figure. */
export function shelfCompany(stock: unknown): WarehouseBuckets {
  return { inWarehouse: Number(stock ?? 0), checkedOut: 0, damaged: 0, maintenance: 0, missing: 0 };
}

export function shareSummary(share: WarehouseShare) {
  return { warehouseId: share.warehouseId, name: share.name, isMain: share.isMain, inWarehouse: share.inWarehouse, checkedOut: share.checkedOut, damaged: share.damaged, maintenance: share.maintenance, missing: share.missing, total: bucketsTotal(share) };
}
