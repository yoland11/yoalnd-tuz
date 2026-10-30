import { sql } from "drizzle-orm";
import { lineForWarehouse, planWarehouseTransfer } from "../lib/warehouse-stock";
import { baghdadDay, peakCommitment, quantityCommitmentRows } from "./quantity-assets";
import { applyWarehouseDeltas, mainWarehouseId, requireActiveWarehouse, rowsOf, warehouseShare, WarehouseError, type Executor, type WarehouseActor } from "./warehouses";

export type WarehouseTransferInput = {
  productId: unknown;
  fromWarehouseId: unknown;
  toWarehouseId: unknown;
  quantity: unknown;
  responsibleStaffId?: unknown;
  transferDate?: unknown;
  notes?: unknown;
  requestToken?: unknown;
};

const positiveId = (value: unknown) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** A shared-stock product draws on its owner, so balances live on the owner. */
async function stockOwner(executor: Executor, productId: number) {
  const row = rowsOf(await executor.execute(sql`
    with recursive chain as (
      select id, shared_stock_product_id, coalesce(name_ar, name) as name, 0 as depth from products where id = ${productId}
      union all
      select p.id, p.shared_stock_product_id, coalesce(p.name_ar, p.name), c.depth + 1
      from products p join chain c on p.id = c.shared_stock_product_id where c.depth < 10
    )
    select id, name from chain where shared_stock_product_id is null order by depth desc limit 1
  `))[0];
  if (!row) throw new WarehouseError("المنتج غير موجود", 404);
  return { id: Number(row.id), name: String(row.name ?? `#${productId}`) };
}

/** Units the source warehouse has promised: booking lines allocated to it plus store-product holds. */
export async function sourceCommitment(executor: Executor, productId: number, warehouseId: number, usable: number) {
  const mainId = await mainWarehouseId(executor);
  const held = rowsOf(await executor.execute(sql`
    select coalesce(sum(quantity), 0) as quantity from stock_reservations
    where product_id = ${productId} and status = 'reserved' and coalesce(warehouse_id, ${mainId}) = ${warehouseId}
  `))[0];
  const holds = Number(held?.quantity ?? 0);
  const rows = (await quantityCommitmentRows(executor as any, [productId])).get(productId) ?? [];
  const scoped = rows.flatMap((row) => {
    const line = lineForWarehouse(row.line, warehouseId, mainId);
    return line ? [{ ...row, line }] : [];
  });
  if (!scoped.length) return holds;
  const peak = peakCommitment(
    scoped,
    { inWarehouse: usable, checkedOut: 0, damaged: 0, maintenance: 0, missing: 0 },
    baghdadDay(),
    holds,
  );
  return Math.max(peak, holds);
}

async function requireTransferValues(executor: Executor, input: WarehouseTransferInput) {
  const productId = positiveId(input.productId);
  if (!productId) throw new WarehouseError("اختر المادة أو الأصل المراد تحويله", 422);
  const fromWarehouseId = positiveId(input.fromWarehouseId);
  const toWarehouseId = positiveId(input.toWarehouseId);
  const quantity = Number(input.quantity);
  const owner = await stockOwner(executor, productId);
  if (fromWarehouseId) await requireWarehouse(executor, fromWarehouseId);
  if (toWarehouseId) await requireActiveWarehouse(executor, toWarehouseId);
  return { productId, owner, fromWarehouseId, toWarehouseId, quantity };
}

async function requireWarehouse(executor: Executor, id: number) {
  if (!rowsOf(await executor.execute(sql`select id from warehouses where id = ${id}`)).length) throw new WarehouseError("المخزن غير موجود", 404);
}

async function planFor(executor: Executor, values: Awaited<ReturnType<typeof requireTransferValues>>) {
  const source = values.fromWarehouseId ? await warehouseShare(executor, values.owner.id, values.fromWarehouseId) : null;
  const usable = source ? source.share.inWarehouse + source.share.checkedOut : 0;
  const committed = source && values.fromWarehouseId ? await sourceCommitment(executor, values.owner.id, values.fromWarehouseId, usable) : 0;
  return {
    source,
    plan: planWarehouseTransfer({
      fromWarehouseId: values.fromWarehouseId,
      toWarehouseId: values.toWarehouseId,
      quantity: values.quantity,
      sourceShelf: source?.share.inWarehouse ?? 0,
      sourceUsable: usable,
      sourceCommitted: committed,
    }),
  };
}

/**
 * Records the request only: stock moves when it is approved. A repeated submit with the same
 * token returns the first transfer. The stock check here is advisory and is repeated at approval.
 */
export async function createWarehouseTransfer(executor: Executor, input: WarehouseTransferInput, actor: WarehouseActor) {
  const token = typeof input.requestToken === "string" && input.requestToken.trim() ? input.requestToken.trim().slice(0, 120) : null;
  if (token) {
    const existing = rowsOf(await executor.execute(sql`select * from warehouse_transfers where idempotency_key = ${token} limit 1`))[0];
    if (existing) return { row: existing, replayed: true };
  }
  const values = await requireTransferValues(executor, input);
  const { plan } = await planFor(executor, values);
  if (!plan.ok) throw new WarehouseError(plan.message, plan.status);
  const responsible = positiveId(input.responsibleStaffId);
  const date = typeof input.transferDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.transferDate) ? input.transferDate : null;
  const notes = input.notes == null ? null : String(input.notes).trim().slice(0, 2000) || null;
  const draft = rowsOf(await executor.execute(sql`
    insert into warehouse_transfers (transfer_no, product_id, product_name, from_warehouse_id, to_warehouse_id, quantity, status, requested_by, requested_by_name, notes, responsible_staff_id, transfer_date, idempotency_key)
    values (${`WTR-TMP-${crypto.randomUUID()}`}, ${values.owner.id}, ${values.owner.name}, ${values.fromWarehouseId}, ${values.toWarehouseId}, ${values.quantity}, 'pending', ${actor.id}, ${actor.name}, ${notes}, ${responsible}, ${date}, ${token})
    returning id
  `))[0];
  const transferNo = `WTR-${String(draft.id).padStart(6, "0")}`;
  const row = rowsOf(await executor.execute(sql`update warehouse_transfers set transfer_no = ${transferNo} where id = ${draft.id} returning *`))[0];
  return { row, replayed: false };
}

/**
 * Approves and moves stock in one transaction, under the transfer and product locks. Only a
 * pending transfer moves anything, so a double click or a second approval route cannot repeat it.
 * The company total stays as it is, and no sale, purchase or cash movement is created.
 */
export async function approveWarehouseTransfer(executor: Executor, transferId: number, actor: WarehouseActor) {
  const row = rowsOf(await executor.execute(sql`select * from warehouse_transfers where id = ${transferId} for update`))[0];
  if (!row) throw new WarehouseError("التحويل غير موجود", 404);
  if (row.status !== "pending") {
    if (row.status === "rejected") throw new WarehouseError("هذا التحويل مرفوض", 409);
    return { executed: false, reason: "already_executed", row };
  }
  const productId = positiveId(row.product_id);
  if (!productId) throw new WarehouseError("هذا التحويل القديم بلا مادة محددة؛ ارفضه وأنشئ تحويلاً جديداً", 409);
  const values = await requireTransferValues(executor, { productId, fromWarehouseId: row.from_warehouse_id, toWarehouseId: row.to_warehouse_id, quantity: row.quantity });
  await executor.execute(sql`select id from products where id = ${values.owner.id} for update`);
  const { plan, source } = await planFor(executor, values);
  if (!plan.ok) throw new WarehouseError(plan.message, plan.status);
  await applyWarehouseDeltas(executor, { productId: values.owner.id, company: source!.breakdown.company, deltas: plan.deltas });
  // One marker row per transfer. Its quantity_change is 0 because the company total did not change.
  await executor.execute(sql`
    insert into stock_movements (product_id, stock_source_product_id, quantity_change, reason, related_type, related_id, warehouse_id, to_warehouse_id, movement_type, metadata, created_by, created_by_name)
    values (${values.owner.id}, ${values.owner.id}, '0', 'warehouse_transfer_executed', 'warehouse_transfer', ${transferId}, ${values.fromWarehouseId}, ${values.toWarehouseId}, 'warehouse_transfer',
      ${JSON.stringify({ quantity: values.quantity, transferNo: row.transfer_no, notes: row.notes ?? null })}::jsonb, ${actor.id}, ${actor.name})
  `);
  // An individual asset has one location: it follows the unit when none stays behind.
  const remaining = source!.share.inWarehouse - values.quantity;
  if (remaining <= 0) {
    const mainId = await mainWarehouseId(executor);
    await executor.execute(sql`update asset_passports set warehouse_id = ${values.toWarehouseId}, updated_at = now() where product_id = ${values.owner.id} and coalesce(warehouse_id, ${mainId}) = ${values.fromWarehouseId}`);
  }
  const updated = rowsOf(await executor.execute(sql`
    update warehouse_transfers set status = 'approved', reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, reviewed_at = now(), executed_at = now(), updated_at = now()
    where id = ${transferId} returning *
  `))[0];
  await executor.execute(sql`
    insert into entity_timeline (entity_type, entity_id, type, title, body, actor_id, actor_name, metadata)
    values ('warehouse_transfer', ${transferId}, 'warehouse_transfer_executed', 'تم تنفيذ التحويل المخزني', ${`${row.product_name} × ${values.quantity}`}, ${actor.id}, ${actor.name},
      ${JSON.stringify({ fromWarehouseId: values.fromWarehouseId, toWarehouseId: values.toWarehouseId, productId: values.owner.id })}::jsonb)
  `);
  return { executed: true, row: updated };
}

export async function rejectWarehouseTransfer(executor: Executor, transferId: number, actor: WarehouseActor) {
  const row = rowsOf(await executor.execute(sql`select status from warehouse_transfers where id = ${transferId} for update`))[0];
  if (!row) throw new WarehouseError("التحويل غير موجود", 404);
  if (row.status === "approved") throw new WarehouseError("نُفّذ هذا التحويل؛ لا يمكن رفضه. سجّل تحويلاً معاكساً إذا لزم", 409);
  if (row.status === "rejected") return rowsOf(await executor.execute(sql`select * from warehouse_transfers where id = ${transferId}`))[0];
  return rowsOf(await executor.execute(sql`
    update warehouse_transfers set status = 'rejected', reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, reviewed_at = now(), updated_at = now()
    where id = ${transferId} returning *
  `))[0];
}
