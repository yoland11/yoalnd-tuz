export type KoshaEquipmentLine = {
  productId: number;
  variantId: number | null;
  quantity: number;
  unit: string;
  returnable: boolean;
  required: boolean;
  notes: string;
};

export function equipmentKey(line: {
  productId: number;
  variantId?: number | null;
}) {
  return `${line.productId}:${line.variantId ?? 0}`;
}

/** Template data only: this module never writes inventory or financial values. */
export function normalizeEquipment(value: unknown): KoshaEquipmentLine[] {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error("قائمة المعدات غير صالحة (الحد 200)");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object")
      throw new Error("بيانات المعدة غير صالحة");
    const productId = Number(raw.productId);
    const variantId = raw.variantId == null ? null : Number(raw.variantId);
    const quantity = Number(raw.quantity);
    if (
      !Number.isSafeInteger(productId) ||
      productId <= 0 ||
      (variantId !== null &&
        (!Number.isSafeInteger(variantId) || variantId <= 0))
    )
      throw new Error("اختر معدة ومتغيراً صحيحين");
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 999999 ||
      Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001
    )
      throw new Error("الكمية يجب أن تكون موجبة وبحد أقصى ثلاث منازل عشرية");
    if (
      typeof raw.returnable !== "boolean" ||
      typeof raw.required !== "boolean"
    )
      throw new Error("حدد نوع المادة وحالة الإلزام");
    const unit = String(raw.unit ?? "قطعة").trim();
    const notes = String(raw.notes ?? "").trim();
    if (!unit || unit.length > 40 || notes.length > 2000)
      throw new Error("الوحدة أو الملاحظة غير صالحة");
    const line = {
      productId,
      variantId,
      quantity,
      unit,
      returnable: raw.returnable,
      required: raw.required,
      notes,
    };
    const key = equipmentKey(line);
    if (seen.has(key)) throw new Error("المعدة والمتغير مسجلان مسبقاً");
    seen.add(key);
    return line;
  });
}

/** Explicit imports append missing identities; never overwrite booking overrides. */
export function mergeEquipmentImport<
  T extends { productId: number; variantId?: number | null },
>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map(equipmentKey));
  const result = [...existing];
  for (const line of incoming) {
    const key = equipmentKey(line);
    if (!seen.has(key)) {
      result.push({ ...line });
      seen.add(key);
    }
  }
  return result;
}

export function equipmentAvailability(
  stock: number,
  reserved: number,
  required: number,
) {
  const available = Math.max(0, Math.round((stock - reserved) * 1000) / 1000);
  return {
    required,
    available,
    reserved,
    missing: Math.max(0, Math.round((required - available) * 1000) / 1000),
  };
}

export function selectTemplateEquipment(
  template: KoshaEquipmentLine[],
  value: unknown,
) {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error("قائمة الاستيراد غير صالحة");
  const byKey = new Map(template.map((line) => [equipmentKey(line), line]));
  return normalizeEquipment(
    value.map((raw) => {
      const base =
        raw &&
        byKey.get(
          equipmentKey({
            productId: Number(raw.productId),
            variantId: raw.variantId == null ? null : Number(raw.variantId),
          }),
        );
      if (!base) throw new Error("المعدة غير موجودة في قالب الكوشة الحالي");
      return {
        ...base,
        quantity: raw.quantity,
        notes: raw.notes === undefined ? base.notes : raw.notes,
      };
    }),
  );
}
