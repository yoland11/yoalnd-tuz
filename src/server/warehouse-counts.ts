import { sql } from "drizzle-orm";
import { adjustQuantityAsset } from "./quantity-assets";
import { applyWarehouseDeltas, requireActiveWarehouse, rowsOf, shelfCompany, warehouseBreakdowns, WarehouseError, type Executor, type WarehouseActor } from "./warehouses";

export type WarehouseCountInput = {
  warehouseId: unknown;
  lines: unknown;
  notes?: unknown;
  requestToken: unknown;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export async function warehouseCountDetail(executor: Executor, id: number) {
  const row = rowsOf(await executor.execute(sql`
    select c.*, w.name as warehouse_name from warehouse_counts c join warehouses w on w.id = c.warehouse_id where c.id = ${id}
  `))[0];
  if (!row) throw new WarehouseError("الجرد غير موجود", 404);
  const lines = rowsOf(await executor.execute(sql`select * from warehouse_count_lines where count_id = ${id} order by id`));
  return {
    id: Number(row.id),
    countNo: row.count_no ?? null,
    warehouseId: Number(row.warehouse_id),
    warehouseName: String(row.warehouse_name),
    status: String(row.status),
    notes: row.notes ?? null,
    requestedByName: row.requested_by_name ?? "",
    reviewedByName: row.reviewed_by_name ?? "",
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at ?? null,
    lines: lines.map((line) => ({
      productId: Number(line.product_id),
      productName: String(line.product_name ?? ""),
      expected: Number(line.expected_quantity),
      counted: Number(line.counted_quantity),
      difference: Number(line.difference),
    })),
  };
}

export async function listWarehouseCounts(executor: Executor, warehouseId?: number | null) {
  const rows = rowsOf(await executor.execute(sql`
    select c.id, c.count_no, c.warehouse_id, w.name as warehouse_name, c.status, c.requested_by_name, c.reviewed_by_name, c.created_at,
      (select count(*)::int from warehouse_count_lines l where l.count_id = c.id) as line_count,
      (select count(*)::int from warehouse_count_lines l where l.count_id = c.id and l.difference <> 0) as difference_count
    from warehouse_counts c join warehouses w on w.id = c.warehouse_id
    ${warehouseId ? sql`where c.warehouse_id = ${warehouseId}` : sql``}
    order by c.created_at desc, c.id desc limit 100
  `));
  return rows.map((row) => ({
    id: Number(row.id), countNo: row.count_no ?? null, warehouseId: Number(row.warehouse_id), warehouseName: String(row.warehouse_name), status: String(row.status),
    requestedByName: row.requested_by_name ?? "", reviewedByName: row.reviewed_by_name ?? "", createdAt: row.created_at ?? null, lineCount: Number(row.line_count), differenceCount: Number(row.difference_count),
  }));
}

/**
 * Records what staff counted against this warehouse's balance. Nothing changes until a
 * manager approves; a count with no difference closes itself as matched.
 */
export async function createWarehouseCount(executor: Executor, input: WarehouseCountInput, actor: WarehouseActor) {
  const token = typeof input.requestToken === "string" ? input.requestToken.trim().slice(0, 120) : "";
  if (token.length < 8) throw new WarehouseError("رمز الطلب غير صالح", 422);
  const prior = rowsOf(await executor.execute(sql`select id from warehouse_counts where request_token = ${token} limit 1`))[0];
  if (prior) return { ...(await warehouseCountDetail(executor, Number(prior.id))), replayed: true };
  const warehouseId = Number(input.warehouseId);
  if (!Number.isSafeInteger(warehouseId) || warehouseId <= 0) throw new WarehouseError("اختر المخزن", 422);
  await requireActiveWarehouse(executor, warehouseId);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length || lines.length > 500) throw new WarehouseError("أضف مادة واحدة على الأقل للجرد، بحد أقصى 500", 422);
  const parsed = lines.map((raw: any) => ({ productId: Number(raw?.productId), counted: Number(raw?.countedQuantity) }));
  if (parsed.some((line) => !Number.isSafeInteger(line.productId) || line.productId <= 0 || !Number.isFinite(line.counted) || line.counted < 0))
    throw new WarehouseError("أدخل كمية معدودة صحيحة لكل مادة", 422);
  if (new Set(parsed.map((line) => line.productId)).size !== parsed.length) throw new WarehouseError("مادة مكررة في الجرد", 422);
  const ids = parsed.map((line) => line.productId);
  const breakdowns = await warehouseBreakdowns(executor, ids);
  const named = rowsOf(await executor.execute(sql`
    select p.id, coalesce(p.name_ar, p.name) as name,
      exists (select 1 from asset_quantity_profiles q where q.product_id = p.id) as quantity_tracked,
      exists (select 1 from product_variants v where v.product_id = p.id) as has_variants
    from products p where p.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `));
  const byId = new Map(named.map((row) => [Number(row.id), row]));
  const details = parsed.map((line) => {
    const product = byId.get(line.productId);
    const share = breakdowns.get(line.productId)?.shares.find((row) => row.warehouseId === warehouseId);
    if (!product || !share) throw new WarehouseError(`المادة #${line.productId} غير موجودة`, 404);
    if (product.has_variants === true) throw new WarehouseError(`«${product.name}» لها مقاسات؛ جردها من شاشة المقاسات`, 422);
    if (product.quantity_tracked === true && !Number.isInteger(line.counted)) throw new WarehouseError(`«${product.name}» يُعد بالقطعة`, 422);
    return { ...line, name: String(product.name ?? ""), expected: share.inWarehouse, difference: round3(line.counted - share.inWarehouse) };
  });
  const status = details.some((line) => line.difference !== 0) ? "pending" : "matched";
  const notes = input.notes == null ? null : String(input.notes).trim().slice(0, 2000) || null;
  const header = rowsOf(await executor.execute(sql`
    insert into warehouse_counts (warehouse_id, status, notes, request_token, requested_by, requested_by_name)
    values (${warehouseId}, ${status}, ${notes}, ${token}, ${actor.id}, ${actor.name}) returning id
  `))[0];
  const id = Number(header.id);
  await executor.execute(sql`update warehouse_counts set count_no = ${`WCT-${String(id).padStart(6, "0")}`} where id = ${id}`);
  for (const line of details)
    await executor.execute(sql`
      insert into warehouse_count_lines (count_id, product_id, product_name, expected_quantity, counted_quantity, difference)
      values (${id}, ${line.productId}, ${line.name}, ${String(line.expected)}, ${String(line.counted)}, ${String(line.difference)})
    `);
  return { ...(await warehouseCountDetail(executor, id)), replayed: false };
}

/**
 * Applies every line in one transaction. A balance that moved after counting is refused rather
 * than overwritten, because the count no longer describes the shelf. Quantity assets go through
 * their own adjustment path, so valuation and history stay as they are for any other count.
 */
export async function approveWarehouseCount(executor: Executor, id: number, actor: WarehouseActor) {
  const header = rowsOf(await executor.execute(sql`select * from warehouse_counts where id = ${id} for update`))[0];
  if (!header) throw new WarehouseError("الجرد غير موجود", 404);
  if (header.status !== "pending") {
    if (header.status === "rejected") throw new WarehouseError("هذا الجرد مرفوض", 409);
    return { executed: false, reason: "already_applied" };
  }
  const warehouseId = Number(header.warehouse_id);
  await requireActiveWarehouse(executor, warehouseId);
  const lines = rowsOf(await executor.execute(sql`select * from warehouse_count_lines where count_id = ${id} order by product_id`));
  for (const line of lines) {
    const productId = Number(line.product_id);
    await executor.execute(sql`select id from products where id = ${productId} for update`);
    const breakdown = (await warehouseBreakdowns(executor, [productId])).get(productId);
    const share = breakdown?.shares.find((row) => row.warehouseId === warehouseId);
    if (!breakdown || !share) throw new WarehouseError(`المادة #${productId} غير موجودة`, 404);
    if (share.inWarehouse !== Number(line.expected_quantity))
      throw new WarehouseError(`تغيّر رصيد «${line.product_name}» بعد الجرد (الآن ${share.inWarehouse}). أعد جرد هذه المادة.`, 409);
    const difference = Number(line.difference);
    if (difference === 0) continue;
    const reason = `جرد مخزن ${header.count_no ?? id}`;
    const tracked = rowsOf(await executor.execute(sql`select 1 from asset_quantity_profiles where product_id = ${productId}`)).length > 0;
    if (tracked) {
      await adjustQuantityAsset(executor as any, {
        productId, kind: "count", quantity: 0, countedQuantity: Number(line.counted_quantity), reason,
        relatedType: "warehouse_count", relatedId: id, warehouseId, requestId: `wcount:${id}:${productId}`, actor,
      });
      continue;
    }
    const updated = rowsOf(await executor.execute(sql`
      update products set stock = stock::numeric + ${difference}, updated_at = now() where id = ${productId} and stock::numeric + ${difference} >= 0 returning stock
    `))[0];
    if (!updated) throw new WarehouseError(`رصيد «${line.product_name}» لا يكفي لهذه التسوية`, 409);
    await applyWarehouseDeltas(executor, { productId, company: shelfCompany(updated.stock), deltas: [{ warehouseId, inWarehouse: difference }] });
    await executor.execute(sql`
      insert into stock_movements (product_id, stock_source_product_id, quantity_change, reason, related_type, related_id, warehouse_id, movement_type, idempotency_key, metadata, created_by, created_by_name)
      values (${productId}, ${productId}, ${String(difference)}, 'warehouse_count_adjustment', 'warehouse_count', ${id}, ${warehouseId}, 'warehouse_count', ${`wcount:${id}:${productId}`},
        ${JSON.stringify({ expected: Number(line.expected_quantity), counted: Number(line.counted_quantity), countNo: header.count_no })}::jsonb, ${actor.id}, ${actor.name})
    `);
  }
  await executor.execute(sql`
    update warehouse_counts set status = 'approved', reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, reviewed_at = now(), updated_at = now() where id = ${id}
  `);
  await executor.execute(sql`
    insert into entity_timeline (entity_type, entity_id, type, title, body, actor_id, actor_name, metadata)
    values ('warehouse_count', ${id}, 'warehouse_count_approved', 'تم اعتماد جرد المخزن', ${String(header.count_no ?? id)}, ${actor.id}, ${actor.name}, ${JSON.stringify({ warehouseId })}::jsonb)
  `);
  return { executed: true };
}

export async function rejectWarehouseCount(executor: Executor, id: number, actor: WarehouseActor) {
  const header = rowsOf(await executor.execute(sql`select status from warehouse_counts where id = ${id} for update`))[0];
  if (!header) throw new WarehouseError("الجرد غير موجود", 404);
  if (header.status === "approved") throw new WarehouseError("اعتُمد هذا الجرد؛ لا يمكن رفضه", 409);
  if (header.status === "pending")
    await executor.execute(sql`
      update warehouse_counts set status = 'rejected', reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, reviewed_at = now(), updated_at = now() where id = ${id}
    `);
}
