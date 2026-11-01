/**
 * Rules of the generic approval queue. Warehouse transfers and counts have their own
 * transaction in warehouse-approvals.ts and never pass through here.
 */
export const OPEN_APPROVAL_STATUSES = ["pending", "under_review", "pending_main_manager", "approved_by_delegate"];
export const WAREHOUSE_APPROVAL_TYPES = ["warehouse_transfer", "warehouse_count"];

// The categories a manager ticks on the staff delegation panel. Warehouse requests stay out:
// their screens have their own permission, which a delegation must not bypass.
const CATEGORY_BY_TYPE = new Map([
  ["cancel_kosha_booking", "الإلغاءات"],
  ["cancel_service_order", "الإلغاءات"],
  ["cancel_order", "الإلغاءات"],
  ["cancel_receipt_voucher", "الإلغاءات"],
  ["cancel_payment_voucher", "الإلغاءات"],
  ["delete_product", "المخزون"],
  ["delete_document", "طلبات أخرى"],
  ["general", "طلبات أخرى"],
]);

export function approvalTypeCategory(type: string | null | undefined) {
  return CATEGORY_BY_TYPE.get(String(type ?? "")) ?? null;
}

/** Reversing a Main Cash Box movement is never delegated, so a delegate can only forward these. */
export function approvalTypeNeedsMainManager(type: string | null | undefined) {
  return type === "cancel_receipt_voucher" || type === "cancel_payment_voucher";
}

export type ApprovalExecution = { executed: boolean; reason?: string; [detail: string]: unknown };
export type ApprovalExecutionPlan = ApprovalExecution & { followUps?: Array<() => Promise<unknown>> };

export class ApprovalRequestError extends Error {
  constructor(message: string, public status: 403 | 404 | 409 = 409) {
    super(message);
    this.name = "ApprovalRequestError";
  }
}

// Already done, or a plain decision with nothing to run: the approval is still true.
const SETTLED_REASONS = new Set(["already_cancelled", "already_archived", "no_executor"]);

// A missing record means the approval would claim something that never happened.
const REFUSALS = new Map([
  ["missing_document", "لا يحدد هذا الطلب أي مستند."],
  ["document_not_found", "المستند المرتبط بهذا الطلب غير موجود."],
  ["missing_product", "لا يحدد هذا الطلب أي مادة."],
  ["product_not_found", "المادة المرتبطة بهذا الطلب غير موجودة."],
  ["missing_voucher", "لا يحدد هذا الطلب أي سند."],
  ["voucher_not_found", "السند المرتبط بهذا الطلب غير موجود."],
  ["missing_booking", "لا يحدد هذا الطلب أي حجز."],
  ["booking_not_found", "الحجز المرتبط بهذا الطلب غير موجود."],
  ["missing_service_order", "لا يحدد هذا الطلب أي حجز خدمة."],
  ["service_order_not_found", "حجز الخدمة المرتبط بهذا الطلب غير موجود."],
  ["missing_order", "لا يحدد هذا الطلب أي طلب متجر."],
  ["order_not_found", "طلب المتجر المرتبط بهذا الطلب غير موجود."],
]);

/** Null when the request may close as approved; otherwise why it stays open. */
export function approvalExecutionRefusal(execution: ApprovalExecution) {
  if (execution.executed || SETTLED_REASONS.has(String(execution.reason))) return null;
  const why = REFUSALS.get(String(execution.reason)) ?? "تعذر تنفيذ هذا الطلب.";
  return `${why} لم يتغير شيء، ويمكنك رفض الطلب لإغلاقه.`;
}

/**
 * Approves a request and runs what it stands for as one unit. Anything that fails before the
 * commit leaves the request open and reaches the manager as an error, instead of an approval
 * with nothing behind it. Follow-ups run after the commit, so they can report but never undo it.
 */
export async function runApprovalDecision<Tx, Row>(steps: {
  /** Work that cannot join the transaction. It runs first and returns how to put it back. */
  prepare: () => Promise<() => Promise<void>>;
  transaction: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Locks the request; refuses when another decision got there first. */
  lock: (tx: Tx) => Promise<void>;
  execute: (tx: Tx) => Promise<ApprovalExecutionPlan>;
  close: (tx: Tx, execution: ApprovalExecution) => Promise<Row>;
  onUndoFailed: (cause: unknown) => void;
  onFollowUpFailed: (cause: unknown) => void;
}) {
  const undo = await steps.prepare();
  let decided: { row: Row; execution: ApprovalExecution; followUps: Array<() => Promise<unknown>> };
  try {
    decided = await steps.transaction(async (tx) => {
      await steps.lock(tx);
      const { followUps = [], ...execution } = await steps.execute(tx);
      const refusal = approvalExecutionRefusal(execution);
      if (refusal) throw new ApprovalRequestError(refusal);
      return { row: await steps.close(tx, execution), execution, followUps };
    });
  } catch (cause) {
    await undo().catch(steps.onUndoFailed);
    throw cause;
  }
  let followUpFailed = false;
  for (const followUp of decided.followUps) {
    try {
      await followUp();
    } catch (cause) {
      followUpFailed = true;
      steps.onFollowUpFailed(cause);
    }
  }
  return { row: decided.row, execution: followUpFailed ? { ...decided.execution, followUpFailed } : decided.execution };
}
