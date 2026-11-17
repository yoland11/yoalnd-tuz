import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { InvalidJsonBodyError, RequestBodyTooLargeError, readRequestBody } from "@/server/request-body";
import {
  adminActivityLogsTable,
  customersTable,
  db,
  entityTimelineTable,
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
import { RESEARCH_WORKFLOW_STAGES, RESEARCH_CATEGORIES, ACADEMIC_LEVELS } from "@/lib/research-contract";
import { createApiErrorPayload, makeRequestId, mapWriteError } from "@/server/write-safety";
import { reconcilePaymentState } from "@/server/payment-state";
import { assertResearchPriceChange, createResearchPaymentRequest, requestResearchPayment, getResearchFinancialAccount, getResearchStudentStatement, listResearchExpenses, createResearchExpense, ResearchFinanceError } from "@/server/research-finance";
import { handleResearchAnalytics } from "@/server/research-analytics";
import { ensureResearchCenterTables } from "@/server/research-center-schema";
import {getResearchPurchases,linkResearchPurchase} from './research-purchases';

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
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value; }, "التاريخ غير صحيح");
const nullableDate = z.preprocess(value => value === "" || value === null ? null : value, calendarDate.nullable().optional());
const optionalId = z.preprocess(value => value === undefined ? undefined : value === "" || value === null ? null : value, z.coerce.number().int().positive().nullable().optional());
const moneyField=z.coerce.number().finite().min(0).max(999999999999.99).multipleOf(0.01);
const academicLevel = z.enum(["bachelor", "master", "phd"]);
const researchCategory = z.enum(["theoretical", "software", "hardware", "data_analysis", "matlab", "python", "arduino", "proofreading", "other"]);
export const researchOrderSchema = z.object({
  customerId: optionalId, assignedWriterId: optionalId,
  titleEnglish: z.string().trim().max(500).nullable().optional(), academicLevel: academicLevel.nullable().optional(), researchCategory: researchCategory.nullable().optional(),
  paymentDueDate: nullableDate, idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9:_-]{8,120}$/).optional(),
  initialPaymentMethod: z.enum(["cash", "transfer", "card", "pos", "other"]).default("cash"), initialPaymentDate: nullableDate, initialPaymentNotes: z.string().trim().max(2000).optional(),
  customerName: z.string().trim().min(2).max(160).optional(), phone: z.string().trim().min(10).max(30).optional(), title: z.string().trim().min(5).max(500),
  researchType: z.enum(["graduation", "diploma", "bachelor", "master", "phd", "article", "conference", "report"]),
  universityId: optionalUniversityId, universityName: z.string().trim().min(2).max(240), college: optionalString, department: optionalString,
  supervisorName: optionalString, language: z.enum(["ar", "en", "ku", "other"]).default("ar"), researchField: z.string().trim().max(240).optional().default(""),
  keywords: z.union([z.array(z.string()), z.string()]).transform((value) => Array.isArray(value) ? value.map(String).filter(Boolean) : value.split(/[,،]/).map((item) => item.trim()).filter(Boolean)).default([]),
  requiredPages: z.coerce.number().int().min(1).max(2000), deadline: nullableDate, citationStyle: z.enum(["APA7", "IEEE", "MLA", "Harvard", "Chicago"]).default("APA7"),
  urgency: z.enum(["normal", "urgent", "critical"]).default("normal"), estimatedPrice: moneyField.default(0), deposit: moneyField.default(0), notes: optionalString,
  files: z.array(z.object({ title: z.string().trim().min(1).max(300), fileName: z.string().trim().min(1).max(255), fileUrl: z.string().min(1).max(9_000_000), mimeType: optionalString, fileType: z.string().trim().max(80).default("customer_upload") })).max(10).default([]),
}).superRefine((data,ctx)=>{if(!data.customerId){if(!data.customerName)ctx.addIssue({code:"custom",path:["customerName"],message:"اسم الزبون مطلوب"});if(!data.phone)ctx.addIssue({code:"custom",path:["phone"],message:"رقم الهاتف مطلوب"});}});
export const researchPatchSchema = z.object({
  titleEnglish:z.string().trim().max(500).nullable().optional(),academicLevel:academicLevel.nullable().optional(),researchCategory:researchCategory.nullable().optional(),paymentDueDate:nullableDate,
  workflowStage:z.enum(["new","requirements_review","in_progress","quality_review","ready","completed"]).optional(),
  researchType:z.enum(["graduation","diploma","bachelor","master","phd","article","conference","report"]).optional(),
  universityName:z.string().trim().min(2).max(240).optional(),college:z.string().trim().max(240).optional(),department:z.string().trim().max(240).optional(),supervisorName:z.string().trim().max(240).nullable().optional(),
  requiredPages:z.coerce.number().int().min(1).max(2000).optional(),language:z.enum(["ar","en","ku","other"]).optional(),urgency:z.enum(["normal","urgent","critical"]).optional(),
  title: z.string().trim().min(5).max(500).optional(), status: z.enum(RESEARCH_STATUSES).optional(), progress: z.coerce.number().int().min(0).max(100).optional(), deadline: nullableDate,
  assignedWriterId: z.coerce.number().int().positive().nullable().optional(), assignedReviewerId: z.coerce.number().int().positive().nullable().optional(), assignedProofreaderId: z.coerce.number().int().positive().nullable().optional(), assignedFormatterId: z.coerce.number().int().positive().nullable().optional(), assignedSupervisorId: z.coerce.number().int().positive().nullable().optional(),
  estimatedPrice: moneyField.optional(), discountAmount: moneyField.optional(), notes: optionalString,
});

function json(data: unknown, status = 200) { return NextResponse.json(data, { status }); }
function error(message: string, status = 400, details?: unknown) { return structuredError(message, { status, details }); }

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
function structuredError(message: string, opts: { status?: number; fieldErrors?: Record<string, string>; errorCode?: string; requestId?: string; details?: unknown } = {}) {
  const payload = createApiErrorPayload({ message, status: opts.status ?? 400, requestId: opts.requestId ?? makeRequestId(), fieldErrors: opts.fieldErrors });
  return NextResponse.json({ ...payload, errorCode: opts.errorCode ?? payload.code, ...(opts.details ? { details: opts.details } : {}) }, {status: opts.status ?? 400, headers:{"x-request-id":payload.requestId}});
}
class ResearchOperationError extends Error { constructor(message:string, public status = 422, public code = "VALIDATION_ERROR") { super(message); } }
function researchFailure(err:unknown, operation:string, user?:ResearchAdminUser|null) {
  const requestId = makeRequestId();
  if(err instanceof InvalidJsonBodyError || err instanceof RequestBodyTooLargeError)return structuredError(err instanceof RequestBodyTooLargeError?"حجم الطلب أكبر من المسموح":"صيغة JSON غير صحيحة",{status:err instanceof RequestBodyTooLargeError?413:400,requestId,errorCode:"VALIDATION_ERROR"});
  const known = err instanceof ResearchOperationError || err instanceof ResearchFinanceError;
  const databaseCode = String((err as any)?.code || (err as any)?.cause?.code || "UNKNOWN").replace(/[^A-Z0-9_-]/gi, "").slice(0,32);
  console.error("[research] operation failed", { requestId, operation, actorId:user?.id ?? null, databaseCode, status:known ? err.status : 500 });
  const mapped=mapWriteError((err as any)?.cause ?? err);
  return structuredError(known ? err.message : mapped.message, {status:known ? err.status : mapped.status,errorCode:known ? err.code : mapped.code,requestId});
}
export function researchNonfinancialOrder<T extends Record<string,unknown>>(record:T) { const {estimatedPrice,discountAmount,totalAmount,paidAmount,remainingAmount,paymentStatus,creationKey,...safe} = record; return safe; }
function fieldError(field: string, message: string, errorCode = "VALIDATION_ERROR") {
  return structuredError(message, { fieldErrors: { [field]: message }, errorCode });
}
async function requestBody(req: NextRequest) { return readRequestBody(req); }
function actorName(user?: ResearchAdminUser | null) { return user ? user.fullName || user.username : "الموقع"; }
function allowed(user: ResearchAdminUser, permission: string) { return user.role === "admin" || user.permissions.includes("research") || user.permissions.includes(permission); }
function denied(user: ResearchAdminUser, permission: string) { return allowed(user, permission) ? null : error("لا تملك صلاحية تنفيذ هذا الإجراء", 403); }
function numeric(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function today() { return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }

async function traceTx(executor: Executor, orderId: number, action: string, description: string, user?: ResearchAdminUser | null, metadata: Record<string, unknown> = {}) {
  await Promise.all([
    executor.insert(entityTimelineTable).values({ entityType: "research_order", entityId: orderId, type: action, title: description, body: description, actorId: user?.id ?? null, actorName: actorName(user), metadata }),
    executor.insert(adminActivityLogsTable).values({ staffId: user?.id ?? null, userName: actorName(user), action, entityType: "research_order", entityId: orderId, metadata }),
  ]);
}
async function trace(orderId:number,action:string,description:string,user?:ResearchAdminUser|null,metadata:Record<string,unknown>={}) { return traceTx(db,orderId,action,description,user,metadata); }
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
// `normalized` is the already-normalized phone; reuses an existing customer to
// avoid duplicates, otherwise creates one. Runs inside the caller's transaction.
async function ensureCustomerTx(tx: Executor, normalized: string, name: string, customerId?: number | null) {
  if (customerId) { const [selected] = await tx.select().from(customersTable).where(eq(customersTable.id,customerId)).limit(1); if (!selected) throw new ResearchOperationError("الزبون المختار غير موجود",404,"NOT_FOUND"); return selected; }
  await tx.execute(sql`select pg_advisory_xact_lock(82178, hashtext(${normalized}))`);
  const digits=sql`regexp_replace(translate(${customersTable.phone},'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g')`;
  const matches=await tx.select().from(customersTable).where(sql`${digits} IN (${normalized},${`0${normalized.slice(3)}`},${`00${normalized}`},${`9640${normalized.slice(3)}`})`).orderBy(asc(customersTable.id)).limit(2);
  const existing=matches.find(customer=>customer.phone===normalized) ?? (matches.length===1?matches[0]:null);
  if(!existing && matches.length>1)throw new ResearchOperationError("يوجد أكثر من زبون بهذا الهاتف؛ اختر الزبون الموجود",409,"CUSTOMER_AMBIGUOUS");
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
  let validated:ReturnType<typeof validateResearchFileData>;
  try{validated=validateResearchFileData(value,fileName,claimedMime);}catch(err){throw new ResearchOperationError(err instanceof Error?err.message:"بيانات الملف غير صحيحة");}
  if (validated.existingUrl) throw new ResearchOperationError("ارفع محتوى الملف لإصدار جديد بدلاً من ربط ملف عام");
  if (!STORAGE_URL || !STORAGE_SERVICE_KEY || !RESEARCH_PRIVATE_BUCKET) throw new ResearchOperationError("خدمة تخزين الملفات الخاصة غير مهيأة",503,"STORAGE_UNAVAILABLE");
  const path = `research/${orderId}/${Date.now()}-${randomUUID()}.${validated.extension}`;
  const response = await fetch(`${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/${RESEARCH_PRIVATE_BUCKET}/${path}`, { method: "POST", headers: { authorization: `Bearer ${STORAGE_SERVICE_KEY}`, apikey: STORAGE_SERVICE_KEY, "content-type": validated.mime!, "x-upsert": "false" }, body: validated.bytes! });
  if (!response.ok) throw new ResearchOperationError("تعذر حفظ الملف في التخزين",502,"STORAGE_UPLOAD_FAILED");
  return {fileUrl:`private:${path}`, mimeType:validated.mime!, fileSize:validated.bytes!.length, checksum:createHash("sha256").update(validated.bytes!).digest("hex")};
}

function encodedStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function validResearchPrivatePath(stored:string, orderId:number) {
  if (!stored.startsWith(`private:research/${orderId}/`)) return false;
  const path = stored.slice(8);
  return !path.includes("%") && !path.includes("\\") && !path.split("/").some(segment => segment === ".." || segment === "." || !segment);
}
async function authorizedResearchFileUrl(stored: string, orderId:number) {
  if (!stored.startsWith("private:")) return stored;
  if (!STORAGE_URL || !STORAGE_SERVICE_KEY || !RESEARCH_PRIVATE_BUCKET)
    throw new ResearchOperationError("خدمة تخزين الملفات الخاصة غير مهيأة",503,"STORAGE_UNAVAILABLE");
  const path = stored.slice("private:".length);
  if (!validResearchPrivatePath(stored,orderId))
    throw new ResearchOperationError("مسار ملف البحث غير صالح",409,"INVALID_FILE_PATH");
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
  if (!response.ok) throw new ResearchOperationError("تعذر إصدار رابط آمن لملف البحث",502,"STORAGE_SIGNING_FAILED");
  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signed = payload.signedURL || payload.signedUrl;
  if (!signed) throw new ResearchOperationError("تعذر إصدار رابط آمن لملف البحث",502,"STORAGE_SIGNING_FAILED");
  return new URL(signed, `${STORAGE_URL.replace(/\/$/, "")}/`).toString();
}

async function createInvoiceTx(tx: Executor, order: any, customer: any, user?: ResearchAdminUser | null) {
  const [invoice] = await tx.insert(salesInvoicesTable).values({ invoiceNo: `RS-TMP-${randomUUID().replace(/-/g, "")}`, qrToken: order.qrToken, date: today(), customerName: customer.fullName || customer.name, customerPhone: customer.phone, customerId: customer.id, subtotal: String(order.estimatedPrice), discountAmount: String(order.discountAmount), total: String(order.totalAmount), paidAmount: "0", remainingAmount: String(order.totalAmount), paymentMethod: "cash", paymentStatus: numeric(order.totalAmount) ? "unpaid" : "paid", dueDate: order.paymentDueDate ?? null, status: "active", isInternal: 0, stockApplied: 0, notes: `فاتورة خدمة بحث أكاديمي ${order.researchNo}`, createdBy: user?.id ?? null, createdByName: actorName(user) }).returning();
  const invoiceNo = `AJN-RS-INV-${String(invoice.id).padStart(6, "0")}`;
  await tx.update(salesInvoicesTable).set({ invoiceNo }).where(eq(salesInvoicesTable.id, invoice.id));
  await tx.insert(salesInvoiceItemsTable).values({ invoiceId: invoice.id, productName: `خدمة بحث أكاديمي - ${order.title}`, quantity: "1", unitPrice: String(order.estimatedPrice), discount: String(order.discountAmount), total: String(order.totalAmount), costPrice: "0" });
  return { ...invoice, invoiceNo };
}

async function createResearchOrder(raw: unknown, user?: ResearchAdminUser | null) {
  await ensureResearchCenterTables();
  const parsed = researchOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { response: structuredError("تحقق من بيانات طلب البحث", { fieldErrors: fieldErrorsFromZod(parsed.error), errorCode: "VALIDATION_ERROR" }) };
  }
  const data = parsed.data;
  const normalizedPhone = data.phone ? normalizeIraqiPhone(data.phone) : null;
  if (!data.customerId && !normalizedPhone) return { response: fieldError("phone", "رقم الهاتف غير صحيح") };
  if (!user && (data.customerId || data.assignedWriterId || data.deposit)) return {response:error("البيانات المالية واختيار الزبائن والتكليف متاح للفريق المخول فقط",403)};
  if (data.assignedWriterId && user && !allowed(user,"research.assign")) return {response:error("لا تملك صلاحية توزيع فريق البحث",403)};
  if (user && (data.estimatedPrice > 0 || data.deposit > 0) && !allowed(user,"research.financials.view")) return {response:error("لا تملك صلاحية إدارة مالية البحث",403)};
  if (data.deposit > 0 && user && !allowed(user,"research.payment.receive")) return {response:error("لا تملك صلاحية استلام الدفعات",403)};
  const total = data.estimatedPrice;
  if (data.deposit > total) return { response: fieldError("deposit", "العربون لا يمكن أن يتجاوز إجمالي الطلب") };
  const token = randomUUID().replace(/-/g, "");
  const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const creationKey = data.idempotencyKey ? `${user?.id ?? "public"}:${data.idempotencyKey}` : null;
  try {
    const result = await db.transaction(async (tx) => {
      if (creationKey) {
        await tx.execute(sql`select pg_advisory_xact_lock(82179, hashtext(${creationKey}))`);
        const [existing] = await tx.select().from(researchOrdersTable).where(eq(researchOrdersTable.creationKey,creationKey)).limit(1);
        if (existing) {
          const [event] = await tx.select().from(adminActivityLogsTable).where(and(eq(adminActivityLogsTable.entityType,"research_order"),eq(adminActivityLogsTable.entityId,existing.id),eq(adminActivityLogsTable.action,"research_created"))).limit(1);
          if ((event?.metadata as any)?.creationFingerprint !== fingerprint) throw new ResearchOperationError("معرف الإنشاء مستخدم ببيانات مختلفة",409,"IDEMPOTENCY_CONFLICT");
          const [invoice] = existing.invoiceId ? await tx.select().from(salesInvoicesTable).where(eq(salesInvoicesTable.id,existing.invoiceId)).limit(1) : [];
          return {order:existing,invoice,duplicate:true};
        }
      }
      const customer = await ensureCustomerTx(tx, normalizedPhone || "", data.customerName || "", data.customerId);
      if (data.assignedWriterId) await validateResearchAssignee(tx,data.assignedWriterId);
      const [draft] = await tx.insert(researchOrdersTable).values({ researchNo: `RS-TMP-${randomUUID()}`, qrToken: token, creationKey, customerId: customer.id, title: data.title, titleEnglish:data.titleEnglish || null, academicLevel:data.academicLevel ?? null, researchCategory:data.researchCategory ?? null,paymentDueDate:data.paymentDueDate ?? null, assignedWriterId:data.assignedWriterId ?? null, researchType: data.researchType, universityId: data.universityId ?? null, universityName: data.universityName, college: data.college || "", department: data.department || "", supervisorName: data.supervisorName || null, language: data.language, researchField: data.researchField, keywords: data.keywords, requiredPages: data.requiredPages, deadline: data.deadline || null, citationStyle: data.citationStyle, urgency: data.urgency, notes: data.notes || null, estimatedPrice: String(total), totalAmount: String(total), paidAmount: "0", remainingAmount: String(total), paymentStatus: total ? "unpaid" : "paid", chapterCount: CHAPTERS.length, createdBy: user?.id ?? null, createdByName: actorName(user) }).returning();
      const researchNo = `AJN-RS-${new Date().getFullYear()}-${String(draft.id).padStart(6, "0")}`;
      const [order] = await tx.update(researchOrdersTable).set({ researchNo, updatedAt: new Date() }).where(eq(researchOrdersTable.id, draft.id)).returning();
      await tx.insert(researchChaptersTable).values(CHAPTERS.map(([chapterType,title],sortOrder)=>({researchOrderId:order.id,chapterType,title,sortOrder,assignedWriterId:data.assignedWriterId ?? null})));
      if (data.assignedWriterId) await tx.insert(researchAssignmentsTable).values({researchOrderId:order.id,staffId:data.assignedWriterId,role:"writer",assignedBy:user?.id ?? null});
      const invoice = await createInvoiceTx(tx, order, customer, user);
      await tx.update(researchOrdersTable).set({invoiceId:invoice.id}).where(eq(researchOrdersTable.id,order.id));
      const initialVersions=new Map<string,number>();
      for (const file of data.files) {
        const identity=JSON.stringify([file.fileType,file.title]);const version=(initialVersions.get(identity)??0)+1;initialVersions.set(identity,version);
        const metadata = await persistFile(file.fileUrl,file.fileName,order.id,file.mimeType);
        await tx.insert(researchFilesTable).values({researchOrderId:order.id,fileType:file.fileType,title:file.title,version,...metadata,fileName:file.fileName,isCustomerVisible:true,uploadedBy:user?.id ?? null,uploadedByName:actorName(user)});
      }
      await tx.insert(researchStatusEventsTable).values({researchOrderId:order.id,toStatus:"new",changedBy:user?.id ?? null,changedByName:actorName(user)});
      if (data.deposit > 0 && user) await createResearchPaymentRequest(tx,{orderId:order.id,amount:data.deposit,paymentMethod:data.initialPaymentMethod,paymentDate:data.initialPaymentDate ?? undefined,notes:data.initialPaymentNotes,idempotencyKey:`initial:${data.idempotencyKey ?? order.id}`},user);
      await traceTx(tx,order.id,"research_created",`تم إنشاء طلب البحث ${researchNo}`,user,{invoiceId:invoice.id,creationFingerprint:fingerprint});
      await tx.insert(notificationsTable).values([{audienceType:"admin",type:"research_order_new",title:"طلب بحث أكاديمي جديد",body:`${researchNo} - ${order.title}`,entityType:"research_order",entityId:order.id,href:"/admin/research/orders"},{audienceType:"customer",customerId:customer.id,type:"research_created",title:"تم استلام طلب البحث",body:`${researchNo} قيد المراجعة`,entityType:"research_order",entityId:order.id,href:`/research/track/${order.qrToken}`}]);
      return {order:{...order,invoiceId:invoice.id},invoice,duplicate:false};
    });
    const visibleOrder = user && !allowed(user,"research.financials.view") ? researchNonfinancialOrder(result.order) : result.order;
    const {creationKey: _private, ...safeOrder} = visibleOrder as any;
    return {order:{...safeOrder,trackingUrl:`/research/track/${result.order.qrToken}`},...(user && allowed(user,"research.financials.view") ? {invoice:result.invoice} : {}),duplicate:result.duplicate};
  } catch (err) { return {response:researchFailure(err,"research_order_create",user)}; }
}

// Payments use createAndExecuteSourceFinancialTransaction via createResearchPaymentRequest;
// sourceType: "research_order" remains centrally approved and reconciled.
async function orderDetail(id: number, customerSafe = false, financials = true) {
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
  const customerRecord = customerSafe || !financials ? { id:customer?.id,name:customer?.fullName || customer?.name || "",fullName:customer?.fullName,phone:customer?.phone || "" } : customer;
  const authorizedFiles = await Promise.all(files.map(async (file) => ({ ...file, fileUrl: await authorizedResearchFileUrl(file.fileUrl,id) })));
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
  const {creationKey: _private, ...safeOrder} = order;
  return { order: financials ? safeOrder : researchNonfinancialOrder(safeOrder), customer: customerRecord, chapters, sources: sourceRows.map((row) => ({ ...row.source, link: row.link })), citations, files: authorizedFiles, plagiarism, plagiarismReports:plagiarism, messages, timeline:financials ? timeline : timeline.filter(event => !/payment|expense|financial/.test(event.type)).map(({metadata,...event})=>event), assignments:financials ? assignments : assignments.map(({assignment,...rest})=>({ ...rest,assignment:(( {hourlyRate,rating,...safe})=>safe)(assignment)})) };
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
async function searchSources(query: string, provider: string, year?: string) { const adapters: Record<string, () => Promise<SourceResult[]>> = { crossref: () => searchCrossref(query, year), openalex: () => searchOpenAlex(query, year), semantic_scholar: () => searchSemantic(query, year), pubmed: () => searchPubMed(query, year), doaj: () => searchDoaj(query, year), arxiv: () => searchArxiv(query, year) }; if (provider !== "all") {if(!adapters[provider])throw new ResearchOperationError("مزود المصادر غير معروف"); try{return await adapters[provider]();}catch{throw new ResearchOperationError("تعذر الاتصال بمزود المصادر المحدد",502,"SOURCE_PROVIDER_UNAVAILABLE");}} const settled = await Promise.allSettled(Object.values(adapters).map((run) => run())); if(settled.every(result=>result.status==="rejected"))throw new ResearchOperationError("تعذر الاتصال بمزودي المصادر؛ حاول مجدداً",502,"SOURCE_PROVIDERS_UNAVAILABLE"); return settled.flatMap((item) => item.status === "fulfilled" ? item.value : []).filter((item, index, rows) => rows.findIndex((other) => (other.doi && other.doi === item.doi) || `${other.provider}:${other.externalId}` === `${item.provider}:${item.externalId}`) === index).slice(0, 36); }

function citationFor(source: any, style: string) { const authors = (source.authors || []).join(", ") || "مؤلف غير معروف"; const year = source.publicationYear || "د.ت"; const title = source.title; const journal = source.journal || ""; const doi = source.doi ? `https://doi.org/${source.doi}` : source.url || ""; if (style === "IEEE") return `${authors}, “${title},” ${journal}, ${year}. ${doi}`; if (style === "MLA") return `${authors}. “${title}.” ${journal}, ${year}. ${doi}`; if (style === "Harvard") return `${authors} (${year}) '${title}', ${journal}. ${doi}`; if (style === "Chicago") return `${authors}. “${title}.” ${journal} (${year}). ${doi}`; return `${authors} (${year}). ${title}. ${journal}. ${doi}`; }

async function aiGenerate(raw: unknown, user: ResearchAdminUser) {
  const schema = z.object({ orderId: z.coerce.number().int().positive(), chapterId: z.coerce.number().int().positive().optional(), action: z.string().min(2).max(60), prompt: z.string().min(2).max(12000), sourceIds: z.array(z.coerce.number().int().positive()).min(1, "اختر مصدراً واحداً على الأقل") });
  const parsed = schema.safeParse(raw); if (!parsed.success) return { response: error("يجب اختيار مصادر موثقة قبل استخدام المساعد", 400, parsed.error.issues) };
  const data = parsed.data; const order = await db.query.researchOrdersTable.findFirst({where:eq(researchOrdersTable.id,data.orderId)}); if(!order)return {response:error("طلب البحث غير موجود",404)}; if(data.chapterId){const chapter=await db.query.researchChaptersTable.findFirst({where:and(eq(researchChaptersTable.id,data.chapterId),eq(researchChaptersTable.researchOrderId,data.orderId))}); if(!chapter)return {response:error("الفصل غير مرتبط بهذا البحث",404)};} const linked = await db.select({ source: researchSourcesTable }).from(researchOrderSourcesTable).innerJoin(researchSourcesTable, eq(researchSourcesTable.id, researchOrderSourcesTable.sourceId)).where(and(eq(researchOrderSourcesTable.researchOrderId, data.orderId), inArray(researchSourcesTable.id, data.sourceIds)));
  if (linked.length !== data.sourceIds.length) return { response: error("بعض المصادر المختارة غير مرتبطة بهذا البحث", 400) };
  const key = process.env.OPENAI_API_KEY; if (!key) return { response: error("مساعد الذكاء الاصطناعي غير مهيأ حالياً", 503) };
  const sourceBlock = linked.map(({ source }, index) => `[S${index + 1}] ${citationFor(source, "APA7")}\nAbstract: ${source.abstract || "غير متوفر"}`).join("\n\n");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0.25, messages: [{ role: "system", content: "أنت مساعد بحث أكاديمي. استخدم حصراً المصادر المرفقة. كل ادعاء من مصدر يجب أن يحمل [S#]. لا تخترع مراجع أو DOI أو معلومات غير موجودة. إذا لم تكفِ المصادر صرّح بذلك." }, { role: "user", content: `الإجراء: ${data.action}\nالمطلوب: ${data.prompt}\n\nالمصادر المسموحة فقط:\n${sourceBlock}` }] }) });
  if (!response.ok) return { response: error("تعذر تشغيل مساعد البحث", 502) };
  const payload = await response.json(); const output = String(payload?.choices?.[0]?.message?.content || "").trim();
  if(!output)return {response:error("أعاد مساعد البحث استجابة فارغة؛ حاول مجدداً",502)};
  const invalid = [...output.matchAll(/\[S(\d+)\]/g)].some((match) => Number(match[1]) < 1 || Number(match[1]) > linked.length);
  if (invalid) return { response: error("تم رفض النص لأن إشارة مرجعية غير موثقة ظهرت في الناتج", 422) };
  await db.transaction(async tx=>{await lockedResearchOrder(tx,data.orderId);if(data.chapterId)await ownedResearchChapter(tx,data.chapterId,data.orderId);await tx.insert(researchAiGenerationsTable).values({researchOrderId:data.orderId,chapterId:data.chapterId??null,action:data.action,prompt:data.prompt,output,sourceIds:data.sourceIds,model,createdBy:user.id});await traceTx(tx,data.orderId,"research_ai_generated",`تم تنفيذ ${data.action} بالمصادر المحددة`,user,{sourceIds:data.sourceIds,chapterId:data.chapterId});});
  return { output, citations: linked.map(({ source }, index) => ({ key: `S${index + 1}`, sourceId: source.id, citation: citationFor(source, "APA7") })) };
}

async function validateResearchAssignee(tx:Executor,id:number) {
  const [staff] = await tx.select({id:staffTable.id,isActive:staffTable.isActive}).from(staffTable).where(eq(staffTable.id,id)).limit(1);
  if (!staff?.isActive) throw new ResearchOperationError("الموظف المختار غير موجود أو غير نشط");
}
async function lockedResearchOrder(tx:Executor,id:number) {
  await tx.execute(sql`select pg_advisory_xact_lock(82177, ${id})`);
  const [order] = await tx.select().from(researchOrdersTable).where(eq(researchOrdersTable.id,id)).for("update").limit(1);
  if (!order) throw new ResearchOperationError("طلب البحث غير موجود",404,"NOT_FOUND"); return order;
}
async function ownedResearchChapter(tx:Executor,chapterId:number,orderId:number) {
  const [chapter] = await tx.select().from(researchChaptersTable).where(and(eq(researchChaptersTable.id,chapterId),eq(researchChaptersTable.researchOrderId,orderId))).limit(1);
  if (!chapter) throw new ResearchOperationError("الفصل غير مرتبط بهذا البحث",404,"NOT_FOUND"); return chapter;
}
async function updateOrder(id:number,raw:unknown,user:ResearchAdminUser) {
  const parsed = researchPatchSchema.safeParse(raw); if (!parsed.success) return {response:structuredError("تحقق من بيانات تحديث البحث",{fieldErrors:fieldErrorsFromZod(parsed.error)})};
  const {workflowStage,...data} = parsed.data;
  if (workflowStage) data.status = RESEARCH_WORKFLOW_STAGES.find(stage=>stage.key===workflowStage)!.targetStatus;
  const roles = [["assignedWriterId","writer"],["assignedReviewerId","reviewer"],["assignedProofreaderId","proofreader"],["assignedFormatterId","formatter"],["assignedSupervisorId","supervisor"]] as const;
  const assignmentNames=new Set<string>(roles.map(([key])=>key));
  const needsEdit=Object.entries(data).some(([key,value])=>value!==undefined&&!assignmentNames.has(key)&&!(key==="status"&&value==="archived"));
  if(needsEdit&&!allowed(user,"research.edit"))return {response:error("لا تملك صلاحية تعديل البحث",403)};
  if (roles.some(([key])=>data[key]!==undefined) && !allowed(user,"research.assign")) return {response:error("لا تملك صلاحية توزيع فريق البحث",403)};
  if (data.status === "archived" && !allowed(user,"research.archive")) return {response:error("لا تملك صلاحية أرشفة البحث",403)};
  if ((data.estimatedPrice!==undefined || data.discountAmount!==undefined || data.paymentDueDate!==undefined) && !allowed(user,"research.financials.view")) return {response:error("لا تملك صلاحية تعديل مالية البحث",403)};
  try {
    const saved = await db.transaction(async tx=>{
      const current = await lockedResearchOrder(tx,id);
      if(current.archivedAt&&data.status&&data.status!=='archived'&&!allowed(user,'research.archive'))throw new ResearchOperationError('لا تملك صلاحية استعادة البحث من الأرشيف',403,'PERMISSION_DENIED');
      for(const [key] of roles) if(data[key]) await validateResearchAssignee(tx,data[key]!);
      if(data.status === "delivered" && current.status !== "delivered") {
        if(current.status !== "completed") throw new ResearchOperationError("يجب تجهيز البحث قبل التسليم",409,"INVALID_TRANSITION");
        const [file] = await tx.select({id:researchFilesTable.id}).from(researchFilesTable).where(and(eq(researchFilesTable.researchOrderId,id),eq(researchFilesTable.isCustomerVisible,true),eq(researchFilesTable.fileType,"final"))).limit(1);
        if(!file) throw new ResearchOperationError("أضف نسخة نهائية ظاهرة للزبون قبل التسليم",409,"FINAL_FILE_REQUIRED");
      }
      const values:typeof researchOrdersTable.$inferInsert = {...data,researchNo:current.researchNo,qrToken:current.qrToken,customerId:current.customerId,title:data.title ?? current.title,researchType:data.researchType ?? current.researchType,estimatedPrice:undefined,discountAmount:undefined,updatedAt:new Date()};
      if(current.archivedAt&&data.status&&data.status!=='archived')values.archivedAt=null;
      const moneyChange = data.estimatedPrice!==undefined || data.discountAmount!==undefined;
      if(moneyChange) {
        const estimated = data.estimatedPrice ?? numeric(current.estimatedPrice), discount = data.discountAmount ?? numeric(current.discountAmount);
        if(discount > estimated) throw new ResearchOperationError("الخصم يتجاوز السعر");
        const total = (Math.round(estimated*100)-Math.round(discount*100))/100; await assertResearchPriceChange(tx,id,total);
        Object.assign(values,{estimatedPrice:String(estimated),discountAmount:String(discount),totalAmount:String(total)});
        if(current.invoiceId) {
          await tx.update(salesInvoicesTable).set({subtotal:String(estimated),discountAmount:String(discount),total:String(total),updatedAt:new Date()}).where(eq(salesInvoicesTable.id,current.invoiceId));
          await tx.update(salesInvoiceItemsTable).set({unitPrice:String(estimated),discount:String(discount),total:String(total),productName:`خدمة بحث أكاديمي - ${values.title}`}).where(eq(salesInvoiceItemsTable.invoiceId,current.invoiceId));
        }
      }
      if(data.status){values.progress=data.progress ?? STATUS_PROGRESS[data.status]; if(data.status==="accepted"&&!current.acceptedAt)values.acceptedAt=new Date();if(data.status==="completed"&&!current.completedAt)values.completedAt=new Date();if(data.status==="delivered"&&!current.deliveredAt)values.deliveredAt=new Date();if(data.status==="archived"&&!current.archivedAt)values.archivedAt=new Date();}
      await tx.update(researchOrdersTable).set(values).where(eq(researchOrdersTable.id,id));
      if(current.invoiceId && data.title!==undefined)await tx.update(salesInvoiceItemsTable).set({productName:`خدمة بحث أكاديمي - ${data.title}`}).where(eq(salesInvoiceItemsTable.invoiceId,current.invoiceId));
      if(current.invoiceId && data.paymentDueDate!==undefined) await tx.update(salesInvoicesTable).set({dueDate:data.paymentDueDate,updatedAt:new Date()}).where(eq(salesInvoicesTable.id,current.invoiceId));
      if(moneyChange) await reconcilePaymentState(tx,{sourceType:"research_order",sourceId:id});
      if(data.status && data.status!==current.status){ await tx.insert(researchStatusEventsTable).values({researchOrderId:id,fromStatus:current.status,toStatus:data.status,changedBy:user.id,changedByName:actorName(user)}); await tx.insert(notificationsTable).values({audienceType:"customer",customerId:current.customerId,type:`research_${data.status}`,title:RESEARCH_STATUS_LABELS[data.status],body:`${current.researchNo} - ${RESEARCH_STATUS_LABELS[data.status]}`,entityType:"research_order",entityId:id,href:`/research/track/${current.qrToken}`}); }
      for(const [key,role] of roles){if(data[key]===undefined)continue;await tx.update(researchAssignmentsTable).set({status:"revoked",completedAt:new Date()}).where(and(eq(researchAssignmentsTable.researchOrderId,id),eq(researchAssignmentsTable.role,role),inArray(researchAssignmentsTable.status,["assigned","accepted"])));if(data[key])await tx.insert(researchAssignmentsTable).values({researchOrderId:id,staffId:data[key]!,role,assignedBy:user.id}).onConflictDoUpdate({target:[researchAssignmentsTable.researchOrderId,researchAssignmentsTable.staffId,researchAssignmentsTable.role],set:{status:"assigned",assignedBy:user.id,assignedAt:new Date(),completedAt:null}});}
      await traceTx(tx,id,"research_updated","تم تحديث طلب البحث",user,{
        changes:Object.keys(data).filter(key=>(data as Record<string,unknown>)[key]!==undefined),
        ...((moneyChange||data.paymentDueDate!==undefined)?{financialChanges:{
          before:{estimatedPrice:current.estimatedPrice,discountAmount:current.discountAmount,totalAmount:current.totalAmount,paymentDueDate:current.paymentDueDate},
          after:{estimatedPrice:values.estimatedPrice??current.estimatedPrice,discountAmount:values.discountAmount??current.discountAmount,totalAmount:values.totalAmount??current.totalAmount,paymentDueDate:data.paymentDueDate===undefined?current.paymentDueDate:data.paymentDueDate},
        }}:{}),
      });
      const [order]=await tx.select().from(researchOrdersTable).where(eq(researchOrdersTable.id,id));return order;
    });
    const {creationKey:_private,...safe}=saved; return {order:allowed(user,"research.financials.view") ? safe : researchNonfinancialOrder(safe)};
  } catch(err){return {response:researchFailure(err,"research_order_update",user)};}
}

export async function handleResearchPublic(req:NextRequest,parts:string[]):Promise<NextResponse>{
 try{return await handleResearchPublicRequest(req,parts);}catch(err){return researchFailure(err,"research_public_route");}
}
async function handleResearchPublicRequest(req:NextRequest,parts:string[]):Promise<NextResponse>{
 await ensureResearchCenterTables();const method=req.method,resource=parts[1]||"config";
 if(method==="GET"&&resource==="config"){
  const universities=await db.select().from(researchUniversitiesTable).where(eq(researchUniversitiesTable.isActive,true)).orderBy(asc(researchUniversitiesTable.nameAr));
  return json({universities,researchTypes:["graduation","diploma","bachelor","master","phd","article","conference","report"],citationStyles:["APA7","IEEE","MLA","Harvard","Chicago"],academicLevels:ACADEMIC_LEVELS,researchCategories:RESEARCH_CATEGORIES,workflowStages:RESEARCH_WORKFLOW_STAGES});
 }
 if(method==="POST"&&resource==="orders"){const result=await createResearchOrder(await requestBody(req));return result.response??json(result,201);}
 if(resource!=="track"||!parts[2])return error("المسار غير موجود",404);
 const order=await db.query.researchOrdersTable.findFirst({where:eq(researchOrdersTable.qrToken,parts[2])});if(!order)return error("رمز متابعة البحث غير صحيح",404);
 if(method==="GET"&&!parts[3]){const detail=await orderDetail(order.id,true);const qrDataUrl=await QRCode.toDataURL(`${req.nextUrl.origin}/research/track/${order.qrToken}`,{width:280,margin:1});return json({...detail,qrDataUrl});}
 if(method==="POST"&&parts[3]==="sources"&&parts[4]){
  const sourceId=validId(parts[4]);const body=await requestBody(req);if(body?.selected!==undefined&&typeof body.selected!=="boolean")return error("اختيار المصدر غير صحيح");
  const saved=await db.transaction(async tx=>{await lockedResearchOrder(tx,order.id);const [link]=await tx.update(researchOrderSourcesTable).set({selectedByCustomer:body?.selected!==false}).where(and(eq(researchOrderSourcesTable.researchOrderId,order.id),eq(researchOrderSourcesTable.sourceId,sourceId))).returning();if(!link)throw new ResearchOperationError("المصدر غير مرتبط بهذا البحث",404,"NOT_FOUND");await traceTx(tx,order.id,link.selectedByCustomer?"research_source_customer_selected":"research_source_customer_unselected",link.selectedByCustomer?"اعتمد الزبون مصدراً للبحث":"ألغى الزبون اعتماد مصدر",null,{sourceId});return link;});
  return json({source:saved});
 }
 if(method==="POST"&&parts[3]==="messages"){
  const parsed=z.object({message:z.string().trim().min(2).max(10000),senderName:z.string().trim().min(1).max(160).default("الزبون")}).safeParse(await requestBody(req));if(!parsed.success)return error("اكتب رسالة صحيحة");
  await db.transaction(async tx=>{await lockedResearchOrder(tx,order.id);await tx.insert(researchMessagesTable).values({researchOrderId:order.id,senderType:"customer",senderId:order.customerId,senderName:parsed.data.senderName,message:parsed.data.message});await traceTx(tx,order.id,"research_customer_message","أرسل الزبون رسالة",null);});return json({sent:true},201);
 }
 if(method==="POST"&&parts[3]==="chapters"&&parts[4]){
  const chapterId=validId(parts[4]);const parsed=z.object({action:z.enum(["approve","revision","revision_request","request_revision"]),note:z.string().trim().max(10000).optional()}).safeParse(await requestBody(req));if(!parsed.success)return error("إجراء مراجعة الفصل غير صحيح");
  const action=parsed.data.action==="approve"?"approved":"revision_requested",note=parsed.data.note||"";if(action==="revision_requested"&&note.length<2)return error("اكتب التعديل المطلوب");
  await db.transaction(async tx=>{await lockedResearchOrder(tx,order.id);const chapter=await ownedResearchChapter(tx,chapterId,order.id);await tx.update(researchChaptersTable).set({approvalStatus:action,approvedAt:action==="approved"?new Date():null,updatedAt:new Date()}).where(eq(researchChaptersTable.id,chapterId));if(note)await tx.insert(researchMessagesTable).values({researchOrderId:order.id,chapterId,senderType:"customer",senderId:order.customerId,senderName:"الزبون",message:note});await traceTx(tx,order.id,action==="approved"?"research_chapter_approved":"research_chapter_revision_requested",action==="approved"?`اعتمد الزبون ${chapter.title}`:`طلب الزبون تعديل ${chapter.title}`,null,{chapterId,note});});return json({status:action});
 }
 return error("المسار غير موجود",404);
}

function validId(value:unknown) {const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw new ResearchOperationError("المعرف غير صحيح");return id;}
const chapterWriteSchema=z.object({orderId:optionalId,title:z.string().trim().min(1).max(300).optional(),content:z.string().max(2_000_000).optional(),status:z.enum(["not_started","in_progress","writing","review","completed"]).optional(),progress:z.coerce.number().int().min(0).max(100).optional(),assignedWriterId:optionalId,deadline:nullableDate,approvalStatus:z.enum(["pending","approved","revision_requested"]).optional(),changeNote:z.string().trim().max(2000).optional(),versionId:optionalId});
async function writeResearchChapter(chapterId:number,raw:unknown,user:ResearchAdminUser,restore=false){
 const parsed=chapterWriteSchema.safeParse(raw);if(!parsed.success)throw new ResearchOperationError("بيانات الفصل غير صحيحة");const data=parsed.data;
 if(data.assignedWriterId!==undefined&&!allowed(user,"research.assign"))throw new ResearchOperationError("لا تملك صلاحية التكليف",403,"PERMISSION_DENIED");
 return db.transaction(async tx=>{
  const [found]=await tx.select().from(researchChaptersTable).where(eq(researchChaptersTable.id,chapterId)).limit(1);if(!found)throw new ResearchOperationError("الفصل غير موجود",404,"NOT_FOUND");
  if(data.orderId&&data.orderId!==found.researchOrderId)throw new ResearchOperationError("الفصل غير مرتبط بهذا البحث",404,"NOT_FOUND");
  await lockedResearchOrder(tx,found.researchOrderId); const chapter=await ownedResearchChapter(tx,chapterId,found.researchOrderId);
  if(data.assignedWriterId)await validateResearchAssignee(tx,data.assignedWriterId);
  let content=data.content??chapter.content??"";
  if(restore){if(!data.versionId)throw new ResearchOperationError("اختر الإصدار المطلوب");const [version]=await tx.select().from(researchChapterVersionsTable).where(and(eq(researchChapterVersionsTable.id,data.versionId),eq(researchChapterVersionsTable.chapterId,chapterId))).limit(1);if(!version)throw new ResearchOperationError("الإصدار غير مرتبط بهذا الفصل",404,"NOT_FOUND");content=version.content;}
  const changed=restore||(data.content!==undefined&&content!==(chapter.content??""));const version=chapter.currentVersion+(changed?1:0);const wordCount=content.trim()?content.trim().split(/\s+/).length:0;
  if(changed){await tx.insert(researchChapterVersionsTable).values({chapterId,version:chapter.currentVersion,content:chapter.content??"",wordCount:chapter.wordCount,changeNote:"الإصدار السابق",createdBy:user.id,createdByName:actorName(user)}).onConflictDoNothing();await tx.insert(researchChapterVersionsTable).values({chapterId,version,content,wordCount,changeNote:data.changeNote||(restore?"استعادة إصدار سابق":"تحديث الفصل"),createdBy:user.id,createdByName:actorName(user)});}
  const [saved]=await tx.update(researchChaptersTable).set({title:data.title??chapter.title,status:data.status??chapter.status,progress:data.progress??chapter.progress,assignedWriterId:data.assignedWriterId===undefined?chapter.assignedWriterId:data.assignedWriterId,deadline:data.deadline===undefined?chapter.deadline:data.deadline,content,wordCount,currentVersion:version,approvalStatus:changed?"pending":data.approvalStatus??chapter.approvalStatus,approvedAt:changed?null:data.approvalStatus==="approved"?new Date():data.approvalStatus==="revision_requested"?null:chapter.approvedAt,updatedAt:new Date()}).where(eq(researchChaptersTable.id,chapterId)).returning();
  await traceTx(tx,chapter.researchOrderId,"research_chapter_updated",`تم تحديث ${saved.title}`,user,{chapterId,version,restored:restore});return {chapter:saved};
 });
}
const fileWriteSchema=z.object({orderId:z.coerce.number().int().positive(),chapterId:optionalId,title:z.string().trim().min(1).max(300),fileName:z.string().trim().min(1).max(255),fileType:z.enum(["draft","final","customer_upload","reference","plagiarism_report","plagiarism","instructions","data","revision","other"]).default("draft"),fileUrl:z.string().max(9_000_000),mimeType:z.string().max(120).optional(),isCustomerVisible:z.boolean().default(false)});
async function uploadResearchFile(raw:unknown,user:ResearchAdminUser){
 const parsed=fileWriteSchema.safeParse(raw);if(!parsed.success)throw new ResearchOperationError("بيانات الملف غير صحيحة");const data=parsed.data;
 return db.transaction(async tx=>{await lockedResearchOrder(tx,data.orderId);if(data.chapterId)await ownedResearchChapter(tx,data.chapterId,data.orderId);
 const [latest]=await tx.select({version:sql<number>`coalesce(max(${researchFilesTable.version}),0)::int`}).from(researchFilesTable).where(and(eq(researchFilesTable.researchOrderId,data.orderId),eq(researchFilesTable.fileType,data.fileType),eq(researchFilesTable.title,data.title),data.chapterId?eq(researchFilesTable.chapterId,data.chapterId):isNull(researchFilesTable.chapterId)));
 const metadata=await persistFile(data.fileUrl,data.fileName,data.orderId,data.mimeType);const version=(latest?.version||0)+1;
 const [saved]=await tx.insert(researchFilesTable).values({researchOrderId:data.orderId,chapterId:data.chapterId??null,title:data.title,fileName:data.fileName,fileType:data.fileType,...metadata,version,isCustomerVisible:data.isCustomerVisible,uploadedBy:user.id,uploadedByName:actorName(user)}).returning();await traceTx(tx,data.orderId,"research_file_uploaded",`تم رفع ${data.title} - الإصدار ${version}`,user,{fileId:saved.id,version,checksum:metadata.checksum});return {file:{...saved,fileUrl:await authorizedResearchFileUrl(saved.fileUrl,data.orderId)}};});
}
const messageWriteSchema=z.object({orderId:z.coerce.number().int().positive(),chapterId:optionalId,message:z.string().trim().min(2).max(10000),messageType:z.enum(["message","supervisor_feedback","revision_request"]).default("message"),isInternal:z.boolean().default(false)});
async function writeResearchMessage(raw:unknown,user:ResearchAdminUser){const parsed=messageWriteSchema.safeParse(raw);if(!parsed.success)throw new ResearchOperationError("بيانات الرسالة غير صحيحة");const data=parsed.data;
 return db.transaction(async tx=>{await lockedResearchOrder(tx,data.orderId);if(data.chapterId)await ownedResearchChapter(tx,data.chapterId,data.orderId);const message=data.messageType==="supervisor_feedback"?`[ملاحظات المشرف] ${data.message}`:data.messageType==="revision_request"?`[طلب تعديل] ${data.message}`:data.message;
 const [saved]=await tx.insert(researchMessagesTable).values({researchOrderId:data.orderId,chapterId:data.chapterId??null,senderType:"staff",senderId:user.id,senderName:actorName(user),message,isInternal:data.isInternal}).returning();if(data.messageType==="revision_request"&&data.chapterId)await tx.update(researchChaptersTable).set({approvalStatus:"revision_requested",approvedAt:null,updatedAt:new Date()}).where(eq(researchChaptersTable.id,data.chapterId));await traceTx(tx,data.orderId,"research_staff_message","أرسل فريق البحث رسالة",user,{messageId:saved.id,messageType:data.messageType,internal:data.isInternal});return {message:saved};});
}
async function addResearchSource(id:number,body:any,user:ResearchAdminUser){const source=body?.source as SourceResult;if(!source?.provider||!source?.externalId||!source?.title)throw new ResearchOperationError("بيانات المصدر غير مكتملة");
 return db.transaction(async tx=>{await lockedResearchOrder(tx,id);const [saved]=await tx.insert(researchSourcesTable).values({provider:source.provider,externalId:source.externalId,title:source.title,authors:source.authors||[],journal:source.journal||null,publicationYear:source.year||null,abstract:source.abstract||null,doi:source.doi||null,language:source.language||null,category:source.category||null,url:source.url||null,pdfUrl:source.pdfUrl||null,isOpenAccess:Boolean(source.openAccess),metadata:source.metadata||{}}).onConflictDoUpdate({target:[researchSourcesTable.provider,researchSourcesTable.externalId],set:{title:source.title,authors:source.authors||[],journal:source.journal||null,abstract:source.abstract||null,updatedAt:new Date()}}).returning();await tx.insert(researchOrderSourcesTable).values({researchOrderId:id,sourceId:saved.id,addedBy:user.id}).onConflictDoNothing();const [count]=await tx.select({count:sql<number>`count(*)::int`}).from(researchOrderSourcesTable).where(eq(researchOrderSourcesTable.researchOrderId,id));await tx.update(researchOrdersTable).set({sourceCount:count.count,updatedAt:new Date()}).where(eq(researchOrdersTable.id,id));await traceTx(tx,id,"research_source_added",`تمت إضافة المصدر ${saved.title}`,user,{sourceId:saved.id});return json({source:saved},201);});}

export async function handleAdminResearch(req:NextRequest,parts:string[],user:ResearchAdminUser):Promise<NextResponse|null> {
  if(parts[1]!=="research")return null;
  try{return await handleAdminResearchRequest(req,parts,user);}catch(err){return researchFailure(err,"research_admin_route",user);}
}
async function handleAdminResearchRequest(req: NextRequest, parts: string[], user: ResearchAdminUser): Promise<NextResponse | null> {
  await ensureResearchCenterTables(); const method=req.method, resource=parts[2]||"dashboard";
  if(!user.isActive)return error("الحساب غير نشط",403);
  const analytics=await handleResearchAnalytics(req,parts,user); if(analytics)return analytics;
  const orderSubresource=resource==="orders" ? parts[4] : undefined;
  if(resource==='orders'&&orderSubresource==='purchases'){
    const gate=denied(user,'research.financials.view');if(gate)return gate;
    const id=validId(parts[3]);
    if(method==='GET')return json(await getResearchPurchases(id,req.nextUrl.searchParams,user));
    if(method==='POST')return json(await linkResearchPurchase(id,await requestBody(req),user),201);
    return error('طريقة الطلب غير مسموحة',405);
  }
  const permission=resource==="ai"?"research.ai.use":resource==="sources"||resource==="citations"||orderSubresource==="sources"?"research.sources.manage":resource==="plagiarism"?"research.plagiarism.manage":resource==="templates"||resource==="universities"?"research.settings.manage":resource==="chapters"?"research.chapters.manage":resource==="files"?(method==="GET"?"research.view":"research.files.manage"):resource==="messages"?"research.edit":resource==="students"||orderSubresource==="financials"||orderSubresource==="expenses"?"research.financials.view":orderSubresource==="payment"?"research.payment.receive":resource==="orders"&&method==="POST"&&!parts[3]?"research.create":resource==="orders"&&method==="PATCH"?null:"research.view";
  const contextualRead=resource==="catalog"&&method==="GET"&&["research.view","research.create","research.edit","research.assign","research.financials.view","research.payment.receive","research.reports.view","research.settings.manage"].some(grant=>allowed(user,grant)) || resource==="chapters"&&method==="GET"&&allowed(user,"research.view") || resource==="files"&&method==="GET"&&allowed(user,"research.files.manage");
  const gate=permission && !contextualRead ? denied(user,permission) : null;if(gate)return gate;
  if(resource==="students"&&parts[3]&&parts[4]==="statement"&&method==="GET")return json(await getResearchStudentStatement(validId(parts[3]),req.nextUrl.searchParams));
  if(resource==="orders") {
    if(method==="POST"&&!parts[3]){const result=await createResearchOrder(await requestBody(req),user);return result.response??json(result,201);}
    if(parts[3]){
      const id=validId(parts[3]);
      if(orderSubresource==="financials"&&method==="GET")return json(await getResearchFinancialAccount(id));
      if(orderSubresource==="expenses"){if(method==="GET")return json(await listResearchExpenses(id,req.nextUrl.searchParams));if(method==="POST")return json(await createResearchExpense(id,await requestBody(req),user),201);}
      if(orderSubresource==="payment"&&method==="POST")return json(await requestResearchPayment(id,await requestBody(req),user));
      if(orderSubresource==="sources"&&method==="POST")return addResearchSource(id,await requestBody(req),user);
      if(method==="GET"&&!orderSubresource){const detail=await orderDetail(id,false,allowed(user,"research.financials.view"));return detail?json(detail):error("طلب البحث غير موجود",404);}
      if(method==="PATCH"&&!orderSubresource){const result=await updateOrder(id,await requestBody(req),user);return result.response??json(result);}
    }
  }
  if(resource==="chapters"&&parts[3]) {
    const chapterId=validId(parts[3]);
    if(method==="GET"&&parts[4]==="versions"){
      const chapter=await db.query.researchChaptersTable.findFirst({where:eq(researchChaptersTable.id,chapterId)});if(!chapter)return error("الفصل غير موجود",404);
      const versions=await db.select().from(researchChapterVersionsTable).where(eq(researchChapterVersionsTable.chapterId,chapterId)).orderBy(desc(researchChapterVersionsTable.version));return json({chapter,versions});
    }
    if(method==="PATCH"||(method==="POST"&&parts[4]==="restore"))return json(await writeResearchChapter(chapterId,await requestBody(req),user,parts[4]==="restore"));
  }
  if(resource==="files"&&method==="POST")return json(await uploadResearchFile(await requestBody(req),user),201);
  if(resource==="files"&&method==="GET"&&parts[3]&&parts[4]==="versions"){
    const file=await db.query.researchFilesTable.findFirst({where:eq(researchFilesTable.id,validId(parts[3]))});if(!file)return error("الملف غير موجود",404);
    const versions=await db.select().from(researchFilesTable).where(and(eq(researchFilesTable.researchOrderId,file.researchOrderId),eq(researchFilesTable.title,file.title),eq(researchFilesTable.fileType,file.fileType),file.chapterId?eq(researchFilesTable.chapterId,file.chapterId):isNull(researchFilesTable.chapterId))).orderBy(desc(researchFilesTable.version));return json({versions:await Promise.all(versions.map(async version=>({...version,fileUrl:await authorizedResearchFileUrl(version.fileUrl,version.researchOrderId)})))});
  }
  if(resource==="messages"&&method==="POST")return json(await writeResearchMessage(await requestBody(req),user),201);
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
  if(resource==="citations"&&parts[3]&&method==="POST"){
    const id=validId(parts[3]);const citations=await db.transaction(async tx=>{const order=await lockedResearchOrder(tx,id);const rows=await tx.select({source:researchSourcesTable}).from(researchOrderSourcesTable).innerJoin(researchSourcesTable,eq(researchSourcesTable.id,researchOrderSourcesTable.sourceId)).where(eq(researchOrderSourcesTable.researchOrderId,id));const result=[];
      for(const {source} of rows){const text=citationFor(source,order.citationStyle);const [saved]=await tx.insert(researchCitationsTable).values({researchOrderId:id,sourceId:source.id,style:order.citationStyle,citationText:text,bibliographyText:text}).onConflictDoUpdate({target:[researchCitationsTable.researchOrderId,researchCitationsTable.sourceId,researchCitationsTable.style],set:{citationText:text,bibliographyText:text}}).returning();result.push(saved);}return result;});return json({citations});
  }
  if(resource==="plagiarism"&&method==="POST"){
    const parsed=z.object({orderId:z.coerce.number().int().positive(),fileId:optionalId,similarityPercentage:z.coerce.number().finite().min(0).max(100),provider:z.string().trim().max(80).default("manual"),reportUrl:z.union([z.literal(""),z.url().refine(url=>/^https?:/.test(url))]).optional(),notes:z.string().trim().max(10000).optional()}).safeParse(await requestBody(req));if(!parsed.success)return error("بيانات تقرير الاستلال غير صحيحة");const data=parsed.data;
    const saved=await db.transaction(async tx=>{await lockedResearchOrder(tx,data.orderId);if(data.fileId){const [file]=await tx.select({id:researchFilesTable.id}).from(researchFilesTable).where(and(eq(researchFilesTable.id,data.fileId),eq(researchFilesTable.researchOrderId,data.orderId))).limit(1);if(!file)throw new ResearchOperationError("الملف غير مرتبط بهذا البحث",404,"NOT_FOUND");}
      const status=data.similarityPercentage<=20?"passed":data.similarityPercentage<=40?"need_revision":"rejected";const [report]=await tx.insert(researchPlagiarismReportsTable).values({researchOrderId:data.orderId,fileId:data.fileId??null,similarityPercentage:String(data.similarityPercentage),status,provider:data.provider,reportUrl:data.reportUrl||null,notes:data.notes||null,checkedBy:user.id}).returning();await traceTx(tx,data.orderId,"research_plagiarism_reported",`تم تسجيل فحص استلال بنسبة ${data.similarityPercentage}%`,user,{status,fileId:data.fileId??null});return report;});return json({report:saved},201);
  }
  if (resource === "catalog") { if (method === "GET") { const [universities, templates, writers] = await Promise.all([db.select().from(researchUniversitiesTable).orderBy(asc(researchUniversitiesTable.nameAr)), db.select().from(researchTemplatesTable).orderBy(desc(researchTemplatesTable.createdAt)), db.select({ id: staffTable.id, name: staffTable.fullName, username: staffTable.username, role: staffTable.role }).from(staffTable).where(eq(staffTable.isActive, true)).orderBy(asc(staffTable.fullName))]); return json({ universities, templates, writers, integrations: { ai: Boolean(process.env.OPENAI_API_KEY), storage: Boolean(STORAGE_URL && STORAGE_SERVICE_KEY), semanticScholarKey: Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY), ncbiKey: Boolean(process.env.NCBI_API_KEY) } }); } }
  if (resource === "templates" && method === "POST") { const permission = denied(user, "research.settings.manage"); if (permission) return permission; const body = await requestBody(req); const name = String(body?.name || "").trim(); if (name.length < 2) return error("اسم القالب مطلوب", 400); const code = String(body?.code || `RST-${randomUUID().slice(0, 8)}`).toUpperCase(); const [saved] = await db.insert(researchTemplatesTable).values({ code, name, researchType: body?.researchType || null, universityId: body?.universityId ? Number(body.universityId) : null, language: String(body?.language || "ar"), citationStyle: String(body?.citationStyle || "APA7"), structure: Array.isArray(body?.structure) ? body.structure : CHAPTERS.map(([chapterType, title], sortOrder) => ({ chapterType, title, sortOrder })), formatting: body?.formatting && typeof body.formatting === "object" ? body.formatting : {}, createdBy: user.id }).returning(); return json({ template: saved }, 201); }
  if (resource === "universities" && method === "POST") { const permission = denied(user, "research.settings.manage"); if (permission) return permission; const body = await requestBody(req); const nameAr = String(body?.nameAr || "").trim(); if (nameAr.length < 2) return error("اسم الجامعة مطلوب", 400); const code = String(body?.code || `UNI-${randomUUID().slice(0, 8)}`).toUpperCase(); const [saved] = await db.insert(researchUniversitiesTable).values({ code, nameAr, nameEn: body?.nameEn || null, country: body?.country || null, city: body?.city || null, colleges: Array.isArray(body?.colleges) ? body.colleges : [], createdBy: user.id }).returning(); return json({ university: saved }, 201); }
  return error("مسار مركز الأبحاث غير موجود", 404);
}
