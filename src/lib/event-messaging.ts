import { normalizeIraqiPhone } from "./phone";
export const EVENT_STAGES = {
  new: "جديد",
  waiting: "بانتظار التواصل",
  contacted: "تم التواصل",
  interested: "مهتم",
  quotation: "طلب عرض سعر",
  booked: "تم الحجز",
  postponed: "مؤجل",
  declined: "غير مهتم",
} as const;
export type EventStage = keyof typeof EVENT_STAGES;
export function eventStage(status: string, stage?: string | null): EventStage {
  if (status === "converted") return "booked";
  if (status === "uninterested") return "declined";
  return stage && Object.hasOwn(EVENT_STAGES, stage)
    ? (stage as EventStage)
    : status === "waiting"
      ? "waiting"
      : "interested";
}
export type MessageRecipient = {
  key: string;
  kind: "customer" | "group" | "graduation";
  id: number;
  name: string;
  phone: string;
  category: string;
  details: Record<string, string>;
  blocked: boolean;
  consent: boolean;
};
export const MESSAGE_TEMPLATES = [
  {
    key: "graduation_details",
    label: "تفاصيل حجز التخرج",
    text: "مرحباً {name}، تفاصيل مجموعة {group}: {university} / {department}، عدد الطلبة {students}، الموعد {date}. الخدمات: {services}.",
  },
  {
    key: "graduation_confirmation",
    label: "تأكيد طلب التخرج",
    text: "مرحباً {name}، طلب التخرج {reference} بحالة {status}. التجهيزات: {services}، الموعد {date}.",
  },
  {
    key: "photography",
    label: "تذكير موعد التصوير",
    text: "مرحباً {name}، نذكركم بموعد التصوير المسجل: {photographyDate}. يرجى تأكيد الموعد مع فريق AJN.",
  },
  {
    key: "delivery",
    label: "تسليم ملابس التخرج",
    text: "مرحباً {name}، بخصوص تجهيزات التخرج لطلب {reference}: {services}. حالة التجهيز {status}، موعد التسليم {deliveryDate}. يرجى التواصل لتأكيد الاستلام.",
  },
  {
    key: "missing_info",
    label: "بيانات الطلب غير المكتملة",
    text: "مرحباً {name}، يرجى مراجعة البيانات الناقصة لطلب {reference} مع فريق AJN. الحالة الحالية {status}. لا ترسل بيانات الطلبة في مجموعة عامة.",
  },
  {
    key: "payment",
    label: "تذكير بالمبلغ المتبقي",
    text: "مرحباً {name}، تذكير بالمبلغ المتبقي للحجز/الطلب {reference}: {remaining} د.ع. حالة الدفع: {paymentStatus}. للاستفسار يرجى التواصل مع الإدارة.",
  },
  {
    key: "offers",
    label: "عروض الحنة والزفاف",
    text: "مرحباً {name}، يسعد فريق AJN بمساعدتكم في ترتيبات الحنة والزفاف القادمة. هل ترغبون بمعرفة الخدمات والعروض؟ يمكنكم طلب إيقاف هذه الرسائل في أي وقت.",
  },
  {
    key: "event_details",
    label: "تفاصيل حجز المناسبة",
    text: "مرحباً {name}، تفاصيل حجزكم {reference}: {category}، الموعد {date}، الحالة {status}، الخدمات {services}.",
  },
] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATES)[number]["key"];
/** Only this whitelist can enter a message. Never stringify a booking/student record. */
export const MESSAGE_FIELDS = [
  "name",
  "group",
  "university",
  "department",
  "students",
  "date",
  "photographyDate",
  "deliveryDate",
  "services",
  "reference",
  "status",
  "remaining",
  "paymentStatus",
  "category",
] as const;
export function messageValues(
  recipient: MessageRecipient,
): Record<string, string> {
  return Object.fromEntries(
    MESSAGE_FIELDS.map((key) => [
      key,
      key === "name"
        ? recipient.name
        : key === "category"
          ? recipient.category
          : recipient.details[key] || "غير محدد",
    ]),
  );
}
export function renderEventMessage(
  key: MessageTemplateKey,
  recipient: MessageRecipient,
): string {
  const template = MESSAGE_TEMPLATES.find((t) => t.key === key);
  if (!template) throw new Error("قالب الرسالة غير صالح");
  const values = messageValues(recipient);
  return template.text.replace(
    /\{(\w+)\}/g,
    (_, name: string) => values[name] || "غير محدد",
  );
}
export function uniqueRecipients(
  items: MessageRecipient[],
): MessageRecipient[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const phone = normalizeIraqiPhone(item.phone);
    if (!phone || seen.has(phone)) return false;
    seen.add(phone);
    return true;
  });
}
export type DeliveryStatus =
  | "pending"
  | "sending"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "unknown"
  | "manual_opened"
  | "blocked";
export function nextDeliveryStatus(
  current: DeliveryStatus,
  incoming: DeliveryStatus,
): DeliveryStatus {
  const ranks: Partial<Record<DeliveryStatus, number>> = {
    pending: 0,
    sending: 1,
    unknown: 1,
    accepted: 2,
    sent: 3,
    delivered: 4,
    read: 5,
  };
  if (incoming === "failed")
    return ["delivered", "read"].includes(current) ? current : "failed";
  if (current === "manual_opened" || current === "blocked") return current;
  return (ranks[incoming] ?? -1) > (ranks[current] ?? -1) ? incoming : current;
}
