export const STUDENT_STEPS = [
  "بيانات الطالب",
  "إضافات",
  "قياسات",
  "اسمك على الوشاح",
];
export const SASH_TYPES = [
  { key: "standard", label: "عادي" },
  { key: "side", label: "جانبي" },
  { key: "royal", label: "ملكي" },
  { key: "american", label: "أمريكي" },
];
export const SASH_FONTS = [
  {
    key: "thmanyah",
    label: "خط ثمانية",
    family: "Thmanyah, Cairo, sans-serif",
  },
  {
    key: "naskh",
    label: "النسخ",
    family: '"Noto Naskh Arabic", "Traditional Arabic", serif',
  },
  {
    key: "thuluth",
    label: "الثلث",
    family: 'Thuluth, "Arabic Typesetting", serif',
  },
];
export const MEASUREMENTS: [string, string, number, number][] = [
  ["height", "الطول (سم)", 80, 250],
  ["weight", "الوزن (كغم)", 20, 300],
  ["shoulder", "عرض الكتف (سم)", 20, 100],
  ["chest", "محيط الصدر (سم)", 40, 220],
  ["waist", "محيط الخصر (سم)", 35, 220],
  ["hip", "محيط الورك (سم)", 35, 240],
  ["sleeveLength", "طول الكم (سم)", 20, 120],
  ["neck", "محيط الرقبة (سم)", 20, 80],
];
export type StudentFlower = {
  productId: number;
  variantId?: number;
  quantity: number;
  name: string;
  color?: string;
};
export function newStudent() {
  return {
    customerName: "",
    phone: "",
    studentId: "",
    department: "",
    notes: "",
    size: "",
    gender: "male",
    measurements: {} as Record<string, string>,
    sashName: "",
    sashType: "standard",
    sashColor: "#182539",
    embroideryColor: "#D4AF37",
    font: "naskh",
    flowers: [] as StudentFlower[],
    photography: null as Record<string, unknown> | null,
  };
}
export type StudentForm = ReturnType<typeof newStudent>;
export function restoreStudentDraft(
  draft: StudentForm,
  previousSeed: StudentForm | undefined,
  currentSeed: StudentForm,
): StudentForm {
  const restored = {
    ...currentSeed,
    ...draft,
    measurements: { ...draft.measurements },
  };
  if (!previousSeed) return restored;
  for (const key of Object.keys(currentSeed) as (keyof StudentForm)[]) {
    if (key === "measurements") {
      for (const measurement of new Set([
        ...Object.keys(previousSeed.measurements),
        ...Object.keys(currentSeed.measurements),
      ])) {
        if (
          previousSeed.measurements[measurement] !==
          currentSeed.measurements[measurement]
        )
          restored.measurements[measurement] =
            currentSeed.measurements[measurement] || "";
      }
      continue;
    }
    if (JSON.stringify(previousSeed[key]) !== JSON.stringify(currentSeed[key]))
      Object.assign(restored, { [key]: currentSeed[key] });
  }
  return restored;
}
export function studentIssue(student: StudentForm, step: number) {
  if (step === 0) {
    if (student.customerName.trim().length < 2) return "أدخل اسم الطالب الكامل";
    if (student.phone.replace(/\D/g, "").length < 10)
      return "أدخل رقم هاتف صحيحاً";
  }
  if (step === 2) {
    for (const [key, label, min, max] of MEASUREMENTS) {
      const raw = student.measurements[key];
      if (
        raw?.trim() &&
        (!Number.isFinite(Number(raw)) ||
          Number(raw) < min ||
          Number(raw) > max)
      )
        return `${label}: أدخل قيمة بين ${min} و${max}`;
    }
  }
  return undefined;
}
// Only these personal fields may override the shared group template.
export function studentSashOverrides(text: Record<string, unknown>) {
  const result: Record<string, string> = {};
  if (SASH_TYPES.some((type) => type.key === text.sashType))
    result.sashType = String(text.sashType);
  if (SASH_FONTS.some((font) => font.key === text.font))
    result.font = String(text.font);
  for (const key of ["sashColor", "embroideryColor"])
    if (typeof text[key] === "string" && /^#[0-9a-f]{6}$/i.test(text[key]))
      result[key] = text[key];
  return result;
}
export function studentPayload(
  student: StudentForm,
  base: Record<string, any>,
) {
  return {
    ...base,
    status: "submitted",
    customerName: student.customerName.trim(),
    phone: student.phone,
    notes: student.notes,
    measurements: {
      ...Object.fromEntries(
        MEASUREMENTS.filter(([key]) => student.measurements[key]?.trim()).map(
          ([key]) => [key, Number(student.measurements[key])],
        ),
      ),
      gender: student.gender,
      suggestedSize: student.size || undefined,
      ...(student.size ? { method: "ready", readySize: student.size } : {}),
    },
    colors: {
      ...base.colors,
      sash: student.sashColor,
      embroidery: student.embroideryColor,
    },
    customText: {
      ...base.customText,
      studentName: student.customerName.trim(),
      studentId: student.studentId,
      department: student.department || base.customText?.department,
      preferredSize: student.size,
      text: student.sashName,
      sashType: student.sashType,
      sashColor: student.sashColor,
      embroideryColor: student.embroideryColor,
      font: student.font,
      color: student.embroideryColor,
    },
    extras: {
      ...base.extras,
      flowers: student.flowers,
      photography: student.photography,
    },
  };
}
