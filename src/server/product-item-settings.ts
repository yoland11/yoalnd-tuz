export type ProductItemType = "product" | "service";

export type ProductItemSettings = {
  itemType: ProductItemType;
  serviceUnit: string | null;
  trackInventory: boolean;
};

type ProductItemInput = {
  itemType?: unknown;
  serviceUnit?: unknown;
  trackInventory?: unknown;
};

export function normalizeProductItemSettings(
  input: ProductItemInput,
  current?: Partial<ProductItemSettings> | null,
): { ok: true; settings: ProductItemSettings } | { ok: false; message: string } {
  const itemType = String(input.itemType ?? current?.itemType ?? "product");
  if (itemType !== "product" && itemType !== "service") {
    return { ok: false, message: "نوع العنصر غير صحيح" };
  }

  const rawUnit =
    input.serviceUnit === undefined ? current?.serviceUnit : input.serviceUnit;
  const serviceUnit = typeof rawUnit === "string" ? rawUnit.trim() : "";
  if (itemType === "service" && !serviceUnit) {
    return { ok: false, message: "أدخل وحدة بيع الخدمة" };
  }

  const requestedTracking =
    input.trackInventory === undefined
      ? current?.trackInventory ?? true
      : input.trackInventory === true;
  return {
    ok: true,
    settings: {
      itemType,
      serviceUnit: itemType === "service" ? serviceUnit : null,
      trackInventory: itemType === "service" ? false : requestedTracking,
    },
  };
}
