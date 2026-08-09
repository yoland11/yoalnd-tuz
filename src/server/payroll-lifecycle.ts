/** One lifecycle definition shared by payroll APIs and UI. */
export const PAYROLL_LIFECYCLE_STATUSES = [
  "draft", "calculated", "under_review", "pending_manager_approval", "approved",
  "ready_to_pay", "partially_paid", "paid", "closed", "cancelled", "reopened",
  "rejected", "processing", "reversed",
] as const;

export type PayrollLifecycleStatus = (typeof PAYROLL_LIFECYCLE_STATUSES)[number];

const transitions: Record<PayrollLifecycleStatus, readonly PayrollLifecycleStatus[]> = {
  draft: ["calculated", "under_review", "cancelled"],
  calculated: ["under_review", "pending_manager_approval", "cancelled"],
  under_review: ["pending_manager_approval", "reopened", "cancelled"],
  pending_manager_approval: ["approved", "rejected", "reopened", "cancelled"],
  approved: ["ready_to_pay", "reopened", "cancelled"],
  ready_to_pay: ["partially_paid", "paid", "reopened", "cancelled"],
  partially_paid: ["paid"],
  paid: ["closed"],
  closed: [],
  cancelled: ["reopened"],
  reopened: ["draft", "calculated", "under_review", "pending_manager_approval", "cancelled"],
  rejected: ["reopened", "under_review", "cancelled"],
  processing: ["ready_to_pay", "partially_paid", "paid"],
  reversed: ["reopened"],
};

export function canTransitionPayroll(current: string, next: string) {
  if (current === next) return true;
  return (transitions[current as PayrollLifecycleStatus] ?? []).includes(next as PayrollLifecycleStatus);
}

/** Values are editable only while no posting is permitted. */
export function canEditPayroll(current: string) {
  return ["draft", "calculated", "under_review", "reopened", "rejected"].includes(current);
}

export function payrollStatusLabel(status: string) {
  return ({
    draft: "مسودة", calculated: "محسوبة", under_review: "قيد المراجعة",
    pending_manager_approval: "بانتظار الاعتماد", approved: "معتمدة",
    ready_to_pay: "جاهزة للصرف", partially_paid: "مصروفة جزئياً", paid: "مصروفة",
    closed: "مقفلة", cancelled: "ملغاة", reopened: "أعيد فتحها", rejected: "مرفوضة",
    processing: "قيد الصرف", reversed: "معكوسة",
  } as Record<string, string>)[status] ?? status;
}
