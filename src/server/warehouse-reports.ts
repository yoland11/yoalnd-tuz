import { sql } from "drizzle-orm";
import { lineReservedNotOut, normalizeQuantityLine } from "../lib/quantity-assets";
import { baghdadDay, quantityCommitmentRows, scopeCommitments } from "./quantity-assets";
import { listWarehouses, mainWarehouseId, rowsOf, warehouseBreakdowns, type Executor } from "./warehouses";

const pageOf = (value: unknown) => Math.max(1, Math.floor(Number(value) || 1));
const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

type Reserved = { byProductWarehouse: Map<string, number>; byWarehouse: Map<number, number> };

/** Reserved units per warehouse: upcoming booking lines plus store-product holds. */
async function reservedUnits(executor: Executor, productIds: number[] | null): Promise<Reserved> {
  const mainId = await mainWarehouseId(executor);
  const warehouses = await listWarehouses(executor);
  const byProductWarehouse = new Map<string, number>();
  const byWarehouse = new Map<number, number>();
  const add = (productId: number, warehouseId: number, quantity: number) => {
    if (quantity <= 0) return;
    const key = `${productId}:${warehouseId}`;
    byProductWarehouse.set(key, (byProductWarehouse.get(key) ?? 0) + quantity);
    byWarehouse.set(warehouseId, (byWarehouse.get(warehouseId) ?? 0) + quantity);
  };
  const scope = productIds ? (productIds.length ? sql`product_id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})` : sql`false`) : sql`true`;
  const holds = rowsOf(await executor.execute(sql`
    select product_id, coalesce(warehouse_id, ${mainId}) as warehouse_id, coalesce(sum(quantity), 0) as quantity
    from stock_reservations where status = 'reserved' and ${scope} group by 1, 2
  `));
  for (const row of holds) add(Number(row.product_id), Number(row.warehouse_id), Number(row.quantity));
  const tracked = rowsOf(await executor.execute(sql`select product_id from asset_quantity_profiles where tracking_mode = 'quantity' and ${scope}`)).map((row) => Number(row.product_id));
  const commitments = await quantityCommitmentRows(executor as any, tracked);
  const today = baghdadDay();
  for (const [productId, rows] of commitments)
    for (const warehouse of warehouses)
      for (const row of scopeCommitments(rows, warehouse.id, mainId)) {
        if (row.day && row.day < today) continue;
        add(productId, warehouse.id, lineReservedNotOut(normalizeQuantityLine(row.line), row.status));
      }
  return { byProductWarehouse, byWarehouse };
}

/** Totals per warehouse for the list and dashboard, in one pass over the original tables. */
export async function warehouseTotals(executor: Executor) {
  const mainId = await mainWarehouseId(executor);
  const [warehouses, others, company, reserved] = await Promise.all([
    listWarehouses(executor),
    executor.execute(sql`
      select ws.warehouse_id,
        count(*) filter (where p.is_asset = true and ws.quantity::numeric + ws.quantity_checked_out + ws.quantity_damaged + ws.quantity_maintenance + ws.quantity_missing > 0)::int as assets,
        count(*) filter (where ws.quantity::numeric + ws.quantity_checked_out + ws.quantity_damaged + ws.quantity_maintenance + ws.quantity_missing > 0)::int as items,
        coalesce(sum(ws.quantity::numeric), 0)::float as shelf, coalesce(sum(ws.quantity_checked_out), 0)::int as checked_out,
        coalesce(sum(ws.quantity_damaged), 0)::int as damaged, coalesce(sum(ws.quantity_maintenance), 0)::int as maintenance, coalesce(sum(ws.quantity_missing), 0)::int as missing
      from warehouse_stock ws join products p on p.id = ws.product_id
      where ws.warehouse_id <> ${mainId} group by ws.warehouse_id
    `),
    executor.execute(sql`
      with held as (
        select product_id, sum(quantity::numeric) as shelf, sum(quantity_checked_out) as checked_out, sum(quantity_damaged) as damaged, sum(quantity_maintenance) as maintenance, sum(quantity_missing) as missing
        from warehouse_stock where warehouse_id <> ${mainId} group by product_id
      ), figures as (
        select p.is_asset, p.stock::numeric as stock, coalesce(q.quantity_checked_out, 0) as checked_out, coalesce(q.quantity_damaged, 0) as damaged, coalesce(q.quantity_maintenance, 0) as maintenance, coalesce(q.quantity_missing, 0) as missing,
          coalesce(h.shelf, 0) as other_shelf, coalesce(h.checked_out, 0) as other_checked_out, coalesce(h.damaged, 0) as other_damaged, coalesce(h.maintenance, 0) as other_maintenance, coalesce(h.missing, 0) as other_missing
        from products p left join asset_quantity_profiles q on q.product_id = p.id left join held h on h.product_id = p.id
        where p.archived_at is null and p.shared_stock_product_id is null
      )
      select
        count(*) filter (where is_asset = true and stock + checked_out + damaged + maintenance + missing > 0)::int as company_assets,
        coalesce(sum(greatest(stock, 0)), 0)::float as company_shelf, coalesce(sum(checked_out), 0)::int as company_checked_out, coalesce(sum(damaged), 0)::int as company_damaged,
        coalesce(sum(maintenance), 0)::int as company_maintenance, coalesce(sum(missing), 0)::int as company_missing,
        count(*) filter (where is_asset = true and greatest(stock - other_shelf, 0) + greatest(checked_out - other_checked_out, 0) + greatest(damaged - other_damaged, 0) + greatest(maintenance - other_maintenance, 0) + greatest(missing - other_missing, 0) > 0)::int as main_assets,
        count(*) filter (where greatest(stock - other_shelf, 0) + greatest(checked_out - other_checked_out, 0) + greatest(damaged - other_damaged, 0) + greatest(maintenance - other_maintenance, 0) + greatest(missing - other_missing, 0) > 0)::int as main_items,
        coalesce(sum(greatest(stock - other_shelf, 0)), 0)::float as main_shelf, coalesce(sum(greatest(checked_out - other_checked_out, 0)), 0)::int as main_checked_out,
        coalesce(sum(greatest(damaged - other_damaged, 0)), 0)::int as main_damaged, coalesce(sum(greatest(maintenance - other_maintenance, 0)), 0)::int as main_maintenance,
        coalesce(sum(greatest(missing - other_missing, 0)), 0)::int as main_missing,
        count(*) filter (where stock - other_shelf < 0)::int as overdrawn_items
      from figures
    `),
    reservedUnits(executor, null),
  ]);
  const totals = rowsOf(company)[0] ?? {};
  const byWarehouse = new Map(rowsOf(others).map((row) => [Number(row.warehouse_id), row]));
  const rows = warehouses.map((warehouse) => {
    const row = warehouse.isMain
      ? { assets: totals.main_assets, items: totals.main_items, shelf: totals.main_shelf, checked_out: totals.main_checked_out, damaged: totals.main_damaged, maintenance: totals.main_maintenance, missing: totals.main_missing }
      : byWarehouse.get(warehouse.id);
    return {
      ...warehouse,
      assets: Number(row?.assets ?? 0),
      items: Number(row?.items ?? 0),
      shelf: Number(row?.shelf ?? 0),
      checkedOut: Number(row?.checked_out ?? 0),
      damaged: Number(row?.damaged ?? 0),
      maintenance: Number(row?.maintenance ?? 0),
      missing: Number(row?.missing ?? 0),
      reserved: reserved.byWarehouse.get(warehouse.id) ?? 0,
    };
  });
  return {
    mainId,
    warehouses: rows,
    company: {
      assets: Number(totals.company_assets ?? 0),
      shelf: Number(totals.company_shelf ?? 0),
      checkedOut: Number(totals.company_checked_out ?? 0),
      damaged: Number(totals.company_damaged ?? 0),
      maintenance: Number(totals.company_maintenance ?? 0),
      missing: Number(totals.company_missing ?? 0),
      reserved: [...reserved.byWarehouse.values()].reduce((sum, value) => sum + value, 0),
      overdrawnItems: Number(totals.overdrawn_items ?? 0),
    },
  };
}

const transferRow = (row: any) => ({
  id: Number(row.id),
  transferNo: String(row.transfer_no ?? ""),
  productId: row.product_id == null ? null : Number(row.product_id),
  productName: String(row.product_name ?? ""),
  fromWarehouseId: row.from_warehouse_id == null ? null : Number(row.from_warehouse_id),
  fromWarehouseName: row.from_name ?? null,
  toWarehouseId: row.to_warehouse_id == null ? null : Number(row.to_warehouse_id),
  toWarehouseName: row.to_name ?? null,
  quantity: Number(row.quantity ?? 0),
  status: String(row.status ?? ""),
  requestedByName: row.requested_by_name ?? "",
  reviewedByName: row.reviewed_by_name ?? "",
  responsibleStaffId: row.responsible_staff_id == null ? null : Number(row.responsible_staff_id),
  responsibleName: row.responsible_name ?? null,
  transferDate: row.transfer_date ?? null,
  notes: row.notes ?? "",
  executedAt: row.executed_at ?? null,
  createdAt: row.created_at ?? null,
});

export async function warehouseTransferRows(executor: Executor, options: { warehouseId?: number | null; from?: string | null; to?: string | null; limit?: number } = {}) {
  const mainId = await mainWarehouseId(executor);
  const from = day(options.from), to = day(options.to);
  const rows = rowsOf(await executor.execute(sql`
    select t.*, fw.name as from_name, tw.name as to_name, s.full_name as responsible_name
    from warehouse_transfers t
    left join warehouses fw on fw.id = t.from_warehouse_id
    left join warehouses tw on tw.id = t.to_warehouse_id
    left join staff s on s.id = t.responsible_staff_id
    where true
      ${options.warehouseId ? sql`and (coalesce(t.from_warehouse_id, ${mainId}) = ${options.warehouseId} or t.to_warehouse_id = ${options.warehouseId})` : sql``}
      ${from ? sql`and (t.created_at + interval '3 hours')::date >= ${from}::date` : sql``}
      ${to ? sql`and (t.created_at + interval '3 hours')::date <= ${to}::date` : sql``}
    order by t.created_at desc, t.id desc limit ${Math.min(2000, options.limit ?? 200)}
  `));
  return rows.map(transferRow);
}

/** One row per item with this warehouse's figures beside the company's. */
export async function warehouseStockRows(
  executor: Executor,
  options: { warehouseId?: number | null; search?: string | null; kind?: string | null; focus?: string | null; page?: unknown; pageSize?: unknown } = {},
) {
  const mainId = await mainWarehouseId(executor);
  const warehouseId = options.warehouseId ?? null;
  const pageSize = Math.max(1, Math.min(2000, Math.floor(Number(options.pageSize) || 50)));
  const page = pageOf(options.page);
  const search = String(options.search ?? "").trim().slice(0, 100);
  const pattern = `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
  const held = sql`(select product_id, sum(quantity::numeric) as shelf, sum(quantity_checked_out) as checked_out, sum(quantity_damaged) as damaged, sum(quantity_maintenance) as maintenance, sum(quantity_missing) as missing
    from warehouse_stock where warehouse_id <> ${mainId} group by product_id)`;
  const present = warehouseId === null
    ? sql`p.stock::numeric + coalesce(q.quantity_checked_out, 0) + coalesce(q.quantity_damaged, 0) + coalesce(q.quantity_maintenance, 0) + coalesce(q.quantity_missing, 0) > 0`
    : warehouseId === mainId
      ? sql`greatest(p.stock::numeric - coalesce(h.shelf, 0), 0) + greatest(coalesce(q.quantity_checked_out, 0) - coalesce(h.checked_out, 0), 0) + greatest(coalesce(q.quantity_damaged, 0) - coalesce(h.damaged, 0), 0) + greatest(coalesce(q.quantity_maintenance, 0) - coalesce(h.maintenance, 0), 0) + greatest(coalesce(q.quantity_missing, 0) - coalesce(h.missing, 0), 0) > 0`
      : sql`coalesce(ws.quantity::numeric, 0) + coalesce(ws.quantity_checked_out, 0) + coalesce(ws.quantity_damaged, 0) + coalesce(ws.quantity_maintenance, 0) + coalesce(ws.quantity_missing, 0) > 0`;
  const where = sql`
    p.archived_at is null and p.shared_stock_product_id is null and ${present}
    ${options.kind === "assets" ? sql`and p.is_asset = true` : options.kind === "store" ? sql`and p.is_asset = false` : sql``}
    ${search ? sql`and (p.name ilike ${pattern} or p.name_ar ilike ${pattern} or p.barcode ilike ${pattern})` : sql``}
    ${options.focus === "damaged" ? (warehouseId === null || warehouseId === mainId ? sql`and coalesce(q.quantity_damaged, 0) + coalesce(q.quantity_missing, 0) + coalesce(q.quantity_maintenance, 0) > 0` : sql`and coalesce(ws.quantity_damaged, 0) + coalesce(ws.quantity_missing, 0) + coalesce(ws.quantity_maintenance, 0) > 0`) : sql``}
  `;
  const from = sql`products p
    left join asset_quantity_profiles q on q.product_id = p.id
    left join ${held} h on h.product_id = p.id
    ${warehouseId !== null && warehouseId !== mainId ? sql`left join warehouse_stock ws on ws.product_id = p.id and ws.warehouse_id = ${warehouseId}` : sql``}`;
  const [listed, counted] = await Promise.all([
    executor.execute(sql`
      select p.id, coalesce(p.name_ar, p.name) as name, p.barcode, p.is_asset, coalesce(q.unit_of_measure, 'قطعة') as unit, q.tracking_mode
      from ${from} where ${where}
      order by coalesce(p.name_ar, p.name) asc, p.id asc limit ${pageSize} offset ${(page - 1) * pageSize}
    `),
    executor.execute(sql`select count(*)::int as total from ${from} where ${where}`),
  ]);
  const products = rowsOf(listed);
  const ids = products.map((row) => Number(row.id));
  const [breakdowns, reserved] = await Promise.all([warehouseBreakdowns(executor, ids), reservedUnits(executor, ids)]);
  const data = products.map((row) => {
    const id = Number(row.id);
    const breakdown = breakdowns.get(id);
    const share = warehouseId === null ? null : breakdown?.shares.find((entry) => entry.warehouseId === warehouseId);
    const figures = share ?? breakdown?.company ?? { inWarehouse: 0, checkedOut: 0, damaged: 0, maintenance: 0, missing: 0 };
    const reservedHere = warehouseId === null
      ? [...reserved.byProductWarehouse.entries()].reduce((sum, [key, value]) => (key.startsWith(`${id}:`) ? sum + value : sum), 0)
      : reserved.byProductWarehouse.get(`${id}:${warehouseId}`) ?? 0;
    return {
      productId: id,
      name: String(row.name ?? `#${id}`),
      assetCode: row.is_asset === true ? `AJN-A${String(id).padStart(6, "0")}` : null,
      barcode: row.barcode ?? null,
      isAsset: row.is_asset === true,
      trackingMode: row.tracking_mode ?? null,
      unit: String(row.unit ?? "قطعة"),
      inWarehouse: figures.inWarehouse,
      checkedOut: figures.checkedOut,
      damaged: figures.damaged,
      maintenance: figures.maintenance,
      missing: figures.missing,
      reserved: reservedHere,
      available: Math.max(0, figures.inWarehouse - reservedHere),
      companyShelf: breakdown?.company.inWarehouse ?? 0,
      overdrawn: breakdown?.overdrawn.inWarehouse ?? 0,
      shares: (breakdown?.shares ?? []).filter((entry) => entry.total > 0 || entry.isMain).map((entry) => ({ warehouseId: entry.warehouseId, name: entry.name, inWarehouse: entry.inWarehouse, total: entry.total })),
    };
  });
  const total = Number(rowsOf(counted)[0]?.total ?? 0);
  return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Every recorded stock movement. Older rows without a warehouse belong to the main warehouse. */
export async function warehouseMovementRows(
  executor: Executor,
  options: { warehouseId?: number | null; productId?: number | null; from?: string | null; to?: string | null; page?: unknown; pageSize?: unknown } = {},
) {
  const mainId = await mainWarehouseId(executor);
  const from = day(options.from), to = day(options.to);
  const pageSize = Math.max(1, Math.min(2000, Math.floor(Number(options.pageSize) || 50)));
  const page = pageOf(options.page);
  const where = sql`
    true
    ${options.warehouseId ? sql`and (coalesce(m.warehouse_id, ${mainId}) = ${options.warehouseId} or m.to_warehouse_id = ${options.warehouseId})` : sql``}
    ${options.productId ? sql`and coalesce(m.stock_source_product_id, m.product_id) = ${options.productId}` : sql``}
    ${from ? sql`and (m.created_at + interval '3 hours')::date >= ${from}::date` : sql``}
    ${to ? sql`and (m.created_at + interval '3 hours')::date <= ${to}::date` : sql``}
  `;
  const [listed, counted] = await Promise.all([
    executor.execute(sql`
      select m.id, m.product_id, coalesce(p.name_ar, p.name) as product_name, m.quantity_change, m.reason, m.movement_type, m.related_type, m.related_id,
        coalesce(m.warehouse_id, ${mainId}) as warehouse_id, w.name as warehouse_name, m.to_warehouse_id, tw.name as to_warehouse_name, m.metadata, m.created_by_name, m.created_at
      from stock_movements m
      left join products p on p.id = coalesce(m.stock_source_product_id, m.product_id)
      left join warehouses w on w.id = coalesce(m.warehouse_id, ${mainId})
      left join warehouses tw on tw.id = m.to_warehouse_id
      where ${where}
      order by m.created_at desc, m.id desc limit ${pageSize} offset ${(page - 1) * pageSize}
    `),
    executor.execute(sql`select count(*)::int as total from stock_movements m where ${where}`),
  ]);
  const data = rowsOf(listed).map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const change = Number(row.quantity_change ?? 0);
    return {
      id: Number(row.id),
      productId: row.product_id == null ? null : Number(row.product_id),
      productName: row.product_name ?? "",
      // A transfer leaves the company total alone, so its size lives in the metadata.
      quantity: row.reason === "warehouse_transfer_executed" ? Number(metadata.quantity ?? 0) : change,
      quantityChange: change,
      reason: String(row.reason ?? ""),
      relatedType: row.related_type ?? null,
      relatedId: row.related_id == null ? null : Number(row.related_id),
      warehouseId: Number(row.warehouse_id),
      warehouseName: row.warehouse_name ?? null,
      toWarehouseId: row.to_warehouse_id == null ? null : Number(row.to_warehouse_id),
      toWarehouseName: row.to_warehouse_name ?? null,
      notes: metadata.reason ?? metadata.notes ?? metadata.description ?? null,
      actorName: row.created_by_name ?? "",
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    };
  });
  const total = Number(rowsOf(counted)[0]?.total ?? 0);
  return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Items whose warehouses claim more than the company figure, plus counts that found a difference. */
export async function warehouseDiscrepancies(executor: Executor, warehouseId?: number | null) {
  const mainId = await mainWarehouseId(executor);
  const [overdrawn, counts] = await Promise.all([
    executor.execute(sql`
      select p.id, coalesce(p.name_ar, p.name) as name, p.stock::numeric::float as stock, sum(ws.quantity::numeric)::float as held
      from warehouse_stock ws join products p on p.id = ws.product_id
      where ws.warehouse_id <> ${mainId} group by p.id having sum(ws.quantity::numeric) > p.stock::numeric
      order by name limit 500
    `),
    executor.execute(sql`
      select c.id, c.count_no, c.status, c.created_at, c.requested_by_name, c.reviewed_by_name, w.name as warehouse_name, l.product_id, l.product_name, l.expected_quantity::float as expected, l.counted_quantity::float as counted, l.difference::float as difference
      from warehouse_count_lines l join warehouse_counts c on c.id = l.count_id join warehouses w on w.id = c.warehouse_id
      where l.difference <> 0 ${warehouseId ? sql`and c.warehouse_id = ${warehouseId}` : sql``}
      order by c.created_at desc, l.id limit 500
    `),
  ]);
  return {
    overdrawn: rowsOf(overdrawn).map((row) => ({ productId: Number(row.id), name: String(row.name ?? ""), company: Number(row.stock), held: Number(row.held), gap: Number(row.held) - Number(row.stock) })),
    counts: rowsOf(counts).map((row) => ({ countId: Number(row.id), countNo: row.count_no ?? null, status: String(row.status), createdAt: row.created_at ?? null, requestedByName: row.requested_by_name ?? "", reviewedByName: row.reviewed_by_name ?? "", warehouseName: String(row.warehouse_name), productId: Number(row.product_id), productName: String(row.product_name ?? ""), expected: Number(row.expected), counted: Number(row.counted), difference: Number(row.difference) })),
  };
}
