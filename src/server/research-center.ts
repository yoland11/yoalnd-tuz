import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { readRequestBody } from "@/server/request-body";
import {
  adminActivityLogsTable,
  customersTable,
  db,
  entityTimelineTable,
  financialLedgerEntriesTable,
  financialTransactionsTable,
  notificationsTable,
  researchAiGenerationsTable,
  researchAssignmentsTable,
  researchChapterVersionsTable,
  researchChaptersTable,
  researchCitationsTable,
  researchFilesTable,
  researchMessagesTable,
  researchOrderSourcesTable,
  researchOrdersTable,
  researchPlagiarismReportsTable,
  researchSourcesTable,
  researchStatusEventsTable,
  researchTemplatesTable,
  researchUniversitiesTable,
  salesInvoiceItemsTable,
  salesInvoicesTable,
  staffTable,
} from "@workspace/db";
import { normalizeIraqiPhone } from "@/lib/phone";
import {
  createAndExecuteSourceFinancialTransaction,
  type FinancialActor,
} from "@/server/master-cash-box";
import { ensureResearchCenterTables } from "@/server/research-center-schema";

export type ResearchAdminUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

export const RESEARCH_STATUSES = ["new", "accepted", "searching_sources", "writing", "review", "formatting", "plagiarism_check", "completed", "delivered", "archived"] as const;
export const RESEARCH_STATUS_LABELS: Record<(typeof RESEARCH_STATUSES)[number], string> = {
  new: "جديد", accepted: "مقبول", searching_sources: "البحث عن المصادر", writing: "الكتابة", review: "المراجعة", formatting: "التنسيق", plagiarism_check: "فحص الاستلال", completed: "مكتمل", delivered: "تم التسليم", archived: "مؤرشف",
};
const STATUS_PROGRESS: Record<string, number> = { new: 5, accepted: 10, searching_sources: 20, writing: 50, review: 70, formatting: 82, plagiarism_check: 90, completed: 100, delivered: 100, archived: 100 };
const CHAPTERS = [
  ["cover", "الغلاف"], ["acknowledgment", "الشكر والتقدير"], ["abstract", "الملخص"], ["toc", "جدول المحتويات"],
  ["chapter_1", "الفصل الأول"], ["chapter_2", "الفصل الثاني"], ["chapter_3", "الفصل الثالث"], ["chapter_4", "الفصل الرابع"], ["chapter_5", "الفصل الخامس"],
  ["references", "المراجع"], ["appendix", "الملاحق"],
] as const;
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET || "ajn-assets";
const RESEARCH_PRIVATE_BUCKET = process.env.AJN_RESEARCH_PRIVATE_BUCKET || process.env.AJN_CUSTOMER_PRIVATE_BUCKET || process.env.SUPABASE_CUSTOMER_PRIVATE_BUCKET || "";
const STORAGE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";
const MAX_RESEARCH_FILE_BYTES = 6 * 1024 * 1024;
const RESEARCH_FILE_TYPES: Record<string, { extensions: readonly string[]; signature: (bytes: Buffer) => boolean }> = {
  "application/pdf": { extensions: ["pdf"], signature: (bytes) => bytes.subarray(0, 5).toString() === "%PDF-" },
  "application/msword": { extensions: ["doc"], signature: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
  "application/vnd.ms-excel": { extensions: ["xls"], signature: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
  "application/vnd.ms-powerpoint": { extensions: ["ppt"], signature: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extensions: ["docx"], signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extensions: ["xlsx"], signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { extensions: ["pptx"], signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  "image/jpeg": { extensions: ["jpg", "jpeg"], signature: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/png": { extensions: ["png"], signature: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/webp": { extensions: ["webp"], signature: (bytes) => bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" },
  "text/plain": { extensions: ["txt"], signature: (bytes) => !bytes.subarray(0, 1024).includes(0) },
  "text/csv": { extensions: ["csv"], signature: (bytes) => !bytes.subarray(0, 1024).includes(0) },
  "application/csv": { extensions: ["csv"], signature: (bytes) => !bytes.subarray(0, 1024).includes(0) },
};

const optionalString = z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().optional());
// Manual university entry sends "" (or the "manual" sentinel) — coerce those to
// null instead of failing `.positive()` after `Number("") === 0`.
const optionalUniversityId = z.preprocess((value) => {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "manual") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}, z.number().int().positive().nullable());
const orderSchema = z.object({
  customerName: z.string().trim().min(2).max(160), phone: z.string().trim().min(10).max(30), title: z.string().trim().min(5).max(500),
  researchType: z.enum(["graduation", "diploma", "bachelor", "master", "phd", "article", "conference", "report"]),
  universityId: optionalUniversityId, universityName: z.string().trim().min(2).max(240), college: optionalString, department: optionalString,
  supervisorName: optionalString, language: z.enum(["ar", "en", "ku", "other"]).default("ar"), researchField: z.string().trim().max(240).optional().default(""),
  keywords: z.union([z.array(z.string()), z.string()]).transform((value) => Array.isArray(value) ? value.map(String).filter(Boolean) : value.split(/[,،]/).map((item) => item.trim()).filter(Boolean)).default([]),
  requiredPages: z.coerce.number().int().min(1).max(2000), deadline: optionalString, citationStyle: z.enum(["APA7", "IEEE", "MLA", "Harvard", "Chicago"]).default("APA7"),
  urgency: z.enum(["normal", "urgent", "critical"]).default("normal"), estimatedPrice: z.coerce.number().min(0).default(0), deposit: z.coerce.number().min(0).default(0), notes: optionalString,
  files: z.array(z.object({ title: z.string().trim().min(1).max(300), fileName: z.string().trim().min(1).max(255), fileUrl: z.string().min(1).max(9_000_000), mimeType: optionalString, fileType: z.string().trim().max(80).default("customer_upload") })).max(10).default([]),
});
const patchSchema = z.object({
  title: z.string().trim().min(5).max(500).optional(), status: z.enum(RESEARCH_STATUSES).optional(), progress: z.coerce.number().int().min(0).max(100).optional(), deadline: optionalString,
  assignedWriterId: z.coerce.number().int().positive().nullable().optional(), assignedReviewerId: z.coerce.number().int().positive().nullable().optional(), assignedProofreaderId: z.coerce.number().int().positive().nullable().optional(), assignedFormatterId: z.coerce.number().int().positive().nullable().optional(), assignedSupervisorId: z.coerce.number().int().positive().nullable().optional(),
  estimatedPrice: z.coerce.number().min(0).optional(), discountAmount: z.coerce.number().min(0).optional(), notes: optionalString,
});

function json(data: unknown, status = 200) { return NextResponse.json(data, { status }); }
function error(message: string, status = 400, details?: unknown) { return NextResponse.json({ error: message, details }, { status }); }

const FIELD_LABELS: Record<string, string> = {
  customerName: "اسم الزبون", phone: "رقم الهاتف", title: "عنوان البحث", researchType: "نوع البحث",
  universityId: "الجامعة", universityName: "اسم الجامعة", college: "الكلية", department: "القسم",
  supervisorName: "اسم المشرف", language: "اللغة", researchField: "المجال العلمي", keywords: "الكلمات المفتاحية",
  requiredPages: "عدد الصفحات", deadline: "موعد التسليم", citationStyle: "نمط التوثيق", urgency: "مستوى الاستعجال",
  estimatedPrice: "السعر التقديري", deposit: "العربون", notes: "الملاحظات", files: "الملفات",
};
function arabicIssue(field: string, issue: { code?: string }): string {
  const label = FIELD_LABELS[field] || "الحقل";
  switch (issue.code) {
    case "too_small": return `${label} مطلوب أو غير مكتمل`;
    case "too_big": return `${label}: القيمة كبيرة جداً`;
    case "invalid_type": return `${label} مطلوب`;
    case "invalid_value":
    case "invalid_format": return `${label}: قيمة غير صحيحة`;
    default: return `${label}: تحقق من القيمة`;
  }
}
function fieldErrorsFromZod(zodError: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of zodError.issues) {
    const field = String(issue.path[0] ?? "");
    if (!field || fieldErrors[field]) continue;
    fieldErrors[field] = arabicIssue(field, issue);
  }
  return fieldErrors;
}
// Structured API error. Keeps `error` for backward-compatible clients (apiErrorMessage)
// while adding success/message/fieldErrors/errorCode.
function structuredError(message: string, opts: { status?: number; fieldErrors?: Record<string, string>; errorCode?: string } = {}) {
  return NextResponse.json(
    { success: false, error: message, message, fieldErrors: opts.fieldErrors ?? {}, errorCode: opts.errorCode ?? "RESEARCH_ORDER_ERROR" },
    { status: opts.status ?? 400 },
  );
}
function fieldError(field: string, message: string, errorCode = "VALIDATION_ERROR") {
  return structuredError(message, { fieldErrors: { [field]: message }, errorCode });
}
async function requestBody(req: NextRequest) { return readRequestBody(req); }
function actorName(user?: ResearchAdminUser | null) { return user ? user.fullName || user.username : "الموقع"; }
function allowed(user: ResearchAdminUser, permission: string) { return user.role === "admin" || user.permissions.includes("research") || user.permissions.includes(permission); }
function denied(user: ResearchAdminUser, permission: string) { return allowed(user, permission) ? null : error("لا تملك صلاحية تنفيذ هذا الإجراء", 403); }
function financialActor(user: ResearchAdminUser): FinancialActor { return { id: user.id, name: actorName(user), role: user.role }; }
function numeric(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function today() { return new Date().toISOString().slice(0, 10); }

async function trace(orderId: number, action: string, description: string, user?: ResearchAdminUser | null, metadata: Record<string, unknown> = {}) {
  await Promise.all([
    db.insert(entityTimelineTable).values({ entityType: "research_order", entityId: orderId, type: action, title: description, body: description, actorId: user?.id ?? null, actorName: actorName(user), metadata }),
    db.insert(adminActivityLogsTable).values({ staffId: user?.id ?? null, userName: actorName(user), action, entityType: "research_order", entityId: orderId, metadata }),
  ]);
}
async function notifyCustomer(customerId: number, orderId: number, token: string, type: string, title: string, body: string) {
  await db.insert(notificationsTable).values({ audienceType: "customer", customerId, type, title, body, entityType: "research_order", entityId: orderId, href: `/research/track/${token}` });
}
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
// `normalized` is the already-normalized phone; reuses an existing customer to
// avoid duplicates, otherwise creates one. Runs inside the caller's transaction.
async function ensureCustomerTx(tx: Executor, normalized: string, name: string) {
  const [existing] = await tx.select().from(customersTable).where(eq(customersTable.phone, normalized)).limit(1);
  if (existing) {
    if (!existing.name && name) await tx.update(customersTable).set({ name, fullName: name, updatedAt: new Date() }).where(eq(customersTable.id, existing.id));
    return existing;
  }
  const [created] = await tx.insert(customersTable).values({ phone: normalized, name, fullName: name }).returning();
  return created;
}
export function validateResearchFileData(value: string, fileName: string, claimedMime?: string | null) {
  if (!value.startsWith("data:")) {
    if (!STORAGE_URL) throw new Error("رابط الملف غير مسموح");
    let candidate: URL;
    let storage: URL;
    try {
      candidate = new URL(value);
      storage = new URL(STORAGE_URL);
    } catch {
      throw new Error("رابط الملف غير صالح");
    }
    const expectedPrefix = `/storage/v1/object/public/${STORAGE_BUCKET}/research/`;
    if (candidate.protocol !== "https:" || candidate.host !== storage.host || !candidate.pathname.startsWith(expectedPrefix))
      throw new Error("يسمح فقط بروابط ملفات AJN المخزنة مسبقاً");
    return { existingUrl: candidate.toString(), bytes: null, mime: null, extension: null };
  }
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("صيغة الملف غير مدعومة");
  const mime = match[1].trim().toLowerCase();
  const definition = RESEARCH_FILE_TYPES[mime];
  if (!definition) throw new Error("نوع الملف غير مدعوم");
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!definition.extensions.includes(extension)) throw new Error("امتداد الملف لا يطابق نوعه");
  if (claimedMime && claimedMime.trim().toLowerCase() !== mime)
    throw new Error("نوع الملف المرسل لا يطابق محتواه");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_RESEARCH_FILE_BYTES)
    throw new Error("حجم الملف يجب ألا يتجاوز 6 ميغابايت");
  if (!definition.signature(bytes)) throw new Error("توقيع الملف لا يطابق نوعه");
  return { existingUrl: null, bytes, mime, extension: definition.extensions[0] };
}

async function persistFile(value: string, fileName: string, orderId: number, claimedMime?: string | null) {
  const validated = validateResearchFileData(value, fileName, claimedMime);
  if (validated.existingUrl) return validated.existingUrl;
  if (!STORAGE_URL || !STORAGE_SERVICE_KEY || !RESEARCH_PRIVATE_BUCKET) throw new Error("خدمة تخزين الملفات الخاصة غير مهيأة");
  const path = `research/${orderId}/${Date.now()}-${randomUUID()}.${validated.extension}`;
  const response = await fetch(`${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/${RESEARCH_PRIVATE_BUCKET}/${path}`, { method: "POST", headers: { authorization: `Bearer ${STORAGE_SERVICE_KEY}`, apikey: STORAGE_SERVICE_KEY, "content-type": validated.mime!, "x-upsert": "false" }, body: validated.bytes! });
  if (!response.ok) throw new Error("تعذر حفظ الملف في التخزين");
  return `private:${path}`;
}

function encodedStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function authorizedResearchFileUrl(stored: string) {
  if (!stored.startsWith("private:")) return stored;
  if (!STORAGE_URL || !STORAGE_SERVICE_KEY || !RESEARCH_PRIVATE_BUCKET)
    throw new Error("خدمة تخزين الملفات الخاصة غير مهيأة");
  const path = stored.slice("private:".length);
  if (!path.startsWith("research/") || path.includes(".."))
    throw new Error("مسار ملف البحث غير صالح");
  const response = await fetch(
    `${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/sign/${RESEARCH_PRIVATE_BUCKET}/${encodedStoragePath(path)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${STORAGE_SERVICE_KEY}`,
        apikey: STORAGE_SERVICE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 900 }),
    },
  );
  if (!response.ok) throw new Error("تعذر إصدار رابط آمن لملف البحث");
  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signed = payload.signedURL || payload.signedUrl;
  if (!signed) throw new Error("تعذر إصدار رابط آمن لملف البحث");
  return new URL(signed, `${STORAGE_URL.replace(/\/$/, "")}/`).toString();
}

async function createInvoiceTx(tx: Executor, order: any, customer: any, user?: ResearchAdminUser | null) {
  const [invoice] = await tx.insert(salesInvoicesTable).values({ invoiceNo: `RS-TMP-${randomUUID().replace(/-/g, "")}`, qrToken: order.qrToken, date: today(), customerName: customer.fullName || customer.name, customerPhone: customer.phone, customerId: customer.id, subtotal: String(order.estimatedPrice), discountAmount: String(order.discountAmount), total: String(order.totalAmount), paidAmount: "0", remainingAmount: String(order.totalAmount), paymentMethod: "cash", paymentStatus: numeric(order.totalAmount) ? "unpaid" : "paid", dueDate: order.deadline, status: "active", isInternal: 0, stockApplied: 0, notes: `فاتورة خدمة بحث أكاديمي ${order.researchNo}`, createdBy: user?.id ?? null, createdByName: actorName(user) }).returning();
  const invoiceNo = `AJN-RS-INV-${String(invoice.id).padStart(6, "0")}`;
  await tx.update(salesInvoicesTable).set({ invoiceNo }).where(eq(salesInvoicesTable.id, invoice.id));
  await tx.insert(salesInvoiceItemsTable).values({ invoiceId: invoice.id, productName: `خدمة بحث أكاديمي - ${order.title}`, quantity: "1", unitPrice: String(order.estimatedPrice), discount: String(order.discountAmount), total: String(order.totalAmount), costPrice: "0" });
  return { ...invoice, invoiceNo };
}

async function createResearchOrder(raw: unknown, user?: ResearchAdminUser | null) {
  await ensureResearchCenterTables();
  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) {
    return { response: structuredError("تحقق من بيانات طلب البحث", { fieldErrors: fieldErrorsFromZod(parsed.error), errorCode: "VALIDATION_ERROR" }) };
  }
  const data = parsed.data;
  const normalizedPhone = normalizeIraqiPhone(data.phone);
  if (!normalizedPhone) return { response: fieldError("phone", "رقم الهاتف غير صحيح") };
  const total = Math.max(0, data.estimatedPrice);
  if (data.deposit > total) return { response: fieldError("deposit", "العربون لا يمكن أن يتجاوز إجمالي الطلب") };
  // 32-char token (128-bit) — unique enough and fits every qr_token column
  // (research_orders varchar(96) and the shared sales_invoices qr_token).
  const token = randomUUID().replace(/-/g, "");
  let failureStage = "transaction_start";
  try {
    // Customer, order, chapters, invoice and attachments are created atomically:
    // any failure rolls the whole thing back (no orphan orders/invoices/customers).
    const { customer, order, invoice } = await db.transaction(async (tx) => {
      failureStage = "customer";
      const customer = await ensureCustomerTx(tx, normalizedPhone, data.customerName);
      failureStage = "order";
      const [draft] = await tx.insert(researchOrdersTable).values({ researchNo: `RS-TMP-${randomUUID()}`, qrToken: token, customerId: customer.id, title: data.title, researchType: data.researchType, universityId: data.universityId ?? null, universityName: data.universityName, college: data.college || "", department: data.department || "", supervisorName: data.supervisorName || null, language: data.language, researchField: data.researchField, keywords: data.keywords, requiredPages: data.requiredPages, deadline: data.deadline || null, citationStyle: data.citationStyle, urgency: data.urgency, notes: data.notes || null, estimatedPrice: String(data.estimatedPrice), totalAmount: String(total), paidAmount: "0", remainingAmount: String(total), paymentStatus: total ? "unpaid" : "paid", chapterCount: CHAPTERS.length, createdBy: user?.id ?? null, createdByName: actorName(user) }).returning();
      const researchNo = `AJN-RS-${new Date().getFullYear()}-${String(draft.id).padStart(6, "0")}`;
      const [order] = await tx.update(researchOrdersTable).set({ researchNo, updatedAt: new Date() }).where(eq(researchOrdersTable.id, draft.id)).returning();
      failureStage = "chapters";
      await tx.insert(researchChaptersTable).values(CHAPTERS.map(([chapterType, title], sortOrder) => ({ researchOrderId: order.id, chapterType, title, sortOrder })));
      failureStage = "invoice";
      const invoice = await createInvoiceTx(tx, order, customer, user);
      await tx.update(researchOrdersTable).set({ invoiceId: invoice.id }).where(eq(researchOrdersTable.id, order.id));
      for (const file of data.files) {
        const fileUrl = await persistFile(file.fileUrl, file.fileName, order.id, file.mimeType);
        await tx.insert(researchFilesTable).values({ researchOrderId: order.id, fileType: file.fileType, title: file.title, fileUrl, fileName: file.fileName, mimeType: file.mimeType || null, isCustomerVisible: true, uploadedBy: user?.id ?? null, uploadedByName: actorName(user) });
      }
      await tx.insert(researchStatusEventsTable).values({ researchOrderId: order.id, toStatus: "new", changedBy: user?.id ?? null, changedByName: actorName(user) });
      if (data.deposit > 0 && user) {
        failureStage = "deposit_finance";
        await createAndExecuteSourceFinancialTransaction(tx, {
          direction: "revenue",
          amount: data.deposit,
          department: "research",
          transactionType: "research_payment",
          description: `عربون طلب البحث ${order.researchNo}`,
          paymentMethod: "cash",
          sourceType: "research_order",
          sourceId: String(order.id),
          sourceEvent: "payment",
          idempotencyKey: `research-payment:${order.id}:${data.deposit.toFixed(2)}:v1`,
          customerId: customer.id,
          customerName: data.customerName,
          dueDate: data.deadline || null,
          attachments: [],
        }, financialActor(user));
      }
      // A recorded deposit is an approval request, not an official payment.
      // The central cash-box executor updates the order and invoice together
      // only after the main financial approval succeeds.
      const postedDeposit = 0;
      const remaining = Math.max(0, total - postedDeposit);
      const paymentStatus = remaining <= 0 ? "paid" : postedDeposit > 0 ? "partial" : "unpaid";
      return {
        customer,
        order: { ...order, invoiceId: invoice.id, paidAmount: String(postedDeposit), remainingAmount: String(remaining), paymentStatus },
        invoice: { ...invoice, paidAmount: String(postedDeposit), remainingAmount: String(remaining), paymentStatus },
      };
    });
    // Post-commit side effects (activity log, notifications). Failures here must
    // not roll back a committed order, so they are best-effort.
    await Promise.allSettled([
      trace(order.id, "research_created", `تم إنشاء طلب البحث ${order.researchNo}`, user, { invoiceId: invoice.id }),
      db.insert(notificationsTable).values({ audienceType: "admin", type: "research_order_new", title: "طلب بحث أكاديمي جديد", body: `${order.researchNo} - ${order.title}`, entityType: "research_order", entityId: order.id, href: "/admin/research/orders" }),
      notifyCustomer(customer.id, order.id, token, "research_created", "تم استلام طلب البحث", `${order.researchNo} قيد المراجعة`),
    ]);
    return { order: { ...order, trackingUrl: `/research/track/${token}` }, invoice };
  } catch (err: any) {
    const databaseCode = String(err?.code || err?.cause?.code || "UNKNOWN").replace(/[^A-Z0-9_-]/gi, "").slice(0, 32);
    // Drizzle query errors contain SQL parameters, so never log the raw object.
    console.error("[research.createOrder] failed", {
      databaseCode,
      operation: "research_order_create",
      stage: failureStage,
      actorId: user?.id ?? null,
    });
    if (databaseCode === "23505") return { response: structuredError("تعذر إنشاء طلب مكرر، حدّث الصفحة ثم حاول مجدداً", { status: 409, errorCode: "DUPLICATE_ORDER" }) };
    return { response: structuredError("تعذر إنشاء طلب البحث بسبب خطأ غير متوقع", { status: 500, errorCode: "RESEARCH_ORDER_CREATE_FAILED" }) };
  }
}

async function applyPayment(orderId: number, amount: number, paymentMethod: string, user: ResearchAdminUser, suppliedIdempotencyKey?: unknown) {
  if (!Number.isFinite(amount) || amount <= 0) return { response: error("مبلغ الدفعة غير صحيح", 400) };
  const clientKey = String(suppliedIdempotencyKey ?? "").trim();
  if (clientKey && !/^[A-Za-z0-9:_-]{8,120}$/.test(clientKey))
    return { response: error("معرف إعادة المحاولة غير صحيح", 400) };
  const payment = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82177, ${orderId})`);
    const [lockedOrder] = await tx.select().from(researchOrdersTable).where(eq(researchOrdersTable.id, orderId)).limit(1);
    if (!lockedOrder) return null;
    const financialKey = clientKey ? `research-payment:${orderId}:${clientKey}` : null;
    if (financialKey) {
      const [existing] = await tx.select().from(financialTransactionsTable).where(eq(financialTransactionsTable.idempotencyKey, financialKey)).limit(1);
      if (existing) {
        if (existing.sourceType !== "research_order" || existing.sourceId !== String(orderId) || numeric(existing.amount) !== amount)
          throw new Error("تعارض معرف إعادة محاولة دفعة البحث");
        const ledger = await tx.select({ id: financialLedgerEntriesTable.id }).from(financialLedgerEntriesTable).where(eq(financialLedgerEntriesTable.transactionId, existing.id));
        if (existing.approvalStatus === "executed" && ledger.length < 2)
          throw new Error("دفعة البحث السابقة غير مكتملة محاسبياً وتحتاج مراجعة");
        return {
          invalid: false as const,
          duplicate: true as const,
          order: lockedOrder,
          targetPaid: numeric(lockedOrder.paidAmount),
          remaining: numeric(lockedOrder.remainingAmount),
          status: lockedOrder.paymentStatus,
          transaction: existing,
        };
      }
    }
    const total = numeric(lockedOrder.totalAmount); const previousPaid = numeric(lockedOrder.paidAmount); const targetPaid = Math.min(total, previousPaid + amount);
    if (targetPaid <= previousPaid) return { invalid: true as const, order: lockedOrder, targetPaid: previousPaid, remaining: Math.max(0, total - previousPaid), status: lockedOrder.paymentStatus };
    const remaining = Math.max(0, total - previousPaid); const status = lockedOrder.paymentStatus;
    const transaction = await createAndExecuteSourceFinancialTransaction(tx, {
      direction: "revenue",
      amount: targetPaid - previousPaid,
      department: "research",
      transactionType: "research_payment",
      description: `دفعة طلب البحث ${lockedOrder.researchNo}`,
      paymentMethod: paymentMethod as "cash" | "transfer" | "card" | "pos" | "other",
      sourceType: "research_order",
      sourceId: String(orderId),
      sourceEvent: "payment",
      idempotencyKey: financialKey ?? `research-payment:${orderId}:${targetPaid.toFixed(2)}:v1`,
      customerId: lockedOrder.customerId,
      customerName: lockedOrder.title,
      dueDate: lockedOrder.deadline,
      attachments: [],
    }, financialActor(user));
    return { invalid: false as const, duplicate: false as const, order: lockedOrder, targetPaid: previousPaid, remaining, status, transaction };
  });
  if (!payment) return { response: error("طلب البحث غير موجود", 404) };
  if (payment.invalid) return { response: error("تم سداد كامل مبلغ البحث", 400) };
  const { order, targetPaid, remaining, status, transaction, duplicate } = payment;
  if (!duplicate)
    await trace(order.id, "research_payment_received", `تم استلام دفعة بقيمة ${amount}`, user, { amount, targetPaid, transactionId: transaction?.id });
  return { paidAmount: targetPaid, remainingAmount: remaining, paymentStatus: status, transaction, duplicate };
}

async function orderDetail(id: number, customerSafe = false) {
  const order = await db.query.researchOrdersTable.findFirst({ where: eq(researchOrdersTable.id, id) });
  if (!order) return null;
  const [customer, chapters, sourceRows, citations, files, plagiarism, messages, timeline, assignments] = await Promise.all([
    db.query.customersTable.findFirst({ where: eq(customersTable.id, order.customerId) }),
    db.select().from(researchChaptersTable).where(eq(researchChaptersTable.researchOrderId, id)).orderBy(asc(researchChaptersTable.sortOrder)),
    db.select({ link: researchOrderSourcesTable, source: researchSourcesTable }).from(researchOrderSourcesTable).innerJoin(researchSourcesTable, eq(researchSourcesTable.id, researchOrderSourcesTable.sourceId)).where(eq(researchOrderSourcesTable.researchOrderId, id)),
    db.select().from(researchCitationsTable).where(eq(researchCitationsTable.researchOrderId, id)).orderBy(asc(researchCitationsTable.id)),
    db.select().from(researchFilesTable).where(and(eq(researchFilesTable.researchOrderId, id), customerSafe ? eq(researchFilesTable.isCustomerVisible, true) : sql`true`)).orderBy(desc(researchFilesTable.createdAt)),
    db.select().from(researchPlagiarismReportsTable).where(eq(researchPlagiarismReportsTable.researchOrderId, id)).orderBy(desc(researchPlagiarismReportsTable.createdAt)),
    db.select().from(researchMessagesTable).where(and(eq(researchMessagesTable.researchOrderId, id), customerSafe ? eq(researchMessagesTable.isInternal, false) : sql`true`)).orderBy(asc(researchMessagesTable.createdAt)),
    db.select().from(entityTimelineTable).where(and(eq(entityTimelineTable.entityType, "research_order"), eq(entityTimelineTable.entityId, id))).orderBy(asc(entityTimelineTable.createdAt)),
    customerSafe ? Promise.resolve([]) : db.select({ assignment: researchAssignmentsTable, staffName: staffTable.fullName, username: staffTable.username }).from(researchAssignmentsTable).leftJoin(staffTable, eq(staffTable.id, researchAssignmentsTable.staffId)).where(eq(researchAssignmentsTable.researchOrderId, id)),
  ]);
  const customerRecord = customerSafe ? { name: customer?.fullName || customer?.name || "", phone: customer?.phone || "" } : customer;
  const authorizedFiles = await Promise.all(files.map(async (file) => ({ ...file, fileUrl: await authorizedResearchFileUrl(file.fileUrl) })));
  if (customerSafe) {
    return {
      order: {
        title: order.title,
        researchNo: order.researchNo,
        status: order.status,
        progress: order.progress,
        deadline: order.deadline,
        remainingAmount: order.remainingAmount,
      },
      customer: customerRecord,
      chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, status: chapter.status, progress: chapter.progress, approvalStatus: chapter.approvalStatus })),
      sources: sourceRows.map((row) => ({ id: row.source.id, title: row.source.title, authors: row.source.authors, provider: row.source.provider, link: { selectedByCustomer: row.link.selectedByCustomer } })),
      citations: citations.map((citation) => ({ id: citation.id, bibliographyText: citation.bibliographyText })),
      files: authorizedFiles.map((file) => ({ id: file.id, title: file.title, fileUrl: file.fileUrl, version: file.version })),
      plagiarism: plagiarism.map((report) => ({ id: report.id, similarityPercentage: report.similarityPercentage })),
      messages: messages.map((message) => ({ id: message.id, senderType: message.senderType, senderName: message.senderName, message: message.message })),
      timeline: timeline.map((event) => ({ id: event.id, title: event.title, createdAt: event.createdAt })),
      assignments: [],
    };
  }
  return { order, customer: customerRecord, chapters, sources: sourceRows.map((row) => ({ ...row.source, link: row.link })), citations, files: authorizedFiles, plagiarism, messages, timeline, assignments };
}

type SourceResult = { provider: string; externalId: string; title: string; authors: string[]; journal?: string; year?: number; abstract?: string; doi?: string; language?: string; category?: string; url?: string; pdfUrl?: string; openAccess?: boolean; metadata?: Record<string, unknown> };
async function fetchJson(url: string, headers: Record<string, string> = {}) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 9000); try { const response = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: controller.signal, next: { revalidate: 300 } }); if (!response.ok) throw new Error(`${response.status}`); return await response.json(); } finally { clearTimeout(timer); } }
async function fetchText(url: string, headers: Record<string, string> = {}) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 9000); try { const response = await fetch(url, { headers: { accept: "application/atom+xml, application/xml, text/xml", ...headers }, signal: controller.signal, next: { revalidate: 300 } }); if (!response.ok) throw new Error(`${response.status}`); return await response.text(); } finally { clearTimeout(timer); } }
function decodeXml(value: string) { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); }
async function searchCrossref(query: string, year?: string): Promise<SourceResult[]> { const filter = year ? `&filter=from-pub-date:${year}-01-01,until-pub-date:${year}-12-31` : ""; const data = await fetchJson(`https://api.crossref.org/works?rows=12&select=DOI,title,author,published,container-title,abstract,URL,link,language,type&query.bibliographic=${encodeURIComponent(query)}${filter}`); return (data?.message?.items || []).map((item: any) => ({ provider: "crossref", externalId: item.DOI || item.URL, title: item.title?.[0] || "", authors: (item.author || []).map((a: any) => [a.given, a.family].filter(Boolean).join(" ")), journal: item["container-title"]?.[0], year: item.published?.["date-parts"]?.[0]?.[0], abstract: item.abstract?.replace(/<[^>]+>/g, ""), doi: item.DOI, language: item.language, category: item.type, url: item.URL, pdfUrl: item.link?.find((link: any) => String(link["content-type"]).includes("pdf"))?.URL, openAccess: Boolean(item.link?.length), metadata: item })); }
async function searchOpenAlex(query: string, year?: string): Promise<SourceResult[]> { const filter = year ? `&filter=publication_year:${year}` : ""; const data = await fetchJson(`https://api.openalex.org/works?per-page=12&select=id,title,authorships,publication_year,primary_location,doi,language,type,open_access,abstract_inverted_index&search=${encodeURIComponent(query)}${filter}`, { "user-agent": "AJN Research Center (mailto:admin@alijan-group.com)" }); return (data?.results || []).map((item: any) => ({ provider: "openalex", externalId: item.id, title: item.title || "", authors: (item.authorships || []).map((a: any) => a.author?.display_name).filter(Boolean), journal: item.primary_location?.source?.display_name, year: item.publication_year, doi: String(item.doi || "").replace(/^https?:\/\/doi.org\//, "") || undefined, language: item.language, category: item.type, url: item.primary_location?.landing_page_url || item.id, pdfUrl: item.primary_location?.pdf_url, openAccess: Boolean(item.open_access?.is_oa), metadata: item })); }
async function searchSemantic(query: string, year?: string): Promise<SourceResult[]> { const key = process.env.SEMANTIC_SCHOLAR_API_KEY; const data = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?limit=12&fields=title,authors,year,venue,abstract,url,externalIds,openAccessPdf,fieldsOfStudy&query=${encodeURIComponent(query)}${year ? `&year=${year}` : ""}`, key ? { "x-api-key": key } : {}); return (data?.data || []).map((item: any) => ({ provider: "semantic_scholar", externalId: item.paperId, title: item.title || "", authors: (item.authors || []).map((a: any) => a.name), journal: item.venue, year: item.year, abstract: item.abstract, doi: item.externalIds?.DOI, category: item.fieldsOfStudy?.join(", "), url: item.url, pdfUrl: item.openAccessPdf?.url, openAccess: Boolean(item.openAccessPdf?.url), metadata: item })); }
async function searchPubMed(query: string, year?: string): Promise<SourceResult[]> {
  const apiKey = process.env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(process.env.NCBI_API_KEY)}` : "";
  const term = year ? `${query} AND ${year}[pdat]` : query;
  const found = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=12&sort=relevance&tool=ajn_research_center&email=admin%40alijan-group.com&term=${encodeURIComponent(term)}${apiKey}`);
  const ids = found?.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const data = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&tool=ajn_research_center&email=admin%40alijan-group.com&id=${ids.join(",")}${apiKey}`);
  return (data?.result?.uids || []).map((id: string) => data.result[id]).filter(Boolean).map((item: any) => { const doi = (item.articleids || []).find((value: any) => value.idtype === "doi")?.value; const publishedYear = Number(String(item.pubdate || "").match(/\d{4}/)?.[0]) || undefined; return { provider: "pubmed", externalId: String(item.uid), title: String(item.title || "").replace(/<[^>]+>/g, ""), authors: (item.authors || []).map((author: any) => author.name).filter(Boolean), journal: item.fulljournalname || item.source, year: publishedYear, doi, category: "journal-article", url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`, metadata: item }; });
}
async function searchDoaj(query: string, year?: string): Promise<SourceResult[]> {
  const data = await fetchJson(`https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=12`);
  return (data?.results || []).map((row: any) => row.bibjson || {}).filter((item: any) => !year || String(item.year) === String(year)).map((item: any) => { const doi = (item.identifier || []).find((value: any) => String(value.type).toLowerCase() === "doi")?.id; const fullText = (item.link || []).find((value: any) => value.type === "fulltext"); return { provider: "doaj", externalId: doi || fullText?.url || item.title, title: item.title || "", authors: (item.author || []).map((author: any) => author.name).filter(Boolean), journal: item.journal?.title, year: Number(item.year) || undefined, abstract: item.abstract, doi, language: item.journal?.language?.[0], category: (item.keywords || []).join(", "), url: fullText?.url, pdfUrl: String(fullText?.content_type || "").includes("pdf") ? fullText?.url : undefined, openAccess: true, metadata: item }; });
}
async function searchArxiv(query: string, year?: string): Promise<SourceResult[]> {
  const xml = await fetchText(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=12&sortBy=relevance&sortOrder=descending`);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]).map((entry) => { const value = (tag: string) => decodeXml(entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`))?.[1] || ""); const published = value("published"); const entryYear = Number(published.slice(0, 4)) || undefined; const url = value("id"); const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map((author) => decodeXml(author[1])); const doi = value("arxiv:doi") || undefined; return { provider: "arxiv", externalId: url.split("/").pop() || url, title: value("title"), authors, journal: value("arxiv:journal_ref") || "arXiv", year: entryYear, abstract: value("summary"), doi, category: entry.match(/<category[^>]*term="([^"]+)"/)?.[1], url, pdfUrl: entry.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/)?.[1], openAccess: true, metadata: { published } }; }).filter((item) => !year || String(item.year) === String(year));
}
async function searchSources(query: string, provider: string, year?: string) { const adapters: Record<string, () => Promise<SourceResult[]>> = { crossref: () => searchCrossref(query, year), openalex: () => searchOpenAlex(query, year), semantic_scholar: () => searchSemantic(query, year), pubmed: () => searchPubMed(query, year), doaj: () => searchDoaj(query, year), arxiv: () => searchArxiv(query, year) }; if (provider !== "all") return adapters[provider] ? adapters[provider]() : []; const settled = await Promise.allSettled(Object.values(adapters).map((run) => run())); return settled.flatMap((item) => item.status === "fulfilled" ? item.value : []).filter((item, index, rows) => rows.findIndex((other) => (other.doi && other.doi === item.doi) || `${other.provider}:${other.externalId}` === `${item.provider}:${item.externalId}`) === index).slice(0, 36); }

function citationFor(source: any, style: string) { const authors = (source.authors || []).join(", ") || "مؤلف غير معروف"; const year = source.publicationYear || "د.ت"; const title = source.title; const journal = source.journal || ""; const doi = source.doi ? `https://doi.org/${source.doi}` : source.url || ""; if (style === "IEEE") return `${authors}, “${title},” ${journal}, ${year}. ${doi}`; if (style === "MLA") return `${authors}. “${title}.” ${journal}, ${year}. ${doi}`; if (style === "Harvard") return `${authors} (${year}) '${title}', ${journal}. ${doi}`; if (style === "Chicago") return `${authors}. “${title}.” ${journal} (${year}). ${doi}`; return `${authors} (${year}). ${title}. ${journal}. ${doi}`; }

async function aiGenerate(raw: unknown, user: ResearchAdminUser) {
  const schema = z.object({ orderId: z.coerce.number().int().positive(), chapterId: z.coerce.number().int().positive().optional(), action: z.string().min(2).max(60), prompt: z.string().min(2).max(12000), sourceIds: z.array(z.coerce.number().int().positive()).min(1, "اختر مصدراً واحداً على الأقل") });
  const parsed = schema.safeParse(raw); if (!parsed.success) return { response: error("يجب اختيار مصادر موثقة قبل استخدام المساعد", 400, parsed.error.issues) };
  const data = parsed.data; const linked = await db.select({ source: researchSourcesTable }).from(researchOrderSourcesTable).innerJoin(researchSourcesTable, eq(researchSourcesTable.id, researchOrderSourcesTable.sourceId)).where(and(eq(researchOrderSourcesTable.researchOrderId, data.orderId), inArray(researchSourcesTable.id, data.sourceIds)));
  if (linked.length !== data.sourceIds.length) return { response: error("بعض المصادر المختارة غير مرتبطة بهذا البحث", 400) };
  const key = process.env.OPENAI_API_KEY; if (!key) return { response: error("مساعد الذكاء الاصطناعي غير مهيأ حالياً", 503) };
  const sourceBlock = linked.map(({ source }, index) => `[S${index + 1}] ${citationFor(source, "APA7")}\nAbstract: ${source.abstract || "غير متوفر"}`).join("\n\n");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0.25, messages: [{ role: "system", content: "أنت مساعد بحث أكاديمي. استخدم حصراً المصادر المرفقة. كل ادعاء من مصدر يجب أن يحمل [S#]. لا تخترع مراجع أو DOI أو معلومات غير موجودة. إذا لم تكفِ المصادر صرّح بذلك." }, { role: "user", content: `الإجراء: ${data.action}\nالمطلوب: ${data.prompt}\n\nالمصادر المسموحة فقط:\n${sourceBlock}` }] }) });
  if (!response.ok) return { response: error("تعذر تشغيل مساعد البحث", 502) };
  const payload = await response.json(); const output = String(payload?.choices?.[0]?.message?.content || "").trim();
  const invalid = [...output.matchAll(/\[S(\d+)\]/g)].some((match) => Number(match[1]) < 1 || Number(match[1]) > linked.length);
  if (invalid) return { response: error("تم رفض النص لأن إشارة مرجعية غير موثقة ظهرت في الناتج", 422) };
  await db.insert(researchAiGenerationsTable).values({ researchOrderId: data.orderId, chapterId: data.chapterId ?? null, action: data.action, prompt: data.prompt, output, sourceIds: data.sourceIds, model, createdBy: user.id });
  await trace(data.orderId, "research_ai_generated", `تم تنفيذ ${data.action} بالمصادر المحددة`, user, { sourceIds: data.sourceIds, chapterId: data.chapterId });
  return { output, citations: linked.map(({ source }, index) => ({ key: `S${index + 1}`, sourceId: source.id, citation: citationFor(source, "APA7") })) };
}

async function dashboard() {
  const [summary] = await db.select({ total: sql<number>`count(*)::int`, completed: sql<number>`count(*) filter (where ${researchOrdersTable.status} in ('completed','delivered'))::int`, pending: sql<number>`count(*) filter (where ${researchOrdersTable.status} in ('new','accepted'))::int`, inProgress: sql<number>`count(*) filter (where ${researchOrdersTable.status} not in ('new','accepted','completed','delivered','archived'))::int`, revenue: sql<number>`coalesce(sum(${researchOrdersTable.paidAmount}),0)::numeric`, avgProgress: sql<number>`coalesce(avg(${researchOrdersTable.progress}),0)::numeric` }).from(researchOrdersTable).where(isNull(researchOrdersTable.archivedAt));
  const byStatus = await db.select({ status: researchOrdersTable.status, count: sql<number>`count(*)::int` }).from(researchOrdersTable).where(isNull(researchOrdersTable.archivedAt)).groupBy(researchOrdersTable.status);
  const recent = await db.select().from(researchOrdersTable).where(isNull(researchOrdersTable.archivedAt)).orderBy(desc(researchOrdersTable.createdAt)).limit(8);
  const writers = await db.select({ id: staffTable.id, name: staffTable.fullName, username: staffTable.username, completed: sql<number>`count(${researchAssignmentsTable.id}) filter (where ${researchAssignmentsTable.status}='completed')::int`, minutes: sql<number>`coalesce(sum(${researchAssignmentsTable.workingMinutes}),0)::int` }).from(staffTable).leftJoin(researchAssignmentsTable, eq(researchAssignmentsTable.staffId, staffTable.id)).groupBy(staffTable.id).orderBy(desc(sql`count(${researchAssignmentsTable.id})`)).limit(5);
  return { summary: { ...summary, revenue: numeric(summary?.revenue), avgProgress: Math.round(numeric(summary?.avgProgress)) }, byStatus, recent, writers, aiAvailable: Boolean(process.env.OPENAI_API_KEY) };
}

async function updateOrder(id: number, raw: unknown, user: ResearchAdminUser) {
  const parsed = patchSchema.safeParse(raw); if (!parsed.success) return { response: error("تحقق من بيانات تحديث البحث", 400, parsed.error.issues) };
  const current = await db.query.researchOrdersTable.findFirst({ where: eq(researchOrdersTable.id, id) }); if (!current) return { response: error("طلب البحث غير موجود", 404) };
  const data = parsed.data; const assignmentKeys = ["assignedWriterId", "assignedReviewerId", "assignedProofreaderId", "assignedFormatterId", "assignedSupervisorId"] as const; if (assignmentKeys.some((key) => data[key] !== undefined) && !allowed(user, "research.assign")) return { response: error("لا تملك صلاحية توزيع فريق البحث", 403) }; const estimated = data.estimatedPrice ?? numeric(current.estimatedPrice); const discount = data.discountAmount ?? numeric(current.discountAmount); const total = Math.max(0, estimated - discount); const paid = Math.min(total, numeric(current.paidAmount));
  const values: any = { ...data, estimatedPrice: String(estimated), discountAmount: String(discount), totalAmount: String(total), paidAmount: String(paid), remainingAmount: String(Math.max(0, total - paid)), paymentStatus: total - paid <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid", updatedAt: new Date() };
  if (data.status) { values.progress = data.progress ?? STATUS_PROGRESS[data.status]; if (data.status === "accepted") values.acceptedAt = new Date(); if (data.status === "completed") values.completedAt = new Date(); if (data.status === "delivered") values.deliveredAt = new Date(); if (data.status === "archived") values.archivedAt = new Date(); }
  const [saved] = await db.update(researchOrdersTable).set(values).where(eq(researchOrdersTable.id, id)).returning();
  if (current.invoiceId) await db.update(salesInvoicesTable).set({ subtotal: String(estimated), discountAmount: String(discount), total: String(total), paidAmount: String(paid), remainingAmount: String(Math.max(0, total - paid)), paymentStatus: values.paymentStatus, dueDate: saved.deadline, updatedAt: new Date() }).where(eq(salesInvoicesTable.id, current.invoiceId));
  if (data.status && data.status !== current.status) { await db.insert(researchStatusEventsTable).values({ researchOrderId: id, fromStatus: current.status, toStatus: data.status, changedBy: user.id, changedByName: actorName(user) }); await notifyCustomer(saved.customerId, id, saved.qrToken, `research_${data.status}`, RESEARCH_STATUS_LABELS[data.status], `${saved.researchNo} - ${RESEARCH_STATUS_LABELS[data.status]}`); }
  const roles: Array<[keyof typeof data, string]> = [["assignedWriterId", "writer"], ["assignedReviewerId", "reviewer"], ["assignedProofreaderId", "proofreader"], ["assignedFormatterId", "formatter"], ["assignedSupervisorId", "supervisor"]];
  for (const [key, role] of roles) { if (data[key] === undefined) continue; if (data[key] === null) { await db.update(researchAssignmentsTable).set({ status: "revoked", completedAt: new Date() }).where(and(eq(researchAssignmentsTable.researchOrderId, id), eq(researchAssignmentsTable.role, role), eq(researchAssignmentsTable.status, "assigned"))); continue; } await db.insert(researchAssignmentsTable).values({ researchOrderId: id, staffId: Number(data[key]), role, assignedBy: user.id }).onConflictDoUpdate({ target: [researchAssignmentsTable.researchOrderId, researchAssignmentsTable.staffId, researchAssignmentsTable.role], set: { status: "assigned", assignedBy: user.id, assignedAt: new Date(), completedAt: null } }); }
  await trace(id, "research_updated", data.status && data.status !== current.status ? `تغيرت الحالة إلى ${RESEARCH_STATUS_LABELS[data.status]}` : "تم تحديث طلب البحث", user, { changes: Object.keys(data) });
  return { order: saved };
}

export async function handleResearchPublic(req: NextRequest, parts: string[]): Promise<NextResponse> {
  await ensureResearchCenterTables(); const method = req.method; const resource = parts[1] || "config";
  if (method === "GET" && resource === "config") { const universities = await db.select().from(researchUniversitiesTable).where(eq(researchUniversitiesTable.isActive, true)).orderBy(asc(researchUniversitiesTable.nameAr)); return json({ universities, researchTypes: ["graduation", "diploma", "bachelor", "master", "phd", "article", "conference", "report"], citationStyles: ["APA7", "IEEE", "MLA", "Harvard", "Chicago"] }); }
  if (method === "POST" && resource === "orders") { const result = await createResearchOrder(await requestBody(req)); return result.response ?? json(result, 201); }
  if (resource === "track" && parts[2] && method === "POST" && parts[3] === "sources" && parts[4]) {
    const order = await db.query.researchOrdersTable.findFirst({ where: eq(researchOrdersTable.qrToken, parts[2]) });
    if (!order) return error("رمز متابعة البحث غير صحيح", 404);
    const sourceId = Number(parts[4]); const body = await requestBody(req);
    const [saved] = await db.update(researchOrderSourcesTable).set({ selectedByCustomer: body?.selected !== false }).where(and(eq(researchOrderSourcesTable.researchOrderId, order.id), eq(researchOrderSourcesTable.sourceId, sourceId))).returning();
    if (!saved) return error("المصدر غير مرتبط بهذا البحث", 404);
    await trace(order.id, saved.selectedByCustomer ? "research_source_customer_selected" : "research_source_customer_unselected", saved.selectedByCustomer ? "اعتمد الزبون مصدراً للبحث" : "ألغى الزبون اعتماد مصدر", null, { sourceId });
    return json({ source: saved });
  }
  if (resource === "track" && parts[2]) { const order = await db.query.researchOrdersTable.findFirst({ where: eq(researchOrdersTable.qrToken, parts[2]) }); if (!order) return error("رمز متابعة البحث غير صحيح", 404); if (method === "GET") { const detail = await orderDetail(order.id, true); const qrDataUrl = await QRCode.toDataURL(`${req.nextUrl.origin}/research/track/${order.qrToken}`, { width: 280, margin: 1 }); return json({ ...detail, qrDataUrl }); } if (method === "POST" && parts[3] === "messages") { const body = await requestBody(req); const message = String(body?.message || "").trim(); if (message.length < 2) return error("اكتب الرسالة", 400); await db.insert(researchMessagesTable).values({ researchOrderId: order.id, senderType: "customer", senderId: order.customerId, senderName: String(body?.senderName || "الزبون"), message }); await trace(order.id, "research_customer_message", "أرسل الزبون رسالة", null); return json({ sent: true }, 201); } if (method === "POST" && parts[3] === "chapters" && parts[4]) { const chapterId = Number(parts[4]); const chapter = await db.query.researchChaptersTable.findFirst({ where: and(eq(researchChaptersTable.id, chapterId), eq(researchChaptersTable.researchOrderId, order.id)) }); if (!chapter) return error("الفصل غير موجود", 404); const body = await requestBody(req); const action = body?.action === "approve" ? "approved" : "revision_requested"; const note = String(body?.note || "").trim(); if (action === "revision_requested" && note.length < 2) return error("اكتب التعديل المطلوب", 400); await db.update(researchChaptersTable).set({ approvalStatus: action, approvedAt: action === "approved" ? new Date() : null, updatedAt: new Date() }).where(eq(researchChaptersTable.id, chapterId)); if (note) await db.insert(researchMessagesTable).values({ researchOrderId: order.id, chapterId, senderType: "customer", senderId: order.customerId, senderName: "الزبون", message: note }); await trace(order.id, action === "approved" ? "research_chapter_approved" : "research_chapter_revision_requested", action === "approved" ? `اعتمد الزبون ${chapter.title}` : `طلب الزبون تعديل ${chapter.title}`, null, { chapterId, note }); return json({ status: action }); } }
  return error("المسار غير موجود", 404);
}

export async function handleAdminResearch(req: NextRequest, parts: string[], user: ResearchAdminUser): Promise<NextResponse | null> {
  if (parts[1] !== "research") return null; await ensureResearchCenterTables(); const method = req.method; const resource = parts[2] || "dashboard";
  const gate = denied(user, resource === "ai" ? "research.ai.use" : resource === "sources" || resource === "citations" ? "research.sources.manage" : resource === "reports" ? "research.reports.view" : "research.view"); if (gate) return gate;
  if (method === "GET" && resource === "dashboard") return json(await dashboard());
  if (resource === "orders") {
    if (method === "GET" && !parts[3]) { const search = req.nextUrl.searchParams.get("search")?.trim() || ""; const status = req.nextUrl.searchParams.get("status") || ""; const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") || 1)); const where = and(isNull(researchOrdersTable.archivedAt), status ? eq(researchOrdersTable.status, status) : undefined, search ? or(ilike(researchOrdersTable.researchNo, `%${search}%`), ilike(researchOrdersTable.title, `%${search}%`), ilike(researchOrdersTable.universityName, `%${search}%`), sql`${researchOrdersTable.customerId} in (select id from customers where name ilike ${`%${search}%`} or full_name ilike ${`%${search}%`} or phone ilike ${`%${search}%`})`) : undefined); const [items, count] = await Promise.all([db.select().from(researchOrdersTable).where(where).orderBy(desc(researchOrdersTable.createdAt)).limit(30).offset((page - 1) * 30), db.select({ count: sql<number>`count(*)::int` }).from(researchOrdersTable).where(where)]); return json({ items, pagination: { page, pageSize: 30, total: count[0]?.count || 0 } }); }
    if (method === "POST" && !parts[3]) { const permission = denied(user, "research.create"); if (permission) return permission; const result = await createResearchOrder(await requestBody(req), user); return result.response ?? json(result, 201); }
    if (parts[3]) { const id = Number(parts[3]); if (!Number.isFinite(id)) return error("معرف البحث غير صحيح", 400); if (method === "GET") { const detail = await orderDetail(id); return detail ? json(detail) : error("طلب البحث غير موجود", 404); } if (method === "PATCH") { const permission = denied(user, "research.edit"); if (permission) return permission; const result = await updateOrder(id, await requestBody(req), user); return result.response ?? json(result); } if (method === "POST" && parts[4] === "payment") { const permission = denied(user, "research.payment.receive"); if (permission) return permission; const body = await requestBody(req); const result = await applyPayment(id, numeric(body?.amount), String(body?.paymentMethod || "cash"), user, body?.idempotencyKey); return result.response ?? json(result); } if (method === "POST" && parts[4] === "sources") { const permission = denied(user, "research.sources.manage"); if (permission) return permission; const body = await requestBody(req); const source = body?.source as SourceResult; if (!source?.provider || !source?.externalId || !source?.title) return error("بيانات المصدر غير مكتملة", 400); const [saved] = await db.insert(researchSourcesTable).values({ provider: source.provider, externalId: source.externalId, title: source.title, authors: source.authors || [], journal: source.journal || null, publicationYear: source.year || null, abstract: source.abstract || null, doi: source.doi || null, language: source.language || null, category: source.category || null, url: source.url || null, pdfUrl: source.pdfUrl || null, isOpenAccess: Boolean(source.openAccess), metadata: source.metadata || {} }).onConflictDoUpdate({ target: [researchSourcesTable.provider, researchSourcesTable.externalId], set: { title: source.title, authors: source.authors || [], journal: source.journal || null, abstract: source.abstract || null, updatedAt: new Date() } }).returning(); await db.insert(researchOrderSourcesTable).values({ researchOrderId: id, sourceId: saved.id, addedBy: user.id }).onConflictDoNothing(); const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(researchOrderSourcesTable).where(eq(researchOrderSourcesTable.researchOrderId, id)); await db.update(researchOrdersTable).set({ sourceCount: count.count, updatedAt: new Date() }).where(eq(researchOrdersTable.id, id)); await trace(id, "research_source_added", `تمت إضافة المصدر ${saved.title}`, user, { sourceId: saved.id }); return json({ source: saved }, 201); } }
  }
  if (resource === "chapters" && parts[3] && method === "PATCH") { const permission = denied(user, "research.chapters.manage"); if (permission) return permission; const chapterId = Number(parts[3]); const chapter = await db.query.researchChaptersTable.findFirst({ where: eq(researchChaptersTable.id, chapterId) }); if (!chapter) return error("الفصل غير موجود", 404); const body = await requestBody(req); const content = body?.content === undefined ? (chapter.content || "") : String(body.content ?? ""); const version = chapter.currentVersion + (body?.content !== undefined && content !== chapter.content ? 1 : 0); if (version !== chapter.currentVersion) await db.insert(researchChapterVersionsTable).values({ chapterId, version, content, wordCount: content.trim() ? content.trim().split(/\s+/).length : 0, changeNote: String(body?.changeNote || "تحديث الفصل"), createdBy: user.id, createdByName: actorName(user) }); const [saved] = await db.update(researchChaptersTable).set({ title: body?.title ?? chapter.title, status: body?.status ?? chapter.status, progress: Math.max(0, Math.min(100, Number(body?.progress ?? chapter.progress))), assignedWriterId: body?.assignedWriterId ?? chapter.assignedWriterId, deadline: body?.deadline ?? chapter.deadline, content, wordCount: content.trim() ? content.trim().split(/\s+/).length : 0, currentVersion: version, approvalStatus: body?.approvalStatus ?? chapter.approvalStatus, approvedAt: body?.approvalStatus === "approved" ? new Date() : chapter.approvedAt, updatedAt: new Date() }).where(eq(researchChaptersTable.id, chapterId)).returning(); await trace(chapter.researchOrderId, "research_chapter_updated", `تم تحديث ${saved.title}`, user, { chapterId, version }); return json({ chapter: saved }); }
  if (resource === "files" && method === "POST") {
    const permission = denied(user, "research.files.manage"); if (permission) return permission;
    const body = await requestBody(req); const orderId = Number(body?.orderId); const title = String(body?.title || body?.fileName || "").trim(); const fileName = String(body?.fileName || "").trim(); const fileType = String(body?.fileType || "draft").trim();
    if (!Number.isFinite(orderId) || !title || !fileName || !body?.fileUrl) return error("بيانات الملف غير مكتملة", 400);
    const order = await db.query.researchOrdersTable.findFirst({ where: eq(researchOrdersTable.id, orderId) }); if (!order) return error("طلب البحث غير موجود", 404);
    const [latest] = await db.select({ version: sql<number>`coalesce(max(${researchFilesTable.version}), 0)::int` }).from(researchFilesTable).where(and(eq(researchFilesTable.researchOrderId, orderId), eq(researchFilesTable.fileType, fileType), eq(researchFilesTable.title, title)));
    const fileUrl = await persistFile(String(body.fileUrl), fileName, orderId, body?.mimeType); const version = (latest?.version || 0) + 1;
    const [saved] = await db.insert(researchFilesTable).values({ researchOrderId: orderId, chapterId: body?.chapterId ? Number(body.chapterId) : null, fileType, title, fileUrl, fileName, mimeType: body?.mimeType || null, fileSize: body?.fileSize ? Number(body.fileSize) : null, version, isCustomerVisible: Boolean(body?.isCustomerVisible), uploadedBy: user.id, uploadedByName: actorName(user) }).returning();
    await trace(orderId, "research_file_uploaded", `تم رفع ${title} - الإصدار ${version}`, user, { fileId: saved.id, fileType, version }); return json({ file: saved }, 201);
  }
  if (resource === "messages" && method === "POST") {
    const body = await requestBody(req); const orderId = Number(body?.orderId); const message = String(body?.message || "").trim(); if (!Number.isFinite(orderId) || message.length < 2) return error("اكتب رسالة صحيحة", 400);
    const [saved] = await db.insert(researchMessagesTable).values({ researchOrderId: orderId, chapterId: body?.chapterId ? Number(body.chapterId) : null, senderType: "staff", senderId: user.id, senderName: actorName(user), message, isInternal: Boolean(body?.isInternal) }).returning();
    await trace(orderId, "research_staff_message", "أرسل فريق البحث رسالة", user, { messageId: saved.id, internal: saved.isInternal }); return json({ message: saved }, 201);
  }
  if (resource === "sources" && parts[3] === "search" && method === "GET") {
    const q = req.nextUrl.searchParams.get("q")?.trim() || ""; if (q.length < 2) return error("اكتب كلمة بحث أو DOI", 400);
    const provider = req.nextUrl.searchParams.get("provider") || "all";
    const author = req.nextUrl.searchParams.get("author")?.trim() || ""; const journal = req.nextUrl.searchParams.get("journal")?.trim() || "";
    const language = req.nextUrl.searchParams.get("language")?.trim().toLowerCase() || ""; const category = req.nextUrl.searchParams.get("category")?.trim().toLowerCase() || "";
    const providerQuery = [q, author, journal].filter(Boolean).join(" ");
    const rows = await searchSources(providerQuery, provider, req.nextUrl.searchParams.get("year") || undefined);
    const results = rows.filter((source) => (!author || source.authors.some((name) => name.toLowerCase().includes(author.toLowerCase()))) && (!journal || String(source.journal || "").toLowerCase().includes(journal.toLowerCase())) && (!language || String(source.language || "").toLowerCase().includes(language)) && (!category || String(source.category || "").toLowerCase().includes(category)));
    return json({ results, provider, providerLinks: { googleScholar: `https://scholar.google.com/scholar?q=${encodeURIComponent(providerQuery)}`, pubmed: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(providerQuery)}`, arxiv: `https://arxiv.org/search/?query=${encodeURIComponent(providerQuery)}&searchtype=all`, doaj: `https://doaj.org/search/articles?ref=homepage-box&q=${encodeURIComponent(providerQuery)}` } });
  }
  if (resource === "ai" && method === "POST") { const result = await aiGenerate(await requestBody(req), user); return result.response ?? json(result); }
  if (resource === "citations" && parts[3] && method === "POST") { const id = Number(parts[3]); const order = await db.query.researchOrdersTable.findFirst({ where: eq(researchOrdersTable.id, id) }); if (!order) return error("طلب البحث غير موجود", 404); const rows = await db.select({ source: researchSourcesTable }).from(researchOrderSourcesTable).innerJoin(researchSourcesTable, eq(researchSourcesTable.id, researchOrderSourcesTable.sourceId)).where(eq(researchOrderSourcesTable.researchOrderId, id)); const citations = []; for (const { source } of rows) { const text = citationFor(source, order.citationStyle); const [saved] = await db.insert(researchCitationsTable).values({ researchOrderId: id, sourceId: source.id, style: order.citationStyle, citationText: text, bibliographyText: text }).onConflictDoUpdate({ target: [researchCitationsTable.researchOrderId, researchCitationsTable.sourceId, researchCitationsTable.style], set: { citationText: text, bibliographyText: text } }).returning(); citations.push(saved); } return json({ citations }); }
  if (resource === "plagiarism" && method === "POST") { const permission = denied(user, "research.plagiarism.manage"); if (permission) return permission; const body = await requestBody(req); const percentage = numeric(body?.similarityPercentage); if (percentage < 0 || percentage > 100) return error("نسبة التشابه يجب أن تكون بين 0 و100", 400); const status = percentage <= 20 ? "passed" : percentage <= 40 ? "need_revision" : "rejected"; const [saved] = await db.insert(researchPlagiarismReportsTable).values({ researchOrderId: Number(body?.orderId), similarityPercentage: String(percentage), status, provider: String(body?.provider || "manual"), reportUrl: body?.reportUrl || null, notes: body?.notes || null, checkedBy: user.id }).returning(); await trace(saved.researchOrderId, "research_plagiarism_reported", `تم تسجيل فحص استلال بنسبة ${percentage}%`, user, { status }); return json({ report: saved }, 201); }
  if (resource === "catalog") { if (method === "GET") { const [universities, templates, writers] = await Promise.all([db.select().from(researchUniversitiesTable).orderBy(asc(researchUniversitiesTable.nameAr)), db.select().from(researchTemplatesTable).orderBy(desc(researchTemplatesTable.createdAt)), db.select({ id: staffTable.id, name: staffTable.fullName, username: staffTable.username, role: staffTable.role }).from(staffTable).where(eq(staffTable.isActive, true)).orderBy(asc(staffTable.fullName))]); return json({ universities, templates, writers, integrations: { ai: Boolean(process.env.OPENAI_API_KEY), storage: Boolean(STORAGE_URL && STORAGE_SERVICE_KEY), semanticScholarKey: Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY), ncbiKey: Boolean(process.env.NCBI_API_KEY) } }); } }
  if (resource === "templates" && method === "POST") { const permission = denied(user, "research.settings.manage"); if (permission) return permission; const body = await requestBody(req); const name = String(body?.name || "").trim(); if (name.length < 2) return error("اسم القالب مطلوب", 400); const code = String(body?.code || `RST-${randomUUID().slice(0, 8)}`).toUpperCase(); const [saved] = await db.insert(researchTemplatesTable).values({ code, name, researchType: body?.researchType || null, universityId: body?.universityId ? Number(body.universityId) : null, language: String(body?.language || "ar"), citationStyle: String(body?.citationStyle || "APA7"), structure: Array.isArray(body?.structure) ? body.structure : CHAPTERS.map(([chapterType, title], sortOrder) => ({ chapterType, title, sortOrder })), formatting: body?.formatting && typeof body.formatting === "object" ? body.formatting : {}, createdBy: user.id }).returning(); return json({ template: saved }, 201); }
  if (resource === "universities" && method === "POST") { const permission = denied(user, "research.settings.manage"); if (permission) return permission; const body = await requestBody(req); const nameAr = String(body?.nameAr || "").trim(); if (nameAr.length < 2) return error("اسم الجامعة مطلوب", 400); const code = String(body?.code || `UNI-${randomUUID().slice(0, 8)}`).toUpperCase(); const [saved] = await db.insert(researchUniversitiesTable).values({ code, nameAr, nameEn: body?.nameEn || null, country: body?.country || null, city: body?.city || null, colleges: Array.isArray(body?.colleges) ? body.colleges : [], createdBy: user.id }).returning(); return json({ university: saved }, 201); }
  if (resource === "reports" && method === "GET") return json(await dashboard());
  return error("مسار مركز الأبحاث غير موجود", 404);
}
