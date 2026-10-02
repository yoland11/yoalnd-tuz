export type WholesalePriceTier = {
  minimumQuantity: number;
  unitPrice: number;
  isActive?: boolean;
};

export type WholesalePriceResolution = {
  unitPrice: number;
  source: "customer" | "tier" | "base" | "retail";
  tierMinimumQuantity?: number;
};

export type WholesalePriceInput = {
  retailPrice: number;
  wholesalePrice: number | null;
  quantity: number;
  tiers: WholesalePriceTier[];
  customerPrice?: number | null;
};

const validNonnegativeMoney = (value: number) =>
  Number.isFinite(value) && value >= 0;

/** Validates a complete product tier set before any persistent replacement. */
export function validateWholesaleTiers(
  tiers: WholesalePriceTier[],
): { ok: true } | { ok: false; message: string } {
  const seen = new Set<number>();
  const ordered = [...tiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  let previousPrice = Number.POSITIVE_INFINITY;
  for (const tier of ordered) {
    if (
      !Number.isFinite(tier.minimumQuantity) ||
      tier.minimumQuantity <= 0 ||
      Math.abs(tier.minimumQuantity * 1_000 - Math.round(tier.minimumQuantity * 1_000)) > 1e-8
    )
      return { ok: false, message: "الحد الأدنى للكمية يجب أن يكون موجباً وبدقة لا تتجاوز 3 منازل" };
    if (!validNonnegativeMoney(tier.unitPrice))
      return { ok: false, message: "سعر الشريحة يجب أن يكون رقماً موجباً أو صفراً" };
    if (seen.has(tier.minimumQuantity))
      return { ok: false, message: "لا يمكن تكرار الحد الأدنى للكمية" };
    if (tier.unitPrice > previousPrice)
      return { ok: false, message: "يجب ألا يرتفع سعر الوحدة في شريحة الكمية الأعلى" };
    seen.add(tier.minimumQuantity);
    previousPrice = tier.unitPrice;
  }
  return { ok: true };
}

/** Pure resolver. Active explicit tiers replace the wholesale base only from their threshold upward. */
export function resolveWholesaleUnitPrice(
  input: WholesalePriceInput,
): WholesalePriceResolution {
  const { retailPrice, wholesalePrice, quantity } = input;
  const customerPrice = input.customerPrice;
  if (!validNonnegativeMoney(retailPrice) || !Number.isFinite(quantity) || quantity <= 0)
    throw new Error("سعر المنتج أو الكمية غير صالحين");
  if (customerPrice != null) {
    if (!validNonnegativeMoney(customerPrice)) throw new Error("سعر العميل الخاص غير صالح");
    return { unitPrice: customerPrice, source: "customer" };
  }
  const tier = input.tiers
    .filter((candidate) => candidate.isActive !== false && candidate.minimumQuantity <= quantity)
    .sort((a, b) => b.minimumQuantity - a.minimumQuantity)[0];
  if (tier) return { unitPrice: tier.unitPrice, source: "tier", tierMinimumQuantity: tier.minimumQuantity };
  if (wholesalePrice != null) {
    if (!validNonnegativeMoney(wholesalePrice)) throw new Error("سعر الجملة الأساسي غير صالح");
    return { unitPrice: wholesalePrice, source: "base" };
  }
  return { unitPrice: retailPrice, source: "retail" };
}
