import { sql } from "drizzle-orm";
import { approveWarehouseCount, rejectWarehouseCount } from "./warehouse-counts";
import { approveWarehouseTransfer, rejectWarehouseTransfer } from "./warehouse-transfers";
import { rowsOf, WarehouseError, type Executor, type WarehouseActor } from "./warehouses";

/**
 * Keeps an approval request and its warehouse document in step, whichever side decides first.
 * The document is always locked first and the request second, so the two paths cannot deadlock.
 */
const OPEN_STATUSES = ["pending", "under_review", "pending_main_manager", "approved_by_delegate"];
const openStatuses = () => sql.join(OPEN_STATUSES.map((status) => sql`${status}`), sql`, `);

export type WarehouseDocument = "warehouse_transfer" | "warehouse_count";
type Decision = "approved" | "rejected";
type ApprovalRequest = { id: number; type: string; entityType: string | null; entityId: number | null; newValues: unknown };

/** The document a request stands for; null for every other request type, which keep their own path. */
export function warehouseApprovalDocument(request: Pick<ApprovalRequest, "type" | "entityType">): WarehouseDocument | null {
  for (const kind of ["warehouse_transfer", "warehouse_count"] as const) if (request.type === kind || request.entityType === kind) return kind;
  return null;
}

function documentId(request: ApprovalRequest, kind: WarehouseDocument) {
  if (request.entityId) return request.entityId;
  const fallback = Number((request.newValues as any)?.[kind === "warehouse_transfer" ? "transferId" : "countId"]);
  return Number.isInteger(fallback) && fallback > 0 ? fallback : null;
}

async function applyDecision(executor: Executor, kind: WarehouseDocument, id: number | null, decision: Decision, actor: WarehouseActor) {
  // An older request with no document has nothing to move and can still be closed.
  if (!id) return { executed: false, reason: kind === "warehouse_transfer" ? "missing_transfer" : "missing_count" };
  if (decision === "approved") {
    const { executed, reason } = kind === "warehouse_transfer" ? await approveWarehouseTransfer(executor, id, actor) : await approveWarehouseCount(executor, id, actor);
    return { executed, reason };
  }
  try {
    if (kind === "warehouse_transfer") await rejectWarehouseTransfer(executor, id, actor);
    else await rejectWarehouseCount(executor, id, actor);
  } catch (cause) {
    if (cause instanceof WarehouseError && cause.status === 404) return { executed: false, reason: "document_not_found" };
    throw cause;
  }
  return { executed: false, reason: "rejected" };
}

/**
 * The queue's final decision, in the caller's transaction. A refusal throws, so a stale transfer or
 * count leaves the request open and the manager sees why, instead of an approval with nothing behind it.
 */
export async function decideWarehouseApprovalRequest(executor: Executor, request: ApprovalRequest, decision: Decision, actor: WarehouseActor, note: string | null = null) {
  const kind = warehouseApprovalDocument(request);
  if (!kind) throw new WarehouseError("هذا الطلب لا يخص المخازن", 422);
  const execution = await applyDecision(executor, kind, documentId(request, kind), decision, actor);
  const closed = rowsOf(await executor.execute(sql`
    update approval_requests set status = ${decision}, reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, review_note = ${note}, reviewed_at = now(), updated_at = now()
    where id = ${request.id} and status in (${openStatuses()}) returning id
  `));
  if (!closed.length) throw new WarehouseError("تمت مراجعة هذا الطلب مسبقاً", 409);
  return execution;
}

/** A document decided on its own screen closes its open request, so the queue never offers it again. */
export async function closeWarehouseApprovalRequests(executor: Executor, kind: WarehouseDocument, id: number, decision: Decision, actor: WarehouseActor) {
  const open = rowsOf(await executor.execute(sql`
    select id, status, amount from approval_requests where entity_type = ${kind} and entity_id = ${id} and status in (${openStatuses()}) for update
  `));
  const note = "قُرّر من شاشة المخازن";
  for (const request of open) {
    await executor.execute(sql`
      update approval_requests set status = ${decision}, reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, review_note = ${note}, reviewed_at = now(), updated_at = now() where id = ${request.id}
    `);
    await executor.execute(sql`
      insert into approval_actions (approval_request_id, action, old_status, new_status, actor_staff_id, actor_name, note, amount)
      values (${request.id}, ${decision === "approved" ? "approve" : "reject"}, ${request.status}, ${decision}, ${actor.id}, ${actor.name}, ${note}, ${String(Math.max(0, Number(request.amount ?? 0) || 0))})
    `);
  }
  return open.length;
}
