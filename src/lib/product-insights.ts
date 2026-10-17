/**
 * Pure product-intelligence rules shared by the server, the page and the tests.
 * Every input comes from existing AJN records; nothing here invents data.
 */

export type ProductKind = "product" | "variants" | "service" | "individual_asset" | "quantity_asset";

export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  product: "منتج مادي",
  variants: "منتج بمتغيرات",
  service: "خدمة",
  individual_asset: "أصل فردي",
  quantity_asset: "أصل متعدد الكمية",
};

export function productKind(input: {
  itemType?: string | null;
  trackInventory?: boolean | null;
  isAsset?: boolean | null;
  quantityTracked?: boolean;
  variantCount?: number;
}): ProductKind {
  if (input.isAsset) return input.quantityTracked ? "quantity_asset" : "individual_asset";
  if (input.itemType === "service" || input.trackInventory === false) return "service";
  if ((input.variantCount ?? 0) > 0) return "variants";
  return "product";
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const round3 = (value: number) => Math.round((Number(value) || 0) * 1000) / 1000;

export type ChannelFigures = {
  quantity: number;
  invoices: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  /** null when the source records carry no cost snapshot (online orders). */
  cogs: number | null;
  grossProfit: number | null;
  margin: number | null;
  returnsQuantity: number;
  returnsValue: number;
};

export function channelFigures(input: {
  quantity: number;
  invoices: number;
  grossSales: number;
  discounts: number;
  cogs: number | null;
  returnsQuantity?: number;
  returnsValue?: number;
}): ChannelFigures {
  const netSales = round2(input.grossSales - input.discounts);
  const cogs = input.cogs === null ? null : round2(input.cogs);
  const grossProfit = cogs === null ? null : round2(netSales - cogs);
  return {
    quantity: round3(input.quantity),
    invoices: Math.round(input.invoices),
    grossSales: round2(input.grossSales),
    discounts: round2(input.discounts),
    netSales,
    cogs,
    grossProfit,
    margin: grossProfit === null || netSales === 0 ? null : round2((grossProfit / netSales) * 100),
    returnsQuantity: round3(input.returnsQuantity ?? 0),
    returnsValue: round2(input.returnsValue ?? 0),
  };
}

/** Totals across channels without double counting; profit only where cost exists. */
export function combineChannels(channels: ChannelFigures[]) {
  const withCost = channels.filter((channel) => channel.cogs !== null);
  const netSales = round2(channels.reduce((sum, channel) => sum + channel.netSales, 0));
  const costedNet = round2(withCost.reduce((sum, channel) => sum + channel.netSales, 0));
  const cogs = round2(withCost.reduce((sum, channel) => sum + (channel.cogs ?? 0), 0));
  const grossProfit = round2(costedNet - cogs);
  return {
    quantity: round3(channels.reduce((sum, channel) => sum + channel.quantity, 0)),
    invoices: channels.reduce((sum, channel) => sum + channel.invoices, 0),
    grossSales: round2(channels.reduce((sum, channel) => sum + channel.grossSales, 0)),
    discounts: round2(channels.reduce((sum, channel) => sum + channel.discounts, 0)),
    netSales,
    cogs,
    grossProfit,
    /** Margin over the revenue that has a recorded cost. */
    margin: costedNet === 0 ? null : round2((grossProfit / costedNet) * 100),
    uncostedNetSales: round2(netSales - costedNet),
    returnsQuantity: round3(channels.reduce((sum, channel) => sum + channel.returnsQuantity, 0)),
    returnsValue: round2(channels.reduce((sum, channel) => sum + channel.returnsValue, 0)),
    averagePrice:
      channels.reduce((sum, channel) => sum + channel.quantity, 0) > 0
        ? round2(netSales / channels.reduce((sum, channel) => sum + channel.quantity, 0))
        : null,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS));

/**
 * Slow-moving only when the product has stock, is older than the threshold and
 * sold nothing inside the threshold window. A new product is never "slow".
 */
export function slowMoving(input: {
  today: string;
  createdAt: string | null;
  lastSaleDate: string | null;
  stock: number;
  thresholdDays: number;
  unitsLast30Days: number;
}) {
  const ageDays = input.createdAt ? daysBetween(input.createdAt.slice(0, 10), input.today) : null;
  const daysSinceSale = input.lastSaleDate ? daysBetween(input.lastSaleDate.slice(0, 10), input.today) : null;
  const oldEnough = ageDays === null || ageDays >= input.thresholdDays;
  const quiet = daysSinceSale === null ? true : daysSinceSale >= input.thresholdDays;
  return {
    ageDays,
    daysSinceSale,
    lastSaleDate: input.lastSaleDate,
    thresholdDays: input.thresholdDays,
    velocityPerDay: round3(input.unitsLast30Days / 30),
    isSlow: input.stock > 0 && oldEnough && quiet,
    tooNew: !oldEnough,
  };
}

/**
 * Depletion forecast from real sales only. Needs at least 14 days of product age
 * and 3 selling days in the window; otherwise it reports insufficient data.
 */
export function depletionForecast(input: {
  available: number;
  unitsInWindow: number;
  sellingDaysInWindow: number;
  windowDays: number;
  ageDays: number | null;
  leadTimeDays: number;
  coverDays: number;
  minStock: number;
  sameMonthLastYear: number | null;
  last30Days: number;
}) {
  const effectiveWindow = Math.max(1, Math.min(input.windowDays, input.ageDays ?? input.windowDays));
  if (effectiveWindow < 14 || input.sellingDaysInWindow < 3 || input.unitsInWindow <= 0)
    return { sufficient: false as const, message: "البيانات غير كافية للتوقع" };
  const averageDaily = input.unitsInWindow / effectiveWindow;
  const daysRemaining = input.available > 0 ? Math.floor(input.available / averageDaily) : 0;
  const reorderPoint = Math.ceil(averageDaily * input.leadTimeDays + input.minStock);
  const recommended = Math.max(0, Math.ceil(averageDaily * (input.leadTimeDays + input.coverDays) + input.minStock - input.available));
  const seasonalRatio =
    input.sameMonthLastYear !== null && input.last30Days > 0 ? round2(input.sameMonthLastYear / input.last30Days) : null;
  return {
    sufficient: true as const,
    averageDaily: round3(averageDaily),
    windowDays: effectiveWindow,
    daysRemaining,
    leadTimeDays: input.leadTimeDays,
    reorderPoint,
    recommendedQuantity: recommended,
    reorderNow: input.available <= reorderPoint,
    seasonal:
      seasonalRatio !== null && seasonalRatio >= 1.5
        ? `مبيعات نفس الشهر من السنة الماضية (${input.sameMonthLastYear}) أعلى بـ ${seasonalRatio} مرة من آخر 30 يوماً؛ راجع الكمية قبل الموسم.`
        : null,
  };
}

export type ProductAlert = { key: string; level: "danger" | "warning" | "info"; title: string; reason: string; action?: { label: string; href: string } };

export function productAlerts(input: {
  productId: number;
  kind: ProductKind;
  stock: number;
  available: number;
  minStock: number;
  isSlow: boolean;
  daysSinceSale: number | null;
  price: number;
  costPrice: number | null;
  latestPurchaseCost: number | null;
  previousAveragePurchaseCost: number | null;
  soldQuantity: number;
  returnsQuantity: number;
  manualAdjustmentsLast30Days: number;
}): ProductAlert[] {
  const alerts: ProductAlert[] = [];
  const stocked = input.kind !== "service";
  if (stocked && input.stock <= 0)
    alerts.push({ key: "out_of_stock", level: "danger", title: "نفد المخزون", reason: "الرصيد الحالي صفر.", action: { label: "فواتير الشراء", href: "/admin/purchases" } });
  else if (stocked && input.minStock > 0 && input.available <= input.minStock)
    alerts.push({ key: "low_stock", level: "warning", title: "مخزون منخفض", reason: `المتاح ${input.available} والحد الأدنى ${input.minStock}.`, action: { label: "فواتير الشراء", href: "/admin/purchases" } });
  if (stocked && input.isSlow)
    alerts.push({ key: "slow_moving", level: "warning", title: "منتج راكد", reason: input.daysSinceSale === null ? "لم يُبع منذ إضافته." : `آخر بيع قبل ${input.daysSinceSale} يوماً.` });
  if (input.costPrice !== null && input.costPrice > 0 && input.price > 0 && input.price < input.costPrice)
    alerts.push({ key: "negative_margin", level: "danger", title: "هامش سالب", reason: `سعر البيع ${input.price} أقل من التكلفة ${input.costPrice}.` });
  if (
    input.latestPurchaseCost !== null &&
    input.previousAveragePurchaseCost !== null &&
    input.previousAveragePurchaseCost > 0 &&
    input.latestPurchaseCost >= input.previousAveragePurchaseCost * 1.1
  )
    alerts.push({
      key: "rising_cost",
      level: "warning",
      title: "ارتفاع تكلفة الشراء",
      reason: `آخر سعر شراء ${input.latestPurchaseCost} أعلى من المتوسط السابق ${round2(input.previousAveragePurchaseCost)}.`,
    });
  const totalMoved = input.soldQuantity + input.returnsQuantity;
  if (totalMoved >= 5 && input.returnsQuantity / totalMoved >= 0.1)
    alerts.push({ key: "high_returns", level: "warning", title: "نسبة إرجاع مرتفعة", reason: `${round2((input.returnsQuantity / totalMoved) * 100)}% من الكمية أُلغيت أو أُرجعت.` });
  if (input.manualAdjustmentsLast30Days >= 3)
    alerts.push({ key: "adjustments", level: "info", title: "تعديلات مخزون متكررة", reason: `${input.manualAdjustmentsLast30Days} تعديلات يدوية خلال 30 يوماً.` });
  return alerts;
}

/** ROI only from directly attributable revenue; never from whole-booking revenue. */
export function assetReturn(input: { acquisitionCost: number; maintenanceCost: number; attributableRevenue: number }) {
  if (input.acquisitionCost <= 0 || input.attributableRevenue <= 0)
    return { calculable: false as const, reason: input.attributableRevenue <= 0 ? "لا توجد إيرادات منسوبة مباشرة لهذا الأصل" : "تكلفة الاقتناء غير مسجلة" };
  const contribution = round2(input.attributableRevenue - input.maintenanceCost);
  return { calculable: true as const, contribution, roi: round2((contribution / input.acquisitionCost) * 100) };
}

/** Movement labels on top of the generic stock-movement classifier. */
export const MOVEMENT_REASON_LABELS: Record<string, string> = {
  product_initial_stock: "رصيد افتتاحي",
  purchase_invoice_stock_increased: "استلام شراء",
  purchase_invoice_edit_reversal: "مرتجع / عكس شراء",
  sales_invoice_stock_deducted: "بيع",
  sales_invoice_stock_deducted_again: "بيع (تعديل فاتورة)",
  sales_invoice_stock_restored: "إرجاع من فاتورة بيع",
  sales_invoice_stock_restored_for_edit: "إرجاع لتعديل فاتورة",
  sales_invoice_cancellation_return: "مرتجع مبيعات (إلغاء فاتورة)",
  order_stock_deducted: "بيع متجر إلكتروني",
  rental_stock_deducted: "إيجار",
  rental_reactivated_stock_deducted: "إيجار (إعادة تفعيل)",
  manual_stock_adjustment: "تسوية مخزون يدوية",
  warehouse_transfer_executed: "تحويل بين المستودعات",
  quantity_asset_checkout: "إخراج كمية لحجز",
  quantity_asset_return: "إرجاع كمية من حجز",
  quantity_asset_damage: "تلف",
  quantity_asset_loss: "فقدان",
};

export function movementReference(input: { relatedType: string | null; relatedId: number | null; salesInvoiceId: number | null }) {
  const id = input.relatedId ?? null;
  if (input.salesInvoiceId) return { label: `فاتورة بيع #${input.salesInvoiceId}`, href: `/admin/invoice/${input.salesInvoiceId}` };
  switch (input.relatedType) {
    case "sales_invoice":
      return id ? { label: `فاتورة بيع #${id}`, href: `/admin/invoice/${id}` } : null;
    case "purchase_invoice":
      return id ? { label: `فاتورة شراء #${id}`, href: `/admin/purchases?invoice=${id}` } : null;
    case "order":
      return id ? { label: `طلب متجر #${id}`, href: "/admin/orders" } : null;
    case "warehouse_transfer":
      return id ? { label: `تحويل #${id}`, href: "/admin/warehouse-transfers" } : null;
    case "kosha_booking":
      return id ? { label: `حجز كوشة #${id}`, href: `/admin/bookings/kosha/${id}` } : null;
    case "service_order":
      return id ? { label: `حجز #${id}`, href: `/admin/bookings/service/${id}` } : null;
    case "rental_order":
      return id ? { label: `إيجار #${id}`, href: null } : null;
    case "graduation_order":
      return id ? { label: `طلب تخرج #${id}`, href: null } : null;
    case "product":
    case "asset":
      return null;
    default:
      return input.relatedType && id ? { label: `${input.relatedType} #${id}`, href: null } : null;
  }
}
