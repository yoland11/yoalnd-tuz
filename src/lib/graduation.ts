import { z } from "zod/v4";

export const GRADUATION_STAGES = [
  "new",
  "measurements",
  "fabric_cutting",
  "tailoring",
  "printing",
  "embroidery",
  "ironing",
  "quality_check",
  "packaging",
  "ready",
  "delivered",
] as const;

export const GRADUATION_STAGE_LABELS: Record<
  (typeof GRADUATION_STAGES)[number],
  string
> = {
  new: "جديد",
  measurements: "القياسات",
  fabric_cutting: "قص القماش",
  tailoring: "الخياطة",
  printing: "الطباعة",
  embroidery: "التطريز",
  ironing: "الكي",
  quality_check: "فحص الجودة",
  packaging: "التغليف",
  ready: "جاهز",
  delivered: "تم التسليم",
};

export type GraduationOption = {
  key: string;
  name: string;
  description?: string;
  price: number;
  cost?: number;
  imageUrl?: string;
  modelUrl?: string;
  productId?: number | null;
  quantity?: number;
  color?: string;
  textureUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
};

export type GraduationPackage = GraduationOption & {
  styleKey?: string;
  accessories?: string[];
  photographyIncluded?: boolean;
  albumIncluded?: boolean;
  videoIncluded?: boolean;
};

export type GraduationUniversityTemplate = {
  key: string;
  university: string;
  college?: string;
  department?: string;
  logoUrl?: string;
  robeColor?: string;
  sashColor?: string;
  capColor?: string;
  tasselColor?: string;
  embroideryColor?: string;
  styleKey?: string;
  defaultText?: string;
  isActive?: boolean;
};

export type GraduationConfig = {
  styles: GraduationOption[];
  fabrics: GraduationOption[];
  accessories: GraduationOption[];
  packages: GraduationPackage[];
  universities: GraduationUniversityTemplate[];
  colors: Array<{ key: string; name: string; hex: string }>;
  fonts: Array<{ key: string; name: string; family: string }>;
  productionDays: number;
  printingPrices: Record<string, number>;
  embroideryPrices: Record<string, number>;
  measurementGuideImages: Record<string, string>;
  aiEnabled: boolean;
};

const option = (
  key: string,
  name: string,
  extra: Partial<GraduationOption> = {},
): GraduationOption => ({
  key,
  name,
  price: 0,
  cost: 0,
  isActive: true,
  ...extra,
});

// These are real system choices, not sample orders. Prices and media remain zero/empty
// until AJN management configures them from the settings screen.
export const DEFAULT_GRADUATION_CONFIG: GraduationConfig = {
  styles: [
    option("american", "أمريكي", { description: "روب تخرج بقصة أمريكية" }),
    option("royal", "ملكي", { description: "روب ملكي بتفاصيل فاخرة" }),
    option("mix", "مكس", { description: "مزيج قابل للتخصيص" }),
    option("standard", "اعتيادي", { description: "روب تخرج عملي وأنيق" }),
  ],
  fabrics: [
    option("satin", "ساتان"),
    option("premium_satin", "ساتان فاخر"),
    option("velvet", "مخمل"),
    option("cotton_blend", "قطن مخلوط"),
    option("royal", "قماش ملكي"),
  ],
  accessories: [
    option("cap", "قبعة التخرج"),
    option("sash", "وشاح التخرج"),
    option("medal", "ميدالية"),
    option("honor_rope", "حبل الشرف"),
    option("certificate_tube", "حافظة الشهادة"),
    option("gift_box", "صندوق هدية"),
    option("photo_frame", "إطار صورة"),
    option("gift_bag", "حقيبة هدية"),
  ],
  packages: [
    { ...option("bronze", "الباقة البرونزية"), accessories: ["cap", "sash"] },
    {
      ...option("silver", "الباقة الفضية"),
      accessories: ["cap", "sash", "medal"],
    },
    {
      ...option("gold", "الباقة الذهبية"),
      accessories: ["cap", "sash", "medal", "photo_frame"],
    },
    {
      ...option("diamond", "الباقة الماسية"),
      accessories: [
        "cap",
        "sash",
        "medal",
        "honor_rope",
        "certificate_tube",
        "gift_box",
        "photo_frame",
        "gift_bag",
      ],
      photographyIncluded: true,
      albumIncluded: true,
      videoIncluded: true,
    },
  ],
  universities: [],
  colors: [
    { key: "black", name: "أسود", hex: "#111111" },
    { key: "gold", name: "ذهبي", hex: "#D4B15A" },
    { key: "white", name: "أبيض", hex: "#FFFFFF" },
    { key: "silver", name: "فضي", hex: "#C0C0C0" },
    { key: "navy", name: "كحلي", hex: "#0B1B3A" },
    { key: "burgundy", name: "خمري", hex: "#800020" },
    { key: "green", name: "أخضر", hex: "#176B4B" },
    { key: "red", name: "أحمر", hex: "#A62935" },
  ],
  fonts: [
    { key: "cairo", name: "كايرو", family: "Cairo" },
    { key: "tajawal", name: "تجوال", family: "Tajawal" },
    { key: "system", name: "خط النظام", family: "inherit" },
  ],
  productionDays: 7,
  printingPrices: { front: 0, back: 0, sleeve: 0, sash: 0 },
  embroideryPrices: { front: 0, back: 0, sleeve: 0, sash: 0 },
  measurementGuideImages: {},
  aiEnabled: true,
};

export const graduationMeasurementsSchema = z
  .object({
    height: z.coerce.number().min(80).max(250),
    weight: z.coerce.number().min(20).max(300).optional(),
    shoulder: z.coerce.number().min(20).max(100),
    chest: z.coerce.number().min(40).max(220),
    waist: z.coerce.number().min(35).max(220),
    hip: z.coerce.number().min(35).max(240).optional(),
    sleeveLength: z.coerce.number().min(20).max(120),
    neck: z.coerce.number().min(20).max(80).optional(),
    gender: z.enum(["male", "female"]),
    suggestedSize: z.string().max(20).optional(),
  })
  .passthrough();

const optionalString = z.preprocess(
  (value) => String(value ?? "").trim() || undefined,
  z.string().optional(),
);

export const graduationOrderInputSchema = z
  .object({
    customerName: z.string().trim().min(2, "اسم الزبون مطلوب").max(160),
    phone: z.string().trim().min(10, "رقم الهاتف غير مكتمل").max(30),
    styleKey: z.string().trim().min(1, "اختر نوع التخرج"),
    packageKey: optionalString,
    groupToken: optionalString,
    status: z.enum(["draft", "submitted"]).default("submitted"),
    measurements: graduationMeasurementsSchema,
    colors: z.record(z.string(), z.string()).default({}),
    fabric: z.object({ key: z.string().min(1) }).passthrough(),
    decoration: z
      .object({
        type: z.enum(["printing", "embroidery", "none"]).default("none"),
        position: z.enum(["front", "back", "sleeve", "sash"]).default("front"),
        file: optionalString,
        fileName: optionalString,
      })
      .passthrough()
      .default({ type: "none", position: "front" }),
    customText: z
      .object({
        studentName: optionalString,
        university: optionalString,
        college: optionalString,
        department: optionalString,
        graduationYear: optionalString,
        text: optionalString,
        font: optionalString,
        size: z.coerce.number().min(8).max(120).optional(),
        color: optionalString,
        alignment: z.enum(["right", "center", "left"]).optional(),
      })
      .passthrough()
      .default({}),
    accessories: z.array(z.string()).default([]),
    universityTemplate: z.record(z.string(), z.unknown()).default({}),
    previewAssets: z.record(z.string(), z.unknown()).default({}),
    discountAmount: z.coerce.number().min(0).default(0),
    dueDate: optionalString,
    notes: optionalString,
  })
  .passthrough();

export const graduationAdminPatchSchema = z
  .object({
    status: z
      .enum([
        "draft",
        "submitted",
        "confirmed",
        "in_production",
        "ready",
        "delivered",
        "cancelled",
      ])
      .optional(),
    productionStage: z.enum(GRADUATION_STAGES).optional(),
    totalAmount: z.coerce.number().min(0).optional(),
    paidAmount: z.coerce.number().min(0).optional(),
    discountAmount: z.coerce.number().min(0).optional(),
    paymentMethod: z.enum(["cash", "card", "transfer", "other"]).optional(),
    assignedStaffId: z.coerce.number().int().positive().nullable().optional(),
    dueDate: optionalString,
    notes: optionalString,
    internalNotes: optionalString,
    qualityChecklist: z.record(z.string(), z.boolean()).optional(),
    delivery: z.record(z.string(), z.unknown()).optional(),
    designApproved: z.boolean().optional(),
  })
  .passthrough();

export type GraduationOrderInput = z.infer<typeof graduationOrderInputSchema>;

function active<T extends { isActive?: boolean }>(items: T[]): T[] {
  return items
    .filter((item) => item.isActive !== false)
    .sort(
      (a: any, b: any) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
    );
}

export function normalizeGraduationConfig(value: unknown): GraduationConfig {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<GraduationConfig>)
      : {};
  return {
    styles: active(
      Array.isArray(raw.styles) ? raw.styles : DEFAULT_GRADUATION_CONFIG.styles,
    ),
    fabrics: active(
      Array.isArray(raw.fabrics)
        ? raw.fabrics
        : DEFAULT_GRADUATION_CONFIG.fabrics,
    ),
    accessories: active(
      Array.isArray(raw.accessories)
        ? raw.accessories
        : DEFAULT_GRADUATION_CONFIG.accessories,
    ),
    packages: active(
      Array.isArray(raw.packages)
        ? raw.packages
        : DEFAULT_GRADUATION_CONFIG.packages,
    ),
    universities: active(
      Array.isArray(raw.universities) ? raw.universities : [],
    ),
    colors:
      Array.isArray(raw.colors) && raw.colors.length
        ? raw.colors
        : DEFAULT_GRADUATION_CONFIG.colors,
    fonts:
      Array.isArray(raw.fonts) && raw.fonts.length
        ? raw.fonts
        : DEFAULT_GRADUATION_CONFIG.fonts,
    productionDays: Math.max(
      1,
      Number(raw.productionDays ?? DEFAULT_GRADUATION_CONFIG.productionDays),
    ),
    printingPrices: {
      ...DEFAULT_GRADUATION_CONFIG.printingPrices,
      ...(raw.printingPrices ?? {}),
    },
    embroideryPrices: {
      ...DEFAULT_GRADUATION_CONFIG.embroideryPrices,
      ...(raw.embroideryPrices ?? {}),
    },
    measurementGuideImages: raw.measurementGuideImages ?? {},
    aiEnabled: raw.aiEnabled !== false,
  };
}

export function graduationPriceSummary(
  input: Pick<
    GraduationOrderInput,
    | "styleKey"
    | "packageKey"
    | "fabric"
    | "decoration"
    | "accessories"
    | "discountAmount"
  >,
  config: GraduationConfig,
) {
  const style = config.styles.find((item) => item.key === input.styleKey);
  const fabric = config.fabrics.find((item) => item.key === input.fabric.key);
  const pack = config.packages.find((item) => item.key === input.packageKey);
  const accessoryKeys = new Set([
    ...(pack?.accessories ?? []),
    ...(input.accessories ?? []),
  ]);
  const accessories = config.accessories.filter((item) =>
    accessoryKeys.has(item.key),
  );
  const decorationPrice =
    input.decoration.type === "printing"
      ? Number(config.printingPrices[input.decoration.position] ?? 0)
      : input.decoration.type === "embroidery"
        ? Number(config.embroideryPrices[input.decoration.position] ?? 0)
        : 0;
  const lines = [
    {
      key: "style",
      name: style?.name ?? input.styleKey,
      amount: Number(style?.price ?? 0),
      cost: Number(style?.cost ?? 0),
    },
    {
      key: "fabric",
      name: fabric?.name ?? input.fabric.key,
      amount: Number(fabric?.price ?? 0),
      cost: Number(fabric?.cost ?? 0),
    },
    ...(pack
      ? [
          {
            key: "package",
            name: pack.name,
            amount: Number(pack.price ?? 0),
            cost: Number(pack.cost ?? 0),
          },
        ]
      : []),
    ...(decorationPrice > 0
      ? [
          {
            key: "decoration",
            name: input.decoration.type === "printing" ? "الطباعة" : "التطريز",
            amount: decorationPrice,
            cost: 0,
          },
        ]
      : []),
    ...accessories.map((item) => ({
      key: `accessory:${item.key}`,
      name: item.name,
      amount: Number(item.price ?? 0),
      cost: Number(item.cost ?? 0),
    })),
  ];
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const cost = lines.reduce((sum, line) => sum + line.cost, 0);
  const discount = Math.min(
    Math.max(0, Number(input.discountAmount ?? 0)),
    subtotal,
  );
  const total = Math.max(0, subtotal - discount);
  return { lines, subtotal, discount, total, cost, profit: total - cost };
}

export function graduationInventoryItems(
  input: Pick<
    GraduationOrderInput,
    "styleKey" | "packageKey" | "fabric" | "accessories"
  >,
  config: GraduationConfig,
) {
  const items = [
    config.styles.find((item) => item.key === input.styleKey),
    config.fabrics.find((item) => item.key === input.fabric.key),
    config.packages.find((item) => item.key === input.packageKey),
    ...config.accessories.filter((item) =>
      new Set(input.accessories).has(item.key),
    ),
  ].filter((item): item is GraduationOption => Boolean(item?.productId));
  const grouped = new Map<
    number,
    { productId: number; quantity: number; label: string }
  >();
  for (const item of items) {
    const productId = Number(item.productId);
    const current = grouped.get(productId);
    const quantity = Math.max(1, Number(item.quantity ?? 1));
    grouped.set(productId, {
      productId,
      quantity: (current?.quantity ?? 0) + quantity,
      label: item.name,
    });
  }
  return [...grouped.values()];
}

export function estimateGraduationProduction(
  input: GraduationOrderInput,
  config: GraduationConfig,
) {
  const embroideryHours = input.decoration.type === "embroidery" ? 3 : 0;
  const printingHours = input.decoration.type === "printing" ? 1.5 : 0;
  const accessoryHours = input.accessories.length * 0.25;
  const totalHours = Number(
    (8 + embroideryHours + printingHours + accessoryHours).toFixed(1),
  );
  const height = Number(input.measurements.height || 0);
  const fabricMeters = Number(Math.max(2.5, (height / 100) * 2.1).toFixed(2));
  return {
    totalHours,
    productionDays: Math.max(config.productionDays, Math.ceil(totalHours / 8)),
    requiredEmployees: totalHours > 12 ? 2 : 1,
    fabricMeters,
    threadMeters: Math.ceil(fabricMeters * 35),
    accessoryCount: input.accessories.length,
  };
}

export function recommendedGraduationSize(
  measurements: Partial<z.infer<typeof graduationMeasurementsSchema>>,
) {
  const chest = Number(measurements.chest ?? 0);
  const height = Number(measurements.height ?? 0);
  const base =
    chest <= 88
      ? "S"
      : chest <= 100
        ? "M"
        : chest <= 112
          ? "L"
          : chest <= 124
            ? "XL"
            : "XXL";
  const length = height < 160 ? "قصير" : height > 185 ? "طويل" : "اعتيادي";
  return `${base} - ${length}`;
}
