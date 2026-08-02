import { z } from "zod/v4";

export const GRADUATION_STAGES = [
  "incomplete_data",
  "new",
  "awaiting_measurements",
  "measurements",
  "awaiting_design",
  "awaiting_approval",
  "approved",
  "fabric_cutting",
  "tailoring",
  "printing",
  "embroidery",
  "ironing",
  "quality_check",
  "awaiting_packaging",
  "packaging",
  "ready",
  "delivered",
  "completed",
  "cancelled",
] as const;

export const GRADUATION_STAGE_LABELS: Record<
  (typeof GRADUATION_STAGES)[number],
  string
> = {
  incomplete_data: "بيانات غير مكتملة",
  new: "جديد",
  awaiting_measurements: "بانتظار المقاسات",
  measurements: "القياسات",
  awaiting_design: "بانتظار التصميم",
  awaiting_approval: "بانتظار الموافقة",
  approved: "معتمد",
  fabric_cutting: "قص القماش",
  tailoring: "الخياطة",
  printing: "الطباعة",
  embroidery: "التطريز",
  ironing: "الكي",
  quality_check: "فحص الجودة",
  awaiting_packaging: "بانتظار التغليف",
  packaging: "التغليف",
  ready: "جاهز",
  delivered: "تم التسليم",
  completed: "مكتمل",
  cancelled: "ملغي",
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
  requiresMeasurements?: boolean;
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

// ---------------------------------------------------------------------------
// Custom graduation package (per-piece builder) — shared client/server types
// ---------------------------------------------------------------------------

// Flexible per-type product attributes stored inside `graduation_templates.configuration`.
// `optionPrices` maps a "<field>:<value>" key to an EXTRA charge added to the base
// price when that option is selected (e.g. "size:XL", "fabric:velvet", "print:full").
export type GraduationProductConfig = {
  sizes?: string[];
  colors?: string[];
  fabrics?: string[];
  printOptions?: string[];
  embroideryOptions?: string[];
  tasselColors?: string[];
  tasselOptions?: string[];
  productionDays?: number;
  rentalOrSale?: "rental" | "sale" | string;
  sizeChart?: string;
  fabricType?: string;
  gownModel?: string;
  gownStyle?: string;
  sashModel?: string;
  capModel?: string;
  material?: string;
  optionPrices?: Record<string, number>;
  productId?: number | null;
  cost?: number;
  requiresMeasurements?: boolean;
  [key: string]: unknown;
};

// Public product shape emitted by getGraduationEnterpriseCatalog (cost never exposed).
export type GraduationCatalogProduct = {
  id: number;
  code: string;
  name: string;
  templateType: string;
  previewImageUrl?: string | null;
  modelUrl?: string | null;
  images?: string[];
  defaultPrice: number;
  discountPrice?: number | null;
  trackStock?: boolean;
  stock?: number;
  available?: boolean;
  configuration?: GraduationProductConfig;
};

// A single selected piece in the custom-package builder (client → server payload).
export type GraduationCustomItem = {
  itemType: "robe" | "sash" | "cap" | "accessory";
  templateId: number;
  quantity: number;
  size?: string;
  color?: string;
  fabric?: string;
  printType?: string;
  embroideryType?: string;
  tasselColor?: string;
  customization?: Record<string, unknown>;
  notes?: string;
};

export type GraduationCustomLine = {
  key: string;
  itemType: string;
  templateId: number;
  productId: number | null;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  size: string | null;
  color: string | null;
  variantLabel: string | null;
  originalUnitPrice: number;
  finalUnitPrice: number;
  customizationCharge: number;
  lineTotal: number;
  customization: Record<string, unknown>;
  notes: string | null;
  available: boolean;
};

const OPTION_FIELDS: Array<[keyof GraduationCustomItem, string]> = [
  ["size", "size"],
  ["color", "color"],
  ["fabric", "fabric"],
  ["printType", "print"],
  ["embroideryType", "embroidery"],
  ["tasselColor", "tassel"],
];

function optionCharge(product: GraduationCatalogProduct, item: GraduationCustomItem) {
  const prices = product.configuration?.optionPrices ?? {};
  let charge = 0;
  for (const [field, prefix] of OPTION_FIELDS) {
    const value = item[field];
    if (!value) continue;
    const extra = Number(prices[`${prefix}:${value}`] ?? 0);
    if (Number.isFinite(extra)) charge += extra;
  }
  return Math.max(0, charge);
}

function variantLabel(item: GraduationCustomItem) {
  return (
    [item.size, item.color, item.fabric, item.printType, item.embroideryType, item.tasselColor]
      .filter((value) => value && String(value).trim())
      .join(" · ") || null
  );
}

/**
 * Pure, authoritative pricing for a custom package. Shared by the client (live
 * preview) and the server (recompute — client prices are display-only).
 * `discountAmount` is the order-level manual discount.
 */
export function customPackagePriceSummary(
  items: GraduationCustomItem[],
  products: GraduationCatalogProduct[],
  discountAmount = 0,
) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: GraduationCustomLine[] = [];
  for (const item of items) {
    const product = byId.get(item.templateId);
    if (!product) continue;
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const base =
      product.discountPrice != null && Number(product.discountPrice) > 0
        ? Number(product.discountPrice)
        : Number(product.defaultPrice || 0);
    const charge = optionCharge(product, item);
    const finalUnitPrice = Math.max(0, base + charge);
    lines.push({
      key: `custom:${item.itemType}:${item.templateId}:${lines.length}`,
      itemType: item.itemType,
      templateId: product.id,
      productId: Number(product.configuration?.productId || 0) || null,
      name: product.name,
      sku: (product as any).sku ?? null,
      imageUrl: product.previewImageUrl ?? null,
      quantity,
      size: item.size ?? null,
      color: item.color ?? null,
      variantLabel: variantLabel(item),
      originalUnitPrice: Number(product.defaultPrice || 0),
      finalUnitPrice,
      customizationCharge: charge,
      lineTotal: finalUnitPrice * quantity,
      customization: item.customization ?? {},
      notes: item.notes ?? null,
      available:
        product.available !== false &&
        (!product.trackStock || Number(product.stock ?? 0) >= quantity),
    });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discount = Math.min(Math.max(0, Number(discountAmount) || 0), subtotal);
  const total = Math.max(0, subtotal - discount);
  return { lines, subtotal, discount, total };
}

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

const optionalMeasurementNumber = (minimum: number, maximum: number) =>
  z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined ? undefined : value,
    z.coerce.number().min(minimum).max(maximum).optional(),
  );

export const graduationMeasurementsSchema = z
  .object({
    height: optionalMeasurementNumber(80, 250),
    weight: optionalMeasurementNumber(20, 300),
    shoulder: optionalMeasurementNumber(20, 100),
    chest: optionalMeasurementNumber(40, 220),
    waist: optionalMeasurementNumber(35, 220),
    hip: optionalMeasurementNumber(35, 240),
    sleeveLength: optionalMeasurementNumber(20, 120),
    neck: optionalMeasurementNumber(20, 80),
    gender: z.enum(["male", "female"]).optional(),
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
    customPackage: z
      .object({
        enabled: z.boolean().default(false),
        enterprisePackageId: z.coerce.number().int().positive().optional(),
        // Legacy single-select shape — kept so old clients keep working.
        robeTemplateId: z.coerce.number().int().positive().optional(),
        sashTemplateId: z.coerce.number().int().positive().optional(),
        capTemplateId: z.coerce.number().int().positive().optional(),
        // New multi-item builder payload.
        items: z
          .array(
            z.object({
              itemType: z.enum(["robe", "sash", "cap", "accessory"]),
              templateId: z.coerce.number().int().positive(),
              quantity: z.coerce.number().int().min(1).max(50).default(1),
              size: optionalString,
              color: optionalString,
              fabric: optionalString,
              printType: optionalString,
              embroideryType: optionalString,
              tasselColor: optionalString,
              customization: z.record(z.string(), z.unknown()).default({}),
              notes: optionalString,
            }),
          )
          .default([]),
      })
      .default({ enabled: false, items: [] }),
    groupToken: optionalString,
    status: z.enum(["draft", "submitted"]).default("submitted"),
    measurements: graduationMeasurementsSchema.default({}),
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
    // Graduation Extras (Phase 1): Store flowers (added as order items) + one
    // photography session (created as a linked service_order). Both optional so
    // existing clients that omit `extras` are unaffected.
    extras: z
      .object({
        flowers: z
          .array(
            z.object({
              productId: z.coerce.number().int().positive(),
              variantId: z.coerce.number().int().positive().optional(),
              quantity: z.coerce.number().int().min(1).max(100).default(1),
              color: optionalString,
              wrapColor: optionalString,
              ribbonColor: optionalString,
              giftCard: optionalString,
            }),
          )
          .default([]),
        photography: z
          .object({
            serviceId: z.coerce.number().int().positive(),
            session: optionalString,
            date: optionalString,
            time: optionalString,
            photographerId: z.coerce.number().int().positive().optional(),
            location: optionalString,
            notes: optionalString,
          })
          .nullable()
          .optional(),
      })
      .default({ flowers: [] }),
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
    assignedTailorId: z.coerce.number().int().positive().nullable().optional(),
    tailorStatus: z
      .enum([
        "new",
        "cutting",
        "sewing",
        "embroidery",
        "ironing",
        "quality_check",
        "packaging",
        "completed",
      ])
      .optional(),
    tailorCompletionDate: optionalString,
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
