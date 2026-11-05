import type { BookingResourceWindow } from "./booking-resource-window";
import type { QuantityLine } from "./quantity-assets";

export const EQUIPMENT_RENTAL_STATUSES = ["draft", "pending_approval", "confirmed", "partially_dispatched", "dispatched", "partially_returned", "inspection", "returned", "completed", "cancelled"] as const;
export type EquipmentRentalStatus = (typeof EQUIPMENT_RENTAL_STATUSES)[number];
export const EQUIPMENT_RENTAL_STATUS_LABELS: Record<string, string> = { draft: "مسودة", pending_approval: "بانتظار الاعتماد", confirmed: "بانتظار التسليم", partially_dispatched: "تسليم جزئي", dispatched: "تم التسليم", partially_returned: "إرجاع جزئي", inspection: "بانتظار الفحص", returned: "تم الإرجاع", completed: "مكتمل", cancelled: "ملغي", active: "نشط" };
export const EQUIPMENT_RENTAL_PRICING_TYPES = ["fixed", "daily", "hourly", "custom"] as const;
export type EquipmentRentalPricingType = (typeof EQUIPMENT_RENTAL_PRICING_TYPES)[number];
export type EquipmentRentalActor = { id: number; name: string; permissions: string[]; role: string };
export type EquipmentRentalCapabilities = { view: boolean; create: boolean; edit: boolean; confirm: boolean; dispatch: boolean; return: boolean; cancel: boolean; inspect: boolean; finance: boolean; reports: boolean; settings: boolean; costs?: boolean; resolveLoss?: boolean };
export const canApproveEquipmentRentalLoss = (actor: { role?: string; permissions?: string[] }) =>
  ["admin", "manager", "main_admin", "super_admin", "main_manager"].includes(actor.role ?? "") || actor.permissions?.includes("asset_damage_approve") === true;
export function equipmentRentalCapabilities(actor: { role?: string; permissions?: string[] }): EquipmentRentalCapabilities {
  const all = actor.role === "admin";
  const p = new Set(actor.permissions ?? []);
  const has = (...keys: string[]) => all || keys.some(key => p.has(key));
  const canReturn = has("rental_return", "booking_return_confirm", "booking_assets_manage", "warehouse_return", "asset_custody_return", "assets_manage");
  return {
    costs: has("expenses"),
    view: has("rental_payment", "rental_return", "rental_dispatch", "rental_create", "rental_edit", "rental_approve", "rental_inspect", "rental_reports", "rental_view", "bookings", "orders", "booking_view", "booking_create", "booking_edit", "booking_status_change", "booking_operations_view", "assets_view"),
    create: has("rental_create", "booking_create", "bookings", "booking_edit"), edit: has("rental_edit", "booking_edit"),
    confirm: has("rental_approve", "rental_confirm", "booking_status_change"), cancel: has("rental_cancel", "booking_status_change", "booking_edit"),
    dispatch: has("rental_dispatch", "booking_assets_manage", "warehouse_issue", "asset_custody_issue", "assets_manage"),
    return: canReturn, resolveLoss: canReturn && canApproveEquipmentRentalLoss(actor),
    inspect: has("rental_inspect", "booking_assets_manage", "asset_damage_record", "assets_manage"),
    finance: has("rental_payment", "rental_finance", "accounting", "booking_payment_receive", "booking_payments", "cashbox"),
    reports: has("rental_reports", "accounting", "booking_finance_view"),
    settings: has("rental_settings", "assets_manage", "products"),
  };
}
export type EquipmentRentalSettings = { enabled: boolean; pricingType: EquipmentRentalPricingType; fixedPrice: number; dailyPrice: number; hourlyPrice: number; deposit: number; minimumDuration: number; allowCustomPrice: boolean; terms: string };
export type EquipmentRentalAssetLine = Partial<QuantityLine> & {
  productId: number; name: string; image: string | null; code: string; warehouseId: number | null; quantity: number;
  pricingType: EquipmentRentalPricingType; unitPrice: number; duration: number; discount: number; lineTotal: number;
  trackingMode?: "quantity" | "individual"; staffId?: number | null; pendingInspectionQty?: number;
  allocations?: Array<Record<string, unknown>>; [key: string]: unknown;
};
export type EquipmentRentalHistory = { requestId: string; action: string; at: string; actorId: number | null; actorName: string; fingerprint?: string; note?: string };
export type EquipmentRentalReturn = {
  requestId: string; returnedAt: string; recordedAt: string; actorId: number; actorName: string; note: string;
  lines: Array<{
    productId: number; name: string; code: string; warehouseId: number | null; warehouseName: string;
    receivingEmployeeId: number; receivingEmployeeName: string;
    dispatched: number; previouslyReturned: number; previouslyMissing: number; outstandingBefore: number; outstandingAfter: number;
    good: number; damaged: number; missing: number; pending: number; lossApproved: boolean; note?: string;
  }>;
};
export type EquipmentRentalAttachment = { id: string; name: string; url: string; type?: string; createdAt: string };
export type EquipmentRentalDetails = {
  version: 1; address: string; startTime: string; endTime: string; linkedBooking: { source: "service" | "kosha"; id: number } | null;
  deliveryCharge: number; installationCharge: number; discount: number; depositRequired: number; terms: string;
  assets: EquipmentRentalAssetLine[]; resourceWindow: BookingResourceWindow; history: EquipmentRentalHistory[];
  attachments: EquipmentRentalAttachment[]; returns?: EquipmentRentalReturn[]; createRequestId: string; [key: string]: unknown;
};
export type EquipmentRentalFinancialSummary = { rentPaid?: number; rentRefunded?: number; paid?: number; remaining?: number; depositHeld?: number; depositCollected?: number; depositRefunded?: number; depositApplied?: number; pending?: unknown[]; [key: string]: unknown };
export type EquipmentRentalDetail = {
  id: number; orderNo: string; rentalKind: "equipment" | "product"; customerId: number | null; customerName: string; phone: string;
  startDate: string; endDate: string; status: string; total: number; paid: number; remaining: number; overdue: boolean;
  details: EquipmentRentalDetails; capabilities: EquipmentRentalCapabilities; finance: EquipmentRentalFinancialSummary;
  history: EquipmentRentalHistory[]; createdAt?: string; updatedAt?: string;
};
export type EquipmentRentalSummary = { active: number; awaitingDispatch: number; dueToday: number; overdue: number; outstanding: number; depositHeld: number };
export type EquipmentRentalList = { data: EquipmentRentalDetail[]; total: number; summary: EquipmentRentalSummary; page: number; pageSize: number };
export type EquipmentRentalAssetOption = { id: number; name: string; code: string; image: string | null; stock: number; trackingMode: "quantity" | "individual"; settings: EquipmentRentalSettings; category?: string; [key: string]: unknown };
export type EquipmentRentalOptions = { assets: EquipmentRentalAssetOption[]; warehouses: Array<{ id: number; name: string }>; employees: Array<{ id: number; name: string }>; customers?: Array<{ id: number; name: string; phone: string }> };

export class EquipmentRentalValidationError extends Error { status = 422; constructor(message: string) { super(message); this.name = "EquipmentRentalValidationError"; } }
const fail = (message: string): never => { throw new EquipmentRentalValidationError(message); };
const money = (value: unknown, label: string, fallback = 0) => { const n = Number(value ?? fallback); return Number.isFinite(n) && n >= 0 && n <= 9999999999 ? Math.round(n * 100) / 100 : fail(`${label} غير صحيح`); };
export function normalizeEquipmentRentalSettings(value: unknown, defaults: { pricePerDay?: unknown; isRental?: unknown } = {}): EquipmentRentalSettings {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { enabled: v.enabled === true || (v.enabled == null && defaults.isRental === true), pricingType: EQUIPMENT_RENTAL_PRICING_TYPES.includes(v.pricingType as EquipmentRentalPricingType) ? v.pricingType as EquipmentRentalPricingType : "daily", fixedPrice: money(v.fixedPrice, "السعر الثابت"), dailyPrice: money(v.dailyPrice ?? defaults.pricePerDay, "السعر اليومي"), hourlyPrice: money(v.hourlyPrice, "سعر الساعة"), deposit: money(v.deposit, "التأمين"), minimumDuration: Math.max(1, money(v.minimumDuration, "أقل مدة", 1)), allowCustomPrice: v.allowCustomPrice === true, terms: String(v.terms ?? "").slice(0, 6000) };
}
export function rentalDateTime(date: unknown, time: unknown): number {
  const day = String(date ?? ""); const clock = String(time ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return fail("تاريخ ووقت الإيجار مطلوبان");
  const result = Date.parse(`${day}T${clock}:00+03:00`);
  if (!Number.isFinite(result) || new Date(result + 3 * 3600000).toISOString().slice(0, 10) !== day) return fail("تاريخ الإيجار غير صحيح");
  return result;
}
export function calculateEquipmentRental(input: any): { assets: EquipmentRentalAssetLine[]; total: number; deliveryCharge: number; installationCharge: number; discount: number; depositRequired: number; days: number } {
  const start = rentalDateTime(input.startDate, input.startTime ?? "00:00");
  const end = rentalDateTime(input.endDate, input.endTime ?? "23:59");
  if (end <= start) return fail("موعد الإرجاع يجب أن يكون بعد موعد التسليم");
  if (!Array.isArray(input.assets) || input.assets.length === 0 || input.assets.length > 100) return fail("أضف أصلاً واحداً على الأقل وبحد أقصى 100 أصل");
  const days = Math.round((Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`)) / 86400000) + 1;
  const ids = new Set<number>();
  const assets: EquipmentRentalAssetLine[] = input.assets.map((line: any) => {
    const productId = Number(line.productId); const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0 || ids.has(productId)) return fail("الأصل غير صحيح أو مكرر؛ استخدم تخصيص المخازن للأصل نفسه");
    ids.add(productId);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) return fail("كمية الأصل يجب أن تكون عدداً صحيحاً موجباً");
    const pricingType = line.pricingType ?? "fixed";
    if (!EQUIPMENT_RENTAL_PRICING_TYPES.includes(pricingType)) return fail("نوع التسعير غير صحيح");
    const duration = pricingType === "daily" ? days : pricingType === "hourly" ? Math.ceil((end - start) / 3600000) : pricingType === "custom" ? Number(line.duration ?? 1) : 1;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 100000) return fail("مدة التسعير غير صحيحة");
    const unitPrice = money(line.unitPrice, "سعر الوحدة"); const discount = money(line.discount, "خصم السطر");
    const gross = Math.round(unitPrice * quantity * duration * 100) / 100;
    if (discount > gross) return fail("خصم السطر يتجاوز قيمته");
    return { ...line, productId, quantity, pricingType, unitPrice, discount, duration, lineTotal: Math.round((gross - discount) * 100) / 100, name: String(line.name ?? ""), image: line.image ?? null, code: String(line.code ?? ""), warehouseId: line.warehouseId == null ? null : Number(line.warehouseId) };
  });
  const deliveryCharge = money(input.deliveryCharge, "أجور التوصيل"); const installationCharge = money(input.installationCharge, "أجور التركيب"); const discount = money(input.discount, "الخصم"); const depositRequired = money(input.depositRequired, "التأمين");
  const gross = assets.reduce((sum, line) => sum + line.lineTotal, 0) + deliveryCharge + installationCharge;
  if (discount > gross) return fail("الخصم يتجاوز إجمالي العقد");
  return { assets, total: money(gross - discount, "إجمالي العقد"), deliveryCharge, installationCharge, discount, depositRequired, days };
}
