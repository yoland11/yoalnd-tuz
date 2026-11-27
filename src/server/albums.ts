/**
 * Album Management (إدارة الألبومات) — /api/admin/albums/*.
 *
 * Reuses what already exists instead of copying it:
 * - money: an album that is charged on its own gets one sales invoice; every
 *   payment is a pending cash-box transaction on that invoice, executed by the
 *   existing financial approval, which reconciles the invoice (canonical state).
 *   An album included in a photography package never gets a second charge.
 * - inventory: materials go through the existing stock engine with one
 *   idempotency key per line, so a retry never moves stock twice.
 * - employees: assignments create Work Commands orders (source "album_task").
 * - notifications: the existing createNotification / createNotificationOnce.
 * Errors use the AJN structured error contract with a request id.
 */
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db, salesInvoiceItemsTable, salesInvoicesTable } from "@workspace/db";
import { normalizeIraqiPhone } from "@/lib/phone";
import {
  ALBUM_ACTIONS,
  ALBUM_CATALOG_KINDS,
  ALBUM_ROLES,
  ALBUM_STAGE_BUCKETS,
  ALBUM_SUGGESTED_OPTIONS,
  albumAccess,
  albumActionsFor,
  albumBarcode,
  albumCents,
  albumCopyCode,
  albumFinance,
  albumNumber,
  albumStageIndex,
  albumStageLabel,
  baghdadToday,
  centsToAmount,
  isAlbumStage,
  type AlbumAccess,
  type AlbumBucket,
  type AlbumRole,
} from "@/lib/albums";
import { createAndExecuteSourceFinancialTransaction, type FinancialActor } from "@/server/master-cash-box";
import { reconcilePaymentState } from "@/server/payment-state";
import { safeServerError } from "@/server/safe-server-log";
import { createApiErrorPayload, makeRequestId, mapWriteError, type ApiErrorCode } from "@/server/write-safety";

export type AlbumUser = { id: number; username: string; fullName: string; role: string; permissions: string[]; isActive: boolean; department?: string | null };
export type AlbumNotice = {
  audienceType?: "admin" | "staff";
  staffId?: number | null;
  type: string;
  title: string;
  body?: string;
  entityType?: string | null;
  entityId?: number | null;
  href?: string | null;
  metadata?: Record<string, unknown>;
};
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
export type AlbumDeps = {
  notify: (notice: AlbumNotice) => Promise<unknown>;
  notifyOnce: (notice: AlbumNotice) => Promise<unknown>;
  /** The existing stock engine (adjustProductStock), inside the caller's transaction. */
  adjustStock: (productId: number, delta: number, meta: { reason: string; relatedType: string; relatedId: number; movementType: string; idempotencyKey: string; metadata: Record<string, unknown>; createdBy: number; createdByName: string }, tx: Tx) => Promise<unknown>;
  /** Creates a Work Commands order for one assignee; may refuse when the user cannot issue orders. */
  createWorkTask: (user: AlbumUser, input: { title: string; description: string; templateKey: string | null; department: string; assigneeId: number; dueAt: string | null; customerId: number | null; bookingId: number | null; sourceId: number; idempotencyKey: string }) => Promise<{ taskId: number; existing: boolean }>;
  audit: (action: string, entityId: number, details: Record<string, unknown>) => void;
};

export class AlbumError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: ApiErrorCode, readonly fieldErrors?: Record<string, string>) {
    super(message);
  }
}

type Row = Record<string, any>;
const rows = <T = Row>(result: any): T[] => (result?.rows ?? []) as T[];
const first = <T = Row>(result: any): T | undefined => rows<T>(result)[0];
const actorName = (user: AlbumUser) => user.fullName || user.username || `#${user.id}`;
const financialActor = (user: AlbumUser): FinancialActor => ({ id: user.id, name: actorName(user), role: user.role, permissions: user.permissions });
const token = () => randomBytes(18).toString("base64url");
const text = (value: unknown, max = 500) => {
  const clean = String(value ?? "").trim();
  return clean ? clean.slice(0, max) : null;
};
const positiveId = (value: unknown) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};
const isoDate = (value: unknown) => {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw new AlbumError("تاريخ غير صالح", 422, "VALIDATION_ERROR");
  const date = new Date(`${clean}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== clean) throw new AlbumError("تاريخ غير صالح", 422, "VALIDATION_ERROR");
  return clean;
};
const optionalCount = (value: unknown, field: string, min = 0, max = 100000) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new AlbumError("قيمة غير صالحة", 422, "VALIDATION_ERROR", { [field]: "أدخل رقماً صحيحاً" });
  return number;
};
const money = (value: unknown, field: string) => {
  const cents = albumCents(value);
  if (cents < 0 || cents > 99_999_999_999) throw new AlbumError("مبلغ غير صالح", 422, "VALIDATION_ERROR", { [field]: "مبلغ غير صالح" });
  return centsToAmount(cents);
};
function cleanAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    const url = String((item as Row)?.url ?? "").trim();
    // Uploads come back from the existing (cloud or local-server) upload pipeline.
    if (!/^(https?:\/\/|\/)/i.test(url) || url.length > 2000) return [];
    return [{ url, fileName: text((item as Row)?.fileName, 200) ?? undefined, mediaType: text((item as Row)?.mediaType, 100) ?? undefined }];
  });
}
const isUndefinedTable = (error: unknown) => {
  const value = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return value?.code === "42P01" || value?.cause?.code === "42P01";
};

// --------------------------------------------------------------- reading rows

const ALBUM_SELECT = sql`
  a.*,
  COALESCE(NULLIF(d.full_name, ''), d.username) AS designer_name,
  COALESCE(NULLIF(p.full_name, ''), p.username) AS printer_name,
  COALESCE(NULLIF(b.full_name, ''), b.username) AS binder_name,
  COALESCE(NULLIF(q.full_name, ''), q.username) AS quality_name,
  si.invoice_no, si.total AS invoice_total, si.paid_amount AS invoice_paid, si.remaining_amount AS invoice_remaining,
  si.payment_status AS invoice_payment_status, si.status AS invoice_status,
  so.tracking_code AS booking_code, so.total_amount AS booking_total, so.remaining_amount AS booking_remaining,
  so.payment_status AS booking_payment_status, so.event_date AS booking_event_date
`;
const ALBUM_FROM = sql`
  album_orders a
  LEFT JOIN staff d ON d.id = a.designer_staff_id
  LEFT JOIN staff p ON p.id = a.printer_staff_id
  LEFT JOIN staff b ON b.id = a.binder_staff_id
  LEFT JOIN staff q ON q.id = a.quality_staff_id
  LEFT JOIN sales_invoices si ON si.id = a.invoice_id
  LEFT JOIN service_orders so ON so.id = a.booking_id
`;

/** Money the album still waits for: canonical invoice state, never a stored album snapshot. */
function moneyState(row: Row) {
  if (row.finance_mode === "invoice" && row.invoice_id) {
    const cancelled = row.invoice_status === "cancelled";
    return {
      paidAmount: cancelled ? "0.00" : centsToAmount(albumCents(row.invoice_paid)),
      remainingAmount: cancelled ? "0.00" : centsToAmount(albumCents(row.invoice_remaining)),
      paymentStatus: cancelled ? "cancelled" : String(row.invoice_payment_status ?? "unpaid"),
    };
  }
  if (row.finance_mode === "package" && row.booking_id) {
    return { paidAmount: "0.00", remainingAmount: centsToAmount(albumCents(row.booking_remaining)), paymentStatus: String(row.booking_payment_status ?? "") || "package" };
  }
  return { paidAmount: "0.00", remainingAmount: "0.00", paymentStatus: "paid" };
}

function serializeAlbum(row: Row, access: AlbumAccess, today = baghdadToday()) {
  const state = moneyState(row);
  const finance = albumFinance({
    salePrice: row.sale_price, designCost: row.design_cost, printingCost: row.printing_cost, coverCost: row.cover_cost,
    bindingCost: row.binding_cost, extraCosts: row.extra_costs, paidAmount: state.paidAmount, financeMode: row.finance_mode,
  });
  const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : null;
  const base = {
    id: Number(row.id),
    albumNo: String(row.album_no),
    qrToken: String(row.qr_token),
    barcodeValue: String(row.barcode_value),
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    customerName: String(row.customer_name ?? ""),
    phone: String(row.phone ?? ""),
    bookingId: row.booking_id == null ? null : Number(row.booking_id),
    bookingCode: row.booking_code ?? (row.booking_id ? `B-${row.booking_id}` : null),
    occasionType: row.occasion_type ?? null,
    albumType: String(row.album_type ?? ""),
    albumSize: String(row.album_size ?? ""),
    pageCount: row.page_count == null ? null : Number(row.page_count),
    photoCount: row.photo_count == null ? null : Number(row.photo_count),
    copies: Number(row.copies ?? 1),
    coverType: row.cover_type ?? null,
    coverColor: row.cover_color ?? null,
    paperType: row.paper_type ?? null,
    boxType: row.box_type ?? null,
    coverNames: row.cover_names ?? null,
    occasionDate: row.occasion_date ? String(row.occasion_date).slice(0, 10) : null,
    orderDate: row.order_date ? String(row.order_date).slice(0, 10) : null,
    dueDate,
    designerStaffId: row.designer_staff_id == null ? null : Number(row.designer_staff_id),
    printerStaffId: row.printer_staff_id == null ? null : Number(row.printer_staff_id),
    binderStaffId: row.binder_staff_id == null ? null : Number(row.binder_staff_id),
    qualityStaffId: row.quality_staff_id == null ? null : Number(row.quality_staff_id),
    designerName: row.designer_name ?? null,
    printerName: row.printer_name ?? null,
    binderName: row.binder_name ?? null,
    qualityName: row.quality_name ?? null,
    customerNotes: row.customer_notes ?? null,
    internalNotes: row.internal_notes ?? null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    stage: String(row.stage),
    stageLabel: albumStageLabel(row.stage),
    stageChangedAt: row.stage_changed_at,
    status: String(row.status),
    financeMode: String(row.finance_mode),
    delayed: row.status === "active" && Boolean(dueDate) && dueDate! < today && !["ready", "delivered"].includes(String(row.stage)),
    deliveredAt: row.delivered_at ?? null,
    deliveredToName: row.delivered_to_name ?? null,
    deliveredByName: row.delivered_by_name ?? null,
    deliveryPhotoUrl: row.delivery_photo_url ?? null,
    deliverySignatureUrl: row.delivery_signature_url ?? null,
    cancelReason: row.cancel_reason ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    // Whether money is still owed is operational (delivery needs it); the amounts are not.
    hasOutstanding: albumCents(state.remainingAmount) > 0,
  };
  if (!access.financials) return base;
  return {
    ...base,
    invoiceId: row.invoice_id == null ? null : Number(row.invoice_id),
    invoiceNo: row.invoice_no ?? null,
    designCost: centsToAmount(albumCents(row.design_cost)),
    printingCost: centsToAmount(albumCents(row.printing_cost)),
    coverCost: centsToAmount(albumCents(row.cover_cost)),
    bindingCost: centsToAmount(albumCents(row.binding_cost)),
    extraCosts: centsToAmount(albumCents(row.extra_costs)),
    ...finance,
    paidAmount: state.paidAmount,
    remainingAmount: state.remainingAmount,
    paymentStatus: state.paymentStatus,
    bookingTotal: row.booking_id ? centsToAmount(albumCents(row.booking_total)) : null,
  };
}

/** Employees without a wider permission only ever see albums they work on. */
function scopeCondition(access: AlbumAccess, userId: number) {
  if (access.viewAll) return sql`TRUE`;
  return sql`(a.designer_staff_id = ${userId} OR a.printer_staff_id = ${userId} OR a.binder_staff_id = ${userId} OR a.quality_staff_id = ${userId}
    OR EXISTS (SELECT 1 FROM album_tasks t WHERE t.album_id = a.id AND t.staff_id = ${userId}))`;
}

async function loadAlbum(executor: Executor, id: number, options: { lock?: boolean } = {}) {
  if (options.lock) await executor.execute(sql`SELECT id FROM album_orders WHERE id = ${id} FOR UPDATE`);
  const row = first(await executor.execute(sql`SELECT ${ALBUM_SELECT} FROM ${ALBUM_FROM} WHERE a.id = ${id}`));
  if (!row) throw new AlbumError("الألبوم غير موجود", 404, "NOT_FOUND");
  return row;
}
async function requireVisible(executor: Executor, id: number, access: AlbumAccess, user: AlbumUser, options: { lock?: boolean } = {}) {
  const row = await loadAlbum(executor, id, options);
  if (!access.viewAll) {
    const visible = first(await executor.execute(sql`SELECT 1 AS ok FROM album_orders a WHERE a.id = ${id} AND ${scopeCondition(access, user.id)}`));
    if (!visible) throw new AlbumError("هذا الألبوم غير مسند إليك", 403, "PERMISSION_DENIED");
  }
  return row;
}

async function addEvent(executor: Executor, albumId: number, user: AlbumUser, event: { type: string; from?: string | null; to?: string | null; note?: string | null; attachments?: unknown }) {
  await executor.execute(sql`
    INSERT INTO album_order_events (album_id, type, from_stage, to_stage, note, attachments, staff_id, staff_name)
    VALUES (${albumId}, ${event.type}, ${event.from ?? null}, ${event.to ?? null}, ${event.note ?? null}, ${JSON.stringify(cleanAttachments(event.attachments))}::jsonb, ${user.id}, ${actorName(user)})
  `);
}

async function pendingInvoicePayments(executor: Executor, invoiceId: number) {
  const row = first(await executor.execute(sql`
    SELECT COALESCE(SUM(amount), 0) AS pending FROM financial_transactions
    WHERE source_type = 'sales_invoice' AND source_id = ${String(invoiceId)} AND direction = 'revenue' AND approval_status = 'pending'
  `));
  return albumCents(row?.pending);
}

// ------------------------------------------------------------------ catalogue

const KIND_KEYS = new Set(ALBUM_CATALOG_KINDS.map((kind) => kind.key));

async function catalog(executor: Executor, includeInactive = false) {
  return rows(await executor.execute(sql`
    SELECT o.*, COALESCE(NULLIF(pr.name_ar, ''), pr.name) AS product_name, pr.stock AS product_stock
    FROM album_catalog_options o LEFT JOIN products pr ON pr.id = o.product_id
    WHERE ${includeInactive ? sql`TRUE` : sql`o.is_active = true`}
    ORDER BY o.kind, o.sort_order, o.id
  `)).map((row) => ({
    id: Number(row.id), kind: String(row.kind), label: String(row.label), isActive: Boolean(row.is_active), sortOrder: Number(row.sort_order ?? 0),
    defaultPrice: centsToAmount(albumCents(row.default_price)), manufacturingCost: centsToAmount(albumCents(row.manufacturing_cost)),
    productId: row.product_id == null ? null : Number(row.product_id), productName: row.product_name ?? null,
    productStock: row.product_stock == null ? null : Number(row.product_stock), materialQuantity: Number(row.material_quantity ?? 1),
  }));
}

async function saveOption(executor: Executor, user: AlbumUser, raw: Row, id?: number) {
  const kind = String(raw.kind ?? "");
  if (!id && !KIND_KEYS.has(kind as never)) throw new AlbumError("نوع الإعداد غير معروف", 422, "VALIDATION_ERROR", { kind: "اختر نوع الإعداد" });
  const label = text(raw.label, 120);
  if (!id && !label) throw new AlbumError("اكتب اسم الخيار", 422, "VALIDATION_ERROR", { label: "مطلوب" });
  const productId = raw.productId === null || raw.productId === "" ? null : positiveId(raw.productId);
  if (raw.productId && !productId) throw new AlbumError("المادة المخزنية غير صحيحة", 422, "VALIDATION_ERROR", { productId: "اختر مادة صحيحة" });
  const quantity = raw.materialQuantity === undefined ? undefined : Number(raw.materialQuantity);
  if (quantity !== undefined && !(quantity > 0 && quantity <= 1000)) throw new AlbumError("كمية المادة غير صالحة", 422, "VALIDATION_ERROR", { materialQuantity: "أكبر من صفر" });
  try {
    if (id) {
      const updated = first(await executor.execute(sql`
        UPDATE album_catalog_options SET
          label = COALESCE(${label}, label),
          default_price = COALESCE(${raw.defaultPrice === undefined ? null : money(raw.defaultPrice, "defaultPrice")}::numeric, default_price),
          manufacturing_cost = COALESCE(${raw.manufacturingCost === undefined ? null : money(raw.manufacturingCost, "manufacturingCost")}::numeric, manufacturing_cost),
          product_id = ${raw.productId === undefined ? sql`product_id` : sql`${productId}`},
          material_quantity = COALESCE(${quantity ?? null}::numeric, material_quantity),
          sort_order = COALESCE(${raw.sortOrder === undefined ? null : Number(raw.sortOrder) || 0}::integer, sort_order),
          is_active = COALESCE(${typeof raw.isActive === "boolean" ? raw.isActive : null}::boolean, is_active),
          updated_at = now()
        WHERE id = ${id} RETURNING id
      `));
      if (!updated) throw new AlbumError("الخيار غير موجود", 404, "NOT_FOUND");
      return id;
    }
    const created = first(await executor.execute(sql`
      INSERT INTO album_catalog_options (kind, label, default_price, manufacturing_cost, product_id, material_quantity, sort_order, created_by)
      VALUES (${kind}, ${label}, ${money(raw.defaultPrice ?? 0, "defaultPrice")}, ${money(raw.manufacturingCost ?? 0, "manufacturingCost")}, ${productId}, ${quantity ?? 1}, ${Number(raw.sortOrder) || 0}, ${user.id})
      RETURNING id
    `));
    return Number(created!.id);
  } catch (error) {
    if ((error as Row)?.code === "23505" || (error as Row)?.cause?.code === "23505") throw new AlbumError("هذا الخيار موجود مسبقاً", 409, "DUPLICATE", { label: "موجود مسبقاً" });
    throw error;
  }
}

// ------------------------------------------------------------------- customer

async function resolveCustomer(tx: Tx, input: { customerId: number | null; name: string; phone: string | null }) {
  if (input.customerId) {
    const selected = first(await tx.execute(sql`SELECT id, COALESCE(NULLIF(full_name, ''), NULLIF(name, ''), phone) AS name, phone FROM customers WHERE id = ${input.customerId}`));
    if (!selected) throw new AlbumError("الزبون المختار غير موجود", 404, "NOT_FOUND", { customerId: "غير موجود" });
    return { id: Number(selected.id), name: String(selected.name ?? input.name), phone: String(selected.phone ?? "") };
  }
  if (!input.phone) throw new AlbumError("رقم الهاتف غير صحيح", 422, "VALIDATION_ERROR", { phone: "أدخل رقم هاتف عراقي صحيح" });
  // Same rule as the research department: reuse the existing customer for this phone.
  const normalized = input.phone;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(82178, hashtext(${normalized}))`);
  const digits = sql`regexp_replace(translate(phone,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g')`;
  const matches = rows(await tx.execute(sql`
    SELECT id, COALESCE(NULLIF(full_name, ''), NULLIF(name, ''), phone) AS name, phone FROM customers
    WHERE ${digits} IN (${normalized}, ${`0${normalized.slice(3)}`}, ${`00${normalized}`}, ${`9640${normalized.slice(3)}`}) ORDER BY id LIMIT 2
  `));
  const existing = matches.find((row) => row.phone === normalized) ?? (matches.length === 1 ? matches[0] : null);
  if (!existing && matches.length > 1) throw new AlbumError("يوجد أكثر من زبون بهذا الهاتف؛ اختر الزبون من القائمة", 409, "CONFLICT", { phone: "اختر الزبون الموجود" });
  if (existing) return { id: Number(existing.id), name: String(existing.name || input.name), phone: String(existing.phone) };
  const created = first(await tx.execute(sql`INSERT INTO customers (phone, name, full_name) VALUES (${normalized}, ${input.name}, ${input.name}) RETURNING id`));
  return { id: Number(created!.id), name: input.name, phone: normalized };
}

/** A booking whose photography deliverables include an album already charged that album. */
async function bookingAlbumIncluded(executor: Executor, bookingId: number) {
  const row = first(await executor.execute(sql`
    SELECT EXISTS (SELECT 1 FROM photography_production_items WHERE booking_id = ${bookingId} AND kind = 'album') AS included
  `).catch((error) => {
    if (isUndefinedTable(error)) return { rows: [{ included: false }] };
    throw error;
  }));
  return Boolean(row?.included);
}

// ------------------------------------------------------------------- creation

type AlbumInput = ReturnType<typeof parseAlbumInput>;
function parseAlbumInput(raw: Row, partial = false) {
  const fieldErrors: Record<string, string> = {};
  const required = (key: string, label: string, max = 200) => {
    const value = text(raw[key], max);
    if (!value && !partial) fieldErrors[key] = `${label} مطلوب`;
    return value;
  };
  const phoneRaw = text(raw.phone, 40);
  const phone = phoneRaw ? normalizeIraqiPhone(phoneRaw) : null;
  if (phoneRaw && !phone) fieldErrors.phone = "رقم الهاتف غير صحيح";
  const data = {
    customerId: positiveId(raw.customerId),
    customerName: required("customerName", "اسم الزبون"),
    phone,
    bookingId: positiveId(raw.bookingId),
    occasionType: text(raw.occasionType, 120),
    albumType: required("albumType", "نوع الألبوم", 120),
    albumSize: required("albumSize", "قياس الألبوم", 120),
    pageCount: optionalCount(raw.pageCount, "pageCount", 1, 2000),
    photoCount: optionalCount(raw.photoCount, "photoCount", 0, 100000),
    copies: optionalCount(raw.copies, "copies", 1, 50) ?? (partial ? null : 1),
    coverType: text(raw.coverType, 120),
    coverColor: text(raw.coverColor, 120),
    paperType: text(raw.paperType, 120),
    boxType: text(raw.boxType, 120),
    coverNames: text(raw.coverNames, 300),
    occasionDate: isoDate(raw.occasionDate),
    orderDate: isoDate(raw.orderDate),
    dueDate: isoDate(raw.dueDate),
    designerStaffId: positiveId(raw.designerStaffId),
    printerStaffId: positiveId(raw.printerStaffId),
    customerNotes: text(raw.customerNotes, 4000),
    internalNotes: text(raw.internalNotes, 4000),
    attachments: cleanAttachments(raw.attachments),
    financeMode: raw.financeMode === undefined ? null : String(raw.financeMode),
    extraAlbumCharge: raw.extraAlbumCharge === true,
    salePrice: raw.salePrice === undefined ? null : money(raw.salePrice, "salePrice"),
    designCost: raw.designCost === undefined ? null : money(raw.designCost, "designCost"),
    printingCost: raw.printingCost === undefined ? null : money(raw.printingCost, "printingCost"),
    coverCost: raw.coverCost === undefined ? null : money(raw.coverCost, "coverCost"),
    bindingCost: raw.bindingCost === undefined ? null : money(raw.bindingCost, "bindingCost"),
    extraCosts: raw.extraCosts === undefined ? null : money(raw.extraCosts, "extraCosts"),
    idempotencyKey: text(raw.idempotencyKey, 140),
  };
  // A linked booking supplies its own customer and phone.
  if (!partial && !data.customerId && !data.bookingId && !data.phone) fieldErrors.phone = fieldErrors.phone ?? "رقم الهاتف مطلوب";
  if (data.financeMode !== null && !["invoice", "package", "free"].includes(data.financeMode)) fieldErrors.financeMode = "اختر طريقة الحساب";
  if (data.dueDate && data.orderDate && data.dueDate < data.orderDate) fieldErrors.dueDate = "موعد التسليم قبل تاريخ الطلب";
  if (Object.keys(fieldErrors).length) throw new AlbumError("تحقق من بيانات الألبوم", 422, "VALIDATION_ERROR", fieldErrors);
  return data;
}

async function createInvoice(tx: Tx, album: { id: number; albumNo: string; albumType: string; albumSize: string; copies: number; dueDate: string | null; salePrice: string }, customer: { id: number; name: string; phone: string }, user: AlbumUser) {
  const total = album.salePrice;
  const [invoice] = await tx.insert(salesInvoicesTable).values({
    invoiceNo: `ALB-TMP-${token()}`, qrToken: token(), date: baghdadToday(), customerName: customer.name, customerPhone: customer.phone, customerId: customer.id,
    subtotal: total, discountAmount: "0", total, paidAmount: "0", remainingAmount: total, paymentMethod: "cash", paymentStatus: albumCents(total) ? "unpaid" : "paid",
    dueDate: album.dueDate, status: "active", isInternal: 0, stockApplied: 0, notes: `فاتورة ألبوم ${album.albumNo}`, createdBy: user.id, createdByName: actorName(user),
  } as any).returning();
  const invoiceNo = `AJN-ALB-INV-${String(invoice.id).padStart(6, "0")}`;
  await tx.update(salesInvoicesTable).set({ invoiceNo } as any).where(sql`id = ${invoice.id}`);
  await tx.insert(salesInvoiceItemsTable).values({
    invoiceId: invoice.id, productName: `ألبوم ${album.albumType} ${album.albumSize} — ${album.albumNo}`, quantity: "1", unitPrice: total, discount: "0", total, costPrice: "0",
  } as any);
  // Payment state is always derived by the canonical reconciler, never typed in.
  await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: invoice.id });
  return { id: Number(invoice.id), invoiceNo };
}

async function createAlbum(raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  if (!access.manage) throw new AlbumError("ليس لديك صلاحية إنشاء طلبات الألبومات", 403, "PERMISSION_DENIED");
  const data = parseAlbumInput(raw);
  const creationKey = data.idempotencyKey ? `${user.id}:${data.idempotencyKey}` : null;
  const wantsMoney = [data.salePrice, data.designCost, data.printingCost, data.coverCost, data.bindingCost, data.extraCosts].some((value) => value !== null && albumCents(value) > 0);
  if (wantsMoney && !access.financials) throw new AlbumError("لا تملك صلاحية تسعير الألبومات", 403, "PERMISSION_DENIED");

  const result = await db.transaction(async (tx) => {
    if (creationKey) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(82241, hashtext(${creationKey}))`);
      const existing = first(await tx.execute(sql`SELECT id FROM album_orders WHERE creation_key = ${creationKey}`));
      if (existing) return { id: Number(existing.id), duplicate: true };
    }
    let booking: Row | undefined;
    if (data.bookingId) {
      booking = first(await tx.execute(sql`SELECT id, customer_id, customer_name, phone, event_date FROM service_orders WHERE id = ${data.bookingId} AND archived_at IS NULL FOR UPDATE`));
      if (!booking) throw new AlbumError("الحجز غير موجود أو مؤرشف", 422, "BOOKING_INVALID", { bookingId: "اختر حجزاً صالحاً" });
    }
    const customer = await resolveCustomer(tx, {
      customerId: data.customerId ?? (booking?.customer_id ? Number(booking.customer_id) : null),
      name: data.customerName!,
      phone: data.phone ?? (booking?.phone ? normalizeIraqiPhone(String(booking.phone)) : null),
    });
    // No second charge for an album the booking's package already includes.
    const included = data.bookingId ? await bookingAlbumIncluded(tx, data.bookingId) : false;
    let financeMode = data.financeMode ?? (included ? "package" : "invoice");
    if (financeMode === "package" && !data.bookingId) throw new AlbumError("ربط الألبوم بباقة يحتاج حجزاً", 422, "VALIDATION_ERROR", { financeMode: "اختر الحجز أولاً" });
    if (included && financeMode === "invoice" && !data.extraAlbumCharge)
      throw new AlbumError("الألبوم مشمول بباقة هذا الحجز؛ لا يُحاسب الزبون عليه مرتين. إن كان ألبوماً إضافياً فاختر «ألبوم إضافي بسعر مستقل».", 409, "DUPLICATE", { financeMode: "مشمول بالباقة" });
    const salePrice = financeMode === "invoice" ? data.salePrice ?? "0.00" : "0.00";
    if (financeMode === "invoice" && albumCents(salePrice) === 0) financeMode = "free";

    const created = first(await tx.execute(sql`
      INSERT INTO album_orders (
        album_no, qr_token, barcode_value, creation_key, customer_id, customer_name, phone, booking_id, occasion_type,
        album_type, album_size, page_count, photo_count, copies, cover_type, cover_color, paper_type, box_type, cover_names,
        occasion_date, order_date, due_date, designer_staff_id, printer_staff_id, customer_notes, internal_notes, attachments,
        finance_mode, sale_price, design_cost, printing_cost, cover_cost, binding_cost, extra_costs, created_by, created_by_name
      ) VALUES (
        ${`TMP-${randomBytes(10).toString("hex")}`}, ${token()}, ${`TMP${randomBytes(12).toString("hex")}`}, ${creationKey}, ${customer.id}, ${customer.name}, ${customer.phone},
        ${data.bookingId}, ${data.occasionType}, ${data.albumType}, ${data.albumSize}, ${data.pageCount}, ${data.photoCount}, ${data.copies ?? 1},
        ${data.coverType}, ${data.coverColor}, ${data.paperType}, ${data.boxType}, ${data.coverNames},
        ${data.occasionDate ?? (booking?.event_date ? String(booking.event_date).slice(0, 10) : null)}, ${data.orderDate ?? baghdadToday()}, ${data.dueDate},
        ${data.designerStaffId}, ${data.printerStaffId}, ${data.customerNotes}, ${data.internalNotes}, ${JSON.stringify(data.attachments)}::jsonb,
        ${financeMode}, ${salePrice}, ${data.designCost ?? "0.00"}, ${data.printingCost ?? "0.00"}, ${data.coverCost ?? "0.00"},
        ${data.bindingCost ?? "0.00"}, ${data.extraCosts ?? "0.00"}, ${user.id}, ${actorName(user)}
      ) RETURNING id
    `));
    const id = Number(created!.id);
    const albumNo = albumNumber(id);
    await tx.execute(sql`UPDATE album_orders SET album_no = ${albumNo}, barcode_value = ${albumBarcode(id)} WHERE id = ${id}`);
    for (let copy = 1; copy <= (data.copies ?? 1); copy += 1)
      await tx.execute(sql`INSERT INTO album_copies (album_id, copy_no, code, qr_token) VALUES (${id}, ${copy}, ${albumCopyCode(id, copy)}, ${token()})`);
    let invoice: { id: number; invoiceNo: string } | null = null;
    if (financeMode === "invoice") {
      invoice = await createInvoice(tx, { id, albumNo, albumType: data.albumType!, albumSize: data.albumSize!, copies: data.copies ?? 1, dueDate: data.dueDate, salePrice }, customer, user);
      await tx.execute(sql`UPDATE album_orders SET invoice_id = ${invoice.id} WHERE id = ${id}`);
    }
    await addEvent(tx, id, user, { type: "created", to: "received", note: `تم تسجيل طلب الألبوم ${albumNo}${invoice ? ` — ${invoice.invoiceNo}` : financeMode === "package" ? " — مشمول بباقة الحجز" : ""}` });
    return { id, duplicate: false, albumNo, financeMode, invoice };
  });

  if (!result.duplicate) {
    deps.audit("album_created", result.id, { albumNo: result.albumNo, financeMode: result.financeMode, invoiceId: result.invoice?.id ?? null });
    const href = `/admin/albums?album=${result.id}`;
    void deps.notify({ type: "album_created", title: `طلب ألبوم جديد ${result.albumNo}`, body: `${data.customerName} — ${data.albumType} ${data.albumSize}`, entityType: "album_order", entityId: result.id, href }).catch(() => {});
    for (const staffId of new Set([data.designerStaffId, data.printerStaffId].filter(Boolean) as number[]))
      void deps.notify({ audienceType: "staff", staffId, type: "album_assigned", title: `أُسند إليك الألبوم ${result.albumNo}`, body: `${data.albumType} ${data.albumSize}`, entityType: "album_order", entityId: result.id, href: "/staff/photography/albums" }).catch(() => {});
  }
  return result;
}

// --------------------------------------------------------------------- update

async function updateAlbum(id: number, raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  if (!access.manage) throw new AlbumError("ليس لديك صلاحية تعديل الألبومات", 403, "PERMISSION_DENIED");
  const data = parseAlbumInput(raw, true);
  const priceChange = [data.salePrice, data.designCost, data.printingCost, data.coverCost, data.bindingCost, data.extraCosts].some((value) => value !== null);
  if (priceChange && !access.financials) throw new AlbumError("لا تملك صلاحية تعديل مالية الألبوم", 403, "PERMISSION_DENIED");
  await db.transaction(async (tx) => {
    const current = await loadAlbum(tx, id, { lock: true });
    if (current.status !== "active") throw new AlbumError("الألبوم ملغى", 409, "CONFLICT");
    if (data.copies !== null && data.copies < Number(current.copies)) {
      throw new AlbumError("لا يمكن إنقاص عدد النسخ بعد إصدار رموزها", 409, "CONFLICT", { copies: `الحد الأدنى ${current.copies}` });
    }
    await tx.execute(sql`
      UPDATE album_orders SET
        customer_name = COALESCE(${data.customerName}, customer_name),
        occasion_type = COALESCE(${data.occasionType}, occasion_type),
        album_type = COALESCE(${data.albumType}, album_type), album_size = COALESCE(${data.albumSize}, album_size),
        page_count = COALESCE(${data.pageCount}::integer, page_count), photo_count = COALESCE(${data.photoCount}::integer, photo_count),
        copies = COALESCE(${data.copies}::integer, copies),
        cover_type = COALESCE(${data.coverType}, cover_type), cover_color = COALESCE(${data.coverColor}, cover_color),
        paper_type = COALESCE(${data.paperType}, paper_type), box_type = COALESCE(${data.boxType}, box_type), cover_names = COALESCE(${data.coverNames}, cover_names),
        occasion_date = COALESCE(${data.occasionDate}::date, occasion_date), due_date = COALESCE(${data.dueDate}::date, due_date),
        customer_notes = COALESCE(${data.customerNotes}, customer_notes), internal_notes = COALESCE(${data.internalNotes}, internal_notes),
        design_cost = COALESCE(${data.designCost}::numeric, design_cost), printing_cost = COALESCE(${data.printingCost}::numeric, printing_cost),
        cover_cost = COALESCE(${data.coverCost}::numeric, cover_cost), binding_cost = COALESCE(${data.bindingCost}::numeric, binding_cost),
        extra_costs = COALESCE(${data.extraCosts}::numeric, extra_costs), updated_at = now()
      WHERE id = ${id}
    `);
    for (let copy = Number(current.copies) + 1; copy <= (data.copies ?? 0); copy += 1)
      await tx.execute(sql`INSERT INTO album_copies (album_id, copy_no, code, qr_token) VALUES (${id}, ${copy}, ${albumCopyCode(id, copy)}, ${token()}) ON CONFLICT DO NOTHING`);
    if (data.salePrice !== null && albumCents(data.salePrice) !== albumCents(current.sale_price)) {
      if (current.finance_mode !== "invoice" || !current.invoice_id) throw new AlbumError("سعر البيع يُحدد للألبوم ذي الفاتورة المستقلة فقط", 409, "CONFLICT", { salePrice: "مشمول بالباقة" });
      const invoice = first(await tx.execute(sql`SELECT id, paid_amount, status FROM sales_invoices WHERE id = ${current.invoice_id} FOR UPDATE`));
      if (!invoice || invoice.status !== "active") throw new AlbumError("فاتورة الألبوم غير فعالة", 409, "INVOICE_INVALID");
      const floor = albumCents(invoice.paid_amount) + (await pendingInvoicePayments(tx, Number(invoice.id)));
      if (albumCents(data.salePrice) < floor) throw new AlbumError(`لا يمكن أن يقل السعر عن المدفوع والمعلق (${centsToAmount(floor)})`, 409, "PAYMENT_INVALID", { salePrice: "أقل من المدفوع" });
      await tx.execute(sql`UPDATE sales_invoices SET subtotal = ${data.salePrice}, total = ${data.salePrice}, updated_at = now() WHERE id = ${invoice.id}`);
      await tx.execute(sql`UPDATE sales_invoice_items SET unit_price = ${data.salePrice}, total = ${data.salePrice} WHERE invoice_id = ${invoice.id}`);
      await tx.execute(sql`UPDATE album_orders SET sale_price = ${data.salePrice} WHERE id = ${id}`);
      await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: Number(invoice.id) });
    }
    await addEvent(tx, id, user, { type: "updated", note: priceChange ? "تعديل بيانات ومالية الألبوم" : "تعديل بيانات الألبوم" });
  });
  deps.audit("album_updated", id, { fields: Object.keys(raw).filter((key) => key !== "idempotencyKey") });
}

// ---------------------------------------------------------------------- stage

const STAGE_NOTICES: Partial<Record<string, { type: string; title: (no: string) => string }>> = {
  awaiting_approval: { type: "album_approval_required", title: (no) => `الألبوم ${no} بانتظار موافقة الزبون` },
  ready: { type: "album_ready", title: (no) => `الألبوم ${no} جاهز للتسليم` },
};

function canMoveStage(access: AlbumAccess, user: AlbumUser, row: Row, to: string) {
  if (to === "delivered") return false;
  // Album/photography staff update any stage; a portal-only employee moves the
  // album through the stages of the work assigned to them.
  if (access.manage || access.viewAll) return true;
  const mine = (field: string) => Number(row[field]) === user.id;
  return ALBUM_ROLES.some((role) => {
    const field = role.staffField.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
    return mine(field) && ((role.stages as readonly string[]).includes(to) || (role.stages as readonly string[]).includes(String(row.stage)));
  });
}

async function moveStage(id: number, raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  const to = String(raw.to ?? "");
  if (!isAlbumStage(to)) throw new AlbumError("المرحلة غير معروفة", 422, "VALIDATION_ERROR");
  if (to === "delivered") throw new AlbumError("التسليم يتم من نافذة التسليم بعد التحقق من المبلغ المتبقي", 409, "CONFLICT");
  const note = text(raw.note, 2000);
  const result = await db.transaction(async (tx) => {
    const row = await requireVisible(tx, id, access, user, { lock: true });
    if (row.status !== "active") throw new AlbumError("الألبوم ملغى", 409, "CONFLICT");
    if (row.stage === "delivered") throw new AlbumError("تم تسليم الألبوم؛ لا يمكن تغيير مرحلته", 409, "CONFLICT");
    if (!canMoveStage(access, user, row, to)) throw new AlbumError("لا تملك صلاحية نقل الألبوم إلى هذه المرحلة", 403, "PERMISSION_DENIED");
    if (row.stage === to) return { row, changed: false };
    // Going backwards needs a reason, so the history explains itself.
    if (albumStageIndex(to) < albumStageIndex(row.stage) && !note) throw new AlbumError("اكتب سبب إرجاع الألبوم لمرحلة سابقة", 422, "VALIDATION_ERROR", { note: "مطلوب عند الإرجاع" });
    await tx.execute(sql`UPDATE album_orders SET stage = ${to}, stage_changed_at = now(), updated_at = now() WHERE id = ${id}`);
    await addEvent(tx, id, user, { type: "stage", from: row.stage, to, note, attachments: raw.attachments });
    return { row, changed: true };
  });
  if (result.changed) {
    const notice = STAGE_NOTICES[to];
    if (notice) void deps.notify({ type: notice.type, title: notice.title(String(result.row.album_no)), body: String(result.row.customer_name ?? ""), entityType: "album_order", entityId: id, href: `/admin/albums?album=${id}` }).catch(() => {});
    if (to === "ready" && result.row.finance_mode === "invoice" && albumCents(result.row.invoice_remaining) > 0)
      void deps.notifyOnce({ type: "album_outstanding", title: `الألبوم ${result.row.album_no} جاهز وعليه مبلغ متبقٍ`, body: String(result.row.customer_name ?? ""), entityType: "album_order", entityId: id, href: `/admin/albums?album=${id}` }).catch(() => {});
    deps.audit("album_stage_changed", id, { from: result.row.stage, to });
  }
  return { changed: result.changed };
}

async function runAction(id: number, raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  const action = ALBUM_ACTIONS.find((item) => item.key === raw.action);
  if (!action) throw new AlbumError("الإجراء غير معروف", 422, "VALIDATION_ERROR");
  if (action.key === "deliver") throw new AlbumError("استخدم نافذة التسليم", 409, "CONFLICT");
  if (action.to) {
    const row = await requireVisible(db, id, access, user);
    if (!(action.from as readonly string[]).includes(String(row.stage)) && !access.manage)
      throw new AlbumError(`لا يمكن «${action.label}» والألبوم في مرحلة «${albumStageLabel(row.stage)}»`, 409, "CONFLICT");
    return moveStage(id, { to: action.to, note: text(raw.note, 2000) ?? action.label, attachments: raw.attachments }, user, access, deps);
  }
  const note = text(raw.note, 2000);
  const attachments = cleanAttachments(raw.attachments);
  if (action.key === "note" && !note) throw new AlbumError("اكتب الملاحظة", 422, "VALIDATION_ERROR", { note: "مطلوب" });
  if (action.key === "photo" && !attachments.length) throw new AlbumError("اختر صورة", 422, "VALIDATION_ERROR", { attachments: "مطلوب" });
  await db.transaction(async (tx) => {
    await requireVisible(tx, id, access, user, { lock: true });
    await addEvent(tx, id, user, { type: action.key, note, attachments });
  });
  return { changed: false };
}

// ------------------------------------------------------------------- delivery

async function deliver(id: number, raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  if (!access.deliver) throw new AlbumError("لا تملك صلاحية تسليم الألبومات", 403, "PERMISSION_DENIED");
  const receiver = text(raw.receiverName, 200);
  if (!receiver) throw new AlbumError("اكتب اسم المستلم", 422, "VALIDATION_ERROR", { receiverName: "مطلوب" });
  const photo = cleanAttachments(raw.photoUrl ? [{ url: raw.photoUrl }] : [])[0]?.url ?? null;
  const signature = cleanAttachments(raw.signatureUrl ? [{ url: raw.signatureUrl }] : [])[0]?.url ?? null;
  const result = await db.transaction(async (tx) => {
    const row = await loadAlbum(tx, id, { lock: true });
    if (row.status !== "active") throw new AlbumError("الألبوم ملغى", 409, "CONFLICT");
    if (row.stage === "delivered") throw new AlbumError(`تم تسليم الألبوم مسبقاً إلى ${row.delivered_to_name ?? "الزبون"}`, 409, "DUPLICATE");
    if (row.stage !== "ready") throw new AlbumError("الألبوم غير جاهز للتسليم بعد", 409, "CONFLICT");
    const outstanding = albumCents(moneyState(row).remainingAmount);
    // Same rule as the rest of AJN: handing over with money owed needs finance permission and an explicit confirmation.
    if (outstanding > 0 && !(raw.allowOutstanding === true && access.financials))
      throw new AlbumError(access.financials ? `على الزبون مبلغ متبقٍ ${centsToAmount(outstanding)}؛ أكّد التسليم مع المتبقي أو سجّل الدفعة أولاً` : "على الزبون مبلغ متبقٍ؛ راجع الحسابات قبل التسليم", 409, "PAYMENT_INVALID");
    await tx.execute(sql`
      UPDATE album_orders SET stage = 'delivered', stage_changed_at = now(), delivered_at = now(), delivered_to_name = ${receiver},
        delivery_photo_url = ${photo}, delivery_signature_url = ${signature}, delivered_by = ${user.id}, delivered_by_name = ${actorName(user)}, updated_at = now()
      WHERE id = ${id}
    `);
    // The unique partial index refuses a second delivery record even under a race.
    await addEvent(tx, id, user, {
      type: "delivered", from: row.stage, to: "delivered",
      note: [`استلمه: ${receiver}`, outstanding > 0 ? `سُلّم مع متبقٍ ${centsToAmount(outstanding)}` : "", text(raw.note, 1000) ?? ""].filter(Boolean).join(" — "),
      attachments: [photo, signature].filter(Boolean).map((url) => ({ url })),
    });
    return { row, outstanding };
  });
  deps.audit("album_delivered", id, { receiver, outstanding: centsToAmount(result.outstanding) });
  if (result.outstanding > 0)
    void deps.notify({ type: "album_outstanding", title: `سُلّم الألبوم ${result.row.album_no} وعليه متبقٍ`, body: `${result.row.customer_name} — ${centsToAmount(result.outstanding)}`, entityType: "album_order", entityId: id, href: `/admin/albums?album=${id}` }).catch(() => {});
  return { delivered: true };
}

// ------------------------------------------------------------------- payments

async function recordPayment(id: number, raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  if (!access.financials) throw new AlbumError("لا تملك صلاحية تسجيل دفعات الألبومات", 403, "PERMISSION_DENIED");
  const key = text(raw.idempotencyKey, 140);
  if (!key || key.length < 8) throw new AlbumError("مفتاح العملية مفقود؛ أعد المحاولة من النافذة", 422, "VALIDATION_ERROR");
  const cents = albumCents(raw.amount);
  if (cents <= 0) throw new AlbumError("المبلغ يجب أن يكون أكبر من صفر", 422, "VALIDATION_ERROR", { amount: "أكبر من صفر" });
  const method = ["cash", "transfer", "pos", "other"].includes(String(raw.method)) ? String(raw.method) : raw.method === "card" ? "pos" : "cash";
  const date = isoDate(raw.date) ?? baghdadToday();
  const transaction = await db.transaction(async (tx) => {
    const row = await loadAlbum(tx, id, { lock: true });
    if (row.finance_mode !== "invoice" || !row.invoice_id) throw new AlbumError(row.finance_mode === "package" ? "الألبوم مشمول بباقة الحجز؛ تُسجّل الدفعات على الحجز" : "لا يوجد مبلغ على هذا الألبوم", 409, "PAYMENT_INVALID");
    const invoice = first(await tx.execute(sql`SELECT id, invoice_no, status, customer_id, customer_name, customer_phone FROM sales_invoices WHERE id = ${row.invoice_id} FOR UPDATE`));
    if (!invoice || invoice.status !== "active") throw new AlbumError("فاتورة الألبوم غير فعالة", 409, "INVOICE_INVALID");
    const state = await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: Number(invoice.id) });
    const idempotencyKey = `album-payment:${id}:${key}`;
    const existing = first(await tx.execute(sql`SELECT id FROM financial_transactions WHERE idempotency_key = ${idempotencyKey}`));
    if (!existing) {
      const pending = await pendingInvoicePayments(tx, Number(invoice.id));
      const available = albumCents(state?.remainingAmount ?? row.invoice_remaining) - pending;
      if (cents > available) throw new AlbumError(`المبلغ أكبر من المتبقي بعد الدفعات المعلقة (${centsToAmount(Math.max(0, available))})`, 409, "PAYMENT_INVALID", { amount: "أكبر من المتبقي" });
    }
    // A pending cash-box request; the existing financial approval executes it
    // and reconciles the invoice. Same key → same transaction (no duplicate).
    return createAndExecuteSourceFinancialTransaction(tx, {
      direction: "revenue", amount: Number(centsToAmount(cents)), department: "photography", transactionType: "sales_invoice",
      description: `دفعة ألبوم ${row.album_no} — ${invoice.invoice_no}`, paymentMethod: method as "cash", transactionDate: date,
      sourceType: "sales_invoice", sourceId: String(invoice.id), sourceEvent: "payment", idempotencyKey,
      customerId: invoice.customer_id ?? row.customer_id ?? null, customerName: invoice.customer_name ?? row.customer_name, customerPhone: invoice.customer_phone ?? row.phone,
      notes: text(raw.notes, 1000), attachments: [],
    } as any, financialActor(user));
  });
  await db.transaction(async (tx) => addEvent(tx, id, user, { type: "payment_requested", note: `دفعة ${centsToAmount(cents)} بانتظار اعتماد الإدارة (${(transaction as Row).transactionNo ?? ""})` }));
  deps.audit("album_payment_requested", id, { transactionId: (transaction as Row).id, amount: centsToAmount(cents) });
  return { transactionId: Number((transaction as Row).id), transactionNo: (transaction as Row).transactionNo ?? null, approvalStatus: (transaction as Row).approvalStatus ?? "pending" };
}

// ------------------------------------------------------------------ materials

async function addMaterial(id: number, raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  if (!access.manage) throw new AlbumError("لا تملك صلاحية صرف مواد الألبوم", 403, "PERMISSION_DENIED");
  const productId = positiveId(raw.productId);
  const quantity = Number(raw.quantity);
  const requestKey = text(raw.requestKey, 120);
  if (!productId) throw new AlbumError("اختر المادة", 422, "VALIDATION_ERROR", { productId: "مطلوب" });
  if (!(quantity > 0 && quantity <= 100000)) throw new AlbumError("الكمية غير صالحة", 422, "VALIDATION_ERROR", { quantity: "أكبر من صفر" });
  if (!requestKey || requestKey.length < 8) throw new AlbumError("مفتاح العملية مفقود", 422, "VALIDATION_ERROR");
  const lineKey = `album-material:${id}:${requestKey}`;
  return db.transaction(async (tx) => {
    const row = await loadAlbum(tx, id, { lock: true });
    if (row.status !== "active") throw new AlbumError("الألبوم ملغى", 409, "CONFLICT");
    const existing = first(await tx.execute(sql`SELECT id FROM album_materials WHERE request_key = ${lineKey}`));
    if (existing) return { lineId: Number(existing.id), duplicate: true };
    const product = first(await tx.execute(sql`SELECT id, COALESCE(NULLIF(name_ar, ''), name) AS name, stock, cost_price, track_inventory FROM products WHERE id = ${productId} FOR UPDATE`));
    if (!product) throw new AlbumError("المادة غير موجودة في المخزون", 404, "NOT_FOUND");
    if (product.track_inventory !== false && Number(product.stock ?? 0) < quantity)
      throw new AlbumError(`الكمية المتاحة من «${product.name}» ${Number(product.stock ?? 0)} فقط`, 409, "STOCK_INSUFFICIENT", { quantity: "أكبر من المتاح" });
    const line = first(await tx.execute(sql`
      INSERT INTO album_materials (album_id, product_id, product_name, quantity, unit_cost, request_key, created_by, created_by_name)
      VALUES (${id}, ${productId}, ${String(product.name)}, ${quantity}, ${centsToAmount(albumCents(product.cost_price))}, ${lineKey}, ${user.id}, ${actorName(user)})
      RETURNING id
    `));
    const lineId = Number(line!.id);
    if (product.track_inventory !== false)
      await deps.adjustStock(productId, -quantity, {
        reason: "album_material_consumed", relatedType: "album_order", relatedId: id, movementType: "album_material",
        idempotencyKey: `${lineKey}:out`, metadata: { albumId: id, albumNo: row.album_no, lineId, quantity },
        createdBy: user.id, createdByName: actorName(user),
      }, tx);
    await addEvent(tx, id, user, { type: "material", note: `صرف ${quantity} × ${product.name} من المخزون` });
    return { lineId, duplicate: false };
  });
}

async function returnMaterial(id: number, lineId: number, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  if (!access.manage) throw new AlbumError("لا تملك صلاحية إرجاع مواد الألبوم", 403, "PERMISSION_DENIED");
  return db.transaction(async (tx) => {
    const line = first(await tx.execute(sql`SELECT m.*, p.track_inventory, a.album_no FROM album_materials m JOIN products p ON p.id = m.product_id JOIN album_orders a ON a.id = m.album_id WHERE m.id = ${lineId} AND m.album_id = ${id} FOR UPDATE OF m`));
    if (!line) throw new AlbumError("سطر المادة غير موجود", 404, "NOT_FOUND");
    if (line.returned_at) return { returned: true, duplicate: true };
    await tx.execute(sql`UPDATE album_materials SET returned_at = now(), returned_by = ${user.id} WHERE id = ${lineId}`);
    if (line.track_inventory !== false)
      await deps.adjustStock(Number(line.product_id), Number(line.quantity), {
        reason: "album_material_returned", relatedType: "album_order", relatedId: id, movementType: "album_material_return",
        idempotencyKey: `${line.request_key}:return`, metadata: { albumId: id, albumNo: line.album_no, lineId },
        createdBy: user.id, createdByName: actorName(user),
      }, tx);
    await addEvent(tx, id, user, { type: "material", note: `إرجاع ${Number(line.quantity)} × ${line.product_name} إلى المخزون` });
    return { returned: true, duplicate: false };
  });
}

// ----------------------------------------------------------------- assignment

const ROLE_TEMPLATE: Record<AlbumRole, { templateKey: string | null; department: string }> = {
  design: { templateKey: "album_design", department: "editing" },
  printing: { templateKey: "printing", department: "printing" },
  binding: { templateKey: null, department: "printing" },
  quality: { templateKey: null, department: "photography" },
};

async function assign(id: number, raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  if (!access.manage) throw new AlbumError("لا تملك صلاحية توزيع مهام الألبوم", 403, "PERMISSION_DENIED");
  const role = ALBUM_ROLES.find((item) => item.key === raw.role);
  const staffId = positiveId(raw.staffId);
  if (!role) throw new AlbumError("المهمة غير معروفة", 422, "VALIDATION_ERROR", { role: "اختر المهمة" });
  if (!staffId) throw new AlbumError("اختر الموظف", 422, "VALIDATION_ERROR", { staffId: "مطلوب" });
  const column = { design: sql`designer_staff_id`, printing: sql`printer_staff_id`, binding: sql`binder_staff_id`, quality: sql`quality_staff_id` }[role.key];
  const assigned = await db.transaction(async (tx) => {
    const row = await loadAlbum(tx, id, { lock: true });
    if (row.status !== "active" || row.stage === "delivered") throw new AlbumError("لا يمكن التكليف على ألبوم مسلّم أو ملغى", 409, "CONFLICT");
    const staff = first(await tx.execute(sql`SELECT id, COALESCE(NULLIF(full_name, ''), username) AS name FROM staff WHERE id = ${staffId} AND is_active = true`));
    if (!staff) throw new AlbumError("الموظف غير نشط أو غير موجود", 422, "VALIDATION_ERROR", { staffId: "غير نشط" });
    await tx.execute(sql`UPDATE album_orders SET ${column} = ${staffId}, updated_at = now() WHERE id = ${id}`);
    const task = first(await tx.execute(sql`INSERT INTO album_tasks (album_id, role, staff_id, created_by) VALUES (${id}, ${role.key}, ${staffId}, ${user.id}) RETURNING id`));
    await addEvent(tx, id, user, { type: "assigned", note: `${role.label}: ${staff.name}` });
    return { row, staffName: String(staff.name), albumTaskId: Number(task!.id) };
  });
  // The Work Commands order is created after the album commit so a refusal there
  // never undoes the assignment; the refusal is reported, not hidden.
  let workOrder: { taskId: number | null; warning: string | null } = { taskId: null, warning: null };
  try {
    const template = ROLE_TEMPLATE[role.key];
    const created = await deps.createWorkTask(user, {
      title: `${role.label} ألبوم ${assigned.row.album_no} — ${assigned.row.customer_name}`,
      description: [`${assigned.row.album_type} ${assigned.row.album_size}`, assigned.row.page_count ? `${assigned.row.page_count} صفحة` : "", assigned.row.cover_names ? `الأسماء على الغلاف: ${assigned.row.cover_names}` : ""].filter(Boolean).join(" · "),
      templateKey: template.templateKey, department: template.department, assigneeId: staffId,
      dueAt: assigned.row.due_date ? `${String(assigned.row.due_date).slice(0, 10)}T12:00:00` : null,
      customerId: assigned.row.customer_id == null ? null : Number(assigned.row.customer_id), bookingId: assigned.row.booking_id == null ? null : Number(assigned.row.booking_id),
      sourceId: assigned.albumTaskId, idempotencyKey: `album-task:${assigned.albumTaskId}`,
    });
    await db.execute(sql`UPDATE album_tasks SET task_id = ${created.taskId} WHERE id = ${assigned.albumTaskId}`);
    workOrder = { taskId: created.taskId, warning: null };
  } catch (error) {
    workOrder = { taskId: null, warning: `تم التكليف، لكن لم يُنشأ أمر عمل في مركز الأوامر: ${error instanceof Error ? error.message : "خطأ غير معروف"}` };
    console.error("album work order not created", { albumId: id, role: role.key, error: safeServerError(error) });
  }
  void deps.notify({ audienceType: "staff", staffId, type: "album_assigned", title: `أُسند إليك ${role.label} الألبوم ${assigned.row.album_no}`, body: String(assigned.row.customer_name ?? ""), entityType: "album_order", entityId: id, href: "/staff/photography/albums" }).catch(() => {});
  deps.audit("album_assigned", id, { role: role.key, staffId, workTaskId: workOrder.taskId });
  return { assigned: true, staffName: assigned.staffName, ...workOrder };
}

// --------------------------------------------------------------------- cancel

async function cancel(id: number, raw: Row, user: AlbumUser, access: AlbumAccess, deps: AlbumDeps) {
  if (!access.manage) throw new AlbumError("لا تملك صلاحية إلغاء الألبومات", 403, "PERMISSION_DENIED");
  const reason = text(raw.reason, 500);
  if (!reason) throw new AlbumError("اكتب سبب الإلغاء", 422, "VALIDATION_ERROR", { reason: "مطلوب" });
  await db.transaction(async (tx) => {
    const row = await loadAlbum(tx, id, { lock: true });
    if (row.status === "cancelled") return;
    if (row.stage === "delivered") throw new AlbumError("لا يمكن إلغاء ألبوم مسلّم", 409, "CONFLICT");
    if (row.invoice_id) {
      const invoice = first(await tx.execute(sql`SELECT id, paid_amount, status FROM sales_invoices WHERE id = ${row.invoice_id} FOR UPDATE`));
      const pending = await pendingInvoicePayments(tx, Number(row.invoice_id));
      // Money already received is never silently dropped: refund it through accounting first.
      if (invoice && (albumCents(invoice.paid_amount) > 0 || pending > 0)) throw new AlbumError("على الألبوم دفعات مسجلة أو معلقة؛ عالجها من الحسابات قبل الإلغاء", 409, "PAYMENT_INVALID");
      if (invoice && invoice.status === "active") {
        await tx.execute(sql`UPDATE sales_invoices SET status = 'cancelled', updated_at = now() WHERE id = ${invoice.id}`);
        await reconcilePaymentState(tx, { sourceType: "sales_invoice", sourceId: Number(invoice.id) });
      }
    }
    const open = first(await tx.execute(sql`SELECT COUNT(*)::int AS count FROM album_materials WHERE album_id = ${id} AND returned_at IS NULL`));
    if (Number(open?.count ?? 0) > 0) throw new AlbumError("أرجع المواد المصروفة للمخزون أولاً أو احتفظ بها كمصروف قبل الإلغاء", 409, "CONFLICT");
    await tx.execute(sql`UPDATE album_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${user.id}, cancel_reason = ${reason}, updated_at = now() WHERE id = ${id}`);
    await addEvent(tx, id, user, { type: "cancelled", note: reason });
  });
  deps.audit("album_cancelled", id, { reason });
}

// ---------------------------------------------------------------- list & read

type ListFilters = { q: string; bucket: AlbumBucket | "delayed" | ""; stage: string; type: string; staffId: number | null; from: string | null; to: string | null; status: string; page: number; pageSize: number };
function parseFilters(params: URLSearchParams): ListFilters {
  const bucket = String(params.get("bucket") ?? "");
  return {
    q: String(params.get("q") ?? "").trim().slice(0, 100),
    bucket: (bucket in ALBUM_STAGE_BUCKETS || bucket === "delayed" ? bucket : "") as ListFilters["bucket"],
    stage: isAlbumStage(params.get("stage")) ? String(params.get("stage")) : "",
    type: String(params.get("type") ?? "").trim().slice(0, 120),
    staffId: positiveId(params.get("staffId")),
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(params.get("from"))) ? String(params.get("from")) : null,
    to: /^\d{4}-\d{2}-\d{2}$/.test(String(params.get("to"))) ? String(params.get("to")) : null,
    status: params.get("status") === "cancelled" ? "cancelled" : "active",
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: Math.min(100, Math.max(10, Number(params.get("pageSize")) || 25)),
  };
}

function filterSql(filters: ListFilters, access: AlbumAccess, userId: number, options: { ignoreBucket?: boolean } = {}) {
  const today = baghdadToday();
  const parts = [sql`a.status = ${filters.status}`, scopeCondition(access, userId)];
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const digits = filters.q.replace(/\D/g, "");
    parts.push(sql`(a.album_no ILIKE ${like} OR a.customer_name ILIKE ${like} OR a.barcode_value ILIKE ${like} OR COALESCE(so.tracking_code, '') ILIKE ${like}
      OR CAST(a.booking_id AS text) = ${filters.q.replace(/^B-?/i, "")} ${digits.length >= 4 ? sql`OR regexp_replace(a.phone, '\\D', '', 'g') LIKE ${`%${digits.slice(-9)}%`}` : sql``})`);
  }
  if (filters.stage) parts.push(sql`a.stage = ${filters.stage}`);
  if (filters.type) parts.push(sql`a.album_type = ${filters.type}`);
  if (filters.staffId) parts.push(sql`(a.designer_staff_id = ${filters.staffId} OR a.printer_staff_id = ${filters.staffId} OR a.binder_staff_id = ${filters.staffId} OR a.quality_staff_id = ${filters.staffId})`);
  if (filters.from) parts.push(sql`a.order_date >= ${filters.from}`);
  if (filters.to) parts.push(sql`a.order_date <= ${filters.to}`);
  if (!options.ignoreBucket && filters.bucket === "delayed") parts.push(sql`a.due_date < ${today} AND a.stage NOT IN ('ready', 'delivered')`);
  else if (!options.ignoreBucket && filters.bucket) {
    const stages: readonly string[] = ALBUM_STAGE_BUCKETS[filters.bucket as AlbumBucket];
    parts.push(sql`a.stage IN (${sql.join(stages.map((stage) => sql`${stage}`), sql`, `)})`);
  }
  return sql.join(parts, sql` AND `);
}

async function listAlbums(params: URLSearchParams, user: AlbumUser, access: AlbumAccess) {
  const filters = parseFilters(params);
  const today = baghdadToday();
  const where = filterSql(filters, access, user.id);
  const summaryWhere = filterSql({ ...filters, status: "active" }, access, user.id, { ignoreBucket: true });
  const bucketCase = (bucket: AlbumBucket) => sql`COUNT(*) FILTER (WHERE a.stage IN (${sql.join(ALBUM_STAGE_BUCKETS[bucket].map((stage) => sql`${stage}`), sql`, `)}))::int`;
  const [list, total, summary] = await Promise.all([
    db.execute(sql`SELECT ${ALBUM_SELECT} FROM ${ALBUM_FROM} WHERE ${where}
      ORDER BY (a.stage = 'delivered'), (a.due_date IS NULL), a.due_date, a.id DESC
      LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM ${ALBUM_FROM} WHERE ${where}`),
    db.execute(sql`SELECT COUNT(*)::int AS total,
      ${bucketCase("waitingSelection")} AS waiting_selection, ${bucketCase("designing")} AS designing, ${bucketCase("production")} AS production,
      ${bucketCase("ready")} AS ready, ${bucketCase("delivered")} AS delivered,
      COUNT(*) FILTER (WHERE a.due_date < ${today} AND a.stage NOT IN ('ready', 'delivered'))::int AS delayed
      FROM ${ALBUM_FROM} WHERE ${summaryWhere}`),
  ]);
  const counts = first(summary) ?? {};
  return {
    albums: rows(list).map((row) => serializeAlbum(row, access, today)),
    total: Number(first(total)?.count ?? 0),
    page: filters.page,
    pageSize: filters.pageSize,
    summary: {
      total: Number(counts.total ?? 0), waitingSelection: Number(counts.waiting_selection ?? 0), designing: Number(counts.designing ?? 0),
      production: Number(counts.production ?? 0), ready: Number(counts.ready ?? 0), delivered: Number(counts.delivered ?? 0), delayed: Number(counts.delayed ?? 0),
    },
  };
}

async function albumDetail(id: number, user: AlbumUser, access: AlbumAccess) {
  const row = await requireVisible(db, id, access, user);
  const [events, copies, materials, tasks] = await Promise.all([
    db.execute(sql`SELECT * FROM album_order_events WHERE album_id = ${id} ORDER BY created_at, id`),
    db.execute(sql`SELECT id, copy_no, code, qr_token FROM album_copies WHERE album_id = ${id} ORDER BY copy_no`),
    db.execute(sql`SELECT m.*, p.stock AS product_stock FROM album_materials m LEFT JOIN products p ON p.id = m.product_id WHERE m.album_id = ${id} ORDER BY m.id`),
    db.execute(sql`
      SELECT t.id, t.role, t.staff_id, t.task_id, t.created_at, COALESCE(NULLIF(s.full_name, ''), s.username) AS staff_name,
        tk.status AS task_status, COALESCE(tk.task_no, CASE WHEN t.task_id IS NULL THEN NULL ELSE 'TSK-' || lpad(t.task_id::text, 6, '0') END) AS order_no
      FROM album_tasks t JOIN staff s ON s.id = t.staff_id
      LEFT JOIN tasks tk ON tk.id = t.task_id
      WHERE t.album_id = ${id} ORDER BY t.id
    `).catch((error) => {
      // Work Commands tables are optional on an install that never enabled them.
      if (isUndefinedTable(error)) return db.execute(sql`SELECT t.id, t.role, t.staff_id, t.task_id, t.created_at, COALESCE(NULLIF(s.full_name, ''), s.username) AS staff_name, NULL AS task_status, NULL AS order_no FROM album_tasks t JOIN staff s ON s.id = t.staff_id WHERE t.album_id = ${id} ORDER BY t.id`);
      throw error;
    }),
  ]);
  const album = serializeAlbum(row, access);
  const pending = access.financials && row.invoice_id ? centsToAmount(await pendingInvoicePayments(db, Number(row.invoice_id))) : null;
  const materialRows = rows(materials).map((line) => ({
    id: Number(line.id), productId: Number(line.product_id), productName: String(line.product_name), quantity: Number(line.quantity),
    ...(access.financials ? { unitCost: centsToAmount(albumCents(line.unit_cost)) } : {}),
    returnedAt: line.returned_at ?? null, createdByName: line.created_by_name ?? null, createdAt: line.created_at,
  }));
  return {
    album: { ...album, ...(pending !== null ? { pendingAmount: pending } : {}) },
    events: rows(events).map((event) => ({
      id: Number(event.id), type: String(event.type), fromStage: event.from_stage ?? null, toStage: event.to_stage ?? null, note: event.note ?? null,
      attachments: Array.isArray(event.attachments) ? event.attachments : [], staffName: String(event.staff_name ?? ""), createdAt: event.created_at,
    })),
    copies: rows(copies).map((copy) => ({ id: Number(copy.id), copyNo: Number(copy.copy_no), code: String(copy.code), qrToken: String(copy.qr_token) })),
    materials: materialRows,
    materialsCost: access.financials ? centsToAmount(materialRows.filter((line) => !line.returnedAt).reduce((sum, line) => sum + Math.round(albumCents((line as Row).unitCost) * line.quantity), 0)) : null,
    tasks: rows(tasks).map((task) => ({ id: Number(task.id), role: String(task.role), staffId: Number(task.staff_id), staffName: String(task.staff_name), workTaskId: task.task_id == null ? null : Number(task.task_id), workOrderNo: task.order_no ?? null, workStatus: task.task_status ?? null, createdAt: task.created_at })),
    actions: albumActionsFor(String(row.stage), String(row.status)).map((action) => ({ key: action.key, label: action.label, to: action.to })),
  };
}

/** Scanner: album number, barcode, QR token or a copy's code. Never searches by customer data. */
async function scan(code: string, user: AlbumUser, access: AlbumAccess) {
  const raw = code.trim();
  let value = raw;
  try {
    const url = new URL(raw);
    value = url.searchParams.get("scan") ?? url.searchParams.get("album") ?? raw;
  } catch { /* not a link */ }
  value = value.trim().slice(0, 120);
  if (!value) throw new AlbumError("الرمز فارغ", 422, "VALIDATION_ERROR");
  const upper = value.toUpperCase();
  const match = first(await db.execute(sql`
    SELECT a.id, NULL::int AS copy_no FROM album_orders a WHERE a.qr_token = ${value} OR UPPER(a.album_no) = ${upper} OR UPPER(a.barcode_value) = ${upper}
    UNION ALL
    SELECT c.album_id AS id, c.copy_no FROM album_copies c WHERE c.qr_token = ${value} OR UPPER(c.code) = ${upper}
    LIMIT 1
  `));
  if (!match) throw new AlbumError("لم يُعثر على ألبوم بهذا الرمز", 404, "NOT_FOUND");
  const detail = await albumDetail(Number(match.id), user, access);
  return { ...detail, scannedCopy: match.copy_no == null ? null : Number(match.copy_no) };
}

// -------------------------------------------------------------------- reports

async function reports(params: URLSearchParams, user: AlbumUser, access: AlbumAccess) {
  if (!access.viewAll) throw new AlbumError("لا تملك صلاحية تقارير الألبومات", 403, "PERMISSION_DENIED");
  const today = baghdadToday();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get("from"))) ? String(params.get("from")) : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get("to"))) ? String(params.get("to")) : today;
  const [daily, monthly, status, staff, money, outstanding] = await Promise.all([
    db.execute(sql`SELECT order_date::text AS day, COUNT(*)::int AS count FROM album_orders WHERE status = 'active' AND order_date BETWEEN ${from} AND ${to} GROUP BY order_date ORDER BY order_date`),
    db.execute(sql`SELECT to_char(order_date, 'YYYY-MM') AS month, COUNT(*)::int AS count FROM album_orders WHERE status = 'active' AND order_date >= (${to}::date - interval '11 months') AND order_date <= ${to} GROUP BY 1 ORDER BY 1`),
    db.execute(sql`SELECT
        COUNT(*) FILTER (WHERE stage = 'delivered')::int AS completed,
        COUNT(*) FILTER (WHERE stage = 'delivered' AND delivered_at::date > due_date)::int AS completed_late,
        COUNT(*) FILTER (WHERE due_date < ${today} AND stage NOT IN ('ready', 'delivered'))::int AS delayed,
        COUNT(*)::int AS total
      FROM album_orders WHERE status = 'active' AND order_date BETWEEN ${from} AND ${to}`),
    db.execute(sql`SELECT e.staff_id, MAX(e.staff_name) AS staff_name,
        COUNT(*) FILTER (WHERE e.type = 'stage')::int AS stage_moves,
        COUNT(*) FILTER (WHERE e.type = 'stage' AND e.to_stage = 'awaiting_approval')::int AS designs,
        COUNT(*) FILTER (WHERE e.type = 'stage' AND e.to_stage = 'binding')::int AS prints,
        COUNT(*) FILTER (WHERE e.type = 'stage' AND e.to_stage = 'quality')::int AS bindings,
        COUNT(*) FILTER (WHERE e.type = 'stage' AND e.to_stage = 'ready')::int AS quality_checks,
        COUNT(*) FILTER (WHERE e.type = 'delivered')::int AS deliveries
      FROM album_order_events e JOIN album_orders a ON a.id = e.album_id
      WHERE a.status = 'active' AND e.staff_id IS NOT NULL AND e.created_at::date BETWEEN ${from} AND ${to}
      GROUP BY e.staff_id ORDER BY stage_moves DESC LIMIT 50`),
    access.financials ? db.execute(sql`SELECT
        COALESCE(SUM(CASE WHEN a.finance_mode = 'invoice' AND COALESCE(si.status, 'active') <> 'cancelled' THEN a.sale_price ELSE 0 END), 0) AS sales,
        COALESCE(SUM(a.design_cost), 0) AS design, COALESCE(SUM(a.printing_cost), 0) AS printing, COALESCE(SUM(a.cover_cost), 0) AS cover,
        COALESCE(SUM(a.binding_cost), 0) AS binding, COALESCE(SUM(a.extra_costs), 0) AS extra,
        COUNT(*) FILTER (WHERE a.finance_mode = 'package')::int AS package_albums
      FROM album_orders a LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      WHERE a.status = 'active' AND a.order_date BETWEEN ${from} AND ${to}`) : Promise.resolve(null),
    access.financials ? db.execute(sql`SELECT a.id, a.album_no, a.customer_name, a.phone, a.stage, si.invoice_no, si.remaining_amount
      FROM album_orders a JOIN sales_invoices si ON si.id = a.invoice_id
      WHERE a.status = 'active' AND a.finance_mode = 'invoice' AND si.status = 'active' AND si.remaining_amount > 0
      ORDER BY si.remaining_amount DESC LIMIT 100`) : Promise.resolve(null),
  ]);
  const counts = first(status) ?? {};
  const totals = money ? first(money) ?? {} : null;
  const costCents = totals ? ["design", "printing", "cover", "binding", "extra"].reduce((sum, key) => sum + albumCents(totals[key]), 0) : 0;
  return {
    from, to,
    daily: rows(daily).map((row) => ({ day: String(row.day), count: Number(row.count) })),
    monthly: rows(monthly).map((row) => ({ month: String(row.month), count: Number(row.count) })),
    status: { total: Number(counts.total ?? 0), completed: Number(counts.completed ?? 0), completedLate: Number(counts.completed_late ?? 0), delayed: Number(counts.delayed ?? 0) },
    staff: rows(staff).map((row) => ({ staffId: Number(row.staff_id), staffName: String(row.staff_name ?? ""), stageMoves: Number(row.stage_moves), designs: Number(row.designs), prints: Number(row.prints), bindings: Number(row.bindings), qualityChecks: Number(row.quality_checks), deliveries: Number(row.deliveries) })),
    ...(totals ? {
      finance: {
        sales: centsToAmount(albumCents(totals.sales)),
        costs: { design: centsToAmount(albumCents(totals.design)), printing: centsToAmount(albumCents(totals.printing)), cover: centsToAmount(albumCents(totals.cover)), binding: centsToAmount(albumCents(totals.binding)), extra: centsToAmount(albumCents(totals.extra)) },
        totalCost: centsToAmount(costCents),
        netProfit: centsToAmount(albumCents(totals.sales) - costCents),
        packageAlbums: Number(totals.package_albums ?? 0),
      },
      outstanding: rows(outstanding).map((row) => ({ id: Number(row.id), albumNo: String(row.album_no), customerName: String(row.customer_name), phone: String(row.phone ?? ""), stage: String(row.stage), invoiceNo: row.invoice_no, remainingAmount: centsToAmount(albumCents(row.remaining_amount)) })),
    } : {}),
  };
}

// ------------------------------------------------------------------- lookups

async function searchBookings(q: string) {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const digits = term.replace(/\D/g, "");
  const list = rows(await db.execute(sql`
    SELECT so.id, so.tracking_code, so.customer_id, so.customer_name, so.phone, so.event_date, so.status,
      EXISTS (SELECT 1 FROM photography_production_items pi WHERE pi.booking_id = so.id AND pi.kind = 'album') AS album_included,
      (SELECT COUNT(*)::int FROM album_orders ao WHERE ao.booking_id = so.id AND ao.status = 'active') AS album_orders
    FROM service_orders so
    WHERE so.archived_at IS NULL AND (so.customer_name ILIKE ${like} OR COALESCE(so.tracking_code, '') ILIKE ${like} OR CAST(so.id AS text) = ${term.replace(/^B-?/i, "")}
      ${digits.length >= 4 ? sql`OR regexp_replace(so.phone, '\\D', '', 'g') LIKE ${`%${digits.slice(-9)}%`}` : sql``})
    ORDER BY so.id DESC LIMIT 12
  `));
  return list.map((row) => ({ id: Number(row.id), code: row.tracking_code ?? `B-${row.id}`, customerId: row.customer_id == null ? null : Number(row.customer_id), customerName: String(row.customer_name ?? ""), phone: String(row.phone ?? ""), eventDate: row.event_date ?? null, status: String(row.status ?? ""), albumIncluded: Boolean(row.album_included), albumOrders: Number(row.album_orders ?? 0) }));
}

async function searchCustomers(q: string) {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const digits = term.replace(/\D/g, "");
  return rows(await db.execute(sql`
    SELECT id, COALESCE(NULLIF(full_name, ''), NULLIF(name, ''), phone) AS name, phone FROM customers
    WHERE COALESCE(full_name, name, '') ILIKE ${like} ${digits.length >= 4 ? sql`OR regexp_replace(phone, '\\D', '', 'g') LIKE ${`%${digits.slice(-9)}%`}` : sql``}
    ORDER BY id DESC LIMIT 10
  `)).map((row) => ({ id: Number(row.id), name: String(row.name ?? ""), phone: String(row.phone ?? "") }));
}

async function searchProducts(q: string) {
  const term = q.trim().slice(0, 80);
  if (term.length < 1) return [];
  const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return rows(await db.execute(sql`
    SELECT id, COALESCE(NULLIF(name_ar, ''), name) AS name, barcode, stock, track_inventory FROM products
    WHERE (name ILIKE ${like} OR COALESCE(name_ar, '') ILIKE ${like} OR COALESCE(barcode, '') = ${term}) ORDER BY 2 LIMIT 15
  `)).map((row) => ({ id: Number(row.id), name: String(row.name), barcode: row.barcode ?? null, stock: Number(row.stock ?? 0), trackInventory: row.track_inventory !== false }));
}

async function staffList() {
  return rows(await db.execute(sql`
    SELECT id, COALESCE(NULLIF(full_name, ''), username) AS name, role, department FROM staff WHERE is_active = true ORDER BY name LIMIT 300
  `)).map((row) => ({ id: Number(row.id), name: String(row.name), role: String(row.role ?? ""), department: row.department ?? null }));
}

// --------------------------------------------------------------- deadlines

export type AlbumDeadlineAlert = { id: number; albumNo: string; customerName: string; dueDate: string; stage: string; daysLate: number };
/** Albums past their delivery date and not ready — for the periodic notifications. */
export async function albumDeadlineAlerts(today = baghdadToday()): Promise<AlbumDeadlineAlert[]> {
  try {
    return rows(await db.execute(sql`
      SELECT id, album_no, customer_name, due_date::text AS due_date, stage, (${today}::date - due_date)::int AS days_late
      FROM album_orders WHERE status = 'active' AND due_date < ${today} AND stage NOT IN ('ready', 'delivered') ORDER BY due_date LIMIT 50
    `)).map((row) => ({ id: Number(row.id), albumNo: String(row.album_no), customerName: String(row.customer_name), dueDate: String(row.due_date), stage: String(row.stage), daysLate: Number(row.days_late) }));
  } catch (error) {
    // Before migration 0141 is applied there is simply nothing to report.
    if (isUndefinedTable(error)) return [];
    throw error;
  }
}

// ------------------------------------------------------------------- router

export async function handleAlbums(req: NextRequest, parts: string[], user: AlbumUser, deps: AlbumDeps): Promise<NextResponse> {
  const requestId = makeRequestId(req.headers.get("x-request-id"));
  const respond = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "x-request-id": requestId, "Cache-Control": "private, no-store" } });
  const fail = (message: string, status = 400, code?: ApiErrorCode, fieldErrors?: Record<string, string>) =>
    respond(createApiErrorPayload({ requestId, status, code, message, fieldErrors }), status);
  const access = albumAccess(user);
  if (!access.work) return fail("ليس لديك صلاحية إدارة الألبومات", 403, "PERMISSION_DENIED");
  const method = req.method;
  const [resource, sub, subId, subAction] = [parts[2] ?? "", parts[3] ?? "", parts[4] ?? "", parts[5] ?? ""];
  const body = async (): Promise<Row> => {
    try {
      const parsed = await req.json();
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new AlbumError("بيانات الطلب غير صالحة", 400, "VALIDATION_ERROR");
    }
  };
  try {
    if (!resource && method === "GET") return respond({ ...(await listAlbums(req.nextUrl.searchParams, user, access)), access });
    if (!resource && method === "POST") {
      const created = await createAlbum(await body(), user, access, deps);
      return respond({ ...(await albumDetail(created.id, user, access)), duplicate: created.duplicate }, created.duplicate ? 200 : 201);
    }
    if (resource === "meta" && method === "GET")
      return respond({ access, catalog: await catalog(db), staff: await staffList(), today: baghdadToday() });
    if (resource === "scan" && method === "GET") return respond(await scan(String(req.nextUrl.searchParams.get("code") ?? ""), user, access));
    if (resource === "reports" && method === "GET") return respond(await reports(req.nextUrl.searchParams, user, access));
    if (resource === "bookings" && method === "GET") {
      if (!access.manage) return fail("لا تملك صلاحية ربط الحجوزات", 403, "PERMISSION_DENIED");
      return respond({ bookings: await searchBookings(String(req.nextUrl.searchParams.get("q") ?? "")) });
    }
    if (resource === "customers" && method === "GET") {
      if (!access.manage) return fail("لا تملك صلاحية البحث عن الزبائن", 403, "PERMISSION_DENIED");
      return respond({ customers: await searchCustomers(String(req.nextUrl.searchParams.get("q") ?? "")) });
    }
    if (resource === "products" && method === "GET") {
      if (!access.manage) return fail("لا تملك صلاحية المخزون", 403, "PERMISSION_DENIED");
      return respond({ products: await searchProducts(String(req.nextUrl.searchParams.get("q") ?? "")) });
    }
    if (resource === "settings") {
      if (method === "GET") return respond({ catalog: await catalog(db, true), canEdit: access.manage, canSeeMoney: access.financials });
      if (!access.manage) return fail("لا تملك صلاحية إعدادات الألبومات", 403, "PERMISSION_DENIED");
      if (method === "POST" && sub === "presets") {
        const existing = new Set((await catalog(db, true)).map((option) => `${option.kind}:${option.label.toLowerCase()}`));
        let added = 0;
        for (const option of ALBUM_SUGGESTED_OPTIONS) {
          if (existing.has(`${option.kind}:${option.label.toLowerCase()}`)) continue;
          await saveOption(db, user, { kind: option.kind, label: option.label });
          added += 1;
        }
        deps.audit("album_settings_presets", 0, { added });
        return respond({ added, catalog: await catalog(db, true) });
      }
      const raw = await body();
      if (!access.financials && (raw.defaultPrice !== undefined || raw.manufacturingCost !== undefined))
        return fail("لا تملك صلاحية أسعار وتكاليف الألبومات", 403, "PERMISSION_DENIED");
      if (method === "POST" && !sub) {
        const id = await saveOption(db, user, raw);
        deps.audit("album_setting_created", id, { kind: raw.kind, label: raw.label });
        return respond({ id, catalog: await catalog(db, true) }, 201);
      }
      const optionId = positiveId(sub);
      if (method === "PATCH" && optionId) {
        await saveOption(db, user, raw, optionId);
        deps.audit("album_setting_updated", optionId, { fields: Object.keys(raw) });
        return respond({ id: optionId, catalog: await catalog(db, true) });
      }
    }
    const id = positiveId(resource);
    if (id) {
      if (!sub && method === "GET") return respond(await albumDetail(id, user, access));
      if (!sub && method === "PATCH") {
        await updateAlbum(id, await body(), user, access, deps);
        return respond(await albumDetail(id, user, access));
      }
      if (method === "POST") {
        const raw = sub === "materials" && subId && subAction === "return" ? {} : await body();
        if (sub === "stage") await moveStage(id, raw, user, access, deps);
        else if (sub === "action") await runAction(id, raw, user, access, deps);
        else if (sub === "deliver") await deliver(id, raw, user, access, deps);
        else if (sub === "cancel") await cancel(id, raw, user, access, deps);
        else if (sub === "assign") {
          const result = await assign(id, raw, user, access, deps);
          return respond({ ...(await albumDetail(id, user, access)), assignment: result });
        } else if (sub === "payments") {
          const payment = await recordPayment(id, raw, user, access, deps);
          return respond({ ...(await albumDetail(id, user, access)), payment }, 201);
        } else if (sub === "materials" && !subId) {
          const line = await addMaterial(id, raw, user, access, deps);
          return respond({ ...(await albumDetail(id, user, access)), material: line }, line.duplicate ? 200 : 201);
        } else if (sub === "materials" && positiveId(subId) && subAction === "return") await returnMaterial(id, positiveId(subId)!, user, access, deps);
        else return fail("المسار غير موجود", 404, "NOT_FOUND");
        return respond(await albumDetail(id, user, access));
      }
    }
    return fail("المسار غير موجود", 404, "NOT_FOUND");
  } catch (error) {
    if (error instanceof AlbumError) return fail(error.message, error.status, error.code, error.fieldErrors);
    if (isUndefinedTable(error)) return fail("وحدة الألبومات تحتاج تطبيق ترحيل قاعدة البيانات 0141_album_management", 503, "DATABASE_ERROR");
    const unique = (error as Row)?.code === "23505" || (error as Row)?.cause?.code === "23505";
    if (unique && String((error as Row)?.constraint ?? (error as Row)?.cause?.constraint ?? "").includes("one_delivery"))
      return fail("تم تسليم الألبوم مسبقاً", 409, "DUPLICATE");
    const mapped = mapWriteError(error);
    console.error("album request failed", { requestId, method, path: parts.join("/"), userId: user.id, error: safeServerError(error) });
    return respond(createApiErrorPayload({ requestId, status: mapped.status, code: mapped.code, message: mapped.message }), mapped.status);
  }
}
