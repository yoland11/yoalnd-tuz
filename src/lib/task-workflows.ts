export type TaskWorkflowStep = {
  id: string;
  label: string;
  actionLabel: string;
};

export type TaskWorkflow = {
  department: string;
  label: string;
  steps: readonly TaskWorkflowStep[];
  taskTypes: readonly string[];
};

const SHARED_END = [
  { id: "executed", label: "تم التنفيذ", actionLabel: "إنهاء المهمة" },
] as const;

export const TASK_WORKFLOWS: Record<string, TaskWorkflow> = {
  photography: {
    department: "photography",
    label: "التصوير",
    taskTypes: ["جلسة تصوير", "تصوير مناسبة", "تصوير منتج", "مونتاج", "تسليم صور"],
    steps: [
      { id: "assigned", label: "تم التكليف", actionLabel: "استلام المهمة" },
      { id: "on_the_way", label: "في الطريق", actionLabel: "بدء التصوير" },
      { id: "shooting", label: "بدء التصوير", actionLabel: "تم التنفيذ" },
      ...SHARED_END,
    ],
  },
  koshas: {
    department: "koshas",
    label: "الكوشات",
    taskTypes: ["تجهيز", "تحميل", "تنصيب", "فك", "إرجاع"],
    steps: [
      { id: "assigned", label: "تم التكليف", actionLabel: "بدء التحميل" },
      { id: "loading", label: "التحميل", actionLabel: "في الطريق" },
      { id: "on_the_way", label: "في الطريق", actionLabel: "جاري التنصيب" },
      { id: "installing", label: "جاري التنصيب", actionLabel: "جاهز" },
      { id: "ready", label: "جاهز", actionLabel: "انتهاء المناسبة" },
      { id: "event_ended", label: "انتهاء المناسبة", actionLabel: "فك الكوشة" },
      { id: "dismantling", label: "فك الكوشة", actionLabel: "العودة للمخزن" },
      { id: "returning", label: "العودة للمخزن", actionLabel: "تم التنفيذ" },
      ...SHARED_END,
    ],
  },
  graduation: {
    department: "graduation",
    label: "التجهيزات",
    taskTypes: ["خياطة", "طباعة", "تطريز", "تجهيز", "تدقيق", "تسليم"],
    steps: [
      { id: "assigned", label: "جديد", actionLabel: "بدء التجهيز" },
      { id: "preparing", label: "قيد التجهيز", actionLabel: "جاهز للفحص" },
      { id: "quality_check", label: "جاهز للفحص", actionLabel: "تم التجهيز" },
      { id: "prepared", label: "تم التجهيز", actionLabel: "تم التسليم" },
      { id: "delivered", label: "تم التسليم", actionLabel: "تم التنفيذ" },
      ...SHARED_END,
    ],
  },
  sound: {
    department: "sound",
    label: "الصوتيات",
    taskTypes: ["تجهيز أجهزة", "تحميل", "تركيب", "تشغيل", "إرجاع"],
    steps: [
      { id: "assigned", label: "تم التكليف", actionLabel: "تحميل الأجهزة" },
      { id: "loading", label: "تحميل الأجهزة", actionLabel: "في الطريق" },
      { id: "on_the_way", label: "في الطريق", actionLabel: "تركيب الأجهزة" },
      { id: "installing", label: "تركيب الأجهزة", actionLabel: "فحص الصوت" },
      { id: "sound_check", label: "فحص الصوت", actionLabel: "جاهز" },
      { id: "ready", label: "جاهز", actionLabel: "بدء المناسبة" },
      { id: "event_started", label: "بدء المناسبة", actionLabel: "انتهاء المناسبة" },
      { id: "event_ended", label: "انتهاء المناسبة", actionLabel: "جمع الأجهزة" },
      { id: "collecting", label: "جمع الأجهزة", actionLabel: "إرجاع للمخزن" },
      { id: "returning", label: "إرجاع للمخزن", actionLabel: "تم التنفيذ" },
      ...SHARED_END,
    ],
  },
  delivery: {
    department: "delivery",
    label: "التوصيل",
    taskTypes: ["تجهيز توصيل", "توصيل", "استلام", "إرجاع"],
    steps: [
      { id: "assigned", label: "تم التكليف", actionLabel: "في الطريق" },
      { id: "on_the_way", label: "في الطريق", actionLabel: "تم التسليم" },
      { id: "delivered", label: "تم التسليم", actionLabel: "تم التنفيذ" },
      ...SHARED_END,
    ],
  },
  general: {
    department: "general",
    label: "مهام أخرى",
    taskTypes: ["مهمة عامة"],
    steps: [
      { id: "assigned", label: "تم التكليف", actionLabel: "بدء التنفيذ" },
      { id: "working", label: "قيد التنفيذ", actionLabel: "تم التنفيذ" },
      ...SHARED_END,
    ],
  },
};

const DEPARTMENT_ALIASES: Record<string, string> = {
  photography: "photography", photo: "photography", تصوير: "photography", المصورين: "photography",
  kosha: "koshas", koshas: "koshas", كوشة: "koshas", الكوشات: "koshas",
  graduation: "graduation", تجهيزات: "graduation", التخرج: "graduation", تخرج: "graduation",
  sound: "sound", audio: "sound", الصوت: "sound", الصوتيات: "sound",
  delivery: "delivery", transport: "delivery", النقل: "delivery", التوصيل: "delivery",
  flowers: "flowers", الورد: "flowers", gifts: "gifts", الهدايا: "gifts",
  general: "general", عام: "general",
};

export function canonicalTaskDepartment(value: unknown): string {
  const key = String(value ?? "").trim().toLowerCase();
  return DEPARTMENT_ALIASES[key] ?? "general";
}

export function getTaskWorkflow(department: unknown): TaskWorkflow {
  return TASK_WORKFLOWS[canonicalTaskDepartment(department)] ?? TASK_WORKFLOWS.general;
}

export function getTaskWorkflowStage(workflow: TaskWorkflow, value: unknown) {
  const stage = String(value ?? "").trim().toLowerCase();
  // ARRIVED is retained only in historical timeline records. It is never an
  // active stage and maps to the preceding live step when old tasks are read.
  const normalized = stage === "arrived" || stage === "تم الوصول" ? "on_the_way" : stage;
  return workflow.steps.find((step) => step.id === normalized) ?? workflow.steps[0];
}

export function nextTaskWorkflowStage(workflow: TaskWorkflow, value: unknown) {
  const current = getTaskWorkflowStage(workflow, value);
  const index = workflow.steps.findIndex((step) => step.id === current.id);
  return workflow.steps[Math.min(index + 1, workflow.steps.length - 1)];
}

export function taskDepartmentAllowsEmployee(employeeDepartment: unknown, taskDepartment: unknown) {
  // Legacy tasks without a department remain available to their original
  // assignees. New classified work must stay inside the employee's department.
  if (!String(taskDepartment ?? "").trim()) return true;
  const employee = canonicalTaskDepartment(employeeDepartment);
  const task = canonicalTaskDepartment(taskDepartment);
  return employee === "general" || task === "general" || employee === task;
}
