export type StageDef = { value: string; label: string };

export type ServiceFlow = {
  key: string;
  labelAr: string;
  stages: StageDef[];
};

export const FLOWS: Record<string, ServiceFlow> = {
  product: {
    key: "product",
    labelAr: "طلب منتج",
    stages: [
      { value: "pending",    label: "قيد الانتظار" },
      { value: "confirmed",  label: "مؤكد" },
      { value: "processing", label: "قيد التجهيز" },
      { value: "shipped",    label: "في الطريق" },
      { value: "delivered",  label: "تم التوصيل" },
    ],
  },
  photography: {
    key: "photography",
    labelAr: "تصوير",
    stages: [
      { value: "booked",    label: "تم الحجز" },
      { value: "following", label: "جاري المتابعة" },
      { value: "shooting",  label: "أثناء التصوير" },
      { value: "editing",   label: "قيد المونتاج" },
      { value: "ready",     label: "جاهز للتسليم" },
      { value: "delivered", label: "تم التسليم" },
    ],
  },
  kosha: {
    key: "kosha",
    labelAr: "كوشات",
    stages: [
      { value: "booked",     label: "تم الحجز" },
      { value: "following",  label: "قيد المتابعة" },
      { value: "preparing",  label: "جارِ التجهيز" },
      { value: "installing", label: "جاري التنصيب" },
      { value: "completed",  label: "مكتمل" },
    ],
  },
  research: {
    key: "research",
    labelAr: "بحوث",
    stages: [
      { value: "received",   label: "تم استلام الحجز" },
      { value: "writing",    label: "جاري إعداد وكتابة البحث" },
      { value: "reviewing",  label: "قيد التدقيق والمراجعة" },
      { value: "first_done", label: "اكتمال النسخة الأولية" },
      { value: "supervisor", label: "مراجعة المشرف العلمي" },
      { value: "revising",   label: "تنفيذ التعديلات المطلوبة" },
      { value: "final",      label: "اكتمال البحث النهائي" },
      { value: "delivered",  label: "تم التسليم" },
    ],
  },
  graduation: {
    key: "graduation",
    labelAr: "تجهيزات تخرج",
    stages: [
      { value: "received",  label: "تم استلام الحجز" },
      { value: "following", label: "جاري المتابعة والتنسيق" },
      { value: "sewing",    label: "جاري الخياطة والتجهيز" },
      { value: "printing",  label: "أثناء الطباعة والتغليف" },
      { value: "completed", label: "تم اكتمال الطلب" },
      { value: "delivered", label: "تم التسليم" },
    ],
  },
};

export const TERMINAL_BAD = ["cancelled", "ملغي"];

export function getFlow(serviceType: string | null | undefined): ServiceFlow {
  if (!serviceType) return FLOWS.product;
  return FLOWS[serviceType] ?? FLOWS.product;
}

export function getStageLabel(flow: ServiceFlow, status: string): string {
  if (status === "cancelled") return "ملغي";
  return flow.stages.find((s) => s.value === status)?.label ?? status;
}

export function getStageIndex(flow: ServiceFlow, status: string): number {
  return flow.stages.findIndex((s) => s.value === status);
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, "");
  const intl = cleaned.startsWith("964") ? cleaned : cleaned.replace(/^0/, "964");
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export function buildTrackingLink(trackingCode: string): string {
  const base = window.location.origin + (import.meta.env.BASE_URL || "/");
  return `${base.replace(/\/$/, "")}/track?code=${trackingCode}`;
}
