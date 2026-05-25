export { normalizePhoneDigits } from "@/lib/phone";
import { fileToDataUrl, processImageFile } from "@/lib/image-tools";

export type CrewOption = {
  id: number;
  name: string;
  isActive?: boolean;
  status?: "available" | "busy" | "vacation" | "inactive" | string;
  internalNotes?: string;
};

export type DetailInputType = "text" | "number" | "date" | "time" | "select" | "textarea" | "file";

export type ServiceDetailField = {
  key: string;
  label: string;
  type: DetailInputType;
  required?: boolean;
  options?: { value: string; label: string }[];
  source?: "crews";
  accept?: string;
  multiple?: boolean;
  min?: number;
  max?: number;
  dependsOn?: { key: string; value: string };
};

const YES_NO = [
  { value: "مطلوب", label: "مطلوب" },
  { value: "غير مطلوب", label: "غير مطلوب" },
];

const IN_OUT = [
  { value: "داخلي", label: "داخلي" },
  { value: "خارجي", label: "خارجي" },
];

const PRINT_OPTIONS = [
  { value: "بدون طبع", label: "بدون طبع" },
  { value: "طبع", label: "طبع" },
];

export function normalizeServiceType(type?: string | null): string {
  const t = (type ?? "").trim().toLowerCase();
  if (t.includes("photo") || t.includes("تصوير")) return "photography";
  if (t.includes("kosha") || t.includes("كوش")) return "kosha";
  if (t.includes("research") || t.includes("بحث") || t.includes("بحوث")) return "research";
  if (t.includes("graduation") || t.includes("setup") || t.includes("تخرج")) return "graduation";
  if (t.includes("album") || t.includes("ألبوم") || t.includes("البوم")) return "albums";
  if (t.includes("gift") || t.includes("distribution") || t.includes("هدايا") || t.includes("توزيع")) return "gifts";
  return t || "other";
}

export function getServiceDetailFields(serviceType?: string | null): ServiceDetailField[] {
  switch (normalizeServiceType(serviceType)) {
    case "kosha":
      return [
        { key: "koshaType", label: "نوع الكوشة", type: "select", required: true, options: [{ value: "اعتيادي", label: "اعتيادي" }, { value: "ملكي VIP", label: "ملكي VIP" }] },
        { key: "governorate", label: "المحافظة", type: "text", required: true },
        { key: "address", label: "العنوان", type: "text", required: true },
        { key: "bookingTime", label: "وقت الحجز", type: "time", required: true },
        { key: "chairsCount", label: "عدد الكراسي", type: "number", required: true, min: 0 },
        { key: "locationType", label: "داخلي / خارجي", type: "select", required: true, options: IN_OUT },
        { key: "transport", label: "النقل", type: "select", required: true, options: YES_NO },
        { key: "referenceImage", label: "صورة مرجعية", type: "file", accept: "image/*" },
      ];
    case "photography":
      return [
        { key: "crewName", label: "كادر التصوير", type: "select", source: "crews", required: true },
        { key: "sessionTime", label: "وقت الجلسة", type: "time", required: true },
        { key: "shootingLocation", label: "موقع التصوير", type: "text", required: true },
        { key: "sessionType", label: "نوع الجلسة", type: "select", required: true, options: IN_OUT },
        { key: "peopleCount", label: "عدد الأشخاص", type: "number", required: true, min: 1 },
        { key: "video", label: "الفيديو", type: "select", required: true, options: YES_NO },
        { key: "referenceImage", label: "صورة مرجعية", type: "file", accept: "image/*" },
      ];
    case "albums":
      return [
        { key: "crewName", label: "اسم الكادر", type: "select", source: "crews", required: true },
        { key: "sessionType", label: "نوع الجلسة", type: "select", required: true, options: IN_OUT },
        { key: "albumType", label: "نوع الألبوم", type: "text", required: true },
        { key: "pagesCount", label: "عدد الصفحات", type: "number", required: true, min: 1 },
        { key: "size", label: "المقاس", type: "text", required: true },
        { key: "coverType", label: "نوع الغلاف", type: "text", required: true },
        { key: "coverName", label: "الاسم على الغلاف", type: "text" },
        { key: "albumFiles", label: "رفع صور الألبوم", type: "file", accept: "image/*", multiple: true },
      ];
    case "research":
      return [
        { key: "researchTitle", label: "عنوان البحث", type: "text", required: true },
        { key: "studentNames", label: "أسماء الطلبة", type: "textarea", required: true },
        { key: "supervisorName", label: "اسم المشرف", type: "text" },
        { key: "university", label: "الجامعة", type: "text", required: true },
        { key: "college", label: "الكلية", type: "text", required: true },
        { key: "department", label: "القسم", type: "text", required: true },
        { key: "deliveryDate", label: "موعد التسليم", type: "date", required: true },
        { key: "printing", label: "الطباعة", type: "select", required: true, options: PRINT_OPTIONS },
        { key: "copiesCount", label: "عدد النسخ", type: "number", required: true, min: 1, max: 6, dependsOn: { key: "printing", value: "طبع" } },
        { key: "binding", label: "التجليد", type: "select", required: true, options: [{ value: "تجليد", label: "تجليد" }, { value: "تغليف", label: "تغليف" }] },
        { key: "researchFiles", label: "رفع ملفات PDF أو Word", type: "file", accept: ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document", multiple: true },
      ];
    case "graduation":
      return [
        { key: "governorate", label: "المحافظة", type: "text", required: true },
        { key: "address", label: "العنوان", type: "text", required: true },
        { key: "bookingTime", label: "وقت الحجز", type: "time", required: true },
        { key: "setupType", label: "نوع التجهيز", type: "select", required: true, options: [{ value: "الاعتيادي", label: "الاعتيادي" }, { value: "الملكي", label: "الملكي" }, { value: "الأمريكي", label: "الأمريكي" }] },
        { key: "sashType", label: "نوع الوشاح", type: "select", required: true, options: [{ value: "عادي", label: "عادي" }, { value: "ملكي", label: "ملكي" }, { value: "أمريكي", label: "أمريكي" }] },
        { key: "robeType", label: "نوع الروب", type: "select", required: true, options: [{ value: "عادي", label: "عادي" }, { value: "إنكليزي", label: "إنكليزي" }] },
        { key: "writingType", label: "نوع الكتابة", type: "select", required: true, options: [{ value: "طبع", label: "طبع" }, { value: "تطريز", label: "تطريز" }] },
        { key: "sashLength", label: "طول الوشاح", type: "text" },
        { key: "shoulder", label: "الكتف", type: "text" },
        { key: "robeLength", label: "طول الروب", type: "text" },
        { key: "sleeve", label: "اليد", type: "text" },
        { key: "cap", label: "القبعة", type: "select", required: true, options: [{ value: "مضافة", label: "مضافة" }, { value: "غير مضافة", label: "غير مضافة" }] },
        { key: "referenceImage", label: "صورة مرجعية", type: "file", accept: "image/*" },
      ];
    case "gifts":
      return [
        { key: "governorate", label: "المحافظة", type: "text", required: true },
        { key: "address", label: "العنوان", type: "text", required: true },
        { key: "giftType", label: "نوع الهدية", type: "text", required: true },
        { key: "recipientName", label: "اسم المستلم", type: "text", required: true },
        { key: "occasionDate", label: "تاريخ المناسبة", type: "date", required: true },
        { key: "giftMessage", label: "رسالة الهدية", type: "textarea" },
        { key: "wrapping", label: "التغليف", type: "select", required: true, options: [{ value: "بدون تغليف", label: "بدون تغليف" }, { value: "تغليف", label: "تغليف" }] },
        { key: "referenceImage", label: "صورة مرجعية", type: "file", accept: "image/*" },
      ];
    default:
      return [];
  }
}

export function defaultServiceDetails(serviceType?: string | null): Record<string, any> {
  const details: Record<string, any> = {};
  for (const field of getServiceDetailFields(serviceType)) {
    if (field.multiple) details[field.key] = [];
    else details[field.key] = field.options?.[0]?.value ?? "";
  }
  if (normalizeServiceType(serviceType) === "research") details.printing = "بدون طبع";
  if (normalizeServiceType(serviceType) === "gifts") {
    details.wrapping = "بدون تغليف";
    details.wrappingFee = 0;
  }
  return details;
}

export function serviceDetailsToRows(serviceType: string | null | undefined, details: Record<string, any> | null | undefined) {
  const source = details ?? {};
  const rows = getServiceDetailFields(serviceType)
    .filter((field) => !field.dependsOn || source[field.dependsOn.key] === field.dependsOn.value)
    .map((field) => {
      const value = source[field.key];
      if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
      if (field.type === "file") {
        const count = Array.isArray(value) ? value.length : 1;
        return { key: field.key, label: field.label, value: `${count} ملف` };
      }
      return { key: field.key, label: field.label, value: String(value) };
    })
    .filter(Boolean) as { key: string; label: string; value: string }[];
  if (normalizeServiceType(serviceType) === "gifts" && Number(source.wrappingFee) > 0) {
    rows.push({ key: "wrappingFee", label: "إضافة التغليف", value: `${Number(source.wrappingFee).toLocaleString("ar-IQ")} دينار` });
  }
  return rows;
}

export function validateServiceDetails(serviceType: string | null | undefined, details: Record<string, any>) {
  const errors: Record<string, string> = {};
  for (const field of getServiceDetailFields(serviceType)) {
    if (field.dependsOn && details[field.dependsOn.key] !== field.dependsOn.value) continue;
    const value = details[field.key];
    const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
    if (!empty && field.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) errors[field.key] = "قيمة غير صحيحة";
      if (field.min != null && n < field.min) errors[field.key] = `الحد الأدنى ${field.min}`;
      if (field.max != null && n > field.max) errors[field.key] = `الحد الأقصى ${field.max}`;
    }
  }
  return errors;
}

export async function filesToStoredValues(files: FileList | null, multiple?: boolean) {
  if (!files || files.length === 0) return multiple ? [] : null;
  const read = async (file: File): Promise<{ name: string; type: string; dataUrl: string }> => ({
    name: file.name,
    type: file.type,
    dataUrl: file.type.startsWith("image/") ? await processImageFile(file, { maxSize: 1600, quality: 0.82 }) : await fileToDataUrl(file),
  });
  const values = await Promise.all(Array.from(files).map(read));
  return multiple ? values : values[0];
}

export function primaryLocationFromDetails(serviceType: string | null | undefined, details: Record<string, any>) {
  const type = normalizeServiceType(serviceType);
  if (type === "photography") return details.shootingLocation ?? "";
  return details.address ?? "";
}

export function withDerivedServiceDetails(serviceType: string | null | undefined, details: Record<string, any>) {
  const next = { ...details };
  if (normalizeServiceType(serviceType) === "gifts") {
    next.wrappingFee = next.wrapping === "تغليف" ? 1000 : 0;
  }
  if (next.printing !== "طبع") delete next.copiesCount;
  return next;
}
