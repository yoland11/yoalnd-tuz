export const STUDENT_STEPS = [
  "بيانات الطالب",
  "إضافات",
  "قياسات",
  "اسمك على الوشاح",
];

export const STUDENT_REFERENCE_PLACEMENTS = [
  { key: "cap_edge", label: "طرف القبعة" },
  { key: "cap_top", label: "فوق القبعة" },
  { key: "sash_back", label: "خلف الوشاح" },
  { key: "other", label: "أخرى" },
] as const;

export type StudentReferencePlacement =
  (typeof STUDENT_REFERENCE_PLACEMENTS)[number]["key"];
export type StudentReferenceDraft = { note: string; image: string; fileName: string };
export const SASH_TYPES = [
  {
    key: "standard",
    label: "عادي",
    description: "قصة مستقيمة بوشاحين أماميين، بدون قطعة خلفية.",
    images: [
      {
        label: "أمام",
        src: "https://khamaiq.com/product_types/sash-regular.webp?v=p138",
      },
    ],
  },
  {
    key: "side",
    label: "جانبي",
    description: "قصة مائلة تمتد من الكتف إلى جانب الجسم.",
    images: [
      {
        label: "أمام",
        src: "https://khamaiq.com/product_types/sash-side.webp?v=p138",
      },
    ],
  },
  {
    key: "royal",
    label: "ملكي",
    description: "تصميم أمامي وخلفي بمساحة أوسع للعبارات والرسومات.",
    images: [
      {
        label: "أمام",
        src: "https://khamaiq.com/product_types/sash-royal-front.webp?v=p138",
      },
      {
        label: "خلف",
        src: "https://khamaiq.com/product_types/sash-royal-back.webp?v=p138",
      },
    ],
  },
  {
    key: "american",
    label: "أمريكي",
    description: "قصة مثلثة واضحة من الأمام والخلف.",
    images: [
      {
        label: "أمام",
        src: "https://khamaiq.com/product_types/sash-american-front.webp?v=p138",
      },
      {
        label: "خلف",
        src: "https://khamaiq.com/product_types/sash-american-back.webp?v=p138",
      },
    ],
  },
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
    department: "",
    notes: "",
    size: "",
    gender: "male",
    measurements: {} as Record<string, string>,
    sashName: "",
    sashType: "standard",
    sashColor: "#182539",
    embroideryColor: "#D4AF37",
    referencePlacement: "" as StudentReferencePlacement | "",
    referenceNote: "",
    referenceImage: "",
    referenceFileName: "",
    references: {} as Partial<Record<StudentReferencePlacement, StudentReferenceDraft>>,
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
    references: { ...currentSeed.references, ...draft.references },
  };
  if (draft.referencePlacement && !restored.references[draft.referencePlacement] && (draft.referenceImage || draft.referenceNote)) {
    restored.references[draft.referencePlacement] = {
      note: draft.referenceNote,
      image: draft.referenceImage,
      fileName: draft.referenceFileName,
    };
  }
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
  if (step === 3) {
    if ((student.referenceImage || student.referenceNote.trim()) && !student.referencePlacement)
      return "حدد موضع الصورة أو الملاحظة";
    if (student.referencePlacement === "other" && !student.references?.other && !student.referenceNote.trim())
      return "اكتب ملاحظة توضّح الموضع الآخر";
    if (student.references?.other && !student.references.other.note.trim())
      return "اكتب ملاحظة توضّح الموضع الآخر";
  }
  return undefined;
}

export type GroupSashPolicy = {
  mode: "fixed" | "per_student" | "restricted";
  sashType: string;
  sashOptions?: string[];
  sashColor?: string;
  embroideryColor?: string;
};

export function validateGroupSashOptions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  if (!value.every((item) => typeof item === "string" && SASH_TYPES.some((type) => type.key === item))) return null;
  return new Set(value).size === value.length ? [...value] : null;
}

export function selectedGroupSashType(value: unknown, policy: GroupSashPolicy): string {
  if (policy.mode === "fixed") return policy.sashType;
  if (policy.mode === "restricted")
    return policy.sashOptions?.includes(String(value)) ? String(value) : policy.sashType;
  return SASH_TYPES.some((type) => type.key === value) ? String(value) : "standard";
}

export function isGroupSashSelectionAllowed(value: unknown, policy: GroupSashPolicy): boolean {
  if (policy.mode !== "restricted" || value == null || value === "") return true;
  return policy.sashOptions?.includes(String(value)) === true;
}

export function groupSashTypes(policy: GroupSashPolicy): typeof SASH_TYPES {
  if (policy.mode !== "restricted") return SASH_TYPES;
  return (policy.sashOptions || []).flatMap((key) => {
    const type = SASH_TYPES.find((item) => item.key === key);
    return type ? [type] : [];
  });
}

export function withoutStudentReferencePreview(
  previewAssets: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(previewAssets || {}).filter(([key]) => key !== "studentReference" && key !== "studentReferences"),
  );
}

export function combineSashName(prefix: string, studentName: string): string {
  return [prefix.trim(), studentName.trim()].filter(Boolean).join(" ");
}

export function resolveGroupSashPolicy(
  configuration: Record<string, unknown>,
): GroupSashPolicy {
  const colors =
    configuration.colors && typeof configuration.colors === "object"
      ? (configuration.colors as Record<string, unknown>)
      : {};
  const fixedColor = colors.sash;
  const embroideryColor = colors.embroidery;
  const fixedType = configuration.sashType;
  const mode = configuration.sashSelectionMode === "fixed"
    ? "fixed"
    : configuration.sashSelectionMode === "restricted"
      ? "restricted"
      : "per_student";
  const sashOptions = mode === "restricted"
    ? validateGroupSashOptions(configuration.sashOptions) || ["standard"]
    : undefined;
  return {
    mode,
    sashType: sashOptions?.[0] || (SASH_TYPES.some((type) => type.key === fixedType)
      ? String(fixedType)
      : "standard"),
    ...(sashOptions ? { sashOptions } : {}),
    sashColor:
      typeof fixedColor === "string" && /^#[0-9a-f]{6}$/i.test(fixedColor)
        ? fixedColor
        : mode === "fixed" || mode === "restricted" ? "#182539" : undefined,
    embroideryColor:
      typeof embroideryColor === "string" && /^#[0-9a-f]{6}$/i.test(embroideryColor)
        ? embroideryColor
        : mode === "fixed" || mode === "restricted" ? "#D4AF37" : undefined,
  };
}

// Only these personal fields may override the shared group template.
export function studentSashOverrides(
  text: Record<string, unknown>,
  policy?: GroupSashPolicy,
) {
  const result: Record<string, string> = {};
  if (policy?.mode === "fixed") {
    result.sashType = policy.sashType;
  } else if (policy?.mode === "restricted") {
    result.sashType = selectedGroupSashType(text.sashType, policy);
  } else {
    if (SASH_TYPES.some((type) => type.key === text.sashType))
      result.sashType = String(text.sashType);
  }
  if (policy?.sashColor) result.sashColor = policy.sashColor;
  else if (
      typeof text.sashColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(text.sashColor)
    ) result.sashColor = text.sashColor;
  if (policy?.embroideryColor) result.embroideryColor = policy.embroideryColor;
  else if (
    typeof text.embroideryColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(text.embroideryColor)
  ) result.embroideryColor = text.embroideryColor;
  if (SASH_FONTS.some((font) => font.key === text.font))
    result.font = String(text.font);
  return result;
}
export function studentPayload(
  student: StudentForm,
  base: Record<string, any>,
) {
  const baseCustomText = { ...base.customText };
  delete baseCustomText.studentId;
  const sashPolicy = base.groupToken ? resolveGroupSashPolicy(base) : undefined;
  const sash = studentSashOverrides(
    {
      sashType: student.sashType,
      sashColor: student.sashColor,
      embroideryColor: student.embroideryColor,
      font: student.font,
    },
    sashPolicy,
  );
  const studentReferences = STUDENT_REFERENCE_PLACEMENTS.flatMap(({ key }) => {
    const reference = student.references?.[key];
    return reference
      ? [{ placement: key, note: reference.note.trim(), ...(reference.image
          ? { imageData: reference.image, fileName: reference.fileName }
          : {}) }]
      : [];
  });
  return {
    ...base,
    previewAssets: withoutStudentReferencePreview(base.previewAssets),
    status: "submitted",
    customerName: student.customerName.trim(),
    phone: student.phone,
    notes: student.notes,
    ...(studentReferences.length ? { studentReferences } : {}),
    ...(studentReferences.length === 0 && student.referencePlacement && (student.referenceImage || student.referenceNote.trim())
      ? {
          studentReference: {
            placement: student.referencePlacement,
            note: student.referenceNote.trim(),
            ...(student.referenceImage
              ? { imageData: student.referenceImage, fileName: student.referenceFileName }
              : {}),
          },
        }
      : {}),
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
      sash: sash.sashColor || student.sashColor,
      embroidery: sash.embroideryColor || student.embroideryColor,
    },
    customText: {
      ...baseCustomText,
      studentName: student.customerName.trim(),
      department: student.department || base.customText?.department,
      preferredSize: student.size,
      text: student.sashName,
      sashType: sash.sashType || student.sashType,
      sashColor: sash.sashColor || student.sashColor,
      embroideryColor: sash.embroideryColor || student.embroideryColor,
      font: sash.font || student.font,
      color: sash.embroideryColor || student.embroideryColor,
    },
    extras: {
      ...base.extras,
      flowers: student.flowers,
      photography: student.photography,
    },
  };
}
