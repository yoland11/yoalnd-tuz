export type PurchaseVariantOption = {
  id: number;
  productId: number;
  color?: string | null;
  size?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: number | string | null;
  cost?: number | string | null;
  stock?: number | string | null;
  isActive?: boolean | null;
};

export type PurchaseVariantProduct = {
  id: number;
  name: string;
  variants: PurchaseVariantOption[];
};

export type PurchaseVariantLineDraft = {
  productId: number | null;
  variantId?: number | null;
  quantity: number;
  costPrice: number;
  [key: string]: unknown;
};

export type PreparedPurchaseVariantLine<T extends PurchaseVariantLineDraft> = T & {
  variantId: number | null;
  variantLabel: string | null;
  variantSku: string | null;
  barcode: string | null;
  total: number;
};

export function purchaseVariantLabel(variant: PurchaseVariantOption) {
  return [variant.color, variant.size]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" / ");
}

export function preparePurchaseVariantLines<T extends PurchaseVariantLineDraft>(
  lines: T[],
  products: PurchaseVariantProduct[],
  allowInactiveVariantIds: ReadonlySet<number> = new Set(),
):
  | { ok: true; lines: Array<PreparedPurchaseVariantLine<T>> }
  | { ok: false; message: string } {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const prepared: Array<PreparedPurchaseVariantLine<T>> = [];

  for (const line of lines) {
    const product = line.productId == null ? undefined : productsById.get(line.productId);
    const variantId = line.variantId == null ? null : Number(line.variantId);
    if (variantId != null && (!Number.isSafeInteger(variantId) || variantId <= 0)) {
      return { ok: false, message: "المتغير المحدد غير صحيح" };
    }
    if (!product) {
      if (variantId != null) return { ok: false, message: "اختر المنتج المرتبط بالمتغير" };
      prepared.push({ ...line, variantId: null, variantLabel: null, variantSku: null, barcode: String((line as any).barcode ?? "").trim() || null, total: Math.max(0, line.quantity * line.costPrice - Number(line.discount ?? 0)) });
      continue;
    }

    const variants = product.variants ?? [];
    if (variants.length && variantId == null) {
      return { ok: false, message: `اختر متغير المنتج: ${product.name}` };
    }
    if (!variants.length && variantId != null) {
      return { ok: false, message: `المنتج ${product.name} لا يحتوي على هذا المتغير` };
    }

    const variant = variantId == null ? null : variants.find((item) => item.id === variantId);
    if (variantId != null && (!variant || variant.productId !== product.id || (variant.isActive === false && !allowInactiveVariantIds.has(variantId)))) {
      return { ok: false, message: "المتغير غير نشط أو لا يتبع المنتج المحدد" };
    }
    if (variant && !Number.isInteger(Number(line.quantity))) {
      return { ok: false, message: "كمية متغير المنتج يجب أن تكون عدداً صحيحاً" };
    }

    const costPrice = Number(line.costPrice) || 0;
    const discount = Number(line.discount ?? 0) || 0;
    prepared.push({
      ...line,
      variantId: variant?.id ?? null,
      variantLabel: variant ? purchaseVariantLabel(variant) : null,
      variantSku: variant?.sku?.trim() || null,
      barcode: variant?.barcode?.trim() || String((line as any).barcode ?? "").trim() || null,
      total: Math.max(0, Math.round((line.quantity * costPrice - discount) * 100) / 100),
    });
  }

  return { ok: true, lines: prepared };
}

export function groupPurchaseInvoiceStockChanges(
  lines: Array<{ productId: number | null; variantId?: number | null; quantity: number | string }>,
) {
  const productQuantities = new Map<number, number>();
  const variantQuantities = new Map<number, number>();
  for (const line of lines) {
    const productId = Number(line.productId ?? 0);
    const quantity = Number(line.quantity) || 0;
    if (!productId || quantity <= 0) continue;
    const variantId = line.variantId == null ? null : Number(line.variantId);
    if (variantId != null && Number.isSafeInteger(variantId) && variantId > 0) {
      variantQuantities.set(variantId, (variantQuantities.get(variantId) ?? 0) + quantity);
    } else {
      productQuantities.set(productId, (productQuantities.get(productId) ?? 0) + quantity);
    }
  }
  return { productQuantities, variantQuantities };
}
