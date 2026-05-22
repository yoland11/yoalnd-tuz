export type Stage = { id: string; label: string };

export const PRODUCT_STAGES: Stage[] = [
  { id: "pending",    label: "تم الاستلام" },
  { id: "confirmed",  label: "مؤكد" },
  { id: "processing", label: "قيد التجهيز" },
  { id: "shipped",    label: "في الطريق" },
  { id: "delivered",  label: "تم التوصيل" },
];

export const PHOTO_STAGES: Stage[] = [
  { id: "pending",    label: "تم الحجز" },
  { id: "following",  label: "جاري المتابعة" },
  { id: "shooting",   label: "أثناء التصوير" },
  { id: "editing",    label: "قيد المونتاج" },
  { id: "ready",      label: "جاهز للتسليم" },
  { id: "delivered",  label: "تم التسليم" },
];

export const KOSHA_STAGES: Stage[] = [
  { id: "pending",    label: "تم الحجز" },
  { id: "following",  label: "قيد المتابعة" },
  { id: "preparing",  label: "جارِ التجهيز" },
  { id: "installing", label: "جاري التنصيب" },
  { id: "completed",  label: "مكتمل" },
];

export const RESEARCH_STAGES: Stage[] = [
  { id: "pending",       label: "تم استلام الحجز" },
  { id: "writing",       label: "جاري إعداد وكتابة البحث" },
  { id: "reviewing",     label: "قيد التدقيق والمراجعة" },
  { id: "draft_done",    label: "اكتمال النسخة الأولية" },
  { id: "supervisor",    label: "مراجعة المشرف العلمي" },
  { id: "revising",      label: "تنفيذ التعديلات المطلوبة" },
  { id: "final_done",    label: "اكتمال البحث النهائي" },
  { id: "delivered",     label: "تم التسليم" },
];

export const GRADUATION_STAGES: Stage[] = [
  { id: "pending",      label: "تم استلام الحجز" },
  { id: "coordinating", label: "جاري المتابعة والتنسيق" },
  { id: "sewing",       label: "جاري الخياطة والتجهيز" },
  { id: "printing",     label: "أثناء الطباعة والتغليف" },
  { id: "completed",    label: "تم اكتمال الطلب" },
  { id: "delivered",    label: "تم التسليم" },
];

export const ALBUM_STAGES: Stage[] = [
  { id: "pending",   label: "تم الحجز" },
  { id: "designing", label: "قيد التصميم" },
  { id: "printing",  label: "قيد الطباعة" },
  { id: "ready",     label: "جاهز للتسليم" },
  { id: "delivered", label: "تم التسليم" },
];

export const DISTRIBUTION_STAGES: Stage[] = [
  { id: "pending",   label: "تم الحجز" },
  { id: "preparing", label: "قيد التجهيز" },
  { id: "ready",     label: "جاهز للتسليم" },
  { id: "delivered", label: "تم التسليم" },
];

export function getStagesFor(serviceType: string | null | undefined, kind?: string | null): Stage[] {
  if (!serviceType || kind === "product") return PRODUCT_STAGES;
  const t = serviceType.toLowerCase();
  if (t.includes("photo") || t === "تصوير")           return PHOTO_STAGES;
  if (t.includes("kosha") || t === "كوشات")           return KOSHA_STAGES;
  if (t.includes("research") || t === "بحوث")         return RESEARCH_STAGES;
  if (t.includes("graduation") || t === "تخرج")       return GRADUATION_STAGES;
  if (t.includes("album") || t === "ألبومات")         return ALBUM_STAGES;
  if (t.includes("distribution") || t === "توزيعات")  return DISTRIBUTION_STAGES;
  return PRODUCT_STAGES;
}

export function getStageLabel(stages: Stage[], statusId: string): string {
  return stages.find(s => s.id === statusId)?.label ?? statusId;
}

export function getStageIndex(stages: Stage[], statusId: string): number {
  return stages.findIndex(s => s.id === statusId);
}

export function buildWhatsAppLink(phone: string, message: string): string {
  // Normalize Iraqi phone: drop leading 0, prepend 964 country code
  const digits = phone.replace(/\D/g, "");
  let intl = digits;
  if (digits.startsWith("00964")) intl = digits.slice(2);
  else if (digits.startsWith("964")) intl = digits;
  else if (digits.startsWith("0"))   intl = "964" + digits.slice(1);
  else                                intl = "964" + digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}
