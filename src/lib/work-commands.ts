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
  department: string;
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

// ─── Editable catalog: order types and departments ──────────────────────────
// Built-ins above are the defaults. Managers can rename, re-map, deactivate
// and add entries; built-ins are never removed so older orders keep a label.

export type WorkDepartmentConfig = { key: string; label: string; aliases: string[]; active: boolean; builtIn: boolean };
export type WorkOrderTypeConfig = WorkOrderTemplate & { active: boolean; builtIn: boolean };
export type WorkCatalog = { departments: WorkDepartmentConfig[]; orderTypes: WorkOrderTypeConfig[] };

const foldText = (value: unknown) =>
  String(value ?? "").trim().toLowerCase().replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");

export const DEFAULT_WORK_CATALOG: WorkCatalog = {
  // Built-in aliases (DEPARTMENT_ALIASES) apply automatically; `aliases` holds
  // only the staff departments a manager assigned, which take precedence.
  departments: WORK_DEPARTMENTS.map((item) => ({ key: item.key, label: item.label, aliases: [], active: true, builtIn: true })),
  orderTypes: WORK_ORDER_TEMPLATES.map((item) => ({ ...item, checklist: [...item.checklist], active: true, builtIn: true })),
};

const CATALOG_KEY = /^[a-z][a-z0-9_]{1,39}$/;
const PRIORITY_VALUES = new Set(["low", "medium", "high", "urgent"]);
const clip = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

/** Problems with a catalog a manager submitted, in Arabic; empty when valid. */
export function catalogProblems(input: { departments?: unknown; orderTypes?: unknown }) {
  const problems: string[] = [];
  const departments = (Array.isArray(input.departments) ? input.departments : []) as any[];
  const orderTypes = (Array.isArray(input.orderTypes) ? input.orderTypes : []) as any[];
  const departmentKeys = new Set<string>();
  const labels = new Set<string>();
  for (const raw of departments) {
    const key = clip(raw?.key, 40);
    const label = clip(raw?.label, 60);
    if (!CATALOG_KEY.test(key)) problems.push(`رمز القسم «${label || key}» غير صالح`);
    if (label.length < 2) problems.push("اسم القسم مطلوب (حرفان على الأقل)");
    if (departmentKeys.has(key)) problems.push(`القسم «${label}» مكرر`);
    if (labels.has(foldText(label))) problems.push(`يوجد قسم آخر باسم «${label}»`);
    departmentKeys.add(key);
    labels.add(foldText(label));
  }
  if (departments.length > 40) problems.push("الحد الأقصى 40 قسماً");
  const typeKeys = new Set<string>();
  const typeLabels = new Set<string>();
  for (const raw of orderTypes) {
    const key = clip(raw?.key, 40);
    const label = clip(raw?.label, 60);
    if (!CATALOG_KEY.test(key)) problems.push(`رمز نوع الأمر «${label || key}» غير صالح`);
    if (label.length < 2) problems.push("اسم نوع الأمر مطلوب (حرفان على الأقل)");
    if (typeKeys.has(key)) problems.push(`نوع الأمر «${label}» مكرر`);
    if (typeLabels.has(foldText(label))) problems.push(`يوجد نوع أمر آخر باسم «${label}»`);
    if (departments.length && !departmentKeys.has(clip(raw?.department, 40))) problems.push(`قسم نوع الأمر «${label}» غير موجود`);
    typeKeys.add(key);
    typeLabels.add(foldText(label));
  }
  if (orderTypes.length > 60) problems.push("الحد الأقصى 60 نوعاً");
  return [...new Set(problems)];
}

/**
 * Stored overrides merged over the built-ins. Malformed entries are dropped;
 * built-ins always remain (possibly inactive) and "general" stays active.
 */
export function normalizeCatalog(stored: unknown): WorkCatalog {
  const source = (stored && typeof stored === "object" ? stored : {}) as { departments?: unknown; orderTypes?: unknown };
  const byKey = (list: unknown) =>
    new Map<string, any>(
      (Array.isArray(list) ? list : [])
        .filter((item: any) => CATALOG_KEY.test(clip(item?.key, 40)))
        .map((item: any) => [clip(item.key, 40), item]),
    );
  const storedDepartments = byKey(source.departments);
  const aliasList = (value: unknown) => (Array.isArray(value) ? value.map((alias) => clip(alias, 60)).filter(Boolean) : []);
  const departments: WorkDepartmentConfig[] = DEFAULT_WORK_CATALOG.departments.map((base) => {
    const override = storedDepartments.get(base.key);
    storedDepartments.delete(base.key);
    return {
      ...base,
      label: clip(override?.label, 60) || base.label,
      aliases: [...new Set(aliasList(override?.aliases))],
      active: base.key === "general" ? true : override?.active !== false,
    };
  });
  for (const [key, item] of storedDepartments) {
    const label = clip(item?.label, 60);
    if (label.length >= 2) departments.push({ key, label, aliases: aliasList(item.aliases), active: item.active !== false, builtIn: false });
  }
  const departmentKeys = new Set(departments.map((item) => item.key));
  const storedTypes = byKey(source.orderTypes);
  const orderType = (base: Partial<WorkOrderTemplate> & { key: string }, override: any, builtIn: boolean): WorkOrderTypeConfig | null => {
    const label = clip(override?.label, 60) || base.label || "";
    if (label.length < 2) return null;
    const department = clip(override?.department, 40) || base.department || "general";
    const minutes = Math.round(Number(override?.estimatedMinutes ?? base.estimatedMinutes ?? 0));
    return {
      key: base.key,
      label,
      department: departmentKeys.has(department) ? department : "general",
      title: clip(override?.title, 120) || base.title || label,
      priority: (PRIORITY_VALUES.has(String(override?.priority)) ? override.priority : base.priority ?? "medium") as WorkOrderTemplate["priority"],
      estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 100_000) : 0,
      checklist: Array.isArray(override?.checklist) ? override.checklist.map((item: unknown) => clip(item, 300)).filter(Boolean).slice(0, 30) : [...(base.checklist ?? [])],
      evidenceRequired: typeof override?.evidenceRequired === "boolean" ? override.evidenceRequired : base.evidenceRequired ?? false,
      evidenceHint: clip(override?.evidenceHint, 120) || base.evidenceHint || "صورة أو ملف أو رابط عند الإنجاز",
      requiresApproval: typeof override?.requiresApproval === "boolean" ? override.requiresApproval : base.requiresApproval ?? false,
      needsBooking: typeof override?.needsBooking === "boolean" ? override.needsBooking : base.needsBooking ?? false,
      active: override?.active !== false,
      builtIn,
    };
  };
  const orderTypes: WorkOrderTypeConfig[] = [];
  for (const base of DEFAULT_WORK_CATALOG.orderTypes) {
    const merged = orderType(base, storedTypes.get(base.key), true);
    storedTypes.delete(base.key);
    if (merged) orderTypes.push(merged);
  }
  for (const [key, item] of storedTypes) {
    const merged = orderType({ key }, item, false);
    if (merged) orderTypes.push(merged);
  }
  return { departments, orderTypes };
}

/** Department key for a stored or typed value (key, label or alias); unknown → general. */
const FOLDED_ALIASES = new Map(Object.entries(DEPARTMENT_ALIASES).map(([alias, key]) => [foldText(alias), key]));

/** The built-in department a staff department value maps to without any manager choice. */
export function defaultDepartmentFor(value: unknown): string | null {
  return FOLDED_ALIASES.get(foldText(value)) ?? null;
}

export function catalogDepartment(catalog: WorkCatalog, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "general";
  const direct = catalog.departments.find((item) => item.key === raw);
  if (direct) return direct.key;
  const folded = foldText(raw);
  // A manager's assignment (or a department's own name) wins over the built-in aliases.
  const assigned = catalog.departments.find((item) => item.aliases.some((alias) => foldText(alias) === folded) || foldText(item.label) === folded);
  if (assigned) return assigned.key;
  const builtIn = defaultDepartmentFor(raw);
  return builtIn && catalog.departments.some((item) => item.key === builtIn) ? builtIn : "general";
}

export function catalogDepartmentLabel(catalog: WorkCatalog, value: unknown) {
  const key = catalogDepartment(catalog, value);
  return catalog.departments.find((item) => item.key === key)?.label ?? "الإدارة العامة";
}

export function catalogOrderType(catalog: WorkCatalog, key: unknown) {
  return catalog.orderTypes.find((item) => item.key === key) ?? null;
}

/** A new unique key for a custom entry, e.g. "dept_9" / "type_10". */
export function newCatalogKey(prefix: "dept" | "type", existing: string[]) {
  let index = existing.length + 1;
  while (existing.includes(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}
