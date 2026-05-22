export type Stage = { value: string; label: string };

const PRODUCT_STAGES: Stage[] = [
  { value: "pending",    label: "قيد الانتظار" },
  { value: "confirmed",  label: "مؤكد" },
  { value: "processing", label: "قيد التجهيز" },
  { value: "shipped",    label: "في الطريق" },
  { value: "delivered",  label: "تم التوصيل" },
];

const PHOTO_STAGES: Stage[] = [
  { value: "pending",   label: "تم الحجز" },
  { value: "confirmed", label: "جاري المتابعة" },
  { value: "filming",   label: "أثناء التصوير" },
  { value: "editing",   label: "قيد المونتاج" },
  { value: "ready",     label: "جاهز للتسليم" },
  { value: "delivered", label: "تم التسليم" },
];

const KOSHA_STAGES: Stage[] = [
  { value: "pending",     label: "تم الحجز" },
  { value: "confirmed",   label: "قيد المتابعة" },
  { value: "processing",  label: "جارِ التجهيز" },
  { value: "installing",  label: "جاري التنصيب" },
  { value: "delivered",   label: "مكتمل" },
];

const RESEARCH_STAGES: Stage[] = [
  { value: "pending",      label: "تم استلام الحجز" },
  { value: "writing",      label: "جاري إعداد البحث" },
  { value: "reviewing",    label: "قيد التدقيق والمراجعة" },
  { value: "draft_ready",  label: "اكتمال النسخة الأولية" },
  { value: "supervisor",   label: "مراجعة المشرف العلمي" },
  { value: "revising",     label: "تنفيذ التعديلات" },
  { value: "final",        label: "اكتمال البحث النهائي" },
  { value: "delivered",    label: "تم التسليم" },
];

const GRADUATION_STAGES: Stage[] = [
  { value: "pending",     label: "تم استلام الحجز" },
  { value: "confirmed",   label: "جاري المتابعة والتنسيق" },
  { value: "sewing",      label: "جاري الخياطة والتجهيز" },
  { value: "printing",    label: "أثناء الطباعة والتغليف" },
  { value: "ready",       label: "تم اكتمال الطلب" },
  { value: "delivered",   label: "تم التسليم" },
];

const ALBUM_STAGES: Stage[] = [
  { value: "pending",   label: "تم استلام الحجز" },
  { value: "designing", label: "قيد التصميم" },
  { value: "printing",  label: "قيد الطباعة" },
  { value: "ready",     label: "جاهز للتسليم" },
  { value: "delivered", label: "تم التسليم" },
];

const STAGE_MAP: Record<string, Stage[]> = {
  product: PRODUCT_STAGES,
  photo: PHOTO_STAGES,
  photography: PHOTO_STAGES,
  kosha: KOSHA_STAGES,
  koshat: KOSHA_STAGES,
  research: RESEARCH_STAGES,
  graduation: GRADUATION_STAGES,
  album: ALBUM_STAGES,
  albums: ALBUM_STAGES,
};

export function getStages(serviceType?: string | null): Stage[] {
  if (!serviceType) return PRODUCT_STAGES;
  return STAGE_MAP[serviceType.toLowerCase()] ?? PRODUCT_STAGES;
}

export function getStageLabel(serviceType: string | null | undefined, status: string): string {
  const stages = getStages(serviceType);
  const found = stages.find(s => s.value === status);
  if (found) return found.label;
  if (status === "cancelled") return "ملغي";
  return status;
}

export function getStageIndex(serviceType: string | null | undefined, status: string): number {
  const stages = getStages(serviceType);
  return stages.findIndex(s => s.value === status);
}

export const CANCELLED_STATUS = { value: "cancelled", label: "ملغي" };

export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("964")
    ? digits
    : digits.startsWith("0")
    ? `964${digits.slice(1)}`
    : `964${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
