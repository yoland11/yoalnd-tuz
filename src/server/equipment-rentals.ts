import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { parseBookingResourceWindow } from "@/lib/booking-resource-window";
import { iraqiPhoneVariants, normalizeIraqiPhone } from "@/lib/phone";
import { lineOutstanding, normalizeQuantityLine } from "@/lib/quantity-assets";
import {
  calculateEquipmentRental, equipmentRentalCapabilities, normalizeEquipmentRentalSettings,
  EquipmentRentalValidationError, rentalDateTime,
  type EquipmentRentalActor, type EquipmentRentalDetails, type EquipmentRentalDetail,
  type EquipmentRentalHistory, type EquipmentRentalCapabilities,
} from "@/lib/equipment-rentals";
import { createApiErrorPayload, makeRequestId, mapWriteError } from "./write-safety";
import { readRequestBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "./request-body";
import { executeEquipmentRentalInventory, equipmentRentalAvailability } from "./equipment-rental-inventory";
import { requestEquipmentRentalMoney, equipmentRentalFinancialSummary } from "./equipment-rental-finance";
import { reconcilePaymentState } from "./payment-state";
import { mainWarehouseId } from "./warehouses";
import { lineAllocations, consumeOutstanding } from "@/lib/warehouse-stock";

type Executor = Pick<typeof db, "execute">;
class RentalError extends Error { constructor(message: string, public status = 422) { super(message); this.name = "EquipmentRentalError"; } }
function rows(result: any): any[] {
  if (!Array.isArray(result?.rows)) throw new Error("Invalid equipment rental database response");
  return result.rows;
}
function requestFingerprint(value: unknown): string {
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter(key => key !== "requestId").sort().map(key => [key, stable(v[key])])) : v;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "private, no-store" } });
const idsSql = (ids: number[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);
const stringsSql = (values: string[]) => sql.join(values.map(value => sql`${value}`), sql`, `);
const dateText = (value: any) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
const isoText = (value: any) => value instanceof Date ? value.toISOString() : value == null ? undefined : String(value);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const text = (value: unknown, max: number) => { const v = String(value ?? "").trim(); if (v.length > max) throw new RentalError("أحد الحقول أطول من الحد المسموح"); return v; };
const positiveId = (value: unknown) => { const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw new RentalError("المعرف غير صحيح"); return id; };
const activeSql = sql`r.status not in ('draft','pending_approval','cancelled','canceled','completed','returned','closed')`;
const outstandingSql = sql`(coalesce(r.rental_kind,'product') <> 'equipment' or exists(select 1 from jsonb_array_elements(coalesce(r.equipment_details->'assets','[]'::jsonb)) a
  where coalesce((a->>'checkedOutQty')::numeric,0) > coalesce((a->>'returnedGoodQty')::numeric,0)+coalesce((a->>'returnedDamagedQty')::numeric,0)+coalesce((a->>'missingQty')::numeric,0)+coalesce((a->>'pendingInspectionQty')::numeric,0)))`;
const overdueSql = sql`(${activeSql} and ${outstandingSql} and ((r.end_date::text || 'T' || coalesce(nullif(r.equipment_details->>'endTime',''),'23:59') || ':00+03:00')::timestamptz < now()))`;


async function requireSchema(executor: Executor) {
  const row = rows(await executor.execute(sql`select exists(select 1 from information_schema.columns where table_schema=current_schema() and table_name='rental_orders' and column_name='equipment_details') and exists(select 1 from information_schema.columns where table_schema=current_schema() and table_name='products' and column_name='rental_settings') as ready`))[0];
  if (row?.ready !== true) throw new RentalError("يلزم تطبيق ترقية تأجير المعدات 0134 قبل استخدام هذه الشاشة", 503);
}

function requireCapability(capabilities: EquipmentRentalCapabilities, key: keyof EquipmentRentalCapabilities) {
  if (!capabilities[key]) throw new RentalError("ليس لديك صلاحية تنفيذ هذه العملية", 403);
}

function requestIdentity(req: NextRequest, input: any) {
  const value = String(input?.requestId ?? req.headers.get("idempotency-key") ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new RentalError("معرف طلب ثابت مطلوب لحماية العملية من التكرار");
  return value;
}

async function loadRental(executor: Executor, id: number, lock = false) {
  const row = rows(await executor.execute(sql`select r.* from rental_orders r where r.id=${id} ${lock ? sql`for update` : sql``}`))[0];
  if (!row) throw new RentalError("عقد الإيجار غير موجود", 404);
  return row;
}

function readDetails(row: any): EquipmentRentalDetails {
  if (row.rental_kind === "equipment") {
    const value = row.equipment_details;
    if (!value || value.version !== 1 || !Array.isArray(value.assets) || !Array.isArray(value.history)) throw new RentalError("بيانات تشغيل عقد الإيجار غير مكتملة؛ يلزم مراجعتها", 409);
    return value as EquipmentRentalDetails;
  }
  const startDate = dateText(row.start_date); const endDate = dateText(row.end_date);
  const start = `${startDate}T00:00:00+03:00`; const end = `${endDate}T23:59:00+03:00`;
  return { version: 1, address: "", startTime: "00:00", endTime: "23:59", linkedBooking: null, deliveryCharge: 0, installationCharge: 0, discount: 0, depositRequired: 0, terms: String(row.notes ?? ""), resourceWindow: { preparationStart: start, eventStart: start, eventEnd: end, returnEnd: end }, assets: [{ productId: Number(row.product_id), name: "إيجار سابق", image: null, code: "", quantity: 1, warehouseId: null, pricingType: "daily", unitPrice: Number(row.price_per_day), duration: Number(row.days), discount: 0, lineTotal: Number(row.total_amount), stage: row.status === "active" ? "out" : "returned" }], history: [], attachments: [], createRequestId: "" };
}

async function detail(executor: Executor, row: any, actor: EquipmentRentalActor): Promise<EquipmentRentalDetail> {
  const details = readDetails(row); const equipment = row.rental_kind === "equipment";
  const finance = equipment ? await equipmentRentalFinancialSummary(executor, Number(row.id)) : { total: Number(row.total_amount), paid: Number(row.paid_amount), remaining: Number(row.remaining_amount), depositHeld: 0 };
  const capabilities = equipmentRentalCapabilities(actor);
  const customerOutstanding = details.assets.some(line => lineOutstanding(normalizeQuantityLine(line)) > 0);
  if (equipment && capabilities.reports) {
    const cost = rows(await executor.execute(sql`select coalesce(sum(case when f.direction='expense' then f.amount::numeric else -f.amount::numeric end),0)::text as amount
      from expenses e join financial_transactions f on f.source_type='expense' and f.source_id=e.id::text and f.approval_status='executed'
      where e.rental_order_id=${Number(row.id)} and e.deleted_at is null`))[0];
    Object.assign(finance, { directCosts: Number(cost.amount), directContribution: Number(row.total_amount) - Number(cost.amount) });
  }
  const legacy = equipment ? {} : { readOnly: true, originalProductId: Number(row.product_id), mirroredOrderId: rows(await executor.execute(sql`select o.id from orders o where o.service_type='rental' and o.tracking_code=${row.order_no} order by o.id limit 1`))[0]?.id ?? null };
  return { ...legacy, id: Number(row.id), orderNo: row.order_no, rentalKind: equipment ? "equipment" : "product", customerId: row.customer_id == null ? null : Number(row.customer_id), customerName: String(row.customer_name), phone: String(row.phone), startDate: dateText(row.start_date), endDate: dateText(row.end_date), status: String(row.status), total: Number(row.total_amount), paid: Number(finance.paid ?? row.paid_amount), remaining: Number(finance.remaining ?? row.remaining_amount), overdue: !["draft", "pending_approval", "cancelled", "returned", "completed"].includes(row.status) && (!equipment || customerOutstanding) && rentalDateTime(dateText(row.end_date), details.endTime || "23:59") < Date.now(), details, capabilities: equipment ? capabilities : { ...capabilities, edit: false, confirm: false, cancel: false, dispatch: false, return: false, inspect: false, finance: false }, finance, history: details.history, createdAt: isoText(row.created_at), updatedAt: isoText(row.updated_at) };
}

function filterSql(params: URLSearchParams) {
  const filters: SQL[] = [sql`true`];
  const q = text(params.get("q") ?? params.get("search"), 150);
  if (q) filters.push(sql`(r.order_no ilike ${`%${q}%`} or r.customer_name ilike ${`%${q}%`} or r.phone ilike ${`%${q}%`} or exists(select 1 from jsonb_array_elements(coalesce(r.equipment_details->'assets','[]'::jsonb)) a where a->>'name' ilike ${`%${q}%`} or a->>'code' ilike ${`%${q}%`}))`);
  const status = params.get("status"); if (status && status !== "all") filters.push(sql`r.status=${status}`);
  const customerId = params.get("customerId"); if (customerId) filters.push(sql`r.customer_id=${positiveId(customerId)}`);
  const productId = params.get("productId"); if (productId) { const id = positiveId(productId); filters.push(sql`(r.product_id=${id} or exists(select 1 from jsonb_array_elements(coalesce(r.equipment_details->'assets','[]'::jsonb)) a where a->>'productId'=${String(id)}))`); }
  if (params.get("rentalKind") === "equipment") filters.push(sql`r.rental_kind='equipment'`);
  const source = params.get("bookingSource"); const bookingId = params.get("bookingId");
  if (source || bookingId) { if (!["service", "kosha"].includes(source ?? "") || !bookingId) throw new RentalError("مرجع الحجز المرتبط غير صحيح"); filters.push(sql`r.equipment_details->'linkedBooking'->>'source'=${source} and r.equipment_details->'linkedBooking'->>'id'=${String(positiveId(bookingId))}`); }
  const from = params.get("from"); const to = params.get("to");
  if (from) { rentalDateTime(from, "00:00"); filters.push(sql`r.end_date>=${from}::date`); }
  if (to) { rentalDateTime(to, "00:00"); filters.push(sql`r.start_date<=${to}::date`); }
  const mode = params.get("mode");
  if (mode === "due" || mode === "dueToday") filters.push(sql`${activeSql} and r.end_date=${today()}::date`);
  if (mode === "overdue") filters.push(sql`${overdueSql}`);
  if (mode === "returns") filters.push(sql`r.status in ('active','partially_dispatched','dispatched','partially_returned','inspection')`);
  return sql.join(filters.map(f => sql`(${f})`), sql` and `);
}

async function list(req: NextRequest, actor: EquipmentRentalActor) {
  const params = req.nextUrl.searchParams; const where = filterSql(params);
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get("page") ?? "1") || 1));
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(params.get("pageSize") ?? params.get("limit") ?? "30") || 30));
  const totals = rows(await db.execute(sql`select count(*)::int as total,
    count(*) filter(where ${activeSql})::int as active,
    count(*) filter(where r.status in ('confirmed','partially_dispatched'))::int as awaiting_dispatch,
    count(*) filter(where ${activeSql} and r.end_date=${today()}::date)::int as due_today,
    count(*) filter(where ${overdueSql})::int as overdue,
    coalesce(sum(r.remaining_amount::numeric) filter(where r.status not in ('draft','pending_approval','cancelled','canceled')),0) as outstanding,
    coalesce(sum((select coalesce(sum(case when f.direction='revenue' then f.amount::numeric else -f.amount::numeric end),0) from financial_transactions f where f.source_type='equipment_rental_deposit' and f.source_id=r.id::text and f.approval_status='executed')),0) as deposit_held
    from rental_orders r where ${where}`))[0];
  const data = rows(await db.execute(sql`select r.* from rental_orders r where ${where} order by r.created_at desc,r.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`));
  return json({ data: await Promise.all(data.map(row => detail(db, row, actor))), total: Number(totals.total), summary: { active: Number(totals.active), awaitingDispatch: Number(totals.awaiting_dispatch), dueToday: Number(totals.due_today), overdue: Number(totals.overdue), outstanding: Number(totals.outstanding), depositHeld: Number(totals.deposit_held) }, page, pageSize });
}

async function options(req: NextRequest, actor: EquipmentRentalActor) {
  const q = text(req.nextUrl.searchParams.get("q"), 150); const pattern = `%${q}%`;
  const result = rows(await db.execute(sql`select p.id,coalesce(nullif(p.name_ar,''),p.name) as name,p.barcode,p.images,p.stock,p.price_per_day,p.is_rental,p.rental_settings,p.category,coalesce(a.tracking_mode,'individual') as tracking_mode from products p left join asset_quantity_profiles a on a.product_id=p.id where p.is_asset=true and p.is_active=true and p.archived_at is null and (${q === ""} or p.name ilike ${pattern} or p.name_ar ilike ${pattern} or p.barcode ilike ${pattern}) order by p.name_ar,p.id limit 200`));
  const warehouses = rows(await db.execute(sql`select id,name from warehouses where is_active=1 order by id`));
  const employees = rows(await db.execute(sql`select id,coalesce(nullif(full_name,''),username) as name from staff where is_active=true order by full_name,id limit 500`));
  const customers = q ? rows(await db.execute(sql`select id,coalesce(nullif(full_name,''),name) as name,phone from customers where name ilike ${pattern} or full_name ilike ${pattern} or phone ilike ${pattern} order by id desc limit 20`)) : [];
  return json({ assets: result.map(p => ({ id: Number(p.id), name: p.name, code: p.barcode ?? "", image: Array.isArray(p.images) ? p.images[0] ?? null : null, stock: Number(p.stock), trackingMode: p.tracking_mode, settings: { ...normalizeEquipmentRentalSettings(p.rental_settings, { pricePerDay: p.price_per_day, isRental: p.is_rental }), allowCustomPrice: normalizeEquipmentRentalSettings(p.rental_settings).allowCustomPrice && (equipmentRentalCapabilities(actor).edit || equipmentRentalCapabilities(actor).settings) }, category: p.category ?? "" })), warehouses, employees, customers });
}

async function lockProducts(executor: Executor, ids: number[]) {
  const sorted = [...new Set(ids)].sort((a,b) => a-b);
  if (!sorted.length) throw new RentalError("أضف أصلاً واحداً على الأقل");
  const products = rows(await executor.execute(sql`select p.*,coalesce(a.tracking_mode,'individual') as tracking_mode from products p left join asset_quantity_profiles a on a.product_id=p.id where p.id in (${idsSql(sorted)}) order by p.id for update of p`));
  if (products.length !== sorted.length) throw new RentalError("أحد الأصول غير موجود", 404);
  return products;
}

async function customerFor(executor: Executor, input: any) {
  const phone = normalizeIraqiPhone(input.phone); if (!phone) throw new RentalError("رقم الهاتف العراقي غير صحيح");
  const name = text(input.customerName, 250); if (!name) throw new RentalError("اسم الزبون مطلوب");
  // Phone aliases share the same transaction lock. Historical customer IDs and
  // existing phone spellings remain intact; no duplicate directory is created.
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`equipment-rental-customer:${phone}`},0))`);
  const aliases = iraqiPhoneVariants(phone);
  let customer = rows(await executor.execute(sql`select id,name,phone from customers where phone in (${stringsSql(aliases)}) order by case when phone=${phone} then 0 else 1 end,id limit 1 for update`))[0];
  if (!customer) {
    customer = rows(await executor.execute(sql`insert into customers(phone,name,full_name) values(${phone},${name},${name}) on conflict(phone) do nothing returning id,name,phone`))[0];
    if (!customer) customer = rows(await executor.execute(sql`select id,name,phone from customers where phone=${phone} for update`))[0];
  }
  if (!customer) throw new RentalError("تعذر تثبيت هوية الزبون", 409);
  if (input.customerId != null && Number(input.customerId) !== Number(customer.id)) throw new RentalError("رقم الهاتف يعود إلى زبون آخر؛ اختر السجل الصحيح", 409);
  return { id: Number(customer.id), name, phone };
}

async function validateDetails(executor: Executor, input: any, products: any[], requestId: string, actor: EquipmentRentalActor, previous?: EquipmentRentalDetails) {
  const productMap = new Map(products.map(p => [Number(p.id), p]));
  const assets = input.assets.map((line: any) => {
    const p = productMap.get(Number(line.productId));
    if (!p || p.is_asset !== true || p.is_active !== true || p.archived_at) throw new RentalError("الأصل غير متاح للتأجير", 409);
    const settings = normalizeEquipmentRentalSettings(p.rental_settings, { pricePerDay: p.price_per_day, isRental: p.is_rental });
    if (!settings.enabled) throw new RentalError(`التأجير غير مفعل للأصل ${p.name_ar || p.name}`, 409);
    const pricingType = line.pricingType ?? settings.pricingType;
    if (pricingType === "custom" && (!settings.allowCustomPrice || !(equipmentRentalCapabilities(actor).edit || equipmentRentalCapabilities(actor).settings))) throw new RentalError("التسعير الخاص غير مسموح لهذا الأصل", 403);
    const unitPrice = pricingType === "daily" ? settings.dailyPrice : pricingType === "hourly" ? settings.hourlyPrice : pricingType === "fixed" ? settings.fixedPrice : Number(line.unitPrice);
    if (p.tracking_mode !== "quantity" && Number(line.quantity) !== 1) throw new RentalError("الأصل الفردي يقبل قطعة واحدة فقط");
    return { productId: Number(p.id), name: p.name_ar || p.name, image: p.images?.[0] ?? null, code: p.barcode ?? "", warehouseId: line.warehouseId == null || line.warehouseId === "" ? null : positiveId(line.warehouseId), quantity: Number(line.quantity), pricingType, unitPrice, duration: line.duration, discount: line.discount, trackingMode: p.tracking_mode, staffId: line.staffId == null ? null : positiveId(line.staffId), allocations: Array.isArray(line.allocations) ? line.allocations : undefined, stage: "linked", reservedQty: 0, preparedQty: 0, checkedOutQty: 0, returnedGoodQty: 0, returnedDamagedQty: 0, missingQty: 0, pendingInspectionQty: 0 };
  });
  const priced = calculateEquipmentRental({ ...input, assets });
  for (const asset of priced.assets) {
    const p = productMap.get(asset.productId)!; const settings = normalizeEquipmentRentalSettings(p.rental_settings);
    if (asset.duration < settings.minimumDuration) throw new RentalError(`مدة إيجار ${asset.name} أقل من الحد الأدنى`);
  }
  let linkedBooking: EquipmentRentalDetails["linkedBooking"] = null;
  if (input.linkedBooking) {
    const source = input.linkedBooking.source; const id = positiveId(input.linkedBooking.id);
    if (source !== "service" && source !== "kosha") throw new RentalError("نوع الحجز المرتبط غير صحيح");
    const exists = rows(await executor.execute(source === "service" ? sql`select id from service_orders where id=${id}` : sql`select id from kosha_bookings where id=${id}`))[0];
    if (!exists) throw new RentalError("الحجز المرتبط غير موجود", 404);
    linkedBooking = { source, id };
  }
  const start = `${input.startDate}T${input.startTime}:00+03:00`; const end = `${input.endDate}T${input.endTime}:00+03:00`;
  const resourceWindow = parseBookingResourceWindow(input.resourceWindow ?? { preparationStart: start, eventStart: start, eventEnd: end, returnEnd: end }, input.startDate);
  if (Date.parse(resourceWindow.eventStart) !== Date.parse(start) || Date.parse(resourceWindow.eventEnd) !== Date.parse(end)) throw new RentalError("فترة تشغيل الموارد لا تطابق تسليم وإرجاع العقد");
  const attachments = input.attachments ?? previous?.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > 50) throw new RentalError("مرفقات العقد غير صحيحة");
  const safeAttachments = attachments.map((item: any) => {
    const url = text(item.url, 2000); if (!/^(https:\/\/|\/(?!\/))/.test(url)) throw new RentalError("رابط المرفق غير صالح");
    return { id: text(item.id, 100) || makeRequestId(), name: text(item.name, 250), url, type: text(item.type, 120), createdAt: text(item.createdAt, 50) || new Date().toISOString() };
  });
  const details: EquipmentRentalDetails = { ...previous, version: 1, notes: text(input.notes, 3000), address: text(input.address, 2000), startTime: input.startTime, endTime: input.endTime, linkedBooking, deliveryCharge: priced.deliveryCharge, installationCharge: priced.installationCharge, discount: priced.discount, depositRequired: priced.depositRequired, terms: text(input.terms, 10000), assets: priced.assets, resourceWindow, history: previous?.history ?? [], attachments: safeAttachments, createRequestId: previous?.createRequestId ?? requestId };
  return { details, total: priced.total, days: priced.days };
}

async function saveDetails(executor: Executor, rentalId: number, details: EquipmentRentalDetails) {
  await executor.execute(sql`update rental_orders set equipment_details=${JSON.stringify(details)}::jsonb,updated_at=now() where id=${rentalId}`);
}
async function audit(executor: Executor, rentalId: number, details: EquipmentRentalDetails, action: string, requestId: string, actor: EquipmentRentalActor, note = "", fingerprint?: string) {
  const entry: EquipmentRentalHistory = { action, requestId, at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, note: text(note, 3000), fingerprint };
  details.history = [...details.history, entry];
  await saveDetails(executor, rentalId, details);
  await executor.execute(sql`insert into entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata) values('rental_order',${rentalId},${`equipment_rental_${action}`},${`تأجير المعدات · ${action}`},${entry.note ?? ""},${actor.id},${actor.name},${JSON.stringify({ requestId, action })}::jsonb)`);
}

async function inventory(executor: Executor, row: any, details: EquipmentRentalDetails, actor: EquipmentRentalActor, requestId: string, action: "confirm" | "cancel" | "dispatch" | "return" | "inspection", input: any) {
  const manager = ["admin", "manager", "main_admin", "super_admin", "main_manager"].includes(actor.role);
  const lines = Array.isArray(input.lines) ? input.lines.map((line: any) => ({ ...line, canRecordDamage: manager || actor.permissions.includes("asset_damage_record"), canApproveLoss: manager || actor.permissions.includes("asset_damage_approve") })) : undefined;
  return executeEquipmentRentalInventory(executor, { rentalId: Number(row.id), details, startDate: dateText(row.start_date), status: row.status, customerName: row.customer_name, actor, requestId, action, lines, saveDetails: async next => saveDetails(executor, Number(row.id), next as EquipmentRentalDetails) });
}

function operationStatus(details: EquipmentRentalDetails, action: string) {
  if (action === "confirm") return "confirmed";
  if (action === "cancel") return "cancelled";
  const pending = details.assets.some(line => Number(line.pendingInspectionQty ?? 0) > 0);
  const outstanding = details.assets.some(line => lineOutstanding(normalizeQuantityLine(line)) > 0);
  const allOut = details.assets.every(line => normalizeQuantityLine(line).checkedOutQty >= line.quantity);
  const anyReturned = details.assets.some(line => { const n = normalizeQuantityLine(line); return n.returnedGoodQty + n.returnedDamagedQty + n.missingQty + Number(line.pendingInspectionQty ?? 0) > 0; });
  if (outstanding) return anyReturned ? "partially_returned" : allOut ? "dispatched" : "partially_dispatched";
  if (pending) return "inspection";
  if (!allOut) return details.assets.some(line => Number(line.checkedOutQty ?? 0) > 0) ? "partially_dispatched" : "confirmed";
  return details.assets.some(line => Number(line.checkedOutQty ?? 0) > 0 || ["returned", "completed"].includes(String(line.stage))) ? "returned" : "confirmed";
}

async function create(req: NextRequest, input: any, actor: EquipmentRentalActor, caps: EquipmentRentalCapabilities) {
  requireCapability(caps, "create"); const requestId = requestIdentity(req, input);
  const id = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`equipment-rental-create:${requestId}`},0))`);
    const replay = rows(await tx.execute(sql`select id,created_by,equipment_details from rental_orders where rental_kind='equipment' and equipment_details->>'createRequestId'=${requestId}`))[0];
    if (replay) { if (Number(replay.created_by) !== actor.id || replay.equipment_details?.createFingerprint !== requestFingerprint(input)) throw new RentalError("معرف إنشاء الإيجار مستخدم لطلب مختلف",409); return Number(replay.id); }
    if (!Array.isArray(input.assets) || input.assets.length === 0 || input.assets.length > 100) throw new RentalError("أضف أصلاً واحداً على الأقل وبحد أقصى 100 أصل");
    const products = await lockProducts(tx, input.assets.map((line: any) => positiveId(line.productId)));
    const validated = await validateDetails(tx, input, products, requestId, actor);
    const customer = await customerFor(tx, input);
    validated.details.createFingerprint = requestFingerprint(input);
    const sequence = rows(await tx.execute(sql`select nextval('equipment_rental_number_seq')::text as value`))[0];
    const orderNo = `RNT-${today().slice(0, 4)}-${String(sequence.value).padStart(6, "0")}`;
    const row = rows(await tx.execute(sql`insert into rental_orders(order_no,rental_kind,equipment_details,product_id,stock_source_product_id,customer_id,customer_name,phone,phone_last4,start_date,end_date,days,price_per_day,total_amount,paid_amount,remaining_amount,payment_status,status,stock_applied,created_by,created_by_name,notes) values(${orderNo},'equipment',${JSON.stringify(validated.details)}::jsonb,${validated.details.assets[0].productId},${validated.details.assets[0].productId},${customer.id},${customer.name},${customer.phone},${customer.phone.slice(-4)},${input.startDate}::date,${input.endDate}::date,${validated.days},0,${validated.total},0,${validated.total},'unpaid','draft',0,${actor.id},${actor.name},${text(input.notes,3000)}) returning id`))[0];
    await audit(tx, Number(row.id), validated.details, "create", requestId, actor);
    return Number(row.id);
  });
  return json(await detail(db, await loadRental(db, id), actor), 201);
}

async function mutate(req: NextRequest, id: number, action: string, input: any, actor: EquipmentRentalActor, caps: EquipmentRentalCapabilities) {
  const key: keyof EquipmentRentalCapabilities = action === "cost-link" ? "costs" : action === "edit" || action === "attachments" ? "edit" : action === "submit" ? "create" : action === "inspection" ? "inspect" : action === "finance" ? "finance" : action as keyof EquipmentRentalCapabilities;
    if (!["edit", "submit", "confirm", "cancel", "dispatch", "return", "inspection", "finance", "attachments", "cost-link"].includes(action)) throw new RentalError("الإجراء غير موجود", 404);
  requireCapability(caps, key); const requestId = requestIdentity(req, input);
  let financeRequest: unknown;
  await db.transaction(async tx => {
    const row = await loadRental(tx, id, true);
    if (row.rental_kind !== "equipment") throw new RentalError("عقود الإيجار السابقة تعرض من سجلها الأصلي؛ استخدم إجراءاتها الأصلية", 409);
    let details = readDetails(row);
    const replay = details.history.find(entry => entry.requestId === requestId);
    if (replay) { if (replay.action !== action || replay.fingerprint !== requestFingerprint(input)) throw new RentalError("معرف الطلب مستخدم لإجراء آخر", 409); return; }
    // Existing event writers lock their booking before its assets. Preserve that
    // same order when a rental also needs to inspect the linked booking.
    if (action === "confirm" && details.linkedBooking) {
      const link = details.linkedBooking;
      const linked = rows(await tx.execute(link.source === "service" ? sql`select custom_fields->'bookingOperations'->'assets' as assets from service_orders where id=${link.id} for update` : sql`select booking_details->'bookingOperations'->'assets' as assets from kosha_bookings where id=${link.id} for update`))[0];
      const holds = Array.isArray(linked?.assets) ? linked.assets : [];
      if (holds.some((line: any) => details.assets.some(asset => asset.productId === Number(line.productId)) && !["released","returned","completed"].includes(String(line.stage)))) throw new RentalError("بعض المعدات محجوزة في الحجز المرتبط؛ حرر الحجز الأصلي للمعدات أو استخدمه قبل إنشاء حجز إيجار آخر لها",409);
    }
    const productIds = details.assets.map(line => line.productId);
    if (action === "edit" && Array.isArray(input.assets)) productIds.push(...input.assets.map((line: any) => positiveId(line.productId)));
    const products = await lockProducts(tx, productIds);
    if (action === "cancel") {
      const balance = await equipmentRentalFinancialSummary(tx, id);
      const charge = rows(await tx.execute(sql`select coalesce(sum(case when direction='revenue' then amount::numeric else -amount::numeric end),0) as amount from financial_transactions where source_type='equipment_rental_charge' and source_id=${String(id)} and approval_status='executed'`))[0];
      if (Number(balance.paid) > 0.005 || Number(balance.depositHeld) > 0.005 || Number(charge.amount) > 0.005 || (balance.pendingRequests as unknown[]).length) throw new RentalError("سوِّ الدفعات والتأمين والرسوم والطلبات المعلقة من مصادرها الأصلية قبل إلغاء العقد",409);
    }
    if (["dispatch","return","inspection"].includes(action) && Array.isArray(input.lines)) {
      for (const line of input.lines) {
        const original = details.assets.find(asset => asset.productId === Number(line.productId));
        if (action === "return" && line.warehouseId && original && actor.role !== "admin" && !actor.permissions.includes("warehouse_transfer") && !actor.permissions.includes("warehouse_stock_manage")) {
          const home = await mainWarehouseId(tx);
          const quantity = Number(line.goodQuantity ?? 0) + Number(line.damagedQuantity ?? 0) + Number(line.missingQuantity ?? 0) + Number(line.pendingInspectionQuantity ?? 0);
          const sources = original.trackingMode === "quantity" ? consumeOutstanding(lineAllocations(original, home), quantity) : [{ warehouseId: Number(original.warehouseId || home) }];
          if (sources.some(source => source.warehouseId !== Number(line.warehouseId))) throw new RentalError("الإرجاع إلى مخزن مختلف يحتاج صلاحية التحويل بين المخازن",403);
        }
      }
      const staffIds = [...new Set<number>(input.lines.map((line: any) => positiveId(line.staffId)))];
      const employees = rows(await tx.execute(sql`select id from staff where id in (${idsSql(staffIds)}) and is_active=true for share`));
      if (employees.length !== staffIds.length) throw new RentalError("الموظف المسؤول غير موجود أو غير نشط",422);
      if (actor.role !== "admin" && !actor.permissions.includes("booking_staff_assign") && staffIds.some(id => id !== actor.id)) throw new RentalError("يلزم امتلاك صلاحية إسناد الموظفين لتسجيل مسؤول آخر",403);
      details.responsibilityHistory = [...(Array.isArray(details.responsibilityHistory) ? details.responsibilityHistory : []), { requestId, action, staffIds, actorId: actor.id, at: new Date().toISOString() }];
    }
    if (action === "finance") {
      financeRequest = await requestEquipmentRentalMoney(tx, { ...input, rentalId: id, requestId, actor });
    } else if (action === "cost-link") {
      const expenseId = positiveId(input.expenseId);
      const expense = rows(await tx.execute(sql`select id,created_by,rental_order_id from expenses where id=${expenseId} and deleted_at is null for update`))[0];
      if (!expense) throw new RentalError("المصروف غير موجود",404);
      if (!["admin","manager"].includes(actor.role) && !actor.permissions.includes("expenses_view_all") && Number(expense.created_by) !== actor.id) throw new RentalError("ليس لديك صلاحية هذا المصروف",403);
      if (expense.rental_order_id && Number(expense.rental_order_id) !== id) throw new RentalError("المصروف مرتبط بإيجار آخر؛ لا يمكن نسبه مرتين",409);
      await tx.execute(sql`update expenses set rental_order_id=${id},updated_at=now() where id=${expenseId}`);
    } else if (action === "attachments") {
      const url = text(input.url, 2000); const name = text(input.name, 200);
      if (!name || !(url.startsWith("/api/") || /^https:\/\//i.test(url))) throw new RentalError("اختر اسم المرفق ورابطاً صالحاً من مركز المستندات");
      details.attachments = [...details.attachments, { id: requestId, name, url, createdAt: new Date().toISOString() }];
    } else if (action === "submit") {
      if (row.status !== "draft") throw new RentalError("يمكن إرسال المسودة فقط للاعتماد", 409);
      await tx.execute(sql`update rental_orders set status='pending_approval',updated_at=now() where id=${id}`);
    } else if (action === "edit") {
      if (!["draft", "pending_approval", "confirmed"].includes(row.status)) throw new RentalError("لا يمكن تعديل التسعير أو الفترة بعد بدء تسليم المعدات", 409);
      if (details.assets.some(line => Number(line.checkedOutQty ?? 0) > 0 || line.stage === "out")) throw new RentalError("بدأ تسليم المعدات ولا يمكن تغيير العقد", 409);
      if (input.updatedAt && new Date(input.updatedAt).getTime() !== new Date(row.updated_at).getTime()) throw new RentalError("تم تعديل العقد؛ حدّث الصفحة قبل الحفظ", 409);
      if (!Array.isArray(input.assets) || input.assets.length < 1 || input.assets.length > 100) throw new RentalError("أصول العقد غير صحيحة");
      const customer = await customerFor(tx, input);
      const settled = await equipmentRentalFinancialSummary(tx, id);
      const voucher = rows(await tx.execute(sql`select exists(select 1 from receipt_voucher_allocations a join receipt_vouchers v on v.id=a.receipt_voucher_id where a.source_type='rental_order' and a.source_id=${id} and v.approval_status not in ('rejected','cancelled','canceled') and a.amount::numeric>coalesce(a.reversed_amount::numeric,0)) as present`))[0];
      if (customer.id !== Number(row.customer_id) && (voucher.present || Number(settled.paid) > 0 || (settled.pendingRequests as unknown[]).length || (settled.payments as unknown[]).length || (settled.charges as unknown[]).length)) throw new RentalError("لا يمكن تغيير العميل بعد تسجيل حركة مالية؛ احتفظ بهوية العقد الأصلية",409);
      if (row.status === "confirmed") await inventory(tx, row, details, actor, `${requestId}-release`, "cancel", {});
      const validated = await validateDetails(tx, input, products, requestId, actor, details); details = validated.details;
      const charges = rows(await tx.execute(sql`select coalesce(sum(case when direction='revenue' then amount::numeric else -amount::numeric end),0) as amount from financial_transactions where source_type='equipment_rental_charge' and source_id=${String(id)} and transaction_type in ('er_charge','er_charge_reversal') and approval_status='executed'`))[0];
      const total = validated.total + Number(charges.amount);
      if (total + 0.005 < Number(settled.paid) + Number(settled.pendingRent)) throw new RentalError("إجمالي العقد الجديد أقل من الدفعات المعتمدة أو المحجوزة",409);
      await tx.execute(sql`update rental_orders set product_id=${details.assets[0].productId},stock_source_product_id=${details.assets[0].productId},customer_id=${customer.id},customer_name=${customer.name},phone=${customer.phone},phone_last4=${customer.phone.slice(-4)},start_date=${input.startDate}::date,end_date=${input.endDate}::date,days=${validated.days},total_amount=${total},equipment_details=${JSON.stringify(details)}::jsonb,notes=${text(input.notes,3000)},updated_at=now() where id=${id}`);
      if (row.status === "confirmed") {
        const changed = await inventory(tx, { ...row, start_date: input.startDate }, details, actor, `${requestId}-reserve`, "confirm", {}); details = changed.details as EquipmentRentalDetails;
      }
      await reconcilePaymentState(tx, { sourceType: "rental_order", sourceId: id });
    } else {
      if (action === "confirm" && !["draft", "pending_approval"].includes(row.status)) throw new RentalError("العقد مؤكد أو مغلق مسبقاً", 409);
      if (action === "cancel" && ["cancelled", "returned", "completed"].includes(row.status)) throw new RentalError("العقد مغلق مسبقاً", 409);
      if (["dispatch", "return", "inspection"].includes(action) && ["draft", "pending_approval", "cancelled", "completed"].includes(row.status)) throw new RentalError("حالة العقد لا تسمح بهذه العملية", 409);
      const changed = await inventory(tx, row, details, actor, requestId, action as "confirm" | "cancel" | "dispatch" | "return" | "inspection", input); details = changed.details as EquipmentRentalDetails;
      const status = operationStatus(details, action);
      await tx.execute(sql`update rental_orders set status=${status},stock_applied=0,returned_at=${["returned", "completed"].includes(status) ? sql`now()` : sql`null`},cancelled_at=${status === "cancelled" ? sql`now()` : sql`null`},updated_at=now() where id=${id}`);
      if (action === "cancel") await reconcilePaymentState(tx, { sourceType: "rental_order", sourceId: id });
    }
    await audit(tx, id, details, action, requestId, actor, input.note ?? input.notes, requestFingerprint(input));
  });
  const output = await detail(db, await loadRental(db, id), actor);
  return json(financeRequest ? { ...output, financeRequest } : output);
}

async function availability(req: NextRequest, input: any) {
  const params = req.nextUrl.searchParams;
  const rentalId = Number(input.rentalId ?? params.get("rentalId") ?? 0);
  let row: any; let details: EquipmentRentalDetails;
  if (rentalId && !input.assets && !params.get("productIds")) { row = await loadRental(db, positiveId(rentalId)); details = readDetails(row); }
  else {
    const assets = input.assets ?? String(params.get("productIds") ?? "").split(",").filter(Boolean).map(id => ({ productId: positiveId(id), quantity: Number(params.get("quantity") ?? 1), warehouseId: params.get("warehouseId") ? positiveId(params.get("warehouseId")) : null, pricingType: "fixed", unitPrice: 0 }));
    const draft = { ...Object.fromEntries(params), ...input, assets, startTime: input.startTime ?? params.get("startTime") ?? "00:00", endTime: input.endTime ?? params.get("endTime") ?? "23:59" };
    const priced = calculateEquipmentRental(draft); const start = `${draft.startDate}T${draft.startTime}:00+03:00`; const end = `${draft.endDate}T${draft.endTime}:00+03:00`;
    details = { ...draft, ...priced, version: 1, address: "", linkedBooking: null, terms: "", assets: priced.assets, resourceWindow: parseBookingResourceWindow(input.resourceWindow ?? { preparationStart: start, eventStart: start, eventEnd: end, returnEnd: end }), history: [], attachments: [], createRequestId: "" };
    row = { id: rentalId || 0, start_date: draft.startDate, status: "draft", customer_name: "" };
  }
  return json({ assets: await equipmentRentalAvailability(db, { rentalId: Number(row.id), details, startDate: dateText(row.start_date), status: row.status, customerName: row.customer_name }) });
}

async function reports(req: NextRequest) {
  const where = filterSql(req.nextUrl.searchParams);
  const byAsset = rows(await db.execute(sql`select (a->>'productId')::int as "productId",max(a->>'name') as name,count(distinct r.id)::int as contracts,coalesce(sum((a->>'quantity')::numeric),0) as quantity,coalesce(sum((a->>'lineTotal')::numeric),0) as revenue from rental_orders r cross join lateral jsonb_array_elements(coalesce(r.equipment_details->'assets','[]'::jsonb)) a where ${where} and r.rental_kind='equipment' and r.status not in ('draft','pending_approval','cancelled') group by a->>'productId' order by revenue desc limit 200`));
  const byCustomer = rows(await db.execute(sql`select r.customer_id as "customerId",max(r.customer_name) as name,count(*)::int as contracts,sum(r.total_amount::numeric) as total,sum(r.paid_amount::numeric) as paid,sum(r.remaining_amount::numeric) as remaining from rental_orders r where ${where} and r.status not in ('draft','pending_approval','cancelled') group by r.customer_id order by total desc limit 200`));
  const totals = rows(await db.execute(sql`select count(*)::int as contracts,coalesce(sum(r.total_amount::numeric),0) as revenue,coalesce(sum(r.paid_amount::numeric),0) as paid,coalesce(sum(r.remaining_amount::numeric),0) as remaining from rental_orders r where ${where} and r.status not in ('draft','pending_approval','cancelled')`))[0];
  const byWarehouse = rows(await db.execute(sql`select w.id,w.name,coalesce(sum((a->>'quantity')::numeric),0) as quantity,
    coalesce(sum(greatest(coalesce((a->>'checkedOutQty')::numeric,0)-coalesce((a->>'returnedGoodQty')::numeric,0)-coalesce((a->>'returnedDamagedQty')::numeric,0)-coalesce((a->>'missingQty')::numeric,0)-coalesce((a->>'pendingInspectionQty')::numeric,0),0)),0) as outstanding
    from rental_orders r cross join lateral jsonb_array_elements(coalesce(r.equipment_details->'assets','[]'::jsonb)) a join warehouses w on w.id=(a->>'warehouseId')::int
    where ${where} and r.rental_kind='equipment' and r.status not in ('draft','pending_approval','cancelled') group by w.id,w.name order by w.id`));
  const extra = rows(await db.execute(sql`select
    coalesce(sum((select coalesce(sum(case when f.direction='revenue' then f.amount::numeric else -f.amount::numeric end),0) from financial_transactions f where f.source_type='rental_order' and f.source_id=r.id::text and f.approval_status='executed') +
      (select coalesce(sum(greatest(a.amount::numeric-coalesce(a.reversed_amount::numeric,0),0)),0) from receipt_voucher_allocations a join receipt_vouchers v on v.id=a.receipt_voucher_id where a.source_type='rental_order' and a.source_id=r.id and a.posted_at is not null and coalesce(v.approval_status,'executed')='executed')),0) as cash_collected,
    coalesce(sum((select coalesce(sum(case when f.direction='revenue' then f.amount::numeric else -f.amount::numeric end),0) from financial_transactions f where f.source_type='equipment_rental_deposit' and f.source_id=r.id::text and f.approval_status='executed')),0) as deposit_held,
    coalesce(sum((select coalesce(sum(case when f.direction='expense' then f.amount::numeric else -f.amount::numeric end),0) from expenses e join financial_transactions f on f.source_type='expense' and f.source_id=e.id::text and f.approval_status='executed' where e.rental_order_id=r.id and e.deleted_at is null)),0) as direct_costs
    from rental_orders r where ${where} and r.status not in ('draft','pending_approval','cancelled')`))[0];
  const summary = Object.fromEntries(Object.entries(totals).map(([key,value]) => [key, Number(value)]));
  Object.assign(summary, { cashCollected: Number(extra.cash_collected), depositHeld: Number(extra.deposit_held), directCosts: Number(extra.direct_costs), directContribution: Number(totals.revenue)-Number(extra.direct_costs) });
  return json({ summary, byAsset, byCustomer, byWarehouse });
}

/** Authenticated extension only. The legacy public rental handler is untouched. */
export async function handleEquipmentRentals(req: NextRequest, parts: string[], actor: EquipmentRentalActor) {
  const errorRequestId = makeRequestId(req.headers.get("x-request-id"));
  try {
    const caps = equipmentRentalCapabilities(actor);
    if (!Object.values(caps).some(Boolean)) throw new RentalError("ليس لديك صلاحية تأجير المعدات", 403);
    await requireSchema(db);
    if (parts[0] === "cost-options" && req.method === "GET") {
      requireCapability(caps,"costs"); const q = `%${text(req.nextUrl.searchParams.get("q"),100)}%`;
      return json({ data: rows(await db.execute(sql`select id,name,amount,date,rental_order_id as "rentalOrderId" from expenses where deleted_at is null
        and (${["admin","manager"].includes(actor.role) || actor.permissions.includes("expenses_view_all")} or created_by=${actor.id}) and name ilike ${q} order by date desc,id desc limit 30`)) });
    }
    if (parts[0] === "booking-search" && req.method === "GET") {
      requireCapability(caps,"create"); const q = `%${text(req.nextUrl.searchParams.get("q"),100)}%`;
      return json({ data: rows(await db.execute(sql`select * from (
        select 'service' as source,id,coalesce(tracking_code,id::text) as number,customer_name as "customerName",event_date::text as "eventDate" from service_orders where archived_at is null and (customer_name ilike ${q} or phone ilike ${q} or tracking_code ilike ${q})
        union all select 'kosha',id,coalesce(tracking_code,id::text),customer_name,event_date::text from kosha_bookings where archived_at is null and (customer_name ilike ${q} or phone ilike ${q} or tracking_code ilike ${q})) bookings order by "eventDate" desc nulls last,id desc limit 20`)) });
    }
    if (parts[0] === "options" && req.method === "GET") { requireCapability(caps,"view"); return await options(req, actor); }
    if (parts[0] === "availability" && ["GET", "POST"].includes(req.method)) { requireCapability(caps,"view"); return await availability(req, req.method === "POST" ? await readRequestBody(req) : {}); }
    if (parts[0] === "reports" && req.method === "GET") { requireCapability(caps, "reports"); return await reports(req); }
    if (parts[0] === "settings") {
      requireCapability(caps, "settings");
      if (req.method === "GET" && parts[1]) {
        const id = positiveId(parts[1]);
        const row = rows(await db.execute(sql`select is_rental,price_per_day,rental_settings from products where id=${id} and is_asset=true`))[0];
        if (!row) throw new RentalError("الأصل غير موجود", 404);
        return json(normalizeEquipmentRentalSettings(row.rental_settings, { isRental: row.is_rental, pricePerDay: row.price_per_day }));
      }
      if (req.method === "PUT" && parts[1]) {
        const id = positiveId(parts[1]); const input = await readRequestBody(req); const requestId = requestIdentity(req, input);
        const settings = normalizeEquipmentRentalSettings(input.settings ?? input);
        await db.transaction(async tx => {
          const products = await lockProducts(tx, [id]); if (products[0].is_asset !== true) throw new RentalError("إعدادات التأجير مخصصة للأصول", 409);
          await tx.execute(sql`update products set rental_settings=${JSON.stringify(settings)}::jsonb,is_rental=${settings.enabled},price_per_day=${settings.dailyPrice},updated_at=now() where id=${id}`);
          await tx.execute(sql`insert into entity_timeline(entity_type,entity_id,type,title,actor_id,actor_name,metadata) values('asset',${id},'rental_settings','تحديث إعدادات تأجير الأصل',${actor.id},${actor.name},${JSON.stringify({ requestId, settings })}::jsonb)`);
        });
        return json({ id, settings });
      }
    }
    if (parts.length === 0 && req.method === "GET") { requireCapability(caps, "view"); return await list(req, actor); }
    if (parts.length === 0 && req.method === "POST") return await create(req, await readRequestBody(req), actor, caps);
    if (parts[0] && /^\d+$/.test(parts[0])) {
      const id = positiveId(parts[0]);
      if (parts.length === 1 && req.method === "GET") { requireCapability(caps, "view"); return json(await detail(db, await loadRental(db,id),actor)); }
      if (parts.length === 1 && ["PUT", "PATCH"].includes(req.method)) return await mutate(req,id,"edit",await readRequestBody(req),actor,caps);
      if (parts.length === 2 && req.method === "POST") return await mutate(req,id,parts[1],await readRequestBody(req),actor,caps);
    }
    throw new RentalError("المسار غير موجود", 404);
  } catch (cause: any) {
    const known = cause instanceof RentalError || cause instanceof EquipmentRentalValidationError || ["QuantityAssetError", "IndividualCustodyError", "WarehouseError", "FinancialApprovalError", "EquipmentRentalFinanceError", "EquipmentRentalInventoryError", "BookingResourceWindowError"].includes(cause?.name);
    const malformed = cause instanceof InvalidJsonBodyError || cause instanceof RequestBodyTooLargeError;
    const mapped = cause?.name === "ZodError" && Array.isArray(cause.issues) ? { status: 422, message: "بيانات الحركة المالية غير صحيحة؛ راجع المبلغ وطريقة الدفع والمرفقات" } : known ? { status: Number(cause.status ?? 422), message: cause.message } : malformed ? { status: 400, message: "طلب JSON غير صالح" } : mapWriteError(cause?.cause ?? cause);
    console.error("equipment rentals request failed", { requestId: errorRequestId, action: parts.join("/"), actorId: actor.id, name: cause?.name, code: cause?.cause?.code ?? cause?.code, status: mapped.status });
    const payload = createApiErrorPayload({ ...mapped, requestId: errorRequestId });
    return NextResponse.json(payload, { status: mapped.status, headers: { "x-request-id": errorRequestId } });
  }
}
