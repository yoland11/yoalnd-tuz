/**
 * Work command center rules shared by the server, the UI and the tests.
 * A work order is an existing task (tasks table); these rules only describe
 * how the command center presents and moves it.
 */

export const WORK_DEPARTMENTS = [
  { key: "general", label: "الإدارة العامة" },
  { key: "editing", label: "المونتاج" },
  { key: "photography", label: "التصوير" },
  { key: "printing", label: "الطباعة" },
  { key: "graduation", label: "التخرج" },
  { key: "koshas", label: "الكوشات" },
  { key: "warehouse", label: "المستودع" },
  { key: "delivery", label: "التوصيل" },
] as const;
export type WorkDepartment = (typeof WORK_DEPARTMENTS)[number]["key"];

const DEPARTMENT_ALIASES: Record<string, WorkDepartment> = {
  general: "general", management: "general", admin: "general", "الإدارة": "general", "الإدارة العامة": "general", "عام": "general",
  editing: "editing", montage: "editing", "مونتاج": "editing", "المونتاج": "editing",
  photography: "photography", photo: "photography", camera: "photography", "تصوير": "photography", "التصوير": "photography", "المصورين": "photography",
  printing: "printing", print: "printing", "طباعة": "printing", "الطباعة": "printing",
  graduation: "graduation", tailoring: "graduation", "تخرج": "graduation", "التخرج": "graduation", "تجهيزات": "graduation", "الخياطة": "graduation", "التطريز": "graduation",
  koshas: "koshas", kosha: "koshas", koshat: "koshas", decor: "koshas", "كوشة": "koshas", "الكوشات": "koshas",
  warehouse: "warehouse", inventory: "warehouse", store: "warehouse", "مستودع": "warehouse", "المستودع": "warehouse", "المخزن": "warehouse",
  delivery: "delivery", transport: "delivery", transportation: "delivery", "توصيل": "delivery", "التوصيل": "delivery", "النقل": "delivery",
};

export function workDepartment(value: unknown): WorkDepartment {
  const key = String(value ?? "").trim().toLowerCase();
  return DEPARTMENT_ALIASES[key] ?? "general";
}

export function departmentLabel(value: unknown) {
  return WORK_DEPARTMENTS.find((item) => item.key === workDepartment(value))?.label ?? "الإدارة العامة";
}

export const PRIORITY_LABELS: Record<string, string> = { low: "منخفضة", medium: "متوسطة", high: "عالية", urgent: "عاجلة" };

export type WorkOrderStatus = "new" | "accepted" | "in_progress" | "needs_rework" | "review" | "done" | "approved" | "cancelled";

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  new: "جديد",
  accepted: "تم الاستلام",
  in_progress: "جاري التنفيذ",
  needs_rework: "يحتاج تعديل",
  review: "بانتظار الاعتماد",
  done: "تم الإنجاز",
  approved: "مكتمل ومعتمد",
  cancelled: "ملغي",
};

/** Display status from the authoritative task row (no second status field). */
export function workOrderStatus(task: { status: string; rejectionReason?: string | null; approvedBy?: number | null }): WorkOrderStatus {
  switch (task.status) {
    case "new":
      return "new";
    case "accepted":
      return task.rejectionReason ? "needs_rework" : "accepted";
    case "in_progress":
      return task.rejectionReason ? "needs_rework" : "in_progress";
    case "review":
      return "review";
    case "completed":
      return task.approvedBy ? "approved" : "done";
    case "cancelled":
      return "cancelled";
    default:
      return "in_progress";
  }
}

export const ACTIVE_TASK_STATUSES = ["new", "accepted", "in_progress"];

export function isOverdue(task: { status: string; dueAt: string | Date | null }, now = new Date()) {
  if (!task.dueAt || !ACTIVE_TASK_STATUSES.includes(task.status)) return false;
  return new Date(task.dueAt).getTime() < now.getTime();
}

export function isDueSoon(task: { status: string; dueAt: string | Date | null }, now = new Date(), windowMinutes = 120) {
  if (!task.dueAt || !ACTIVE_TASK_STATUSES.includes(task.status)) return false;
  const remaining = new Date(task.dueAt).getTime() - now.getTime();
  return remaining > 0 && remaining <= windowMinutes * 60_000;
}

export const WORK_ORDER_ACTIONS = [
  "acknowledge",
  "start",
  "complete",
  "help",
  "request_extension",
  "decide_extension",
  "approve",
  "return",
  "cancel",
  "reassign",
] as const;
export type WorkOrderAction = (typeof WORK_ORDER_ACTIONS)[number];

export const WORK_ORDER_ACTION_LABELS: Record<WorkOrderAction, string> = {
  acknowledge: "استلام الأمر",
  start: "بدء العمل",
  complete: "تم الإنجاز",
  help: "طلب مساعدة",
  request_extension: "أحتاج وقت إضافي",
  decide_extension: "قرار التمديد",
  approve: "اعتماد الإنجاز",
  return: "إرجاع للتعديل",
  cancel: "إلغاء الأمر",
  reassign: "تغيير المسؤول",
};

export type ActionContext = {
  status: string;
  isAssignee: boolean;
  canManage: boolean;
  hasPendingExtension: boolean;
};

/** Every action allowed in the current state; the server re-checks each one. */
export function allowedActions(context: ActionContext): WorkOrderAction[] {
  const actions: WorkOrderAction[] = [];
  const active = ACTIVE_TASK_STATUSES.includes(context.status);
  if (context.isAssignee) {
    if (context.status === "new") actions.push("acknowledge");
    if (context.status === "accepted") actions.push("start");
    if (["accepted", "in_progress"].includes(context.status)) actions.push("complete");
    if (active || context.status === "review") actions.push("help");
    if (active && !context.hasPendingExtension) actions.push("request_extension");
  }
  if (context.canManage) {
    if (context.status === "review") actions.push("approve", "return");
    if (context.hasPendingExtension) actions.push("decide_extension");
    if (active || context.status === "review") actions.push("reassign", "cancel");
  }
  return actions;
}

/** Reason why an action is invalid now, or null when it may proceed. */
export function transitionProblem(action: WorkOrderAction, context: ActionContext): string | null {
  if (allowedActions(context).includes(action)) return null;
  const assigneeOnly: WorkOrderAction[] = ["acknowledge", "start", "complete", "help", "request_extension"];
  if (assigneeOnly.includes(action) && !context.isAssignee) return "هذا الإجراء للموظف المسؤول عن الأمر فقط";
  if (!assigneeOnly.includes(action) && !context.canManage) return "هذا الإجراء للإدارة فقط";
  if (action === "start" && context.status === "new") return "استلم الأمر أولاً قبل بدء العمل";
  if (action === "decide_extension") return "لا يوجد طلب تمديد بانتظار القرار";
  if (action === "request_extension" && context.hasPendingExtension) return "يوجد طلب تمديد بانتظار القرار";
  return `لا يمكن «${WORK_ORDER_ACTION_LABELS[action]}» والأمر بحالة «${WORK_ORDER_STATUS_LABELS[workOrderStatus({ status: context.status })]}»`;
}

export type WorkOrderTemplate = {
  key: string;
  label: string;
  department: WorkDepartment;
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  estimatedMinutes: number;
  checklist: string[];
  evidenceRequired: boolean;
  evidenceHint: string;
  requiresApproval: boolean;
  needsBooking: boolean;
};

export const WORK_ORDER_TEMPLATES: WorkOrderTemplate[] = [
  { key: "editing", label: "أمر مونتاج", department: "editing", title: "مونتاج فيديو", priority: "high", estimatedMinutes: 480, checklist: ["استلام الملفات", "المونتاج", "الصوت والألوان", "تصدير النسخة النهائية"], evidenceRequired: true, evidenceHint: "رابط الفيديو النهائي", requiresApproval: true, needsBooking: true },
  { key: "photo_retouch", label: "أمر تعديل صور", department: "photography", title: "تعديل صور", priority: "medium", estimatedMinutes: 240, checklist: ["فرز الصور", "التعديل", "التسليم"], evidenceRequired: true, evidenceHint: "الصور المعدلة أو رابط التسليم", requiresApproval: true, needsBooking: true },
  { key: "printing", label: "أمر طباعة", department: "printing", title: "طباعة", priority: "medium", estimatedMinutes: 60, checklist: ["تجهيز الملفات", "الطباعة", "فحص الجودة"], evidenceRequired: true, evidenceHint: "صورة المطبوعات", requiresApproval: false, needsBooking: false },
  { key: "album_design", label: "أمر تصميم ألبوم", department: "printing", title: "تصميم ألبوم", priority: "medium", estimatedMinutes: 600, checklist: ["اختيار الصور", "التصميم", "مراجعة الزبون"], evidenceRequired: true, evidenceHint: "ملف التصميم", requiresApproval: true, needsBooking: true },
  { key: "kosha_setup", label: "أمر تجهيز كوشة", department: "koshas", title: "تجهيز كوشة", priority: "high", estimatedMinutes: 240, checklist: ["تجهيز المعدات", "التحميل", "التنصيب"], evidenceRequired: true, evidenceHint: "صورة بعد التنصيب", requiresApproval: false, needsBooking: true },
  { key: "vehicle_loading", label: "أمر تحميل مركبة", department: "warehouse", title: "تحميل مركبة", priority: "high", estimatedMinutes: 60, checklist: ["مطابقة قائمة المعدات", "التحميل", "التثبيت"], evidenceRequired: false, evidenceHint: "صورة الحمولة (اختياري)", requiresApproval: false, needsBooking: true },
  { key: "sewing", label: "أمر خياطة", department: "graduation", title: "خياطة", priority: "medium", estimatedMinutes: 480, checklist: ["القص", "الخياطة", "الفحص"], evidenceRequired: true, evidenceHint: "صورة الملابس الجاهزة", requiresApproval: false, needsBooking: false },
  { key: "embroidery", label: "أمر تطريز", department: "graduation", title: "تطريز", priority: "medium", estimatedMinutes: 240, checklist: ["تجهيز التصميم", "التطريز", "التدقيق"], evidenceRequired: true, evidenceHint: "صورة التطريز", requiresApproval: false, needsBooking: false },
  { key: "delivery", label: "أمر توصيل", department: "delivery", title: "توصيل", priority: "medium", estimatedMinutes: 120, checklist: ["الاستلام من المخزن", "التوصيل", "تأكيد التسليم"], evidenceRequired: false, evidenceHint: "صورة التسليم (اختياري)", requiresApproval: false, needsBooking: false },
];

export function workOrderTemplate(key: unknown) {
  return WORK_ORDER_TEMPLATES.find((template) => template.key === key) ?? null;
}

/** Parent progress counts mandatory subtasks only; cancelled ones are ignored. */
export function subtaskProgress(subtasks: Array<{ status: string; mandatory: boolean }>) {
  const relevant = subtasks.filter((item) => item.mandatory && item.status !== "cancelled");
  const completed = relevant.filter((item) => item.status === "completed").length;
  return {
    total: relevant.length,
    completed,
    percent: relevant.length ? Math.round((completed / relevant.length) * 100) : 100,
    blocking: relevant.length - completed,
  };
}

/**
 * Local, provider-independent field extraction from a written or transcribed
 * text. Nothing is sent anywhere; every value is shown for confirmation.
 */
const fold = (value: string) => value.replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

export function extractWorkOrderFields(
  text: string,
  staff: Array<{ id: number; name: string }>,
  now: Date,
) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  const result: {
    title: string | null;
    description: string;
    assigneeIds: number[];
    bookingId: number | null;
    dueAt: string | null;
    templateKey: string | null;
    notes: string[];
  } = { title: null, description: source, assigneeIds: [], bookingId: null, dueAt: null, templateKey: null, notes: [] };
  if (!source) return result;
  const normalized = source.replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  for (const member of staff) {
    const first = member.name.trim().split(/\s+/)[0];
    if (first && first.length >= 2) {
      const pattern = new RegExp(`(^|[\\s،,.])${first.replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")}($|[\\s،,.])`);
      if (pattern.test(normalized)) result.assigneeIds.push(member.id);
    }
  }
  if (result.assigneeIds.length > 1) result.notes.push("ذُكر أكثر من موظف؛ تأكد من المسؤول.");
  const booking = /(?:حجز|الحجز|#)\s*(\d{1,7})/.exec(source);
  if (booking) result.bookingId = Number(booking[1]);
  const keywords: Array<[RegExp, string]> = [
    [/مونتاج/, "editing"], [/تعديل\s*(?:ال)?صور/, "photo_retouch"], [/البوم|ألبوم/, "album_design"], [/طباع/, "printing"],
    [/كوش/, "kosha_setup"], [/تحميل|مركبه|مركبة/, "vehicle_loading"], [/خياط/, "sewing"], [/تطريز/, "embroidery"], [/توصيل/, "delivery"],
  ];
  for (const [pattern, key] of keywords)
    if (pattern.test(normalized)) {
      result.templateKey = key;
      break;
    }
  const template = workOrderTemplate(result.templateKey);
  // Title: the work after the verb («يخلص مونتاج حجز 120»), else after «أريد»,
  // with employee names removed; the template title is the fallback.
  const stop = String.raw`(?=\s+(?:قبل|باچر|باكر|بكره|بكرة|غدا|غداً|اليوم|الساعه|الساعة)|[،,.]|$)`;
  const verb = new RegExp(String.raw`(?:يخلص|يكمل|يسوي|يجهز|يطبع|يعدل|يصمم|يوصل|يحمل|تخلص|تكمل|تسوي|تجهز)\s+([^،,.]+?)${stop}`).exec(source);
  const subject = new RegExp(String.raw`(?:اريد|أريد|نريد|سوي|سويلي|اسوي)\s+([^،,.]+?)(?=\s+(?:يخلص|يكمل|يسوي|يجهز)|${stop.slice(3, -1)})`).exec(source);
  const firstNames = new Set(staff.map((member) => fold(member.name.trim().split(/\s+/)[0] ?? "")).filter(Boolean));
  const withoutNames = (value: string) => value.split(/\s+/).filter((word) => !firstNames.has(fold(word))).join(" ").trim();
  const candidate = [verb?.[1], subject?.[1]].map((value) => (value ? withoutNames(value) : "")).find((value) => value.length >= 2);
  result.title = candidate ? candidate.slice(0, 120) : template?.title ?? null;
  const day = new Date(now);
  let dayFound = false;
  if (/باچر|باكر|بكره|بكرة|غدا|غداً/.test(normalized)) {
    day.setDate(day.getDate() + 1);
    dayFound = true;
  } else if (/اليوم/.test(normalized)) dayFound = true;
  const hourMatch = /الساع[هة]\s*(\d{1,2}|واحد[هة]?|ثنتين|ثلاث[هة]?|اربع[هة]?|خمس[هة]?|ست[هة]?|سبع[هة]?|ثمان[يه]?[هة]?|تسع[هة]?|عشر[هة]?)/.exec(normalized);
  const words: Record<string, number> = { واحد: 1, واحده: 1, ثنتين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثماني: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10 };
  if (dayFound || hourMatch) {
    let hour = 17;
    if (hourMatch) {
      const raw = hourMatch[1];
      hour = /^\d+$/.test(raw) ? Number(raw) : words[raw] ?? 17;
      // Working hours: an afternoon hour written as 1–9 means p.m.
      if (hour >= 1 && hour <= 9) hour += 12;
    }
    day.setHours(Math.min(23, hour), 0, 0, 0);
    result.dueAt = day.toISOString();
    if (!dayFound) result.notes.push("لم يُذكر اليوم؛ افترضنا اليوم نفسه.");
  }
  if (!result.assigneeIds.length) result.notes.push("لم يُعرف الموظف من النص؛ اختره يدوياً.");
  return result;
}
