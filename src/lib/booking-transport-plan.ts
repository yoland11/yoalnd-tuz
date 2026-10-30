/** Operational extension of the ORIGINAL booking transportation charge.
 * Pure validation/projection only: never writes a booking, reservation or payment. */
import { resourceOccupancyTimestamps } from "./booking-resource-conflicts";

export type TransportFeeMode = "per_trip" | "overall";
export type TransportReference = { source: "kosha" | "service"; id: number };
export type TransportOccupancy = { start: string; end: string };
export type TransportTrip = {
  id: string;
  sequence: number;
  transportType: string | null;
  origin: string | null;
  destination: string | null;
  transportDate: string | null;
  departureTime: string | null;
  expectedArrivalTime: string | null;
  vehicleId: number | null;
  driverId: number | null;
  driverPhone: string | null;
  assignedWork: string | null;
  notes: string | null;
  customerCharge: number | null;
  resourceOccupancy: TransportOccupancy | null;
};
export type TransportPlan = {
  version: 1;
  revision: number;
  feeMode: TransportFeeMode;
  /** Snapshot validated against the original fee on read, not another ledger. */
  overallCharge: number | null;
  trips: TransportTrip[];
};
export type TransportPlanView = TransportPlan & { legacy: boolean };
export class TransportPlanError extends Error {
  constructor(message: string, public status = 422) { super(message); this.name = "TransportPlanError"; }
}
const fail = (message: string): never => { throw new TransportPlanError(message); };
const record = (value: unknown): Record<string, unknown> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return fail("بيانات خطة النقل غير صالحة؛ راجع السجل الأصلي");
  return value as Record<string, unknown>;
};
const integer = (value: unknown, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return fail("رقم أو كمية في خطة النقل غير صالحة");
  return value;
};
function amount(value: unknown,limit=1_000_000_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > limit || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) return fail("أجرة النقل غير صالحة؛ استخدم مبلغاً موجباً بدقة منزلتين كحد أقصى");
  return Math.round(value * 100) / 100;
}
const text = (value: unknown, max: number): string | null => {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > max) return fail("نص تفاصيل النقل غير صالح أو يتجاوز الحد المسموح");
  return value.trim() || null;
};
const optionalId = (value: unknown) => value == null ? null : integer(value, 1, Number.MAX_SAFE_INTEGER);
function date(value: unknown): string | null {
  const result = text(value, 10);
  if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result)) return fail("تاريخ رحلة النقل غير صالح");
  return result;
}
function time(value: unknown): string | null {
  const result = text(value, 5);
  if (result && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) return fail("وقت رحلة النقل غير صالح");
  return result;
}
function occupancy(value: unknown): TransportOccupancy | null {
  if (value == null) return null;
  const source = record(value);
  const start = text(source.start, 35), end = text(source.end, 35);
  if (!start || !end || !resourceOccupancyTimestamps({ start, end })) return fail("حدد بداية ونهاية صحيحتين لفترة انشغال رحلة النقل");
  return { start, end };
}
function trip(value: unknown): TransportTrip {
  const source = record(value);
  const id = text(source.id, 80);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return fail("هوية رحلة النقل غير صالحة");
  const driverPhone=text(source.driverPhone,30);
  if(driverPhone&&!/^[+\d\u0660-\u0669\u06f0-\u06f9\s()-]{5,30}$/.test(driverPhone))return fail("رقم هاتف السائق غير صالح");
  return {
    id, sequence: integer(source.sequence, 1, 999999),
    transportType: text(source.transportType, 120), origin: text(source.origin, 500), destination: text(source.destination, 500),
    transportDate: date(source.transportDate), departureTime: time(source.departureTime), expectedArrivalTime: time(source.expectedArrivalTime),
    vehicleId: optionalId(source.vehicleId), driverId: optionalId(source.driverId),driverPhone, assignedWork: text(source.assignedWork, 500), notes: text(source.notes, 2000),
    customerCharge: source.customerCharge == null ? null : amount(source.customerCharge), resourceOccupancy: occupancy(source.resourceOccupancy),
  };
}
export function transportPlanFee(plan: TransportPlan): number {
  if (plan.feeMode === "overall") return plan.trips.length ? amount(plan.overallCharge,(plan as Partial<TransportPlanView>).legacy?999_999_999_999.99:1_000_000_000) : 0;
  const cents = plan.trips.reduce((sum, item) => sum + Math.round(amount(item.customerCharge) * 100), 0);
  return amount(cents / 100);
}
export function validateTransportPlan(input: unknown): TransportPlan {
  const source = record(input);
  if (source.version !== 1 || !["per_trip", "overall"].includes(String(source.feeMode))) return fail("إصدار خطة النقل أو طريقة احتساب الأجرة غير مدعوم");
  if (!Array.isArray(source.trips) || source.trips.length > 50) return fail("قائمة رحلات النقل غير صالحة؛ الحد الأقصى 50 رحلة");
  const trips = source.trips.map(trip);
  if (new Set(trips.map(t => t.id)).size !== trips.length || new Set(trips.map(t => t.sequence)).size !== trips.length) return fail("هوية رحلة النقل أو رقمها مكرر");
  const feeMode = source.feeMode as TransportFeeMode;
  const overallCharge = source.overallCharge == null ? null : amount(source.overallCharge);
  if (feeMode === "overall" && trips.some(t => t.customerCharge != null)) return fail("الأجرة الكلية لا تُكرر كأجرة لكل رحلة؛ أكد تغيير طريقة الأجرة");
  if (feeMode === "per_trip" && overallCharge != null) return fail("اختر أجرة مستقلة لكل رحلة أو أجرة كلية دون الجمع بينهما");
  const result: TransportPlan = { version: 1, revision: integer(source.revision, 0, Number.MAX_SAFE_INTEGER), feeMode, overallCharge, trips };
  transportPlanFee(result);
  return result;
}
export function transportTripReference(bookingNumber: string, sequence: number): string {
  integer(sequence, 1, 999999);
  if (typeof bookingNumber !== "string" || !bookingNumber.trim() || bookingNumber.length > 200) return fail("رقم الحجز غير متاح لإصدار وصل النقل");
  return `${bookingNumber.trim()}-T${String(sequence).padStart(2, "0")}`;
}
export function readTransportPlan(input: TransportReference & { bookingNumber: string; legacy: unknown; storedPlan: unknown }): TransportPlanView {
  if (!["kosha", "service"].includes(input.source)) return fail("مصدر الحجز غير صحيح");
  integer(input.id, 1, Number.MAX_SAFE_INTEGER);
  const legacy = input.legacy == null ? null : record(input.legacy);
  if (legacy?.mode != null && !["ajn", "customer"].includes(String(legacy.mode))) return fail("نوع النقل المحفوظ غير صالح");
  const hasTransport = legacy?.mode === "ajn";
  // Numeric database amounts may arrive as strings; never turn an invalid value into zero.
  const legacyFee = hasTransport ? amount(typeof legacy.fee === "string" && legacy.fee.trim() ? Number(legacy.fee) : legacy.fee,input.source==="kosha"?999_999_999_999.99:1_000_000_000) : 0;
  if (input.storedPlan != null) {
    const plan = validateTransportPlan(input.storedPlan);
    if (plan.trips.length && !hasTransport || Math.abs(transportPlanFee(plan) - legacyFee) > 0.005) throw new TransportPlanError("خطة النقل لا تطابق أجرة النقل الأصلية؛ حدّث السجل وراجع الأجرة قبل الطباعة", 409);
    return { ...plan, legacy: false };
  }
  const trips = hasTransport ? [trip({ id: "legacy-1", sequence: 1, vehicleId: legacy.vehicleId ?? null, driverId: legacy.driverId ?? null, notes: legacy.note ?? null })] : [];
  return { version: 1, revision: 0, feeMode: "overall", overallCharge: legacyFee, trips, legacy: true };
}

export type TransportResourceUse = Pick<TransportTrip, "id" | "vehicleId" | "driverId"> & { interval: TransportOccupancy };
/** The entire booking period still protects against OTHER bookings. Explicit
 * trip periods only allow documented sequential reuse inside this booking. */
export function transportResourceUses(plan: TransportPlan, bookingOccupancy: TransportOccupancy | null): TransportResourceUse[] {
  const booked = resourceOccupancyTimestamps(bookingOccupancy);
  if (!plan.trips.some(t => t.vehicleId || t.driverId)) return [];
  if (!booked || !bookingOccupancy) return fail("سجّل تاريخ الحجز أو راجع فترة تشغيل الموارد قبل إسناد النقل");
  const uses = plan.trips.map(t => {
    const interval = t.resourceOccupancy ?? bookingOccupancy;
    const span = resourceOccupancyTimestamps(interval);
    if (!span || span[0] < booked[0] || span[1] > booked[1]) return fail("فترة انشغال رحلة النقل يجب أن تكون ضمن فترة الحجز، بما فيها التحميل والإرجاع");
    return { id: t.id, vehicleId: t.vehicleId, driverId: t.driverId, interval };
  });
  for (let i = 0; i < uses.length; i++) for (let j = i + 1; j < uses.length; j++) {
    const a = uses[i], b = uses[j];
    if (!(a.vehicleId && a.vehicleId === b.vehicleId || a.driverId && a.driverId === b.driverId)) continue;
    const left = resourceOccupancyTimestamps(a.interval)!, right = resourceOccupancyTimestamps(b.interval)!;
    if (left[0] < right[1] && right[0] < left[1]) return fail("تداخل في فترة انشغال السائق أو المركبة بين رحلتين؛ حدّد فترات غير متداخلة تشمل الإرجاع أو اختر مورداً آخر");
  }
  return uses;
}

/** Pure decision used ONLY under the original source row lock. This never posts
 * money; the existing route applies its one aggregate delta and reconciliation. */
export function prepareTransportPlanSave(current: TransportPlanView, submitted: unknown, expectedRevision: unknown, canEditFinancials: boolean): { plan: TransportPlan; fee: number; duplicate: boolean } {
  const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER);
  const proposed = validateTransportPlan(submitted);
  if (proposed.revision !== expected) throw new TransportPlanError("تغيّر إصدار خطة النقل؛ حدّث الصفحة قبل الحفظ", 409);
  if (!proposed.trips.length || proposed.trips.some(t => !t.vehicleId)) return fail("اختر مركبة لكل رحلة نقل قبل تأكيد الخطة");
  for (const previous of current.trips) {
    const next = proposed.trips.find(t => t.id === previous.id);
    if (!next) throw new TransportPlanError("لا يمكن حذف سجل رحلة محفوظ؛ استخدم إجراءات الإلغاء الأصلية عند توفرها", 409);
    if (next.sequence !== previous.sequence) throw new TransportPlanError("لا يمكن تغيير رقم رحلة محفوظ في سجل النقل", 409);
  }
  const maxSequence = Math.max(0, ...current.trips.map(t => t.sequence));
  if (proposed.trips.some(t => !current.trips.some(old => old.id === t.id) && t.sequence <= maxSequence)) return fail("رقم الرحلة الجديدة يجب أن يكون بعد أرقام السجل المحفوظ");
  const content = (plan: TransportPlan) => JSON.stringify({ feeMode: plan.feeMode, overallCharge: plan.overallCharge, trips: [...plan.trips].sort((a,b) => a.sequence-b.sequence) });
  const same = content(current) === content(proposed);
  if (current.revision !== expected) {
    if (!current.legacy && same && current.revision === expected + 1) return { plan: validateTransportPlan(current), fee: transportPlanFee(current), duplicate: true };
    throw new TransportPlanError("تغيّرت خطة النقل بواسطة مستخدم آخر؛ حدّث الصفحة قبل الحفظ", 409);
  }
  if (!current.legacy && same) return { plan: validateTransportPlan(current), fee: transportPlanFee(current), duplicate: true };
  const finances = (plan: TransportPlan) => JSON.stringify({ feeMode: plan.feeMode, overallCharge: plan.overallCharge, charges: [...plan.trips].sort((a,b) => a.sequence-b.sequence).map(t => ({ id: t.id, charge: t.customerCharge })) });
  if (!canEditFinancials && finances(current) !== finances(proposed)) throw new TransportPlanError("لا تملك صلاحية تعديل أجور النقل؛ اطلب من الإدارة مراجعة المبالغ", 403);
  if (expected === Number.MAX_SAFE_INTEGER) return fail("وصل إصدار خطة النقل إلى الحد المسموح");
  return { plan: { ...proposed, revision: expected + 1, trips: [...proposed.trips].sort((a,b) => a.sequence-b.sequence) }, fee: transportPlanFee(proposed), duplicate: false };
}
