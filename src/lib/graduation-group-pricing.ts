import { resolveGroupSashPolicy, SASH_TYPES } from "./graduation-student-flow";

export const MAX_GROUP_SASH_PRICE = 1_000_000_000;
export type GroupSashPricing = { mode: "by_sash"; prices: Record<string, number> };
export type GraduationPricingLine = { key: string; name: string; amount: number; cost: number };
export type GraduationPricingSummary = {
  lines: GraduationPricingLine[];
  subtotal: number;
  discount: number;
  total: number;
  cost: number;
  profit: number;
  groupSashPricing?: { mode: "by_sash"; sashType: string; amount: number };
};
export class GroupSashPricingError extends Error {
  readonly code = "GRADUATION_GROUP_PRICING_INVALID";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "GroupSashPricingError";
  }
}

export function normalizeSashType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const selection = value.trim();
  return SASH_TYPES.find((type) => type.key === selection || type.label === selection)?.key ?? null;
}

export function groupPricingSashTypes(configuration: Record<string, unknown>): typeof SASH_TYPES {
  const policy = resolveGroupSashPolicy(configuration);
  if (policy.mode === "fixed") return SASH_TYPES.filter((type) => type.key === policy.sashType);
  if (policy.mode === "restricted") {
    return (policy.sashOptions || []).flatMap((key) => {
      const type = SASH_TYPES.find((item) => item.key === key);
      return type ? [type] : [];
    });
  }
  return SASH_TYPES;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateGroupSashPricing(value: unknown, configuration: Record<string, unknown>):
  { success: true; pricing: GroupSashPricing | null } | { success: false; error: string } {
  if (value == null) return { success: true, pricing: null };
  if (
    !isRecord(value) || value.mode !== "by_sash" ||
    Object.keys(value).some((key) => key !== "mode" && key !== "prices") ||
    !isRecord(value.prices)
  ) return { success: false, error: "إعداد تسعير الأوشحة غير صالح" };

  const prices = value.prices;
  for (const [key, amount] of Object.entries(prices)) {
    if (!SASH_TYPES.some((type) => type.key === key)) {
      return { success: false, error: "نوع وشاح غير معروف في إعداد الأسعار" };
    }
    if (
      typeof amount !== "number" || !Number.isFinite(amount) ||
      amount < 0 || amount > MAX_GROUP_SASH_PRICE || Number(amount.toFixed(2)) !== amount
    ) return { success: false, error: "أدخل سعراً صحيحاً غير سالب لكل وشاح، حتى مليار دينار ومنزلتين عشريتين" };
  }
  for (const type of groupPricingSashTypes(configuration)) {
    if (!Object.hasOwn(prices, type.key)) {
      return { success: false, error: `حدد سعر تجهيزات الوشاح ${type.label}` };
    }
  }
  return {
    success: true,
    pricing: { mode: "by_sash", prices: Object.fromEntries(Object.entries(prices)) as Record<string, number> },
  };
}

export function groupSashPrice(configuration: Record<string, unknown>, sashType: unknown): number | null {
  const validation = validateGroupSashPricing(configuration.sashPricing, configuration);
  if (!validation.success) throw new GroupSashPricingError(validation.error);
  if (!validation.pricing) return null;
  const type = normalizeSashType(sashType);
  if (!type) throw new GroupSashPricingError("حدد نوع الوشاح للحصول على سعر التجهيزات");
  if (!groupPricingSashTypes(configuration).some((item) => item.key === type)) {
    throw new GroupSashPricingError("نوع الوشاح المختار غير معتمد لهذه المجموعة");
  }
  return validation.pricing.prices[type];
}

export function applyGroupSashPricing(
  configuration: Record<string, unknown>,
  sashType: unknown,
  catalogPricing: GraduationPricingSummary,
  extrasLines: GraduationPricingLine[] = [],
): GraduationPricingSummary {
  const amount = groupSashPrice(configuration, sashType);
  const normalizedType = normalizeSashType(sashType);
  const kitCost = catalogPricing.lines.reduce((sum, line) => sum + line.cost, 0);
  const kitLines = amount === null
    ? catalogPricing.lines
    : [{
        key: "group_sash_kit",
        name: `تجهيزات التخرج - ${SASH_TYPES.find((type) => type.key === normalizedType)?.label}`,
        amount,
        cost: kitCost,
      }];
  const lines = [...kitLines, ...extrasLines];
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const cost = lines.reduce((sum, line) => sum + line.cost, 0);
  const discount = amount === null ? Math.min(Math.max(0, catalogPricing.discount), subtotal) : 0;
  const total = Math.max(0, subtotal - discount);
  return {
    lines, subtotal, discount, total, cost, profit: total - cost,
    ...(amount === null ? {} : {
      groupSashPricing: { mode: "by_sash" as const, sashType: normalizedType!, amount },
    }),
  };
}
