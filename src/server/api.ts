import { revalidateTag } from "next/cache";
import { autoTranslate, autoTranslateStatus } from "@/server/translate";
import { after, NextResponse, type NextRequest } from "next/server";
import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import webpush from "web-push";
import { z } from "zod/v4";
import { and, asc, desc, eq, gt, gte, ilike, inArray, like, lt, lte, or, sql } from "drizzle-orm";
import {
  adminSessionsTable,
  adminActivityLogsTable,
  attendanceRecordsTable,
  cartItemsTable,
  categoriesTable,
  couponUsagesTable,
  couponsTable,
  crewsTable,
  customerActivityLogsTable,
  customerAddressesTable,
  customerNotesTable,
  customerPreferencesTable,
  customerRewardHistoryTable,
  customersTable,
  deliveryZonesTable,
  expenseCategoriesTable,
  expensesTable,
  galleryItemsTable,
  koshaAddonsTable,
  koshaAccessoriesTable,
  koshaBookingsTable,
  koshaBookingEventsTable,
  koshaMediaTable,
  koshaDeliveryReportsTable,
  koshaPaymentRequestsTable,
  koshaStaffNotificationsTable,
  KOSHA_EXECUTION_STAGES,
  koshaImagesTable,
  koshaProvincesTable,
  koshaWelcomeBoardsTable,
  koshasTable,
  loyaltyPointsTable,
  messageRepliesTable,
  messageThreadsTable,
  notificationSettingsTable,
  notificationSubscriptionsTable,
  notificationsTable,
  orderItemsTable,
  orderReviewsTable,
  ordersTable,
  orderStatusHistoryTable,
  otpCodesTable,
  paymentVouchersTable,
  productsTable,
  receiptVouchersTable,
  reviewsTable,
  serviceOrdersTable,
  serviceOrderStatusHistoryTable,
  servicesTable,
  settingsTable,
  staffTable,
  stockMovementsTable,
  whatsappLogTable,
  suppliersTable,
  salesInvoicesTable,
  salesInvoiceItemsTable,
  purchaseInvoicesTable,
  purchaseInvoiceItemsTable,
  printTemplatesTable,
  qrTokensTable,
  db,
  dailyCashReconciliationsTable,
  dailyCashReportsTable,
  financialAccountsTable,
  financialAuditLogsTable,
  financialLedgerEntriesTable,
  financialTransactionsTable,
  masterCashBoxTable,
  taskCommentsTable,
  tasksTable,
} from "@workspace/db";
import {
  dailyCashListQuerySchema,
  getDailyCashDashboardSummary,
  listDailyCashRows,
  upsertDailyCashReconciliation,
  upsertDailyCashReconciliationSchema,
  upsertDailyCashReport,
  upsertDailyCashReportSchema,
  closeDailyCashDay,
  reopenDailyCashDay,
  approveDailyCashReconciliation,
  getFinanceDashboard,
  suggestOpeningBalance,
} from "@/server/daily-cash";
import {
  approveAndExecuteFinancialTransaction,
  cancelFinancialTransactionRequest,
  canApproveFinancialTransactions,
  createFinancialTransaction,
  createSourceFinancialRequest,
  ensureMasterCashBoxTables,
  financialTransactionInputSchema,
  financialTransactionListSchema,
  financialTransactionPatchSchema,
  getFinancialTransaction,
  getMasterCashDashboard,
  listFinancialTransactions,
  recalculateMasterCashBox,
  rejectFinancialTransaction,
  submitFinancialTransaction,
  syncSourcePaymentTarget,
  syncSourceFinancialRequest,
  updateFinancialTransaction,
  type FinancialActor,
} from "@/server/master-cash-box";
import {
  getTelegramSettings,
  notifyTelegramDailyReport,
  notifyTelegramInvoice,
  notifyTelegramKoshaBooking,
  notifyTelegramLogin,
  notifyTelegramOrder,
  notifyTelegramPayment,
  saveTelegramSettings,
  sendTelegramMessage,
  sendTelegramTestPdf,
  telegramEnvironmentStatus,
  telegramSettingsSchema,
} from "@/server/telegram";
import {
  primaryLocationFromDetails,
  withDerivedServiceDetails,
} from "@/lib/service-details";
import {
  formatIraqiPhone,
  iraqiPhoneVariants,
  normalizeIraqiPhone,
  normalizePhoneDigits,
} from "@/lib/phone";
import {
  colorKey,
  normalizeColor,
  normalizeColors,
  type ProductColor,
} from "@/lib/colors";
import {
  AddToCartBody,
  CreateDeliveryZoneBody,
  CreateGalleryItemBody,
  CreateOrderBody,
  CreateProductBody,
  CreateReviewBody,
  CreateServiceOrderBody,
  ListGalleryQueryParams,
  ListOrdersQueryParams,
  ListProductsQueryParams,
  ListReviewsQueryParams,
  RequestOtpBody,
  RespondToBookingBody,
  UpdateCartItemBody,
  UpdateDeliveryZoneBody,
  UpdateOrderStatusBody,
  UpdateProductBody,
  VerifyOtpBody,
} from "@workspace/api-zod";
import {
  DEFAULT_ENABLED,
  DEFAULT_TEMPLATES,
  PROVIDER_SPECS,
  WA_BOOKING_EVENTS,
  WA_EVENTS,
  eventForBookingStatus,
  eventForStatus,
  fireOrderEvent,
  getProviderStatus,
  getSettings as getWaSettings,
  updateSettings as updateWaSettings,
  sendOtpViaUltraMsg,
  whatsappSend,
} from "@/server/whatsapp";
import {
  PUBLIC_SETTINGS_REVALIDATE_SECONDS,
  PUBLIC_SETTINGS_TAG,
  cleanPublicUrl,
  getCachedPublicSettings,
  loadSiteSettings,
} from "@/server/public-settings";

export const COOKIE_NAME = "ajn_admin_session";
export const CUSTOMER_COOKIE_NAME = "ajn_customer_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ALL_PERMISSIONS = [
  "dashboard",
  "orders",
  "bookings",
  "services",
  "products",
  "gallery",
  "delivery",
  "customers",
  "staff",
  "settings",
  "invoices",
  "whatsapp",
  "accounting",
  "backup",
  "tasks",
  "koshas",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export type AdminUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

type Json = Record<string, unknown> | unknown[];

const isProd = process.env.NODE_ENV === "production";
const customerSessions = new Map<string, number>();

type Bucket = { count: number; resetAt: number };
const otpRequestByPhone = new Map<string, Bucket>();
const otpRequestByIp = new Map<string, Bucket>();
const otpVerifyByPhone = new Map<string, Bucket>();
const phoneLookupHits = new Map<string, number[]>();
const respondHits = new Map<string, number[]>();

let seedPromise: Promise<void> | null = null;
let crewsTablePromise: Promise<void> | null = null;
let otpTablePromise: Promise<void> | null = null;
let customerProfilePromise: Promise<void> | null = null;
let customerAddressTablesPromise: Promise<void> | null = null;
let trackingColumnsPromise: Promise<void> | null = null;
let paymentWorkflowColumnsPromise: Promise<void> | null = null;
let archiveColumnsPromise: Promise<void> | null = null;
let activityTablesPromise: Promise<void> | null = null;
let orderReviewsTablePromise: Promise<void> | null = null;
let staffActivityColumnPromise: Promise<void> | null = null;
let staffTableShapePromise: Promise<void> | null = null;
let imageMetadataColumnsPromise: Promise<void> | null = null;
let productColorColumnsPromise: Promise<void> | null = null;
let customerRewardsPromise: Promise<void> | null = null;
let performanceIndexesPromise: Promise<void> | null = null;
let couponsTablesPromise: Promise<void> | null = null;
let storeCategoryColumnsPromise: Promise<void> | null = null;
let adminExtensionsTablesPromise: Promise<void> | null = null;
let accountingTablesPromise: Promise<void> | null = null;
let stockTrackingTablesPromise: Promise<void> | null = null;
let koshaTablesPromise: Promise<void> | null = null;
let koshaStaffTablesPromise: Promise<void> | null = null;
const storeCategoriesCache = new Map<string, { expiresAt: number; payload: any[] }>();
const STORE_CATEGORIES_TTL_MS = 60_000;

function clearStoreCategoriesCache() {
  storeCategoriesCache.clear();
}

const adminLoginByIp = new Map<string, Bucket>();
const adminLoginByUsername = new Map<string, Bucket>();

function json(data: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, { status, headers });
}

function text(data: string, status = 200, headers?: HeadersInit): NextResponse {
  return new NextResponse(data, { status, headers });
}

function error(message: string, status = 400): NextResponse {
  return json({ error: message }, status);
}

function runAfter(label: string, task: () => Promise<unknown>) {
  after(async () => {
    try {
      await task();
    } catch (err: any) {
      console.error("background task failed", { label, message: err?.message });
    }
  });
}

type ValidationIssue = { field: string; message: string };

function validationError(scope: string, parsed: { error: { issues: Array<{ path: PropertyKey[]; message: string }> } }): NextResponse {
  const details: ValidationIssue[] = parsed.error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "body",
    message: issue.message,
  }));
  console.warn("API validation failed", { scope, details });
  const summary = details
    .slice(0, 4)
    .map((issue) => `${issue.field}: ${issue.message}`)
    .join("، ");
  return json({ error: summary ? `تحقق من البيانات: ${summary}` : "بيانات غير صحيحة", details }, 400);
}

async function body(req: NextRequest): Promise<any> {
  if (req.method === "GET" || req.method === "HEAD") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function query(req: NextRequest): Record<string, string> {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}

function int(value: string | undefined): number | null {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

function ip(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(map: Map<string, Bucket>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = map.get(key);
  if (!b || b.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

function rollingRateLimited(map: Map<string, number[]>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  map.set(key, hits);
  return hits.length > max;
}

function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

function generateTrackingCode(prefix = "AJN"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = prefix;
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function phoneLast4(value: string | null | undefined): string {
  const normalized = normalizeIraqiPhone(value);
  const digits = normalized ?? normalizePhoneDigits(value);
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function trackingCodeForPhone(phone: string): string {
  const last4 = phoneLast4(phone);
  return last4 ? `AJN-${last4}` : generateTrackingCode();
}

function normalizeTrackingCode(value: string): string {
  const raw = String(value ?? "").trim().toUpperCase();
  const digits = normalizePhoneDigits(raw);
  const compact = raw.replace(/[\s-]/g, "");
  if (compact.startsWith("AJN") && digits.length >= 4 && compact.length <= 7) return `AJN-${digits.slice(-4)}`;
  if (/^\d{4}$/.test(digits) && raw.length <= 4) return `AJN-${digits}`;
  return raw;
}

function trackingCodeLast4(value: string): string {
  const code = normalizeTrackingCode(value);
  const match = /^AJN-(\d{4})$/.exec(code);
  return match?.[1] ?? "";
}

function money(value: unknown): number {
  const raw = typeof value === "string" ? value.replace(/,/g, "") : value;
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function textFallback(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function nullableText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function slugFallback(value: unknown, fallback = "item"): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function numberId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeProductBarcode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .slice(0, 100);
}

function generatedProductBarcode(id: number): string {
  return `AJN${String(id).padStart(8, "0")}`;
}

async function productBarcodeExists(barcode: string, ignoreId?: number): Promise<boolean> {
  if (!barcode) return false;
  const existing = await db.query.productsTable.findFirst({ where: eq(productsTable.barcode, barcode) });
  return !!existing && existing.id !== ignoreId;
}

function paymentSummary(totalValue: unknown, depositValue: unknown, preferredStatus?: unknown) {
  const total = money(totalValue);
  const requestedDeposit = money(depositValue);
  const deposit = preferredStatus === "paid" && requestedDeposit === 0 && total > 0
    ? total
    : Math.min(requestedDeposit, total || requestedDeposit);
  const remaining = Math.max(total - deposit, 0);
  const status =
    preferredStatus === "paid" || (total > 0 && remaining === 0)
      ? "paid"
      : preferredStatus === "partial" || deposit > 0
        ? "partial"
        : "unpaid";
  return { deposit, remaining, status };
}

function sessionSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ADMIN_PASSWORD ||
    process.env.DATABASE_URL ||
    "ajn-dev-secret"
  );
}

function otpSecret(): string {
  return process.env.AUTH_SECRET || sessionSecret();
}

function hashOtp(phone: string, code: string): string {
  return createHmac("sha256", otpSecret()).update(`${phone}:${code}`).digest("hex");
}

function verifyOtpHash(phone: string, code: string, hash: string): boolean {
  const expected = hashOtp(phone, code);
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function signCustomerToken(customerId: number): string {
  const issuedAt = Date.now().toString(36);
  const nonce = randomBytes(8).toString("hex");
  const payload = `${customerId}.${issuedAt}.${nonce}`;
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `v1.${payload}.${signature}`;
}

function verifyCustomerToken(token: string): number | null {
  if (!token.startsWith("v1.")) return customerSessions.get(token) ?? null;
  const [, idText, issuedAt, nonce, signature] = token.split(".");
  if (!idText || !issuedAt || !nonce || !signature) return null;
  const payload = `${idText}.${issuedAt}.${nonce}`;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  try {
    if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  const customerId = Number.parseInt(idText, 10);
  return Number.isFinite(customerId) ? customerId : null;
}

function bearer(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

function getSessionId(req: NextRequest): string {
  return req.headers.get("x-session-id") || "anonymous";
}

function getCurrentCustomerId(req: NextRequest): number | null {
  const token = req.cookies.get(CUSTOMER_COOKIE_NAME)?.value || bearer(req);
  return token ? verifyCustomerToken(token) : null;
}

function withCustomerCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(CUSTOMER_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}

function clearCustomerCookie(response: NextResponse): NextResponse {
  response.cookies.set(CUSTOMER_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  if (!hash) return false;
  if (hash.startsWith("$2")) {
    try {
      return bcrypt.compareSync(plain, hash);
    } catch {
      return false;
    }
  }
  const [salt, expected] = hash.split(":");
  if (!salt || !expected) return false;
  try {
    const got = scryptSync(plain, salt, 64).toString("hex");
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(adminSessionsTable).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

async function destroySession(token: string): Promise<void> {
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.token, token));
}

async function pruneExpiredSessions(): Promise<void> {
  try {
    await db.delete(adminSessionsTable).where(lt(adminSessionsTable.expiresAt, new Date()));
  } catch {
    // Session cleanup is best-effort.
  }
}

async function seedAdminUser(): Promise<void> {
  try {
    await ensureStaffTableShape();
    const username = process.env.ADMIN_USERNAME?.trim() || "alijan";
    const password = process.env.ADMIN_PASSWORD?.trim();
    const fullName = process.env.ADMIN_FULL_NAME?.trim() || "المدير الرئيسي";
    const fallbackPassword = process.env.NODE_ENV === "production" ? null : "123123";
    const initialPassword = password || fallbackPassword;

    const legacy = await db.query.staffTable.findFirst({ where: eq(staffTable.username, "admin") });
    if (legacy) {
      const taken = await db.query.staffTable.findFirst({ where: eq(staffTable.username, username) });
      if (!taken) await db.update(staffTable).set({ username }).where(eq(staffTable.id, legacy.id));
    }

    const existing = await db.query.staffTable.findFirst({ where: eq(staffTable.username, username) });
    if (existing) {
      const current = Array.isArray(existing.permissions) ? existing.permissions : [];
      const missing = ALL_PERMISSIONS.filter((p) => !current.includes(p));
      if (!existing.isActive || existing.role !== "admin" || missing.length > 0) {
        await db
          .update(staffTable)
          .set({ isActive: true, role: "admin", permissions: [...ALL_PERMISSIONS] })
          .where(eq(staffTable.id, existing.id));
      }
      return;
    }

    if (!initialPassword) {
      console.error("ADMIN_PASSWORD is required to seed the first admin in production.");
      return;
    }

    await db.insert(staffTable).values({
      username,
      passwordHash: hashPassword(initialPassword),
      fullName,
      role: "admin",
      permissions: [...ALL_PERMISSIONS],
      isActive: true,
    });
  } catch (err) {
    console.error("seedAdminUser failed:", err);
  }
}

async function ensureAdminSeeded(): Promise<void> {
  seedPromise ??= seedAdminUser().then(() => pruneExpiredSessions());
  return seedPromise;
}

function readAdminToken(req: NextRequest): string | null {
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;
  return bearer(req);
}

async function getAdminUser(req: NextRequest): Promise<AdminUser | null> {
  const token = readAdminToken(req);
  if (!token) return null;
  const session = await db.query.adminSessionsTable.findFirst({
    where: and(eq(adminSessionsTable.token, token), gt(adminSessionsTable.expiresAt, new Date())),
  });
  if (!session) return null;
  const user = await db.query.staffTable.findFirst({ where: eq(staffTable.id, session.userId) });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    permissions: user.permissions ?? [],
    isActive: user.isActive,
  };
}

function hasPermission(user: AdminUser | null, perm: Permission | null): boolean {
  if (!user || !user.isActive) return false;
  if (user.role === "admin") return true;
  if (!perm) return true;
  return user.permissions.includes(perm);
}

async function requirePermission(req: NextRequest, perm: Permission): Promise<AdminUser | NextResponse> {
  const user = await getAdminUser(req);
  if (!user) return error("غير مخول", 401);
  if (!hasPermission(user, perm)) return error("ليس لديك صلاحية", 403);
  return user;
}

async function requireAnyPermission(req: NextRequest, perms: Permission[]): Promise<AdminUser | NextResponse> {
  const user = await getAdminUser(req);
  if (!user) return error("غير مخول", 401);
  if (!perms.some((perm) => hasPermission(user, perm))) return error("ليس لديك صلاحية", 403);
  return user;
}

function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

function publicUser(u: AdminUser) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    permissions: u.permissions,
    isActive: u.isActive,
  };
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function idList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((item) => Number.parseInt(String(item), 10)).filter((item) => Number.isFinite(item) && item > 0)
    : [];
}

function taskStatus(value: unknown): string {
  const status = String(value ?? "new");
  return ["new", "in_progress", "review", "completed", "cancelled"].includes(status) ? status : "new";
}

function taskPriority(value: unknown): string {
  const priority = String(value ?? "medium");
  return ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium";
}

function messageStatus(value: unknown): string {
  const status = String(value ?? "new");
  return ["new", "read", "replied", "closed"].includes(status) ? status : "new";
}

function attendanceStatus(value: unknown): string {
  const status = String(value ?? "present");
  return ["present", "out", "late", "absent"].includes(status) ? status : "present";
}

function formatTask(row: any, staffById = new Map<number, any>()) {
  const assigned = Array.isArray(row.assignedStaffIds) ? row.assignedStaffIds : row.assigned_staff_ids ?? [];
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString?.() ?? row.due_at?.toISOString?.() ?? null,
    assignedStaffIds: assigned,
    assignedStaff: assigned.map((id: number) => staffById.get(id)).filter(Boolean),
    relatedType: row.relatedType ?? row.related_type ?? null,
    relatedId: row.relatedId ?? row.related_id ?? null,
    notes: row.notes ?? "",
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    createdBy: row.createdBy ?? row.created_by ?? null,
    archivedAt: row.archivedAt?.toISOString?.() ?? row.archived_at?.toISOString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updated_at?.toISOString?.() ?? null,
  };
}

function formatMessageThread(row: any, replies: any[] = []) {
  return {
    id: row.id,
    customerId: row.customerId ?? row.customer_id ?? null,
    phone: row.phone ?? null,
    customerName: row.customerName ?? row.customer_name ?? "",
    subject: row.subject ?? "",
    status: row.status,
    relatedType: row.relatedType ?? row.related_type ?? null,
    relatedId: row.relatedId ?? row.related_id ?? null,
    lastMessageAt: row.lastMessageAt?.toISOString?.() ?? row.last_message_at?.toISOString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updated_at?.toISOString?.() ?? null,
    replies: replies.map((reply) => ({
      id: reply.id,
      threadId: reply.threadId ?? reply.thread_id,
      senderType: reply.senderType ?? reply.sender_type,
      staffId: reply.staffId ?? reply.staff_id ?? null,
      body: reply.body,
      createdAt: reply.createdAt?.toISOString?.() ?? reply.created_at?.toISOString?.() ?? null,
    })),
  };
}

function formatAttendance(row: any, staff?: any) {
  const inAt = row.checkInAt ?? row.check_in_at;
  const outAt = row.checkOutAt ?? row.check_out_at;
  const hours = inAt && outAt ? Math.max(0, (new Date(outAt).getTime() - new Date(inAt).getTime()) / 36e5) : 0;
  return {
    id: row.id,
    staffId: row.staffId ?? row.staff_id,
    staffName: staff?.fullName || staff?.username || "",
    checkInAt: inAt?.toISOString?.() ?? inAt ?? null,
    checkOutAt: outAt?.toISOString?.() ?? outAt ?? null,
    status: row.status,
    notes: row.notes ?? "",
    hours: Number(hours.toFixed(2)),
    createdAt: row.createdAt?.toISOString?.() ?? row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updated_at?.toISOString?.() ?? null,
  };
}

function baseUrlFromReq(req: NextRequest): string {
  return process.env.APP_BASE_URL?.replace(/\/$/, "") || req.nextUrl.origin;
}

function publicQrTarget(_entityType: string, _entity: any, req: NextRequest, token: string): string {
  const base = baseUrlFromReq(req);
  return `${base}/track/${encodeURIComponent(token)}`;
}

async function ensureQrForEntity(entityType: "order" | "service_order" | "invoice", entity: any, req: NextRequest) {
  await ensureAdminExtensionsTables();
  const existing = await db.query.qrTokensTable.findFirst({
    where: and(eq(qrTokensTable.entityType, entityType), eq(qrTokensTable.entityId, entity.id)),
  });
  const token = existing?.token || randomBytes(32).toString("hex");
  const targetUrl = publicQrTarget(entityType, entity, req, token);
  if (!existing) {
    await db.insert(qrTokensTable).values({ entityType, entityId: entity.id, token, targetUrl });
  } else if (existing.targetUrl !== targetUrl || /\/admin(?:\/|$)|\/dashboard(?:\/|$)|\/orders(?:\/|$)|\/invoices(?:\/|$)/i.test(existing.targetUrl)) {
    await db.update(qrTokensTable).set({ targetUrl }).where(eq(qrTokensTable.id, existing.id));
  }
  if (!entity.qrToken) {
    if (entityType === "order") await db.update(ordersTable).set({ qrToken: token }).where(eq(ordersTable.id, entity.id));
    if (entityType === "service_order") await db.update(serviceOrdersTable).set({ qrToken: token }).where(eq(serviceOrdersTable.id, entity.id));
    if (entityType === "invoice") await db.update(salesInvoicesTable).set({ qrToken: token }).where(eq(salesInvoicesTable.id, entity.id));
  }
  const scanUrl = `${baseUrlFromReq(req)}/api/qr/${token}`;
  const dataUrl = await QRCode.toDataURL(scanUrl, { margin: 1, width: 240 });
  return { token, targetUrl, scanUrl, dataUrl };
}

let webPushConfigured = false;

function boolFromDb(value: unknown, fallback = true) {
  if (value === null || value === undefined) return fallback;
  return Number(value) !== 0 && value !== false;
}

function notificationSettingsToJson(row: any = {}) {
  return {
    pushEnabled: boolFromDb(row.pushEnabled ?? row.push_enabled, true),
    ordersEnabled: boolFromDb(row.ordersEnabled ?? row.orders_enabled, true),
    messagesEnabled: boolFromDb(row.messagesEnabled ?? row.messages_enabled, true),
    tasksEnabled: boolFromDb(row.tasksEnabled ?? row.tasks_enabled, true),
    inventoryEnabled: boolFromDb(row.inventoryEnabled ?? row.inventory_enabled, true),
    customerEnabled: boolFromDb(row.customerEnabled ?? row.customer_enabled, true),
  };
}

async function getGlobalNotificationSettings() {
  await ensureAdminExtensionsTables();
  const row = await db.query.notificationSettingsTable.findFirst({
    where: and(eq(notificationSettingsTable.ownerType, "global"), sql`${notificationSettingsTable.ownerId} is null`),
  });
  return notificationSettingsToJson(row);
}

function notificationTypeEnabled(settings: ReturnType<typeof notificationSettingsToJson>, type: string, audienceType: string) {
  if (!settings.pushEnabled) return false;
  if (audienceType === "customer" && !settings.customerEnabled) return false;
  if (type.includes("order") || type.includes("booking")) return settings.ordersEnabled;
  if (type.includes("message")) return settings.messagesEnabled;
  if (type.includes("task")) return settings.tasksEnabled;
  if (type.includes("inventory")) return settings.inventoryEnabled;
  return true;
}

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
}

function configureWebPush() {
  const publicKey = getVapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  if (!publicKey || !privateKey) return false;
  if (!webPushConfigured) {
    const subject = process.env.VAPID_SUBJECT || process.env.APP_BASE_URL || "mailto:admin@ajn.local";
    webpush.setVapidDetails(subject, publicKey, privateKey);
    webPushConfigured = true;
  }
  return true;
}

async function sendPushToSubscriptions(subscriptions: any[], payload: Record<string, unknown>) {
  if (!configureWebPush() || subscriptions.length === 0) return;
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
      } catch (err: any) {
        const status = Number(err?.statusCode ?? err?.status);
        if (status === 404 || status === 410) {
          await db
            .update(notificationSubscriptionsTable)
            .set({ isActive: 0, updatedAt: new Date() })
            .where(eq(notificationSubscriptionsTable.id, sub.id));
        } else {
          console.error("push notification failed", { status, message: err?.message });
        }
      }
    }),
  );
}

async function createNotification(input: {
  audienceType?: "admin" | "customer";
  staffId?: number | null;
  customerId?: number | null;
  type: string;
  title: string;
  body?: string;
  entityType?: string | null;
  entityId?: number | null;
  href?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await ensureAdminExtensionsTables();
  const audienceType = input.audienceType ?? "admin";
  const settings = await getGlobalNotificationSettings();
  const [row] = await db
    .insert(notificationsTable)
    .values({
      audienceType,
      staffId: input.staffId ?? null,
      customerId: input.customerId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      href: input.href ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (notificationTypeEnabled(settings, input.type, audienceType)) {
    let subscriptions: any[] = [];
    if (audienceType === "customer" && input.customerId) {
      subscriptions = await db.query.notificationSubscriptionsTable.findMany({
        where: and(eq(notificationSubscriptionsTable.ownerType, "customer"), eq(notificationSubscriptionsTable.customerId, input.customerId), eq(notificationSubscriptionsTable.isActive, 1)),
      });
    } else {
      const managerRows = await db.query.staffTable.findMany({
        where: and(eq(staffTable.isActive, true), sql`${staffTable.role} in ('admin','manager')`),
      });
      const staffIds = input.staffId ? [input.staffId] : managerRows.map((staff) => staff.id);
      subscriptions = staffIds.length
        ? await db.query.notificationSubscriptionsTable.findMany({
            where: and(eq(notificationSubscriptionsTable.ownerType, "staff"), inArray(notificationSubscriptionsTable.staffId, staffIds), eq(notificationSubscriptionsTable.isActive, 1)),
          })
        : [];
    }
    await sendPushToSubscriptions(subscriptions, {
      id: row.id,
      title: row.title,
      body: row.body,
      type: row.type,
      href: row.href,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: `${row.type}-${row.entityType ?? "item"}-${row.entityId ?? row.id}`,
    });
  }
  return row;
}

async function createNotificationOnce(input: Parameters<typeof createNotification>[0]) {
  await ensureAdminExtensionsTables();
  const audienceType = input.audienceType ?? "admin";
  if (input.entityType && input.entityId) {
    const existing = await db.query.notificationsTable.findFirst({
      where: and(
        eq(notificationsTable.audienceType, audienceType),
        eq(notificationsTable.type, input.type),
        eq(notificationsTable.entityType, input.entityType),
        eq(notificationsTable.entityId, input.entityId),
        sql`${notificationsTable.archivedAt} is null`,
      ),
    });
    if (existing) return existing;
  }
  return createNotification(input);
}

async function notifyOrderNeedsFollowup(input: {
  kind: "order" | "service_order";
  id: number;
  trackingCode?: string | null;
  customerName?: string | null;
  paymentStatus?: string | null;
  remainingAmount?: string | number | null;
  reason?: "payment" | "late";
}) {
  const remaining = money(input.remainingAmount ?? 0);
  const isLate = input.reason === "late";
  const paymentStatus = String(input.paymentStatus ?? "unpaid");
  if (!isLate && paymentStatus === "paid" && remaining <= 0) return null;
  return createNotificationOnce({
    type: "order_followup",
    title: isLate ? "طلب يحتاج متابعة" : "طلب يحتاج متابعة مالية",
    body: `${input.customerName || "زبون"} - ${input.trackingCode || `#${input.id}`}${remaining > 0 ? ` - المتبقي ${remaining.toLocaleString("ar-IQ")} د.ع` : ""}`,
    entityType: input.kind,
    entityId: input.id,
    href: "/admin/orders",
    metadata: { reason: input.reason ?? "payment", paymentStatus, remainingAmount: remaining },
  });
}

async function customerIdForPhone(phone: string | null | undefined) {
  const normalized = normalizeIraqiPhone(phone ?? "");
  if (!normalized) return null;
  const customer = await db.query.customersTable.findFirst({ where: inArray(customersTable.phone, iraqiPhoneVariants(normalized)) });
  return customer?.id ?? null;
}

async function createCustomerNotificationByPhone(phone: string | null | undefined, input: Omit<Parameters<typeof createNotification>[0], "audienceType" | "customerId">) {
  const customerId = await customerIdForPhone(phone);
  if (!customerId) return null;
  return createNotification({ ...input, audienceType: "customer", customerId });
}

async function notifyLowStockForProductIds(productIds: number[]) {
  const ids = await stockOwnerIdsForProductIds(productIds);
  if (ids.length === 0) return;
  const rows = await db.query.productsTable.findMany({
    where: and(inArray(productsTable.id, ids), sql`${productsTable.stock} <= ${productsTable.minStock}`),
    limit: 20,
  });
  await Promise.all(rows.map((product) => createNotification({
    type: "inventory_low",
    title: "انخفاض المخزون",
    body: `${product.nameAr || product.name} وصل إلى ${product.stock}`,
    entityType: "product",
    entityId: product.id,
    href: "/admin/inventory-alerts",
  })));
}

function withSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}

function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

const MEDIA_CACHE_HEADER = "public, max-age=31536000, immutable";
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET || "ajn-assets";
const STORAGE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

function isDataUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("data:");
}

function parseDataUrl(value: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const payload = match[3] || "";
  try {
    const bytes = match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    return { mime, bytes };
  } catch {
    return null;
  }
}

function bodyFromBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function mediaVersion(row: any): string {
  const value = row?.updatedAt ?? row?.updated_at ?? row?.createdAt ?? row?.created_at ?? "";
  if (value instanceof Date) return String(value.getTime());
  return value ? String(value).replace(/[^0-9a-z]/gi, "").slice(0, 24) : "1";
}

function mediaRoute(kind: string, id: number | string, index?: number, version?: string) {
  const suffix = typeof index === "number" ? `/${index}` : "";
  const qs = version ? `?v=${encodeURIComponent(version)}` : "";
  return `/api/media/${kind}/${id}${suffix}${qs}`;
}

function publicMediaValue(kind: string, row: any, value: unknown, index?: number) {
  if (!value || typeof value !== "string") return null;
  if (isDataUrl(value)) return mediaRoute(kind, row.id, index, mediaVersion(row));
  return value;
}

function publicMediaList(kind: string, row: any, images: unknown) {
  if (!Array.isArray(images)) return [];
  return images
    .map((value, index) => publicMediaValue(kind, row, value, index))
    .filter((value): value is string => Boolean(value));
}

function storageExtension(mime: string) {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime")) return "mov";
  return "bin";
}

async function persistDataUrlToStorage(value: string, folder: string): Promise<string> {
  if (!STORAGE_URL || !STORAGE_SERVICE_KEY) return value;
  const parsed = parseDataUrl(value);
  if (!parsed) return value;
  const path = `${folder}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${randomUUID()}.${storageExtension(parsed.mime)}`;
  try {
    const upload = await fetch(`${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: STORAGE_SERVICE_KEY,
        authorization: `Bearer ${STORAGE_SERVICE_KEY}`,
        "content-type": parsed.mime,
        "x-upsert": "true",
      },
      body: bodyFromBuffer(parsed.bytes),
    });
    if (!upload.ok) {
      console.warn("Supabase storage upload failed", { folder, status: upload.status });
      return value;
    }
    return `${STORAGE_URL.replace(/\/$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
  } catch (err) {
    console.warn("Supabase storage upload failed", { folder, error: err instanceof Error ? err.message : "unknown" });
    return value;
  }
}

function cleanMediaInput(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/") || raw.startsWith("data:video/")) return raw;
  return cleanPublicUrl(raw);
}

async function persistMediaValue(value: unknown, folder: string): Promise<string | null> {
  const cleaned = cleanMediaInput(value ?? "");
  if (!cleaned) return null;
  return isDataUrl(cleaned) ? persistDataUrlToStorage(cleaned, folder) : cleaned;
}

async function persistMediaList(images: unknown, folder: string): Promise<string[]> {
  if (!Array.isArray(images)) return [];
  const stored: string[] = [];
  for (const image of images) {
    const value = await persistMediaValue(image, folder);
    if (value) stored.push(value);
  }
  return stored;
}

function localMediaReference(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^\/api\/media\/([^/?#]+)\/(\d+)(?:\/(\d+))?/.exec(value);
  if (!match) return null;
  return {
    kind: match[1],
    id: Number.parseInt(match[2] ?? "0", 10),
    index: match[3] !== undefined ? Number.parseInt(match[3], 10) : undefined,
  };
}

async function resolveProductImageInputs(productId: number, images: unknown): Promise<string[]> {
  if (!Array.isArray(images)) return [];
  let currentImages: string[] | null = null;
  const resolved: unknown[] = [];
  for (const image of images) {
    const ref = localMediaReference(image);
    if (ref?.kind === "product" && ref.id === productId && typeof ref.index === "number") {
      if (!currentImages) {
        const current = await db.query.productsTable.findFirst({ where: eq(productsTable.id, productId) }) as any;
        currentImages = Array.isArray(current?.images) ? current.images : [];
      }
      resolved.push((currentImages ?? [])[ref.index] ?? "");
    } else {
      resolved.push(image);
    }
  }
  return persistMediaList(resolved, "products");
}

async function resolveProductVideoInputs(productId: number, videos: unknown): Promise<string[]> {
  if (!Array.isArray(videos)) return [];
  let currentVideos: string[] | null = null;
  const resolved: unknown[] = [];
  for (const video of videos) {
    const ref = localMediaReference(video);
    if (ref?.kind === "product-video" && ref.id === productId && typeof ref.index === "number") {
      if (!currentVideos) {
        const current = await db.query.productsTable.findFirst({ where: eq(productsTable.id, productId) }) as any;
        currentVideos = Array.isArray(current?.videos) ? current.videos : [];
      }
      resolved.push((currentVideos ?? [])[ref.index] ?? "");
    } else {
      resolved.push(video);
    }
  }
  return persistMediaList(resolved, "products/videos");
}

async function upgradeStoredMedia(kind: string, id: number | string, value: unknown, index?: number): Promise<unknown> {
  if (!isDataUrl(value)) return value;
  const stored = await persistDataUrlToStorage(String(value), kind === "settings" ? "settings/logo" : kind);
  if (stored === value) return value;
  try {
    if (kind === "product" && typeof id === "number" && typeof index === "number") {
      const product = await db.query.productsTable.findFirst({ where: eq(productsTable.id, id) }) as any;
      const images = Array.isArray(product?.images) ? [...product.images] : [];
      images[index] = stored;
      await db.update(productsTable).set({ images, updatedAt: new Date() }).where(eq(productsTable.id, id));
    } else if (kind === "product-video" && typeof id === "number" && typeof index === "number") {
      const product = await db.query.productsTable.findFirst({ where: eq(productsTable.id, id) }) as any;
      const videos = Array.isArray(product?.videos) ? [...product.videos] : [];
      videos[index] = stored;
      await db.update(productsTable).set({ videos, updatedAt: new Date() }).where(eq(productsTable.id, id));
    } else if (kind === "category" && typeof id === "number") {
      await db.update(categoriesTable).set({ imageUrl: stored, updatedAt: new Date() }).where(eq(categoriesTable.id, id));
      clearStoreCategoriesCache();
    } else if (kind === "service" && typeof id === "number") {
      await db.update(servicesTable).set({ image: stored }).where(eq(servicesTable.id, id));
    } else if (kind === "gallery" && typeof id === "number") {
      await db.update(galleryItemsTable).set({ mediaUrl: stored }).where(eq(galleryItemsTable.id, id));
    } else if (kind === "kosha" && typeof id === "number") {
      await db.update(koshasTable).set({ mainImage: stored, updatedAt: new Date() }).where(eq(koshasTable.id, id));
    } else if (kind === "kosha-image" && typeof id === "number") {
      await db.update(koshaImagesTable).set({ imageUrl: stored }).where(eq(koshaImagesTable.id, id));
    } else if (kind === "kosha-addon" && typeof id === "number") {
      await db.update(koshaAddonsTable).set({ mainImage: stored, updatedAt: new Date() }).where(eq(koshaAddonsTable.id, id));
    } else if (kind === "kosha-welcome-board" && typeof id === "number") {
      await db.update(koshaWelcomeBoardsTable).set({ mainImage: stored, updatedAt: new Date() }).where(eq(koshaWelcomeBoardsTable.id, id));
    } else if (kind === "kosha-accessory" && typeof id === "number") {
      await db.update(koshaAccessoriesTable).set({ mainImage: stored, updatedAt: new Date() }).where(eq(koshaAccessoriesTable.id, id));
    } else if (kind === "order-item" && typeof id === "number") {
      await db.update(orderItemsTable).set({ image: stored }).where(eq(orderItemsTable.id, id));
    } else if (kind === "customer-avatar" && typeof id === "number") {
      await db.update(customersTable).set({ avatarUrl: stored, updatedAt: new Date() }).where(eq(customersTable.id, id));
    } else if (kind === "settings") {
      await db
        .insert(settingsTable)
        .values({ key: "logoUrl", value: stored as any })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: stored as any, updatedAt: new Date() } });
      revalidateTag(PUBLIC_SETTINGS_TAG, { expire: 0 });
    }
  } catch (err) {
    console.warn("Stored media upgrade failed", { kind, id, error: err instanceof Error ? err.message : "unknown" });
  }
  return stored;
}

// يستخرج حقول ترجمة المحتوى من جسم الطلب (إضافية وغير مخلّة بأي عقد API قائم)
function pickContentTranslations(src: any, withDescription: boolean): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const keys = withDescription
    ? ["nameKu", "nameTr", "descriptionKu", "descriptionTr"]
    : ["nameKu", "nameTr"];
  for (const k of keys) {
    if (src && src[k] !== undefined) out[k] = nullableText(src[k]);
  }
  return out;
}

function formatProduct(p: any, avgRating?: number, reviewCount?: number) {
  return {
    id: p.id,
    name: p.name,
    nameAr: p.nameAr,
    nameKu: p.nameKu ?? p.name_ku ?? null,
    nameTr: p.nameTr ?? p.name_tr ?? null,
    description: p.description ?? null,
    descriptionAr: p.descriptionAr ?? null,
    descriptionKu: p.descriptionKu ?? p.description_ku ?? null,
    descriptionTr: p.descriptionTr ?? p.description_tr ?? null,
    price: Number.parseFloat(p.price),
    originalPrice: p.originalPrice ? Number.parseFloat(p.originalPrice) : null,
    stock: Number(p.effectiveStock ?? p.stock ?? 0),
    ownStock: Number(p.ownStock ?? p.stock ?? 0),
    minStock: Number(p.effectiveMinStock ?? p.minStock ?? p.min_stock ?? 0),
    sharedStockProductId: p.sharedStockProductId ?? p.shared_stock_product_id ?? null,
    sharedStockProductName: p.sharedStockProductName ?? p.shared_stock_product_name ?? null,
    sharedStockLinkedProducts: Array.isArray(p.sharedStockLinkedProducts) ? p.sharedStockLinkedProducts : [],
    barcode: p.barcode ?? null,
    costPrice: Number.parseFloat(String(p.costPrice ?? p.cost_price ?? "0")) || 0,
    categoryId: p.categoryId ?? p.category_id ?? null,
    subcategoryId: p.subcategoryId ?? p.subcategory_id ?? null,
    categoryName: p.categoryName ?? p.category_name ?? null,
    subcategoryName: p.subcategoryName ?? p.subcategory_name ?? null,
    category: p.category ?? null,
    images: publicMediaList("product", p, p.images),
    videos: publicMediaList("product-video", p, p.videos),
    imageMetadata: Array.isArray(p.imageMetadata) ? p.imageMetadata : [],
    colors: normalizeColors(p.colors ?? []),
    subcategory: p.subcategory ?? null,
    isFeatured: p.isFeatured,
    isActive: p.isActive ?? true,
    sortOrder: p.sortOrder ?? 0,
    rating: avgRating ?? null,
    reviewCount: reviewCount ?? 0,
    createdAt: p.createdAt.toISOString(),
  };
}

const KOSHA_STATUS_VALUES = ["available", "booked", "hidden", "maintenance"] as const;
const KOSHA_BOOKING_STATUS_VALUES = ["new", "contacted", "confirmed", "in_progress", "completed", "cancelled"] as const;
const blankToZero = (value: unknown) => (value === "" || value === null || value === undefined || Number.isNaN(value) ? 0 : value);
const blankToNull = (value: unknown) => (value === "" || value === null || value === undefined || Number.isNaN(value) ? null : value);
const looseText = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const looseBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value ?? "").trim().toLowerCase();
  if (["false", "0", "no", "off", "لا"].includes(text)) return false;
  if (["true", "1", "yes", "on", "نعم"].includes(text)) return true;
  return Boolean(value);
};

const KoshaImageInputSchema = z.object({
  imageUrl: z.preprocess(looseText, z.string()).optional().default(""),
  url: z.preprocess(looseText, z.string()).optional(),
  imageMetadata: z.preprocess(
    (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {},
    z.record(z.string(), z.unknown()),
  ).optional().default({}),
  sortOrder: z.preprocess(blankToZero, z.coerce.number().int()).optional().default(0),
});

const KoshaMutationSchema = z.object({
  name: z.preprocess(looseText, z.string()).optional().default(""),
  slug: z.preprocess(looseText, z.string()).optional().default(""),
  description: z.preprocess(looseText, z.string()).optional().nullable(),
  price: z.preprocess(blankToZero, z.coerce.number().nonnegative()).optional().default(0),
  oldPrice: z.preprocess(blankToNull, z.coerce.number().nonnegative().nullable()).optional().nullable(),
  discountPercentage: z.preprocess(blankToZero, z.coerce.number().int().min(0).max(100)).optional().default(0),
  mainImage: z.preprocess(looseText, z.string()).optional().nullable(),
  numberOfPieces: z.preprocess(blankToNull, z.coerce.number().int().nonnegative().nullable()).optional().nullable(),
  mainColor: z.preprocess(looseText, z.string()).optional().nullable(),
  flowerColor: z.preprocess(looseText, z.string()).optional().nullable(),
  koshaSpace: z.preprocess(looseText, z.string()).optional().nullable(),
  sideConsoleSpace: z.preprocess(looseText, z.string()).optional().nullable(),
  accessories: z.union([z.array(z.string()), z.string()]).optional().default([]),
  notes: z.preprocess(looseText, z.string()).optional().nullable(),
  availabilityStatus: z.preprocess(
    (value) => (KOSHA_STATUS_VALUES as readonly string[]).includes(String(value)) ? value : "available",
    z.enum(KOSHA_STATUS_VALUES),
  ).optional().default("available"),
  isFeatured: z.preprocess(looseBoolean, z.boolean()).optional().default(false),
  isActive: z.preprocess(looseBoolean, z.boolean()).optional().default(true),
  sortOrder: z.preprocess(blankToZero, z.coerce.number().int()).optional().default(0),
  galleryImages: z.array(KoshaImageInputSchema).optional().default([]),
});

const KoshaPatchSchema = z.object({
  name: z.preprocess(looseText, z.string()).optional(),
  slug: z.preprocess(looseText, z.string()).optional(),
  description: z.preprocess(looseText, z.string()).optional().nullable(),
  price: z.preprocess(blankToZero, z.coerce.number().nonnegative()).optional(),
  oldPrice: z.preprocess(blankToNull, z.coerce.number().nonnegative().nullable()).optional().nullable(),
  discountPercentage: z.preprocess(blankToZero, z.coerce.number().int().min(0).max(100)).optional(),
  mainImage: z.preprocess(looseText, z.string()).optional().nullable(),
  numberOfPieces: z.preprocess(blankToNull, z.coerce.number().int().nonnegative().nullable()).optional().nullable(),
  mainColor: z.preprocess(looseText, z.string()).optional().nullable(),
  flowerColor: z.preprocess(looseText, z.string()).optional().nullable(),
  koshaSpace: z.preprocess(looseText, z.string()).optional().nullable(),
  sideConsoleSpace: z.preprocess(looseText, z.string()).optional().nullable(),
  accessories: z.union([z.array(z.string()), z.string()]).optional(),
  notes: z.preprocess(looseText, z.string()).optional().nullable(),
  availabilityStatus: z.preprocess(
    (value) => value === undefined ? undefined : ((KOSHA_STATUS_VALUES as readonly string[]).includes(String(value)) ? value : "available"),
    z.enum(KOSHA_STATUS_VALUES).optional(),
  ),
  isFeatured: z.preprocess((value) => value === undefined ? undefined : looseBoolean(value), z.boolean().optional()),
  isActive: z.preprocess((value) => value === undefined ? undefined : looseBoolean(value), z.boolean().optional()),
  sortOrder: z.preprocess(blankToZero, z.coerce.number().int()).optional(),
  galleryImages: z.array(KoshaImageInputSchema).optional(),
});

const KoshaBookingCreateSchema = z.object({
  koshaId: z.coerce.number().int().positive(),
  customerName: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  brideName: z.string().optional().default(""),
  groomName: z.string().optional().default(""),
  eventDate: z.string().optional().default(""),
  eventTime: z.string().optional().default(""),
  eventType: z.string().optional().default(""),
  serviceLevel: z.string().optional().default(""),
  venueType: z.string().optional().default(""),
  themeColor: z.string().optional().default(""),
  province: z.string().optional().default(""),
  area: z.string().optional().default(""),
  mahalla: z.string().optional().default(""),
  nearestPoint: z.string().optional().default(""),
  addressNotes: z.string().optional().default(""),
  bridePhone: z.string().optional().default(""),
  groomPhone: z.string().optional().default(""),
  alternatePhone: z.string().optional().default(""),
  cityArea: z.string().optional().default(""),
  hallLocation: z.string().optional().default(""),
  selectedAddons: z.array(z.string()).optional().default([]),
  welcomeBoards: z.array(z.string()).optional().default([]),
  selectedAccessories: z.array(z.string()).optional().default([]),
  venueImages: z.array(z.string()).optional().default([]),
  notes: z.string().optional().default(""),
});

const KoshaBookingUpdateSchema = z.object({
  status: z.enum(KOSHA_BOOKING_STATUS_VALUES).optional(),
  internalNotes: z.string().optional().nullable(),
  totalAmount: z.coerce.number().nonnegative().optional(),
  paidAmount: z.coerce.number().nonnegative().optional(),
  paymentStatus: z.enum(["paid", "partial", "unpaid"]).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const KoshaOptionProductSchema = z.object({
  name: z.preprocess(looseText, z.string()).optional().default(""),
  price: z.preprocess(blankToZero, z.coerce.number().nonnegative()).optional().default(0),
  description: z.preprocess(looseText, z.string()).optional().nullable(),
  mainImage: z.preprocess(looseText, z.string()).optional().nullable(),
  isActive: z.preprocess(looseBoolean, z.boolean()).optional().default(true),
  sortOrder: z.preprocess(blankToZero, z.coerce.number().int()).optional().default(0),
});

const KoshaOptionProductPatchSchema = z.object({
  name: z.preprocess(looseText, z.string()).optional(),
  price: z.preprocess(blankToZero, z.coerce.number().nonnegative()).optional(),
  description: z.preprocess(looseText, z.string()).optional().nullable(),
  mainImage: z.preprocess(looseText, z.string()).optional().nullable(),
  isActive: z.preprocess((value) => value === undefined ? undefined : looseBoolean(value), z.boolean().optional()),
  sortOrder: z.preprocess(blankToZero, z.coerce.number().int()).optional(),
});

function normalizeKoshaAccessories(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/\n|،|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeKoshaStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function koshaOptionImageKind(section: "addon" | "welcome_board" | "accessory") {
  if (section === "addon") return "kosha-addon";
  if (section === "welcome_board") return "kosha-welcome-board";
  return "kosha-accessory";
}

function formatKoshaOptionProduct(row: any, section: "addon" | "welcome_board" | "accessory") {
  return {
    id: row.id,
    name: row.name,
    price: Number.parseFloat(String(row.price ?? "0")) || 0,
    description: row.description ?? "",
    mainImage: publicMediaValue(koshaOptionImageKind(section), row, row.mainImage ?? row.main_image),
    isActive: row.isActive ?? row.is_active ?? true,
    sortOrder: row.sortOrder ?? row.sort_order ?? 0,
    createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt ?? row.created_at ?? ""),
    updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt ?? row.updated_at ?? ""),
  };
}

async function koshaOptionValuesFromData(data: any, folder: string) {
  const values: any = { updatedAt: new Date() };
  if (data.name !== undefined) values.name = textFallback(data.name, "");
  if (data.price !== undefined) values.price = String(money(data.price));
  if (data.description !== undefined) values.description = nullableText(data.description);
  if (data.mainImage !== undefined) values.mainImage = await persistMediaValue(data.mainImage, folder);
  if (data.isActive !== undefined) values.isActive = data.isActive !== false;
  if (data.sortOrder !== undefined) values.sortOrder = Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0;
  return values;
}

function koshaOptionSummary(items: Array<{ name: string; price: number; mainImage?: string | null; description?: string | null }>, selected: string[]) {
  const selectedSet = new Set(selected.map((item) => String(item ?? "").trim()).filter(Boolean));
  return items
    .filter((item) => selectedSet.has(item.name))
    .map((item) => ({
      name: item.name,
      price: Number(item.price ?? 0) || 0,
      image: item.mainImage ?? null,
      description: item.description ?? "",
    }));
}

function normalizeKoshaSlug(value: unknown, fallback: unknown): string {
  const base = slugFallback(value, slugFallback(fallback, `kosha-${Date.now().toString(36)}`));
  return base.slice(0, 150);
}

async function uniqueKoshaSlug(input: string, ignoreId?: number): Promise<string> {
  let base = normalizeKoshaSlug(input, "kosha");
  let slug = base;
  let attempt = 1;
  while (true) {
    const existing = await db.query.koshasTable.findFirst({ where: eq(koshasTable.slug, slug) });
    if (!existing || existing.id === ignoreId) return slug;
    attempt += 1;
    slug = `${base}-${attempt}`.slice(0, 160);
  }
}

async function loadKoshaImages(koshaId: number) {
  const images = await db.query.koshaImagesTable.findMany({
    where: eq(koshaImagesTable.koshaId, koshaId),
    orderBy: (img, { asc }) => [asc(img.sortOrder), asc(img.id)],
  });
  return images.map((image) => ({
    id: image.id,
    imageUrl: publicMediaValue("kosha-image", image, image.imageUrl),
    imageMetadata: image.imageMetadata ?? {},
    sortOrder: image.sortOrder ?? 0,
    createdAt: image.createdAt.toISOString(),
  }));
}

async function formatKosha(row: any, includeImages = true) {
  const images = includeImages ? await loadKoshaImages(row.id) : [];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    price: Number.parseFloat(String(row.price ?? "0")) || 0,
    oldPrice: row.oldPrice ? Number.parseFloat(String(row.oldPrice)) : null,
    discountPercentage: Number(row.discountPercentage ?? 0),
    mainImage: publicMediaValue("kosha", row, row.mainImage),
    galleryImages: images,
    numberOfPieces: row.numberOfPieces ?? null,
    mainColor: row.mainColor ?? null,
    flowerColor: row.flowerColor ?? null,
    koshaSpace: row.koshaSpace ?? null,
    sideConsoleSpace: row.sideConsoleSpace ?? null,
    accessories: Array.isArray(row.accessories) ? row.accessories : [],
    notes: row.notes ?? null,
    availabilityStatus: row.availabilityStatus ?? "available",
    isFeatured: row.isFeatured ?? false,
    isActive: row.isActive ?? true,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt ?? ""),
    updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt ?? ""),
  };
}

async function replaceKoshaImages(koshaId: number, galleryImages: unknown) {
  if (!Array.isArray(galleryImages)) return;
  const rows: Array<{ koshaId: number; imageUrl: string; imageMetadata: Record<string, unknown>; sortOrder: number }> = [];
  for (let index = 0; index < galleryImages.length; index += 1) {
    const item = galleryImages[index] as any;
    const value = await persistMediaValue(item?.imageUrl ?? item?.url ?? "", "koshas/gallery");
    if (!value) continue;
    rows.push({
      koshaId,
      imageUrl: value,
      imageMetadata: item?.imageMetadata && typeof item.imageMetadata === "object" ? item.imageMetadata : {},
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index,
    });
  }
  await db.delete(koshaImagesTable).where(eq(koshaImagesTable.koshaId, koshaId));
  if (rows.length > 0) await db.insert(koshaImagesTable).values(rows);
}

async function koshaValuesFromData(data: any, existingId?: number) {
  const name = textFallback(data.name, existingId ? undefined : "كوشة جديدة");
  const values: any = {
    updatedAt: new Date(),
  };
  if (data.name !== undefined || !existingId) values.name = name;
  if (data.slug !== undefined || data.name !== undefined || !existingId) {
    values.slug = await uniqueKoshaSlug(normalizeKoshaSlug(data.slug, name), existingId);
  }
  if (data.description !== undefined) values.description = nullableText(data.description);
  if (data.price !== undefined || !existingId) values.price = String(money(data.price));
  if (data.oldPrice !== undefined) values.oldPrice = money(data.oldPrice) > 0 ? String(money(data.oldPrice)) : null;
  if (data.discountPercentage !== undefined || !existingId) values.discountPercentage = Math.min(Math.max(Number(data.discountPercentage ?? 0), 0), 100);
  if (data.mainImage !== undefined) values.mainImage = await persistMediaValue(data.mainImage, "koshas/main");
  if (data.numberOfPieces !== undefined) values.numberOfPieces = data.numberOfPieces === null ? null : Math.max(0, Number(data.numberOfPieces ?? 0));
  if (data.mainColor !== undefined) values.mainColor = nullableText(data.mainColor);
  if (data.flowerColor !== undefined) values.flowerColor = nullableText(data.flowerColor);
  if (data.koshaSpace !== undefined) values.koshaSpace = nullableText(data.koshaSpace);
  if (data.sideConsoleSpace !== undefined) values.sideConsoleSpace = nullableText(data.sideConsoleSpace);
  if (data.accessories !== undefined || !existingId) values.accessories = normalizeKoshaAccessories(data.accessories);
  if (data.notes !== undefined) values.notes = nullableText(data.notes);
  if (data.availabilityStatus !== undefined || !existingId) values.availabilityStatus = data.availabilityStatus ?? "available";
  if (data.isFeatured !== undefined || !existingId) values.isFeatured = Boolean(data.isFeatured);
  if (data.isActive !== undefined || !existingId) values.isActive = data.isActive !== false;
  if (data.sortOrder !== undefined || !existingId) values.sortOrder = Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0;
  return values;
}

async function formatKoshaBooking(row: any) {
  const kosha = row.koshaId
    ? await db.query.koshasTable.findFirst({ where: eq(koshasTable.id, row.koshaId) })
    : null;
  return {
    id: row.id,
    koshaId: row.koshaId ?? null,
    koshaName: kosha?.name ?? null,
    koshaSlug: kosha?.slug ?? null,
    customerName: row.customerName,
    phone: formatIraqiPhone(row.phone) ?? row.phone,
    brideName: row.brideName ?? row.bride_name ?? "",
    groomName: row.groomName ?? row.groom_name ?? "",
    eventDate: row.eventDate ?? "",
    eventTime: row.eventTime ?? "",
    eventType: row.eventType ?? row.event_type ?? "",
    serviceLevel: row.serviceLevel ?? row.service_level ?? "",
    venueType: row.venueType ?? row.venue_type ?? "",
    themeColor: row.themeColor ?? row.theme_color ?? "",
    province: row.province ?? "",
    area: row.area ?? "",
    mahalla: row.mahalla ?? "",
    nearestPoint: row.nearestPoint ?? row.nearest_point ?? "",
    addressNotes: row.addressNotes ?? row.address_notes ?? "",
    bridePhone: formatIraqiPhone(row.bridePhone ?? row.bride_phone) || "",
    groomPhone: formatIraqiPhone(row.groomPhone ?? row.groom_phone) || "",
    alternatePhone: formatIraqiPhone(row.alternatePhone ?? row.alternate_phone) || "",
    cityArea: row.cityArea ?? "",
    hallLocation: row.hallLocation ?? "",
    selectedAddons: Array.isArray(row.selectedAddons ?? row.selected_addons) ? (row.selectedAddons ?? row.selected_addons) : [],
    welcomeBoards: Array.isArray(row.welcomeBoards ?? row.welcome_boards) ? (row.welcomeBoards ?? row.welcome_boards) : [],
    selectedAccessories: Array.isArray(row.selectedAccessories ?? row.selected_accessories) ? (row.selectedAccessories ?? row.selected_accessories) : [],
    venueImages: Array.isArray(row.venueImages ?? row.venue_images) ? (row.venueImages ?? row.venue_images).map((image: unknown) => publicMediaValue("kosha-booking", row, image as string)) : [],
    bookingDetails: row.bookingDetails ?? row.booking_details ?? {},
    notes: row.notes ?? "",
    status: row.status ?? "new",
    totalAmount: Number(row.totalAmount ?? row.total_amount ?? 0),
    paidAmount: Number(row.paidAmount ?? row.paid_amount ?? 0),
    remainingAmount: Number(row.remainingAmount ?? row.remaining_amount ?? 0),
    paymentStatus: row.paymentStatus ?? row.payment_status ?? "unpaid",
    dueDate: row.dueDate ?? row.due_date ?? null,
    internalNotes: row.internalNotes ?? "",
    createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt ?? ""),
    updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt ?? ""),
  };
}

function productSharedStockId(row: any): number | null {
  return numberId(row?.sharedStockProductId ?? row?.shared_stock_product_id);
}

function productStockAmount(row: any): number {
  return Number(row?.effectiveStock ?? row?.stock ?? 0);
}

type StockMovementMeta = {
  reason: string;
  relatedType?: string | null;
  relatedId?: number | null;
  createdBy?: number | null;
  createdByName?: string | null;
};

const NON_STOCK_CONSUMING_STATUSES = new Set(["cancelled", "canceled", "refunded", "returned", "deleted"]);

function consumesStockStatus(status: unknown): boolean {
  const value = String(status ?? "").trim().toLowerCase();
  return value ? !NON_STOCK_CONSUMING_STATUSES.has(value) : true;
}

function hasAppliedStock(row: any): boolean {
  return Number(row?.stockApplied ?? row?.stock_applied ?? 1) === 1;
}

async function hydrateSharedStockProducts(products: any[]): Promise<any[]> {
  const directSharedIds = [
    ...new Set(products.map((product) => productSharedStockId(product)).filter((id): id is number => !!id)),
  ];
  if (directSharedIds.length === 0) {
    const productIds = products.map((product) => Number(product?.id)).filter((id) => Number.isFinite(id) && id > 0);
    const linkedRows = productIds.length
      ? await db.query.productsTable.findMany({ where: inArray(productsTable.sharedStockProductId, productIds) }) as any[]
      : [];
    return products.map((product) => ({
      ...product,
      ownStock: Number(product?.stock ?? 0),
      effectiveStock: Number(product?.stock ?? 0),
      effectiveMinStock: Number(product?.minStock ?? product?.min_stock ?? 0),
      sharedStockLinkedProducts: linkedRows
        .filter((row) => productSharedStockId(row) === product.id && row.id !== product.id)
        .map((row) => ({ id: row.id, name: row.nameAr ?? row.name ?? `#${row.id}` })),
    }));
  }
  const stockProducts = await db.query.productsTable.findMany({
    where: inArray(productsTable.id, directSharedIds),
  }) as any[];
  const stockMap = new Map(stockProducts.map((product) => [product.id, product]));
  const rootMap = new Map<number, any>();
  await Promise.all(stockProducts.map(async (product) => {
    const resolved = await getStockOwnerProduct(product.id);
    rootMap.set(product.id, resolved?.stockProduct ?? product);
  }));
  const stockSourceIds = [
    ...new Set(products.map((product) => {
      const stockProductId = productSharedStockId(product);
      return stockProductId ? rootMap.get(stockProductId)?.id ?? stockProductId : product.id;
    }).filter((id): id is number => !!id)),
  ];
  const linkedRows = stockSourceIds.length
    ? await db.query.productsTable.findMany({ where: inArray(productsTable.sharedStockProductId, stockSourceIds) }) as any[]
    : [];
  return products.map((product) => {
    const stockProductId = productSharedStockId(product);
    const stockProduct = stockProductId ? rootMap.get(stockProductId) ?? stockMap.get(stockProductId) : null;
    const sourceId = stockProduct?.id ?? product.id;
    const linkedProducts = linkedRows
      .filter((row) => productSharedStockId(row) === sourceId && row.id !== product.id)
      .map((row) => ({ id: row.id, name: row.nameAr ?? row.name ?? `#${row.id}` }));
    if (!stockProduct) {
      return {
        ...product,
        ownStock: Number(product?.stock ?? 0),
        effectiveStock: Number(product?.stock ?? 0),
        effectiveMinStock: Number(product?.minStock ?? product?.min_stock ?? 0),
        sharedStockLinkedProducts: linkedProducts,
      };
    }
    return {
      ...product,
      ownStock: Number(product?.stock ?? 0),
      effectiveStock: Number(stockProduct.stock ?? 0),
      effectiveMinStock: Number(stockProduct.minStock ?? stockProduct.min_stock ?? 0),
      sharedStockProductId: stockProduct.id,
      sharedStockProductName: stockProduct.nameAr ?? stockProduct.name ?? `#${stockProduct.id}`,
      sharedStockLinkedProducts: linkedProducts,
    };
  });
}

async function hydrateSharedStockProduct(product: any | null | undefined): Promise<any | null> {
  if (!product) return null;
  const [hydrated] = await hydrateSharedStockProducts([product]);
  return hydrated ?? product;
}

async function resolveSharedStockProductId(value: unknown, selfId?: number | null): Promise<{ id: number | null; message?: string }> {
  const requestedId = numberId(value);
  if (!requestedId) return { id: null };
  if (selfId && requestedId === selfId) return { id: null, message: "لا يمكن ربط المنتج بمخزونه نفسه" };
  const target = await db.query.productsTable.findFirst({ where: eq(productsTable.id, requestedId) }) as any;
  if (!target) return { id: null, message: "المنتج المرتبط بالمخزون غير موجود" };
  let root = target;
  const visited = new Set<number>(selfId ? [selfId] : []);
  for (let depth = 0; depth < 20; depth += 1) {
    const nextId = productSharedStockId(root);
    if (!nextId) return { id: root.id };
    if (selfId && nextId === selfId) return { id: null, message: "لا يمكن إنشاء ربط دائري للمخزون" };
    if (visited.has(nextId)) return { id: null, message: "لا يمكن إنشاء ربط دائري للمخزون" };
    visited.add(nextId);
    const next = await db.query.productsTable.findFirst({ where: eq(productsTable.id, nextId) }) as any;
    if (!next) return { id: root.id };
    root = next;
  }
  return { id: null, message: "لا يمكن إنشاء ربط مخزون بهذا العمق" };
}

async function getStockOwnerProduct(productId: number): Promise<{ product: any; stockProduct: any } | null> {
  const product = await db.query.productsTable.findFirst({ where: eq(productsTable.id, productId) }) as any;
  if (!product) return null;
  let stockProduct = product;
  const visited = new Set<number>([product.id]);
  for (let depth = 0; depth < 20; depth += 1) {
    const stockProductId = productSharedStockId(stockProduct);
    if (!stockProductId || visited.has(stockProductId)) break;
    visited.add(stockProductId);
    const next = await db.query.productsTable.findFirst({ where: eq(productsTable.id, stockProductId) }) as any;
    if (!next) break;
    stockProduct = next;
  }
  return { product, stockProduct };
}

async function stockOwnerIdsForProductIds(productIds: number[]): Promise<number[]> {
  const ids = [...new Set(productIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return [];
  const rows = await db.query.productsTable.findMany({ where: inArray(productsTable.id, ids) }) as any[];
  const owners = await Promise.all(rows.map(async (row) => (await getStockOwnerProduct(row.id))?.stockProduct?.id ?? row.id));
  return [...new Set(owners.filter((id): id is number => !!id))];
}

async function recordStockMovement(resolved: { product: any; stockProduct: any }, delta: number, meta?: StockMovementMeta): Promise<void> {
  if (!meta?.reason) return;
  try {
    await ensureStockTrackingTables();
    await db.insert(stockMovementsTable).values({
      productId: resolved.product?.id ?? null,
      stockSourceProductId: resolved.stockProduct?.id ?? null,
      quantityChange: String(delta),
      reason: meta.reason,
      relatedType: meta.relatedType ?? null,
      relatedId: meta.relatedId ?? null,
      createdBy: meta.createdBy ?? null,
      createdByName: meta.createdByName ?? "",
    } as any);
  } catch (err) {
    console.warn("stock movement log failed", {
      reason: meta.reason,
      relatedType: meta.relatedType,
      relatedId: meta.relatedId,
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}

async function adjustProductStock(productId: number, delta: number, meta?: StockMovementMeta): Promise<number | null> {
  const resolved = await getStockOwnerProduct(productId);
  if (!resolved) return null;
  await db.execute(sql`
    UPDATE products
    SET stock = GREATEST(0, stock + ${Number(delta)}), updated_at = now()
    WHERE id = ${resolved.stockProduct.id}
  `);
  await recordStockMovement(resolved, delta, meta);
  return resolved.stockProduct.id;
}

async function setProductStock(productId: number, stock: number, meta?: StockMovementMeta): Promise<number | null> {
  const resolved = await getStockOwnerProduct(productId);
  if (!resolved) return null;
  const previousStock = Number(resolved.stockProduct?.stock ?? 0);
  const nextStock = Math.max(0, Math.floor(Number(stock) || 0));
  await db
    .update(productsTable)
    .set({ stock: nextStock, updatedAt: new Date() })
    .where(eq(productsTable.id, resolved.stockProduct.id));
  const delta = nextStock - previousStock;
  if (delta !== 0) await recordStockMovement(resolved, delta, meta);
  return resolved.stockProduct.id;
}

function normalizeSharedStockLinkedIds(value: unknown, sourceId: number): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => numberId(item))
        .filter((id): id is number => !!id && id !== sourceId),
    ),
  ];
}

async function validateSharedStockLinkedProducts(sourceId: number, linkedIds: number[]): Promise<string | null> {
  const source = await db.query.productsTable.findFirst({ where: eq(productsTable.id, sourceId) }) as any;
  if (!source) return "المنتج الرئيسي غير موجود";
  for (const linkedId of linkedIds) {
    if (linkedId === sourceId) return "لا يمكن ربط المنتج بمخزونه نفسه";
    const child = await db.query.productsTable.findFirst({ where: eq(productsTable.id, linkedId) }) as any;
    if (!child) return "أحد المنتجات المرتبطة غير موجود";
    const circularCheck = await resolveSharedStockProductId(sourceId, linkedId);
    if (circularCheck.message) return circularCheck.message;
  }
  return null;
}

async function syncSharedStockLinkedProducts(
  sourceId: number,
  linkedIds: number[],
  actorInfo?: { id: number | null; name: string } | null,
): Promise<void> {
  void actorInfo;
  const desiredIds = normalizeSharedStockLinkedIds(linkedIds, sourceId);
  const currentRows = await db.query.productsTable.findMany({
    where: eq(productsTable.sharedStockProductId, sourceId),
  }) as any[];
  const currentIds = currentRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
  const desiredSet = new Set(desiredIds);
  const removeIds = currentIds.filter((id) => !desiredSet.has(id));
  if (removeIds.length > 0) {
    await db
      .update(productsTable)
      .set({ sharedStockProductId: null, updatedAt: new Date() } as any)
      .where(inArray(productsTable.id, removeIds));
  }
  for (const linkedId of desiredIds) {
    await db.execute(sql`
      update products
      set shared_stock_product_id = ${sourceId}, updated_at = now()
      where shared_stock_product_id = ${linkedId} and id <> ${sourceId}
    `);
    await db
      .update(productsTable)
      .set({ sharedStockProductId: sourceId, stock: 0, minStock: 0, updatedAt: new Date() } as any)
      .where(eq(productsTable.id, linkedId));
  }
}

async function applyOrderItemsStock(
  orderId: number,
  direction: 1 | -1,
  reason: string,
  actorInfo?: { id: number | null; name: string } | null,
): Promise<void> {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  for (const item of items) {
    const productId = Number(item.productId ?? 0);
    const quantity = Number(item.quantity ?? 0);
    if (productId > 0 && quantity > 0) {
      await adjustProductStock(productId, direction * quantity, {
        reason,
        relatedType: "order",
        relatedId: orderId,
        createdBy: actorInfo?.id ?? null,
        createdByName: actorInfo?.name ?? "",
      });
    }
  }
}

async function syncOrderStockState(order: any, actorInfo?: { id: number | null; name: string } | null): Promise<void> {
  if (!order?.id) return;
  await ensureStockTrackingTables();
  const shouldConsume = consumesStockStatus(order.status);
  const stockApplied = hasAppliedStock(order);
  if (stockApplied && !shouldConsume) {
    await applyOrderItemsStock(order.id, 1, "order_stock_restored", actorInfo);
    await db
      .update(ordersTable)
      .set({ stockApplied: 0, stockRestoredAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(ordersTable.id, order.id));
    return;
  }
  if (!stockApplied && shouldConsume) {
    await applyOrderItemsStock(order.id, -1, "order_stock_deducted_again", actorInfo);
    await db
      .update(ordersTable)
      .set({ stockApplied: 1, stockRestoredAt: null, updatedAt: new Date() } as any)
      .where(eq(ordersTable.id, order.id));
  }
}

async function restoreOrderStockBeforeDelete(order: any, actorInfo?: { id: number | null; name: string } | null): Promise<void> {
  if (!order?.id || !hasAppliedStock(order)) return;
  await applyOrderItemsStock(order.id, 1, "order_stock_restored_before_delete", actorInfo);
  await db
    .update(ordersTable)
    .set({ stockApplied: 0, stockRestoredAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(ordersTable.id, order.id));
}

async function applySalesInvoiceItemsStock(
  invoiceId: number,
  direction: 1 | -1,
  reason: string,
  actorInfo?: { id: number | null; name: string } | null,
): Promise<void> {
  const items = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invoiceId));
  for (const item of items) {
    const productId = Number(item.productId ?? 0);
    const quantity = Number.parseFloat(String(item.quantity ?? "0")) || 0;
    if (productId > 0 && quantity > 0) {
      await adjustProductStock(productId, direction * quantity, {
        reason,
        relatedType: "sales_invoice",
        relatedId: invoiceId,
        createdBy: actorInfo?.id ?? null,
        createdByName: actorInfo?.name ?? "",
      });
    }
  }
}

async function syncSalesInvoiceStockState(invoice: any, actorInfo?: { id: number | null; name: string } | null): Promise<void> {
  if (!invoice?.id) return;
  await ensureStockTrackingTables();
  const shouldConsume = consumesStockStatus(invoice.status);
  const stockApplied = hasAppliedStock(invoice);
  if (stockApplied && !shouldConsume) {
    await applySalesInvoiceItemsStock(invoice.id, 1, "sales_invoice_stock_restored", actorInfo);
    await db
      .update(salesInvoicesTable)
      .set({ stockApplied: 0, stockRestoredAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(salesInvoicesTable.id, invoice.id));
    return;
  }
  if (!stockApplied && shouldConsume) {
    await applySalesInvoiceItemsStock(invoice.id, -1, "sales_invoice_stock_deducted_again", actorInfo);
    await db
      .update(salesInvoicesTable)
      .set({ stockApplied: 1, stockRestoredAt: null, updatedAt: new Date() } as any)
      .where(eq(salesInvoicesTable.id, invoice.id));
  }
}

function formatCategory(row: any, productCount = 0) {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.nameAr ?? row.name_ar,
    nameKu: row.nameKu ?? row.name_ku ?? null,
    nameTr: row.nameTr ?? row.name_tr ?? null,
    slug: row.slug,
    parentId: row.parentId ?? row.parent_id ?? null,
    imageUrl: publicMediaValue("category", row, row.imageUrl ?? row.image_url ?? null),
    imageMetadata: row.imageMetadata ?? row.image_metadata ?? {},
    sortOrder: row.sortOrder ?? row.sort_order ?? 0,
    isActive: row.isActive ?? row.is_active ?? true,
    productCount,
    createdAt: row.createdAt?.toISOString?.() ?? row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updated_at?.toISOString?.() ?? null,
  };
}

function selectedColorPayload(value: unknown, fallback?: string | null): ProductColor | null {
  return normalizeColor((value as Record<string, unknown> | string | null | undefined) ?? fallback ?? null);
}

function selectedColorName(value: unknown, fallback?: string | null): string | null {
  const color = selectedColorPayload(value, fallback);
  return color?.name ?? fallback ?? null;
}

function cartMergeKey(item: {
  productId: number;
  selectedColor?: string | null;
  selectedColorData?: unknown;
  customization?: string | null;
}) {
  const color = selectedColorPayload(item.selectedColorData, item.selectedColor);
  return [
    item.productId,
    color ? colorKey(color) : "",
    (item.customization ?? "").trim(),
  ].join("|");
}

async function normalizeCartRows(sessionId: string) {
  const rows = await db.query.cartItemsTable.findMany({
    where: eq(cartItemsTable.sessionId, sessionId),
    orderBy: (item, { asc }) => [asc(item.id)],
  });
  const grouped = new Map<string, typeof rows[number]>();
  const duplicates: number[] = [];

  for (const row of rows) {
    const key = cartMergeKey(row);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, row);
      continue;
    }
    existing.quantity += row.quantity;
    duplicates.push(row.id);
  }

  if (duplicates.length > 0) {
    await Promise.all(
      Array.from(grouped.values()).map((row) =>
        db.update(cartItemsTable).set({ quantity: row.quantity }).where(eq(cartItemsTable.id, row.id)),
      ),
    );
    await db.delete(cartItemsTable).where(inArray(cartItemsTable.id, duplicates));
  }

  return Array.from(grouped.values());
}

function mergeOrderItems(items: any[]) {
  const merged = new Map<string, any>();
  for (const item of Array.isArray(items) ? items : []) {
    const quantity = Number(item?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const name = String(item?.productName ?? "").trim();
    const nameAr = String(item?.productNameAr ?? name).trim();
    if (!name && !nameAr) continue;
    const color = selectedColorPayload(item?.selectedColorData, item?.selectedColor);
    const key = [
      String(item?.productId ?? ""),
      name.toLowerCase(),
      nameAr.toLowerCase(),
      String(item?.price ?? 0),
      color ? colorKey(color) : String(item?.selectedColor ?? ""),
    ].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      const productId = Number.parseInt(String(item?.productId ?? "0"), 10);
      merged.set(key, {
        ...item,
        productId: Number.isFinite(productId) && productId > 0 ? productId : 0,
        productName: name,
        productNameAr: nameAr,
        price: money(item?.price),
        quantity,
      });
    }
  }
  return Array.from(merged.values());
}

function formatZone(z: any) {
  return {
    id: z.id,
    governorate: z.governorate,
    governorateAr: z.governorateAr,
    areas: z.areas ?? [],
    price: Number.parseFloat(z.price),
    estimatedDays: z.estimatedDays,
    isActive: z.isActive,
  };
}

function formatService(s: any) {
  return {
    id: s.id,
    name: s.name,
    nameAr: s.nameAr,
    nameKu: s.nameKu ?? s.name_ku ?? null,
    nameTr: s.nameTr ?? s.name_tr ?? null,
    description: s.description ?? null,
    descriptionAr: s.descriptionAr ?? null,
    descriptionKu: s.descriptionKu ?? s.description_ku ?? null,
    descriptionTr: s.descriptionTr ?? s.description_tr ?? null,
    type: s.type,
    icon: s.icon ?? null,
    image: publicMediaValue("service", s, s.image ?? null),
    imageMetadata: s.imageMetadata ?? {},
    isActive: s.isActive,
    sortOrder: s.sortOrder ?? 0,
    createdAt: s.createdAt?.toISOString?.() ?? null,
    updatedAt: s.updatedAt?.toISOString?.() ?? null,
  };
}

function formatStaff(s: any) {
  return {
    id: s.id,
    username: s.username,
    fullName: s.fullName,
    role: s.role,
    permissions: s.permissions ?? [],
    isActive: s.isActive,
    lastActivityAt: s.lastActivityAt?.toISOString?.() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

function formatCrew(c: any) {
  return {
    id: c.id,
    name: c.name,
    isActive: c.isActive,
    status: c.status ?? (c.isActive ? "available" : "inactive"),
    internalNotes: c.internalNotes ?? "",
    createdAt: c.createdAt?.toISOString?.() ?? null,
    updatedAt: c.updatedAt?.toISOString?.() ?? null,
  };
}

function formatAddress(row: any) {
  return {
    id: row.id,
    type: row.type ?? "home",
    fullName: row.fullName ?? row.full_name ?? "",
    phone: row.phone ?? "",
    governorate: row.governorate ?? "",
    city: row.city ?? "",
    address: row.address ?? "",
    landmark: row.landmark ?? "",
    notes: row.notes ?? "",
    isDefault: Boolean(row.isDefault ?? row.is_default),
    createdAt: row.createdAt?.toISOString?.() ?? row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updated_at?.toISOString?.() ?? null,
  };
}

function normalizeDetailsInput(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

async function ensureCrewsTable(): Promise<void> {
  if (!crewsTablePromise) {
    crewsTablePromise = db.execute(sql`
      create table if not exists "crews" (
        "id" serial primary key,
        "name" text not null,
        "is_active" boolean not null default true,
        "status" varchar(20) not null default 'available',
        "internal_notes" text,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      )
    `)
      .then(() => db.execute(sql`alter table "crews" add column if not exists "status" varchar(20) not null default 'available'`))
      .then(() => db.execute(sql`alter table "crews" add column if not exists "internal_notes" text`))
      .then(() => db.execute(sql`update "crews" set "status" = 'inactive' where "is_active" = false and ("status" is null or "status" = 'available')`))
      .then(() => db.execute(sql`create index if not exists "crews_status_idx" on "crews" ("status")`))
      .then(() => undefined);
  }
  await crewsTablePromise;
}

async function ensureOtpTable(): Promise<void> {
  if (!otpTablePromise) {
    otpTablePromise = db.execute(sql`
      create table if not exists "otp_codes" (
        "id" serial primary key,
        "phone" varchar(20) not null,
        "code" varchar(10),
        "code_hash" text not null default '',
        "expires_at" timestamp not null,
        "used" boolean not null default false,
        "attempts" integer not null default 0,
        "created_at" timestamp not null default now()
      )
    `).then(async () => {
      await db.execute(sql`alter table "otp_codes" add column if not exists "code_hash" text not null default ''`);
      await db.execute(sql`alter table "otp_codes" add column if not exists "attempts" integer not null default 0`);
      await db.execute(sql`alter table "otp_codes" add column if not exists "code" varchar(10)`);
      await db.execute(sql`alter table "otp_codes" alter column "code" drop not null`);
      await db.execute(sql`create index if not exists "otp_codes_phone_idx" on "otp_codes" ("phone")`);
      await db.execute(sql`create index if not exists "otp_codes_phone_created_idx" on "otp_codes" ("phone", "created_at")`);
    }).then(() => undefined);
  }
  await otpTablePromise;
}

async function ensureCustomerProfileColumns(): Promise<void> {
  if (!customerProfilePromise) {
    customerProfilePromise = db.execute(sql`alter table "customers" add column if not exists "full_name" text`)
      .then(() => db.execute(sql`alter table "customers" add column if not exists "email" text`))
      .then(() => db.execute(sql`alter table "customers" add column if not exists "avatar_url" text`))
      .then(() => db.execute(sql`alter table "customers" add column if not exists "address" text`))
      .then(() => db.execute(sql`alter table "customers" add column if not exists "city" text`))
      .then(() => db.execute(sql`alter table "customers" add column if not exists "updated_at" timestamp not null default now()`))
      .then(() => undefined);
  }
  await customerProfilePromise;
}

async function ensureCustomerAddressTables(): Promise<void> {
  if (!customerAddressTablesPromise) {
    customerAddressTablesPromise = db.execute(sql`
      create table if not exists "customer_addresses" (
        "id" serial primary key,
        "customer_id" integer not null references "customers"("id"),
        "type" varchar(20) not null default 'home',
        "full_name" text not null default '',
        "phone" varchar(20) not null,
        "governorate" text not null default '',
        "city" text not null default '',
        "address" text not null default '',
        "landmark" text not null default '',
        "notes" text not null default '',
        "is_default" boolean not null default false,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      )
    `)
      .then(() => db.execute(sql`create index if not exists "customer_addresses_customer_id_idx" on "customer_addresses" ("customer_id")`))
      .then(() => db.execute(sql`
        create table if not exists "customer_preferences" (
          "id" serial primary key,
          "customer_id" integer not null references "customers"("id"),
          "default_payment_method" varchar(20) not null default 'cash',
          "created_at" timestamp not null default now(),
          "updated_at" timestamp not null default now()
        )
      `))
      .then(() => db.execute(sql`create unique index if not exists "customer_preferences_customer_id_unique" on "customer_preferences" ("customer_id")`))
      .then(() => undefined);
  }
  await customerAddressTablesPromise;
}

async function ensureTrackingColumns(): Promise<void> {
  if (!trackingColumnsPromise) {
    trackingColumnsPromise = db.execute(sql`alter table "orders" add column if not exists "phone_last4" varchar(4)`)
      .then(() => db.execute(sql`alter table "service_orders" add column if not exists "phone_last4" varchar(4)`))
      .then(() => db.execute(sql`
        update "orders"
        set "phone_last4" = right(regexp_replace(coalesce("customer_phone", ''), '\\D', '', 'g'), 4)
        where ("phone_last4" is null or "phone_last4" = '')
          and length(regexp_replace(coalesce("customer_phone", ''), '\\D', '', 'g')) >= 4
      `))
      .then(() => db.execute(sql`
        update "service_orders"
        set "phone_last4" = right(regexp_replace(coalesce("phone", ''), '\\D', '', 'g'), 4)
        where ("phone_last4" is null or "phone_last4" = '')
          and length(regexp_replace(coalesce("phone", ''), '\\D', '', 'g')) >= 4
      `))
      .then(() => db.execute(sql`alter table "orders" drop constraint if exists "orders_tracking_code_unique"`))
      .then(() => db.execute(sql`alter table "service_orders" drop constraint if exists "service_orders_tracking_code_unique"`))
      .then(() => db.execute(sql`drop index if exists "orders_tracking_code_unique"`))
      .then(() => db.execute(sql`drop index if exists "service_orders_tracking_code_unique"`))
      .then(() => db.execute(sql`create index if not exists "orders_tracking_code_idx" on "orders" ("tracking_code")`))
      .then(() => db.execute(sql`create index if not exists "orders_phone_last4_idx" on "orders" ("phone_last4")`))
      .then(() => db.execute(sql`create index if not exists "service_orders_tracking_code_idx" on "service_orders" ("tracking_code")`))
      .then(() => db.execute(sql`create index if not exists "service_orders_phone_last4_idx" on "service_orders" ("phone_last4")`))
      .then(() => undefined);
  }
  await trackingColumnsPromise;
}

async function ensurePaymentWorkflowColumns(): Promise<void> {
  if (!paymentWorkflowColumnsPromise) {
    paymentWorkflowColumnsPromise = db.execute(sql`alter table "orders" add column if not exists "deposit_amount" numeric(10,2) not null default 0`)
      .then(() => db.execute(sql`alter table "orders" add column if not exists "remaining_amount" numeric(10,2) not null default 0`))
      .then(() => db.execute(sql`alter table "orders" add column if not exists "payment_status" varchar(20) not null default 'unpaid'`))
      .then(() => db.execute(sql`alter table "orders" add column if not exists "internal_notes" text`))
      .then(() => db.execute(sql`alter table "service_orders" add column if not exists "total_amount" numeric(10,2) not null default 0`))
      .then(() => db.execute(sql`alter table "service_orders" add column if not exists "deposit_amount" numeric(10,2) not null default 0`))
      .then(() => db.execute(sql`alter table "service_orders" add column if not exists "remaining_amount" numeric(10,2) not null default 0`))
      .then(() => db.execute(sql`alter table "service_orders" add column if not exists "payment_status" varchar(20) not null default 'unpaid'`))
      .then(() => db.execute(sql`alter table "service_orders" add column if not exists "internal_notes" text`))
      .then(() => db.execute(sql`
        update "orders"
        set
          "deposit_amount" = case when "payment_method" = 'paid' then "total" else coalesce("deposit_amount", 0) end,
          "remaining_amount" = case when "payment_method" = 'paid' then 0 else greatest("total" - coalesce("deposit_amount", 0), 0) end,
          "payment_status" = case when "payment_method" = 'paid' then 'paid' else coalesce(nullif("payment_status", ''), 'unpaid') end
        where "remaining_amount" = 0
          and "payment_status" = 'unpaid'
      `))
      .then(() => db.execute(sql`
        update "service_orders"
        set
          "remaining_amount" = greatest(coalesce("total_amount", 0) - coalesce("deposit_amount", 0), 0),
          "payment_status" = case
            when coalesce("total_amount", 0) > 0 and greatest(coalesce("total_amount", 0) - coalesce("deposit_amount", 0), 0) = 0 then 'paid'
            when coalesce("deposit_amount", 0) > 0 then 'partial'
            else coalesce(nullif("payment_status", ''), 'unpaid')
          end
      `))
      .then(() => db.execute(sql`create index if not exists "orders_payment_status_idx" on "orders" ("payment_status")`))
      .then(() => db.execute(sql`create index if not exists "service_orders_payment_status_idx" on "service_orders" ("payment_status")`))
      .then(() => undefined);
  }
  await paymentWorkflowColumnsPromise;
}

async function ensureArchiveColumns(): Promise<void> {
  if (!archiveColumnsPromise) {
    archiveColumnsPromise = db.execute(sql`alter table "orders" add column if not exists "archived_at" timestamp`)
      .then(() => db.execute(sql`alter table "service_orders" add column if not exists "archived_at" timestamp`))
      .then(() => db.execute(sql`create index if not exists "orders_archived_at_idx" on "orders" ("archived_at")`))
      .then(() => db.execute(sql`create index if not exists "service_orders_archived_at_idx" on "service_orders" ("archived_at")`))
      .then(() => undefined);
  }
  await archiveColumnsPromise;
}

async function ensureStaffTableShape(): Promise<void> {
  if (!staffTableShapePromise) {
    staffTableShapePromise = db.execute(sql`
      create table if not exists "staff" (
        "id" serial primary key,
        "username" varchar(50) not null unique,
        "password_hash" text not null,
        "full_name" text not null default '',
        "role" varchar(30) not null default 'employee',
        "permissions" jsonb not null default '[]'::jsonb,
        "is_active" boolean not null default true,
        "last_activity_at" timestamp,
        "created_at" timestamp not null default now()
      )
    `)
      .then(() => db.execute(sql`
        alter table "staff"
          add column if not exists "username" varchar(50),
          add column if not exists "password_hash" text,
          add column if not exists "full_name" text not null default '',
          add column if not exists "role" varchar(30) not null default 'employee',
          add column if not exists "is_active" boolean not null default true,
          add column if not exists "last_activity_at" timestamp,
          add column if not exists "created_at" timestamp not null default now()
      `))
      .then(() => db.execute(sql`
        do $$
        begin
          if exists (
            select 1
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'staff'
              and column_name = 'permissions'
              and udt_name <> 'jsonb'
          ) then
            alter table "staff" rename column "permissions" to "permissions_legacy";
            alter table "staff" add column "permissions" jsonb not null default '[]'::jsonb;
          end if;
        end $$;
      `))
      .then(() => db.execute(sql`alter table "staff" add column if not exists "permissions" jsonb not null default '[]'::jsonb`))
      .then(() => db.execute(sql`alter table "staff" alter column "permissions" set default '[]'::jsonb`))
      .then(() => db.execute(sql`create unique index if not exists "staff_username_unique_idx" on "staff" ("username")`))
      .then(() => db.execute(sql`create index if not exists "staff_username_lower_idx" on "staff" (lower("username"))`))
      .then(() => undefined);
  }
  await staffTableShapePromise;
}

async function ensureStaffActivityColumn(): Promise<void> {
  await ensureStaffTableShape();
  if (!staffActivityColumnPromise) {
    staffActivityColumnPromise = db.execute(sql`alter table "staff" add column if not exists "last_activity_at" timestamp`)
      .then(() => undefined);
  }
  await staffActivityColumnPromise;
}

async function ensureActivityTables(): Promise<void> {
  await ensureStaffActivityColumn();
  if (!activityTablesPromise) {
    activityTablesPromise = db.execute(sql`
      create table if not exists "admin_activity_logs" (
        "id" serial primary key,
        "staff_id" integer references "staff" ("id"),
        "user_name" text not null default '',
        "action" varchar(80) not null,
        "entity_type" varchar(80),
        "entity_id" integer,
        "metadata" jsonb not null default '{}'::jsonb,
        "ip_address" varchar(80),
        "user_agent" text,
        "created_at" timestamp not null default now()
      )
    `)
      .then(() => db.execute(sql`
        alter table "admin_activity_logs"
          add column if not exists "user_name" text not null default '',
          add column if not exists "ip_address" varchar(80),
          add column if not exists "user_agent" text
      `))
      .then(() => db.execute(sql`create index if not exists "admin_activity_staff_created_idx" on "admin_activity_logs" ("staff_id", "created_at")`))
      .then(() => db.execute(sql`create index if not exists "admin_activity_action_created_idx" on "admin_activity_logs" ("action", "created_at")`))
      .then(() => db.execute(sql`create index if not exists "admin_activity_user_created_idx" on "admin_activity_logs" ("user_name", "created_at")`))
      .then(() => db.execute(sql`create index if not exists "admin_activity_entity_created_idx" on "admin_activity_logs" ("entity_type", "created_at")`))
      .then(() => undefined);
  }
  await activityTablesPromise;
}

async function ensureOrderReviewsTable(): Promise<void> {
  if (!orderReviewsTablePromise) {
    orderReviewsTablePromise = db.execute(sql`
      create table if not exists "order_reviews" (
        "id" serial primary key,
        "customer_id" integer references "customers" ("id"),
        "order_kind" varchar(20) not null,
        "order_id" integer not null,
        "rating" integer not null,
        "comment" text,
        "created_at" timestamp not null default now()
      )
    `)
      .then(() => db.execute(sql`create unique index if not exists "order_reviews_kind_order_customer_idx" on "order_reviews" ("order_kind", "order_id", "customer_id")`))
      .then(() => db.execute(sql`create index if not exists "order_reviews_order_idx" on "order_reviews" ("order_kind", "order_id")`))
      .then(() => undefined);
  }
  await orderReviewsTablePromise;
}

async function ensureCustomerRewards(): Promise<void> {
  if (!customerRewardsPromise) {
    customerRewardsPromise = db.execute(sql`alter table "customers" add column if not exists "reward_points" integer not null default 0`)
      .then(() => db.execute(sql`alter table "customers" add column if not exists "reward_level" varchar(20) not null default 'bronze'`))
      .then(() => db.execute(sql`alter table "orders" add column if not exists "reward_points_awarded" integer not null default 0`))
      .then(() => db.execute(sql`alter table "orders" add column if not exists "loyalty_points_redeemed" integer not null default 0`))
      .then(() => db.execute(sql`alter table "orders" add column if not exists "loyalty_discount_amount" numeric(10,2) not null default 0`))
      .then(() => db.execute(sql`alter table "service_orders" add column if not exists "reward_points_awarded" integer not null default 0`))
      .then(() => db.execute(sql`
        create table if not exists "customer_reward_history" (
          "id" serial primary key,
          "customer_id" integer not null references "customers" ("id"),
          "order_id" integer references "orders" ("id"),
          "service_order_id" integer references "service_orders" ("id"),
          "points" integer not null,
          "reason" varchar(120) not null default 'order_reward',
          "note" text,
          "created_at" timestamp not null default now()
        )
      `))
      .then(() => db.execute(sql`
        create table if not exists "loyalty_points" (
          "id" serial primary key,
          "customer_id" integer not null references "customers" ("id"),
          "order_id" integer references "orders" ("id"),
          "service_order_id" integer references "service_orders" ("id"),
          "points" integer not null,
          "reason" varchar(120) not null default 'order_reward',
          "note" text,
          "created_at" timestamp not null default now()
        )
      `))
      .then(() => db.execute(sql`create index if not exists "customer_reward_history_customer_created_idx" on "customer_reward_history" ("customer_id", "created_at")`))
      .then(() => db.execute(sql`create index if not exists "loyalty_points_customer_created_idx" on "loyalty_points" ("customer_id", "created_at")`))
      .then(() => db.execute(sql`create index if not exists "customers_reward_points_idx" on "customers" ("reward_points")`))
      .then(() => undefined);
  }
  await customerRewardsPromise;
}

async function ensureImageMetadataColumns(): Promise<void> {
  if (!imageMetadataColumnsPromise) {
    imageMetadataColumnsPromise = db.execute(sql`
      alter table products add column if not exists image_metadata jsonb not null default '[]'::jsonb;
      alter table services add column if not exists image_metadata jsonb not null default '{}'::jsonb;
      alter table gallery_items add column if not exists image_metadata jsonb not null default '{}'::jsonb;
      alter table customers add column if not exists avatar_metadata jsonb not null default '{}'::jsonb;
    `).then(() => undefined);
  }
  await imageMetadataColumnsPromise;
}

async function ensureProductColorColumns(): Promise<void> {
  if (!productColorColumnsPromise) {
    productColorColumnsPromise = db.execute(sql`
      alter table cart_items add column if not exists selected_color_data jsonb;
      alter table order_items add column if not exists selected_color_data jsonb;
    `).then(() => undefined);
  }
  await productColorColumnsPromise;
}

async function ensurePerformanceIndexes(): Promise<void> {
  if (!performanceIndexesPromise) {
    performanceIndexesPromise = Promise.all([
      db.execute(sql`create index if not exists "orders_tracking_code_perf_idx" on "orders" ("tracking_code")`),
      db.execute(sql`create index if not exists "orders_customer_phone_perf_idx" on "orders" ("customer_phone")`),
      db.execute(sql`create index if not exists "orders_phone_last4_perf_idx" on "orders" ("phone_last4")`),
      db.execute(sql`create index if not exists "orders_status_archived_perf_idx" on "orders" ("status", "archived_at")`),
      db.execute(sql`create index if not exists "service_orders_tracking_code_perf_idx" on "service_orders" ("tracking_code")`),
      db.execute(sql`create index if not exists "service_orders_phone_perf_idx" on "service_orders" ("phone")`),
      db.execute(sql`create index if not exists "service_orders_phone_last4_perf_idx" on "service_orders" ("phone_last4")`),
      db.execute(sql`create index if not exists "service_orders_status_archived_perf_idx" on "service_orders" ("status", "archived_at")`),
      db.execute(sql`create index if not exists "products_category_active_perf_idx" on "products" ("category", "is_active")`),
      db.execute(sql`create index if not exists "products_active_created_perf_idx" on "products" ("is_active", "created_at")`),
      db.execute(sql`create index if not exists "staff_username_perf_idx" on "staff" ("username")`),
      db.execute(sql`create index if not exists "customers_phone_perf_idx" on "customers" ("phone")`),
    ]).then(() => undefined).catch((err) => {
      performanceIndexesPromise = null;
      throw err;
    });
  }
  await performanceIndexesPromise;
}

let adminProductsColumnsPromise: Promise<void> | null = null;
async function ensureAdminProductsColumns(): Promise<void> {
  if (!adminProductsColumnsPromise) {
    adminProductsColumnsPromise = db.execute(sql`
      alter table "products" add column if not exists "barcode" varchar(100);
      alter table "products" add column if not exists "cost_price" numeric(14,2) not null default 0;
      alter table "products" add column if not exists "min_stock" integer not null default 0;
      alter table "products" add column if not exists "shared_stock_product_id" integer;
      alter table "products" add column if not exists "videos" jsonb not null default '[]'::jsonb;
      do $$
      begin
        alter table "products"
          add constraint "products_shared_stock_product_id_fkey"
          foreign key ("shared_stock_product_id")
          references "products" ("id")
          on delete set null;
      exception
        when duplicate_object then null;
      end $$;
      update "products"
      set "barcode" = 'AJN' || lpad("id"::text, 8, '0')
      where "barcode" is null or "barcode" = '';
      create index if not exists "products_barcode_idx" on "products" ("barcode") where "barcode" is not null;
      create index if not exists "products_stock_min_stock_idx" on "products" ("stock", "min_stock");
      create index if not exists "products_shared_stock_product_id_idx" on "products" ("shared_stock_product_id");
    `).then(() => undefined).catch(() => { adminProductsColumnsPromise = null; });
  }
  await adminProductsColumnsPromise;
}

async function ensureStockTrackingTables(): Promise<void> {
  if (!stockTrackingTablesPromise) {
    stockTrackingTablesPromise = db.execute(sql`
      alter table "orders"
        add column if not exists "stock_applied" integer not null default 1,
        add column if not exists "stock_restored_at" timestamp;

      do $$
      begin
        if to_regclass('sales_invoices') is not null then
          alter table "sales_invoices"
            add column if not exists "stock_applied" integer not null default 1,
            add column if not exists "stock_restored_at" timestamp;
        end if;
      end $$;

      create table if not exists "stock_movements" (
        "id" serial primary key,
        "product_id" integer references "products" ("id") on delete set null,
        "stock_source_product_id" integer references "products" ("id") on delete set null,
        "quantity_change" numeric(12,3) not null,
        "reason" varchar(80) not null,
        "related_type" varchar(40),
        "related_id" integer,
        "created_by" integer,
        "created_by_name" text not null default '',
        "created_at" timestamp not null default now()
      );

      create index if not exists "stock_movements_product_id_idx" on "stock_movements" ("product_id");
      create index if not exists "stock_movements_stock_source_product_id_idx" on "stock_movements" ("stock_source_product_id");
      create index if not exists "stock_movements_related_idx" on "stock_movements" ("related_type", "related_id");
      create index if not exists "stock_movements_created_at_idx" on "stock_movements" ("created_at");
      create index if not exists "orders_stock_applied_status_idx" on "orders" ("stock_applied", "status");
      do $$
      begin
        if to_regclass('sales_invoices') is not null then
          create index if not exists "sales_invoices_stock_applied_status_idx" on "sales_invoices" ("stock_applied", "status");
        end if;
      end $$;
    `).then(() => undefined).catch((err) => {
      stockTrackingTablesPromise = null;
      throw err;
    });
  }
  await stockTrackingTablesPromise;
}

async function ensureKoshaTables(): Promise<void> {
  if (!koshaTablesPromise) {
    koshaTablesPromise = db.execute(sql`
      create table if not exists "koshas" (
        "id" serial primary key,
        "name" text not null,
        "slug" varchar(160) not null unique,
        "description" text,
        "price" numeric(14,2) not null default 0,
        "old_price" numeric(14,2),
        "discount_percentage" integer not null default 0,
        "main_image" text,
        "number_of_pieces" integer,
        "main_color" varchar(80),
        "flower_color" varchar(80),
        "kosha_space" varchar(120),
        "side_console_space" varchar(120),
        "accessories" jsonb not null default '[]'::jsonb,
        "notes" text,
        "availability_status" varchar(40) not null default 'available',
        "is_featured" boolean not null default false,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create table if not exists "kosha_images" (
        "id" serial primary key,
        "kosha_id" integer not null references "koshas" ("id") on delete cascade,
        "image_url" text not null,
        "image_metadata" jsonb not null default '{}'::jsonb,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now()
      );

      create table if not exists "kosha_bookings" (
        "id" serial primary key,
        "kosha_id" integer references "koshas" ("id") on delete set null,
        "customer_name" text not null,
        "phone" varchar(20) not null,
        "bride_name" text,
        "groom_name" text,
        "event_date" text,
        "event_time" varchar(20),
        "event_type" varchar(40),
        "service_level" varchar(20),
        "venue_type" varchar(20),
        "theme_color" varchar(20),
        "province" text,
        "area" text,
        "mahalla" text,
        "nearest_point" text,
        "address_notes" text,
        "bride_phone" varchar(20),
        "groom_phone" varchar(20),
        "alternate_phone" varchar(20),
        "city_area" text,
        "hall_location" text,
        "selected_addons" jsonb not null default '[]'::jsonb,
        "welcome_boards" jsonb not null default '[]'::jsonb,
        "selected_accessories" jsonb not null default '[]'::jsonb,
        "venue_images" jsonb not null default '[]'::jsonb,
        "booking_details" jsonb not null default '{}'::jsonb,
        "notes" text,
        "status" varchar(30) not null default 'new',
        "internal_notes" text,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      alter table "kosha_bookings"
        add column if not exists "bride_name" text,
        add column if not exists "groom_name" text,
        add column if not exists "event_type" varchar(40),
        add column if not exists "service_level" varchar(20),
        add column if not exists "venue_type" varchar(20),
        add column if not exists "theme_color" varchar(20),
        add column if not exists "province" text,
        add column if not exists "area" text,
        add column if not exists "mahalla" text,
        add column if not exists "nearest_point" text,
        add column if not exists "address_notes" text,
        add column if not exists "bride_phone" varchar(20),
        add column if not exists "groom_phone" varchar(20),
        add column if not exists "alternate_phone" varchar(20),
        add column if not exists "selected_addons" jsonb not null default '[]'::jsonb,
        add column if not exists "welcome_boards" jsonb not null default '[]'::jsonb,
        add column if not exists "selected_accessories" jsonb not null default '[]'::jsonb,
        add column if not exists "venue_images" jsonb not null default '[]'::jsonb,
        add column if not exists "booking_details" jsonb not null default '{}'::jsonb;

      create table if not exists "kosha_accessories" (
        "id" serial primary key,
        "name" text not null unique,
        "price" numeric(14,2) not null default 0,
        "description" text,
        "main_image" text,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      alter table "kosha_accessories"
        add column if not exists "price" numeric(14,2) not null default 0,
        add column if not exists "description" text,
        add column if not exists "main_image" text;

      create table if not exists "kosha_addons" (
        "id" serial primary key,
        "name" text not null unique,
        "price" numeric(14,2) not null default 0,
        "description" text,
        "main_image" text,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create table if not exists "kosha_welcome_boards" (
        "id" serial primary key,
        "name" text not null unique,
        "price" numeric(14,2) not null default 0,
        "description" text,
        "main_image" text,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create table if not exists "kosha_provinces" (
        "id" serial primary key,
        "name" text not null unique,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );

      create index if not exists "koshas_active_sort_idx" on "koshas" ("is_active", "sort_order", "id");
      create index if not exists "koshas_featured_idx" on "koshas" ("is_featured", "is_active");
      create index if not exists "kosha_images_kosha_sort_idx" on "kosha_images" ("kosha_id", "sort_order", "id");
      create index if not exists "kosha_bookings_kosha_idx" on "kosha_bookings" ("kosha_id");
      create index if not exists "kosha_bookings_status_idx" on "kosha_bookings" ("status");
      create index if not exists "kosha_bookings_created_at_idx" on "kosha_bookings" ("created_at");
      create index if not exists "kosha_bookings_event_date_idx" on "kosha_bookings" ("event_date");
      create index if not exists "kosha_accessories_active_sort_idx" on "kosha_accessories" ("is_active", "sort_order", "id");
      create index if not exists "kosha_addons_active_sort_idx" on "kosha_addons" ("is_active", "sort_order", "id");
      create index if not exists "kosha_welcome_boards_active_sort_idx" on "kosha_welcome_boards" ("is_active", "sort_order", "id");
      create index if not exists "kosha_provinces_active_sort_idx" on "kosha_provinces" ("is_active", "sort_order", "id");

      insert into "kosha_addons" ("name", "sort_order")
      values
        ('تصوير', 10),
        ('ألبوم', 20),
        ('فيديو مختصر', 30),
        ('دي جي', 40),
        ('إضاءة إضافية', 50),
        ('توصيل وتركيب', 60)
      on conflict ("name") do nothing;

      insert into "kosha_welcome_boards" ("name", "sort_order")
      values
        ('بورد ترحيب كلاسيك', 10),
        ('بورد ترحيب ذهبي', 20),
        ('بورد ورد', 30),
        ('بورد مرآة', 40)
      on conflict ("name") do nothing;

      insert into "kosha_accessories" ("name", "sort_order")
      values
        ('كفرات منع التصوير', 10),
        ('دفوف حنة', 20),
        ('مبخرة', 30),
        ('مهفة', 40),
        ('القرآن الكريم', 50),
        ('شال المهر', 60),
        ('ورد الحنة', 70),
        ('وثيقة', 80),
        ('ستاند حلقات', 90),
        ('قصاصات', 100)
      on conflict ("name") do nothing;

      insert into "kosha_provinces" ("name", "sort_order")
      values
        ('كركوك', 10),
        ('صلاح الدين', 20),
        ('بغداد', 30),
        ('أربيل', 40),
        ('السليمانية', 50),
        ('ديالى', 60),
        ('نينوى', 70)
      on conflict ("name") do nothing;
    `).then(() => undefined).catch((err) => {
      koshaTablesPromise = null;
      throw err;
    });
  }
  await koshaTablesPromise;
}

// Kosha Staff Portal — additive field-crew execution layer.
async function ensureKoshaStaffTables(): Promise<void> {
  await ensureKoshaTables();
  if (!koshaStaffTablesPromise) {
    koshaStaffTablesPromise = db.execute(sql`
      alter table "kosha_bookings" add column if not exists "execution_stage" varchar(30) not null default 'preparing';
      alter table "kosha_bookings" add column if not exists "assigned_staff_id" integer;

      create table if not exists "kosha_booking_events" (
        "id" serial primary key,
        "booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "type" varchar(30) not null,
        "from_stage" varchar(30),
        "to_stage" varchar(30),
        "note" text,
        "meta" jsonb not null default '{}'::jsonb,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_booking_events_booking_idx" on "kosha_booking_events" ("booking_id");

      create table if not exists "kosha_media" (
        "id" serial primary key,
        "booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "event_id" integer references "kosha_booking_events" ("id") on delete set null,
        "staff_id" integer references "staff" ("id") on delete set null,
        "url" text not null,
        "kind" varchar(10) not null default 'image',
        "stage" varchar(30),
        "purpose" varchar(20) not null default 'execution',
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_media_booking_idx" on "kosha_media" ("booking_id");

      create table if not exists "kosha_delivery_reports" (
        "id" serial primary key,
        "booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "has_loss" boolean not null default false,
        "has_breakage" boolean not null default false,
        "note" text,
        "compensation_amount" numeric(14,2) not null default 0,
        "signature_url" text,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_delivery_reports_booking_idx" on "kosha_delivery_reports" ("booking_id");

      create table if not exists "kosha_payment_requests" (
        "id" serial primary key,
        "booking_id" integer not null references "kosha_bookings" ("id") on delete cascade,
        "staff_id" integer references "staff" ("id") on delete set null,
        "staff_name" text not null default '',
        "amount" numeric(14,2) not null default 0,
        "note" text,
        "status" varchar(12) not null default 'pending',
        "reviewed_by_staff_id" integer references "staff" ("id") on delete set null,
        "reviewed_by_name" text,
        "reviewed_at" timestamp,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_payment_requests_status_idx" on "kosha_payment_requests" ("status");

      create table if not exists "kosha_staff_notifications" (
        "id" serial primary key,
        "staff_id" integer references "staff" ("id") on delete cascade,
        "audience" varchar(12) not null default 'staff',
        "type" varchar(30) not null,
        "title" text not null,
        "body" text,
        "href" text,
        "booking_id" integer references "kosha_bookings" ("id") on delete cascade,
        "is_read" boolean not null default false,
        "created_at" timestamp not null default now()
      );
      create index if not exists "kosha_staff_notifications_staff_idx" on "kosha_staff_notifications" ("staff_id");
    `).then(() => undefined).catch((err) => {
      koshaStaffTablesPromise = null;
      throw err;
    });
  }
  await koshaStaffTablesPromise;
}

async function ensureStoreCategoryColumns(): Promise<void> {
  if (!storeCategoryColumnsPromise) {
    storeCategoryColumnsPromise = db.execute(sql`
      alter table "categories" add column if not exists "image_url" text;
      alter table "categories" add column if not exists "image_metadata" jsonb not null default '{}'::jsonb;
      alter table "categories" add column if not exists "updated_at" timestamp not null default now();
      alter table "products" add column if not exists "category_id" integer references "categories" ("id");
      alter table "products" add column if not exists "subcategory_id" integer references "categories" ("id");
      update "products" p
      set "category_id" = c."id"
      from "categories" c
      where p."category_id" is null
        and p."category" is not null
        and p."category" = c."slug"
        and c."parent_id" is null;
      update "products" p
      set "subcategory_id" = c."id"
      from "categories" c
      where p."subcategory_id" is null
        and p."subcategory" is not null
        and p."subcategory" = c."slug"
        and c."parent_id" is not null;
      create index if not exists "categories_parent_active_sort_idx" on "categories" ("parent_id", "is_active", "sort_order");
      create index if not exists "products_category_id_active_idx" on "products" ("category_id", "is_active");
      create index if not exists "products_subcategory_id_active_idx" on "products" ("subcategory_id", "is_active");
    `).then(() => undefined).catch((err) => {
      storeCategoryColumnsPromise = null;
      throw err;
    });
  }
  await storeCategoryColumnsPromise;
}

async function ensureCouponsTables(): Promise<void> {
  if (!couponsTablesPromise) {
    couponsTablesPromise = db.execute(sql`
      create table if not exists "coupons" (
        "id" serial primary key,
        "code" varchar(60) not null unique,
        "title" text not null default '',
        "type" varchar(20) not null default 'fixed',
        "value" numeric(14,2) not null default 0,
        "min_order_amount" numeric(14,2) not null default 0,
        "usage_limit" integer,
        "used_count" integer not null default 0,
        "expires_at" timestamp,
        "is_active" boolean not null default true,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "coupon_usages" (
        "id" serial primary key,
        "coupon_id" integer not null references "coupons" ("id"),
        "customer_phone" varchar(30),
        "order_id" integer references "orders" ("id"),
        "sales_invoice_id" integer references "sales_invoices" ("id"),
        "discount_amount" numeric(14,2) not null default 0,
        "created_at" timestamp not null default now()
      );
      alter table "orders"
        add column if not exists "coupon_code" varchar(60),
        add column if not exists "coupon_discount_amount" numeric(10,2) not null default 0;
      alter table "sales_invoices"
        add column if not exists "coupon_code" varchar(60),
        add column if not exists "coupon_discount_amount" numeric(14,2) not null default 0;
      create index if not exists "coupons_code_idx" on "coupons" ("code");
      create index if not exists "coupon_usages_coupon_created_idx" on "coupon_usages" ("coupon_id", "created_at");
    `).then(() => undefined).catch((err) => {
      couponsTablesPromise = null;
      throw err;
    });
  }
  await couponsTablesPromise;
}

async function ensureAdminExtensionsTables(): Promise<void> {
  if (!adminExtensionsTablesPromise) {
    adminExtensionsTablesPromise = db.execute(sql`
      alter table "orders" add column if not exists "qr_token" varchar(80);
      alter table "service_orders" add column if not exists "qr_token" varchar(80);
      alter table "sales_invoices" add column if not exists "qr_token" varchar(80);

      create table if not exists "tasks" (
        "id" serial primary key,
        "title" text not null,
        "description" text,
        "status" varchar(30) not null default 'new',
        "priority" varchar(20) not null default 'medium',
        "due_at" timestamp,
        "assigned_staff_ids" jsonb not null default '[]'::jsonb,
        "related_type" varchar(30),
        "related_id" integer,
        "notes" text,
        "attachments" jsonb not null default '[]'::jsonb,
        "created_by" integer references "staff" ("id"),
        "archived_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "task_comments" (
        "id" serial primary key,
        "task_id" integer not null references "tasks" ("id"),
        "staff_id" integer references "staff" ("id"),
        "body" text not null,
        "created_at" timestamp not null default now()
      );
      create table if not exists "task_attachments" (
        "id" serial primary key,
        "task_id" integer not null references "tasks" ("id"),
        "file_url" text not null,
        "file_name" text,
        "created_at" timestamp not null default now()
      );
      create table if not exists "message_threads" (
        "id" serial primary key,
        "customer_id" integer references "customers" ("id"),
        "phone" varchar(30),
        "customer_name" text not null default '',
        "subject" text not null default 'رسالة زبون',
        "status" varchar(20) not null default 'new',
        "related_type" varchar(30),
        "related_id" integer,
        "last_message_at" timestamp not null default now(),
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "message_replies" (
        "id" serial primary key,
        "thread_id" integer not null references "message_threads" ("id"),
        "sender_type" varchar(20) not null default 'customer',
        "staff_id" integer references "staff" ("id"),
        "body" text not null,
        "created_at" timestamp not null default now()
      );
      create table if not exists "customer_activity_logs" (
        "id" serial primary key,
        "customer_id" integer references "customers" ("id"),
        "session_id" varchar(80),
        "phone" varchar(30),
        "action" varchar(60) not null,
        "entity_type" varchar(40),
        "entity_id" integer,
        "entity_label" text,
        "metadata" jsonb not null default '{}'::jsonb,
        "ip_address" varchar(80),
        "user_agent" text,
        "created_at" timestamp not null default now()
      );
      create table if not exists "customer_notes" (
        "id" serial primary key,
        "customer_id" integer not null references "customers" ("id"),
        "staff_id" integer references "staff" ("id"),
        "body" text not null,
        "priority" varchar(20) not null default 'normal',
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "attendance_records" (
        "id" serial primary key,
        "staff_id" integer not null references "staff" ("id"),
        "check_in_at" timestamp not null default now(),
        "check_out_at" timestamp,
        "status" varchar(20) not null default 'present',
        "notes" text,
        "edited_by" integer references "staff" ("id"),
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "qr_tokens" (
        "id" serial primary key,
        "entity_type" varchar(30) not null,
        "entity_id" integer not null,
        "token" varchar(80) not null unique,
        "target_url" text not null,
        "scan_count" integer not null default 0,
        "created_at" timestamp not null default now(),
        "last_scanned_at" timestamp
      );
      create table if not exists "notifications" (
        "id" serial primary key,
        "audience_type" varchar(20) not null default 'admin',
        "staff_id" integer references "staff" ("id"),
        "customer_id" integer references "customers" ("id"),
        "type" varchar(60) not null default 'general',
        "title" text not null,
        "body" text not null default '',
        "entity_type" varchar(40),
        "entity_id" integer,
        "href" text,
        "metadata" jsonb not null default '{}'::jsonb,
        "read_at" timestamp,
        "archived_at" timestamp,
        "created_at" timestamp not null default now()
      );
      create table if not exists "notification_subscriptions" (
        "id" serial primary key,
        "owner_type" varchar(20) not null default 'staff',
        "staff_id" integer references "staff" ("id"),
        "customer_id" integer references "customers" ("id"),
        "endpoint" text not null unique,
        "p256dh" text not null,
        "auth" text not null,
        "user_agent" text,
        "is_active" integer not null default 1,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create table if not exists "notification_settings" (
        "id" serial primary key,
        "owner_type" varchar(20) not null default 'global',
        "owner_id" integer,
        "push_enabled" integer not null default 1,
        "orders_enabled" integer not null default 1,
        "messages_enabled" integer not null default 1,
        "tasks_enabled" integer not null default 1,
        "inventory_enabled" integer not null default 1,
        "customer_enabled" integer not null default 1,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      );
      create index if not exists "tasks_assigned_staff_ids_gin_idx" on "tasks" using gin ("assigned_staff_ids");
      create index if not exists "tasks_status_due_idx" on "tasks" ("status", "due_at");
      create index if not exists "message_threads_status_idx" on "message_threads" ("status", "last_message_at");
      create index if not exists "message_replies_thread_idx" on "message_replies" ("thread_id", "created_at");
      create index if not exists "customer_activity_created_idx" on "customer_activity_logs" ("created_at");
      create index if not exists "customer_activity_customer_idx" on "customer_activity_logs" ("customer_id", "created_at");
      create index if not exists "customer_notes_customer_created_idx" on "customer_notes" ("customer_id", "created_at");
      create index if not exists "attendance_staff_day_idx" on "attendance_records" ("staff_id", "check_in_at");
      create unique index if not exists "qr_tokens_entity_unique_idx" on "qr_tokens" ("entity_type", "entity_id");
      create index if not exists "orders_qr_token_idx" on "orders" ("qr_token");
      create index if not exists "service_orders_qr_token_idx" on "service_orders" ("qr_token");
      create index if not exists "sales_invoices_qr_token_idx" on "sales_invoices" ("qr_token");
      create index if not exists "notifications_audience_created_idx" on "notifications" ("audience_type", "created_at");
      create index if not exists "notifications_staff_read_idx" on "notifications" ("staff_id", "read_at");
      create index if not exists "notifications_customer_read_idx" on "notifications" ("customer_id", "read_at");
      create index if not exists "notification_subscriptions_staff_idx" on "notification_subscriptions" ("staff_id", "is_active");
      create index if not exists "notification_subscriptions_customer_idx" on "notification_subscriptions" ("customer_id", "is_active");
      create unique index if not exists "notification_settings_owner_unique_idx" on "notification_settings" ("owner_type", coalesce("owner_id", 0));
    `).then(() => undefined).catch((err) => {
      adminExtensionsTablesPromise = null;
      throw err;
    });
  }
  await adminExtensionsTablesPromise;
}

function normalizeCouponCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCouponType(value: unknown): "percentage" | "fixed" | "free_shipping" {
  const raw = String(value ?? "").trim();
  return raw === "percentage" || raw === "free_shipping" ? raw : "fixed";
}

function couponToJson(coupon: any) {
  return {
    id: coupon.id,
    code: coupon.code,
    title: coupon.title ?? "",
    type: normalizeCouponType(coupon.type),
    value: Number.parseFloat(String(coupon.value ?? "0")) || 0,
    minOrderAmount: Number.parseFloat(String(coupon.minOrderAmount ?? coupon.min_order_amount ?? "0")) || 0,
    usageLimit: coupon.usageLimit ?? coupon.usage_limit ?? null,
    usedCount: coupon.usedCount ?? coupon.used_count ?? 0,
    expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt).toISOString() : null,
    isActive: coupon.isActive ?? coupon.is_active ?? true,
    createdAt: coupon.createdAt ? new Date(coupon.createdAt).toISOString() : null,
  };
}

async function calculateCouponDiscount(codeInput: unknown, subtotalInput: unknown, deliveryFeeInput: unknown) {
  await ensureCouponsTables();
  const code = normalizeCouponCode(codeInput);
  if (!code) return { ok: false as const, status: 400, message: "أدخل كود الخصم" };
  const coupon = await db.query.couponsTable.findFirst({ where: eq(couponsTable.code, code) });
  if (!coupon || !coupon.isActive) return { ok: false as const, status: 404, message: "الكوبون غير صالح" };
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) return { ok: false as const, status: 400, message: "انتهت صلاحية الكوبون" };
  if (coupon.usageLimit !== null && coupon.usageLimit !== undefined && coupon.usedCount >= coupon.usageLimit) {
    return { ok: false as const, status: 400, message: "تم استهلاك حد استخدام الكوبون" };
  }
  const subtotal = money(subtotalInput);
  const deliveryFee = money(deliveryFeeInput);
  const minOrder = Number.parseFloat(String(coupon.minOrderAmount ?? "0")) || 0;
  if (subtotal < minOrder) {
    return { ok: false as const, status: 400, message: `الحد الأدنى للكوبون ${minOrder.toLocaleString("ar-IQ")} د.ع` };
  }
  const value = Number.parseFloat(String(coupon.value ?? "0")) || 0;
  const baseTotal = subtotal + deliveryFee;
  const discountAmount = coupon.type === "percentage"
    ? Math.min(baseTotal, Math.max(0, subtotal * Math.min(value, 100) / 100))
    : coupon.type === "free_shipping"
      ? Math.min(baseTotal, deliveryFee)
      : Math.min(baseTotal, value);
  return {
    ok: true as const,
    coupon,
    discountAmount: Math.round(discountAmount),
    subtotal,
    deliveryFee,
    finalTotal: Math.max(baseTotal - Math.round(discountAmount), 0),
  };
}

async function recordCouponUsage(coupon: any, data: { customerPhone?: string | null; orderId?: number | null; salesInvoiceId?: number | null; discountAmount: number }) {
  if (!coupon?.id || data.discountAmount <= 0) return;
  await ensureCouponsTables();
  await db.insert(couponUsagesTable).values({
    couponId: coupon.id,
    customerPhone: data.customerPhone ?? null,
    orderId: data.orderId ?? null,
    salesInvoiceId: data.salesInvoiceId ?? null,
    discountAmount: String(data.discountAmount),
  });
  await db.update(couponsTable)
    .set({ usedCount: sql`${couponsTable.usedCount} + 1`, updatedAt: new Date() } as any)
    .where(eq(couponsTable.id, coupon.id));
}

async function logAdminActivity(req: NextRequest, action: string, entityType?: string, entityId?: number, metadata: Record<string, unknown> = {}) {
  try {
    await ensureActivityTables();
    const user = await getAdminUser(req);
    const staffId = user?.id ?? null;
    if (staffId) {
      await db.update(staffTable).set({ lastActivityAt: new Date() }).where(eq(staffTable.id, staffId));
    }
    await db.insert(adminActivityLogsTable).values({
      staffId,
      userName: user?.fullName || user?.username || "النظام",
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      metadata,
      ipAddress: ip(req),
      userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    });
  } catch (err) {
    console.warn("admin activity log failed", { action, entityType, entityId, err });
  }
}

async function cleanupOtpCodes(): Promise<void> {
  await ensureOtpTable();
  await db.execute(sql`
    delete from "otp_codes"
    where "expires_at" < now()
       or ("used" = true and "created_at" < now() - interval '1 day')
  `);
}

async function findCustomerByPhone(phone: string) {
  await ensureCustomerProfileColumns();
  const variants = iraqiPhoneVariants(phone);
  if (variants.length === 0) return null;
  return db.query.customersTable.findFirst({
    where: inArray(customersTable.phone, variants),
  });
}

async function ensureCustomerForPhone(phone: string) {
  await ensureCustomerProfileColumns();
  const normalized = normalizeIraqiPhone(phone);
  if (!normalized) return null;
  const existing = await findCustomerByPhone(normalized);
  if (existing) {
    if (existing.phone !== normalized) {
      try {
        const [updated] = await db
          .update(customersTable)
          .set({ phone: normalized, updatedAt: new Date() })
          .where(eq(customersTable.id, existing.id))
          .returning();
        return updated;
      } catch (err: any) {
        if (err?.code !== "23505") throw err;
      }
    }
    return existing;
  }
  const [created] = await db
    .insert(customersTable)
    .values({ phone: normalized, name: formatIraqiPhone(normalized), fullName: "" })
    .returning();
  return created;
}

function publicCustomer(customer: any) {
  return {
    id: customer.id,
    phone: customer.phone,
    phoneDisplay: formatIraqiPhone(customer.phone),
    name: customer.fullName || customer.name || formatIraqiPhone(customer.phone),
    fullName: customer.fullName ?? customer.name ?? "",
    email: customer.email ?? "",
    avatarUrl: customer.avatarUrl ?? "",
    avatarMetadata: customer.avatarMetadata ?? {},
    address: customer.address ?? "",
    city: customer.city ?? "",
    role: customer.role,
    rewardPoints: Number(customer.rewardPoints ?? 0),
    rewardLevel: customer.rewardLevel ?? rewardLevelForPoints(Number(customer.rewardPoints ?? 0)),
    createdAt: customer.createdAt?.toISOString?.() ?? customer.createdAt,
    updatedAt: customer.updatedAt?.toISOString?.() ?? customer.updatedAt ?? null,
  };
}

function rewardLevelForPoints(points: number): "bronze" | "silver" | "gold" | "vip" {
  if (points >= 4000) return "vip";
  if (points >= 1500) return "gold";
  if (points >= 500) return "silver";
  return "bronze";
}

function rewardLabel(level?: string | null): string {
  if (level === "vip") return "VIP";
  if (level === "gold") return "ذهبي";
  if (level === "silver") return "فضي";
  return "برونزي";
}

type LoyaltySettings = {
  enabled: boolean;
  amountPerPoint: number;
  pointsPerUnit: number;
  redeemValue: number;
};

const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: true,
  amountPerPoint: 10000,
  pointsPerUnit: 1,
  redeemValue: 1000,
};

type PrinterSettings = {
  defaultPaperSize: "80mm" | "58mm" | "a4";
  autoPrint: boolean;
  copies: number;
  showLogo: boolean;
};

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  defaultPaperSize: "80mm",
  autoPrint: false,
  copies: 1,
  showLogo: true,
};

function normalizePrinterSettings(value: unknown): PrinterSettings {
  const raw = value && typeof value === "object" ? value as Partial<PrinterSettings> : {};
  const defaultPaperSize = raw.defaultPaperSize === "58mm" || raw.defaultPaperSize === "a4" ? raw.defaultPaperSize : "80mm";
  return {
    defaultPaperSize,
    autoPrint: raw.autoPrint === true,
    copies: Math.min(Math.max(Number(raw.copies ?? DEFAULT_PRINTER_SETTINGS.copies) || 1, 1), 5),
    showLogo: raw.showLogo !== false,
  };
}

async function getPrinterSettings(): Promise<PrinterSettings> {
  const row = await db.query.settingsTable.findFirst({ where: eq(settingsTable.key, "printerSettings") });
  return normalizePrinterSettings(row?.value ?? DEFAULT_PRINTER_SETTINGS);
}

async function savePrinterSettings(input: unknown): Promise<PrinterSettings> {
  const settings = normalizePrinterSettings(input);
  await db
    .insert(settingsTable)
    .values({ key: "printerSettings", value: settings as any })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: settings as any, updatedAt: new Date() } });
  return settings;
}

async function getLoyaltySettings(): Promise<LoyaltySettings> {
  const row = await db.query.settingsTable.findFirst({ where: eq(settingsTable.key, "loyaltySettings") });
  const value = row?.value && typeof row.value === "object" ? row.value as Partial<LoyaltySettings> : {};
  return {
    enabled: value.enabled !== false,
    amountPerPoint: Math.max(1, Number(value.amountPerPoint ?? DEFAULT_LOYALTY_SETTINGS.amountPerPoint) || DEFAULT_LOYALTY_SETTINGS.amountPerPoint),
    pointsPerUnit: Math.max(1, Number(value.pointsPerUnit ?? DEFAULT_LOYALTY_SETTINGS.pointsPerUnit) || DEFAULT_LOYALTY_SETTINGS.pointsPerUnit),
    redeemValue: Math.max(1, Number(value.redeemValue ?? DEFAULT_LOYALTY_SETTINGS.redeemValue) || DEFAULT_LOYALTY_SETTINGS.redeemValue),
  };
}

async function saveLoyaltySettings(input: Partial<LoyaltySettings>): Promise<LoyaltySettings> {
  const current = await getLoyaltySettings();
  const next: LoyaltySettings = {
    enabled: input.enabled ?? current.enabled,
    amountPerPoint: Math.max(1, Number(input.amountPerPoint ?? current.amountPerPoint) || current.amountPerPoint),
    pointsPerUnit: Math.max(1, Number(input.pointsPerUnit ?? current.pointsPerUnit) || current.pointsPerUnit),
    redeemValue: Math.max(1, Number(input.redeemValue ?? current.redeemValue) || current.redeemValue),
  };
  await db
    .insert(settingsTable)
    .values({ key: "loyaltySettings", value: next as any })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: next as any, updatedAt: new Date() } });
  return next;
}

function rewardPointsForAmount(value: unknown): number {
  const total = Math.max(0, money(value));
  if (total <= 0) return 0;
  return Math.max(1, Math.floor(total / 10000));
}

async function rewardPointsForAmountConfigured(value: unknown): Promise<number> {
  const settings = await getLoyaltySettings();
  if (!settings.enabled) return 0;
  const total = Math.max(0, money(value));
  if (total <= 0) return 0;
  return Math.max(1, Math.floor(total / settings.amountPerPoint) * settings.pointsPerUnit);
}

async function addCustomerReward(customerId: number, points: number, values: { orderId?: number | null; serviceOrderId?: number | null; reason?: string; note?: string | null }) {
  await ensureCustomerRewards();
  if (!Number.isFinite(points) || points === 0) return null;
  const [updated] = await db
    .update(customersTable)
    .set({
      rewardPoints: sql`greatest(${customersTable.rewardPoints} + ${points}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(customersTable.id, customerId))
    .returning();
  if (!updated) return null;
  const nextLevel = rewardLevelForPoints(Number(updated.rewardPoints ?? 0));
  if (updated.rewardLevel !== nextLevel) {
    await db.update(customersTable).set({ rewardLevel: nextLevel, updatedAt: new Date() }).where(eq(customersTable.id, customerId));
  }
  await db.insert(customerRewardHistoryTable).values({
    customerId,
    orderId: values.orderId ?? null,
    serviceOrderId: values.serviceOrderId ?? null,
    points,
    reason: values.reason ?? "order_reward",
    note: values.note ?? null,
  });
  await db.insert(loyaltyPointsTable).values({
    customerId,
    orderId: values.orderId ?? null,
    serviceOrderId: values.serviceOrderId ?? null,
    points,
    reason: values.reason ?? "order_reward",
    note: values.note ?? null,
  }).catch(() => undefined);
  return { ...updated, rewardLevel: nextLevel };
}

async function awardProductOrderPoints(order: any) {
  await ensureCustomerRewards();
  if (!order || Number(order.rewardPointsAwarded ?? 0) > 0) return;
  if (!["delivered", "completed"].includes(String(order.status)) && order.paymentStatus !== "paid") return;
  const customer =
    order.customerId
      ? await db.query.customersTable.findFirst({ where: eq(customersTable.id, order.customerId) })
      : await findCustomerByPhone(order.customerPhone);
  if (!customer) return;
  const points = await rewardPointsForAmountConfigured(order.total);
  if (points <= 0) return;
  await addCustomerReward(customer.id, points, {
    orderId: order.id,
    reason: "product_order",
    note: `نقاط الطلب ${order.trackingCode}`,
  });
  await db.update(ordersTable).set({ rewardPointsAwarded: points }).where(eq(ordersTable.id, order.id));
}

async function awardServiceOrderPoints(order: any) {
  await ensureCustomerRewards();
  if (!order || Number(order.rewardPointsAwarded ?? 0) > 0) return;
  if (!["delivered", "completed"].includes(String(order.status)) && order.paymentStatus !== "paid") return;
  const customer = await findCustomerByPhone(order.phone);
  if (!customer) return;
  const points = await rewardPointsForAmountConfigured(order.totalAmount);
  if (points <= 0) return;
  await addCustomerReward(customer.id, points, {
    serviceOrderId: order.id,
    reason: "service_booking",
    note: `نقاط الحجز ${order.trackingCode ?? order.id}`,
  });
  await db.update(serviceOrdersTable).set({ rewardPointsAwarded: points }).where(eq(serviceOrdersTable.id, order.id));
}

async function buildCart(sessionId: string) {
  const items = await normalizeCartRows(sessionId);
  const productIds = Array.from(new Set(items.map((item) => item.productId))).filter((id) => Number.isFinite(id));
  const products =
    productIds.length > 0
      ? await db.select().from(productsTable).where(inArray(productsTable.id, productIds))
      : [];
  const hydratedProducts = await hydrateSharedStockProducts(products);
  const productMap = new Map(hydratedProducts.map((product) => [product.id, product]));
  const enriched = items.map((item) => {
    const product = productMap.get(item.productId);
    return {
      id: item.id,
      productId: item.productId,
      product: product
        ? {
            id: product.id,
            name: product.name,
            nameAr: product.nameAr,
            price: Number.parseFloat(product.price),
            images: product.images ?? [],
            stock: productStockAmount(product),
            colors: normalizeColors(product.colors ?? []),
            isFeatured: product.isFeatured,
            rating: null,
            reviewCount: 0,
            createdAt: product.createdAt.toISOString(),
          }
        : null,
      quantity: item.quantity,
      price: Number.parseFloat(item.price),
      selectedColor: selectedColorName(item.selectedColorData, item.selectedColor),
      selectedColorData: selectedColorPayload(item.selectedColorData, item.selectedColor),
      customization: item.customization ?? null,
    };
  });
  return {
    items: enriched,
    total: enriched.reduce((sum, i) => sum + i.price * i.quantity, 0),
    itemCount: enriched.reduce((sum, i) => sum + i.quantity, 0),
  };
}

async function formatOrder(order: any) {
  const items = await db.query.orderItemsTable.findMany({
    where: eq(orderItemsTable.orderId, order.id),
  });
  return {
    id: order.id,
    trackingCode: order.trackingCode,
    qrToken: order.qrToken ?? null,
    phoneLast4: order.phoneLast4 ?? phoneLast4(order.customerPhone),
    customerId: order.customerId ?? null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    status: order.status,
    serviceType: order.serviceType ?? null,
    total: Number.parseFloat(order.total),
    deliveryFee: Number.parseFloat(order.deliveryFee),
    couponCode: order.couponCode ?? null,
    couponDiscountAmount: Number.parseFloat(order.couponDiscountAmount ?? "0"),
    loyaltyPointsRedeemed: Number(order.loyaltyPointsRedeemed ?? 0),
    loyaltyDiscountAmount: Number.parseFloat(order.loyaltyDiscountAmount ?? "0"),
    depositAmount: Number.parseFloat(order.depositAmount ?? "0"),
    remainingAmount: Number.parseFloat(order.remainingAmount ?? "0"),
    paymentStatus: order.paymentStatus ?? "unpaid",
    rewardPointsAwarded: Number(order.rewardPointsAwarded ?? 0),
    archivedAt: order.archivedAt ? order.archivedAt.toISOString() : null,
    governorate: order.governorate ?? null,
    address: order.address ?? null,
    notes: order.notes ?? null,
    internalNotes: order.internalNotes ?? null,
    paymentMethod: order.paymentMethod ?? "cod",
    area: order.area ?? null,
    mapsUrl: order.mapsUrl ?? null,
    attachments: order.attachments ?? [],
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productNameAr: i.productNameAr,
      quantity: i.quantity,
      price: Number.parseFloat(i.price),
      selectedColor: selectedColorName(i.selectedColorData, i.selectedColor),
      selectedColorData: selectedColorPayload(i.selectedColorData, i.selectedColor),
      customization: i.customization ?? null,
      image: publicMediaValue("order-item", i, i.image),
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

async function buildTracking(order: any) {
  const items = await db.query.orderItemsTable.findMany({
    where: eq(orderItemsTable.orderId, order.id),
  });
  const history = await db.query.orderStatusHistoryTable.findMany({
    where: eq(orderStatusHistoryTable.orderId, order.id),
    orderBy: [desc(orderStatusHistoryTable.createdAt)],
  });
  const qrScanUrl = order.qrToken ? `${process.env.APP_BASE_URL?.replace(/\/$/, "") || ""}/api/qr/${order.qrToken}` : null;
  const qrDataUrl = qrScanUrl ? await QRCode.toDataURL(qrScanUrl, { margin: 1, width: 180 }) : null;
  return {
    trackingCode: order.trackingCode,
    qrToken: order.qrToken ?? null,
    qrScanUrl,
    qrDataUrl,
    id: order.id,
    phoneLast4: order.phoneLast4 ?? phoneLast4(order.customerPhone),
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone ?? null,
    serviceType: order.serviceType ?? null,
    kind: "product",
    total: Number.parseFloat(order.total),
    couponCode: order.couponCode ?? null,
    couponDiscountAmount: Number.parseFloat(order.couponDiscountAmount ?? "0"),
    loyaltyPointsRedeemed: Number(order.loyaltyPointsRedeemed ?? 0),
    loyaltyDiscountAmount: Number.parseFloat(order.loyaltyDiscountAmount ?? "0"),
    depositAmount: Number.parseFloat(order.depositAmount ?? "0"),
    remainingAmount: Number.parseFloat(order.remainingAmount ?? "0"),
    paymentStatus: order.paymentStatus ?? "unpaid",
    rewardPointsAwarded: Number(order.rewardPointsAwarded ?? 0),
    archivedAt: order.archivedAt ? order.archivedAt.toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productNameAr: i.productNameAr,
      quantity: i.quantity,
      price: Number.parseFloat(i.price),
      selectedColor: selectedColorName(i.selectedColorData, i.selectedColor),
      selectedColorData: selectedColorPayload(i.selectedColorData, i.selectedColor),
      customization: i.customization ?? null,
      image: publicMediaValue("order-item", i, i.image),
    })),
    statusHistory: history.map((h) => ({
      status: h.status,
      notes: h.notes ?? null,
      createdAt: h.createdAt.toISOString(),
    })),
    createdAt: order.createdAt.toISOString(),
    estimatedDelivery: null,
    mapsUrl: order.mapsUrl ?? null,
    governorate: order.governorate ?? null,
    area: order.area ?? null,
    address: order.address ?? null,
    notes: order.notes ?? null,
  };
}

async function buildServiceTracking(so: any) {
  const service = await db.query.servicesTable.findFirst({
    where: eq(servicesTable.id, so.serviceId),
  });
  const history = await db.query.serviceOrderStatusHistoryTable.findMany({
    where: eq(serviceOrderStatusHistoryTable.serviceOrderId, so.id),
    orderBy: [desc(serviceOrderStatusHistoryTable.createdAt)],
  });
  const statusHistory =
    history.length > 0
      ? history.map((h) => ({
          status: h.status,
          notes: h.notes ?? null,
          createdAt: h.createdAt.toISOString(),
        }))
      : [{ status: so.status, notes: null, createdAt: so.createdAt.toISOString() }];
  const qrScanUrl = so.qrToken ? `${process.env.APP_BASE_URL?.replace(/\/$/, "") || ""}/api/qr/${so.qrToken}` : null;
  const qrDataUrl = qrScanUrl ? await QRCode.toDataURL(qrScanUrl, { margin: 1, width: 180 }) : null;
  return {
    trackingCode: so.trackingCode ?? `SRV-${so.id}`,
    qrToken: so.qrToken ?? null,
    qrScanUrl,
    qrDataUrl,
    id: so.id,
    phoneLast4: so.phoneLast4 ?? phoneLast4(so.phone),
    status: so.status,
    customerName: so.customerName,
    customerPhone: so.phone ?? null,
    serviceType: service?.type ?? null,
    serviceName: service?.nameAr ?? service?.name ?? null,
    serviceImage: publicMediaValue("service", service, service?.image),
    kind: "service",
    total: Number.parseFloat(so.totalAmount ?? "0"),
    depositAmount: Number.parseFloat(so.depositAmount ?? "0"),
    remainingAmount: Number.parseFloat(so.remainingAmount ?? "0"),
    paymentStatus: so.paymentStatus ?? "unpaid",
    rewardPointsAwarded: Number(so.rewardPointsAwarded ?? 0),
    archivedAt: so.archivedAt ? so.archivedAt.toISOString() : null,
    items: [],
    statusHistory,
    createdAt: so.createdAt.toISOString(),
    estimatedDelivery: null,
    eventDate: so.eventDate ?? null,
    eventLocation: so.eventLocation ?? null,
    customFields: so.customFields ?? {},
    notes: so.notes ?? null,
    customerConfirmation: so.customerConfirmation ?? null,
    requestedDate: so.requestedDate ?? null,
    confirmationNote: so.confirmationNote ?? null,
    confirmationAt: so.confirmationAt ? so.confirmationAt.toISOString() : null,
  };
}

function maskName(name: string): string {
  if (!name) return "";
  return name
    .trim()
    .split(/\s+/)
    .map((p) => (p.length <= 2 ? p : `${p.slice(0, 2)}…`))
    .join(" ");
}

function stripPii<T extends { customerName: string; customerPhone: string | null }>(t: T) {
  return { ...t, customerName: maskName(t.customerName), customerPhone: null };
}

async function findBookingConflict(input: {
  serviceId: number;
  eventDate?: string | null;
  customFields?: Record<string, unknown> | null;
  excludeId?: number;
}) {
  const day = String(input.eventDate ?? "").slice(0, 10);
  if (!day) return null;
  const crewName = String((input.customFields as any)?.crewName ?? "").trim();
  const rows = await db.query.serviceOrdersTable.findMany({
    where: sql`${serviceOrdersTable.archivedAt} is null and ${serviceOrdersTable.status} not in ('cancelled','completed','delivered') and ${serviceOrdersTable.eventDate} like ${`${day}%`}`,
    limit: 80,
  });
  return rows.find((row) => {
    if (input.excludeId && row.id === input.excludeId) return false;
    const rowCrew = String((row.customFields as any)?.crewName ?? "").trim();
    return row.serviceId === input.serviceId || (crewName && rowCrew && rowCrew === crewName);
  }) ?? null;
}

async function insertServiceOrderWithTracking(values: Omit<typeof serviceOrdersTable.$inferInsert, "trackingCode" | "phoneLast4">) {
  await ensureTrackingColumns();
  await ensurePaymentWorkflowColumns();
  const payment = paymentSummary((values as any).totalAmount, (values as any).depositAmount, (values as any).paymentStatus);
  const [row] = await db
    .insert(serviceOrdersTable)
    .values({
      ...values,
      trackingCode: trackingCodeForPhone(values.phone),
      phoneLast4: phoneLast4(values.phone),
      totalAmount: String(money((values as any).totalAmount)),
      depositAmount: String(payment.deposit),
      remainingAmount: String(payment.remaining),
      paymentStatus: payment.status,
    })
    .returning();
  return row;
}

async function handleAuth(req: NextRequest, parts: string[]) {
  const method = req.method;
  const isWhatsAppRequest = parts[1] === "whatsapp" && parts[2] === "request-otp";
  const isWhatsAppVerify = parts[1] === "whatsapp" && parts[2] === "verify-otp";

  if (method === "POST" && (parts[1] === "request-otp" || isWhatsAppRequest)) {
    const parsed = RequestOtpBody.safeParse(await body(req));
    if (!parsed.success) return validationError("auth.request-otp", parsed);
    const phone = normalizeIraqiPhone(parsed.data.phone);
    if (!phone) return error("رقم الهاتف العراقي غير صحيح", 400);
    const reqIp = ip(req);
    if (!checkRateLimit(otpRequestByPhone, phone, 5, 10 * 60 * 1000)) {
      return error("تجاوزت الحد المسموح، حاول لاحقاً", 429);
    }
    if (!checkRateLimit(otpRequestByIp, reqIp, 10, 60 * 60 * 1000)) {
      return error("تجاوزت الحد المسموح، حاول لاحقاً", 429);
    }
    await cleanupOtpCodes();
    const recent = await db.query.otpCodesTable.findFirst({
      where: and(
        eq(otpCodesTable.phone, phone),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.createdAt, new Date(Date.now() - 60 * 1000)),
      ),
      orderBy: [desc(otpCodesTable.createdAt)],
    });
    if (recent) return error("انتظر 60 ثانية قبل طلب رمز جديد", 429);

    const code = generateOtp();
    await db.insert(otpCodesTable).values({
      phone,
      codeHash: hashOtp(phone, code),
      attempts: 0,
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    const sent = await sendOtpViaUltraMsg(phone, code);
    if (!sent.ok) {
      await db
        .update(otpCodesTable)
        .set({ used: true })
        .where(and(eq(otpCodesTable.phone, phone), eq(otpCodesTable.codeHash, hashOtp(phone, code))));
      return error("تعذر إرسال رمز التحقق عبر واتساب، تأكد من الرقم وحاول لاحقاً", 502);
    }
    return json({
      message: "تم إرسال رمز التحقق",
      phone,
    });
  }

  if (method === "POST" && (parts[1] === "verify-otp" || isWhatsAppVerify)) {
    const parsed = VerifyOtpBody.safeParse(await body(req));
    if (!parsed.success) return validationError("auth.verify-otp", parsed);
    const phone = normalizeIraqiPhone(parsed.data.phone);
    const otp = normalizePhoneDigits(parsed.data.otp).slice(0, 6);
    if (!phone || otp.length !== 6) return error("أدخل رقم هاتف عراقي صحيح ورمزاً من 6 أرقام", 400);
    if (!checkRateLimit(otpVerifyByPhone, phone, 5, 10 * 60 * 1000)) {
      return error("تجاوزت عدد المحاولات، حاول لاحقاً", 429);
    }
    await cleanupOtpCodes();
    const record = await db.query.otpCodesTable.findFirst({
      where: and(
        inArray(otpCodesTable.phone, iraqiPhoneVariants(phone)),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, new Date()),
      ),
      orderBy: [desc(otpCodesTable.createdAt)],
    });
    if (!record) return error("رمز التحقق غير صحيح أو منتهي الصلاحية", 400);
    if ((record.attempts ?? 0) >= 5) return error("تم قفل محاولة التحقق، اطلب رمزاً جديداً", 423);
    if (!verifyOtpHash(phone, otp, record.codeHash || "")) {
      await db
        .update(otpCodesTable)
        .set({ attempts: (record.attempts ?? 0) + 1 })
        .where(eq(otpCodesTable.id, record.id));
      return error((record.attempts ?? 0) + 1 >= 5 ? "تم قفل محاولة التحقق، اطلب رمزاً جديداً" : "رمز التحقق غير صحيح", 400);
    }

    await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, record.id));
    const customer = await ensureCustomerForPhone(phone);
    if (!customer) return error("رقم الهاتف العراقي غير صحيح", 400);
    const token = signCustomerToken(customer.id);
    customerSessions.set(token, customer.id);
    return withCustomerCookie(json({
      customer: publicCustomer(customer),
      token,
      redirectTo: "/profile",
    }), token);
  }

  if (method === "GET" && parts[1] === "me") {
    const customerId = getCurrentCustomerId(req);
    if (!customerId) return error("غير مخول", 401);
    await ensureCustomerProfileColumns();
    const customer = await db.query.customersTable.findFirst({
      where: eq(customersTable.id, customerId),
    });
    if (!customer) return error("المستخدم غير موجود", 404);
    return json(publicCustomer(customer));
  }

  if (method === "PATCH" && parts[1] === "me") {
    const customerId = getCurrentCustomerId(req);
    if (!customerId) return error("غير مخول", 401);
    await ensureCustomerProfileColumns();
    const data = await body(req);
    const fullName = String(data?.fullName ?? "").trim().slice(0, 160);
    const email = String(data?.email ?? "").trim().slice(0, 180);
    const address = String(data?.address ?? "").trim().slice(0, 500);
    const city = String(data?.city ?? "").trim().slice(0, 120);
    const avatarUrl = await persistMediaValue(data?.avatarUrl ?? "", "avatars");
    const avatarMetadata = data?.avatarMetadata && typeof data.avatarMetadata === "object" ? data.avatarMetadata : {};
    const [customer] = await db
      .update(customersTable)
      .set({
        fullName: fullName || null,
        name: fullName || undefined,
        email: email || null,
        avatarUrl: avatarUrl || null,
        avatarMetadata,
        address: address || null,
        city: city || null,
        updatedAt: new Date(),
      })
      .where(eq(customersTable.id, customerId))
      .returning();
    if (!customer) return error("المستخدم غير موجود", 404);
    return json(publicCustomer(customer));
  }

  if (method === "POST" && parts[1] === "logout") {
    const token = req.cookies.get(CUSTOMER_COOKIE_NAME)?.value || bearer(req);
    if (token) customerSessions.delete(token);
    return clearCustomerCookie(json({ message: "تم تسجيل الخروج" }));
  }

  return null;
}

async function handleProducts(req: NextRequest, parts: string[]) {
  const method = req.method;
  await ensureAdminProductsColumns();
  await ensureStoreCategoryColumns();

  if (method === "GET" && parts[1] === "featured") {
    const products = await db.query.productsTable.findMany({
      where: and(eq(productsTable.isFeatured, true), eq(productsTable.isActive, true)),
      limit: 8,
    });
    const hydrated = await hydrateSharedStockProducts(products);
    return json(hydrated.map((p) => formatProduct(p)));
  }

  if (method === "GET" && parts[1] === "store-categories") {
    const parentParam = req.nextUrl.searchParams.get("parent")?.trim();
    const cacheKey = parentParam || "__root__";
    const cached = storeCategoriesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const cachedRes = json(cached.payload);
      cachedRes.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
      return cachedRes;
    }
    const categories = await db.query.categoriesTable.findMany({
      where: eq(categoriesTable.isActive, true),
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.id)],
    }) as any[];
    const products = await db
      .select({
        id: productsTable.id,
        categoryId: productsTable.categoryId,
        subcategoryId: productsTable.subcategoryId,
        category: productsTable.category,
        subcategory: productsTable.subcategory,
      })
      .from(productsTable)
      .where(eq(productsTable.isActive, true)) as any[];
    const parent = parentParam
      ? categories.find((item) => String(item.id) === parentParam || item.slug === parentParam)
      : null;
    if (parentParam && !parent) {
      storeCategoriesCache.set(cacheKey, { expiresAt: Date.now() + STORE_CATEGORIES_TTL_MS, payload: [] });
      return json([]);
    }
    const rows = categories.filter((item) => parent ? item.parentId === parent.id : !item.parentId);
    const countFor = (category: any) => products.filter((product) => {
      if (category.parentId) {
        return product.subcategoryId === category.id || product.subcategory === category.slug;
      }
      return product.categoryId === category.id || product.category === category.slug;
    }).length;
    const payload = rows.map((category) => formatCategory(category, countFor(category)));
    storeCategoriesCache.set(cacheKey, { expiresAt: Date.now() + STORE_CATEGORIES_TTL_MS, payload });
    const res = json(payload);
    res.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res;
  }

  if (method === "GET" && parts[1] === "categories") {
    const result = await db
      .select({ category: productsTable.category, count: sql<number>`count(*)::int` })
      .from(productsTable)
      .where(sql`${productsTable.category} is not null`)
      .groupBy(productsTable.category);
    return json(result.map((r) => ({ name: r.category!, count: r.count })));
  }

  if (method === "GET" && parts.length === 1) {
    const params = ListProductsQueryParams.safeParse(query(req));
    const { category, subcategory, categoryId, subcategoryId, search, inStock } = params.success ? params.data : {};
    const limit = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "80", 10) || 80, 1), 120);
    const offset = Math.max(Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const products = await db.query.productsTable.findMany({
      where: and(
        eq(productsTable.isActive, true),
        categoryId ? eq(productsTable.categoryId, categoryId) : undefined,
        subcategoryId ? eq(productsTable.subcategoryId, subcategoryId) : undefined,
        category ? or(eq(productsTable.category, category), sql`${productsTable.categoryId} in (select id from categories where slug = ${category})`) : undefined,
        subcategory ? or(eq(productsTable.subcategory, subcategory), sql`${productsTable.subcategoryId} in (select id from categories where slug = ${subcategory})`) : undefined,
        search ? ilike(productsTable.nameAr, `%${search}%`) : undefined,
        inStock ? sql`coalesce((select stock from products root where root.id = ${productsTable.sharedStockProductId}), ${productsTable.stock}) > 0` : undefined,
      ),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
      limit,
      offset,
    });
    const hydrated = await hydrateSharedStockProducts(products);
    return json(hydrated.map((p) => formatProduct(p)));
  }

  if (method === "GET" && parts[1]) {
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    const product = await db.query.productsTable.findFirst({
      where: eq(productsTable.id, id),
    });
    if (!product) return error("المنتج غير موجود", 404);
    const reviews = await db.query.reviewsTable.findMany({
      where: eq(reviewsTable.productId, id),
    });
    const avgRating =
      reviews.length > 0 ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : undefined;
    const hydrated = await hydrateSharedStockProduct(product);
    return json(formatProduct(hydrated, avgRating, reviews.length));
  }

  if (method === "POST" && parts.length === 1) {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    const productActor = actor(auth);
    const rawBody = await body(req);
    const parsed = CreateProductBody.safeParse(rawBody);
    if (!parsed.success) return validationError("products.create", parsed);
    const data = parsed.data as any;
    const productNameAr = textFallback(data.nameAr, data.name, "منتج جديد");
    const productName = textFallback(data.name, data.nameAr, `product-${Date.now().toString(36)}`);
    const requestedBarcode = normalizeProductBarcode(data.barcode);
    if (requestedBarcode && await productBarcodeExists(requestedBarcode)) return error("الباركود مستخدم مسبقاً", 409);
    const productCategories = await resolveProductCategories(data);
    const sharedStock = await resolveSharedStockProductId(data.sharedStockProductId);
    if (sharedStock.message) return error(sharedStock.message, 400);
    const storedImages = await persistMediaList(data.images ?? [], "products");
    const storedVideos = await persistMediaList(data.videos ?? [], "products/videos");
    let [product] = await db
      .insert(productsTable)
      .values({
        name: productName,
        nameAr: productNameAr,
        description: data.description,
        descriptionAr: data.descriptionAr,
        ...pickContentTranslations(rawBody, true),
        price: String(money(data.price)),
        originalPrice: money(data.originalPrice) > 0 ? String(money(data.originalPrice)) : null,
        costPrice: String(money(data.costPrice)),
        stock: sharedStock.id ? 0 : Number.isFinite(Number(data.stock)) ? Number(data.stock) : 0,
        minStock: sharedStock.id ? 0 : Number.isFinite(Number(data.minStock)) ? Number(data.minStock) : 0,
        sharedStockProductId: sharedStock.id,
        barcode: requestedBarcode || null,
        categoryId: productCategories.categoryId,
        subcategoryId: productCategories.subcategoryId,
        category: productCategories.category,
        images: storedImages,
        videos: storedVideos,
        imageMetadata: Array.isArray(data.imageMetadata) ? data.imageMetadata : [],
        colors: normalizeColors(data.colors ?? []),
        isFeatured: data.isFeatured ?? false,
        subcategory: productCategories.subcategory,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();
    if (!requestedBarcode) {
      const barcode = generatedProductBarcode(product.id);
      const [updated] = await db.update(productsTable).set({ barcode, updatedAt: new Date() }).where(eq(productsTable.id, product.id)).returning();
      product = updated ?? product;
    }
    if (!sharedStock.id && Number(data.stock ?? 0) > 0) {
      const resolved = await getStockOwnerProduct(product.id);
      if (resolved) {
        await recordStockMovement(resolved, Number(data.stock ?? 0), {
          reason: "product_initial_stock",
          relatedType: "product",
          relatedId: product.id,
          createdBy: productActor.id,
          createdByName: productActor.name,
        });
      }
    }
    void logAdminActivity(req, "product_created", "product", product.id, { name: product.nameAr });
    clearStoreCategoriesCache();
    const hydrated = await hydrateSharedStockProduct(product);
    return json(formatProduct(hydrated), 201);
  }

  if (method === "PATCH" && parts[1]) {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    const productActor = actor(auth);
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    const rawBody = await body(req);
    const parsed = UpdateProductBody.safeParse(rawBody);
    if (!parsed.success) return validationError("products.update", parsed);
    const data = parsed.data as any;
    const existing = await db.query.productsTable.findFirst({ where: eq(productsTable.id, id) }) as any;
    if (!existing) return error("المنتج غير موجود", 404);
    const hasSharedStockChange = Object.prototype.hasOwnProperty.call(data, "sharedStockProductId");
    let sharedStock = hasSharedStockChange
      ? await resolveSharedStockProductId(data.sharedStockProductId, id)
      : { id: productSharedStockId(existing) };
    if (sharedStock.message) return error(sharedStock.message, 400);
    const hasLinkedStockList = Object.prototype.hasOwnProperty.call(data, "sharedStockLinkedProductIds");
    const requestedLinkedStockIds = hasLinkedStockList
      ? normalizeSharedStockLinkedIds(data.sharedStockLinkedProductIds, id)
      : [];
    if (hasLinkedStockList) {
      sharedStock = { id: null };
      const linkedError = await validateSharedStockLinkedProducts(id, requestedLinkedStockIds);
      if (linkedError) return error(linkedError, 400);
    }
    if (data.images !== undefined) data.images = await resolveProductImageInputs(id, data.images);
    if (data.videos !== undefined) data.videos = await resolveProductVideoInputs(id, data.videos);
    const update: any = { updatedAt: new Date() };
    let directStockMovementDelta: number | null = null;
    for (const k of [
      "name",
      "nameAr",
      "description",
      "category",
      "images",
      "videos",
      "imageMetadata",
      "colors",
      "isFeatured",
      "descriptionAr",
      "subcategory",
      "isActive",
      "sortOrder",
      "minStock",
      "barcode",
      "categoryId",
      "subcategoryId",
    ]) {
      if (data[k] !== undefined) {
        if ((k === "name" || k === "nameAr") && !String(data[k] ?? "").trim()) continue;
        if (k === "barcode") {
          const barcode = normalizeProductBarcode(data[k]);
          if (barcode && await productBarcodeExists(barcode, id)) return error("الباركود مستخدم مسبقاً", 409);
          update[k] = barcode || null;
        } else if (k === "categoryId" || k === "subcategoryId") {
          update[k] = numberId(data[k]);
        } else {
          update[k] = k === "colors"
            ? normalizeColors(data[k])
            : k === "category" || k === "subcategory"
              ? nullableText(data[k])
              : data[k];
        }
      }
    }
    if (hasSharedStockChange) {
      update.sharedStockProductId = sharedStock.id;
      if (sharedStock.id) {
        update.stock = 0;
        update.minStock = 0;
      }
    }
    if (hasLinkedStockList) {
      update.sharedStockProductId = null;
    }
    if (data.stock !== undefined) {
      const nextStock = Number.isFinite(Number(data.stock)) ? Number(data.stock) : 0;
      if (sharedStock.id) {
        await setProductStock(sharedStock.id, nextStock, {
          reason: "manual_stock_adjustment",
          relatedType: "product",
          relatedId: id,
          createdBy: productActor.id,
          createdByName: productActor.name,
        });
      } else if (hasSharedStockChange) {
        const cleanStock = Math.max(0, Math.floor(nextStock));
        directStockMovementDelta = cleanStock - Number(existing.stock ?? 0);
        update.stock = cleanStock;
      } else {
        await setProductStock(id, nextStock, {
          reason: "manual_stock_adjustment",
          relatedType: "product",
          relatedId: id,
          createdBy: productActor.id,
          createdByName: productActor.name,
        });
      }
    }
    if (data.minStock !== undefined) {
      const nextMinStock = Number.isFinite(Number(data.minStock)) ? Number(data.minStock) : 0;
      if (sharedStock.id) {
        await db
          .update(productsTable)
          .set({ minStock: Math.max(0, Math.floor(nextMinStock)), updatedAt: new Date() })
          .where(eq(productsTable.id, sharedStock.id));
        if (hasSharedStockChange) update.minStock = 0;
        else delete update.minStock;
      } else {
        update.minStock = Math.max(0, Math.floor(nextMinStock));
      }
    }
    if (data.category !== undefined || data.subcategory !== undefined || data.categoryId !== undefined || data.subcategoryId !== undefined) {
      const productCategories = await resolveProductCategories(data);
      update.categoryId = productCategories.categoryId;
      update.subcategoryId = productCategories.subcategoryId;
      update.category = productCategories.category;
      update.subcategory = productCategories.subcategory;
    }
    if (data.price !== undefined) update.price = data.price.toString();
    if (data.originalPrice !== undefined) update.originalPrice = money(data.originalPrice) > 0 ? String(money(data.originalPrice)) : null;
    if (data.costPrice !== undefined) update.costPrice = String(money(data.costPrice));
    Object.assign(update, pickContentTranslations(rawBody, true));
    const [product] = await db.update(productsTable).set(update).where(eq(productsTable.id, id)).returning();
    if (!product) return error("المنتج غير موجود", 404);
    if (hasLinkedStockList) {
      await syncSharedStockLinkedProducts(id, requestedLinkedStockIds, productActor);
    } else if (hasSharedStockChange && sharedStock.id) {
      await db.execute(sql`
        update products
        set shared_stock_product_id = ${sharedStock.id}, updated_at = now()
        where shared_stock_product_id = ${id}
      `);
    }
    if (directStockMovementDelta) {
      await recordStockMovement({ product, stockProduct: product }, directStockMovementDelta, {
        reason: "manual_stock_adjustment",
        relatedType: "product",
        relatedId: id,
        createdBy: productActor.id,
        createdByName: productActor.name,
      });
    }
    void logAdminActivity(req, "product_updated", "product", product.id, { fields: Object.keys(update) });
    clearStoreCategoriesCache();
    const hydrated = await hydrateSharedStockProduct(product);
    return json(formatProduct(hydrated));
  }

  if (method === "DELETE" && parts[1]) {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    await db.delete(productsTable).where(eq(productsTable.id, id));
    void logAdminActivity(req, "product_deleted", "product", id);
    clearStoreCategoriesCache();
    return json({ message: "تم حذف المنتج" });
  }

  return null;
}

async function handleKoshas(req: NextRequest, parts: string[]) {
  const method = req.method;
  await ensureKoshaTables();

  if (method === "GET" && parts.length === 1) {
    const params = req.nextUrl.searchParams;
    const featured = params.get("featured") === "1" || params.get("featured") === "true";
    const search = params.get("search")?.trim();
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "60", 10) || 60, 1), 120);
    const rows = await db.query.koshasTable.findMany({
      where: and(
        eq(koshasTable.isActive, true),
        featured ? eq(koshasTable.isFeatured, true) : undefined,
        search ? ilike(koshasTable.name, `%${search}%`) : undefined,
      ),
      orderBy: (k, { asc, desc }) => [asc(k.sortOrder), desc(k.createdAt)],
      limit,
    });
    return json(await Promise.all(rows.map((row) => formatKosha(row, false))));
  }

  if (method === "GET" && parts[1] === "options") {
    const [addons, welcomeBoards, accessories, provinces] = await Promise.all([
      db.query.koshaAddonsTable.findMany({
        where: eq(koshaAddonsTable.isActive, true),
        orderBy: (item, { asc }) => [asc(item.sortOrder), asc(item.id)],
      }),
      db.query.koshaWelcomeBoardsTable.findMany({
        where: eq(koshaWelcomeBoardsTable.isActive, true),
        orderBy: (item, { asc }) => [asc(item.sortOrder), asc(item.id)],
      }),
      db.query.koshaAccessoriesTable.findMany({
        where: eq(koshaAccessoriesTable.isActive, true),
        orderBy: (item, { asc }) => [asc(item.sortOrder), asc(item.id)],
      }),
      db.query.koshaProvincesTable.findMany({
        where: eq(koshaProvincesTable.isActive, true),
        orderBy: (item, { asc }) => [asc(item.sortOrder), asc(item.id)],
      }),
    ]);
    return json({
      addons: addons.map((item) => formatKoshaOptionProduct(item, "addon")),
      welcomeBoards: welcomeBoards.map((item) => formatKoshaOptionProduct(item, "welcome_board")),
      accessories: accessories.map((item) => formatKoshaOptionProduct(item, "accessory")),
      provinces: provinces.map((item) => ({ id: item.id, name: item.name })),
    });
  }

  if (method === "GET" && parts[1]) {
    const raw = decodeURIComponent(parts[1]);
    const parsedId = int(raw);
    const row = await db.query.koshasTable.findFirst({
      where: and(
        parsedId ? eq(koshasTable.id, parsedId) : eq(koshasTable.slug, raw),
        eq(koshasTable.isActive, true),
      ),
    });
    if (!row) return error("الكوشة غير موجودة", 404);
    return json(await formatKosha(row, true));
  }

  if (method === "POST" && parts[1] && parts[2] === "bookings") {
    const rawBody = await body(req);
    const parsed = KoshaBookingCreateSchema.safeParse({ ...rawBody, koshaId: parts[1] });
    if (!parsed.success) return validationError("kosha-bookings.create", parsed);
    const data = parsed.data;
    const kosha = await db.query.koshasTable.findFirst({
      where: and(eq(koshasTable.id, data.koshaId), eq(koshasTable.isActive, true)),
    });
    if (!kosha) return error("الكوشة غير موجودة", 404);
    const phone = normalizeIraqiPhone(data.phone || data.bridePhone || data.groomPhone || data.alternatePhone);
    if (!phone) return error("أدخل رقم هاتف عراقي صحيح", 400);
    const customerName = textFallback(data.customerName, [data.brideName, data.groomName].filter(Boolean).join(" و ") || "زبون");
    const venueImages = await persistMediaList(data.venueImages ?? [], "koshas/bookings");
    const selectedAddons = normalizeKoshaStringList(data.selectedAddons);
    const welcomeBoards = normalizeKoshaStringList(data.welcomeBoards);
    const selectedAccessories = normalizeKoshaStringList(data.selectedAccessories);
    const [addonRows, boardRows, accessoryRows] = await Promise.all([
      db.query.koshaAddonsTable.findMany({ orderBy: (item, { asc }) => [asc(item.sortOrder), asc(item.id)] }),
      db.query.koshaWelcomeBoardsTable.findMany({ orderBy: (item, { asc }) => [asc(item.sortOrder), asc(item.id)] }),
      db.query.koshaAccessoriesTable.findMany({ orderBy: (item, { asc }) => [asc(item.sortOrder), asc(item.id)] }),
    ]);
    const addonDetails = koshaOptionSummary(addonRows.map((item) => formatKoshaOptionProduct(item, "addon")), selectedAddons);
    const welcomeBoardDetails = koshaOptionSummary(boardRows.map((item) => formatKoshaOptionProduct(item, "welcome_board")), welcomeBoards);
    const accessoryDetails = koshaOptionSummary(accessoryRows.map((item) => formatKoshaOptionProduct(item, "accessory")), selectedAccessories);
    const optionsTotal = [...addonDetails, ...welcomeBoardDetails, ...accessoryDetails].reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    const koshaPrice = Number.parseFloat(String(kosha.price ?? "0")) || 0;
    const bookingTotal = koshaPrice + optionsTotal;
    const [booking] = await db.insert(koshaBookingsTable).values({
      koshaId: kosha.id,
      customerName,
      phone,
      brideName: nullableText(data.brideName),
      groomName: nullableText(data.groomName),
      eventDate: nullableText(data.eventDate),
      eventTime: nullableText(data.eventTime),
      eventType: nullableText(data.eventType),
      serviceLevel: nullableText(data.serviceLevel),
      venueType: nullableText(data.venueType),
      themeColor: nullableText(data.themeColor),
      province: nullableText(data.province),
      area: nullableText(data.area),
      mahalla: nullableText(data.mahalla),
      nearestPoint: nullableText(data.nearestPoint),
      addressNotes: nullableText(data.addressNotes),
      bridePhone: normalizeIraqiPhone(data.bridePhone),
      groomPhone: normalizeIraqiPhone(data.groomPhone),
      alternatePhone: normalizeIraqiPhone(data.alternatePhone),
      cityArea: nullableText(data.cityArea || [data.province, data.area].filter(Boolean).join(" - ")),
      hallLocation: nullableText(data.hallLocation || data.nearestPoint || data.area),
      selectedAddons,
      welcomeBoards,
      selectedAccessories,
      venueImages,
      bookingDetails: {
        koshaName: kosha.name,
        koshaPrice,
        selectedAddons,
        welcomeBoards,
        selectedAccessories,
        addonDetails,
        welcomeBoardDetails,
        accessoryDetails,
        optionsTotal,
        total: bookingTotal,
      },
      totalAmount: String(bookingTotal),
      paidAmount: "0",
      remainingAmount: String(bookingTotal),
      paymentStatus: "unpaid",
      notes: nullableText(data.notes),
      status: "new",
    }).returning();
    void createNotification({
      audienceType: "admin",
      type: "kosha_booking",
      title: "حجز كوشة جديد",
      body: `${customerName} - ${kosha.name}`,
      entityType: "kosha_booking",
      entityId: booking.id,
      href: "/admin/kosha-bookings",
    });
    void notifyTelegramKoshaBooking({
      id: booking.id,
      reference: `KB-${booking.id}`,
      koshaName: kosha.name,
      customerName: booking.customerName,
      phone: booking.phone,
      eventDate: booking.eventDate,
      total: booking.totalAmount,
      paid: booking.paidAmount,
      remaining: booking.remainingAmount,
      status: booking.status,
    });
    return json(await formatKoshaBooking(booking), 201);
  }

  return null;
}

async function mediaResponseFromValue(req: NextRequest, value: unknown) {
  if (!value || typeof value !== "string") return error("الصورة غير موجودة", 404);
  const mediaValue = value;
  if (isDataUrl(mediaValue)) {
    const parsed = parseDataUrl(mediaValue);
    if (!parsed) return error("صيغة الصورة غير صالحة", 415);
    return new NextResponse(bodyFromBuffer(parsed.bytes), {
      headers: {
        "Content-Type": parsed.mime,
        "Cache-Control": MEDIA_CACHE_HEADER,
      },
    });
  }
  if (mediaValue.startsWith("http://") || mediaValue.startsWith("https://")) {
    return NextResponse.redirect(mediaValue, 302);
  }
  if (mediaValue.startsWith("/")) {
    return NextResponse.redirect(new URL(mediaValue, req.nextUrl.origin), 302);
  }
  return error("الصورة غير موجودة", 404);
}

async function handleMedia(req: NextRequest, parts: string[]) {
  if (req.method !== "GET") return null;
  const kind = parts[1];
  if (kind === "settings" && parts[2] === "logo") {
    const settings = await loadSiteSettings();
    const value = settings.logoUrl ?? settings.logo_url;
    return mediaResponseFromValue(req, await upgradeStoredMedia("settings", "logo", value));
  }
  const id = int(parts[2]);
  const index = parts[3] !== undefined ? int(parts[3]) : 0;
  if (!kind || !id) return error("معرف الصورة غير صحيح", 400);

  if (kind === "product") {
    const product = await db.query.productsTable.findFirst({ where: eq(productsTable.id, id) }) as any;
    const images = Array.isArray(product?.images) ? product.images : [];
    return mediaResponseFromValue(req, await upgradeStoredMedia("product", id, images[index ?? 0], index ?? 0));
  }

  if (kind === "product-video") {
    const product = await db.query.productsTable.findFirst({ where: eq(productsTable.id, id) }) as any;
    const videos = Array.isArray(product?.videos) ? product.videos : [];
    return mediaResponseFromValue(req, await upgradeStoredMedia("product-video", id, videos[index ?? 0], index ?? 0));
  }

  if (kind === "category") {
    const category = await db.query.categoriesTable.findFirst({ where: eq(categoriesTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("category", id, category?.imageUrl ?? category?.image_url));
  }

  if (kind === "service") {
    const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("service", id, service?.image));
  }

  if (kind === "gallery") {
    const item = await db.query.galleryItemsTable.findFirst({ where: eq(galleryItemsTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("gallery", id, item?.mediaUrl ?? item?.media_url));
  }

  if (kind === "kosha") {
    const item = await db.query.koshasTable.findFirst({ where: eq(koshasTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("kosha", id, item?.mainImage ?? item?.main_image));
  }

  if (kind === "kosha-image") {
    const item = await db.query.koshaImagesTable.findFirst({ where: eq(koshaImagesTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("kosha-image", id, item?.imageUrl ?? item?.image_url));
  }

  if (kind === "kosha-addon") {
    const item = await db.query.koshaAddonsTable.findFirst({ where: eq(koshaAddonsTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("kosha-addon", id, item?.mainImage ?? item?.main_image));
  }

  if (kind === "kosha-welcome-board") {
    const item = await db.query.koshaWelcomeBoardsTable.findFirst({ where: eq(koshaWelcomeBoardsTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("kosha-welcome-board", id, item?.mainImage ?? item?.main_image));
  }

  if (kind === "kosha-accessory") {
    const item = await db.query.koshaAccessoriesTable.findFirst({ where: eq(koshaAccessoriesTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("kosha-accessory", id, item?.mainImage ?? item?.main_image));
  }

  if (kind === "order-item") {
    const item = await db.query.orderItemsTable.findFirst({ where: eq(orderItemsTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("order-item", id, item?.image));
  }

  if (kind === "customer-avatar") {
    const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, id) }) as any;
    return mediaResponseFromValue(req, await upgradeStoredMedia("customer-avatar", id, customer?.avatarUrl ?? customer?.avatar_url));
  }

  return error("نوع الصورة غير معروف", 404);
}

async function resolveProductCategories(data: any) {
  const requestedCategoryId = numberId(data?.categoryId);
  const requestedSubcategoryId = numberId(data?.subcategoryId);
  const categorySlug = nullableText(data?.category);
  const subcategorySlug = nullableText(data?.subcategory);

  const category = requestedCategoryId
    ? await db.query.categoriesTable.findFirst({ where: eq(categoriesTable.id, requestedCategoryId) })
    : categorySlug
      ? await db.query.categoriesTable.findFirst({ where: eq(categoriesTable.slug, categorySlug) })
      : null;
  const subcategory = requestedSubcategoryId
    ? await db.query.categoriesTable.findFirst({ where: eq(categoriesTable.id, requestedSubcategoryId) })
    : subcategorySlug
      ? await db.query.categoriesTable.findFirst({ where: eq(categoriesTable.slug, subcategorySlug) })
      : null;
  const parentFromSubcategory = subcategory?.parentId
    ? await db.query.categoriesTable.findFirst({ where: eq(categoriesTable.id, subcategory.parentId) })
    : null;
  const finalCategory = category ?? parentFromSubcategory ?? null;
  const finalSubcategory = subcategory?.parentId ? subcategory : null;
  return {
    categoryId: finalCategory?.id ?? null,
    subcategoryId: finalSubcategory?.id ?? null,
    category: finalCategory?.slug ?? categorySlug,
    subcategory: finalSubcategory?.slug ?? subcategorySlug,
  };
}

async function handleCoupons(req: NextRequest, parts: string[]) {
  if (req.method === "POST" && parts[1] === "apply") {
    const b = await body(req);
    const preview = await calculateCouponDiscount(b?.code, b?.subtotal, b?.deliveryFee);
    if (!preview.ok) return error(preview.message, preview.status);
    return json({
      code: preview.coupon.code,
      title: preview.coupon.title ?? "",
      type: preview.coupon.type,
      discountAmount: preview.discountAmount,
      finalTotal: preview.finalTotal,
      message: "تم تطبيق الكوبون",
    });
  }
  return null;
}

function includesAny(value: unknown, terms: string[]) {
  const text = String(value ?? "").toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function serviceMatches(service: any, terms: string[]) {
  return includesAny(service.type, terms)
    || includesAny(service.nameAr, terms)
    || includesAny(service.name, terms)
    || includesAny(service.descriptionAr, terms)
    || includesAny(service.description, terms);
}

function productMatches(product: any, terms: string[]) {
  return includesAny(product.category, terms)
    || includesAny(product.subcategory, terms)
    || includesAny(product.nameAr, terms)
    || includesAny(product.name, terms)
    || includesAny(product.descriptionAr, terms)
    || includesAny(product.description, terms);
}

function packageTitle(items: { title: string }[]) {
  if (items.length === 1) return items[0].title;
  return `باقة ${items.slice(0, 2).map((item) => item.title).join(" + ")}`;
}

async function handleOffers(req: NextRequest, parts: string[]) {
  if (req.method !== "GET" || parts[1] !== "packages") return null;
  const context = String(req.nextUrl.searchParams.get("context") ?? req.nextUrl.searchParams.get("serviceType") ?? "").trim();
  const [services, products] = await Promise.all([
    db.query.servicesTable.findMany({
      where: eq(servicesTable.isActive, true),
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.id)],
      limit: 80,
    }) as Promise<any[]>,
    db.query.productsTable.findMany({
      where: eq(productsTable.isActive, true),
      orderBy: (p, { desc }) => [desc(p.isFeatured), desc(p.createdAt)],
      limit: 80,
    }) as Promise<any[]>,
  ]);

  const preferred: Record<string, string[]> = {
    kosha: ["photography", "تصوير", "album", "ألبوم", "gifts", "هدية", "هدايا"],
    photography: ["album", "ألبوم", "video", "فيديو", "setup", "تخرج", "تجهيز"],
    album: ["photography", "تصوير", "gifts", "هدايا"],
    setup: ["photography", "تصوير", "album", "ألبوم", "gifts", "هدايا"],
    gifts: ["kosha", "كوشة", "photography", "تصوير"],
  };
  const terms = preferred[context] ?? ["photography", "تصوير", "album", "ألبوم", "gifts", "هدايا", "تجهيز"];
  const candidates = [
    ...services
      .filter((service) => !context || service.type !== context)
      .filter((service) => serviceMatches(service, terms))
      .map((service) => ({
        kind: "service" as const,
        id: service.id,
        title: service.nameAr || service.name || "خدمة",
        image: publicMediaValue("service", service, service.image),
        href: `/services/${service.id}`,
        price: null as number | null,
      })),
    ...products
      .filter((product) => productMatches(product, terms) || product.isFeatured)
      .map((product) => ({
        kind: "product" as const,
        id: product.id,
        title: product.nameAr || product.name || "منتج",
        image: publicMediaList("product", product, product.images)[0] ?? null,
        href: `/store/${product.id}`,
        price: Number.parseFloat(String(product.price ?? "0")) || null,
      })),
  ].slice(0, 8);

  const packages = candidates.slice(0, 6).map((item, index) => {
    const pair = candidates[index + 1] ? [item, candidates[index + 1]] : [item];
    const total = pair.reduce((sum, entry) => sum + (entry.price ?? 0), 0);
    return {
      id: `${pair.map((entry) => `${entry.kind}-${entry.id}`).join("-")}`,
      title: packageTitle(pair),
      description: pair.map((entry) => entry.title).join("، "),
      image: pair.find((entry) => entry.image)?.image ?? null,
      href: pair[0].href,
      items: pair.map((entry) => ({ kind: entry.kind, id: entry.id, title: entry.title, href: entry.href })),
      totalLabel: total > 0 ? `${total.toLocaleString("ar-IQ")} د.ع` : "حسب تفاصيل الطلب",
    };
  });

  return json({ packages });
}

async function handleServices(req: NextRequest, parts: string[]) {
  const method = req.method;

  if (method === "GET" && parts.length === 1) {
    const services = await db.query.servicesTable.findMany({
      where: eq(servicesTable.isActive, true),
      orderBy: (s, { asc }) => [asc(s.id)],
    });
    return json(services.map(formatService));
  }

  if (method === "GET" && parts[1]) {
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    const service = await db.query.servicesTable.findFirst({
      where: eq(servicesTable.id, id),
    });
    if (!service) return error("الخدمة غير موجودة", 404);
    return json(formatService(service));
  }

  return null;
}

async function handleCrews(req: NextRequest, parts: string[]) {
  if (req.method === "GET" && parts.length === 1) {
    await ensureCrewsTable();
    const rows = await db.query.crewsTable.findMany({
      where: eq(crewsTable.isActive, true),
      orderBy: (c, { asc }) => [asc(c.name), asc(c.id)],
    });
    return json(rows.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      status: c.status ?? (c.isActive ? "available" : "inactive"),
    })));
  }

  return null;
}

async function handleServiceOrders(req: NextRequest, parts: string[]) {
  const method = req.method;

  if (method === "POST" && parts.length === 1) {
    const parsed = CreateServiceOrderBody.safeParse(await body(req));
    if (!parsed.success) return validationError("service-orders.create", parsed);
    const data = parsed.data;
    const service = await db.query.servicesTable.findFirst({
      where: eq(servicesTable.id, data.serviceId),
    });
    if (!service) return error("الخدمة غير موجودة", 404);
    const customFields = withDerivedServiceDetails(service.type, normalizeDetailsInput(data.customFields));
    const eventLocation =
      data.eventLocation ??
      primaryLocationFromDetails(service.type, customFields) ??
      "";
    const phone = normalizeIraqiPhone(data.phone);
    if (!phone) return error("رقم الهاتف العراقي غير صحيح", 400);
    const safeCustomerName = textFallback(data.customerName, formatIraqiPhone(phone), "زبون");
    await ensureTrackingColumns();
    const conflict = await findBookingConflict({ serviceId: data.serviceId, eventDate: data.eventDate ?? "", customFields });
    if (conflict) return error("يوجد حجز آخر بنفس التاريخ للخدمة أو الكادر. اختر موعداً أو كادراً مختلفاً.", 409);
    const order = await insertServiceOrderWithTracking({
      serviceId: data.serviceId,
      customerName: safeCustomerName,
      phone,
      eventDate: data.eventDate ?? "",
      eventLocation,
      notes: data.notes,
      customFields,
    });
    await ensureQrForEntity("service_order", order, req);
    await db.insert(serviceOrderStatusHistoryTable).values({
      serviceOrderId: order.id,
      status: order.status,
      notes: "تم إنشاء الحجز",
    });
    void fireOrderEvent("booking_placed", {
      name: order.customerName,
      phone: order.phone,
      tracking: order.trackingCode ?? "",
      status: order.status,
      service: service?.nameAr ?? service?.name ?? "",
    });
    void createNotification({
      type: "booking_new",
      title: "حجز جديد",
      body: `${order.customerName} - ${service?.nameAr ?? service?.name ?? "خدمة"}`,
      entityType: "service_order",
      entityId: order.id,
      href: "/admin/orders",
    });
    void createCustomerNotificationByPhone(order.phone, {
      type: "booking_created",
      title: "تم إنشاء الحجز",
      body: `رمز التتبع ${order.trackingCode ?? ""}`,
      entityType: "service_order",
      entityId: order.id,
      href: `/track?code=${encodeURIComponent(order.trackingCode ?? "")}`,
    });
    void notifyOrderNeedsFollowup({
      kind: "service_order",
      id: order.id,
      trackingCode: order.trackingCode,
      customerName: order.customerName,
      paymentStatus: order.paymentStatus,
      remainingAmount: order.remainingAmount,
      reason: "payment",
    });
    await syncServiceOrderFinancialPayment(order, SYSTEM_FINANCIAL_ACTOR);
    void notifyTelegramOrder({
      kind: "service",
      id: order.id,
      reference: order.trackingCode,
      serviceName: service?.nameAr ?? service?.name ?? "خدمة",
      customerName: order.customerName,
      phone: order.phone,
      createdByName: "الموقع",
      createdAt: order.createdAt,
      paymentMethod: "cash",
      total: order.totalAmount,
      paid: order.depositAmount,
      remaining: order.remainingAmount,
      status: order.status,
    });
    return json(
      {
        id: order.id,
        serviceId: order.serviceId,
        serviceName: service?.nameAr ?? "",
        trackingCode: order.trackingCode ?? null,
        customerName: order.customerName,
        phone: order.phone,
        eventDate: order.eventDate ?? null,
        eventLocation: order.eventLocation ?? null,
        notes: order.notes ?? null,
        customFields: order.customFields ?? {},
        status: order.status,
        createdAt: order.createdAt.toISOString(),
      },
      201,
    );
  }

  if (method === "POST" && parts[1] === "track" && parts[2] && parts[3] === "respond") {
    const reqIp = ip(req);
    if (rollingRateLimited(respondHits, reqIp, 10, 60_000)) {
      return error("محاولات كثيرة، حاول لاحقاً", 429);
    }
    const parsed = RespondToBookingBody.safeParse(await body(req));
    if (!parsed.success) return validationError("service-orders.respond", parsed);
    const { action, requestedDate, note } = parsed.data;
    const bookingId = int(req.nextUrl.searchParams.get("id") ?? undefined);
    const trackingCode = normalizeTrackingCode(parts[2]);
    const so = await db.query.serviceOrdersTable.findFirst({
      where: bookingId
        ? and(eq(serviceOrdersTable.id, bookingId), eq(serviceOrdersTable.trackingCode, trackingCode))
        : eq(serviceOrdersTable.trackingCode, trackingCode),
    });
    if (!so) return error("لم يتم العثور على الحجز", 404);
    if (action === "reschedule" && !requestedDate) return error("يلزم تحديد موعد جديد", 400);

    const confirmation = action === "confirm" ? "confirmed" : "reschedule_requested";
    const noteText = typeof note === "string" ? note.slice(0, 500) : null;
    const newRequestedDate = action === "reschedule" ? requestedDate!.slice(0, 100) : null;
    const updates: Partial<typeof serviceOrdersTable.$inferInsert> = {
      customerConfirmation: confirmation,
      requestedDate: newRequestedDate,
      confirmationNote: noteText,
      confirmationAt: new Date(),
    };
    if (action === "reschedule" && so.status !== "reschedule_pending") {
      updates.status = "reschedule_pending";
      updates.preRescheduleStatus = so.status;
    }
    const [updated] = await db.update(serviceOrdersTable).set(updates).where(eq(serviceOrdersTable.id, so.id)).returning();
    const historyNote =
      action === "confirm"
        ? `الزبون أكد الموعد${noteText ? ` — ${noteText}` : ""}`
        : `الزبون طلب تغيير الموعد إلى ${newRequestedDate}${noteText ? ` — ${noteText}` : ""}`;
    await db.insert(serviceOrderStatusHistoryTable).values({
      serviceOrderId: so.id,
      status: updated.status,
      notes: historyNote,
    });
    return json(await buildServiceTracking(updated));
  }

  return null;
}

async function handleCart(req: NextRequest, parts: string[]) {
  const method = req.method;
  const sessionId = getSessionId(req);

  if (method === "GET" && parts.length === 1) return json(await buildCart(sessionId));

  if (method === "POST" && parts.length === 1) {
    const parsed = AddToCartBody.safeParse(await body(req));
    if (!parsed.success) return validationError("cart.add", parsed);
    const { productId, quantity, selectedColor, customization, selectedColorData } = parsed.data as any;
    const product = await db.query.productsTable.findFirst({
      where: eq(productsTable.id, productId),
    });
    if (!product) return error("المنتج غير موجود", 404);
    const pickedColor = selectedColorPayload(selectedColorData, selectedColor);
    const existingItems = (await normalizeCartRows(sessionId)).filter((item) => item.productId === productId);
    const pickedKey = pickedColor ? colorKey(pickedColor) : "";
    const existing = existingItems.find((item) => {
      const itemColor = selectedColorPayload(item.selectedColorData, item.selectedColor);
      const itemKey = itemColor ? colorKey(itemColor) : "";
      return itemKey === pickedKey && (item.customization ?? "") === (customization ?? "");
    });
    if (existing) {
      await db
        .update(cartItemsTable)
        .set({ quantity: existing.quantity + quantity })
        .where(eq(cartItemsTable.id, existing.id));
    } else {
      await db.insert(cartItemsTable).values({
        sessionId,
        productId,
        quantity,
        price: product.price,
        selectedColor: pickedColor?.name ?? selectedColor ?? null,
        selectedColorData: pickedColor,
        customization,
      });
    }
    return json(await buildCart(sessionId));
  }

  if (method === "PATCH" && parts[1]) {
    const itemId = int(parts[1]);
    if (!itemId) return error("معرف غير صحيح", 400);
    const parsed = UpdateCartItemBody.safeParse(await body(req));
    if (!parsed.success) return validationError("cart.update", parsed);
    const { quantity } = parsed.data;
    if (quantity <= 0) {
      await db
        .delete(cartItemsTable)
        .where(and(eq(cartItemsTable.id, itemId), eq(cartItemsTable.sessionId, sessionId)));
    } else {
      await db
        .update(cartItemsTable)
        .set({ quantity })
        .where(and(eq(cartItemsTable.id, itemId), eq(cartItemsTable.sessionId, sessionId)));
    }
    return json(await buildCart(sessionId));
  }

  if (method === "DELETE" && parts[1]) {
    const itemId = int(parts[1]);
    if (!itemId) return error("معرف غير صحيح", 400);
    await db
      .delete(cartItemsTable)
      .where(and(eq(cartItemsTable.id, itemId), eq(cartItemsTable.sessionId, sessionId)));
    return json(await buildCart(sessionId));
  }

  if (method === "DELETE" && parts.length === 1) {
    await db.delete(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));
    return json({ message: "تم مسح السلة" });
  }

  return null;
}

async function handleOrders(req: NextRequest, parts: string[]) {
  const method = req.method;
  await ensureTrackingColumns();
  await ensureStockTrackingTables();

  if (method === "GET" && parts[1] === "my") {
    const customerId = getCurrentCustomerId(req);
    if (!customerId) return error("غير مخول", 401);
    const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, customerId) });
    const phoneVariants = iraqiPhoneVariants(customer?.phone);
    const orders = await db.query.ordersTable.findMany({
      where: phoneVariants.length > 0
        ? or(eq(ordersTable.customerId, customerId), inArray(ordersTable.customerPhone, phoneVariants))
        : eq(ordersTable.customerId, customerId),
      orderBy: [desc(ordersTable.createdAt)],
    });
    const serviceOrders = phoneVariants.length > 0
      ? await db.query.serviceOrdersTable.findMany({
          where: inArray(serviceOrdersTable.phone, phoneVariants),
          orderBy: [desc(serviceOrdersTable.createdAt)],
        })
      : [];
    const services = serviceOrders.length > 0 ? await db.query.servicesTable.findMany() : [];
    const serviceMap = new Map(services.map((s) => [s.id, s]));
    const rows = [
      ...(await Promise.all(orders.map(async (order) => ({ ...(await formatOrder(order)), kind: "order" })))),
      ...serviceOrders.map((booking) => ({
        id: booking.id,
        kind: "service",
        trackingCode: booking.trackingCode ?? `SRV-${booking.id}`,
        customerName: booking.customerName,
        customerPhone: booking.phone,
        serviceName: serviceMap.get(booking.serviceId)?.nameAr ?? serviceMap.get(booking.serviceId)?.name ?? "حجز خدمة",
        serviceType: serviceMap.get(booking.serviceId)?.type ?? null,
        serviceImage: publicMediaValue("service", serviceMap.get(booking.serviceId), serviceMap.get(booking.serviceId)?.image),
        status: booking.status,
        total: Number.parseFloat(booking.totalAmount ?? "0"),
        depositAmount: Number.parseFloat(booking.depositAmount ?? "0"),
        remainingAmount: Number.parseFloat(booking.remainingAmount ?? "0"),
        paymentStatus: booking.paymentStatus ?? "unpaid",
        rewardPointsAwarded: Number(booking.rewardPointsAwarded ?? 0),
        eventDate: booking.eventDate ?? null,
        eventLocation: booking.eventLocation ?? null,
        createdAt: booking.createdAt.toISOString(),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(rows);
  }

  if (method === "GET" && parts[1] === "track" && parts[2]) {
    const code = normalizeTrackingCode(parts[2]);
    const last4 = trackingCodeLast4(code);
    if (last4) {
      const productOrders = await db.query.ordersTable.findMany({
        where: or(eq(ordersTable.trackingCode, code), eq(ordersTable.phoneLast4, last4), like(ordersTable.customerPhone, `%${last4}`)),
        orderBy: [desc(ordersTable.createdAt)],
        limit: 20,
      });
      const serviceOrders = await db.query.serviceOrdersTable.findMany({
        where: or(eq(serviceOrdersTable.trackingCode, code), eq(serviceOrdersTable.phoneLast4, last4), like(serviceOrdersTable.phone, `%${last4}`)),
        orderBy: [desc(serviceOrdersTable.createdAt)],
        limit: 20,
      });
      const results = [
        ...(await Promise.all(productOrders.map(buildTracking))),
        ...(await Promise.all(serviceOrders.map(buildServiceTracking))),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (results.length === 1) return json(results[0]);
      if (results.length > 1) return json(results);
    }
    const order = await db.query.ordersTable.findFirst({
      where: eq(ordersTable.trackingCode, code),
    });
    if (order) return json(await buildTracking(order));
    const so = await db.query.serviceOrdersTable.findFirst({
      where: eq(serviceOrdersTable.trackingCode, code),
    });
    if (so) return json(await buildServiceTracking(so));
    return error("لم يتم العثور على الطلب", 404);
  }

  if (method === "GET" && parts[1] === "track-by-phone" && parts[2]) {
    const last4 = parts[2].replace(/\D/g, "");
    if (!/^\d{4}$/.test(last4)) return error("يلزم آخر 4 أرقام بالضبط", 400);
    const reqIp = ip(req);
    if (rollingRateLimited(phoneLookupHits, reqIp, 10, 60_000)) {
      return error("محاولات كثيرة، حاول لاحقاً", 429);
    }
    const productOrders = await db.query.ordersTable.findMany({
      where: or(eq(ordersTable.phoneLast4, last4), like(ordersTable.customerPhone, `%${last4}`)),
      orderBy: [desc(ordersTable.createdAt)],
      limit: 20,
    });
    const serviceOrders = await db.query.serviceOrdersTable.findMany({
      where: or(eq(serviceOrdersTable.phoneLast4, last4), like(serviceOrdersTable.phone, `%${last4}`)),
      orderBy: [desc(serviceOrdersTable.createdAt)],
      limit: 20,
    });
    const results = [
      ...(await Promise.all(productOrders.map(buildTracking))),
      ...(await Promise.all(serviceOrders.map(buildServiceTracking))),
    ]
      .map(stripPii)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(results);
  }

  if (method === "GET" && parts.length === 1) {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;
    const params = ListOrdersQueryParams.safeParse(query(req));
    const { status } = params.success ? params.data : {};
    const limit = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "120", 10) || 120, 1), 250);
    const offset = Math.max(Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const orders = await db.query.ordersTable.findMany({
      where: status
        ? and(eq(ordersTable.status, status), sql`${ordersTable.archivedAt} is null`)
        : sql`${ordersTable.archivedAt} is null`,
      orderBy: [desc(ordersTable.createdAt)],
      limit,
      offset,
    });
    return json(await Promise.all(orders.map(formatOrder)));
  }

  if (method === "POST" && parts.length === 1) {
    const parsed = CreateOrderBody.safeParse(await body(req));
    if (!parsed.success) return validationError("orders.create", parsed);
    const sessionId = getSessionId(req);
    const customerId = getCurrentCustomerId(req);
    const data = parsed.data;
    const cartItems = await normalizeCartRows(sessionId);
    if (cartItems.length === 0) return error("السلة فارغة", 400);
    const customerPhone = normalizeIraqiPhone(data.customerPhone);
    if (!customerPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
    const safeCustomerName = textFallback(data.customerName, formatIraqiPhone(customerPhone), "زبون");
    let deliveryFee = 0;
    if (data.deliveryZoneId) {
      const zone = await db.query.deliveryZonesTable.findFirst({
        where: eq(deliveryZonesTable.id, data.deliveryZoneId),
      });
      if (zone) deliveryFee = Number.parseFloat(zone.price);
    }
    const subtotal = cartItems.reduce((sum, i) => sum + Number.parseFloat(i.price) * i.quantity, 0);
    const couponPreview = data.couponCode
      ? await calculateCouponDiscount(data.couponCode, subtotal, deliveryFee)
      : null;
    if (couponPreview && !couponPreview.ok) return error(couponPreview.message, couponPreview.status);
    const couponDiscountAmount = couponPreview?.ok ? couponPreview.discountAmount : 0;
    const couponCode = couponPreview?.ok ? couponPreview.coupon.code : null;
    let loyaltyPointsRedeemed = Math.max(0, Number.parseInt(String((data as any).redeemPoints ?? "0"), 10) || 0);
    let loyaltyDiscountAmount = 0;
    if (loyaltyPointsRedeemed > 0) {
      if (!customerId) return error("سجل الدخول لصرف النقاط", 401);
      const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, customerId) });
      if (!customer) return error("حساب الزبون غير موجود", 404);
      loyaltyPointsRedeemed = Math.min(loyaltyPointsRedeemed, Number(customer.rewardPoints ?? 0));
      const loyaltySettings = await getLoyaltySettings();
      loyaltyDiscountAmount = Math.min(
        Math.max(subtotal + deliveryFee - couponDiscountAmount, 0),
        loyaltyPointsRedeemed * loyaltySettings.redeemValue,
      );
    }
    const total = Math.max(subtotal + deliveryFee - couponDiscountAmount - loyaltyDiscountAmount, 0);
    const paymentMethod = data.paymentMethod && ["cod", "transfer", "paid"].includes(data.paymentMethod) ? data.paymentMethod : "cod";
    const payment = paymentSummary(total, paymentMethod === "paid" ? total : 0, paymentMethod === "paid" ? "paid" : "unpaid");
    const [order] = await db
      .insert(ordersTable)
      .values({
        trackingCode: trackingCodeForPhone(customerPhone),
        phoneLast4: phoneLast4(customerPhone),
        customerId: customerId ?? undefined,
        customerName: safeCustomerName,
        customerPhone,
        status: "pending",
        total: total.toString(),
        deliveryFee: deliveryFee.toString(),
        couponCode,
        couponDiscountAmount: String(couponDiscountAmount),
        loyaltyPointsRedeemed,
        loyaltyDiscountAmount: String(loyaltyDiscountAmount),
        paymentMethod,
        depositAmount: String(payment.deposit),
        remainingAmount: String(payment.remaining),
        paymentStatus: payment.status,
        governorate: data.governorate ?? "",
        area: data.area ?? null,
        address: data.address ?? "",
        notes: data.notes ?? null,
        mapsUrl: data.mapsUrl ?? null,
      })
      .returning();
    await ensureQrForEntity("order", order, req);
    await Promise.all(
      cartItems.map(async (item) => {
        const product = await db.query.productsTable.findFirst({
          where: eq(productsTable.id, item.productId),
        });
        await db.insert(orderItemsTable).values({
          orderId: order.id,
          productId: item.productId,
          productName: product?.name ?? "",
          productNameAr: product?.nameAr ?? "",
          quantity: item.quantity,
          price: item.price,
          selectedColor: selectedColorName(item.selectedColorData, item.selectedColor),
          selectedColorData: selectedColorPayload(item.selectedColorData, item.selectedColor),
          customization: item.customization,
          image: product ? publicMediaValue("product", product, product.images?.[0], 0) : null,
        });
        if (product) {
          await adjustProductStock(product.id, -item.quantity, {
            reason: "order_stock_deducted",
            relatedType: "order",
            relatedId: order.id,
          });
        }
      }),
    );
    if (couponPreview?.ok) {
      await recordCouponUsage(couponPreview.coupon, {
        customerPhone,
        orderId: order.id,
        discountAmount: couponDiscountAmount,
      });
    }
    if (customerId && loyaltyPointsRedeemed > 0 && loyaltyDiscountAmount > 0) {
      await addCustomerReward(customerId, -loyaltyPointsRedeemed, {
        orderId: order.id,
        reason: "points_redeemed",
        note: `صرف نقاط للطلب ${order.trackingCode}`,
      });
    }
    void notifyLowStockForProductIds(cartItems.map((item) => Number(item.productId)));
    await db.insert(orderStatusHistoryTable).values({
      orderId: order.id,
      status: "pending",
      notes: "تم إنشاء الطلب",
    });
    await db.delete(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));
    const formatted = await formatOrder(order);
    void fireOrderEvent("placed", {
      name: order.customerName,
      phone: order.customerPhone,
      tracking: order.trackingCode,
      total: formatted.total,
      status: order.status,
    });
    void createNotification({
      type: "order_new",
      title: "طلب جديد",
      body: `${order.customerName} - ${order.trackingCode}`,
      entityType: "order",
      entityId: order.id,
      href: "/admin/orders",
    });
    void notifyOrderNeedsFollowup({
      kind: "order",
      id: order.id,
      trackingCode: order.trackingCode,
      customerName: order.customerName,
      paymentStatus: order.paymentStatus,
      remainingAmount: order.remainingAmount,
      reason: "payment",
    });
    if (customerId) {
      void createNotification({
        audienceType: "customer",
        customerId,
        type: "order_created",
        title: "تم إنشاء طلبك",
        body: `رمز التتبع ${order.trackingCode}`,
        entityType: "order",
        entityId: order.id,
        href: `/track?code=${encodeURIComponent(order.trackingCode)}`,
      });
    }
    await syncOrderFinancialPayment(order, SYSTEM_FINANCIAL_ACTOR);
    void notifyTelegramOrder({
      kind: "store",
      id: order.id,
      reference: order.trackingCode,
      customerName: order.customerName,
      phone: order.customerPhone,
      createdByName: "المتجر الإلكتروني",
      createdAt: order.createdAt,
      paymentMethod: order.paymentMethod,
      total: order.total,
      paid: order.depositAmount,
      remaining: order.remainingAmount,
      status: order.status,
    });
    void logAdminActivity(req, "customer_order_created", "order", order.id, { tracking: order.trackingCode });
    return json(formatted, 201);
  }

  if (method === "GET" && parts[1]) {
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    const order = await db.query.ordersTable.findFirst({
      where: eq(ordersTable.id, id),
    });
    if (!order) return error("الطلب غير موجود", 404);
    const adminUser = await getAdminUser(req);
    if (!hasPermission(adminUser, "orders")) {
      const customerId = getCurrentCustomerId(req);
      if (!customerId || order.customerId !== customerId) return error("غير مخول", 403);
    }
    return json(await formatOrder(order));
  }

  if (method === "PATCH" && parts[1]) {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    const parsed = UpdateOrderStatusBody.safeParse(await body(req));
    if (!parsed.success) return validationError("orders.update-status", parsed);
    const { status, notes } = parsed.data;
    const [order] = await db
      .update(ordersTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(ordersTable.id, id))
      .returning();
    if (!order) return error("الطلب غير موجود", 404);
    await syncOrderStockState(order, actor(auth));
    await db.insert(orderStatusHistoryTable).values({
      orderId: order.id,
      status,
      notes: notes ?? null,
    });
    await awardProductOrderPoints(order);
    const event = eventForStatus(status);
    if (event) {
      void fireOrderEvent(event, {
        name: order.customerName,
        phone: order.customerPhone,
        tracking: order.trackingCode,
        total: Number.parseFloat(order.total),
        status,
      });
    }
    void createCustomerNotificationByPhone(order.customerPhone, {
      type: `order_status_${status}`,
      title: status === "confirmed" ? "تم تأكيد طلبك" : status === "processing" ? "طلبك قيد التجهيز" : status === "shipped" ? "طلبك في الطريق" : status === "delivered" ? "تم تسليم طلبك" : status === "cancelled" ? "تم إلغاء الطلب" : "تحديث حالة الطلب",
      body: `طلب ${order.trackingCode}`,
      entityType: "order",
      entityId: order.id,
      href: `/track?code=${encodeURIComponent(order.trackingCode)}`,
    });
    if (status === "cancelled") {
      void createNotification({
        type: "order_cancelled",
        title: "تم إلغاء طلب",
        body: `${order.customerName} - ${order.trackingCode}`,
        entityType: "order",
        entityId: order.id,
        href: "/admin/orders",
      });
    }
    await syncOrderFinancialPayment(order, financialActor(auth));
    return json(await formatOrder(order));
  }

  return null;
}

async function handleGallery(req: NextRequest, parts: string[]) {
  const method = req.method;

  if (method === "GET" && parts[1] === "categories") {
    const result = await db
      .select({ category: galleryItemsTable.category, count: sql<number>`count(*)::int` })
      .from(galleryItemsTable)
      .groupBy(galleryItemsTable.category);
    return json(result.map((r) => ({ name: r.category, count: r.count })));
  }

  if (method === "GET" && parts.length === 1) {
    const params = ListGalleryQueryParams.safeParse(query(req));
    const { category } = params.success ? params.data : {};
    const items = await db.query.galleryItemsTable.findMany({
      where: category ? eq(galleryItemsTable.category, category) : undefined,
      orderBy: (g, { desc }) => [desc(g.createdAt)],
    });
    return json(
      items.map((i) => ({
        id: i.id,
        mediaUrl: publicMediaValue("gallery", i, i.mediaUrl),
        mediaType: i.mediaType,
        imageMetadata: i.imageMetadata ?? {},
        title: i.title ?? null,
        titleAr: i.titleAr ?? null,
        category: i.category,
        createdAt: i.createdAt.toISOString(),
      })),
    );
  }

  if (method === "POST" && parts.length === 1) {
    const auth = await requirePermission(req, "gallery");
    if (isResponse(auth)) return auth;
    const parsed = CreateGalleryItemBody.safeParse(await body(req));
    if (!parsed.success) return validationError("gallery.create", parsed);
    const values: any = { ...parsed.data };
    if (typeof values.mediaUrl === "string" && values.mediaUrl.startsWith("data:")) {
      values.mediaUrl = await persistDataUrlToStorage(values.mediaUrl, "gallery");
    } else if (values.mediaUrl !== undefined) {
      values.mediaUrl = await persistMediaValue(values.mediaUrl, "gallery");
    }
    const [item] = await db.insert(galleryItemsTable).values(values).returning();
    void logAdminActivity(req, "gallery_created", "gallery", item.id, { mediaType: item.mediaType });
    return json(
      {
        id: item.id,
        mediaUrl: publicMediaValue("gallery", item, item.mediaUrl),
        mediaType: item.mediaType,
        imageMetadata: item.imageMetadata ?? {},
        title: item.title ?? null,
        titleAr: item.titleAr ?? null,
        category: item.category,
        createdAt: item.createdAt.toISOString(),
      },
      201,
    );
  }

  if (method === "DELETE" && parts[1]) {
    const auth = await requirePermission(req, "gallery");
    if (isResponse(auth)) return auth;
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    await db.delete(galleryItemsTable).where(eq(galleryItemsTable.id, id));
    void logAdminActivity(req, "gallery_deleted", "gallery", id);
    return json({ message: "تم حذف الصورة" });
  }

  return null;
}

async function handleReviews(req: NextRequest, parts: string[]) {
  const method = req.method;

  if (method === "GET" && parts.length === 1) {
    const params = ListReviewsQueryParams.safeParse(query(req));
    if (!params.success) return error("معرف المنتج مطلوب", 400);
    const reviews = await db.query.reviewsTable.findMany({
      where: eq(reviewsTable.productId, params.data.productId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
    return json(
      reviews.map((r) => ({
        id: r.id,
        productId: r.productId,
        customerId: r.customerId ?? null,
        customerName: r.customerName,
        rating: r.rating,
        comment: r.comment ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  }

  if (method === "POST" && parts.length === 1) {
    const parsed = CreateReviewBody.safeParse(await body(req));
    if (!parsed.success) return validationError("reviews.create", parsed);
    const [review] = await db.insert(reviewsTable).values({
      ...parsed.data,
      customerName: textFallback(parsed.data.customerName, "زبون"),
    }).returning();
    return json(
      {
        id: review.id,
        productId: review.productId,
        customerId: review.customerId ?? null,
        customerName: review.customerName,
        rating: review.rating,
        comment: review.comment ?? null,
        createdAt: review.createdAt.toISOString(),
      },
      201,
    );
  }

  return null;
}

async function handleDelivery(req: NextRequest, parts: string[]) {
  const method = req.method;

  if (method === "GET" && parts.length === 1) {
    const zones = await db.query.deliveryZonesTable.findMany({
      orderBy: (z, { asc }) => [asc(z.governorate)],
    });
    return json(zones.map(formatZone));
  }

  if (method === "POST" && parts.length === 1) {
    const auth = await requirePermission(req, "delivery");
    if (isResponse(auth)) return auth;
    const parsed = CreateDeliveryZoneBody.safeParse(await body(req));
    if (!parsed.success) return validationError("delivery-zones.create", parsed);
    const data = parsed.data as any;
    const governorateAr = textFallback(data.governorateAr, data.governorate, "محافظة جديدة");
    const governorate = textFallback(data.governorate, data.governorateAr, governorateAr);
    const [zone] = await db
      .insert(deliveryZonesTable)
      .values({
        governorate,
        governorateAr,
        areas: data.areas ?? [],
        price: String(money(data.price)),
        estimatedDays: Number.isFinite(Number(data.estimatedDays)) ? Number(data.estimatedDays) : 1,
        isActive: data.isActive ?? true,
      })
      .returning();
    return json(formatZone(zone), 201);
  }

  if (method === "PATCH" && parts[1]) {
    const auth = await requirePermission(req, "delivery");
    if (isResponse(auth)) return auth;
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    const parsed = UpdateDeliveryZoneBody.safeParse(await body(req));
    if (!parsed.success) return validationError("delivery-zones.update", parsed);
    const data = parsed.data as any;
    const update: any = {};
    if (data.price !== undefined) update.price = data.price.toString();
    if (data.estimatedDays !== undefined) update.estimatedDays = data.estimatedDays;
    if (data.isActive !== undefined) update.isActive = data.isActive;
    if (data.areas !== undefined) update.areas = data.areas;
    const [zone] = await db.update(deliveryZonesTable).set(update).where(eq(deliveryZonesTable.id, id)).returning();
    if (!zone) return error("المنطقة غير موجودة", 404);
    return json(formatZone(zone));
  }

  return null;
}

async function handleDashboard(req: NextRequest, parts: string[]) {
  const method = req.method;
  if (method !== "GET") return null;
  const auth = await requirePermission(req, "dashboard");
  if (isResponse(auth)) return auth;

  if (parts[1] === "stats") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [
      totalOrdersResult,
      totalRevenueResult,
      totalProductsResult,
      totalCustomersResult,
      pendingOrdersResult,
      todayOrdersResult,
      todayRevenueResult,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(ordersTable),
      db.select({ sum: sql<number>`coalesce(sum((total::numeric - delivery_fee::numeric)), 0)::float` }).from(ordersTable),
      db.select({ count: sql<number>`count(*)::int` }).from(productsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(customersTable),
      db.select({ count: sql<number>`count(*)::int` }).from(ordersTable).where(eq(ordersTable.status, "pending")),
      db.select({ count: sql<number>`count(*)::int` }).from(ordersTable).where(gte(ordersTable.createdAt, today)),
      db.select({ sum: sql<number>`coalesce(sum((total::numeric - delivery_fee::numeric)), 0)::float` }).from(ordersTable).where(gte(ordersTable.createdAt, today)),
    ]);
    return json({
      totalOrders: totalOrdersResult[0]?.count ?? 0,
      totalRevenue: totalRevenueResult[0]?.sum ?? 0,
      totalProducts: totalProductsResult[0]?.count ?? 0,
      totalCustomers: totalCustomersResult[0]?.count ?? 0,
      pendingOrders: pendingOrdersResult[0]?.count ?? 0,
      todayOrders: todayOrdersResult[0]?.count ?? 0,
      todayRevenue: todayRevenueResult[0]?.sum ?? 0,
    });
  }

  if (parts[1] === "recent-orders") {
    const orders = await db.query.ordersTable.findMany({
      where: sql`${ordersTable.archivedAt} is null`,
      orderBy: [desc(ordersTable.createdAt)],
      limit: 10,
    });
    return json(
      orders.map((o) => ({
        id: o.id,
        trackingCode: o.trackingCode,
        customerId: o.customerId ?? null,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        status: o.status,
        total: Number.parseFloat(o.total),
        deliveryFee: Number.parseFloat(o.deliveryFee),
        governorate: o.governorate ?? null,
        address: o.address ?? null,
        notes: o.notes ?? null,
        items: [],
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
    );
  }

  if (parts[1] === "order-status-breakdown") {
    const result = await db
      .select({ status: ordersTable.status, count: sql<number>`count(*)::int` })
      .from(ordersTable)
      .groupBy(ordersTable.status);
    return json(result.map((r) => ({ status: r.status, count: r.count })));
  }

  return null;
}

const PAYMENT_METHODS = ["cod", "transfer", "paid"] as const;
function normalizePayment(v: unknown): "cod" | "transfer" | "paid" | null {
  return (PAYMENT_METHODS as readonly string[]).includes(v as string) ? (v as any) : null;
}

const ROLE_PERMISSION_PRESETS: Record<string, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  manager: ["dashboard", "orders", "bookings", "services", "products", "gallery", "delivery", "customers", "staff", "settings", "invoices", "whatsapp", "accounting", "tasks"],
  booking_staff: ["dashboard", "orders", "bookings", "customers", "invoices", "whatsapp", "tasks"],
  photographer: ["dashboard", "orders", "bookings", "gallery", "services", "whatsapp", "tasks"],
  accountant: ["dashboard", "orders", "bookings", "customers", "invoices", "accounting", "tasks"],
  employee: ["dashboard", "tasks"],
  staff: ["dashboard", "tasks"],
};

const STAFF_ROLE_ALIASES: Record<string, string> = {
  "أدمن": "admin",
  "ادمن": "admin",
  "مدير رئيسي": "admin",
  "مدير": "manager",
  "موظف": "employee",
  "موظف عام": "employee",
  "موظف حجوزات": "booking_staff",
  "موظف تصوير": "photographer",
  "محاسب": "accountant",
};

function normalizeStaffRole(role: unknown): string {
  const value = String(role ?? "employee").trim();
  const mapped = STAFF_ROLE_ALIASES[value] ?? value;
  return ["admin", "manager", "booking_staff", "photographer", "accountant", "employee", "staff"].includes(mapped) ? mapped : "employee";
}

function normalizeCrewStatus(status: unknown, isActive = true): "available" | "busy" | "vacation" | "inactive" {
  if (!isActive) return "inactive";
  const value = String(status ?? "available");
  return value === "busy" || value === "vacation" || value === "inactive" ? value : "available";
}

function permissionsForRole(role: string, permissions?: unknown): Permission[] {
  if (Array.isArray(permissions) && permissions.length > 0) {
    return permissions.filter((p): p is Permission => (ALL_PERMISSIONS as readonly string[]).includes(String(p)));
  }
  return ROLE_PERMISSION_PRESETS[role] ?? ROLE_PERMISSION_PRESETS.staff;
}

function validateStaffPermissions(permissions: unknown): Permission[] | null {
  if (permissions === undefined || permissions === null) return null;
  if (!Array.isArray(permissions)) return null;
  const cleaned = permissions
    .map((p) => String(p).trim())
    .filter(Boolean);
  if (cleaned.some((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p))) return null;
  return Array.from(new Set(cleaned)) as Permission[];
}

function staffUsername(value: unknown): string {
  return String(value ?? "").trim();
}

function isUniqueViolation(err: any, constraint?: string): boolean {
  return err?.code === "23505" && (!constraint || String(err?.constraint ?? "").includes(constraint));
}

function logStaffApiFailure(action: string, err: unknown, meta: Record<string, unknown> = {}) {
  const e = err as any;
  console.warn("staff api failed", {
    action,
    code: e?.code,
    constraint: e?.constraint,
    message: e?.message,
    ...meta,
  });
}

function normalizeCustomerPayment(v: unknown): "cash" | "card" {
  return v === "card" ? "card" : "cash";
}

function normalizeAddressType(v: unknown): "home" | "work" | "other" {
  return v === "work" || v === "other" ? v : "home";
}

function addressPayload(row: any) {
  return {
    id: row.id,
    type: row.type,
    fullName: row.fullName,
    phone: row.phone,
    governorate: row.governorate,
    city: row.city,
    address: row.address,
    landmark: row.landmark,
    notes: row.notes,
    isDefault: row.isDefault,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

async function normalizeAddressBody(input: any, customer: any, partial = false) {
  const out: any = {};
  if (!partial || input?.type !== undefined) out.type = normalizeAddressType(input?.type);
  if (!partial || input?.fullName !== undefined) out.fullName = String(input?.fullName ?? customer.fullName ?? customer.name ?? "").trim().slice(0, 160);
  if (!partial || input?.phone !== undefined) {
    const phone = normalizeIraqiPhone(input?.phone ?? customer.phone);
    if (!phone) throw new Error("رقم الهاتف العراقي غير صحيح");
    out.phone = phone;
  }
  if (!partial || input?.governorate !== undefined) out.governorate = String(input?.governorate ?? "").trim().slice(0, 120);
  if (!partial || input?.city !== undefined) out.city = String(input?.city ?? "").trim().slice(0, 120);
  if (!partial || input?.address !== undefined) out.address = String(input?.address ?? "").trim().slice(0, 500);
  if (!partial || input?.landmark !== undefined) out.landmark = String(input?.landmark ?? "").trim().slice(0, 250);
  if (!partial || input?.notes !== undefined) out.notes = String(input?.notes ?? "").trim().slice(0, 500);
  if (!partial || input?.isDefault !== undefined) out.isDefault = Boolean(input?.isDefault);
  out.updatedAt = new Date();
  return out;
}

async function handlePublicSettings(req: NextRequest, parts: string[]) {
  if (req.method === "GET" && parts[1] === "public") {
    return json(await getCachedPublicSettings(), 200, {
      "Cache-Control": `public, s-maxage=${PUBLIC_SETTINGS_REVALIDATE_SECONDS}, stale-while-revalidate=86400`,
    });
  }
  return null;
}

async function handleCustomer(req: NextRequest, parts: string[]) {
  const method = req.method;
  const section = parts[1];
  const customerId = getCurrentCustomerId(req);
  if (!customerId) return error("غير مخول", 401);
  await ensureCustomerAddressTables();
  await ensureCustomerProfileColumns();

  const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, customerId) });
  if (!customer) return error("المستخدم غير موجود", 404);

  if (section === "addresses") {
    if (method === "GET") {
      const rows = await db.query.customerAddressesTable.findMany({
        where: eq(customerAddressesTable.customerId, customerId),
        orderBy: [desc(customerAddressesTable.isDefault), desc(customerAddressesTable.updatedAt)],
      });
      return json(rows.map(addressPayload));
    }
    if (method === "POST") {
      const data = await body(req);
      let values: any;
      try {
        values = await normalizeAddressBody(data, customer);
      } catch (err: any) {
        return error(err?.message ?? "بيانات العنوان غير صحيحة", 400);
      }
      if (values.isDefault) {
        await db.update(customerAddressesTable).set({ isDefault: false, updatedAt: new Date() }).where(eq(customerAddressesTable.customerId, customerId));
      }
      const [row] = await db
        .insert(customerAddressesTable)
        .values({ ...values, customerId })
        .returning();
      return json(addressPayload(row), 201);
    }
    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const data = await body(req);
      let patch: any;
      try {
        patch = await normalizeAddressBody(data, customer, true);
      } catch (err: any) {
        return error(err?.message ?? "بيانات العنوان غير صحيحة", 400);
      }
      if (patch.isDefault) {
        await db.update(customerAddressesTable).set({ isDefault: false, updatedAt: new Date() }).where(eq(customerAddressesTable.customerId, customerId));
      }
      const [row] = await db
        .update(customerAddressesTable)
        .set(patch)
        .where(and(eq(customerAddressesTable.id, id), eq(customerAddressesTable.customerId, customerId)))
        .returning();
      if (!row) return error("العنوان غير موجود", 404);
      return json(addressPayload(row));
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(customerAddressesTable).where(and(eq(customerAddressesTable.id, id), eq(customerAddressesTable.customerId, customerId)));
      return json({ message: "تم حذف العنوان" });
    }
  }

  if (section === "preferences") {
    if (method === "GET") {
      const pref = await db.query.customerPreferencesTable.findFirst({
        where: eq(customerPreferencesTable.customerId, customerId),
      });
      return json({ defaultPaymentMethod: pref?.defaultPaymentMethod ?? "cash" });
    }
    if (method === "PATCH") {
      const data = await body(req);
      const defaultPaymentMethod = normalizeCustomerPayment(data?.defaultPaymentMethod);
      const [pref] = await db
        .insert(customerPreferencesTable)
        .values({ customerId, defaultPaymentMethod })
        .onConflictDoUpdate({
          target: customerPreferencesTable.customerId,
          set: { defaultPaymentMethod, updatedAt: new Date() },
        })
        .returning();
      return json({ defaultPaymentMethod: pref.defaultPaymentMethod });
    }
  }

  if (section === "rewards" && method === "GET") {
    await ensureCustomerRewards();
    const phoneVariants = iraqiPhoneVariants(customer.phone);
    if (phoneVariants.length > 0) {
      const [eligibleOrders, eligibleBookings] = await Promise.all([
        db.query.ordersTable.findMany({
          where: and(
            inArray(ordersTable.customerPhone, phoneVariants),
            eq(ordersTable.rewardPointsAwarded, 0),
            or(inArray(ordersTable.status, ["delivered", "completed"]), eq(ordersTable.paymentStatus, "paid")),
          ),
          limit: 20,
        }),
        db.query.serviceOrdersTable.findMany({
          where: and(
            inArray(serviceOrdersTable.phone, phoneVariants),
            eq(serviceOrdersTable.rewardPointsAwarded, 0),
            or(inArray(serviceOrdersTable.status, ["delivered", "completed"]), eq(serviceOrdersTable.paymentStatus, "paid")),
          ),
          limit: 20,
        }),
      ]);
      await Promise.all([
        ...eligibleOrders.map(awardProductOrderPoints),
        ...eligibleBookings.map(awardServiceOrderPoints),
      ]);
    }
    const fresh = await db.query.customersTable.findFirst({ where: eq(customersTable.id, customerId) });
    const history = await db.query.customerRewardHistoryTable.findMany({
      where: eq(customerRewardHistoryTable.customerId, customerId),
      orderBy: [desc(customerRewardHistoryTable.createdAt)],
      limit: 20,
    });
    const points = Number(fresh?.rewardPoints ?? 0);
    const level = fresh?.rewardLevel ?? rewardLevelForPoints(points);
    const loyaltySettings = await getLoyaltySettings();
    return json({
      points,
      level,
      levelLabel: rewardLabel(level),
      redeemValue: loyaltySettings.redeemValue,
      amountPerPoint: loyaltySettings.amountPerPoint,
      pointsPerUnit: loyaltySettings.pointsPerUnit,
      history: history.map((row) => ({
        id: row.id,
        points: row.points,
        reason: row.reason,
        note: row.note ?? "",
        orderId: row.orderId ?? null,
        serviceOrderId: row.serviceOrderId ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }

  if (section === "reviews") {
    await ensureOrderReviewsTable();
    if (method === "GET") {
      const rows = await db.query.orderReviewsTable.findMany({
        where: eq(orderReviewsTable.customerId, customerId),
        orderBy: [desc(orderReviewsTable.createdAt)],
      });
      return json(rows.map((row) => ({
        id: row.id,
        orderKind: row.orderKind,
        orderId: row.orderId,
        rating: row.rating,
        comment: row.comment ?? "",
        createdAt: row.createdAt.toISOString(),
      })));
    }
    if (method === "POST") {
      const data = await body(req);
      const orderKind = data?.orderKind === "service" ? "service" : "product";
      const orderId = int(data?.orderId);
      const rating = Number(data?.rating);
      const comment = String(data?.comment ?? "").trim().slice(0, 600);
      if (!orderId || !Number.isInteger(rating) || rating < 1 || rating > 5) return error("بيانات التقييم غير صحيحة", 400);
      const phoneVariants = iraqiPhoneVariants(customer.phone);
      const owned =
        orderKind === "service"
          ? await db.query.serviceOrdersTable.findFirst({ where: and(eq(serviceOrdersTable.id, orderId), inArray(serviceOrdersTable.phone, phoneVariants)) })
          : await db.query.ordersTable.findFirst({ where: and(eq(ordersTable.id, orderId), inArray(ordersTable.customerPhone, phoneVariants)) });
      if (!owned) return error("الطلب غير موجود", 404);
      if (!["delivered", "completed"].includes(String(owned.status))) return error("يمكن التقييم بعد اكتمال الطلب", 409);
      const [row] = await db
        .insert(orderReviewsTable)
        .values({ customerId, orderKind, orderId, rating, comment })
        .onConflictDoUpdate({
          target: [orderReviewsTable.orderKind, orderReviewsTable.orderId, orderReviewsTable.customerId],
          set: { rating, comment, createdAt: new Date() },
        })
        .returning();
      return json({
        id: row.id,
        orderKind: row.orderKind,
        orderId: row.orderId,
        rating: row.rating,
        comment: row.comment ?? "",
        createdAt: row.createdAt.toISOString(),
      });
    }
  }

  if (section === "reorder" && method === "POST") {
    const data = await body(req);
    const orderId = int(data?.orderId);
    if (!orderId) return error("معرف الطلب غير صحيح", 400);
    const phoneVariants = iraqiPhoneVariants(customer.phone);
    const order = await db.query.ordersTable.findFirst({
      where: and(eq(ordersTable.id, orderId), inArray(ordersTable.customerPhone, phoneVariants)),
    });
    if (!order) return error("الطلب غير موجود", 404);
    const items = await db.query.orderItemsTable.findMany({ where: eq(orderItemsTable.orderId, orderId) });
    if (items.length === 0) return error("لا توجد منتجات لإعادة الطلب", 400);
    const sessionId = getSessionId(req);
    for (const item of items) {
      const rawProduct = await db.query.productsTable.findFirst({ where: eq(productsTable.id, item.productId) });
      const product = await hydrateSharedStockProduct(rawProduct);
      if (!product || product.isActive === false || productStockAmount(product) <= 0) continue;
      await db.insert(cartItemsTable).values({
        sessionId,
        productId: product.id,
        quantity: Math.min(item.quantity, Math.max(1, productStockAmount(product))),
        price: product.price,
        selectedColor: selectedColorName(item.selectedColorData, item.selectedColor),
        selectedColorData: selectedColorPayload(item.selectedColorData, item.selectedColor),
        customization: item.customization ?? null,
      });
    }
    return json(await buildCart(sessionId));
  }

  if (section === "recommendations" && method === "GET") {
    const [products, services] = await Promise.all([
      db.query.productsTable.findMany({
        where: and(eq(productsTable.isFeatured, true), eq(productsTable.isActive, true)),
        orderBy: [desc(productsTable.createdAt)],
        limit: 4,
      }),
      db.query.servicesTable.findMany({
        where: eq(servicesTable.isActive, true),
        orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.id)],
        limit: 4,
      }),
    ]);
    return json({
      products: products.map((product) => formatProduct(product)),
      services: services.map(formatService),
    });
  }

  return null;
}

async function handlePublicMessages(req: NextRequest, parts: string[]) {
  if (req.method !== "POST" || parts.length !== 1) return null;
  await ensureAdminExtensionsTables();
  const data = await body(req);
  const message = String(data?.message ?? data?.body ?? "").trim().slice(0, 2000);
  if (!message) return error("اكتب الرسالة أولاً", 400);
  const phone = normalizeIraqiPhone(data?.phone ?? "") ?? normalizePhoneDigits(String(data?.phone ?? "")).slice(0, 20);
  const customerId = getCurrentCustomerId(req);
  const customer = customerId
    ? await db.query.customersTable.findFirst({ where: eq(customersTable.id, customerId) })
    : phone
      ? await db.query.customersTable.findFirst({ where: inArray(customersTable.phone, iraqiPhoneVariants(phone)) })
      : null;
  const customerName = String(data?.name ?? customer?.name ?? customer?.fullName ?? "").trim().slice(0, 160);
  const subject = String(data?.subject ?? "رسالة زبون").trim().slice(0, 180) || "رسالة زبون";
  const [thread] = await db
    .insert(messageThreadsTable)
    .values({
      customerId: customer?.id ?? customerId ?? null,
      phone: phone || customer?.phone || null,
      customerName,
      subject,
      status: "new",
      relatedType: typeof data?.relatedType === "string" ? data.relatedType.slice(0, 30) : null,
      relatedId: Number.isFinite(Number(data?.relatedId)) ? Number(data.relatedId) : null,
    })
    .returning();
  await db.insert(messageRepliesTable).values({
    threadId: thread.id,
    senderType: "customer",
    body: message,
  });
  await db.insert(customerActivityLogsTable).values({
    customerId: customer?.id ?? customerId ?? null,
    sessionId: String(data?.sessionId ?? getSessionId(req)).slice(0, 80),
    phone: phone || null,
    action: "message_sent",
    entityType: "message_thread",
    entityId: thread.id,
    entityLabel: subject,
    metadata: {},
    ipAddress: ip(req),
    userAgent: req.headers.get("user-agent") ?? null,
  });
  void createNotification({
    type: "message_new",
    title: "رسالة زبون جديدة",
    body: `${customerName || "زبون"}: ${message.slice(0, 120)}`,
    entityType: "message_thread",
    entityId: thread.id,
    href: "/admin/messages",
  });
  return json({ message: "تم إرسال الرسالة", threadId: thread.id }, 201);
}

async function handleCustomerActivity(req: NextRequest, parts: string[]) {
  if (req.method !== "POST" || parts.length !== 1) return null;
  await ensureAdminExtensionsTables();
  const data = await body(req);
  const action = String(data?.action ?? "").trim().slice(0, 60);
  if (!action) return error("نوع النشاط غير صحيح", 400);
  const customerId = getCurrentCustomerId(req);
  const phone = normalizeIraqiPhone(data?.phone ?? "") ?? null;
  await db.insert(customerActivityLogsTable).values({
    customerId,
    sessionId: String(data?.sessionId ?? getSessionId(req)).slice(0, 80),
    phone,
    action,
    entityType: typeof data?.entityType === "string" ? data.entityType.slice(0, 40) : null,
    entityId: Number.isFinite(Number(data?.entityId)) ? Number(data.entityId) : null,
    entityLabel: typeof data?.entityLabel === "string" ? data.entityLabel.slice(0, 220) : null,
    metadata: data?.metadata && typeof data.metadata === "object" ? data.metadata : {},
    ipAddress: ip(req),
    userAgent: req.headers.get("user-agent") ?? null,
  });
  return json({ ok: true }, 201);
}

async function handleQr(req: NextRequest, parts: string[]) {
  if (req.method !== "GET" || !parts[1]) return null;
  await ensureAdminExtensionsTables();
  const token = String(parts[1] ?? "").trim();
  if (!/^[a-f0-9]{32,80}$/i.test(token)) return error("رمز QR غير صالح", 400);
  const row = await db.query.qrTokensTable.findFirst({ where: eq(qrTokensTable.token, token) });
  if (!row) return error("رمز QR غير موجود", 404);
  if (parts[2] === "status") {
    try {
      return json(await buildPublicQrStatus(row));
    } catch (err: any) {
      return error(err?.message ?? "تعذر قراءة حالة QR", Number(err?.status ?? 500));
    }
  }
  await db
    .update(qrTokensTable)
    .set({ scanCount: (row.scanCount ?? 0) + 1, lastScannedAt: new Date() })
    .where(eq(qrTokensTable.id, row.id));
  const safeTarget = `${baseUrlFromReq(req)}/track/${encodeURIComponent(token)}`;
  if (row.targetUrl !== safeTarget || /\/admin(?:\/|$)|\/dashboard(?:\/|$)|\/orders(?:\/|$)|\/invoices(?:\/|$)/i.test(row.targetUrl)) {
    await db.update(qrTokensTable).set({ targetUrl: safeTarget }).where(eq(qrTokensTable.id, row.id));
  }
  return NextResponse.redirect(safeTarget);
}

async function buildPublicQrStatus(row: typeof qrTokensTable.$inferSelect) {
  if (row.entityType === "order") {
    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, row.entityId) });
    if (!order) throw Object.assign(new Error("لم يتم العثور على الطلب"), { status: 404 });
    const history = await db.query.orderStatusHistoryTable.findMany({
      where: eq(orderStatusHistoryTable.orderId, order.id),
      orderBy: [desc(orderStatusHistoryTable.createdAt)],
      limit: 12,
    });
    return {
      kind: "order",
      trackingCode: order.trackingCode,
      customerName: order.customerName,
      status: order.status,
      paymentStatus: order.paymentStatus ?? "unpaid",
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.createdAt.toISOString(),
      statusHistory: history.map((item) => ({
        status: item.status,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  if (row.entityType === "service_order") {
    const order = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, row.entityId) });
    if (!order) throw Object.assign(new Error("لم يتم العثور على الحجز"), { status: 404 });
    const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, order.serviceId) });
    const history = await db.query.serviceOrderStatusHistoryTable.findMany({
      where: eq(serviceOrderStatusHistoryTable.serviceOrderId, order.id),
      orderBy: [desc(serviceOrderStatusHistoryTable.createdAt)],
      limit: 12,
    });
    return {
      kind: "service",
      trackingCode: order.trackingCode ?? `SRV-${order.id}`,
      customerName: order.customerName,
      serviceName: service?.nameAr ?? service?.name ?? "حجز خدمة",
      serviceType: service?.type ?? null,
      status: order.status,
      paymentStatus: order.paymentStatus ?? "unpaid",
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.createdAt.toISOString(),
      statusHistory: (history.length ? history : [{ status: order.status, createdAt: order.createdAt }]).map((item: any) => ({
        status: item.status,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  if (row.entityType === "invoice") {
    const invoice = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, row.entityId) });
    if (!invoice) throw Object.assign(new Error("لم يتم العثور على الفاتورة"), { status: 404 });
    return {
      kind: "invoice",
      trackingCode: invoice.invoiceNo,
      customerName: invoice.customerName || "عميل",
      status: invoice.status === "active" ? "confirmed" : invoice.status,
      paymentStatus: invoice.paymentStatus ?? "unpaid",
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      statusHistory: [
        {
          status: invoice.status === "active" ? "confirmed" : invoice.status,
          createdAt: invoice.updatedAt.toISOString(),
        },
      ],
    };
  }

  throw Object.assign(new Error("نوع QR غير مدعوم"), { status: 400 });
}

function formatNotification(row: any) {
  return {
    id: row.id,
    audienceType: row.audienceType ?? row.audience_type,
    staffId: row.staffId ?? row.staff_id ?? null,
    customerId: row.customerId ?? row.customer_id ?? null,
    type: row.type,
    title: row.title,
    body: row.body ?? "",
    entityType: row.entityType ?? row.entity_type ?? null,
    entityId: row.entityId ?? row.entity_id ?? null,
    href: row.href ?? null,
    metadata: row.metadata ?? {},
    readAt: row.readAt?.toISOString?.() ?? row.read_at?.toISOString?.() ?? null,
    archivedAt: row.archivedAt?.toISOString?.() ?? row.archived_at?.toISOString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? row.created_at?.toISOString?.() ?? null,
  };
}

function pushSubscriptionFromBody(input: any) {
  const sub = input?.subscription ?? input;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  return endpoint && p256dh && auth ? { endpoint, p256dh, auth } : null;
}

async function handleNotifications(req: NextRequest, parts: string[]) {
  const method = req.method;

  if (method === "GET" && parts[1] === "vapid-public-key") {
    return json({ publicKey: getVapidPublicKey(), enabled: Boolean(getVapidPublicKey() && process.env.VAPID_PRIVATE_KEY) });
  }

  await ensureAdminExtensionsTables();

  if (method === "POST" && parts[1] === "subscribe") {
    const parsed = pushSubscriptionFromBody(await body(req));
    if (!parsed) return error("اشتراك الإشعارات غير صالح", 400);
    const adminUser = await getAdminUser(req);
    const customerId = getCurrentCustomerId(req);
    if (!adminUser && !customerId) return error("سجل الدخول لتفعيل الإشعارات", 401);
    const ownerType = adminUser ? "staff" : "customer";
    const [row] = await db
      .insert(notificationSubscriptionsTable)
      .values({
        ownerType,
        staffId: adminUser?.id ?? null,
        customerId: customerId ?? null,
        endpoint: parsed.endpoint,
        p256dh: parsed.p256dh,
        auth: parsed.auth,
        userAgent: req.headers.get("user-agent") ?? null,
        isActive: 1,
      })
      .onConflictDoUpdate({
        target: notificationSubscriptionsTable.endpoint,
        set: {
          ownerType,
          staffId: adminUser?.id ?? null,
          customerId: customerId ?? null,
          p256dh: parsed.p256dh,
          auth: parsed.auth,
          userAgent: req.headers.get("user-agent") ?? null,
          isActive: 1,
          updatedAt: new Date(),
        },
      })
      .returning();
    return json({ id: row.id, message: "تم تفعيل الإشعارات" });
  }

  if (method === "DELETE" && parts[1] === "subscribe") {
    const parsed = pushSubscriptionFromBody(await body(req));
    if (!parsed) return error("اشتراك الإشعارات غير صالح", 400);
    await db
      .update(notificationSubscriptionsTable)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(eq(notificationSubscriptionsTable.endpoint, parsed.endpoint));
    return json({ message: "تم تعطيل الإشعارات" });
  }

  if (method === "GET" && parts[1] === "customer") {
    const customerId = getCurrentCustomerId(req);
    if (!customerId) return error("غير مخول", 401);
    const rows = await db.query.notificationsTable.findMany({
      where: and(eq(notificationsTable.audienceType, "customer"), eq(notificationsTable.customerId, customerId), sql`${notificationsTable.archivedAt} is null`),
      orderBy: [desc(notificationsTable.createdAt)],
      limit: 50,
    });
    return json(rows.map(formatNotification));
  }

  return null;
}

async function handleAdminKoshas(req: NextRequest, parts: string[], section: string | undefined) {
  const method = req.method;
  if (
    section !== "koshas" &&
    section !== "kosha-bookings" &&
    section !== "kosha-addons" &&
    section !== "kosha-welcome-boards" &&
    section !== "kosha-accessories" &&
    section !== "kosha-provinces"
  ) return null;
  await ensureKoshaTables();

  if (section === "kosha-addons" || section === "kosha-welcome-boards" || section === "kosha-accessories") {
    const auth = await requirePermission(req, "services");
    if (isResponse(auth)) return auth;
    const config = section === "kosha-addons"
      ? { table: koshaAddonsTable, entity: "kosha_addon", title: "الخدمة الإضافية", type: "addon" as const, folder: "koshas/addons" }
      : section === "kosha-welcome-boards"
        ? { table: koshaWelcomeBoardsTable, entity: "kosha_welcome_board", title: "بورد الترحيب", type: "welcome_board" as const, folder: "koshas/welcome-boards" }
        : { table: koshaAccessoriesTable, entity: "kosha_accessory", title: "الاكسسوار", type: "accessory" as const, folder: "koshas/accessories" };
    const table: any = config.table;
    const id = parts[2] ? int(parts[2]) : null;

    if (method === "GET" && parts.length === 2) {
      const rows = await db.select().from(table).orderBy(asc(table.sortOrder), asc(table.id));
      return json(rows.map((row) => formatKoshaOptionProduct(row, config.type)));
    }

    if (method === "POST" && parts.length === 2) {
      const parsed = KoshaOptionProductSchema.safeParse(await body(req));
      if (!parsed.success) return validationError(`admin.${section}.create`, parsed);
      const data = parsed.data;
      if (!String(data.name ?? "").trim()) return error(`اسم ${config.title} مطلوب`, 400);
      try {
        const inserted = await db.insert(table).values(await koshaOptionValuesFromData(data, config.folder)).returning() as any[];
        const row = inserted[0];
        void logAdminActivity(req, `${config.entity}_created`, config.entity, row.id, { name: row.name });
        return json(formatKoshaOptionProduct(row, config.type), 201);
      } catch (err: any) {
        if (err?.code === "23505") return error(`اسم ${config.title} مستخدم مسبقاً`, 409);
        throw err;
      }
    }

    if ((method === "PATCH" || method === "PUT") && id) {
      const parsed = KoshaOptionProductPatchSchema.safeParse(await body(req));
      if (!parsed.success) return validationError(`admin.${section}.update`, parsed);
      const data = parsed.data;
      const update = await koshaOptionValuesFromData(data, config.folder);
      if (data.name !== undefined && !String(data.name ?? "").trim()) return error(`اسم ${config.title} مطلوب`, 400);
      try {
        const updated = await db.update(table).set(update).where(eq(table.id, id)).returning() as any[];
        const row = updated[0];
        if (!row) return error(`${config.title} غير موجود`, 404);
        void logAdminActivity(req, `${config.entity}_updated`, config.entity, id, { fields: Object.keys(data) });
        return json(formatKoshaOptionProduct(row, config.type));
      } catch (err: any) {
        if (err?.code === "23505") return error(`اسم ${config.title} مستخدم مسبقاً`, 409);
        throw err;
      }
    }

    if (method === "DELETE" && id) {
      const deleted = await db.delete(table).where(eq(table.id, id)).returning() as any[];
      const row = deleted[0];
      if (!row) return error(`${config.title} غير موجود`, 404);
      void logAdminActivity(req, `${config.entity}_deleted`, config.entity, id);
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "kosha-provinces") {
    const auth = await requirePermission(req, "services");
    if (isResponse(auth)) return auth;
    const table = koshaProvincesTable;
    const entity = "kosha_province";
    const title = "المحافظة";
    const id = parts[2] ? int(parts[2]) : null;

    if (method === "GET" && parts.length === 2) {
      const rows = await db.select().from(table).orderBy(asc(table.sortOrder), asc(table.id));
      return json(rows.map((row) => ({
        id: row.id,
        name: row.name,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
      })));
    }

    if (method === "POST" && parts.length === 2) {
      const b = await body(req);
      const name = textFallback(b?.name, "");
      if (!name) return error(`اسم ${title} مطلوب`, 400);
      try {
        const [row] = await db.insert(table).values({
          name,
          isActive: b?.isActive !== false,
          sortOrder: Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : 0,
        } as any).returning();
        void logAdminActivity(req, `${entity}_created`, entity, row.id, { name });
        return json(row, 201);
      } catch (err: any) {
        if (err?.code === "23505") return error(`اسم ${title} مستخدم مسبقاً`, 409);
        throw err;
      }
    }

    if ((method === "PATCH" || method === "PUT") && id) {
      const b = await body(req);
      const update: any = { updatedAt: new Date() };
      if (b?.name !== undefined) {
        update.name = textFallback(b.name, "");
        if (!update.name) return error(`اسم ${title} مطلوب`, 400);
      }
      if (b?.isActive !== undefined) update.isActive = Boolean(b.isActive);
      if (b?.sortOrder !== undefined) update.sortOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
      try {
        const [row] = await db.update(table).set(update).where(eq(table.id, id)).returning();
        if (!row) return error(`${title} غير موجود`, 404);
        void logAdminActivity(req, `${entity}_updated`, entity, id, { fields: Object.keys(update) });
        return json(row);
      } catch (err: any) {
        if (err?.code === "23505") return error(`اسم ${title} مستخدم مسبقاً`, 409);
        throw err;
      }
    }

    if (method === "DELETE" && id) {
      const [row] = await db.delete(table).where(eq(table.id, id)).returning();
      if (!row) return error(`${title} غير موجود`, 404);
      void logAdminActivity(req, `${entity}_deleted`, entity, id);
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "koshas") {
    const auth = await requirePermission(req, "services");
    if (isResponse(auth)) return auth;

    if (method === "GET" && parts.length === 2) {
      const search = req.nextUrl.searchParams.get("search")?.trim();
      const rows = await db.query.koshasTable.findMany({
        where: search ? ilike(koshasTable.name, `%${search}%`) : undefined,
        orderBy: (k, { asc, desc }) => [asc(k.sortOrder), desc(k.createdAt)],
      });
      return json(await Promise.all(rows.map((row) => formatKosha(row, true))));
    }

    if (method === "POST" && parts.length === 2) {
      const rawBody = await body(req);
      const parsed = KoshaMutationSchema.safeParse(rawBody);
      if (!parsed.success) return validationError("admin.koshas.create", parsed);
      const data = parsed.data;
      if (!String(data.name ?? "").trim()) return error("اسم الكوشة مطلوب", 400);
      const [row] = await db.insert(koshasTable).values(await koshaValuesFromData(data)).returning();
      await replaceKoshaImages(row.id, data.galleryImages);
      void logAdminActivity(req, "kosha_created", "kosha", row.id, { name: row.name });
      return json(await formatKosha(row, true), 201);
    }

    if (parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف الكوشة غير صحيح", 400);
      const existing = await db.query.koshasTable.findFirst({ where: eq(koshasTable.id, id) });
      if (!existing) return error("الكوشة غير موجودة", 404);

      if (method === "GET") return json(await formatKosha(existing, true));

      if (method === "PATCH") {
        const rawBody = await body(req);
        const parsed = KoshaPatchSchema.safeParse(rawBody);
        if (!parsed.success) return validationError("admin.koshas.update", parsed);
        const values = await koshaValuesFromData(parsed.data, id);
        const [row] = await db.update(koshasTable).set(values).where(eq(koshasTable.id, id)).returning();
        if (Object.prototype.hasOwnProperty.call(parsed.data, "galleryImages")) {
          await replaceKoshaImages(id, parsed.data.galleryImages);
        }
        void logAdminActivity(req, "kosha_updated", "kosha", id, { fields: Object.keys(parsed.data) });
        return json(await formatKosha(row, true));
      }

      if (method === "DELETE") {
        await db.delete(koshasTable).where(eq(koshasTable.id, id));
        void logAdminActivity(req, "kosha_deleted", "kosha", id, { name: existing.name });
        return json({ message: "تم حذف الكوشة" });
      }
    }
  }

  if (section === "kosha-bookings") {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;

    if (method === "GET" && parts.length === 2) {
      const status = req.nextUrl.searchParams.get("status")?.trim();
      const search = req.nextUrl.searchParams.get("search")?.trim();
      const filters: any[] = [];
      if (status && (KOSHA_BOOKING_STATUS_VALUES as readonly string[]).includes(status)) filters.push(eq(koshaBookingsTable.status, status));
      if (search) {
        filters.push(or(
          ilike(koshaBookingsTable.customerName, `%${search}%`),
          ilike(koshaBookingsTable.phone, `%${search}%`),
          ilike(koshaBookingsTable.cityArea, `%${search}%`),
          ilike(koshaBookingsTable.hallLocation, `%${search}%`),
        ));
      }
      const rows = await db.query.koshaBookingsTable.findMany({
        where: filters.length ? and(...filters) : undefined,
        orderBy: (b, { desc }) => [desc(b.createdAt)],
        limit: 150,
      });
      return json(await Promise.all(rows.map((row) => formatKoshaBooking(row))));
    }

    if (parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف الحجز غير صحيح", 400);
      const existing = await db.query.koshaBookingsTable.findFirst({ where: eq(koshaBookingsTable.id, id) });
      if (!existing) return error("الحجز غير موجود", 404);

      if (method === "GET") return json(await formatKoshaBooking(existing));

      if (method === "PATCH") {
        const parsed = KoshaBookingUpdateSchema.safeParse(await body(req));
        if (!parsed.success) return validationError("admin.kosha-bookings.update", parsed);
        const update: any = { updatedAt: new Date() };
        if (parsed.data.status !== undefined) update.status = parsed.data.status;
        if (parsed.data.internalNotes !== undefined) update.internalNotes = nullableText(parsed.data.internalNotes);
        if (parsed.data.dueDate !== undefined) update.dueDate = parsed.data.dueDate;
        if (parsed.data.totalAmount !== undefined || parsed.data.paidAmount !== undefined || parsed.data.paymentStatus !== undefined) {
          const totalAmount = parsed.data.totalAmount ?? Number(existing.totalAmount);
          const payment = paymentSummary(totalAmount, parsed.data.paidAmount ?? existing.paidAmount, parsed.data.paymentStatus ?? existing.paymentStatus);
          update.totalAmount = String(money(totalAmount));
          update.paidAmount = String(payment.deposit);
          update.remainingAmount = String(payment.remaining);
          update.paymentStatus = payment.status;
        }
        const [row] = await db.update(koshaBookingsTable).set(update).where(eq(koshaBookingsTable.id, id)).returning();
        await syncKoshaFinancialPayment(row, financialActor(auth));
        const koshaPaymentDelta = Number(row.paidAmount) - Number(existing.paidAmount);
        if (koshaPaymentDelta > 0) {
          void notifyTelegramPayment({
            event: "paymentReceived",
            reference: `KB-${row.id}`,
            customerName: row.customerName,
            amount: koshaPaymentDelta,
            paymentMethod: "cash",
            createdByName: auth.fullName || auth.username,
            status: row.paymentStatus,
            entityPath: `/admin/kosha-bookings?booking=${row.id}`,
          });
        }
        void logAdminActivity(req, "kosha_booking_updated", "kosha_booking", id, update);
        return json(await formatKoshaBooking(row));
      }

      if (method === "DELETE") {
        await syncKoshaFinancialPayment({ ...existing, status: "cancelled" }, financialActor(auth));
        await db.delete(koshaBookingsTable).where(eq(koshaBookingsTable.id, id));
        void logAdminActivity(req, "kosha_booking_deleted", "kosha_booking", id);
        return json({ message: "تم حذف الحجز" });
      }
    }
  }

  return null;
}

async function handleAdmin(req: NextRequest, parts: string[]) {
  const method = req.method;
  const section = parts[1];

  const masterCash = await handleMasterCash(req, parts, section);
  if (masterCash) return masterCash;

  const telegram = await handleTelegram(req, parts, section);
  if (telegram) return telegram;

  if (section === "translate") {
    const auth = await requireAnyPermission(req, ["products", "services", "settings"]);
    if (isResponse(auth)) return auth;
    if (method !== "POST") return error("غير مدعوم", 405);
    const status = autoTranslateStatus();
    if (!status.available) return error(status.reason || "الترجمة التلقائية غير مفعّلة", 400);
    const b = await body(req);
    try {
      const result = await autoTranslate({ name: b?.name, description: b?.description });
      return json(result);
    } catch (err: any) {
      return error(err?.message || "تعذّر تنفيذ الترجمة التلقائية", 502);
    }
  }

  if (section === "auth") {
    await ensureAdminSeeded();

    if (method === "POST" && parts[2] === "login") {
      const { username, password } = await body(req);
      if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
        return error("بيانات ناقصة", 400);
      }
      const loginIp = ip(req);
      const userKey = username.trim().toLowerCase();
      if (!checkRateLimit(adminLoginByIp, loginIp, 20, 15 * 60 * 1000) || !checkRateLimit(adminLoginByUsername, userKey, 8, 15 * 60 * 1000)) {
        void logAdminActivity(req, "admin_login_rate_limited", "staff", undefined, { username: userKey });
        return error("محاولات كثيرة، حاول لاحقاً", 429);
      }
      const user = await db.query.staffTable.findFirst({ where: eq(staffTable.username, username) });
      if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
        void logAdminActivity(req, "admin_login_failed", "staff", user?.id, { username: userKey });
        return error("بيانات الدخول غير صحيحة", 401);
      }
      const { token } = await createSession(user.id);
      await ensureStaffActivityColumn();
      await db.update(staffTable).set({ lastActivityAt: new Date() }).where(eq(staffTable.id, user.id));
      void logAdminActivity(req, "admin_login_success", "staff", user.id, { username: userKey });
      void notifyTelegramLogin({ id: user.id, username: user.username, fullName: user.fullName, role: user.role });
      return withSessionCookie(
        json({
          user: publicUser({
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            role: user.role,
            permissions: user.permissions ?? [],
            isActive: user.isActive,
          }),
        }),
        token,
      );
    }

    if (method === "POST" && parts[2] === "logout") {
      const token = readAdminToken(req);
      void logAdminActivity(req, "admin_logout", "staff");
      if (token) await destroySession(token);
      return clearSessionCookie(json({ message: "تم الخروج" }));
    }

    if (method === "GET" && parts[2] === "me") {
      const user = await getAdminUser(req);
      if (!user) return error("غير مخول", 401);
      return json({ user: publicUser(user), allPermissions: ALL_PERMISSIONS });
    }
  }

  const dailyCash = await handleDailyCash(req, parts, section);
  if (dailyCash) return dailyCash;

  const adminKoshas = await handleAdminKoshas(req, parts, section);
  if (adminKoshas) return adminKoshas;

  if (section === "activity-log" && method === "GET") {
    const auth = await requirePermission(req, "staff");
    if (isResponse(auth)) return auth;
    await ensureActivityTables();

    const params = req.nextUrl.searchParams;
    const page = Math.max(Number.parseInt(params.get("page") ?? "1", 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "25", 10) || 25, 10), 100);
    const offset = (page - 1) * limit;
    const filters: any[] = [];

    const from = params.get("from");
    const to = params.get("to");
    const userId = params.get("userId");
    const action = params.get("action")?.trim();
    const search = params.get("search")?.trim();

    if (from) {
      const date = new Date(`${from}T00:00:00`);
      if (!Number.isNaN(date.getTime())) filters.push(gte(adminActivityLogsTable.createdAt, date));
    }
    if (to) {
      const date = new Date(`${to}T23:59:59.999`);
      if (!Number.isNaN(date.getTime())) filters.push(lte(adminActivityLogsTable.createdAt, date));
    }
    const parsedUserId = userId ? Number.parseInt(userId, 10) : null;
    if (parsedUserId && Number.isFinite(parsedUserId)) filters.push(eq(adminActivityLogsTable.staffId, parsedUserId));
    if (action) filters.push(eq(adminActivityLogsTable.action, action));
    if (search) {
      filters.push(or(
        ilike(adminActivityLogsTable.userName, `%${search}%`),
        ilike(adminActivityLogsTable.action, `%${search}%`),
        ilike(adminActivityLogsTable.entityType, `%${search}%`),
        sql`${adminActivityLogsTable.metadata}::text ilike ${`%${search}%`}`,
      ));
    }

    const whereClause = filters.length ? and(...filters) : undefined;
    const rowsQuery = db
      .select({
        id: adminActivityLogsTable.id,
        staffId: adminActivityLogsTable.staffId,
        userName: adminActivityLogsTable.userName,
        staffName: staffTable.fullName,
        username: staffTable.username,
        action: adminActivityLogsTable.action,
        entityType: adminActivityLogsTable.entityType,
        entityId: adminActivityLogsTable.entityId,
        metadata: adminActivityLogsTable.metadata,
        ipAddress: adminActivityLogsTable.ipAddress,
        createdAt: adminActivityLogsTable.createdAt,
      })
      .from(adminActivityLogsTable)
      .leftJoin(staffTable, eq(adminActivityLogsTable.staffId, staffTable.id));
    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminActivityLogsTable);

    const [rows, countRows, staffRows] = await Promise.all([
      (whereClause ? rowsQuery.where(whereClause) : rowsQuery)
        .orderBy(desc(adminActivityLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      (whereClause ? countQuery.where(whereClause) : countQuery),
      db
        .select({ id: staffTable.id, username: staffTable.username, fullName: staffTable.fullName })
        .from(staffTable)
        .orderBy(staffTable.id),
    ]);

    return json({
      data: rows.map((row) => ({
        ...row,
        userName: row.userName || row.staffName || row.username || "النظام",
        createdAt: row.createdAt.toISOString(),
      })),
      users: staffRows.map((row) => ({
        id: row.id,
        name: row.fullName || row.username,
        username: row.username,
      })),
      total: countRows[0]?.count ?? 0,
      page,
      limit,
    });
  }

  if (section === "notifications") {
    const auth = await requirePermission(req, "dashboard");
    if (isResponse(auth)) return auth;
    await ensureAdminExtensionsTables();

    if (parts[2] === "settings") {
      const settingsAuth = await requirePermission(req, "settings");
      if (isResponse(settingsAuth)) return settingsAuth;
      if (method === "GET") return json(await getGlobalNotificationSettings());
      if (method === "PATCH" || method === "PUT") {
        const b = await body(req);
        const values = {
          pushEnabled: b?.pushEnabled === false ? 0 : 1,
          ordersEnabled: b?.ordersEnabled === false ? 0 : 1,
          messagesEnabled: b?.messagesEnabled === false ? 0 : 1,
          tasksEnabled: b?.tasksEnabled === false ? 0 : 1,
          inventoryEnabled: b?.inventoryEnabled === false ? 0 : 1,
          customerEnabled: b?.customerEnabled === false ? 0 : 1,
          updatedAt: new Date(),
        };
        const existing = await db.query.notificationSettingsTable.findFirst({
          where: and(eq(notificationSettingsTable.ownerType, "global"), sql`${notificationSettingsTable.ownerId} is null`),
        });
        const [row] = existing
          ? await db.update(notificationSettingsTable).set(values).where(eq(notificationSettingsTable.id, existing.id)).returning()
          : await db.insert(notificationSettingsTable).values({ ownerType: "global", ownerId: null, ...values }).returning();
        void logAdminActivity(req, "notification_settings_updated", "settings");
        return json(notificationSettingsToJson(row));
      }
    }

    if (method === "GET") {
      const params = req.nextUrl.searchParams;
      const filters: any[] = [
        eq(notificationsTable.audienceType, "admin"),
        sql`${notificationsTable.archivedAt} is null`,
        or(sql`${notificationsTable.staffId} is null`, eq(notificationsTable.staffId, auth.id)),
      ];
      const status = params.get("status")?.trim();
      const type = params.get("type")?.trim();
      const q = params.get("q")?.trim();
      if (status === "unread") filters.push(sql`${notificationsTable.readAt} is null`);
      if (status === "read") filters.push(sql`${notificationsTable.readAt} is not null`);
      if (type) filters.push(eq(notificationsTable.type, type));
      if (q) filters.push(or(ilike(notificationsTable.title, `%${q}%`), ilike(notificationsTable.body, `%${q}%`)));
      const whereClause = and(...filters);
      const [rows, unreadRows] = await Promise.all([
        db.query.notificationsTable.findMany({
          where: whereClause,
          orderBy: [desc(notificationsTable.createdAt)],
          limit: Math.min(Math.max(Number.parseInt(params.get("limit") ?? "80", 10) || 80, 1), 150),
        }),
        db
          .select({ c: sql<number>`count(*)::int` })
          .from(notificationsTable)
          .where(and(
            eq(notificationsTable.audienceType, "admin"),
            sql`${notificationsTable.archivedAt} is null`,
            sql`${notificationsTable.readAt} is null`,
            or(sql`${notificationsTable.staffId} is null`, eq(notificationsTable.staffId, auth.id)),
          )),
      ]);
      return json({ data: rows.map(formatNotification), unreadCount: unreadRows[0]?.c ?? 0 });
    }

    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = {};
      if (b?.read !== undefined) update.readAt = b.read ? new Date() : null;
      if (b?.archived !== undefined) update.archivedAt = b.archived ? new Date() : null;
      if (Object.keys(update).length === 0) update.readAt = new Date();
      const [row] = await db
        .update(notificationsTable)
        .set(update)
        .where(and(eq(notificationsTable.id, id), eq(notificationsTable.audienceType, "admin"), or(sql`${notificationsTable.staffId} is null`, eq(notificationsTable.staffId, auth.id))))
        .returning();
      if (!row) return error("الإشعار غير موجود", 404);
      return json(formatNotification(row));
    }

    if (method === "POST" && parts[2] === "mark-all-read") {
      await db
        .update(notificationsTable)
        .set({ readAt: new Date() })
        .where(and(eq(notificationsTable.audienceType, "admin"), sql`${notificationsTable.archivedAt} is null`, sql`${notificationsTable.readAt} is null`, or(sql`${notificationsTable.staffId} is null`, eq(notificationsTable.staffId, auth.id))));
      return json({ message: "تم تحديد الكل كمقروء" });
    }

    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db
        .delete(notificationsTable)
        .where(and(eq(notificationsTable.id, id), eq(notificationsTable.audienceType, "admin"), or(sql`${notificationsTable.staffId} is null`, eq(notificationsTable.staffId, auth.id))));
      return json({ message: "تم حذف الإشعار" });
    }
  }

  if (section === "tasks") {
    const auth = await requirePermission(req, "tasks");
    if (isResponse(auth)) return auth;
    await ensureAdminExtensionsTables();
    const canManageAll = auth.role === "admin" || hasPermission(auth, "staff");

    if (method === "GET" && !parts[2]) {
      const params = req.nextUrl.searchParams;
      const filters: any[] = [sql`${tasksTable.archivedAt} is null`];
      const status = params.get("status")?.trim();
      const priority = params.get("priority")?.trim();
      const staffId = Number.parseInt(params.get("staffId") ?? "", 10);
      const date = params.get("date");
      const q = params.get("q")?.trim();
      if (status) filters.push(eq(tasksTable.status, taskStatus(status)));
      if (priority) filters.push(eq(tasksTable.priority, taskPriority(priority)));
      if (Number.isFinite(staffId) && staffId > 0) filters.push(sql`${tasksTable.assignedStaffIds} @> ${JSON.stringify([staffId])}::jsonb`);
      if (date) {
        const from = new Date(`${date}T00:00:00`);
        const to = new Date(`${date}T23:59:59.999`);
        if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) filters.push(and(gte(tasksTable.dueAt, from), lte(tasksTable.dueAt, to)));
      }
      if (q) filters.push(or(ilike(tasksTable.title, `%${q}%`), ilike(tasksTable.description, `%${q}%`), ilike(tasksTable.notes, `%${q}%`)));
      if (!canManageAll) filters.push(sql`${tasksTable.assignedStaffIds} @> ${JSON.stringify([auth.id])}::jsonb`);
      const [rows, staffRows] = await Promise.all([
        db.query.tasksTable.findMany({
          where: filters.length ? and(...filters) : undefined,
          orderBy: [desc(tasksTable.updatedAt), desc(tasksTable.createdAt)],
          limit: 200,
        }),
        db.query.staffTable.findMany({ orderBy: (s, { asc }) => [asc(s.id)] }),
      ]);
      const staffById = new Map(staffRows.map((staff) => [staff.id, staff]));
      return json({
        data: rows.map((row) => formatTask(row, staffById)),
        staff: staffRows.map(formatStaff),
      });
    }

    if (method === "POST" && !parts[2]) {
      if (!canManageAll && !hasPermission(auth, "tasks")) return error("ليس لديك صلاحية إنشاء المهام", 403);
      const b = await body(req);
      const title = textFallback(b?.title, "مهمة جديدة");
      const assignedStaffIds = idList(b?.assignedStaffIds ?? b?.staffIds);
      const dueAt = safeDate(b?.dueAt);
      const [row] = await db
        .insert(tasksTable)
        .values({
          title,
          description: nullableText(b?.description),
          status: taskStatus(b?.status),
          priority: taskPriority(b?.priority),
          dueAt,
          assignedStaffIds,
          relatedType: typeof b?.relatedType === "string" ? b.relatedType.slice(0, 30) : null,
          relatedId: Number.isFinite(Number(b?.relatedId)) ? Number(b.relatedId) : null,
          notes: nullableText(b?.notes),
          attachments: Array.isArray(b?.attachments) ? b.attachments.filter((item: unknown) => typeof item === "string") : [],
          createdBy: auth.id,
        })
        .returning();
      await Promise.all((assignedStaffIds.length ? assignedStaffIds : [null]).map((staffId) => createNotification({
        type: "task_assigned",
        title: "مهمة جديدة",
        body: title,
        staffId,
        entityType: "task",
        entityId: row.id,
        href: "/admin/tasks",
      })));
      void logAdminActivity(req, "task_created", "task", row.id, { assignedStaffIds, title });
      return json(formatTask(row), 201);
    }

    if (method === "POST" && parts[2] && parts[3] === "comments") {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const task = await db.query.tasksTable.findFirst({ where: eq(tasksTable.id, id) });
      if (!task) return error("المهمة غير موجودة", 404);
      if (!canManageAll && !(task.assignedStaffIds ?? []).includes(auth.id)) return error("ليس لديك صلاحية على هذه المهمة", 403);
      const b = await body(req);
      const comment = String(b?.body ?? b?.comment ?? "").trim().slice(0, 1000);
      if (!comment) return error("اكتب التعليق أولاً", 400);
      const [row] = await db.insert(taskCommentsTable).values({ taskId: id, staffId: auth.id, body: comment }).returning();
      await db.update(tasksTable).set({ updatedAt: new Date() }).where(eq(tasksTable.id, id));
      return json({ id: row.id, body: row.body, createdAt: row.createdAt.toISOString() }, 201);
    }

    if ((method === "PATCH" || method === "DELETE") && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const existing = await db.query.tasksTable.findFirst({ where: eq(tasksTable.id, id) });
      if (!existing) return error("المهمة غير موجودة", 404);
      if (!canManageAll && !(existing.assignedStaffIds ?? []).includes(auth.id)) return error("ليس لديك صلاحية على هذه المهمة", 403);
      if (method === "DELETE") {
        const [row] = await db.update(tasksTable).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(tasksTable.id, id)).returning();
        void logAdminActivity(req, "task_archived", "task", id);
        return json(formatTask(row));
      }
      const b = await body(req);
      const update: any = { updatedAt: new Date() };
      if (b?.title !== undefined) update.title = textFallback(b.title, existing.title, "مهمة");
      if (b?.description !== undefined) update.description = nullableText(b.description);
      if (b?.status !== undefined) update.status = taskStatus(b.status);
      if (b?.priority !== undefined) update.priority = taskPriority(b.priority);
      if (b?.dueAt !== undefined) update.dueAt = safeDate(b.dueAt);
      if (b?.assignedStaffIds !== undefined || b?.staffIds !== undefined) update.assignedStaffIds = idList(b.assignedStaffIds ?? b.staffIds);
      if (b?.relatedType !== undefined) update.relatedType = typeof b.relatedType === "string" ? b.relatedType.slice(0, 30) : null;
      if (b?.relatedId !== undefined) update.relatedId = Number.isFinite(Number(b.relatedId)) ? Number(b.relatedId) : null;
      if (b?.notes !== undefined) update.notes = nullableText(b.notes);
      if (b?.attachments !== undefined) update.attachments = Array.isArray(b.attachments) ? b.attachments.filter((item: unknown) => typeof item === "string") : [];
      const [row] = await db.update(tasksTable).set(update).where(eq(tasksTable.id, id)).returning();
      void logAdminActivity(req, "task_updated", "task", id, { fields: Object.keys(update) });
      return json(formatTask(row));
    }
  }

  if (section === "calendar" && method === "GET") {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;
    await ensureAdminExtensionsTables();
    const params = req.nextUrl.searchParams;
    const fromText = params.get("from") || new Date().toISOString().slice(0, 10);
    const toText = params.get("to") || fromText;
    const serviceId = Number.parseInt(params.get("serviceId") ?? "", 10);
    const crew = params.get("crew")?.trim();
    const status = params.get("status")?.trim();
    const [bookings, productOrders, services] = await Promise.all([
      db.query.serviceOrdersTable.findMany({
        where: and(sql`${serviceOrdersTable.archivedAt} is null`, status ? eq(serviceOrdersTable.status, status) : undefined),
        orderBy: [asc(serviceOrdersTable.eventDate), desc(serviceOrdersTable.createdAt)],
        limit: 500,
      }),
      db.query.ordersTable.findMany({
        where: and(sql`${ordersTable.archivedAt} is null`, gte(ordersTable.createdAt, new Date(`${fromText}T00:00:00`)), lte(ordersTable.createdAt, new Date(`${toText}T23:59:59.999`))),
        orderBy: [desc(ordersTable.createdAt)],
        limit: 100,
      }),
      db.query.servicesTable.findMany(),
    ]);
    const serviceMap = new Map(services.map((service) => [service.id, service]));
    const inRange = (dateValue: string | null | undefined) => {
      if (!dateValue) return false;
      const day = dateValue.slice(0, 10);
      return day >= fromText && day <= toText;
    };
    const serviceEvents = bookings
      .filter((booking) => inRange(booking.eventDate))
      .filter((booking) => !Number.isFinite(serviceId) || serviceId <= 0 || booking.serviceId === serviceId)
      .filter((booking) => !crew || String((booking.customFields as any)?.crewName ?? "").includes(crew))
      .map((booking) => ({
        id: booking.id,
        kind: "service",
        title: serviceMap.get(booking.serviceId)?.nameAr ?? serviceMap.get(booking.serviceId)?.name ?? "حجز خدمة",
        customerName: booking.customerName,
        trackingCode: booking.trackingCode,
        status: booking.status,
        serviceId: booking.serviceId,
        serviceType: serviceMap.get(booking.serviceId)?.type ?? null,
        crewName: String((booking.customFields as any)?.crewName ?? ""),
        date: booking.eventDate,
        location: booking.eventLocation ?? "",
      }));
    const orderEvents = productOrders.map((order) => ({
      id: order.id,
      kind: "order",
      title: "طلب متجر",
      customerName: order.customerName,
      trackingCode: order.trackingCode,
      status: order.status,
      date: order.createdAt.toISOString().slice(0, 10),
      location: [order.governorate, order.area, order.address].filter(Boolean).join(" / "),
    }));
    return json({ events: [...serviceEvents, ...orderEvents], services: services.map(formatService) });
  }

  if (section === "messages") {
    const auth = await requirePermission(req, "customers");
    if (isResponse(auth)) return auth;
    await ensureAdminExtensionsTables();
    if (method === "GET" && req.nextUrl.searchParams.get("count") === "1") {
      const countRows = await db.select({ c: sql<number>`count(*)::int` }).from(messageThreadsTable).where(eq(messageThreadsTable.status, "new"));
      return json({ count: countRows[0]?.c ?? 0 });
    }
    if (method === "GET" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const thread = await db.query.messageThreadsTable.findFirst({ where: eq(messageThreadsTable.id, id) });
      if (!thread) return error("المحادثة غير موجودة", 404);
      const replies = await db.query.messageRepliesTable.findMany({
        where: eq(messageRepliesTable.threadId, id),
        orderBy: [asc(messageRepliesTable.createdAt)],
      });
      if (thread.status === "new") {
        await db.update(messageThreadsTable).set({ status: "read", updatedAt: new Date() }).where(eq(messageThreadsTable.id, id));
        thread.status = "read";
      }
      return json(formatMessageThread(thread, replies));
    }
    if (method === "GET") {
      const params = req.nextUrl.searchParams;
      const status = params.get("status")?.trim();
      const q = params.get("q")?.trim();
      const filters: any[] = [];
      if (status) filters.push(eq(messageThreadsTable.status, messageStatus(status)));
      if (q) filters.push(or(ilike(messageThreadsTable.customerName, `%${q}%`), ilike(messageThreadsTable.phone, `%${q}%`), ilike(messageThreadsTable.subject, `%${q}%`)));
      const rows = await db.query.messageThreadsTable.findMany({
        where: filters.length ? and(...filters) : undefined,
        orderBy: [desc(messageThreadsTable.lastMessageAt), desc(messageThreadsTable.id)],
        limit: 100,
      });
      const ids = rows.map((row) => row.id);
      const replies = ids.length
        ? await db.query.messageRepliesTable.findMany({
            where: inArray(messageRepliesTable.threadId, ids),
            orderBy: [desc(messageRepliesTable.createdAt)],
          })
        : [];
      return json(rows.map((row) => formatMessageThread(row, replies.filter((reply) => reply.threadId === row.id))));
    }
    if (method === "POST" && parts[2] && parts[3] === "replies") {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const thread = await db.query.messageThreadsTable.findFirst({ where: eq(messageThreadsTable.id, id) });
      if (!thread) return error("المحادثة غير موجودة", 404);
      const b = await body(req);
      const replyBody = String(b?.body ?? b?.message ?? "").trim().slice(0, 2000);
      if (!replyBody) return error("اكتب الرد أولاً", 400);
      const [reply] = await db.insert(messageRepliesTable).values({ threadId: id, senderType: "admin", staffId: auth.id, body: replyBody }).returning();
      const [updated] = await db
        .update(messageThreadsTable)
        .set({ status: "replied", lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(messageThreadsTable.id, id))
        .returning();
      if (updated.customerId) {
        void createNotification({
          audienceType: "customer",
          customerId: updated.customerId,
          type: "message_reply",
          title: "رد جديد من الإدارة",
          body: replyBody.slice(0, 140),
          entityType: "message_thread",
          entityId: id,
          href: "/profile",
        });
      }
      void logAdminActivity(req, "message_replied", "message_thread", id);
      return json(formatMessageThread(updated, [reply]));
    }
    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const [row] = await db
        .update(messageThreadsTable)
        .set({ status: messageStatus(b?.status), updatedAt: new Date() })
        .where(eq(messageThreadsTable.id, id))
        .returning();
      if (!row) return error("المحادثة غير موجودة", 404);
      return json(formatMessageThread(row));
    }
  }

  if (section === "customer-activity" && method === "GET") {
    const auth = await requirePermission(req, "customers");
    if (isResponse(auth)) return auth;
    await ensureAdminExtensionsTables();
    const params = req.nextUrl.searchParams;
    const filters: any[] = [];
    const action = params.get("action")?.trim();
    const customerId = Number.parseInt(params.get("customerId") ?? "", 10);
    const sessionId = params.get("sessionId")?.trim();
    const from = params.get("from");
    const to = params.get("to");
    if (action) filters.push(eq(customerActivityLogsTable.action, action));
    if (Number.isFinite(customerId) && customerId > 0) filters.push(eq(customerActivityLogsTable.customerId, customerId));
    if (sessionId) filters.push(eq(customerActivityLogsTable.sessionId, sessionId));
    if (from) filters.push(gte(customerActivityLogsTable.createdAt, new Date(`${from}T00:00:00`)));
    if (to) filters.push(lte(customerActivityLogsTable.createdAt, new Date(`${to}T23:59:59.999`)));
    const rows = await db.query.customerActivityLogsTable.findMany({
      where: filters.length ? and(...filters) : undefined,
      orderBy: [desc(customerActivityLogsTable.createdAt)],
      limit: 200,
    });
    return json(rows.map((row) => ({
      id: row.id,
      customerId: row.customerId ?? null,
      sessionId: row.sessionId ?? "",
      phone: row.phone ?? "",
      action: row.action,
      entityType: row.entityType ?? "",
      entityId: row.entityId ?? null,
      entityLabel: row.entityLabel ?? "",
      metadata: row.metadata ?? {},
      createdAt: row.createdAt.toISOString(),
    })));
  }

  if (section === "attendance") {
    const auth = await requireAnyPermission(req, ["staff", "tasks"]);
    if (isResponse(auth)) return auth;
    await ensureAdminExtensionsTables();
    const canManageAll = auth.role === "admin" || hasPermission(auth, "staff");
    if (method === "GET") {
      const params = req.nextUrl.searchParams;
      const filters: any[] = [];
      const staffId = Number.parseInt(params.get("staffId") ?? "", 10);
      const from = params.get("from");
      const to = params.get("to");
      if (canManageAll && Number.isFinite(staffId) && staffId > 0) filters.push(eq(attendanceRecordsTable.staffId, staffId));
      if (!canManageAll) filters.push(eq(attendanceRecordsTable.staffId, auth.id));
      if (from) filters.push(gte(attendanceRecordsTable.checkInAt, new Date(`${from}T00:00:00`)));
      if (to) filters.push(lte(attendanceRecordsTable.checkInAt, new Date(`${to}T23:59:59.999`)));
      const [rows, staffRows] = await Promise.all([
        db.query.attendanceRecordsTable.findMany({
          where: filters.length ? and(...filters) : undefined,
          orderBy: [desc(attendanceRecordsTable.checkInAt)],
          limit: 200,
        }),
        db.query.staffTable.findMany({ orderBy: (s, { asc }) => [asc(s.id)] }),
      ]);
      const staffById = new Map(staffRows.map((staff) => [staff.id, staff]));
      return json({
        data: rows.map((row) => formatAttendance(row, staffById.get(row.staffId))),
        staff: staffRows.map(formatStaff),
      });
    }
    if (method === "POST") {
      const action = parts[2] || String((await body(req))?.action ?? "check-in");
      if (action === "check-out") {
        const open = await db.query.attendanceRecordsTable.findFirst({
          where: and(eq(attendanceRecordsTable.staffId, auth.id), sql`${attendanceRecordsTable.checkOutAt} is null`),
          orderBy: [desc(attendanceRecordsTable.checkInAt)],
        });
        if (!open) return error("لا يوجد حضور مفتوح لتسجيل الانصراف", 409);
        const [row] = await db
          .update(attendanceRecordsTable)
          .set({ checkOutAt: new Date(), status: "out", updatedAt: new Date() })
          .where(eq(attendanceRecordsTable.id, open.id))
          .returning();
        void logAdminActivity(req, "attendance_checkout", "attendance", row.id);
        return json(formatAttendance(row));
      }
      const open = await db.query.attendanceRecordsTable.findFirst({
        where: and(eq(attendanceRecordsTable.staffId, auth.id), sql`${attendanceRecordsTable.checkOutAt} is null`),
      });
      if (open) return error("لديك تسجيل حضور مفتوح بالفعل", 409);
      const [row] = await db.insert(attendanceRecordsTable).values({ staffId: auth.id, status: "present" }).returning();
      void logAdminActivity(req, "attendance_checkin", "attendance", row.id);
      return json(formatAttendance(row), 201);
    }
    if (method === "PATCH" && parts[2]) {
      if (!canManageAll) return error("ليس لديك صلاحية تعديل الحضور", 403);
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = { updatedAt: new Date(), editedBy: auth.id };
      if (b?.staffId !== undefined) update.staffId = Number(b.staffId);
      if (b?.checkInAt !== undefined) update.checkInAt = safeDate(b.checkInAt);
      if (b?.checkOutAt !== undefined) update.checkOutAt = safeDate(b.checkOutAt);
      if (b?.status !== undefined) update.status = attendanceStatus(b.status);
      if (b?.notes !== undefined) update.notes = nullableText(b.notes);
      const [row] = await db.update(attendanceRecordsTable).set(update).where(eq(attendanceRecordsTable.id, id)).returning();
      if (!row) return error("السجل غير موجود", 404);
      void logAdminActivity(req, "attendance_updated", "attendance", id, { fields: Object.keys(update) });
      return json(formatAttendance(row));
    }
  }

  if (section === "qr-orders" && method === "GET") {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;
    await ensureAdminExtensionsTables();
    const limit = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "40", 10) || 40, 1), 80);
    const [orders, bookings, invoices] = await Promise.all([
      db.query.ordersTable.findMany({ where: sql`${ordersTable.archivedAt} is null`, orderBy: [desc(ordersTable.createdAt)], limit }),
      db.query.serviceOrdersTable.findMany({ where: sql`${serviceOrdersTable.archivedAt} is null`, orderBy: [desc(serviceOrdersTable.createdAt)], limit }),
      db.query.salesInvoicesTable.findMany({ orderBy: [desc(salesInvoicesTable.createdAt)], limit }),
    ]);
    const rows = await Promise.all([
      ...orders.map(async (order) => {
        const qr = await ensureQrForEntity("order", order, req);
        return {
          id: order.id,
          kind: "order",
          label: order.trackingCode,
          customerName: order.customerName,
          amount: Number.parseFloat(order.total ?? "0"),
          status: order.status,
          paymentStatus: order.paymentStatus ?? "unpaid",
          date: order.createdAt.toISOString(),
          qr,
        };
      }),
      ...bookings.map(async (booking) => {
        const qr = await ensureQrForEntity("service_order", booking, req);
        return {
          id: booking.id,
          kind: "service_order",
          label: booking.trackingCode ?? `#${booking.id}`,
          customerName: booking.customerName,
          amount: Number.parseFloat(booking.totalAmount ?? "0"),
          status: booking.status,
          paymentStatus: booking.paymentStatus ?? "unpaid",
          date: booking.createdAt.toISOString(),
          qr,
        };
      }),
      ...invoices.map(async (invoice) => {
        const qr = await ensureQrForEntity("invoice", invoice, req);
        return {
          id: invoice.id,
          kind: "invoice",
          label: invoice.invoiceNo,
          customerName: invoice.customerName,
          amount: Number.parseFloat(invoice.total ?? "0"),
          status: invoice.status,
          paymentStatus: invoice.paymentStatus ?? "unpaid",
          date: invoice.createdAt.toISOString(),
          qr,
        };
      }),
    ]);
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return json(rows.slice(0, limit));
  }

  if (section === "dashboard" && method === "GET") {
    const auth = await requirePermission(req, "dashboard");
    if (isResponse(auth)) return auth;
    await Promise.all([ensurePaymentWorkflowColumns(), ensureAdminExtensionsTables()]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lateCutoff = new Date();
    lateCutoff.setDate(lateCutoff.getDate() - 3);
    const last30 = new Date();
    last30.setDate(last30.getDate() - 30);
    const taskScope = auth.role === "admin" || hasPermission(auth, "staff")
      ? sql`true`
      : sql`${tasksTable.assignedStaffIds} @> ${JSON.stringify([auth.id])}::jsonb`;
    const [
      totalOrders,
      totalProducts,
      totalCustomers,
      totalRevenue,
      activeOrders,
      cancelledOrders,
      deliveredOrders,
      todayRevenue,
      serviceOrdersCount,
      revenueByDay,
      statusBreakdown,
      topProducts,
      topCustomers,
      bookingsByService,
      monthlyRevenue,
      remainingTotals,
      partialOrders,
      unpaidOrders,
      topCrews,
      upcomingBookingsRaw,
      lateProductOrders,
      paymentFollowupOrders,
      servicePaymentFollowups,
      whatsappFailures,
      todayTaskCount,
      newMessageCount,
      unreadNotificationCount,
      presentStaffCount,
      recentCustomerActivity,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(sql`${ordersTable.archivedAt} is null`),
      db.select({ c: sql<number>`count(*)::int` }).from(productsTable),
      db.select({ c: sql<number>`count(*)::int` }).from(customersTable),
      db.select({ s: sql<number>`coalesce(sum((total::numeric - delivery_fee::numeric)),0)::float`, delivery: sql<number>`coalesce(sum(delivery_fee::numeric),0)::float`, gross: sql<number>`coalesce(sum(total::numeric),0)::float` }).from(ordersTable).where(sql`${ordersTable.archivedAt} is null`),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(sql`status in ('pending','confirmed','processing','shipped')`, sql`${ordersTable.archivedAt} is null`)),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(eq(ordersTable.status, "cancelled"), sql`${ordersTable.archivedAt} is null`)),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(eq(ordersTable.status, "delivered"), sql`${ordersTable.archivedAt} is null`)),
      db.select({ s: sql<number>`coalesce(sum((total::numeric - delivery_fee::numeric)),0)::float` }).from(ordersTable).where(and(gte(ordersTable.createdAt, today), sql`${ordersTable.archivedAt} is null`)),
      db.select({ c: sql<number>`count(*)::int` }).from(serviceOrdersTable).where(sql`${serviceOrdersTable.archivedAt} is null`),
      db
        .select({
          day: sql<string>`to_char(created_at, 'YYYY-MM-DD')`,
          total: sql<number>`coalesce(sum((total::numeric - delivery_fee::numeric)),0)::float`,
          orders: sql<number>`count(*)::int`,
        })
        .from(ordersTable)
        .where(and(gte(ordersTable.createdAt, last30), sql`${ordersTable.archivedAt} is null`))
        .groupBy(sql`to_char(created_at, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(created_at, 'YYYY-MM-DD')`),
      db.select({ status: ordersTable.status, count: sql<number>`count(*)::int` }).from(ordersTable).where(sql`${ordersTable.archivedAt} is null`).groupBy(ordersTable.status),
      db
        .select({
          productId: orderItemsTable.productId,
          productName: sql<string>`max(${orderItemsTable.productNameAr})`,
          qty: sql<number>`coalesce(sum(${orderItemsTable.quantity}),0)::int`,
          revenue: sql<number>`coalesce(sum(${orderItemsTable.quantity}::numeric * ${orderItemsTable.price}::numeric),0)::float`,
        })
        .from(orderItemsTable)
        .groupBy(orderItemsTable.productId)
        .orderBy(sql`coalesce(sum(${orderItemsTable.quantity}),0) desc`)
        .limit(5),
      db
        .select({
          phone: ordersTable.customerPhone,
          name: sql<string>`max(${ordersTable.customerName})`,
          orderCount: sql<number>`count(*)::int`,
          totalSpent: sql<number>`coalesce(sum(total::numeric),0)::float`,
        })
        .from(ordersTable)
        .where(sql`${ordersTable.archivedAt} is null`)
        .groupBy(ordersTable.customerPhone)
        .orderBy(sql`coalesce(sum(total::numeric),0) desc`)
        .limit(5),
      db
        .select({
          serviceId: serviceOrdersTable.serviceId,
          serviceName: sql<string>`max(${servicesTable.nameAr})`,
          count: sql<number>`count(*)::int`,
        })
        .from(serviceOrdersTable)
        .leftJoin(servicesTable, eq(servicesTable.id, serviceOrdersTable.serviceId))
        .where(sql`${serviceOrdersTable.archivedAt} is null`)
        .groupBy(serviceOrdersTable.serviceId)
        .orderBy(sql`count(*) desc`),
      db.select({ s: sql<number>`coalesce(sum((total::numeric - delivery_fee::numeric)),0)::float` }).from(ordersTable).where(and(gte(ordersTable.createdAt, monthStart), sql`status <> 'cancelled'`, sql`${ordersTable.archivedAt} is null`)),
      db
        .select({
          product: sql<number>`coalesce(sum(${ordersTable.remainingAmount}::numeric),0)::float`,
          bookings: sql<number>`(select coalesce(sum(remaining_amount::numeric),0)::float from service_orders where archived_at is null)`,
        })
        .from(ordersTable)
        .where(sql`${ordersTable.archivedAt} is null`),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(eq(ordersTable.paymentStatus, "partial"), sql`${ordersTable.archivedAt} is null`)),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(eq(ordersTable.paymentStatus, "unpaid"), sql`${ordersTable.archivedAt} is null`)),
      db
        .select({
          crewName: sql<string>`${serviceOrdersTable.customFields}->>'crewName'`,
          count: sql<number>`count(*)::int`,
        })
        .from(serviceOrdersTable)
        .where(sql`${serviceOrdersTable.archivedAt} is null and ${serviceOrdersTable.customFields}->>'crewName' is not null and ${serviceOrdersTable.customFields}->>'crewName' <> ''`)
        .groupBy(sql`${serviceOrdersTable.customFields}->>'crewName'`)
        .orderBy(sql`count(*) desc`)
        .limit(5),
      db.query.serviceOrdersTable.findMany({
        where: sql`${serviceOrdersTable.archivedAt} is null and ${serviceOrdersTable.status} not in ('cancelled','completed','delivered')`,
        orderBy: [desc(serviceOrdersTable.createdAt)],
        limit: 80,
      }),
      db.query.ordersTable.findMany({
        where: and(sql`${ordersTable.status} not in ('cancelled','delivered')`, lt(ordersTable.createdAt, lateCutoff), sql`${ordersTable.archivedAt} is null`),
        orderBy: [desc(ordersTable.createdAt)],
        limit: 8,
      }),
      db.query.ordersTable.findMany({
        where: and(inArray(ordersTable.paymentStatus, ["partial", "unpaid"]), sql`${ordersTable.archivedAt} is null`),
        orderBy: [desc(ordersTable.createdAt)],
        limit: 8,
      }),
      db.query.serviceOrdersTable.findMany({
        where: and(inArray(serviceOrdersTable.paymentStatus, ["partial", "unpaid"]), sql`${serviceOrdersTable.archivedAt} is null`),
        orderBy: [desc(serviceOrdersTable.createdAt)],
        limit: 8,
      }),
      db.select({ c: sql<number>`count(*)::int` }).from(whatsappLogTable).where(sql`${whatsappLogTable.status} not in ('sent','success','ok')`),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(tasksTable)
        .where(sql`${tasksTable.archivedAt} is null and ${tasksTable.status} not in ('completed','cancelled') and ${tasksTable.dueAt} >= ${today} and ${tasksTable.dueAt} < ${tomorrow} and ${taskScope}`),
      db.select({ c: sql<number>`count(*)::int` }).from(messageThreadsTable).where(eq(messageThreadsTable.status, "new")),
      db.select({ c: sql<number>`count(*)::int` }).from(notificationsTable).where(and(eq(notificationsTable.audienceType, "admin"), sql`${notificationsTable.readAt} is null`, sql`${notificationsTable.archivedAt} is null`)),
      db.select({ c: sql<number>`count(*)::int` }).from(attendanceRecordsTable).where(sql`${attendanceRecordsTable.checkOutAt} is null and ${attendanceRecordsTable.checkInAt} >= ${today}`),
      db.query.customerActivityLogsTable.findMany({ orderBy: [desc(customerActivityLogsTable.createdAt)], limit: 6 }),
    ]);
    const services = await db.query.servicesTable.findMany();
    const serviceMap = new Map(services.map((s) => [s.id, s]));
    const upcomingBookings = upcomingBookingsRaw
      .map((booking) => {
        const timestamp = booking.eventDate ? Date.parse(`${booking.eventDate}T00:00:00`) : NaN;
        return { booking, timestamp };
      })
      .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp >= today.getTime())
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 10)
      .map(({ booking }) => ({
        id: booking.id,
        trackingCode: booking.trackingCode,
        customerName: booking.customerName,
        serviceName: serviceMap.get(booking.serviceId)?.nameAr ?? serviceMap.get(booking.serviceId)?.name ?? "حجز",
        eventDate: booking.eventDate,
        status: booking.status,
      }));
    const todayBookings = upcomingBookingsRaw.filter((booking) => {
      const timestamp = booking.eventDate ? Date.parse(`${booking.eventDate}T00:00:00`) : NaN;
      return Number.isFinite(timestamp) && timestamp >= today.getTime() && timestamp < tomorrow.getTime();
    }).length;
    const lateBookingRows = upcomingBookingsRaw.filter((booking) => {
      const timestamp = booking.eventDate ? Date.parse(`${booking.eventDate}T00:00:00`) : NaN;
      return Number.isFinite(timestamp) && timestamp < today.getTime() && booking.status !== "cancelled";
    });
    const lateBookings = lateBookingRows.length;
    runAfter("order-followup-sync", () => Promise.allSettled([
      ...lateProductOrders.map((order) => notifyOrderNeedsFollowup({
        kind: "order",
        id: order.id,
        trackingCode: order.trackingCode,
        customerName: order.customerName,
        paymentStatus: order.paymentStatus,
        remainingAmount: order.remainingAmount,
        reason: "late",
      })),
      ...lateBookingRows.slice(0, 8).map((booking) => notifyOrderNeedsFollowup({
        kind: "service_order",
        id: booking.id,
        trackingCode: booking.trackingCode,
        customerName: booking.customerName,
        paymentStatus: booking.paymentStatus,
        remainingAmount: booking.remainingAmount,
        reason: "late",
      })),
      ...paymentFollowupOrders.map((order) => notifyOrderNeedsFollowup({
        kind: "order",
        id: order.id,
        trackingCode: order.trackingCode,
        customerName: order.customerName,
        paymentStatus: order.paymentStatus,
        remainingAmount: order.remainingAmount,
        reason: "payment",
      })),
      ...servicePaymentFollowups.map((booking) => notifyOrderNeedsFollowup({
        kind: "service_order",
        id: booking.id,
        trackingCode: booking.trackingCode,
        customerName: booking.customerName,
        paymentStatus: booking.paymentStatus,
        remainingAmount: booking.remainingAmount,
        reason: "payment",
      })),
    ]));
    const alerts = [
      { key: "new-orders", label: "طلبات بانتظار المراجعة", count: statusBreakdown.find((s) => s.status === "pending")?.count ?? 0 },
      { key: "bookings-today", label: "حجوزات اليوم", count: todayBookings },
      { key: "late-orders", label: "طلبات متأخرة", count: lateProductOrders.length + lateBookings },
      { key: "payment-followup", label: "مدفوع جزئياً أو غير مدفوع", count: (partialOrders[0]?.c ?? 0) + (unpaidOrders[0]?.c ?? 0) },
      { key: "whatsapp-failed", label: "رسائل واتساب تحتاج مراجعة", count: whatsappFailures[0]?.c ?? 0 },
      { key: "messages", label: "رسائل زبائن جديدة", count: newMessageCount[0]?.c ?? 0 },
      { key: "tasks", label: "مهام اليوم", count: todayTaskCount[0]?.c ?? 0 },
    ].filter((item) => item.count > 0);
    let dailyCashSummary = null as Awaited<ReturnType<typeof getDailyCashDashboardSummary>> | null;
    try {
      dailyCashSummary = await getDailyCashDashboardSummary();
    } catch (err: any) {
      console.warn("daily cash dashboard summary failed", { message: err?.message });
    }
    let financialSummary = {
      todaySales: dailyCashSummary?.totalSales ?? 0,
      todayExpenses: dailyCashSummary?.totalExpenses ?? 0,
      todayNetTotal: (dailyCashSummary?.totalSales ?? 0) - (dailyCashSummary?.totalExpenses ?? 0),
      monthlyExpenses: 0,
      cashBalance: dailyCashSummary?.expectedCashBalance ?? 0,
      deliveryFeesTotal: 0,
    };
    try {
      await ensureExpenseManagementTables();
      const [todayDeliveryRow, monthlyExpenseRow] = await Promise.all([
        db.select({ total: sql<number>`coalesce(sum(${ordersTable.deliveryFee}::numeric),0)::float` })
          .from(ordersTable)
          .where(and(gte(ordersTable.createdAt, today), lt(ordersTable.createdAt, tomorrow), sql`${ordersTable.archivedAt} is null`)),
        db.select({ total: sql<number>`coalesce(sum(${expensesTable.amount}::numeric),0)::float` })
          .from(expensesTable)
          .where(and(
            gte(expensesTable.date, monthStart.toISOString().slice(0, 10)),
            sql`${expensesTable.deletedAt} is null`,
            sql`coalesce(${expensesTable.approvalStatus}, 'executed') = 'executed'`,
          )),
      ]);
      financialSummary = {
        ...financialSummary,
        monthlyExpenses: Number(monthlyExpenseRow[0]?.total ?? 0),
        deliveryFeesTotal: Number(todayDeliveryRow[0]?.total ?? 0),
      };
    } catch (err: any) {
      console.warn("dashboard financial summary failed", { message: err?.message });
    }
    return json({
      totalOrders: totalOrders[0].c,
      activeOrders: activeOrders[0].c,
      cancelledOrders: cancelledOrders[0].c,
      deliveredOrders: deliveredOrders[0].c,
      serviceOrders: serviceOrdersCount[0].c,
      totalProducts: totalProducts[0].c,
      totalCustomers: totalCustomers[0].c,
      totalRevenue: totalRevenue[0].s,
      totalDeliveryRevenue: totalRevenue[0].delivery ?? 0,
      totalGrossRevenue: totalRevenue[0].gross ?? totalRevenue[0].s,
      todayRevenue: todayRevenue[0].s,
      monthlyRevenue: monthlyRevenue[0].s,
      remainingTotal: (remainingTotals[0]?.product ?? 0) + (remainingTotals[0]?.bookings ?? 0),
      partialOrders: partialOrders[0]?.c ?? 0,
      unpaidOrders: unpaidOrders[0]?.c ?? 0,
      revenueByDay,
      statusBreakdown,
      topProducts,
      topCustomers,
      bookingsByService,
      topCrews,
      upcomingBookings,
      lateOrders: lateProductOrders.map((order) => ({
        id: order.id,
        trackingCode: order.trackingCode,
        customerName: order.customerName,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
      })),
      todayTasks: {
        bookings: todayBookings,
        late: lateProductOrders.length + lateBookings,
        paymentFollowups: (partialOrders[0]?.c ?? 0) + (unpaidOrders[0]?.c ?? 0),
        internalTasks: todayTaskCount[0]?.c ?? 0,
      },
      adminOperations: {
        todayTasks: todayTaskCount[0]?.c ?? 0,
        newMessages: newMessageCount[0]?.c ?? 0,
        newNotifications: unreadNotificationCount[0]?.c ?? 0,
        todayBookings,
        presentStaffNow: presentStaffCount[0]?.c ?? 0,
        ordersNeedingFollowup: lateProductOrders.length + lateBookings + (partialOrders[0]?.c ?? 0) + (unpaidOrders[0]?.c ?? 0),
        recentCustomerActivity: recentCustomerActivity.map((row) => ({
          id: row.id,
          action: row.action,
          entityLabel: row.entityLabel ?? "",
          phone: row.phone ?? "",
          createdAt: row.createdAt.toISOString(),
        })),
      },
      dailyCash: dailyCashSummary,
      financialSummary,
      alerts,
    });
  }

  if (section === "categories") {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    await ensureStoreCategoryColumns();
    if (method === "GET") {
      const [rows, products] = await Promise.all([
        db.query.categoriesTable.findMany({
          orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.id)],
        }) as Promise<any[]>,
        db
          .select({
            categoryId: productsTable.categoryId,
            subcategoryId: productsTable.subcategoryId,
            category: productsTable.category,
            subcategory: productsTable.subcategory,
          })
          .from(productsTable) as Promise<any[]>,
      ]);
      const countFor = (category: any) => products.filter((product) => {
        if ((category.parentId ?? category.parent_id) != null) {
          return product.subcategoryId === category.id || product.subcategory === category.slug;
        }
        return product.categoryId === category.id || product.category === category.slug;
      }).length;
      const payload = rows.map((row) => formatCategory(row, countFor(row)));
      const catRes = json(payload);
      catRes.headers.set("Cache-Control", "private, max-age=120, stale-while-revalidate=300");
      return catRes;
    }
    if (method === "POST") {
      const catBody = await body(req);
      const { name, nameAr, slug, parentId, sortOrder, isActive, imageUrl, imageMetadata } = catBody;
      const categoryNameAr = textFallback(nameAr, name, "تصنيف جديد");
      const categoryName = textFallback(name, nameAr, `category-${Date.now().toString(36)}`);
      const categorySlug = textFallback(slug, `${slugFallback(categoryNameAr || categoryName, "category")}-${Date.now().toString(36)}`);
      const parentValue = numberId(parentId);
      try {
        const [row] = await db
          .insert(categoriesTable)
          .values({
            name: categoryName,
            nameAr: categoryNameAr,
            ...pickContentTranslations(catBody, false),
            slug: categorySlug,
            parentId: parentValue,
            sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
            isActive: isActive ?? true,
            imageUrl: await persistMediaValue(imageUrl ?? "", "categories"),
            imageMetadata: imageMetadata && typeof imageMetadata === "object" ? imageMetadata : {},
          })
          .returning();
        void logAdminActivity(req, "category_created", "category", row.id, { name: row.nameAr, parentId: row.parentId });
        clearStoreCategoriesCache();
        return json(formatCategory(row), 201);
      } catch (err: any) {
        if (err?.code === "23505") return error("السلاج مكرر", 409);
        throw err;
      }
    }
    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const current = await db.query.categoriesTable.findFirst({ where: eq(categoriesTable.id, id) }) as any;
      if (!current) return error("غير موجود", 404);
      const b = await body(req);
      const update: any = { updatedAt: new Date() };
      for (const k of ["name", "nameAr", "slug", "sortOrder", "isActive"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      Object.assign(update, pickContentTranslations(b, false));
      if (b?.parentId !== undefined) {
        const parentValue = numberId(b.parentId);
        update.parentId = parentValue && parentValue !== id ? parentValue : null;
      }
      if (b?.imageUrl !== undefined) {
        const ref = localMediaReference(b.imageUrl);
        update.imageUrl = ref?.kind === "category" && ref.id === id
          ? (current.imageUrl ?? current.image_url ?? null)
          : await persistMediaValue(b.imageUrl, "categories");
      }
      if (b?.imageMetadata !== undefined) update.imageMetadata = b.imageMetadata && typeof b.imageMetadata === "object" ? b.imageMetadata : {};
      if (update.name !== undefined && !String(update.name ?? "").trim()) delete update.name;
      if (update.nameAr !== undefined && !String(update.nameAr ?? "").trim()) delete update.nameAr;
      if (update.slug !== undefined && !String(update.slug ?? "").trim()) {
        update.slug = `${slugFallback(b?.nameAr ?? b?.name ?? current.nameAr ?? current.name, "category")}-${Date.now().toString(36)}`;
      }
      if (update.sortOrder !== undefined) update.sortOrder = Number.isFinite(Number(update.sortOrder)) ? Number(update.sortOrder) : 0;
      try {
        const [row] = await db.update(categoriesTable).set(update).where(eq(categoriesTable.id, id)).returning();
        if (!row) return error("غير موجود", 404);
        if (update.slug !== undefined && update.slug !== current.slug) {
          const legacyColumn = row.parentId ? productsTable.subcategory : productsTable.category;
          const idColumn = row.parentId ? productsTable.subcategoryId : productsTable.categoryId;
          await db.update(productsTable).set({ [row.parentId ? "subcategory" : "category"]: row.slug }).where(or(eq(idColumn, row.id), eq(legacyColumn, current.slug)));
        }
        void logAdminActivity(req, "category_updated", "category", row.id, { fields: Object.keys(update) });
        clearStoreCategoriesCache();
        return json(formatCategory(row));
      } catch (err: any) {
        if (err?.code === "23505") return error("السلاج مكرر", 409);
        throw err;
      }
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const current = await db.query.categoriesTable.findFirst({ where: eq(categoriesTable.id, id) }) as any;
      if (!current) return error("غير موجود", 404);
      const [children, productUsage] = await Promise.all([
        db.select({ c: sql<number>`count(*)::int` }).from(categoriesTable).where(eq(categoriesTable.parentId, id)),
        db
          .select({ c: sql<number>`count(*)::int` })
          .from(productsTable)
          .where(or(
            eq(productsTable.categoryId, id),
            eq(productsTable.subcategoryId, id),
            eq(productsTable.category, current.slug),
            eq(productsTable.subcategory, current.slug),
          )),
      ]);
      if ((children[0]?.c ?? 0) > 0 || (productUsage[0]?.c ?? 0) > 0) {
        await db.update(categoriesTable).set({ isActive: false, updatedAt: new Date() }).where(eq(categoriesTable.id, id));
        void logAdminActivity(req, "category_hidden", "category", id, { reason: "in_use" });
        clearStoreCategoriesCache();
        return json({ message: "تم إخفاء القسم لأنه مرتبط ببيانات موجودة" });
      }
      await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
      void logAdminActivity(req, "category_deleted", "category", id);
      clearStoreCategoriesCache();
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "products") {
    const auth = method === "GET"
      ? await requireAnyPermission(req, ["products", "invoices"])
      : await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    if (method === "GET") {
      await ensureAdminProductsColumns();
      const limitParam = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "500", 10) || 500, 2000);
      const search = (req.nextUrl.searchParams.get("search") ?? "").trim();
      const rows = await db.query.productsTable.findMany({
        where: search
          ? or(ilike(productsTable.nameAr, `%${search}%`), ilike(productsTable.name, `%${search}%`), ilike((productsTable as any).barcode, `%${search}%`))
          : undefined,
        orderBy: (p, { asc, desc: d }) => [asc(p.sortOrder), d(p.createdAt)],
        limit: limitParam,
      }) as any[];
      const hydrated = await hydrateSharedStockProducts(rows);
      const res = json(hydrated.map(p => ({
        id: p.id,
        name: p.name,
        nameAr: p.nameAr,
        price: String(p.price),
        costPrice: String(p.costPrice ?? p.cost_price ?? "0"),
        stock: String(productStockAmount(p)),
        ownStock: String(p.ownStock ?? p.stock ?? "0"),
        minStock: String(p.effectiveMinStock ?? p.minStock ?? p.min_stock ?? "0"),
        sharedStockProductId: p.sharedStockProductId ?? p.shared_stock_product_id ?? null,
        sharedStockProductName: p.sharedStockProductName ?? null,
        sharedStockLinkedProducts: Array.isArray(p.sharedStockLinkedProducts) ? p.sharedStockLinkedProducts : [],
        category: p.category ?? "",
        images: publicMediaList("product", p, p.images),
        videos: publicMediaList("product-video", p, p.videos),
        barcode: p.barcode ?? p.bar_code ?? "",
        isActive: p.isActive ?? p.is_active ?? true,
      })));
      res.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
      return res;
    }
    if (method === "PATCH" && parts[2]) {
      const auth2 = await requirePermission(req, "products");
      if (isResponse(auth2)) return auth2;
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = {};
      if (b?.barcode !== undefined) {
        const barcode = normalizeProductBarcode(b.barcode);
        if (barcode && await productBarcodeExists(barcode, id)) return error("الباركود مستخدم مسبقاً", 409);
        update.barcode = barcode || null;
      }
      if (b?.costPrice !== undefined) update.costPrice = String(money(b.costPrice));
      if (b?.minStock !== undefined) update.minStock = Number.isFinite(Number(b.minStock)) ? Number(b.minStock) : 0;
      if (!Object.keys(update).length) return error("لا يوجد ما يُحدَّث", 400);
      const [row] = await db.update(productsTable).set(update).where(eq(productsTable.id, id)).returning();
      if (!row) return error("غير موجود", 404);
      return json(row);
    }
  }

  if (section === "coupons") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
    await ensureCouponsTables();
    const id = parts[2] ? int(parts[2]) : null;

    if (method === "GET" && !id) {
      const search = req.nextUrl.searchParams.get("search")?.trim().toUpperCase();
      const rows = await db.query.couponsTable.findMany({
        where: search ? ilike(couponsTable.code, `%${search}%`) : undefined,
        orderBy: (coupon, { desc }) => [desc(coupon.createdAt)],
        limit: 300,
      });
      return json(rows.map(couponToJson));
    }

    if (method === "POST") {
      const b = await body(req);
      const code = normalizeCouponCode(b?.code);
      if (!code) return error("كود الكوبون مطلوب", 400);
      const type = normalizeCouponType(b?.type);
      const usageLimit = b?.usageLimit === "" || b?.usageLimit === null || b?.usageLimit === undefined
        ? null
        : Math.max(Number.parseInt(String(b.usageLimit), 10) || 0, 0);
      try {
        const [row] = await db.insert(couponsTable).values({
          code,
          title: String(b?.title ?? "").trim(),
          type,
          value: String(money(b?.value)),
          minOrderAmount: String(money(b?.minOrderAmount)),
          usageLimit: usageLimit && usageLimit > 0 ? usageLimit : null,
          expiresAt: b?.expiresAt ? new Date(b.expiresAt) : null,
          isActive: b?.isActive !== false,
        }).returning();
        void logAdminActivity(req, "coupon_created", "coupon", row.id, { code });
        return json(couponToJson(row), 201);
      } catch (err: any) {
        if (err?.code === "23505") return error("كود الكوبون مستخدم مسبقاً", 409);
        throw err;
      }
    }

    if ((method === "PATCH" || method === "PUT") && id) {
      const b = await body(req);
      const update: any = { updatedAt: new Date() };
      if (b?.code !== undefined) {
        const code = normalizeCouponCode(b.code);
        if (!code) return error("كود الكوبون مطلوب", 400);
        update.code = code;
      }
      if (b?.title !== undefined) update.title = String(b.title ?? "").trim();
      if (b?.type !== undefined) update.type = normalizeCouponType(b.type);
      if (b?.value !== undefined) update.value = String(money(b.value));
      if (b?.minOrderAmount !== undefined) update.minOrderAmount = String(money(b.minOrderAmount));
      if (b?.usageLimit !== undefined) {
        const n = Number.parseInt(String(b.usageLimit), 10);
        update.usageLimit = Number.isFinite(n) && n > 0 ? n : null;
      }
      if (b?.expiresAt !== undefined) update.expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
      if (b?.isActive !== undefined) update.isActive = !!b.isActive;
      const [row] = await db.update(couponsTable).set(update).where(eq(couponsTable.id, id)).returning();
      if (!row) return error("الكوبون غير موجود", 404);
      void logAdminActivity(req, "coupon_updated", "coupon", row.id, { fields: Object.keys(update) });
      return json(couponToJson(row));
    }

    if (method === "DELETE" && id) {
      const [row] = await db.update(couponsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(couponsTable.id, id))
        .returning();
      if (!row) return error("الكوبون غير موجود", 404);
      void logAdminActivity(req, "coupon_disabled", "coupon", id);
      return json({ message: "تم تعطيل الكوبون" });
    }
  }

  if (section === "inventory-alerts" && method === "GET") {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    await ensureAdminProductsColumns();
    const rows = await db.query.productsTable.findMany({
      where: sql`((coalesce((select stock from products root where root.id = ${productsTable.sharedStockProductId}), "stock") <= coalesce((select min_stock from products root where root.id = ${productsTable.sharedStockProductId}), "min_stock") and coalesce((select min_stock from products root where root.id = ${productsTable.sharedStockProductId}), "min_stock") > 0) or coalesce((select stock from products root where root.id = ${productsTable.sharedStockProductId}), "stock") <= 0)`,
      orderBy: (product, { asc }) => [asc(product.stock), asc(product.nameAr)],
      limit: 500,
    }) as any[];
    const hydrated = await hydrateSharedStockProducts(rows);
    const mapped = hydrated.map((product) => ({
      id: product.id,
      name: product.name,
      nameAr: product.nameAr,
      stock: productStockAmount(product),
      minStock: Number(product.effectiveMinStock ?? product.minStock ?? product.min_stock ?? 0),
      barcode: product.barcode ?? "",
      category: product.category ?? "",
      images: publicMediaList("product", product, product.images),
    }));
    if (req.nextUrl.searchParams.get("count") === "1") {
      return json({ count: mapped.length });
    }
    return json({ data: mapped, count: mapped.length, emailEnabled: Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST) });
  }

  if (section === "inventory-value" && method === "GET") {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    await ensureAdminProductsColumns();
    await ensureStoreCategoryColumns();

    const search = (req.nextUrl.searchParams.get("search") ?? "").trim();
    const category = (req.nextUrl.searchParams.get("category") ?? "").trim();
    const searchLike = `%${search}%`;
    const categoryLike = `%${category}%`;
    const isUncategorized = category === "uncategorized";

    try {
      const inventoryResult = await db.execute(sql`
        WITH grouped_products AS (
          SELECT
            COALESCE(p.shared_stock_product_id, p.id) AS stock_source_id,
            COUNT(*)::int AS linked_count,
            STRING_AGG(COALESCE(NULLIF(p.name_ar, ''), NULLIF(p.name, ''), 'منتج'), '، ' ORDER BY p.id) AS linked_product_names,
            STRING_AGG(COALESCE(p.barcode, ''), ' ' ORDER BY p.id) AS linked_barcodes,
            STRING_AGG(COALESCE(c.name_ar, c.name, p.category, ''), '، ' ORDER BY p.id) AS linked_categories
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          GROUP BY COALESCE(p.shared_stock_product_id, p.id)
        )
        SELECT
          src.id,
          COALESCE(NULLIF(src.name_ar, ''), NULLIF(src.name, ''), 'منتج') AS product_name,
          COALESCE(cat.name_ar, cat.name, NULLIF(src.category, ''), 'بدون تصنيف') AS category_name,
          COALESCE(src.stock, 0)::int AS stock,
          COALESCE(src.cost_price, 0)::text AS wholesale_price,
          COALESCE(src.price, 0)::text AS sale_price,
          (COALESCE(src.cost_price, 0) * COALESCE(src.stock, 0))::text AS wholesale_value,
          (COALESCE(src.price, 0) * COALESCE(src.stock, 0))::text AS sale_value,
          ((COALESCE(src.price, 0) - COALESCE(src.cost_price, 0)) * COALESCE(src.stock, 0))::text AS expected_profit,
          COALESCE(g.linked_count, 1)::int AS linked_count,
          COALESCE(g.linked_product_names, '') AS linked_product_names
        FROM grouped_products g
        JOIN products src ON src.id = g.stock_source_id
        LEFT JOIN categories cat ON cat.id = src.category_id
        WHERE (
          ${search} = ''
          OR COALESCE(NULLIF(src.name_ar, ''), NULLIF(src.name, ''), '') ILIKE ${searchLike}
          OR COALESCE(src.barcode, '') ILIKE ${searchLike}
          OR COALESCE(g.linked_product_names, '') ILIKE ${searchLike}
          OR COALESCE(g.linked_barcodes, '') ILIKE ${searchLike}
        )
        AND (
          ${category} = ''
          OR (${isUncategorized} = true AND src.category_id IS NULL AND COALESCE(NULLIF(src.category, ''), '') = '')
          OR COALESCE(src.category_id::text, '') = ${category}
          OR COALESCE(src.category, '') = ${category}
          OR COALESCE(cat.slug, '') = ${category}
          OR COALESCE(cat.name_ar, cat.name, src.category, '') ILIKE ${categoryLike}
          OR COALESCE(g.linked_categories, '') ILIKE ${categoryLike}
        )
        ORDER BY COALESCE(cat.name_ar, cat.name, src.category, 'بدون تصنيف') ASC,
                 COALESCE(NULLIF(src.name_ar, ''), NULLIF(src.name, ''), 'منتج') ASC
      `);

      const categoryResult = await db.execute(sql`
        SELECT DISTINCT
          COALESCE(c.id::text, NULLIF(p.category, ''), 'uncategorized') AS value,
          COALESCE(c.name_ar, c.name, NULLIF(p.category, ''), 'بدون تصنيف') AS label
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        ORDER BY label ASC
      `);

      type InventoryValueApiRow = {
        id: number;
        productName: string;
        categoryName: string;
        stock: number;
        wholesalePrice: number;
        salePrice: number;
        wholesaleValue: number;
        saleValue: number;
        expectedProfit: number;
        linkedCount: number;
        linkedProductNames: string;
      };

      type InventoryValueApiTotals = {
        productCount: number;
        totalQuantity: number;
        totalWholesaleValue: number;
        totalSaleValue: number;
        expectedProfit: number;
      };

      const rows: InventoryValueApiRow[] = ((inventoryResult as any).rows ?? []).map((row: any) => {
        const stock = Number(row.stock ?? 0);
        const wholesalePrice = Number(row.wholesale_price ?? 0);
        const salePrice = Number(row.sale_price ?? 0);
        const wholesaleValue = Number(row.wholesale_value ?? wholesalePrice * stock);
        const saleValue = Number(row.sale_value ?? salePrice * stock);
        return {
          id: Number(row.id),
          productName: String(row.product_name ?? "منتج"),
          categoryName: String(row.category_name ?? "بدون تصنيف"),
          stock,
          wholesalePrice,
          salePrice,
          wholesaleValue,
          saleValue,
          expectedProfit: Number(row.expected_profit ?? saleValue - wholesaleValue),
          linkedCount: Number(row.linked_count ?? 1),
          linkedProductNames: String(row.linked_product_names ?? ""),
        };
      });

      const totals = rows.reduce<InventoryValueApiTotals>((acc, row) => {
        acc.productCount += 1;
        acc.totalQuantity += row.stock;
        acc.totalWholesaleValue += row.wholesaleValue;
        acc.totalSaleValue += row.saleValue;
        return acc;
      }, {
        productCount: 0,
        totalQuantity: 0,
        totalWholesaleValue: 0,
        totalSaleValue: 0,
        expectedProfit: 0,
      });
      totals.expectedProfit = totals.totalSaleValue - totals.totalWholesaleValue;

      const categoryOptions = ((categoryResult as any).rows ?? [])
        .map((row: any) => ({
          value: String(row.value ?? "uncategorized"),
          label: String(row.label ?? "بدون تصنيف"),
        }))
        .filter((row: { value: string; label: string }, index: number, list: { value: string; label: string }[]) =>
          row.value && list.findIndex((item) => item.value === row.value) === index
        );

      void logAdminActivity(req, "inventory_value_report_viewed", "report", undefined, { search, category });
      return json({ rows, totals, categories: categoryOptions });
    } catch (err) {
      console.error("Inventory value report failed", err instanceof Error ? err.message : err);
      return error("تعذر تحميل تقرير قيمة المخزون", 500);
    }
  }

  if (section === "loyalty") {
    const auth = await requirePermission(req, "customers");
    if (isResponse(auth)) return auth;
    await ensureCustomerRewards();

    if (method === "GET") {
      const [settings, customers, history] = await Promise.all([
        getLoyaltySettings(),
        db.query.customersTable.findMany({
          orderBy: (customer, { desc }) => [desc(customer.rewardPoints), desc(customer.id)],
          limit: 300,
        }),
        db.query.customerRewardHistoryTable.findMany({
          orderBy: [desc(customerRewardHistoryTable.createdAt)],
          limit: 80,
        }),
      ]);
      return json({
        settings,
        customers: customers.map((customer) => ({
          id: customer.id,
          name: customer.fullName || customer.name || formatIraqiPhone(customer.phone),
          phone: customer.phone,
          rewardPoints: Number(customer.rewardPoints ?? 0),
          rewardLevel: customer.rewardLevel ?? rewardLevelForPoints(Number(customer.rewardPoints ?? 0)),
          rewardLevelLabel: rewardLabel(customer.rewardLevel),
        })),
        history: history.map((row) => ({
          id: row.id,
          customerId: row.customerId,
          points: row.points,
          reason: row.reason,
          note: row.note ?? "",
          createdAt: row.createdAt.toISOString(),
        })),
      });
    }

    if (method === "PATCH") {
      const b = await body(req);
      const settings = await saveLoyaltySettings({
        enabled: b?.enabled !== false,
        amountPerPoint: Number(b?.amountPerPoint),
        pointsPerUnit: Number(b?.pointsPerUnit),
        redeemValue: Number(b?.redeemValue),
      });
      void logAdminActivity(req, "loyalty_settings_updated", "settings", undefined, settings as any);
      return json(settings);
    }

    if (method === "POST" && parts[2] === "adjust") {
      const b = await body(req);
      const customerId = Number.parseInt(String(b?.customerId ?? ""), 10);
      const points = Number.parseInt(String(b?.pointsDelta ?? b?.points ?? "0"), 10);
      if (!Number.isFinite(customerId) || customerId <= 0) return error("اختر الزبون", 400);
      if (!Number.isFinite(points) || points === 0) return error("أدخل عدد نقاط صحيح", 400);
      const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, customerId) });
      if (!customer) return error("الزبون غير موجود", 404);
      const updated = await addCustomerReward(customerId, points, {
        reason: "loyalty_admin_adjustment",
        note: String(b?.note ?? "تعديل من نظام الولاء").trim().slice(0, 240),
      });
      void logAdminActivity(req, "loyalty_points_adjusted", "customer", customerId, { points });
      return json({
        rewardPoints: Number(updated?.rewardPoints ?? customer.rewardPoints ?? 0),
        rewardLevel: updated?.rewardLevel ?? rewardLevelForPoints(Number(updated?.rewardPoints ?? customer.rewardPoints ?? 0)),
        rewardLevelLabel: rewardLabel(updated?.rewardLevel),
      });
    }
  }

  if (section === "settings") {
    const auth = await requirePermission(req, "settings");
    if (isResponse(auth)) return auth;
    if (parts[2] === "printer") {
      if (method === "GET") return json(await getPrinterSettings());
      if (method === "PATCH" || method === "PUT") {
        const settings = await savePrinterSettings(await body(req));
        void logAdminActivity(req, "printer_settings_updated", "settings", undefined, settings as any);
        return json(settings);
      }
    }
    if (method === "GET") {
      return json(await loadSiteSettings());
    }
    if (method === "POST" && parts[2] === "logo") {
      const data = await body(req);
      const logoUrl = await persistMediaValue(data?.logoUrl ?? data?.url ?? "", "settings/logo");
      const logoMetadata = data?.logoMetadata && typeof data.logoMetadata === "object" ? data.logoMetadata : {};
      if (!logoUrl) return error("رابط الشعار غير صالح", 400);
      await Promise.all([
        db
          .insert(settingsTable)
          .values({ key: "logoUrl", value: logoUrl as any })
          .onConflictDoUpdate({ target: settingsTable.key, set: { value: logoUrl as any, updatedAt: new Date() } }),
        db
          .insert(settingsTable)
          .values({ key: "logoMetadata", value: logoMetadata as any })
          .onConflictDoUpdate({ target: settingsTable.key, set: { value: logoMetadata as any, updatedAt: new Date() } }),
      ]);
      revalidateTag(PUBLIC_SETTINGS_TAG, { expire: 0 });
      void logAdminActivity(req, "site_logo_updated", "settings");
      return json({ logoUrl, logo_url: logoUrl, logoMetadata });
    }
    if (method === "PUT" || method === "PATCH") {
      const entries = Object.entries(await body(req));
      await Promise.all(
        entries.map(async ([key, value]) => {
          const storedValue = key === "logoUrl"
            ? await persistMediaValue(value, "settings/logo")
            : key === "mapUrl"
              ? cleanPublicUrl(value)
              : value;
          await db
            .insert(settingsTable)
            .values({ key, value: storedValue as any })
            .onConflictDoUpdate({ target: settingsTable.key, set: { value: storedValue as any, updatedAt: new Date() } });
        }),
      );
      revalidateTag(PUBLIC_SETTINGS_TAG, { expire: 0 });
      void logAdminActivity(req, "site_settings_updated", "settings", undefined, { fields: entries.map(([key]) => key) });
      return json({ message: "تم الحفظ" });
    }
  }

  if (section === "staff") {
    const auth = await requirePermission(req, "staff");
    if (isResponse(auth)) return auth;
    await ensureStaffTableShape();
    if (method === "GET") {
      const rows = await db.query.staffTable.findMany({ orderBy: (s, { asc }) => [asc(s.id)] });
      return json(rows.map(formatStaff));
    }
    if (method === "POST") {
      const payload = await body(req);
      const username = staffUsername(payload?.username);
      const password = String(payload?.password ?? "");
      if (!username) return error("اسم المستخدم مطلوب", 400);
      if (!password.trim()) return error("كلمة المرور مطلوبة", 400);
      if (username.length > 50) return error("اسم المستخدم طويل جداً", 400);
      const cleanPassword = password.trim();
      const normalizedRole = normalizeStaffRole(payload?.role);
      const explicitPermissions = validateStaffPermissions(payload?.permissions);
      if (payload?.permissions !== undefined && explicitPermissions === null) return error("صلاحيات غير صحيحة", 400);
      try {
        const duplicate = await db.query.staffTable.findFirst({
          where: sql`lower(${staffTable.username}) = ${username.toLowerCase()}`,
        });
        if (duplicate) return error("اسم المستخدم مستخدم مسبقاً", 409);
        const [row] = await db
          .insert(staffTable)
          .values({
            username,
            passwordHash: hashPassword(cleanPassword),
            fullName: String(payload?.fullName ?? ""),
            role: normalizedRole,
            permissions: permissionsForRole(normalizedRole, explicitPermissions ?? payload?.permissions),
            isActive: payload?.isActive === false ? false : true,
          })
          .returning();
        void logAdminActivity(req, "staff_created", "staff", row.id, { username, role: normalizedRole });
        return json(formatStaff(row), 201);
      } catch (err: any) {
        logStaffApiFailure("create", err, { username, role: normalizedRole });
        if (isUniqueViolation(err, "username")) return error("اسم المستخدم مستخدم مسبقاً", 409);
        return error("فشل الاتصال بالخادم أثناء حفظ الموظف", 500);
      }
    }
    if ((method === "PATCH" || method === "DELETE") && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const existing = await db.query.staffTable.findFirst({ where: eq(staffTable.id, id) });
      if (!existing) return error("غير موجود", 404);
      if (method === "DELETE") {
        if (existing.role === "admin") return error("لا يمكن حذف المدير الرئيسي", 403);
        try {
          await db.delete(staffTable).where(eq(staffTable.id, id));
          void logAdminActivity(req, "staff_deleted", "staff", id, { username: existing.username });
          return json({ message: "تم الحذف" });
        } catch (err) {
          logStaffApiFailure("delete", err, { id });
          return error("فشل الاتصال بالخادم أثناء حذف الموظف", 500);
        }
      }
      const b = await body(req);
      const update: any = {};
      if (b?.fullName !== undefined) update.fullName = String(b.fullName ?? "");
      if (b?.isActive !== undefined) update.isActive = b.isActive === true;
      if (b?.username !== undefined) {
        const nextUsername = staffUsername(b.username);
        if (!nextUsername) return error("اسم المستخدم مطلوب", 400);
        if (nextUsername.length > 50) return error("اسم المستخدم طويل جداً", 400);
        const duplicate = await db.query.staffTable.findFirst({
          where: and(sql`lower(${staffTable.username}) = ${nextUsername.toLowerCase()}`, sql`${staffTable.id} <> ${id}`),
        });
        if (duplicate) return error("اسم المستخدم مستخدم مسبقاً", 409);
        update.username = nextUsername;
      }
      if (existing.role !== "admin") {
        const nextRole = b?.role !== undefined ? normalizeStaffRole(b.role) : existing.role;
        if (b?.role !== undefined) update.role = nextRole;
        if (b?.permissions !== undefined || b?.role !== undefined) {
          const explicitPermissions = validateStaffPermissions(b?.permissions);
          if (b?.permissions !== undefined && explicitPermissions === null) return error("صلاحيات غير صحيحة", 400);
          update.permissions = permissionsForRole(nextRole, explicitPermissions ?? b?.permissions);
        }
      }
      if (existing.role === "admin") {
        delete update.isActive;
        delete update.permissions;
      }
      const nextPassword = String(b?.password ?? "").trim();
      if (nextPassword) update.passwordHash = hashPassword(nextPassword);
      try {
        const [row] = await db.update(staffTable).set(update).where(eq(staffTable.id, id)).returning();
        void logAdminActivity(req, "staff_updated", "staff", id, { fields: Object.keys(update) });
        return json(formatStaff(row));
      } catch (err: any) {
        logStaffApiFailure("update", err, { id });
        if (isUniqueViolation(err, "username")) return error("اسم المستخدم مستخدم مسبقاً", 409);
        return error("فشل الاتصال بالخادم أثناء حفظ الموظف", 500);
      }
    }
  }

  if (section === "crews") {
    const auth = await requirePermission(req, "staff");
    if (isResponse(auth)) return auth;
    await ensureCrewsTable();
    if (method === "GET") {
      const rows = await db.query.crewsTable.findMany({
        orderBy: (c, { desc }) => [desc(c.id)],
      });
      return json(rows.map(formatCrew));
    }
    if (method === "POST") {
      const b = await body(req);
      const name = textFallback(b?.name, `كادر ${Date.now().toString(36)}`);
      const [row] = await db
        .insert(crewsTable)
        .values({
          name,
          isActive: b?.isActive ?? true,
          status: normalizeCrewStatus(b?.status, b?.isActive ?? true),
          internalNotes: typeof b?.internalNotes === "string" ? b.internalNotes.slice(0, 500) : null,
        })
        .returning();
      return json(formatCrew(row), 201);
    }
    if ((method === "PATCH" || method === "DELETE") && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const existing = await db.query.crewsTable.findFirst({ where: eq(crewsTable.id, id) });
      if (!existing) return error("غير موجود", 404);
      if (method === "DELETE") {
        await db.delete(crewsTable).where(eq(crewsTable.id, id));
        return json({ message: "تم الحذف" });
      }
      const b = await body(req);
      const update: any = { updatedAt: new Date() };
      if (b?.name !== undefined) {
        const name = typeof b.name === "string" ? b.name.trim() : "";
        if (name) update.name = name;
      }
      if (b?.isActive !== undefined) update.isActive = Boolean(b.isActive);
      if (b?.status !== undefined || b?.isActive !== undefined) update.status = normalizeCrewStatus(b?.status ?? existing.status, b?.isActive ?? update.isActive ?? existing.isActive);
      if (b?.internalNotes !== undefined) update.internalNotes = String(b.internalNotes ?? "").slice(0, 500);
      const [row] = await db.update(crewsTable).set(update).where(eq(crewsTable.id, id)).returning();
      return json(formatCrew(row));
    }
  }

  if (section === "archive") {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;
    await ensureArchiveColumns();

    if (method === "GET") {
      const params = req.nextUrl.searchParams;
      const archiveType = params.get("type") ?? "all";
      const status = params.get("status")?.trim();
      const q = params.get("q")?.trim().toLowerCase() ?? "";
      const qDigits = normalizePhoneDigits(q);
      const includeProducts = archiveType === "all" || archiveType === "products";
      const includeServices = archiveType === "all" || archiveType === "services";
      const [productRows, serviceRows, services] = await Promise.all([
        includeProducts
          ? db.query.ordersTable.findMany({
              where: and(sql`${ordersTable.archivedAt} is not null`, status ? eq(ordersTable.status, status) : undefined),
              orderBy: [desc(ordersTable.archivedAt), desc(ordersTable.createdAt)],
              limit: 500,
            })
          : Promise.resolve([]),
        includeServices
          ? db.query.serviceOrdersTable.findMany({
              where: and(sql`${serviceOrdersTable.archivedAt} is not null`, status ? eq(serviceOrdersTable.status, status) : undefined),
              orderBy: [desc(serviceOrdersTable.archivedAt), desc(serviceOrdersTable.createdAt)],
              limit: 500,
            })
          : Promise.resolve([]),
        db.query.servicesTable.findMany(),
      ]);
      const serviceMap = new Map(services.map((s) => [s.id, s]));
      const rows = [
        ...productRows.map((order) => ({
          id: order.id,
          kind: "product" as const,
          trackingCode: order.trackingCode,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          serviceName: "طلب متجر",
          serviceType: "product",
          status: order.status,
          total: Number.parseFloat(order.total ?? "0"),
          depositAmount: Number.parseFloat(order.depositAmount ?? "0"),
          remainingAmount: Number.parseFloat(order.remainingAmount ?? "0"),
          paymentStatus: order.paymentStatus ?? "unpaid",
          governorate: order.governorate ?? null,
          archivedAt: order.archivedAt?.toISOString?.() ?? null,
          createdAt: order.createdAt.toISOString(),
        })),
        ...serviceRows.map((order) => {
          const service = serviceMap.get(order.serviceId);
          return {
            id: order.id,
            kind: "service" as const,
            trackingCode: order.trackingCode,
            customerName: order.customerName,
            customerPhone: order.phone,
            serviceName: service?.nameAr ?? service?.name ?? "حجز خدمة",
            serviceType: service?.type ?? null,
            status: order.status,
            total: Number.parseFloat(order.totalAmount ?? "0"),
            depositAmount: Number.parseFloat(order.depositAmount ?? "0"),
            remainingAmount: Number.parseFloat(order.remainingAmount ?? "0"),
            paymentStatus: order.paymentStatus ?? "unpaid",
            governorate: String((order.customFields as any)?.governorate ?? order.eventLocation ?? "") || null,
            archivedAt: order.archivedAt?.toISOString?.() ?? null,
            createdAt: order.createdAt.toISOString(),
          };
        }),
      ]
        .filter((row) => {
          if (!q) return true;
          return (
            String(row.trackingCode ?? "").toLowerCase().includes(q) ||
            row.customerName.toLowerCase().includes(q) ||
            row.customerPhone.includes(qDigits || q) ||
            formatIraqiPhone(row.customerPhone).includes(qDigits || q) ||
            row.serviceName.toLowerCase().includes(q) ||
            String(row.governorate ?? "").toLowerCase().includes(q)
          );
        })
        .sort((a, b) => String(b.archivedAt ?? b.createdAt).localeCompare(String(a.archivedAt ?? a.createdAt)));
      return json(rows);
    }

    if (method === "PATCH" && parts[2] && parts[3]) {
      const kind = parts[2];
      const id = int(parts[3]);
      if (!id) return error("معرف غير صحيح", 400);
      if (kind === "orders") {
        const [row] = await db
          .update(ordersTable)
          .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(ordersTable.id, id))
        .returning();
        if (!row) return error("غير موجود", 404);
        void logAdminActivity(req, "order_restored", "order", id, { tracking: row.trackingCode });
        return json({ message: "تم استرجاع الطلب" });
      }
      if (kind === "service-orders") {
        const [row] = await db
          .update(serviceOrdersTable)
          .set({ archivedAt: null })
        .where(eq(serviceOrdersTable.id, id))
        .returning();
        if (!row) return error("غير موجود", 404);
        void logAdminActivity(req, "booking_restored", "service_order", id, { tracking: row.trackingCode });
        return json({ message: "تم استرجاع الحجز" });
      }
      return error("نوع الأرشيف غير صحيح", 400);
    }
  }

  if (section === "customers") {
    const auth = await requirePermission(req, "customers");
    if (isResponse(auth)) return auth;
    await Promise.all([ensureCustomerAddressTables(), ensureAdminExtensionsTables(), ensureCustomerRewards()]);
    if (method === "GET" && !parts[2]) {
      const search = req.nextUrl.searchParams.get("search")?.trim();
      const customers = await db.query.customersTable.findMany({
        orderBy: (c, { desc }) => [desc(c.id)],
      });
      const orderCounts = await db
        .select({ phone: ordersTable.customerPhone, count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(total::numeric),0)::float` })
        .from(ordersTable)
        .groupBy(ordersTable.customerPhone);
      const phoneMap = new Map<string, { count: number; total: number }>();
      for (const o of orderCounts) {
        const key = normalizeIraqiPhone(o.phone) ?? o.phone;
        const prev = phoneMap.get(key) ?? { count: 0, total: 0 };
        phoneMap.set(key, { count: prev.count + o.count, total: prev.total + o.total });
      }
      let result = customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        role: c.role,
        rewardPoints: Number(c.rewardPoints ?? 0),
        rewardLevel: c.rewardLevel ?? rewardLevelForPoints(Number(c.rewardPoints ?? 0)),
        rewardLevelLabel: rewardLabel(c.rewardLevel),
        createdAt: c.createdAt.toISOString(),
        orderCount: phoneMap.get(normalizeIraqiPhone(c.phone) ?? c.phone)?.count ?? 0,
        totalSpent: phoneMap.get(normalizeIraqiPhone(c.phone) ?? c.phone)?.total ?? 0,
      }));
      if (search) {
        const s = search.toLowerCase();
        const phoneSearch = normalizePhoneDigits(search);
        result = result.filter((c) =>
          c.name.toLowerCase().includes(s) ||
          c.phone.includes(phoneSearch || search) ||
          formatIraqiPhone(c.phone).includes(phoneSearch || search)
        );
      }
      return json(result);
    }
    if (method === "GET" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, id) });
      if (!customer) return error("غير موجود", 404);
      const phoneVariants = iraqiPhoneVariants(customer.phone);
      const [orders, serviceOrders, activity, addresses, rewardHistory, notes, whatsappLogs, messageThreads, invoices] = await Promise.all([
        db.query.ordersTable.findMany({
          where: inArray(ordersTable.customerPhone, phoneVariants),
          orderBy: [desc(ordersTable.createdAt)],
        }),
        db.query.serviceOrdersTable.findMany({
          where: inArray(serviceOrdersTable.phone, phoneVariants),
          orderBy: [desc(serviceOrdersTable.createdAt)],
        }),
        db.query.customerActivityLogsTable.findMany({
          where: or(eq(customerActivityLogsTable.customerId, id), inArray(customerActivityLogsTable.phone, phoneVariants)),
          orderBy: [desc(customerActivityLogsTable.createdAt)],
          limit: 20,
        }),
        db.query.customerAddressesTable.findMany({
          where: eq(customerAddressesTable.customerId, id),
          orderBy: [desc(customerAddressesTable.isDefault), desc(customerAddressesTable.updatedAt)],
          limit: 8,
        }),
        db.query.customerRewardHistoryTable.findMany({
          where: eq(customerRewardHistoryTable.customerId, id),
          orderBy: [desc(customerRewardHistoryTable.createdAt)],
          limit: 12,
        }),
        db.query.customerNotesTable.findMany({
          where: eq(customerNotesTable.customerId, id),
          orderBy: [desc(customerNotesTable.createdAt)],
          limit: 20,
        }),
        db.query.whatsappLogTable.findMany({
          where: inArray(whatsappLogTable.phone, phoneVariants),
          orderBy: [desc(whatsappLogTable.sentAt)],
          limit: 10,
        }),
        db.query.messageThreadsTable.findMany({
          where: or(eq(messageThreadsTable.customerId, id), inArray(messageThreadsTable.phone, phoneVariants)),
          orderBy: [desc(messageThreadsTable.lastMessageAt), desc(messageThreadsTable.id)],
          limit: 8,
        }),
        db.query.salesInvoicesTable.findMany({
          where: or(eq(salesInvoicesTable.customerId, id), inArray(salesInvoicesTable.customerPhone, phoneVariants)),
          orderBy: [desc(salesInvoicesTable.createdAt)],
          limit: 20,
        }),
      ]);
      const productTotal = orders.reduce((sum, row) => sum + money(row.total), 0);
      const serviceTotal = serviceOrders.reduce((sum, row) => sum + money(row.totalAmount), 0);
      const invoiceTotal = invoices.reduce((sum, row) => sum + money(row.total), 0);
      const remainingTotal =
        orders.reduce((sum, row) => sum + money(row.remainingAmount), 0) +
        serviceOrders.reduce((sum, row) => sum + money(row.remainingAmount), 0) +
        invoices.reduce((sum, row) => sum + money(row.remainingAmount), 0);
      const unpaidCount =
        orders.filter((row) => row.paymentStatus !== "paid" && money(row.remainingAmount) > 0).length +
        serviceOrders.filter((row) => row.paymentStatus !== "paid" && money(row.remainingAmount) > 0).length +
        invoices.filter((row) => row.paymentStatus !== "paid" && money(row.remainingAmount) > 0).length;
      return json({
        id: customer.id,
        name: customer.name,
        fullName: customer.fullName ?? customer.name,
        email: customer.email ?? "",
        avatarUrl: publicMediaValue("customer-avatar", customer, customer.avatarUrl),
        address: customer.address ?? "",
        city: customer.city ?? "",
        phone: customer.phone,
        role: customer.role,
        rewardPoints: Number(customer.rewardPoints ?? 0),
        rewardLevel: customer.rewardLevel ?? rewardLevelForPoints(Number(customer.rewardPoints ?? 0)),
        rewardLevelLabel: rewardLabel(customer.rewardLevel),
        createdAt: customer.createdAt.toISOString(),
        summary: {
          productOrders: orders.length,
          serviceOrders: serviceOrders.length,
          invoices: invoices.length,
          totalSpent: productTotal + serviceTotal + invoiceTotal,
          remainingTotal,
          unpaidCount,
          lastWhatsappAt: whatsappLogs[0]?.sentAt?.toISOString?.() ?? null,
          lastActivityAt: activity[0]?.createdAt?.toISOString?.() ?? null,
        },
        orders: orders.map((o) => ({
          id: o.id,
          trackingCode: o.trackingCode,
          status: o.status,
          total: Number.parseFloat(o.total),
          remainingAmount: Number.parseFloat(o.remainingAmount ?? "0"),
          paymentStatus: o.paymentStatus ?? "unpaid",
          createdAt: o.createdAt.toISOString(),
        })),
        serviceOrders: serviceOrders.map((s) => ({
          id: s.id,
          trackingCode: s.trackingCode,
          status: s.status,
          total: Number.parseFloat(s.totalAmount ?? "0"),
          remainingAmount: Number.parseFloat(s.remainingAmount ?? "0"),
          paymentStatus: s.paymentStatus ?? "unpaid",
          eventDate: s.eventDate ?? null,
          eventLocation: s.eventLocation ?? null,
          createdAt: s.createdAt.toISOString(),
        })),
        invoices: invoices.map((invoice) => ({
          id: invoice.id,
          invoiceNo: invoice.invoiceNo,
          total: Number.parseFloat(invoice.total ?? "0"),
          paidAmount: Number.parseFloat(invoice.paidAmount ?? "0"),
          remainingAmount: Number.parseFloat(invoice.remainingAmount ?? "0"),
          paymentStatus: invoice.paymentStatus,
          createdAt: invoice.createdAt.toISOString(),
        })),
        addresses: addresses.map(formatAddress),
        rewardHistory: rewardHistory.map((row) => ({
          id: row.id,
          points: row.points,
          reason: row.reason,
          note: row.note ?? "",
          createdAt: row.createdAt.toISOString(),
        })),
        notes: notes.map((row) => ({
          id: row.id,
          body: row.body,
          priority: row.priority,
          createdAt: row.createdAt.toISOString(),
        })),
        whatsappLogs: whatsappLogs.map((row) => ({
          id: row.id,
          event: row.event,
          status: row.status,
          provider: row.provider ?? "",
          sentAt: row.sentAt.toISOString(),
        })),
        messageThreads: messageThreads.map((row) => ({
          id: row.id,
          subject: row.subject,
          status: row.status,
          lastMessageAt: row.lastMessageAt?.toISOString?.() ?? null,
        })),
        activity: activity.map((row) => ({
          id: row.id,
          action: row.action,
          entityLabel: row.entityLabel ?? "",
          entityType: row.entityType ?? "",
          createdAt: row.createdAt.toISOString(),
        })),
      });
    }
    if (method === "POST" && parts[2] && parts[3] === "notes") {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, id) });
      if (!customer) return error("غير موجود", 404);
      const data = await body(req);
      const noteBody = String(data?.body ?? data?.note ?? "").trim().slice(0, 1200);
      if (!noteBody) return error("اكتب الملاحظة أولاً", 400);
      const priority = ["normal", "important", "urgent"].includes(String(data?.priority)) ? String(data.priority) : "normal";
      const [row] = await db
        .insert(customerNotesTable)
        .values({ customerId: id, staffId: auth.id, body: noteBody, priority })
        .returning();
      void logAdminActivity(req, "customer_note_created", "customer", id, { priority });
      return json({ id: row.id, body: row.body, priority: row.priority, createdAt: row.createdAt.toISOString() }, 201);
    }
    if (method === "DELETE" && parts[2] && parts[3] === "notes" && parts[4]) {
      const id = int(parts[2]);
      const noteId = int(parts[4]);
      if (!id || !noteId) return error("معرف غير صحيح", 400);
      await db.delete(customerNotesTable).where(and(eq(customerNotesTable.id, noteId), eq(customerNotesTable.customerId, id)));
      void logAdminActivity(req, "customer_note_deleted", "customer", id, { noteId });
      return json({ message: "تم حذف الملاحظة" });
    }
    if (method === "PATCH" && parts[2] && parts[3] === "rewards") {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const data = await body(req);
      const points = Number.parseInt(String(data?.pointsDelta ?? data?.points ?? "0"), 10);
      const note = String(data?.note ?? "تعديل من الإدارة").trim().slice(0, 240);
      if (!Number.isFinite(points) || points === 0) return error("أدخل عدد نقاط صحيح", 400);
      const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, id) });
      if (!customer) return error("غير موجود", 404);
      const updated = await addCustomerReward(customer.id, points, {
        reason: "admin_adjustment",
        note,
      });
      void logAdminActivity(req, "customer_rewards_adjusted", "customer", id, { points });
      return json({
        rewardPoints: Number(updated?.rewardPoints ?? customer.rewardPoints ?? 0),
        rewardLevel: updated?.rewardLevel ?? rewardLevelForPoints(Number(updated?.rewardPoints ?? customer.rewardPoints ?? 0)),
        rewardLevelLabel: rewardLabel(updated?.rewardLevel),
      });
    }
  }

  if (section === "service-orders") {
    const auth = await requirePermission(req, "bookings");
    if (isResponse(auth)) return auth;

    if (method === "GET" && !parts[2]) {
      const limit = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "120", 10) || 120, 1), 250);
      const offset = Math.max(Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0, 0);
      const rows = await db.query.serviceOrdersTable.findMany({
        where: sql`${serviceOrdersTable.archivedAt} is null`,
        orderBy: [desc(serviceOrdersTable.createdAt)],
        limit,
        offset,
      });
      const services = await db.query.servicesTable.findMany();
      const sMap = new Map(services.map((s) => [s.id, s]));
      const sorted = [...rows].sort((a, b) => {
        const ar = a.status === "reschedule_pending" ? 0 : 1;
        const br = b.status === "reschedule_pending" ? 0 : 1;
        if (ar !== br) return ar - br;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      return json(
        sorted.map((r) => ({
          id: r.id,
          trackingCode: r.trackingCode,
          serviceId: r.serviceId,
          serviceName: sMap.get(r.serviceId)?.nameAr ?? "",
          serviceType: sMap.get(r.serviceId)?.type ?? null,
          customerName: r.customerName,
          phone: r.phone,
          eventDate: r.eventDate,
          eventLocation: r.eventLocation,
          notes: r.notes,
          internalNotes: r.internalNotes ?? null,
          totalAmount: Number.parseFloat(r.totalAmount ?? "0"),
          depositAmount: Number.parseFloat(r.depositAmount ?? "0"),
          remainingAmount: Number.parseFloat(r.remainingAmount ?? "0"),
          paymentStatus: r.paymentStatus ?? "unpaid",
          customFields: r.customFields ?? {},
          status: r.status,
          customerConfirmation: r.customerConfirmation ?? null,
          requestedDate: r.requestedDate ?? null,
          confirmationNote: r.confirmationNote ?? null,
          confirmationAt: r.confirmationAt ? r.confirmationAt.toISOString() : null,
          preRescheduleStatus: r.preRescheduleStatus ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      );
    }

    if (method === "POST" && !parts[2]) {
      const rawBody = await body(req);
      const parsed = CreateServiceOrderBody.safeParse(rawBody);
      if (!parsed.success) return validationError("admin.service-orders.create", parsed);
      const data = parsed.data;
      const service = await db.query.servicesTable.findFirst({
        where: eq(servicesTable.id, data.serviceId),
      });
      if (!service) return error("الخدمة غير موجودة", 404);
      const customFields = withDerivedServiceDetails(service.type, normalizeDetailsInput(rawBody?.customFields ?? data.customFields));
      const payment = paymentSummary(rawBody?.totalAmount, rawBody?.depositAmount, rawBody?.paymentStatus);
      const eventLocation =
        rawBody?.eventLocation ?? data.eventLocation ??
        primaryLocationFromDetails(service.type, customFields) ??
        "";
      const phone = normalizeIraqiPhone(data.phone);
      if (!phone) return error("رقم الهاتف العراقي غير صحيح", 400);
      const safeCustomerName = textFallback(data.customerName, formatIraqiPhone(phone), "زبون");
      const conflict = await findBookingConflict({ serviceId: data.serviceId, eventDate: data.eventDate ?? "", customFields });
      if (conflict) return error("يوجد حجز آخر بنفس التاريخ للخدمة أو الكادر. اختر موعداً أو كادراً مختلفاً.", 409);
      const order = await insertServiceOrderWithTracking({
        serviceId: data.serviceId,
        customerName: safeCustomerName,
        phone,
        eventDate: data.eventDate ?? "",
        eventLocation,
        notes: data.notes,
        internalNotes: typeof rawBody?.internalNotes === "string" ? rawBody.internalNotes : null,
        totalAmount: String(money(rawBody?.totalAmount)),
        depositAmount: String(payment.deposit),
        remainingAmount: String(payment.remaining),
        paymentStatus: payment.status,
        dueDate: normalizeDateOnly(rawBody?.dueDate) ?? null,
        customFields,
      });
      await ensureQrForEntity("service_order", order, req);
      await db.insert(serviceOrderStatusHistoryTable).values({
        serviceOrderId: order.id,
        status: order.status,
        notes: "إضافة من الإدارة",
      });
      void logAdminActivity(req, "booking_created", "service_order", order.id, { tracking: order.trackingCode });
      void fireOrderEvent("booking_placed", {
        name: order.customerName,
        phone: order.phone,
        tracking: order.trackingCode ?? "",
        status: order.status,
        service: service.nameAr ?? service.name ?? "",
      });
      void createNotification({
        type: "booking_new",
        title: "حجز جديد",
        body: `${order.customerName} - ${service.nameAr ?? service.name ?? "خدمة"}`,
        entityType: "service_order",
        entityId: order.id,
        href: "/admin/orders",
      });
      void createCustomerNotificationByPhone(order.phone, {
        type: "booking_created",
        title: "تم إنشاء الحجز",
        body: `رمز التتبع ${order.trackingCode ?? ""}`,
        entityType: "service_order",
        entityId: order.id,
        href: `/track?code=${encodeURIComponent(order.trackingCode ?? "")}`,
      });
      void notifyOrderNeedsFollowup({
        kind: "service_order",
        id: order.id,
        trackingCode: order.trackingCode,
        customerName: order.customerName,
        paymentStatus: order.paymentStatus,
        remainingAmount: order.remainingAmount,
        reason: "payment",
      });
      await syncServiceOrderFinancialPayment(order, financialActor(auth));
      void notifyTelegramOrder({
        kind: "service",
        id: order.id,
        reference: order.trackingCode,
        serviceName: service.nameAr ?? service.name ?? "خدمة",
        customerName: order.customerName,
        phone: order.phone,
        createdByName: auth.fullName || auth.username,
        createdAt: order.createdAt,
        paymentMethod: "cash",
        total: order.totalAmount,
        paid: order.depositAmount,
        remaining: order.remainingAmount,
        status: order.status,
      });
      return json(
        {
          id: order.id,
          trackingCode: order.trackingCode,
          serviceId: order.serviceId,
          serviceName: service.nameAr ?? "",
          serviceType: service.type ?? null,
          customerName: order.customerName,
          phone: order.phone,
          eventDate: order.eventDate ?? null,
          eventLocation: order.eventLocation ?? null,
          notes: order.notes ?? null,
          internalNotes: order.internalNotes ?? null,
          totalAmount: Number.parseFloat(order.totalAmount ?? "0"),
          depositAmount: Number.parseFloat(order.depositAmount ?? "0"),
          remainingAmount: Number.parseFloat(order.remainingAmount ?? "0"),
          paymentStatus: order.paymentStatus ?? "unpaid",
          customFields: order.customFields ?? {},
          status: order.status,
          createdAt: order.createdAt.toISOString(),
        },
        201,
      );
    }

    if (method === "GET" && parts[3] === "history") {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const rows = await db.query.serviceOrderStatusHistoryTable.findMany({
        where: eq(serviceOrderStatusHistoryTable.serviceOrderId, id),
        orderBy: [desc(serviceOrderStatusHistoryTable.createdAt)],
      });
      return json(rows.map((r) => ({ status: r.status, notes: r.notes ?? null, createdAt: r.createdAt.toISOString() })));
    }

    if (method === "POST" && parts[3] === "reschedule-action") {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const action = b?.action;
      if (action !== "accept" && action !== "reject") return error("إجراء غير صالح", 400);
      const noteText = typeof b?.note === "string" ? b.note.slice(0, 500) : null;
      const so = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, id) });
      if (!so) return error("غير موجود", 404);
      if (so.status !== "reschedule_pending") return error("لا يوجد طلب تغيير موعد قيد المراجعة", 409);
      let newStatus: string;
      let newEventDate = so.eventDate;
      let historyNote: string;
      if (action === "accept") {
        newStatus = "confirmed";
        if (so.requestedDate) newEventDate = so.requestedDate;
        historyNote = `تم قبول طلب تغيير الموعد إلى ${so.requestedDate ?? ""}${noteText ? ` — ${noteText}` : ""}`;
      } else {
        newStatus = so.preRescheduleStatus ?? "pending";
        historyNote = `تم رفض طلب تغيير الموعد${noteText ? ` — ${noteText}` : ""}`;
      }
      const [row] = await db
        .update(serviceOrdersTable)
        .set({
          status: newStatus,
          eventDate: newEventDate,
          customerConfirmation: action === "accept" ? "confirmed" : null,
          requestedDate: null,
          confirmationNote: noteText,
          confirmationAt: new Date(),
          preRescheduleStatus: null,
        })
        .where(eq(serviceOrdersTable.id, id))
        .returning();
      await db.insert(serviceOrderStatusHistoryTable).values({ serviceOrderId: id, status: newStatus, notes: historyNote });
      if (action === "accept") {
        const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, row.serviceId) });
        void fireOrderEvent("booking_confirmed", {
          name: row.customerName,
          phone: row.phone,
          tracking: row.trackingCode ?? "",
          status: row.status,
          service: service?.nameAr ?? service?.name ?? "",
        });
      }
      void logAdminActivity(req, action === "accept" ? "booking_reschedule_accepted" : "booking_reschedule_rejected", "service_order", id);
      return json(row);
    }

    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = {};
      for (const k of ["status", "customerName", "phone", "eventDate", "eventLocation", "notes", "internalNotes", "dueDate"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      const prev = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, id) });
      if (!prev) return error("غير موجود", 404);
      if (update.customerName !== undefined && !String(update.customerName ?? "").trim()) {
        delete update.customerName;
      }
      if (update.phone !== undefined) {
        const phone = normalizeIraqiPhone(String(update.phone));
        if (!phone) return error("رقم الهاتف العراقي غير صحيح", 400);
        update.phone = phone;
        update.phoneLast4 = phoneLast4(phone);
      }
      if (b?.customFields !== undefined) {
        const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, prev.serviceId) });
        update.customFields = withDerivedServiceDetails(service?.type, normalizeDetailsInput(b.customFields));
        if (b?.eventLocation === undefined) {
          update.eventLocation = primaryLocationFromDetails(service?.type, update.customFields) || prev.eventLocation;
        }
      }
      if (update.eventDate !== undefined || update.customFields !== undefined) {
        const conflict = await findBookingConflict({
          serviceId: prev.serviceId,
          eventDate: update.eventDate ?? prev.eventDate,
          customFields: update.customFields ?? (prev.customFields as any),
          excludeId: id,
        });
        if (conflict) return error("يوجد حجز آخر بنفس التاريخ للخدمة أو الكادر. اختر موعداً أو كادراً مختلفاً.", 409);
      }
      if (b?.totalAmount !== undefined || b?.depositAmount !== undefined || b?.paymentStatus !== undefined) {
        if (b?.paymentStatus !== undefined && !["paid", "partial", "unpaid"].includes(String(b.paymentStatus))) return error("حالة الدفع غير صالحة", 400);
        const totalAmount = b?.totalAmount ?? prev.totalAmount;
        const payment = paymentSummary(totalAmount, b?.depositAmount ?? prev.depositAmount, b?.paymentStatus ?? prev.paymentStatus);
        update.totalAmount = String(money(totalAmount));
        update.depositAmount = String(payment.deposit);
        update.remainingAmount = String(payment.remaining);
        update.paymentStatus = payment.status;
      }
      if (b?.archived !== undefined) {
        if (Boolean(b.archived)) {
          const statusToArchive = String(update.status ?? prev.status);
          if (!["delivered", "completed", "cancelled"].includes(statusToArchive)) {
            return error("يمكن أرشفة الطلبات المكتملة أو الملغية فقط", 409);
          }
          update.archivedAt = new Date();
        } else {
          update.archivedAt = null;
        }
      }
      const [row] = await db.update(serviceOrdersTable).set(update).where(eq(serviceOrdersTable.id, id)).returning();
      if (typeof update.status === "string" && update.status && update.status !== prev?.status) {
        await db.insert(serviceOrderStatusHistoryTable).values({
          serviceOrderId: row.id,
          status: update.status,
          notes: typeof b?.statusNote === "string" ? b.statusNote : null,
        });
        const event = eventForBookingStatus(update.status);
        if (event) {
          const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, row.serviceId) });
          void fireOrderEvent(event, {
            name: row.customerName,
            phone: row.phone,
            tracking: row.trackingCode ?? "",
            status: row.status,
            service: service?.nameAr ?? service?.name ?? "",
          });
        }
        void createCustomerNotificationByPhone(row.phone, {
          type: `booking_status_${update.status}`,
          title: update.status === "confirmed" ? "تم تأكيد الحجز" : update.status === "processing" ? "حجزك قيد التجهيز" : update.status === "completed" || update.status === "delivered" ? "اكتمل الحجز" : update.status === "cancelled" ? "تم إلغاء الحجز" : "تحديث الحجز",
          body: `الحجز ${row.trackingCode ?? `#${row.id}`}`,
          entityType: "service_order",
          entityId: row.id,
          href: `/track?code=${encodeURIComponent(row.trackingCode ?? "")}`,
        });
      }
      if (update.paymentStatus !== undefined || update.remainingAmount !== undefined) {
        void notifyOrderNeedsFollowup({
          kind: "service_order",
          id: row.id,
          trackingCode: row.trackingCode,
          customerName: row.customerName,
          paymentStatus: row.paymentStatus,
          remainingAmount: row.remainingAmount,
          reason: "payment",
        });
      }
      await awardServiceOrderPoints(row);
      await syncServiceOrderFinancialPayment(row, financialActor(auth));
      const servicePaymentDelta = Number(row.depositAmount) - Number(prev.depositAmount);
      if (servicePaymentDelta > 0) {
        void notifyTelegramPayment({
          event: "paymentReceived",
          reference: row.trackingCode ?? `#${row.id}`,
          customerName: row.customerName,
          amount: servicePaymentDelta,
          paymentMethod: "cash",
          createdByName: auth.fullName || auth.username,
          status: row.paymentStatus,
          entityPath: `/admin/orders?serviceOrder=${row.id}`,
        });
      }
      void logAdminActivity(req, b?.archived ? "booking_archived" : "booking_updated", "service_order", row.id, { fields: Object.keys(update), tracking: row.trackingCode });
      return json(row);
    }

    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const existing = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, id) });
      if (existing) await syncServiceOrderFinancialPayment({ ...existing, status: "cancelled" }, financialActor(auth));
      await db.delete(serviceOrderStatusHistoryTable).where(eq(serviceOrderStatusHistoryTable.serviceOrderId, id));
      await db.delete(serviceOrdersTable).where(eq(serviceOrdersTable.id, id));
      void logAdminActivity(req, "booking_deleted", "service_order", id);
      return json({ message: "تم الحذف" });
    }
  }

    if (section === "orders") {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;
    await ensureStockTrackingTables();
    const orderActor = actor(auth);
    if (method === "POST" && !parts[2]) {
      const { customerName, customerPhone, governorate, area, address, notes, internalNotes, items, deliveryFee, mapsUrl, paymentMethod, depositAmount, paymentStatus, dueDate } = await body(req);
      const orderItems = mergeOrderItems(items);
      if (!customerPhone || orderItems.length === 0) return error("رقم الهاتف والمنتجات مطلوبة", 400);
      if (paymentMethod !== undefined && normalizePayment(paymentMethod) === null) return error("طريقة دفع غير صالحة", 400);
      const normalizedPhone = normalizeIraqiPhone(customerPhone);
      if (!normalizedPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
      const safeCustomerName = textFallback(customerName, formatIraqiPhone(normalizedPhone), "زبون");
      const total = orderItems.reduce((s: number, it: any) => s + money(it.price) * Number(it.quantity), 0) + money(deliveryFee);
      const payment = paymentSummary(total, depositAmount, paymentStatus ?? (paymentMethod === "paid" ? "paid" : undefined));
          const [order] = await db
            .insert(ordersTable)
            .values({
              trackingCode: trackingCodeForPhone(normalizedPhone),
              phoneLast4: phoneLast4(normalizedPhone),
              customerName: safeCustomerName,
              customerPhone: normalizedPhone,
              governorate: governorate ?? "",
              address: address ?? "",
              notes: notes ?? null,
              internalNotes: internalNotes ?? null,
              area: area ?? null,
              mapsUrl: mapsUrl ?? null,
              paymentMethod: paymentMethod ?? "cod",
              depositAmount: String(payment.deposit),
              remainingAmount: String(payment.remaining),
              paymentStatus: payment.status,
              dueDate: normalizeDateOnly(dueDate) ?? null,
              deliveryFee: String(money(deliveryFee)),
              total: String(total),
            })
            .returning();
          await ensureQrForEntity("order", order, req);
          await Promise.all(
            orderItems.map((it: any) =>
              db.insert(orderItemsTable).values({
                orderId: order.id,
                productId: it.productId ?? 0,
                productName: it.productName ?? "",
                productNameAr: it.productNameAr ?? it.productName ?? "",
                quantity: it.quantity,
                price: String(it.price),
                selectedColor: selectedColorName(it.selectedColorData, it.selectedColor),
                selectedColorData: selectedColorPayload(it.selectedColorData, it.selectedColor),
              }),
            ),
          );
          await Promise.all(
            orderItems
              .filter((it: any) => Number(it.productId) > 0)
              .map((it: any) => adjustProductStock(Number(it.productId), -Number(it.quantity), {
                reason: "order_stock_deducted",
                relatedType: "order",
                relatedId: order.id,
                createdBy: orderActor.id,
                createdByName: orderActor.name,
              })),
          );
          await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: "pending", notes: "إضافة من الإدارة" });
          void fireOrderEvent("placed", {
            name: order.customerName,
            phone: order.customerPhone,
            tracking: order.trackingCode,
            total: Number(order.total),
            status: "pending",
          });
          void createNotification({
            type: "order_new",
            title: "طلب جديد",
            body: `${order.customerName} - ${order.trackingCode}`,
            entityType: "order",
            entityId: order.id,
            href: "/admin/orders",
          });
          void notifyOrderNeedsFollowup({
            kind: "order",
            id: order.id,
            trackingCode: order.trackingCode,
            customerName: order.customerName,
            paymentStatus: order.paymentStatus,
            remainingAmount: order.remainingAmount,
            reason: "payment",
          });
          void createCustomerNotificationByPhone(order.customerPhone, {
            type: "order_created",
            title: "تم إنشاء طلبك",
            body: `رمز التتبع ${order.trackingCode}`,
            entityType: "order",
            entityId: order.id,
            href: `/track?code=${encodeURIComponent(order.trackingCode)}`,
          });
          void notifyLowStockForProductIds(orderItems.map((it: any) => Number(it.productId)));
          await syncOrderFinancialPayment(order, financialActor(auth));
          void notifyTelegramOrder({
            kind: "store",
            id: order.id,
            reference: order.trackingCode,
            customerName: order.customerName,
            phone: order.customerPhone,
            createdByName: auth.fullName || auth.username,
            createdAt: order.createdAt,
            paymentMethod: order.paymentMethod,
            total: order.total,
            paid: order.depositAmount,
            remaining: order.remainingAmount,
            status: order.status,
          });
          void logAdminActivity(req, "order_created", "order", order.id, { tracking: order.trackingCode });
          return json({ id: order.id, trackingCode: order.trackingCode }, 201);
    }

    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      if (b?.paymentMethod !== undefined && normalizePayment(b.paymentMethod) === null) return error("طريقة دفع غير صالحة", 400);
      if (b?.paymentStatus !== undefined && !["paid", "partial", "unpaid"].includes(String(b.paymentStatus))) return error("حالة الدفع غير صالحة", 400);
      const update: any = { updatedAt: new Date() };
      for (const k of ["customerName", "customerPhone", "governorate", "area", "address", "notes", "mapsUrl", "paymentMethod", "internalNotes", "dueDate"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      if (b?.status !== undefined) {
        const nextStatus = String(b.status ?? "").trim();
        if (!nextStatus) return error("حالة الطلب غير صالحة", 400);
        update.status = nextStatus;
      }
      if (update.customerPhone !== undefined) {
        const normalizedPhone = normalizeIraqiPhone(update.customerPhone);
        if (!normalizedPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
        update.customerPhone = normalizedPhone;
        update.phoneLast4 = phoneLast4(normalizedPhone);
      }
      if (b?.deliveryFee !== undefined) update.deliveryFee = String(b.deliveryFee);
      if (b?.attachments !== undefined) update.attachments = b.attachments;
      let current: typeof ordersTable.$inferSelect | null = null;
      if (b?.depositAmount !== undefined || b?.paymentStatus !== undefined || b?.deliveryFee !== undefined || b?.archived !== undefined || b?.status !== undefined) {
        current = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, id) }) ?? null;
        if (!current) return error("غير موجود", 404);
      }
      if (b?.depositAmount !== undefined || b?.paymentStatus !== undefined || b?.deliveryFee !== undefined) {
        const existingOrder = current!;
        let total = money(existingOrder.total);
        if (b?.deliveryFee !== undefined) {
          const subtotalWithoutDelivery = Math.max(total - money(existingOrder.deliveryFee), 0);
          total = subtotalWithoutDelivery + money(b.deliveryFee);
          update.total = String(total);
        }
        const payment = paymentSummary(total, b?.depositAmount ?? existingOrder.depositAmount, b?.paymentStatus ?? existingOrder.paymentStatus);
        update.depositAmount = String(payment.deposit);
        update.remainingAmount = String(payment.remaining);
        update.paymentStatus = payment.status;
      }
      if (b?.archived !== undefined) {
        if (Boolean(b.archived)) {
          const statusToArchive = String(current?.status ?? "");
          if (!["delivered", "completed", "cancelled"].includes(statusToArchive)) {
            return error("يمكن أرشفة الطلبات المكتملة أو الملغية فقط", 409);
          }
          update.archivedAt = new Date();
        } else {
          update.archivedAt = null;
        }
      }
      const [row] = await db.update(ordersTable).set(update).where(eq(ordersTable.id, id)).returning();
      if (!row) return error("غير موجود", 404);
      if (update.status !== undefined) {
        await syncOrderStockState(row, orderActor);
      }
      if (update.paymentStatus !== undefined || update.remainingAmount !== undefined) {
        void notifyOrderNeedsFollowup({
          kind: "order",
          id: row.id,
          trackingCode: row.trackingCode,
          customerName: row.customerName,
          paymentStatus: row.paymentStatus,
          remainingAmount: row.remainingAmount,
          reason: "payment",
        });
      }
      if (update.status !== undefined && current?.status !== row.status) {
        await db.insert(orderStatusHistoryTable).values({
          orderId: row.id,
          status: row.status,
          notes: typeof b?.statusNotes === "string" ? b.statusNotes.slice(0, 500) : "تحديث من الإدارة",
        });
        const event = eventForStatus(row.status);
        if (event) {
          void fireOrderEvent(event, {
            name: row.customerName,
            phone: row.customerPhone,
            tracking: row.trackingCode,
            total: Number.parseFloat(row.total),
            status: row.status,
          });
        }
        void createCustomerNotificationByPhone(row.customerPhone, {
          type: `order_status_${row.status}`,
          title: row.status === "confirmed" ? "تم تأكيد طلبك" : row.status === "processing" ? "طلبك قيد التجهيز" : row.status === "shipped" ? "طلبك في الطريق" : row.status === "delivered" ? "تم تسليم طلبك" : row.status === "cancelled" ? "تم إلغاء الطلب" : "تحديث حالة الطلب",
          body: `طلب ${row.trackingCode}`,
          entityType: "order",
          entityId: row.id,
          href: `/track?code=${encodeURIComponent(row.trackingCode)}`,
        });
      }
      await awardProductOrderPoints(row);
      await syncOrderFinancialPayment(row, financialActor(auth));
      const orderPaymentDelta = Number(row.depositAmount) - Number(current?.depositAmount ?? row.depositAmount);
      if (orderPaymentDelta > 0) {
        void notifyTelegramPayment({
          event: "paymentReceived",
          reference: row.trackingCode,
          customerName: row.customerName,
          amount: orderPaymentDelta,
          paymentMethod: row.paymentMethod,
          createdByName: auth.fullName || auth.username,
          status: row.paymentStatus,
          entityPath: `/admin/orders?order=${row.id}`,
        });
      }
      void logAdminActivity(req, b?.archived ? "order_archived" : "order_updated", "order", row.id, { fields: Object.keys(update), tracking: row.trackingCode });
      return json(row);
    }

    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const current = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, id) }) as any;
      if (current) {
        await restoreOrderStockBeforeDelete(current, orderActor);
        await syncOrderFinancialPayment({ ...current, status: "cancelled" }, financialActor(auth));
      }
      await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, id));
      await db.delete(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, id));
      await db.delete(ordersTable).where(eq(ordersTable.id, id));
      void logAdminActivity(req, "order_deleted", "order", id);
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "services") {
    const auth = await requirePermission(req, "services");
    if (isResponse(auth)) return auth;
    if (method === "GET" && !parts[2]) {
      const rows = await db.query.servicesTable.findMany({ orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.id)] });
      return json(rows.map(formatService));
    }
    if (method === "POST" && !parts[2]) {
      const svcBody = await body(req);
      const { name, nameAr, description, descriptionAr, type, icon, image, imageMetadata, isActive, sortOrder } = svcBody;
      const serviceNameAr = textFallback(nameAr, name, "خدمة جديدة");
      const serviceName = textFallback(name, nameAr, `service-${Date.now().toString(36)}`);
      const serviceType = textFallback(type, "other");
      const [row] = await db
        .insert(servicesTable)
        .values({
          name: serviceName,
          nameAr: serviceNameAr,
          description: nullableText(description),
          descriptionAr: nullableText(descriptionAr),
          ...pickContentTranslations(svcBody, true),
          type: serviceType,
          icon: nullableText(icon),
          image: await persistMediaValue(image, "services"),
          imageMetadata: imageMetadata && typeof imageMetadata === "object" ? imageMetadata : {},
          isActive: isActive ?? true,
          sortOrder: sortOrder ?? 0,
        })
        .returning();
      void logAdminActivity(req, "service_created", "service", row.id, { name: row.nameAr });
      return json(formatService(row), 201);
    }
    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = {};
      for (const k of ["name", "nameAr", "description", "descriptionAr", "type", "icon", "image", "imageMetadata", "isActive", "sortOrder"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      Object.assign(update, pickContentTranslations(b, true));
      if (update.name !== undefined && !String(update.name ?? "").trim()) delete update.name;
      if (update.nameAr !== undefined && !String(update.nameAr ?? "").trim()) delete update.nameAr;
      if (update.type !== undefined && !String(update.type ?? "").trim()) update.type = "other";
      for (const k of ["description", "descriptionAr", "icon", "image"]) {
        if (update[k] !== undefined) update[k] = nullableText(update[k]);
      }
      if (b?.image !== undefined) {
        const ref = localMediaReference(b.image);
        update.image = ref?.kind === "service" && ref.id === id
          ? (await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, id) }) as any)?.image ?? null
          : await persistMediaValue(b.image, "services");
      }
      if (update.imageMetadata !== undefined && (!update.imageMetadata || typeof update.imageMetadata !== "object")) update.imageMetadata = {};
      const [row] = await db.update(servicesTable).set(update).where(eq(servicesTable.id, id)).returning();
      if (!row) return error("غير موجود", 404);
      void logAdminActivity(req, "service_updated", "service", row.id, { fields: Object.keys(update) });
      return json(formatService(row));
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(serviceOrdersTable).where(eq(serviceOrdersTable.serviceId, id));
      if ((count ?? 0) > 0) {
        await db.update(servicesTable).set({ isActive: false }).where(eq(servicesTable.id, id));
        void logAdminActivity(req, "service_disabled", "service", id, { reason: "has_orders" });
        return json({ message: "تم تعطيل الخدمة للحفاظ على الحجوزات القديمة" });
      }
      await db.delete(servicesTable).where(eq(servicesTable.id, id));
      void logAdminActivity(req, "service_deleted", "service", id);
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "invoices" && method === "GET" && parts[2]) {
    const auth = await requirePermission(req, "invoices");
    if (isResponse(auth)) return auth;
    const id = int(parts[2]);
    if (!id) return error("معرف غير صحيح", 400);
    const type = req.nextUrl.searchParams.get("type") === "booking" ? "booking" : "order";
    if (type === "booking") {
      const booking = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, id) });
      if (!booking) return error("الحجز غير موجود", 404);
      const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, booking.serviceId) });
      const cf = (booking.customFields ?? {}) as Record<string, any>;
      const num = (v: any) => {
        const n = typeof v === "string" ? Number.parseFloat(v) : Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const explicitTotal = num(cf.total);
      const basePrice = num(cf.price ?? cf.agreedPrice);
      const priceFromDetails = explicitTotal > 0 ? explicitTotal : basePrice + num(cf.wrappingFee);
      const price = num(booking.totalAmount) > 0 ? num(booking.totalAmount) : priceFromDetails;
      const deposit = num(booking.depositAmount) > 0 ? num(booking.depositAmount) : num(cf.deposit ?? cf.downPayment);
      const balance = price > 0 ? Math.max(price - deposit, 0) : num(booking.remainingAmount);
      const qr = await ensureQrForEntity("service_order", booking, req);
      return json({
        kind: "booking",
        id: booking.id,
        trackingCode: booking.trackingCode,
        customerName: booking.customerName,
        customerPhone: booking.phone,
        serviceId: booking.serviceId,
        serviceName: service?.nameAr ?? service?.name ?? "—",
        serviceType: service?.type ?? null,
        eventDate: booking.eventDate ?? null,
        eventLocation: booking.eventLocation ?? null,
        notes: booking.notes ?? null,
        status: booking.status,
        price,
        deposit,
        balance,
        paymentStatus: booking.paymentStatus ?? "unpaid",
        customFields: cf,
        qr,
        createdAt: booking.createdAt.toISOString(),
      });
    }
    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, id) });
    if (!order) return error("الطلب غير موجود", 404);
    const items = await db.query.orderItemsTable.findMany({ where: eq(orderItemsTable.orderId, order.id) });
    const qr = await ensureQrForEntity("order", order, req);
    return json({
      kind: "order",
      id: order.id,
      trackingCode: order.trackingCode,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      governorate: order.governorate ?? null,
      area: order.area ?? null,
      address: order.address ?? null,
      paymentMethod: order.paymentMethod ?? "cod",
      depositAmount: Number.parseFloat(order.depositAmount ?? "0"),
      remainingAmount: Number.parseFloat(order.remainingAmount ?? "0"),
      paymentStatus: order.paymentStatus ?? "unpaid",
      notes: order.notes ?? null,
      deliveryFee: Number.parseFloat(order.deliveryFee),
      total: Number.parseFloat(order.total),
      status: order.status,
      qr,
      createdAt: order.createdAt.toISOString(),
      items: items.map((i) => ({
        id: i.id,
        productName: i.productName,
        productNameAr: i.productNameAr,
        quantity: i.quantity,
        price: Number.parseFloat(i.price),
        selectedColor: selectedColorName(i.selectedColorData, i.selectedColor),
        selectedColorData: selectedColorPayload(i.selectedColorData, i.selectedColor),
      })),
    });
  }

  if (section === "whatsapp") {
    const auth = await requirePermission(req, "whatsapp");
    if (isResponse(auth)) return auth;
    if (method === "GET" && parts[2] === "settings") {
      const s = await getWaSettings();
      return json({
        provider: s.provider,
        enabledEvents: { ...DEFAULT_ENABLED, ...s.enabledEvents },
        templates: { ...DEFAULT_TEMPLATES, ...s.templates },
        automationEnabled: s.automationEnabled,
        events: WA_EVENTS,
        bookingEvents: WA_BOOKING_EVENTS,
        providers: PROVIDER_SPECS.map((p) => ({ id: p.id, label: p.label })),
        providerStatus: getProviderStatus(),
      });
    }
    if (method === "PUT" && parts[2] === "settings") {
      const b = await body(req);
      const patch: any = {};
      if (typeof b.provider === "string") patch.provider = b.provider;
      if (b.enabledEvents && typeof b.enabledEvents === "object") {
        const safe: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(b.enabledEvents)) safe[k] = !!v;
        patch.enabledEvents = safe;
      }
      if (b.templates && typeof b.templates === "object") {
        const safe: Record<string, string> = {};
        for (const [k, v] of Object.entries(b.templates)) if (typeof v === "string") safe[k] = v;
        patch.templates = safe;
      }
      if (typeof b.automationEnabled === "boolean") patch.automationEnabled = b.automationEnabled;
      const updated = await updateWaSettings(patch);
      void logAdminActivity(req, "whatsapp_settings_updated", "settings", undefined, { fields: Object.keys(patch) });
      return json({ ok: true, automationEnabled: updated.automationEnabled });
    }
    if (method === "GET" && parts[2] === "log") {
      const limit = Math.min(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 200);
      const rows = await db.query.whatsappLogTable.findMany({
        orderBy: [desc(whatsappLogTable.sentAt)],
        limit,
      });
      return json(
        rows.map((r) => ({
          id: r.id,
          phone: r.phone,
          event: r.event,
          status: r.status,
          error: r.error,
          provider: r.provider,
          message: r.message,
          sentAt: r.sentAt.toISOString(),
        })),
      );
    }
    if (method === "DELETE" && parts[2] === "log") {
      await db.delete(whatsappLogTable);
      return json({ ok: true });
    }
    if (method === "POST" && parts[2] === "log" && parts[4] === "resend") {
      const id = int(parts[3]);
      if (!id) return error("معرّف غير صالح", 400);
      const entry = await db.query.whatsappLogTable.findFirst({ where: eq(whatsappLogTable.id, id) });
      if (!entry) return error("السجل غير موجود", 404);
      if (!entry.phone || !entry.message) return error("السجل ناقص", 400);
      const result = await whatsappSend(entry.phone, entry.message, entry.event as any);
      void logAdminActivity(req, result.ok ? "whatsapp_resend_success" : "whatsapp_resend_failed", "whatsapp_log", entry.id, { event: entry.event });
      return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error ?? "فشل إعادة الإرسال" }, 502);
    }
    if (method === "POST" && parts[2] === "test") {
      const { phone, message } = await body(req);
      if (typeof phone !== "string" || !phone.trim()) return error("الرقم مطلوب", 400);
      const bodyText = typeof message === "string" && message.trim() ? message : "رسالة اختبار من مجموعة علي جان ✅";
      const result = await whatsappSend(phone, bodyText, "test");
      void logAdminActivity(req, result.ok ? "whatsapp_test_success" : "whatsapp_test_failed", "whatsapp", undefined, { phone: normalizeIraqiPhone(phone) ?? "invalid" });
      return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error ?? "فشل الإرسال" }, 502);
    }
  }

  if (section === "uploads" && method === "POST") {
    const auth = await requirePermission(req, "gallery");
    if (isResponse(auth)) return auth;
    const { dataUrl, titleAr, category, imageMetadata } = await body(req);
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return error("صيغة غير صحيحة", 400);
    if (dataUrl.length > 5_000_000) return error("الملف كبير جداً (الحد الأقصى ~3.5 ميغا)", 413);
    const mediaUrl = await persistDataUrlToStorage(dataUrl, "gallery");
    const [row] = await db
      .insert(galleryItemsTable)
      .values({
        mediaUrl,
        mediaType: dataUrl.startsWith("data:video/") ? "video" : "image",
        imageMetadata: imageMetadata && typeof imageMetadata === "object" ? imageMetadata : {},
        titleAr: titleAr ?? null,
        category: category ?? "uploads",
      })
      .returning();
    return json({ id: row.id, url: publicMediaValue("gallery", row, row.mediaUrl) }, 201);
  }

  const accounting = await handleAccounting(req, parts, section);
  if (accounting) return accounting;

  const salesResult = await handleSalesInvoices(req, parts, section);
  if (salesResult) return salesResult;

  const purchasesResult = await handlePurchaseInvoices(req, parts, section);
  if (purchasesResult) return purchasesResult;

  const suppliersResult = await handleSuppliers(req, parts, section);
  if (suppliersResult) return suppliersResult;

  const reportsResult = await handleReports(req, parts, section);
  if (reportsResult) return reportsResult;

  const printResult = await handlePrintTemplates(req, parts, section);
  if (printResult) return printResult;

  const backup = await handleBackup(req, parts, section);
  if (backup) return backup;

  return null;
}

// ─── Sales Invoices ──────────────────────────────────────────────────────────

let salesInvoicesMigrated = false;
async function ensureSalesInvoicesTables() {
  if (salesInvoicesMigrated) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sales_invoices (
        id SERIAL PRIMARY KEY, invoice_no VARCHAR(40) NOT NULL UNIQUE, date DATE NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '', customer_phone VARCHAR(30), customer_id INTEGER REFERENCES customers(id),
        subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        coupon_code VARCHAR(60), coupon_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0, total NUMERIC(14,2) NOT NULL DEFAULT 0,
        paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0, remaining_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(20) NOT NULL DEFAULT 'cash', payment_status VARCHAR(20) NOT NULL DEFAULT 'paid',
        status VARCHAR(20) NOT NULL DEFAULT 'active', is_internal INTEGER NOT NULL DEFAULT 0,
        notes TEXT, created_by INTEGER REFERENCES staff(id), created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sales_invoice_items (
        id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id), product_name TEXT NOT NULL, barcode VARCHAR(100),
        quantity NUMERIC(12,3) NOT NULL DEFAULT 1, unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        discount NUMERIC(14,2) NOT NULL DEFAULT 0, discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE sales_invoices
        ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(60),
        ADD COLUMN IF NOT EXISTS coupon_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS stock_applied INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS stock_restored_at TIMESTAMP;
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices(date);
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice ON sales_invoice_items(invoice_id);
    `);
    salesInvoicesMigrated = true;
  } catch { salesInvoicesMigrated = true; }
}

let purchasesMigrated = false;
async function ensurePurchasesTables() {
  if (purchasesMigrated) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone VARCHAR(30), email TEXT, address TEXT,
        notes TEXT, balance TEXT NOT NULL DEFAULT '0', is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id SERIAL PRIMARY KEY, invoice_no VARCHAR(40) NOT NULL UNIQUE, date DATE NOT NULL,
        supplier_name TEXT NOT NULL DEFAULT '', supplier_id INTEGER REFERENCES suppliers(id),
        subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0, shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0, paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        remaining_amount NUMERIC(14,2) NOT NULL DEFAULT 0, payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
        payment_status VARCHAR(20) NOT NULL DEFAULT 'paid', status VARCHAR(20) NOT NULL DEFAULT 'active',
        notes TEXT, created_by INTEGER REFERENCES staff(id), created_by_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS purchase_invoice_items (
        id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id), product_name TEXT NOT NULL, barcode VARCHAR(100),
        quantity NUMERIC(12,3) NOT NULL DEFAULT 1, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
        sale_price NUMERIC(14,2) NOT NULL DEFAULT 0, discount NUMERIC(14,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(date);
      CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_invoice ON purchase_invoice_items(invoice_id);
    `);
    purchasesMigrated = true;
  } catch { purchasesMigrated = true; }
}

let printTemplatesMigrated = false;
async function ensurePrintTemplatesTables() {
  if (printTemplatesMigrated) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS print_templates (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, type VARCHAR(30) NOT NULL DEFAULT 'sales',
        paper_size VARCHAR(20) NOT NULL DEFAULT 'a4', is_default INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}', created_by INTEGER REFERENCES staff(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    printTemplatesMigrated = true;
  } catch { printTemplatesMigrated = true; }
}

function fmtInvoiceNo(prefix: string, id: number, date: Date): string {
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${y}${m}-${String(id).padStart(5, "0")}`;
}

function salesInvoiceItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => {
      const quantity = Math.max(Number.parseFloat(String(item?.quantity ?? "0")) || 0, 0);
      const unitPrice = money(item?.unitPrice);
      const discount = money(item?.discount);
      const productName = textFallback(item?.productName, item?.productNameAr);
      return {
        productId: Number.isFinite(Number(item?.productId)) && Number(item.productId) > 0 ? Number(item.productId) : null,
        productName,
        barcode: normalizeProductBarcode(item?.barcode) || null,
        quantity,
        unitPrice,
        discount,
        discountPct: money(item?.discountPct),
        total: Math.max(quantity * unitPrice - discount, 0),
        costPrice: money(item?.costPrice),
      };
    })
    .filter((item) => item.productName && item.quantity > 0);
}

function purchaseInvoiceItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => {
      const quantity = Math.max(Number.parseFloat(String(item?.quantity ?? "0")) || 0, 0);
      const costPrice = money(item?.costPrice);
      const discount = money(item?.discount);
      const productName = textFallback(item?.productName, item?.productNameAr);
      return {
        productId: Number.isFinite(Number(item?.productId)) && Number(item.productId) > 0 ? Number(item.productId) : null,
        productName,
        barcode: normalizeProductBarcode(item?.barcode) || null,
        quantity,
        costPrice,
        salePrice: money(item?.salePrice),
        discount,
        total: Math.max(quantity * costPrice - discount, 0),
      };
    })
    .filter((item) => item.productName && item.quantity > 0);
}

async function handleSalesInvoices(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "sales-invoices") return null;
  const auth = await requirePermission(req, "accounting");
  if (isResponse(auth)) return auth;
  await ensureSalesInvoicesTables();
  await ensureStockTrackingTables();
  const method = req.method;
  const id = parts[2] ? int(parts[2]) : null;

  if (method === "GET" && !id) {
    const from = req.nextUrl.searchParams.get("from") ?? undefined;
    const to = req.nextUrl.searchParams.get("to") ?? undefined;
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const limitQ = parseInt(req.nextUrl.searchParams.get("limit") ?? "100");
    const offsetQ = parseInt(req.nextUrl.searchParams.get("offset") ?? "0");
    const conds: any[] = [sql`${salesInvoicesTable.status} != 'deleted'`];
    if (from) conds.push(gte(salesInvoicesTable.date, from));
    if (to) conds.push(lte(salesInvoicesTable.date, to));
    if (status) conds.push(eq(salesInvoicesTable.status, status));
    const rows = await db.select().from(salesInvoicesTable)
      .where(and(...conds) as any)
      .orderBy(desc(salesInvoicesTable.date), desc(salesInvoicesTable.id))
      .limit(limitQ).offset(offsetQ);
    const [countRow] = await db.select({ c: sql<number>`count(*)::int` }).from(salesInvoicesTable).where(and(...conds) as any);
    return json({ data: rows, total: countRow?.c ?? 0 });
  }

  if (method === "GET" && id) {
    const inv = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, id) });
    if (!inv) return error("الفاتورة غير موجودة", 404);
    const items = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
    const qr = await ensureQrForEntity("invoice", inv, req);
    return json({ ...inv, items, qr });
  }

  if (method === "POST") {
    const b = await body(req);
    const a = actor(auth);
    const items = salesInvoiceItems(b?.items);
    if (items.length === 0) return error("أضف منتجاً واحداً على الأقل إلى الفاتورة", 400);
    const dateVal = b.date ?? new Date().toISOString().slice(0, 10);
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    let discountAmount = parseFloat(b.discountAmount ?? "0") || 0;
    const couponPreview = b.couponCode
      ? await calculateCouponDiscount(b.couponCode, subtotal, 0)
      : null;
    if (couponPreview && !couponPreview.ok) return error(couponPreview.message, couponPreview.status);
    const couponDiscountAmount = couponPreview?.ok ? couponPreview.discountAmount : 0;
    if (couponDiscountAmount > discountAmount) discountAmount = couponDiscountAmount;
    const taxAmount = parseFloat(b.taxAmount ?? "0") || 0;
    const total = Math.max(subtotal - discountAmount + taxAmount, 0);
    const paidAmount = parseFloat(b.paidAmount ?? String(total)) || 0;
    const remainingAmount = Math.max(total - paidAmount, 0);
    const paymentStatus = paidAmount >= total ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
    const rawPhone = textFallback(b.customerPhone);
    const customerPhone = rawPhone ? normalizeIraqiPhone(rawPhone) : null;
    if (rawPhone && !customerPhone) return error("رقم هاتف الزبون العراقي غير صحيح", 400);

    const [inv] = await db.insert(salesInvoicesTable).values({
      invoiceNo: `SI-TEMP-${randomBytes(8).toString("hex")}`,
      date: dateVal,
      customerName: b.customerName ?? "",
      customerPhone,
      customerId: b.customerId ?? null,
      subtotal: String(subtotal),
      discountAmount: String(discountAmount),
      couponCode: couponPreview?.ok ? couponPreview.coupon.code : null,
      couponDiscountAmount: String(couponDiscountAmount),
      taxAmount: String(taxAmount),
      total: String(total),
      paidAmount: String(paidAmount),
      remainingAmount: String(remainingAmount),
      paymentMethod: b.paymentMethod ?? "cash",
      paymentStatus,
      dueDate: normalizeDateOnly(b.dueDate) ?? null,
      status: "active",
      isInternal: b.isInternal ? 1 : 0,
      notes: b.notes ?? null,
      createdBy: a.id,
      createdByName: a.name,
    } as any).returning();

    const invoiceNo = fmtInvoiceNo("SI", inv.id, new Date(inv.createdAt));
    await db.update(salesInvoicesTable).set({ invoiceNo }).where(eq(salesInvoicesTable.id, inv.id));

    if (items.length > 0) {
      await db.insert(salesInvoiceItemsTable).values(
        items.map((item: any) => ({
          invoiceId: inv.id,
          productId: item.productId ?? null,
          productName: item.productName ?? "",
          barcode: item.barcode ?? null,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          discount: String(item.discount),
          discountPct: String(item.discountPct),
          total: String(item.total),
          costPrice: String(item.costPrice),
        }))
      );
      // Update product stock
      for (const item of items) {
        if (item.productId && item.quantity > 0) {
          await adjustProductStock(Number(item.productId), -Number(item.quantity), {
            reason: "sales_invoice_stock_deducted",
            relatedType: "sales_invoice",
            relatedId: inv.id,
            createdBy: a.id,
            createdByName: a.name,
          });
        }
      }
      void notifyLowStockForProductIds(items.map((item) => Number(item.productId)));
    }

    if (couponPreview?.ok) {
      await recordCouponUsage(couponPreview.coupon, {
        customerPhone,
        salesInvoiceId: inv.id,
        discountAmount: couponDiscountAmount,
      });
    }

    const final = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, inv.id) });
    const qr = final ? await ensureQrForEntity("invoice", final, req) : null;
    const finalItems = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, inv.id));
    const financialTransaction = final ? await syncSourcePaymentTarget({
      sourceType: "sales_invoice",
      sourceId: final.id,
      sourceEvent: "payment",
      targetAmount: Number(final.paidAmount),
      normalDirection: "revenue",
      transactionDate: final.date,
      department: "store",
      transactionType: "sales_invoice",
      description: `فاتورة مبيعات ${final.invoiceNo}`,
      paymentMethod: (final.paymentMethod as any) || "cash",
      customerId: final.customerId,
      customerName: final.customerName,
      customerPhone: final.customerPhone,
      dueDate: final.dueDate,
      notes: final.notes,
    }, financialActor(auth)) : null;
    void logAdminActivity(req, "sales_invoice_created", "sales_invoice", inv.id, { invoiceNo, itemCount: finalItems.length });
    if (final) {
      void notifyTelegramInvoice({
        id: final.id,
        invoiceNo: final.invoiceNo,
        customerName: final.customerName,
        customerPhone: final.customerPhone,
        createdByName: final.createdByName || auth.fullName || auth.username,
        date: final.date,
        paymentMethod: final.paymentMethod,
        subtotal: final.subtotal,
        discountAmount: final.discountAmount,
        total: final.total,
        paidAmount: final.paidAmount,
        remainingAmount: final.remainingAmount,
        paymentStatus: final.paymentStatus,
        items: finalItems,
      });
    }
    return json({ ...final, qr, items: finalItems, financialTransaction, invoice: final ? { ...final, qr } : final }, 201);
  }

  if (method === "PUT" && id) {
    const b = await body(req);
    const a = actor(auth);
    const existing = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, id) });
    if (!existing) return error("الفاتورة غير موجودة", 404);
    const oldItems = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
    const parsedItems = b.items !== undefined ? salesInvoiceItems(b.items) : null;
    if (parsedItems && parsedItems.length === 0) return error("أضف منتجاً واحداً على الأقل إلى الفاتورة", 400);
    const subtotal = parsedItems
      ? parsedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      : parseFloat(b.subtotal ?? String(existing.subtotal)) || 0;
    const discountAmount = parseFloat(b.discountAmount ?? String(existing.discountAmount)) || 0;
    const taxAmount = parseFloat(b.taxAmount ?? String(existing.taxAmount)) || 0;
    const total = Math.max(parseFloat(b.total ?? String(subtotal - discountAmount + taxAmount)) || 0, 0);
    const paidAmount = Math.max(parseFloat(b.paidAmount ?? String(existing.paidAmount)) || 0, 0);
    const remainingAmount = Math.max(total - paidAmount, 0);
    const paymentStatus = paidAmount >= total ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
    const rawPhone = b.customerPhone !== undefined ? textFallback(b.customerPhone) : existing.customerPhone;
    const customerPhone = rawPhone ? normalizeIraqiPhone(rawPhone) : null;
    if (rawPhone && !customerPhone) return error("رقم هاتف الزبون العراقي غير صحيح", 400);

    await db.update(salesInvoicesTable).set({
      date: b.date ?? existing.date,
      customerName: b.customerName ?? existing.customerName,
      customerPhone,
      subtotal: String(subtotal), discountAmount: String(discountAmount),
      taxAmount: String(taxAmount), total: String(total),
      paidAmount: String(paidAmount), remainingAmount: String(remainingAmount),
      paymentMethod: b.paymentMethod ?? existing.paymentMethod,
      paymentStatus,
      dueDate: b.dueDate !== undefined ? normalizeDateOnly(b.dueDate) : existing.dueDate,
      status: b.status !== undefined ? String(b.status || existing.status) : existing.status,
      notes: b.notes ?? existing.notes,
      isInternal: b.isInternal !== undefined ? (b.isInternal ? 1 : 0) : existing.isInternal,
      updatedAt: new Date(),
    } as any).where(eq(salesInvoicesTable.id, id));

    if (parsedItems) {
      if (hasAppliedStock(existing)) {
        await applySalesInvoiceItemsStock(id, 1, "sales_invoice_stock_restored_for_edit", a);
        await db
          .update(salesInvoicesTable)
          .set({ stockApplied: 0, stockRestoredAt: new Date(), updatedAt: new Date() } as any)
          .where(eq(salesInvoicesTable.id, id));
      }
      await db.delete(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
      if (parsedItems.length > 0) {
        await db.insert(salesInvoiceItemsTable).values(
          parsedItems.map((item: any) => ({
            invoiceId: id, productId: item.productId ?? null, productName: item.productName ?? "",
            barcode: item.barcode ?? null, quantity: String(item.quantity ?? 1),
            unitPrice: String(item.unitPrice ?? 0), discount: String(item.discount ?? 0),
            discountPct: String(item.discountPct ?? 0), total: String(item.total ?? 0),
            costPrice: String(item.costPrice ?? 0),
          }))
        );
        void notifyLowStockForProductIds(parsedItems.map((item) => Number(item.productId)));
      }
    }
    const final = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, id) });
    if (final) await syncSalesInvoiceStockState(final, a);
    const finalItems = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
    const qr = final ? await ensureQrForEntity("invoice", final, req) : null;
    const financialTransaction = final ? await syncSourcePaymentTarget({
      sourceType: "sales_invoice",
      sourceId: final.id,
      sourceEvent: "payment",
      targetAmount: final.status === "active" ? Number(final.paidAmount) : 0,
      normalDirection: "revenue",
      transactionDate: final.date,
      department: "store",
      transactionType: "sales_invoice",
      description: `فاتورة مبيعات ${final.invoiceNo}`,
      paymentMethod: (final.paymentMethod as any) || "cash",
      customerId: final.customerId,
      customerName: final.customerName,
      customerPhone: final.customerPhone,
      dueDate: final.dueDate,
      notes: final.notes,
    }, financialActor(auth)) : null;
    void logAdminActivity(req, "sales_invoice_updated", "sales_invoice", id, {
      invoiceNo: final?.invoiceNo,
      itemCount: finalItems.length,
      oldItemCount: oldItems.length,
      total,
    });
    if (final && Number(final.paidAmount) > Number(existing.paidAmount)) {
      void notifyTelegramPayment({
        event: "paymentReceived",
        reference: final.invoiceNo,
        customerName: final.customerName,
        amount: Number(final.paidAmount) - Number(existing.paidAmount),
        paymentMethod: final.paymentMethod,
        createdByName: auth.fullName || auth.username,
        status: final.paymentStatus,
        entityPath: `/admin/sales?invoice=${final.id}`,
      });
    }
    return json({ ...final, items: finalItems, qr, financialTransaction, invoice: final ? { ...final, qr } : final });
  }

  if (method === "DELETE" && id) {
    const a = actor(auth);
    const [deleted] = await db
      .update(salesInvoicesTable)
      .set({ status: "deleted", updatedAt: new Date() } as any)
      .where(eq(salesInvoicesTable.id, id))
      .returning();
    if (deleted) {
      await syncSalesInvoiceStockState(deleted, a);
      await syncSourcePaymentTarget({
        sourceType: "sales_invoice",
        sourceId: deleted.id,
        sourceEvent: "payment",
        targetAmount: 0,
        normalDirection: "revenue",
        transactionDate: deleted.date,
        department: "store",
        transactionType: "sales_invoice",
        description: `إلغاء فاتورة مبيعات ${deleted.invoiceNo}`,
        paymentMethod: (deleted.paymentMethod as any) || "cash",
        customerId: deleted.customerId,
        customerName: deleted.customerName,
        customerPhone: deleted.customerPhone,
      }, financialActor(auth));
      void logAdminActivity(req, "sales_invoice_deleted", "sales_invoice", id, { invoiceNo: deleted.invoiceNo });
    }
    return json({ message: "تم الحذف" });
  }

  return null;
}

async function handlePurchaseInvoices(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "purchase-invoices") return null;
  const auth = await requirePermission(req, "accounting");
  if (isResponse(auth)) return auth;
  await ensurePurchasesTables();
  const method = req.method;
  const id = parts[2] ? int(parts[2]) : null;

  if (method === "GET" && !id) {
    const from = req.nextUrl.searchParams.get("from") ?? undefined;
    const to = req.nextUrl.searchParams.get("to") ?? undefined;
    const limitQ = parseInt(req.nextUrl.searchParams.get("limit") ?? "100");
    const offsetQ = parseInt(req.nextUrl.searchParams.get("offset") ?? "0");
    const conds: any[] = [sql`${purchaseInvoicesTable.status} != 'deleted'`];
    if (from) conds.push(gte(purchaseInvoicesTable.date, from));
    if (to) conds.push(lte(purchaseInvoicesTable.date, to));
    const rows = await db.select().from(purchaseInvoicesTable)
      .where(and(...conds) as any)
      .orderBy(desc(purchaseInvoicesTable.date), desc(purchaseInvoicesTable.id))
      .limit(limitQ).offset(offsetQ);
    const [countRow] = await db.select({ c: sql<number>`count(*)::int` }).from(purchaseInvoicesTable).where(and(...conds) as any);
    return json({ data: rows, total: countRow?.c ?? 0 });
  }

  if (method === "GET" && id) {
    const inv = await db.query.purchaseInvoicesTable.findFirst({ where: eq(purchaseInvoicesTable.id, id) });
    if (!inv) return error("الفاتورة غير موجودة", 404);
    const items = await db.select().from(purchaseInvoiceItemsTable).where(eq(purchaseInvoiceItemsTable.invoiceId, id));
    return json({ ...inv, items });
  }

  if (method === "POST") {
    const b = await body(req);
    const a = actor(auth);
    const items = purchaseInvoiceItems(b?.items);
    if (items.length === 0) return error("أضف صنفاً واحداً على الأقل إلى فاتورة الشراء", 400);
    const dateVal = b.date ?? new Date().toISOString().slice(0, 10);
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
    const discountAmount = parseFloat(b.discountAmount ?? "0") || 0;
    const taxAmount = parseFloat(b.taxAmount ?? "0") || 0;
    const shippingCost = parseFloat(b.shippingCost ?? "0") || 0;
    const total = Math.max(subtotal - discountAmount + taxAmount + shippingCost, 0);
    const paidAmount = parseFloat(b.paidAmount ?? String(total)) || 0;
    const remainingAmount = Math.max(total - paidAmount, 0);
    const paymentStatus = paidAmount >= total ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

    const [inv] = await db.insert(purchaseInvoicesTable).values({
      invoiceNo: `PI-TEMP-${randomBytes(8).toString("hex")}`,
      date: dateVal,
      supplierName: b.supplierName ?? "",
      supplierId: b.supplierId ?? null,
      subtotal: String(subtotal), discountAmount: String(discountAmount),
      taxAmount: String(taxAmount), shippingCost: String(shippingCost),
      total: String(total), paidAmount: String(paidAmount),
      remainingAmount: String(remainingAmount),
      paymentMethod: b.paymentMethod ?? "cash",
      paymentStatus, status: "active",
      notes: b.notes ?? null,
      createdBy: a.id, createdByName: a.name,
    } as any).returning();

    const invoiceNo = fmtInvoiceNo("PI", inv.id, new Date(inv.createdAt));
    await db.update(purchaseInvoicesTable).set({ invoiceNo } as any).where(eq(purchaseInvoicesTable.id, inv.id));

    const processedItems: typeof items = [];
    for (const item of items) {
      let productId = item.productId;
      if (!productId) {
        const existingProduct = item.barcode
          ? await db.query.productsTable.findFirst({ where: eq(productsTable.barcode, item.barcode) })
          : await db.query.productsTable.findFirst({
              where: or(eq(productsTable.nameAr, item.productName), eq(productsTable.name, item.productName)),
            });
        if (existingProduct) {
          productId = existingProduct.id;
        } else {
          const [createdProduct] = await db.insert(productsTable).values({
            name: item.productName,
            nameAr: item.productName,
            price: String(item.salePrice > 0 ? item.salePrice : item.costPrice),
            costPrice: String(item.costPrice),
            stock: 0,
            barcode: item.barcode || null,
            category: "purchases",
            images: [],
            colors: [],
            isActive: true,
          } as any).returning();
          productId = createdProduct.id;
        }
      }
      processedItems.push({ ...item, productId });
    }

    if (processedItems.length > 0) {
      await db.insert(purchaseInvoiceItemsTable).values(
        processedItems.map((item: any) => ({
          invoiceId: inv.id,
          productId: item.productId ?? null, productName: item.productName ?? "",
          barcode: item.barcode, quantity: String(item.quantity),
          costPrice: String(item.costPrice), salePrice: String(item.salePrice),
          discount: String(item.discount), total: String(item.total),
        }))
      );
      // Update product stock on purchase
      for (const item of processedItems) {
        if (item.productId && item.quantity > 0) {
          await adjustProductStock(Number(item.productId), Number(item.quantity), {
            reason: "purchase_invoice_stock_increased",
            relatedType: "purchase_invoice",
            relatedId: inv.id,
            createdBy: a.id,
            createdByName: a.name,
          });
          const updateVals: any = { costPrice: String(item.costPrice) };
          if (item.salePrice > 0) {
            updateVals.price = String(item.salePrice);
          }
          await db.update(productsTable).set(updateVals).where(eq(productsTable.id, item.productId));
        }
      }
    }

    const final = await db.query.purchaseInvoicesTable.findFirst({ where: eq(purchaseInvoicesTable.id, inv.id) });
    const finalItems = await db.select().from(purchaseInvoiceItemsTable).where(eq(purchaseInvoiceItemsTable.invoiceId, inv.id));
    const financialTransaction = final ? await syncSourcePaymentTarget({
      sourceType: "purchase_invoice",
      sourceId: final.id,
      sourceEvent: "payment",
      targetAmount: Number(final.paidAmount),
      normalDirection: "expense",
      transactionDate: final.date,
      department: "store",
      transactionType: "purchase_invoice",
      description: `فاتورة شراء ${final.invoiceNo}`,
      paymentMethod: (final.paymentMethod as any) || "cash",
      notes: final.notes,
    }, financialActor(auth)) : null;
    void logAdminActivity(req, "purchase_invoice_created", "purchase_invoice", inv.id, { invoiceNo, itemCount: finalItems.length });
    return json({ ...final, items: finalItems, financialTransaction, invoice: final }, 201);
  }

  if (method === "DELETE" && id) {
    const [deleted] = await db.update(purchaseInvoicesTable).set({ status: "deleted" } as any).where(eq(purchaseInvoicesTable.id, id)).returning();
    if (deleted) {
      await syncSourcePaymentTarget({
        sourceType: "purchase_invoice",
        sourceId: deleted.id,
        sourceEvent: "payment",
        targetAmount: 0,
        normalDirection: "expense",
        transactionDate: deleted.date,
        department: "store",
        transactionType: "purchase_invoice",
        description: `إلغاء فاتورة شراء ${deleted.invoiceNo}`,
        paymentMethod: (deleted.paymentMethod as any) || "cash",
      }, financialActor(auth));
    }
    return json({ message: "تم الحذف" });
  }

  return null;
}

async function handleSuppliers(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "suppliers") return null;
  const auth = await requirePermission(req, "accounting");
  if (isResponse(auth)) return auth;
  await ensurePurchasesTables();
  const method = req.method;
  const id = parts[2] ? int(parts[2]) : null;

  if (method === "GET" && !id) {
    const rows = await db.select().from(suppliersTable)
      .where(eq(suppliersTable.isActive, 1))
      .orderBy(suppliersTable.name);
    return json(rows);
  }

  if (method === "POST") {
    const b = await body(req);
    const supplierName = textFallback(b?.name, `مورد ${Date.now().toString(36)}`);
    const [row] = await db.insert(suppliersTable).values({
      name: supplierName, phone: nullableText(b?.phone),
      email: nullableText(b?.email), address: nullableText(b?.address), notes: nullableText(b?.notes),
    } as any).returning();
    void logAdminActivity(req, "supplier_created", "supplier", row.id, { name: row.name });
    return json(row, 201);
  }

  if (method === "PUT" && id) {
    const b = await body(req);
    const update: any = {};
    if (b.name !== undefined && nullableText(b.name)) update.name = nullableText(b.name);
    if (b.phone !== undefined) update.phone = nullableText(b.phone);
    if (b.email !== undefined) update.email = nullableText(b.email);
    if (b.address !== undefined) update.address = nullableText(b.address);
    if (b.notes !== undefined) update.notes = nullableText(b.notes);
    update.updatedAt = new Date();
    const [row] = await db.update(suppliersTable).set(update).where(eq(suppliersTable.id, id!)).returning();
    if (!row) return error("غير موجود", 404);
    void logAdminActivity(req, "supplier_updated", "supplier", row.id, { fields: Object.keys(update) });
    return json(row);
  }

  if (method === "DELETE" && id) {
    await db.update(suppliersTable).set({ isActive: 0, updatedAt: new Date() } as any).where(eq(suppliersTable.id, id!));
    void logAdminActivity(req, "supplier_disabled", "supplier", id!);
    return json({ message: "تم الحذف" });
  }

  return null;
}

async function handleReports(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "reports") return null;
  const auth = await requirePermission(req, "accounting");
  if (isResponse(auth)) return auth;
  await ensureSalesInvoicesTables();
  await ensurePurchasesTables();
  const method = req.method;
  const reportType = parts[2];

  if (method === "POST" && reportType === "audit") {
    const b = await body(req);
    const action = String(b?.action ?? "") === "report_pdf_exported" ? "report_pdf_exported" : "report_printed";
    const title = textFallback(b?.title, "تقرير");
    void logAdminActivity(req, action, "report", undefined, { title, format: b?.format ?? null });
    return json({ message: "تم تسجيل العملية" });
  }

  if (method !== "GET") return null;

  const from = req.nextUrl.searchParams.get("from") ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = req.nextUrl.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  if (reportType === "daily") {
    await ensureExpenseManagementTables();
    const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const paymentMethod = (req.nextUrl.searchParams.get("paymentMethod") ?? "").trim();
    const status = (req.nextUrl.searchParams.get("status") ?? "").trim();
    const user = (req.nextUrl.searchParams.get("user") ?? "").trim();
    const fromTs = `${date}T00:00:00`;
    const toTs = `${date}T23:59:59`;
    const userLike = `%${user}%`;

    const [
      invoiceRow,
      invoiceProfitRow,
      orderRow,
      serviceRow,
      expenseRow,
      paymentRows,
      expenseCategoryRows,
      invoiceRows,
      orderRows,
      serviceRows,
      expenseRows,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(total::numeric), 0)::float AS total,
          COALESCE(SUM(paid_amount::numeric), 0)::float AS paid,
          COALESCE(SUM(remaining_amount::numeric), 0)::float AS remaining,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS completed_payments,
          COUNT(*) FILTER (WHERE payment_status <> 'paid')::int AS pending_payments
        FROM sales_invoices
        WHERE status = 'active'
          AND date = ${date}
          AND (${paymentMethod} = '' OR payment_method = ${paymentMethod})
          AND (${status} = '' OR payment_status = ${status} OR status = ${status})
          AND (${user} = '' OR COALESCE(created_by_name, '') ILIKE ${userLike})
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(sii.total::numeric - (sii.cost_price::numeric * sii.quantity::numeric)), 0)::float AS profit
        FROM sales_invoice_items sii
        JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE si.status = 'active'
          AND si.date = ${date}
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
          AND (${status} = '' OR si.payment_status = ${status} OR si.status = ${status})
          AND (${user} = '' OR COALESCE(si.created_by_name, '') ILIKE ${userLike})
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(total::numeric), 0)::float AS gross_total,
          COALESCE(SUM(total::numeric - COALESCE(delivery_fee::numeric, 0)), 0)::float AS net_total,
          COALESCE(SUM(COALESCE(delivery_fee::numeric, 0)), 0)::float AS delivery_total,
          COALESCE(SUM(remaining_amount::numeric), 0)::float AS remaining,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS completed_payments,
          COUNT(*) FILTER (WHERE payment_status <> 'paid')::int AS pending_payments
        FROM orders
        WHERE archived_at IS NULL
          AND created_at >= ${fromTs}::timestamp
          AND created_at <= ${toTs}::timestamp
          AND (${paymentMethod} = '' OR payment_method = ${paymentMethod})
          AND (${status} = '' OR payment_status = ${status} OR status = ${status})
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(total_amount::numeric), 0)::float AS total,
          COALESCE(SUM(remaining_amount::numeric), 0)::float AS remaining,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS completed_payments,
          COUNT(*) FILTER (WHERE payment_status <> 'paid')::int AS pending_payments
        FROM service_orders
        WHERE archived_at IS NULL
          AND created_at >= ${fromTs}::timestamp
          AND created_at <= ${toTs}::timestamp
          AND (${status} = '' OR payment_status = ${status} OR status = ${status})
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(amount::numeric), 0)::float AS total, COUNT(*)::int AS count
        FROM expenses
        WHERE deleted_at IS NULL
          AND COALESCE(approval_status, 'executed') = 'executed'
          AND date = ${date}
          AND (${paymentMethod} = '' OR payment_method = ${paymentMethod})
          AND (${user} = '' OR COALESCE(created_by_name, '') ILIKE ${userLike})
      `),
      db.execute(sql`
        SELECT method, COALESCE(SUM(amount), 0)::float AS total
        FROM (
          SELECT payment_method AS method, total::numeric AS amount
          FROM sales_invoices
          WHERE status = 'active' AND date = ${date}
            AND (${status} = '' OR payment_status = ${status} OR status = ${status})
            AND (${user} = '' OR COALESCE(created_by_name, '') ILIKE ${userLike})
          UNION ALL
          SELECT payment_method AS method, (total::numeric - COALESCE(delivery_fee::numeric, 0)) AS amount
          FROM orders
          WHERE archived_at IS NULL
            AND created_at >= ${fromTs}::timestamp
            AND created_at <= ${toTs}::timestamp
            AND (${status} = '' OR payment_status = ${status} OR status = ${status})
        ) payments
        WHERE (${paymentMethod} = '' OR method = ${paymentMethod})
        GROUP BY method
      `),
      db.execute(sql`
        SELECT COALESCE(category_name, 'غير مصنف') AS category_name, COALESCE(SUM(amount::numeric), 0)::float AS total
        FROM expenses
        WHERE deleted_at IS NULL
          AND COALESCE(approval_status, 'executed') = 'executed'
          AND date = ${date}
          AND (${paymentMethod} = '' OR payment_method = ${paymentMethod})
          AND (${user} = '' OR COALESCE(created_by_name, '') ILIKE ${userLike})
        GROUP BY COALESCE(category_name, 'غير مصنف')
        ORDER BY COALESCE(SUM(amount::numeric), 0) DESC
      `),
      db.execute(sql`
        SELECT invoice_no AS ref, date::text AS date, COALESCE(customer_name, 'زبون') AS customer, total::text AS total, payment_method, payment_status
        FROM sales_invoices
        WHERE status = 'active' AND date = ${date}
          AND (${paymentMethod} = '' OR payment_method = ${paymentMethod})
          AND (${status} = '' OR payment_status = ${status} OR status = ${status})
          AND (${user} = '' OR COALESCE(created_by_name, '') ILIKE ${userLike})
        ORDER BY id DESC LIMIT 200
      `),
      db.execute(sql`
        SELECT tracking_code AS ref, DATE(created_at)::text AS date, customer_name AS customer, total::text AS total, delivery_fee::text AS delivery_fee, payment_method, payment_status, status
        FROM orders
        WHERE archived_at IS NULL
          AND created_at >= ${fromTs}::timestamp
          AND created_at <= ${toTs}::timestamp
          AND (${paymentMethod} = '' OR payment_method = ${paymentMethod})
          AND (${status} = '' OR payment_status = ${status} OR status = ${status})
        ORDER BY created_at DESC LIMIT 200
      `),
      db.execute(sql`
        SELECT tracking_code AS ref, DATE(created_at)::text AS date, customer_name AS customer, total_amount::text AS total, payment_status, status
        FROM service_orders
        WHERE archived_at IS NULL
          AND created_at >= ${fromTs}::timestamp
          AND created_at <= ${toTs}::timestamp
          AND (${status} = '' OR payment_status = ${status} OR status = ${status})
        ORDER BY created_at DESC LIMIT 200
      `),
      db.execute(sql`
        SELECT id::text AS ref, date::text AS date, name AS title, category_name, amount::text AS amount, payment_method, created_by_name
        FROM expenses
        WHERE deleted_at IS NULL
          AND COALESCE(approval_status, 'executed') = 'executed'
          AND date = ${date}
          AND (${paymentMethod} = '' OR payment_method = ${paymentMethod})
          AND (${user} = '' OR COALESCE(created_by_name, '') ILIKE ${userLike})
        ORDER BY id DESC LIMIT 200
      `),
    ]);

    const invoice = (invoiceRow.rows?.[0] ?? {}) as any;
    const invoiceProfit = (invoiceProfitRow.rows?.[0] ?? {}) as any;
    const order = (orderRow.rows?.[0] ?? {}) as any;
    const service = (serviceRow.rows?.[0] ?? {}) as any;
    const expense = (expenseRow.rows?.[0] ?? {}) as any;
    const paymentByMethod = new Map((paymentRows.rows ?? []).map((row: any) => [String(row.method ?? ""), Number(row.total ?? 0)]));
    const totalInvoices = Number(invoice.total ?? 0);
    const totalStoreOrders = Number(order.net_total ?? 0);
    const totalServiceBookings = Number(service.total ?? 0);
    const totalExpenses = Number(expense.total ?? 0);
    const deliveryFeesTotal = Number(order.delivery_total ?? 0);
    const totalSales = totalInvoices + totalStoreOrders + totalServiceBookings;
    const pendingPayments = Number(invoice.pending_payments ?? 0) + Number(order.pending_payments ?? 0) + Number(service.pending_payments ?? 0);
    const completedPayments = Number(invoice.completed_payments ?? 0) + Number(order.completed_payments ?? 0) + Number(service.completed_payments ?? 0);

    return json({
      date,
      filters: { paymentMethod, status, user },
      summary: {
        totalSales,
        totalServiceBookings,
        totalStoreOrders,
        totalInvoices,
        totalExpenses,
        deliveryFeesTotal,
        netSalesExcludingDelivery: totalSales,
        netProfit: Number(invoiceProfit.profit ?? 0) + totalStoreOrders + totalServiceBookings - totalExpenses,
        cashTotal: Number(paymentByMethod.get("cash") ?? paymentByMethod.get("cod") ?? 0),
        cardTotal: Number(paymentByMethod.get("card") ?? paymentByMethod.get("pos") ?? 0),
        transferTotal: Number(paymentByMethod.get("transfer") ?? 0),
        pendingPayments,
        completedPayments,
        invoicesCount: Number(invoice.count ?? 0),
        storeOrdersCount: Number(order.count ?? 0),
        serviceBookingsCount: Number(service.count ?? 0),
        expensesCount: Number(expense.count ?? 0),
      },
      payments: paymentRows.rows ?? [],
      expensesByCategory: expenseCategoryRows.rows ?? [],
      rows: {
        invoices: invoiceRows.rows ?? [],
        orders: orderRows.rows ?? [],
        serviceBookings: serviceRows.rows ?? [],
        expenses: expenseRows.rows ?? [],
      },
    });
  }

  if (reportType === "options") {
    const [customers, products, categories, paymentMethods] = await Promise.all([
      db.execute(sql`
        SELECT label, value FROM (
          SELECT DISTINCT
            COALESCE(NULLIF(customer_name, ''), customer_phone, 'زبون') AS label,
            COALESCE(customer_phone, NULLIF(customer_name, ''), '') AS value
          FROM sales_invoices
          WHERE status = 'active'
          UNION
          SELECT DISTINCT
            COALESCE(NULLIF(customer_name, ''), customer_phone, 'زبون') AS label,
            COALESCE(customer_phone, NULLIF(customer_name, ''), '') AS value
          FROM orders
        ) opts
        WHERE value <> ''
        ORDER BY label
        LIMIT 200
      `),
      db.execute(sql`
        SELECT id::text AS value, COALESCE(NULLIF(name_ar, ''), name) AS label
        FROM products
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 250
      `),
      db.execute(sql`
        SELECT id::text AS value, COALESCE(NULLIF(name_ar, ''), name, slug) AS label
        FROM categories
        WHERE is_active = true
        ORDER BY COALESCE(parent_id, 0), sort_order, name_ar
        LIMIT 200
      `),
      db.execute(sql`
        SELECT DISTINCT payment_method AS value, payment_method AS label
        FROM (
          SELECT payment_method FROM sales_invoices WHERE payment_method IS NOT NULL
          UNION
          SELECT payment_method FROM orders WHERE payment_method IS NOT NULL
        ) methods
        WHERE payment_method <> ''
        ORDER BY payment_method
      `),
    ]);
    return json({
      customers: customers.rows ?? [],
      products: products.rows ?? [],
      categories: categories.rows ?? [],
      paymentMethods: paymentMethods.rows ?? [],
    });
  }

  if (reportType === "table") {
    const type = (req.nextUrl.searchParams.get("type") ?? "invoice-sales").trim();
    const customer = (req.nextUrl.searchParams.get("customer") ?? "").trim();
    const product = (req.nextUrl.searchParams.get("product") ?? "").trim();
    const category = (req.nextUrl.searchParams.get("category") ?? "").trim();
    const paymentMethod = (req.nextUrl.searchParams.get("paymentMethod") ?? "").trim();
    const customerLike = `%${customer}%`;
    const productLike = `%${product}%`;
    const categoryLike = `%${category}%`;
    const fromTs = `${from}T00:00:00`;
    const toTs = `${to}T23:59:59`;

    if (type === "invoice-sales") {
      const rows = await db.execute(sql`
        SELECT
          si.id,
          si.invoice_no,
          si.date::text AS date,
          COALESCE(NULLIF(si.customer_name, ''), 'زبون') AS customer_name,
          COALESCE(si.customer_phone, '') AS customer_phone,
          COALESCE(NULLIF(si.created_by_name, ''), 'غير محدد') AS staff_name,
          COALESCE(si.payment_method, '') AS payment_method,
          COALESCE(si.payment_status, '') AS payment_status,
          COALESCE(item_stats.item_count, 0)::int AS item_count,
          si.subtotal::text AS subtotal,
          (COALESCE(si.discount_amount, 0) + COALESCE(si.coupon_discount_amount, 0))::text AS discount,
          si.total::text AS net_total,
          si.paid_amount::text AS paid_amount,
          si.remaining_amount::text AS remaining_amount
        FROM sales_invoices si
        LEFT JOIN (
          SELECT invoice_id, COUNT(*)::int AS item_count
          FROM sales_invoice_items
          GROUP BY invoice_id
        ) item_stats ON item_stats.invoice_id = si.id
        WHERE si.status = 'active'
          AND si.date >= ${from}
          AND si.date <= ${to}
          AND (${customer} = '' OR si.customer_name ILIKE ${customerLike} OR COALESCE(si.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
          AND (${product} = '' OR EXISTS (
            SELECT 1 FROM sales_invoice_items sii
            WHERE sii.invoice_id = si.id
              AND (sii.product_name ILIKE ${productLike} OR COALESCE(sii.barcode, '') ILIKE ${productLike} OR sii.product_id::text = ${product})
          ))
          AND (${category} = '' OR EXISTS (
            SELECT 1
            FROM sales_invoice_items sii
            LEFT JOIN products p ON p.id = sii.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN categories sc ON sc.id = p.subcategory_id
            WHERE sii.invoice_id = si.id
              AND (
                p.category_id::text = ${category}
                OR p.subcategory_id::text = ${category}
                OR COALESCE(p.category, '') ILIKE ${categoryLike}
                OR COALESCE(p.subcategory, '') ILIKE ${categoryLike}
                OR COALESCE(c.name_ar, c.name, c.slug, '') ILIKE ${categoryLike}
                OR COALESCE(sc.name_ar, sc.name, sc.slug, '') ILIKE ${categoryLike}
              )
          ))
        ORDER BY si.date DESC, si.id DESC
        LIMIT 1000
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    if (type === "invoice-details") {
      const rows = await db.execute(sql`
        SELECT
          si.invoice_no,
          si.date::text AS date,
          COALESCE(NULLIF(si.customer_name, ''), 'زبون') AS customer_name,
          sii.product_name,
          COALESCE(c.name_ar, c.name, p.category, 'غير مصنف') AS category_name,
          sii.quantity::text AS quantity,
          sii.unit_price::text AS unit_price,
          sii.discount::text AS discount,
          sii.total::text AS total,
          (sii.total - (sii.cost_price * sii.quantity))::text AS profit
        FROM sales_invoice_items sii
        JOIN sales_invoices si ON si.id = sii.invoice_id
        LEFT JOIN products p ON p.id = sii.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN categories sc ON sc.id = p.subcategory_id
        WHERE si.status = 'active'
          AND si.date >= ${from}
          AND si.date <= ${to}
          AND (${customer} = '' OR si.customer_name ILIKE ${customerLike} OR COALESCE(si.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
          AND (${product} = '' OR sii.product_name ILIKE ${productLike} OR COALESCE(sii.barcode, '') ILIKE ${productLike} OR sii.product_id::text = ${product})
          AND (${category} = '' OR p.category_id::text = ${category} OR p.subcategory_id::text = ${category}
            OR COALESCE(p.category, '') ILIKE ${categoryLike} OR COALESCE(p.subcategory, '') ILIKE ${categoryLike}
            OR COALESCE(c.name_ar, c.name, c.slug, '') ILIKE ${categoryLike}
            OR COALESCE(sc.name_ar, sc.name, sc.slug, '') ILIKE ${categoryLike})
        ORDER BY si.date DESC, si.id DESC, sii.id
        LIMIT 1500
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    if (type === "customers") {
      const rows = await db.execute(sql`
        SELECT
          COALESCE(NULLIF(si.customer_name, ''), 'زبون') AS customer_name,
          COALESCE(si.customer_phone, '') AS customer_phone,
          COUNT(*)::int AS invoice_count,
          SUM(si.subtotal)::text AS gross_sales,
          SUM(COALESCE(si.discount_amount, 0) + COALESCE(si.coupon_discount_amount, 0))::text AS discounts,
          SUM(si.total)::text AS net_sales,
          SUM(si.remaining_amount)::text AS remaining_amount
        FROM sales_invoices si
        WHERE si.status = 'active'
          AND si.date >= ${from}
          AND si.date <= ${to}
          AND (${customer} = '' OR si.customer_name ILIKE ${customerLike} OR COALESCE(si.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
          AND (${product} = '' OR EXISTS (
            SELECT 1 FROM sales_invoice_items sii
            WHERE sii.invoice_id = si.id
              AND (sii.product_name ILIKE ${productLike} OR COALESCE(sii.barcode, '') ILIKE ${productLike} OR sii.product_id::text = ${product})
          ))
          AND (${category} = '' OR EXISTS (
            SELECT 1
            FROM sales_invoice_items sii
            LEFT JOIN products p ON p.id = sii.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE sii.invoice_id = si.id
              AND (p.category_id::text = ${category} OR p.subcategory_id::text = ${category}
                OR COALESCE(p.category, '') ILIKE ${categoryLike}
                OR COALESCE(c.name_ar, c.name, c.slug, '') ILIKE ${categoryLike})
          ))
        GROUP BY COALESCE(NULLIF(si.customer_name, ''), 'زبون'), COALESCE(si.customer_phone, '')
        ORDER BY SUM(si.total) DESC
        LIMIT 500
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    if (type === "products") {
      const rows = await db.execute(sql`
        SELECT
          COALESCE(sii.product_id, 0)::int AS product_id,
          sii.product_name,
          COALESCE(c.name_ar, c.name, p.category, 'غير مصنف') AS category_name,
          SUM(sii.quantity)::text AS total_qty,
          SUM(sii.total)::text AS total_revenue,
          SUM(sii.cost_price * sii.quantity)::text AS total_cost,
          SUM(sii.total - (sii.cost_price * sii.quantity))::text AS profit
        FROM sales_invoice_items sii
        JOIN sales_invoices si ON si.id = sii.invoice_id
        LEFT JOIN products p ON p.id = sii.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN categories sc ON sc.id = p.subcategory_id
        WHERE si.status = 'active'
          AND si.date >= ${from}
          AND si.date <= ${to}
          AND (${customer} = '' OR si.customer_name ILIKE ${customerLike} OR COALESCE(si.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
          AND (${product} = '' OR sii.product_name ILIKE ${productLike} OR COALESCE(sii.barcode, '') ILIKE ${productLike} OR sii.product_id::text = ${product})
          AND (${category} = '' OR p.category_id::text = ${category} OR p.subcategory_id::text = ${category}
            OR COALESCE(p.category, '') ILIKE ${categoryLike} OR COALESCE(p.subcategory, '') ILIKE ${categoryLike}
            OR COALESCE(c.name_ar, c.name, c.slug, '') ILIKE ${categoryLike}
            OR COALESCE(sc.name_ar, sc.name, sc.slug, '') ILIKE ${categoryLike})
        GROUP BY COALESCE(sii.product_id, 0), sii.product_name, COALESCE(c.name_ar, c.name, p.category, 'غير مصنف')
        ORDER BY SUM(sii.total) DESC
        LIMIT 500
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    if (type === "categories") {
      const rows = await db.execute(sql`
        SELECT
          COALESCE(c.name_ar, c.name, p.category, 'غير مصنف') AS category_name,
          COUNT(DISTINCT si.id)::int AS invoice_count,
          SUM(sii.quantity)::text AS total_qty,
          SUM(sii.total)::text AS total_revenue,
          SUM(sii.total - (sii.cost_price * sii.quantity))::text AS profit
        FROM sales_invoice_items sii
        JOIN sales_invoices si ON si.id = sii.invoice_id
        LEFT JOIN products p ON p.id = sii.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN categories sc ON sc.id = p.subcategory_id
        WHERE si.status = 'active'
          AND si.date >= ${from}
          AND si.date <= ${to}
          AND (${customer} = '' OR si.customer_name ILIKE ${customerLike} OR COALESCE(si.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
          AND (${product} = '' OR sii.product_name ILIKE ${productLike} OR COALESCE(sii.barcode, '') ILIKE ${productLike} OR sii.product_id::text = ${product})
          AND (${category} = '' OR p.category_id::text = ${category} OR p.subcategory_id::text = ${category}
            OR COALESCE(p.category, '') ILIKE ${categoryLike} OR COALESCE(p.subcategory, '') ILIKE ${categoryLike}
            OR COALESCE(c.name_ar, c.name, c.slug, '') ILIKE ${categoryLike}
            OR COALESCE(sc.name_ar, sc.name, sc.slug, '') ILIKE ${categoryLike})
        GROUP BY COALESCE(c.name_ar, c.name, p.category, 'غير مصنف')
        ORDER BY SUM(sii.total) DESC
        LIMIT 300
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    if (type === "staff") {
      const rows = await db.execute(sql`
        SELECT
          COALESCE(NULLIF(si.created_by_name, ''), 'غير محدد') AS staff_name,
          COUNT(*)::int AS invoice_count,
          SUM(si.total)::text AS total_revenue,
          SUM(item_profit.profit)::text AS profit
        FROM sales_invoices si
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(sii.total - (sii.cost_price * sii.quantity)), 0) AS profit
          FROM sales_invoice_items sii
          WHERE sii.invoice_id = si.id
        ) item_profit ON true
        WHERE si.status = 'active'
          AND si.date >= ${from}
          AND si.date <= ${to}
          AND (${customer} = '' OR si.customer_name ILIKE ${customerLike} OR COALESCE(si.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
          AND (${product} = '' OR EXISTS (
            SELECT 1 FROM sales_invoice_items sii
            WHERE sii.invoice_id = si.id
              AND (sii.product_name ILIKE ${productLike} OR COALESCE(sii.barcode, '') ILIKE ${productLike} OR sii.product_id::text = ${product})
          ))
          AND (${category} = '' OR EXISTS (
            SELECT 1
            FROM sales_invoice_items sii
            LEFT JOIN products p ON p.id = sii.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE sii.invoice_id = si.id
              AND (p.category_id::text = ${category} OR p.subcategory_id::text = ${category}
                OR COALESCE(p.category, '') ILIKE ${categoryLike}
                OR COALESCE(c.name_ar, c.name, c.slug, '') ILIKE ${categoryLike})
          ))
        GROUP BY COALESCE(NULLIF(si.created_by_name, ''), 'غير محدد')
        ORDER BY SUM(si.total) DESC
        LIMIT 200
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    if (type === "profit-daily" || type === "profit-monthly") {
      const periodExpr = type === "profit-monthly"
        ? sql`to_char(si.date, 'YYYY-MM')`
        : sql`si.date::text`;
      const rows = await db.execute(sql`
        SELECT
          ${periodExpr} AS period,
          COUNT(*)::int AS invoice_count,
          SUM(si.total)::text AS revenue,
          SUM(item_profit.cost)::text AS cost,
          SUM(item_profit.profit)::text AS profit
        FROM sales_invoices si
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(sii.cost_price * sii.quantity), 0) AS cost,
            COALESCE(SUM(sii.total - (sii.cost_price * sii.quantity)), 0) AS profit
          FROM sales_invoice_items sii
          WHERE sii.invoice_id = si.id
        ) item_profit ON true
        WHERE si.status = 'active'
          AND si.date >= ${from}
          AND si.date <= ${to}
          AND (${customer} = '' OR si.customer_name ILIKE ${customerLike} OR COALESCE(si.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
          AND (${product} = '' OR EXISTS (
            SELECT 1 FROM sales_invoice_items sii
            WHERE sii.invoice_id = si.id
              AND (sii.product_name ILIKE ${productLike} OR COALESCE(sii.barcode, '') ILIKE ${productLike} OR sii.product_id::text = ${product})
          ))
          AND (${category} = '' OR EXISTS (
            SELECT 1
            FROM sales_invoice_items sii
            LEFT JOIN products p ON p.id = sii.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE sii.invoice_id = si.id
              AND (p.category_id::text = ${category} OR p.subcategory_id::text = ${category}
                OR COALESCE(p.category, '') ILIKE ${categoryLike}
                OR COALESCE(c.name_ar, c.name, c.slug, '') ILIKE ${categoryLike})
          ))
        GROUP BY ${periodExpr}
        ORDER BY ${periodExpr}
        LIMIT 500
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    if (type === "delivery") {
      const rows = await db.execute(sql`
        SELECT
          o.id,
          o.tracking_code,
          DATE(o.created_at)::text AS date,
          COALESCE(NULLIF(o.customer_name, ''), 'زبون') AS customer_name,
          COALESCE(o.customer_phone, '') AS customer_phone,
          o.total::text AS gross_total,
          o.delivery_fee::text AS delivery_fee,
          (o.total - o.delivery_fee)::text AS order_total,
          COALESCE(o.payment_method, '') AS payment_method,
          COALESCE(o.payment_status, '') AS payment_status,
          COALESCE(o.status, '') AS status
        FROM orders o
        WHERE o.created_at >= ${fromTs}::timestamp
          AND o.created_at <= ${toTs}::timestamp
          AND COALESCE(o.delivery_fee, 0) > 0
          AND (${customer} = '' OR o.customer_name ILIKE ${customerLike} OR COALESCE(o.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR o.payment_method = ${paymentMethod})
          AND (${product} = '' OR EXISTS (
            SELECT 1 FROM order_items oi
            WHERE oi.order_id = o.id
              AND (oi.product_name ILIKE ${productLike} OR oi.product_id::text = ${product})
          ))
          AND (${category} = '' OR EXISTS (
            SELECT 1
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE oi.order_id = o.id
              AND (p.category_id::text = ${category} OR p.subcategory_id::text = ${category}
                OR COALESCE(p.category, '') ILIKE ${categoryLike}
                OR COALESCE(c.name_ar, c.name, c.slug, '') ILIKE ${categoryLike})
          ))
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT 1000
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    if (type === "returns") {
      const rows = await db.execute(sql`
        SELECT
          si.invoice_no,
          si.date::text AS date,
          COALESCE(NULLIF(si.customer_name, ''), 'زبون') AS customer_name,
          COALESCE(si.customer_phone, '') AS customer_phone,
          si.status,
          si.total::text AS total
        FROM sales_invoices si
        WHERE si.status IN ('returned', 'refunded', 'return')
          AND si.date >= ${from}
          AND si.date <= ${to}
          AND (${customer} = '' OR si.customer_name ILIKE ${customerLike} OR COALESCE(si.customer_phone, '') ILIKE ${customerLike})
          AND (${paymentMethod} = '' OR si.payment_method = ${paymentMethod})
        ORDER BY si.date DESC, si.id DESC
        LIMIT 500
      `);
      return json({ type, from, to, rows: rows.rows ?? [] });
    }

    return error("نوع التقرير غير مدعوم", 400);
  }

  if (reportType === "sales-summary") {
    const salesConds: any[] = [
      sql`${salesInvoicesTable.status} = 'active'`,
      gte(salesInvoicesTable.date, from),
      lte(salesInvoicesTable.date, to),
    ];
    const [salesRow] = await db.select({
      total: sql<string>`COALESCE(SUM(total)::text, '0')`,
      paid: sql<string>`COALESCE(SUM(paid_amount)::text, '0')`,
      remaining: sql<string>`COALESCE(SUM(remaining_amount)::text, '0')`,
      count: sql<number>`count(*)::int`,
      discount: sql<string>`COALESCE(SUM(discount_amount)::text, '0')`,
    }).from(salesInvoicesTable).where(and(...salesConds) as any);

    const purchaseConds: any[] = [
      sql`${purchaseInvoicesTable.status} = 'active'`,
      gte(purchaseInvoicesTable.date, from),
      lte(purchaseInvoicesTable.date, to),
    ];
    const [purchaseRow] = await db.select({
      total: sql<string>`COALESCE(SUM(total)::text, '0')`,
      count: sql<number>`count(*)::int`,
    }).from(purchaseInvoicesTable).where(and(...purchaseConds) as any);

    const expenseConds: any[] = [
      gte(expensesTable.date, from),
      lte(expensesTable.date, to),
      sql`${expensesTable.deletedAt} is null`,
      sql`coalesce(${expensesTable.approvalStatus}, 'executed') = 'executed'`,
    ];
    const [expenseRow] = await db.select({
      total: sql<string>`COALESCE(SUM(amount)::text, '0')`,
    }).from(expensesTable).where(and(...expenseConds) as any);

    const orderConds: any[] = [gte(ordersTable.createdAt, new Date(from)), lte(ordersTable.createdAt, new Date(to + "T23:59:59"))];
    const [orderRow] = await db.select({
      total: sql<string>`COALESCE(SUM((total::numeric - delivery_fee::numeric))::text, '0')`,
      grossTotal: sql<string>`COALESCE(SUM(total)::text, '0')`,
      deliveryTotal: sql<string>`COALESCE(SUM(delivery_fee)::text, '0')`,
      count: sql<number>`count(*)::int`,
    }).from(ordersTable).where(and(...orderConds) as any);

    const salesTotal = parseFloat(salesRow?.total ?? "0");
    const purchaseTotal = parseFloat(purchaseRow?.total ?? "0");
    const expenseTotal = parseFloat(expenseRow?.total ?? "0");
    const ordersTotal = parseFloat(orderRow?.total ?? "0");
    const ordersGrossTotal = parseFloat(orderRow?.grossTotal ?? "0");
    const orderDeliveryTotal = parseFloat(orderRow?.deliveryTotal ?? "0");
    const grossProfit = salesTotal + ordersTotal - purchaseTotal;
    const netProfit = grossProfit - expenseTotal;

    return json({
      from, to,
      totalSales: salesTotal,
      totalPurchases: purchaseTotal,
      totalOrders: ordersTotal,
      totalOrderGross: ordersGrossTotal,
      totalDelivery: orderDeliveryTotal,
      grossProfit,
      netProfit,
      salesCount: salesRow?.count ?? 0,
      purchasesCount: purchaseRow?.count ?? 0,
      ordersCount: orderRow?.count ?? 0,
      sales: { total: salesTotal, paid: parseFloat(salesRow?.paid ?? "0"), remaining: parseFloat(salesRow?.remaining ?? "0"), count: salesRow?.count ?? 0, discount: parseFloat(salesRow?.discount ?? "0") },
      purchases: { total: purchaseTotal, count: purchaseRow?.count ?? 0 },
      orders: { total: ordersTotal, grossTotal: ordersGrossTotal, deliveryTotal: orderDeliveryTotal, count: orderRow?.count ?? 0 },
      expenses: { total: expenseTotal },
    });
  }

  if (reportType === "sales-by-day") {
    const rows = await db.execute(sql`
      SELECT date::text as date, COUNT(*)::int as count, SUM(total)::text as total, SUM(paid_amount)::text as paid
      FROM sales_invoices
      WHERE status = 'active' AND date >= ${from} AND date <= ${to}
      GROUP BY date ORDER BY date
    `);
    return json(rows.rows ?? []);
  }

  if (reportType === "sales-by-product") {
    const rows = await db.execute(sql`
      SELECT sii.product_name, sii.product_id,
        SUM(sii.quantity)::text as qty_sold, SUM(sii.total)::text as total_revenue,
        SUM(sii.total - sii.cost_price * sii.quantity)::text as gross_profit
      FROM sales_invoice_items sii
      JOIN sales_invoices si ON si.id = sii.invoice_id
      WHERE si.status = 'active' AND si.date >= ${from} AND si.date <= ${to}
      GROUP BY sii.product_name, sii.product_id
      ORDER BY SUM(sii.total) DESC LIMIT 50
    `);
    return json(rows.rows ?? []);
  }

  if (reportType === "profit-by-invoice") {
    const rows = await db.execute(sql`
      SELECT si.id, si.invoice_no, si.date, si.customer_name, si.total,
        COALESCE((SELECT SUM(sii.cost_price * sii.quantity) FROM sales_invoice_items sii WHERE sii.invoice_id = si.id), 0)::text as total_cost,
        (si.total - COALESCE((SELECT SUM(sii.cost_price * sii.quantity) FROM sales_invoice_items sii WHERE sii.invoice_id = si.id), 0))::text as profit
      FROM sales_invoices si
      WHERE si.status = 'active' AND si.date >= ${from} AND si.date <= ${to}
      ORDER BY si.date DESC, si.id DESC LIMIT 100
    `);
    return json(rows.rows ?? []);
  }

  if (reportType === "orders-revenue") {
    const rows = await db.execute(sql`
      SELECT DATE(created_at)::text as date, COUNT(*)::int as count, SUM(total)::text as total
      FROM orders
      WHERE created_at >= ${from}::timestamp AND created_at <= (${to}::date + interval '1 day')::timestamp
      GROUP BY DATE(created_at) ORDER BY DATE(created_at)
    `);
    return json(rows.rows ?? []);
  }

  return null;
}

async function handleDailyCash(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "daily-cash") return null;
  const auth = await requirePermission(req, "accounting");
  if (isResponse(auth)) return auth;

  const method = req.method;
  const resource = parts[2] ?? "reports";
  const financeActor = () => ({ ...actor(auth), canOverride: auth.role === "admin" });

  if (method === "GET" && resource === "summary") {
    return json(await getDailyCashDashboardSummary());
  }

  if (method === "GET" && resource === "dashboard") {
    const date = req.nextUrl.searchParams.get("date") ?? undefined;
    return json(await getFinanceDashboard(date || undefined));
  }

  if (method === "GET" && resource === "suggest-opening") {
    const date = req.nextUrl.searchParams.get("date");
    if (!date) return error("التاريخ مطلوب", 400);
    return json({ openingBalance: await suggestOpeningBalance(date) });
  }

  if (method === "POST" && resource === "close") {
    const payload = await body(req);
    const date = String(payload?.reportDate ?? "");
    if (!date) return error("التاريخ مطلوب", 400);
    try {
      const row = await closeDailyCashDay(date, financeActor());
      void logAdminActivity(req, "daily_cash_day_closed", "daily_cash_report", undefined, { reportDate: row.reportDate, closingBalance: row.closingBalance });
      void notifyTelegramDailyReport({
        event: "dailyCashClosed",
        reportDate: row.reportDate,
        openingBalance: row.openingBalance,
        totalRevenue: row.totalSales,
        totalExpenses: row.totalExpenses,
        closingBalance: row.closingBalance,
        createdByName: auth.fullName || auth.username,
      });
      return json(row);
    } catch (err: any) {
      return error(err?.message || "تعذّر إقفال اليوم", 400);
    }
  }

  if (method === "POST" && resource === "reopen") {
    const payload = await body(req);
    const date = String(payload?.reportDate ?? "");
    if (!date) return error("التاريخ مطلوب", 400);
    try {
      const row = await reopenDailyCashDay(date, financeActor());
      void logAdminActivity(req, "daily_cash_day_reopened", "daily_cash_report", undefined, { reportDate: row.reportDate });
      return json(row);
    } catch (err: any) {
      return error(err?.message || "تعذّر إعادة فتح اليوم", 403);
    }
  }

  if (method === "POST" && resource === "approve") {
    const payload = await body(req);
    const date = String(payload?.reportDate ?? "");
    if (!date) return error("التاريخ مطلوب", 400);
    try {
      const row = await approveDailyCashReconciliation(date, String(payload?.note ?? ""), financeActor());
      void logAdminActivity(req, "daily_cash_difference_approved", "daily_cash_reconciliation", undefined, { reportDate: row.reportDate, difference: row.difference });
      return json(row);
    } catch (err: any) {
      return error(err?.message || "تعذّر اعتماد الفرق", 403);
    }
  }

  if (method === "GET" && (resource === "reports" || resource === "reconciliation")) {
    const parsed = dailyCashListQuerySchema.safeParse(query(req));
    if (!parsed.success) return validationError("admin.daily-cash.list", parsed);
    return json(await listDailyCashRows(parsed.data));
  }

  if ((method === "POST" || method === "PATCH" || method === "PUT") && resource === "reports") {
    const payload = await body(req);
    const parsed = upsertDailyCashReportSchema.safeParse(payload);
    if (!parsed.success) return validationError("admin.daily-cash.report", parsed);
    let row;
    try {
      row = await upsertDailyCashReport(parsed.data, financeActor());
    } catch (err: any) {
      return error(err?.message || "تعذّر حفظ التقرير", 400);
    }
    void logAdminActivity(req, "daily_cash_report_saved", "daily_cash_report", undefined, {
      reportDate: row.reportDate,
      closingBalance: row.closingBalance,
    });
    void notifyTelegramDailyReport({
      event: "dailyReport",
      reportDate: row.reportDate,
      openingBalance: row.openingBalance,
      totalRevenue: row.totalSales,
      totalExpenses: row.totalExpenses,
      closingBalance: row.closingBalance,
      createdByName: auth.fullName || auth.username,
    });
    return json(row);
  }

  if ((method === "POST" || method === "PATCH" || method === "PUT") && resource === "reconciliation") {
    const payload = await body(req);
    const parsed = upsertDailyCashReconciliationSchema.safeParse(payload);
    if (!parsed.success) return validationError("admin.daily-cash.reconciliation", parsed);
    let row;
    try {
      row = await upsertDailyCashReconciliation(parsed.data, financeActor());
    } catch (err: any) {
      return error(err?.message || "تعذّر حفظ الجرد", 400);
    }
    void logAdminActivity(req, "daily_cash_reconciliation_saved", "daily_cash_reconciliation", undefined, {
      reportDate: row.reportDate,
      status: row.status,
      difference: row.difference,
    });
    return json(row);
  }

  return error("مسار الصندوق اليومي غير مدعوم", 404);
}

async function handlePrintTemplates(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "print-templates") return null;
  const auth = await requirePermission(req, "accounting");
  if (isResponse(auth)) return auth;
  await ensurePrintTemplatesTables();
  const method = req.method;
  const id = parts[2] ? int(parts[2]) : null;

  if (method === "GET" && !id) {
    const typeFilter = req.nextUrl.searchParams.get("type") ?? undefined;
    const rows = await db.select().from(printTemplatesTable)
      .where(typeFilter ? eq(printTemplatesTable.type, typeFilter) : undefined)
      .orderBy(desc(printTemplatesTable.isDefault), printTemplatesTable.name);
    return json(rows);
  }

  if (method === "GET" && id) {
    const row = await db.query.printTemplatesTable.findFirst({ where: eq(printTemplatesTable.id, id) });
    if (!row) return error("القالب غير موجود", 404);
    return json(row);
  }

  if (method === "POST") {
    const b = await body(req);
    const a = actor(auth);
    if (!b.name?.trim()) return error("اسم القالب مطلوب", 400);
    const config = normalizePrintTemplateConfig(b.config);
    if (!config) return error("إعدادات القالب غير صالحة. تأكد أن JSON صحيح.", 400);
    const [row] = await db.insert(printTemplatesTable).values({
      name: b.name.trim(),
      type: b.type ?? "sales",
      paperSize: b.paperSize ?? "a4",
      isDefault: b.isDefault ? 1 : 0,
      config,
      createdBy: a.id,
    } as any).returning();
    if (b.isDefault) {
      await db.execute(sql`UPDATE print_templates SET is_default = 0 WHERE type = ${b.type ?? "sales"} AND id != ${row.id}`);
    }
    void logAdminActivity(req, "print_template_created", "print_template", row.id, { name: row.name, type: row.type });
    return json(row, 201);
  }

  if (method === "PUT" && id) {
    const b = await body(req);
    const update: any = { updatedAt: new Date() };
    if (b.name !== undefined) update.name = b.name.trim();
    if (b.type !== undefined) update.type = b.type;
    if (b.paperSize !== undefined) update.paperSize = b.paperSize;
    if (b.isDefault !== undefined) update.isDefault = b.isDefault ? 1 : 0;
    if (b.config !== undefined) {
      const config = normalizePrintTemplateConfig(b.config);
      if (!config) return error("إعدادات القالب غير صالحة. تأكد أن JSON صحيح.", 400);
      update.config = config;
    }
    const [row] = await db.update(printTemplatesTable).set(update).where(eq(printTemplatesTable.id, id!)).returning();
    if (!row) return error("غير موجود", 404);
    if (b.isDefault) {
      await db.execute(sql`UPDATE print_templates SET is_default = 0 WHERE type = ${row.type} AND id != ${id}`);
    }
    void logAdminActivity(req, "print_template_updated", "print_template", row.id, { fields: Object.keys(update) });
    return json(row);
  }

  if (method === "DELETE" && id) {
    await db.delete(printTemplatesTable).where(eq(printTemplatesTable.id, id!));
    void logAdminActivity(req, "print_template_deleted", "print_template", id!);
    return json({ message: "تم الحذف" });
  }

  return null;
}

function normalizePrintTemplateConfig(value: unknown): string | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value ?? {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

const DEFAULT_EXPENSE_CATEGORIES: { name: string; nameAr: string }[] = [
  { name: "rent", nameAr: "الإيجار" },
  { name: "salaries", nameAr: "الرواتب" },
  { name: "fuel", nameAr: "الوقود" },
  { name: "transportation", nameAr: "النقل" },
  { name: "utilities", nameAr: "الخدمات" },
  { name: "purchases", nameAr: "المشتريات" },
  { name: "marketing", nameAr: "التسويق" },
  { name: "maintenance", nameAr: "الصيانة" },
  { name: "delivery", nameAr: "التوصيل" },
  { name: "miscellaneous", nameAr: "متفرقات" },
];

let expenseManagementReady: Promise<void> | null = null;
async function ensureExpenseManagementTables() {
  if (!expenseManagementReady) {
    expenseManagementReady = db.execute(sql`
      CREATE TABLE IF NOT EXISTS "expense_categories" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL,
        "name_ar" text NOT NULL,
        "is_active" integer NOT NULL DEFAULT 1,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "expenses" (
        "id" serial PRIMARY KEY,
        "date" date NOT NULL DEFAULT now(),
        "name" text NOT NULL DEFAULT '',
        "amount" numeric(12,2) NOT NULL,
        "category_id" integer REFERENCES "expense_categories" ("id") ON DELETE SET NULL,
        "category_name" text NOT NULL DEFAULT '',
        "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
        "receipt_image" text,
        "notes" text,
        "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "created_by_name" text NOT NULL DEFAULT '',
        "updated_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
        "updated_by_name" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp
      );

      ALTER TABLE "expense_categories"
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

      ALTER TABLE "expenses"
        ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "payment_method" varchar(20) NOT NULL DEFAULT 'cash',
        ADD COLUMN IF NOT EXISTS "receipt_image" text,
        ADD COLUMN IF NOT EXISTS "updated_by" integer,
        ADD COLUMN IF NOT EXISTS "updated_by_name" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

      CREATE INDEX IF NOT EXISTS "expenses_date_idx" ON "expenses" ("date");
      CREATE INDEX IF NOT EXISTS "expenses_category_id_idx" ON "expenses" ("category_id");
      CREATE INDEX IF NOT EXISTS "expenses_payment_method_idx" ON "expenses" ("payment_method");
      CREATE INDEX IF NOT EXISTS "expenses_created_by_idx" ON "expenses" ("created_by");
      CREATE INDEX IF NOT EXISTS "expenses_deleted_at_idx" ON "expenses" ("deleted_at");
    `).then(() => undefined).catch((err) => {
      expenseManagementReady = null;
      throw err;
    });
  }
  await expenseManagementReady;
}

async function ensureAccountingVoucherTables() {
  if (!accountingTablesPromise) {
    accountingTablesPromise = ensureExpenseManagementTables()
      .then(() => db.execute(sql`
        CREATE TABLE IF NOT EXISTS "receipt_vouchers" (
          "id" serial PRIMARY KEY,
          "voucher_no" varchar(30) NOT NULL UNIQUE,
          "date" date NOT NULL DEFAULT now(),
          "amount" numeric(12,2) NOT NULL,
          "payer_name" text NOT NULL,
          "customer_id" integer REFERENCES "customers" ("id") ON DELETE SET NULL,
          "order_id" integer REFERENCES "orders" ("id") ON DELETE SET NULL,
          "booking_id" integer REFERENCES "service_orders" ("id") ON DELETE SET NULL,
          "reference" text,
          "method" varchar(20) NOT NULL DEFAULT 'cash',
          "notes" text,
          "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
          "created_by_name" text NOT NULL DEFAULT '',
          "created_at" timestamp NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "payment_vouchers" (
          "id" serial PRIMARY KEY,
          "voucher_no" varchar(30) NOT NULL UNIQUE,
          "date" date NOT NULL DEFAULT now(),
          "amount" numeric(12,2) NOT NULL,
          "payee_name" text NOT NULL,
          "reference" text,
          "method" varchar(20) NOT NULL DEFAULT 'cash',
          "notes" text,
          "created_by" integer REFERENCES "staff" ("id") ON DELETE SET NULL,
          "created_by_name" text NOT NULL DEFAULT '',
          "created_at" timestamp NOT NULL DEFAULT now()
        );

        ALTER TABLE "receipt_vouchers"
          ADD COLUMN IF NOT EXISTS "voucher_no" varchar(30),
          ADD COLUMN IF NOT EXISTS "date" date NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS "amount" numeric(12,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "payer_name" text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS "customer_id" integer,
          ADD COLUMN IF NOT EXISTS "order_id" integer,
          ADD COLUMN IF NOT EXISTS "booking_id" integer,
          ADD COLUMN IF NOT EXISTS "reference" text,
          ADD COLUMN IF NOT EXISTS "method" varchar(20) NOT NULL DEFAULT 'cash',
          ADD COLUMN IF NOT EXISTS "notes" text,
          ADD COLUMN IF NOT EXISTS "created_by" integer,
          ADD COLUMN IF NOT EXISTS "created_by_name" text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();

        ALTER TABLE "payment_vouchers"
          ADD COLUMN IF NOT EXISTS "voucher_no" varchar(30),
          ADD COLUMN IF NOT EXISTS "date" date NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS "amount" numeric(12,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "payee_name" text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS "reference" text,
          ADD COLUMN IF NOT EXISTS "method" varchar(20) NOT NULL DEFAULT 'cash',
          ADD COLUMN IF NOT EXISTS "notes" text,
          ADD COLUMN IF NOT EXISTS "created_by" integer,
          ADD COLUMN IF NOT EXISTS "created_by_name" text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();

        CREATE UNIQUE INDEX IF NOT EXISTS "receipt_vouchers_voucher_no_idx" ON "receipt_vouchers" ("voucher_no");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_date_idx" ON "receipt_vouchers" ("date");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_customer_id_idx" ON "receipt_vouchers" ("customer_id");
        CREATE INDEX IF NOT EXISTS "receipt_vouchers_created_by_idx" ON "receipt_vouchers" ("created_by");

        CREATE UNIQUE INDEX IF NOT EXISTS "payment_vouchers_voucher_no_idx" ON "payment_vouchers" ("voucher_no");
        CREATE INDEX IF NOT EXISTS "payment_vouchers_date_idx" ON "payment_vouchers" ("date");
        CREATE INDEX IF NOT EXISTS "payment_vouchers_created_by_idx" ON "payment_vouchers" ("created_by");
      `))
      .then(() => undefined)
      .catch((err) => {
        accountingTablesPromise = null;
        throw err;
      });
  }
  await accountingTablesPromise;
}

async function ensureExpenseCategoriesSeeded() {
  await ensureExpenseManagementTables();
  for (const category of DEFAULT_EXPENSE_CATEGORIES) {
    const existing = await db.query.expenseCategoriesTable.findFirst({
      where: or(eq(expenseCategoriesTable.name, category.name), eq(expenseCategoriesTable.nameAr, category.nameAr)),
    });
    if (!existing) await db.insert(expenseCategoriesTable).values(category);
  }
}

function actor(user: AdminUser): { id: number | null; name: string } {
  return { id: user.id ?? null, name: user.fullName || user.username || "" };
}

function financialActor(user: AdminUser): FinancialActor {
  return { ...actor(user), role: user.role };
}

const SYSTEM_FINANCIAL_ACTOR: FinancialActor = { id: null, name: "النظام", role: "system" };

function serviceDepartment(service: { type?: string | null; name?: string | null; nameAr?: string | null } | null | undefined) {
  const value = `${service?.type ?? ""} ${service?.name ?? ""} ${service?.nameAr ?? ""}`.toLowerCase();
  if (/kosha|كوش/.test(value)) return "koshas";
  if (/photo|تصوير|album|ألبوم/.test(value)) return "photography";
  if (/audio|sound|dj|صوت/.test(value)) return "audio";
  if (/gift|هدي|توزيع/.test(value)) return "gifts";
  return "general";
}

async function syncOrderFinancialPayment(order: typeof ordersTable.$inferSelect, financeActorValue: FinancialActor) {
  const productAmount = Math.max(Number(order.total) - Number(order.deliveryFee), 0);
  const targetPaid = order.status === "cancelled" ? 0 : Math.min(Number(order.depositAmount), productAmount);
  return syncSourcePaymentTarget({
    sourceType: "order",
    sourceId: order.id,
    sourceEvent: "payment",
    targetAmount: targetPaid,
    normalDirection: "revenue",
    transactionDate: order.createdAt.toISOString().slice(0, 10),
    department: "store",
    transactionType: "store_order",
    description: `دفعة طلب ${order.trackingCode}`,
    paymentMethod: order.paymentMethod === "transfer" ? "transfer" : "cash",
    customerId: order.customerId,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    dueDate: order.dueDate,
    notes: order.notes,
    attachments: order.attachments ?? [],
  }, financeActorValue);
}

async function syncServiceOrderFinancialPayment(order: typeof serviceOrdersTable.$inferSelect, financeActorValue: FinancialActor) {
  const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, order.serviceId) });
  const targetPaid = order.status === "cancelled" ? 0 : Number(order.depositAmount);
  return syncSourcePaymentTarget({
    sourceType: "service_order",
    sourceId: order.id,
    sourceEvent: "payment",
    targetAmount: targetPaid,
    normalDirection: "revenue",
    transactionDate: order.createdAt.toISOString().slice(0, 10),
    department: serviceDepartment(service),
    transactionType: "service_booking",
    description: `دفعة حجز ${order.trackingCode ?? `#${order.id}`}`,
    paymentMethod: "cash",
    customerName: order.customerName,
    customerPhone: order.phone,
    dueDate: order.dueDate,
    notes: order.notes,
  }, financeActorValue);
}

async function syncKoshaFinancialPayment(order: typeof koshaBookingsTable.$inferSelect, financeActorValue: FinancialActor) {
  const targetPaid = order.status === "cancelled" ? 0 : Number(order.paidAmount);
  return syncSourcePaymentTarget({
    sourceType: "kosha_booking",
    sourceId: order.id,
    sourceEvent: "payment",
    targetAmount: targetPaid,
    normalDirection: "revenue",
    transactionDate: order.createdAt.toISOString().slice(0, 10),
    department: "koshas",
    transactionType: "kosha_booking",
    description: `دفعة حجز كوشة #${order.id}`,
    paymentMethod: "cash",
    customerName: order.customerName,
    customerPhone: order.phone,
    dueDate: order.dueDate,
    notes: order.notes,
  }, financeActorValue);
}

// ─────────────────────────────────────────────────────────────────────────────
// Kosha Staff Portal API  (/api/staff/koshas/*)
// ─────────────────────────────────────────────────────────────────────────────

function baghdadToday(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}
function parseEventDateIso(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  return null;
}
type CrewBucket = "today" | "tomorrow" | "upcoming" | "late" | "completed";
function crewBucket(row: any, today: string): CrewBucket {
  const stage = row.executionStage ?? row.execution_stage ?? "preparing";
  if (stage === "delivered") return "completed";
  const ev = parseEventDateIso(row.eventDate ?? row.event_date);
  if (!ev) return "upcoming";
  const day = 86400_000;
  const t = new Date(today + "T00:00:00Z").getTime();
  const e = new Date(ev + "T00:00:00Z").getTime();
  if (e === t) return "today";
  if (e === t + day) return "tomorrow";
  if (e > t + day) return "upcoming";
  return "late";
}

async function formatKoshaBookingForCrew(row: any) {
  const base = await formatKoshaBooking(row);
  return {
    ...base,
    executionStage: row.executionStage ?? row.execution_stage ?? "preparing",
    assignedStaffId: row.assignedStaffId ?? row.assigned_staff_id ?? null,
    bucket: crewBucket(row, baghdadToday()),
  };
}

async function addKoshaEvent(input: {
  bookingId: number; staff: AdminUser | null; type: string;
  fromStage?: string | null; toStage?: string | null; note?: string | null; meta?: Record<string, unknown>;
}) {
  const [row] = await db.insert(koshaBookingEventsTable).values({
    bookingId: input.bookingId,
    staffId: input.staff?.id ?? null,
    staffName: input.staff?.fullName || input.staff?.username || "",
    type: input.type,
    fromStage: input.fromStage ?? null,
    toStage: input.toStage ?? null,
    note: input.note ?? null,
    meta: input.meta ?? {},
  }).returning();
  return row;
}

async function addKoshaNotification(input: {
  staffId?: number | null; audience: "staff" | "manager"; type: string;
  title: string; body?: string | null; href?: string | null; bookingId?: number | null;
}) {
  try {
    await db.insert(koshaStaffNotificationsTable).values({
      staffId: input.staffId ?? null,
      audience: input.audience,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      bookingId: input.bookingId ?? null,
    });
  } catch (err) {
    console.warn("kosha notification insert failed", { type: input.type, error: err instanceof Error ? err.message : "unknown" });
  }
}

async function saveKoshaMedia(input: {
  bookingId: number; eventId?: number | null; staff: AdminUser | null;
  media: Array<{ url?: string; kind?: string }>; stage?: string | null; purpose: string;
}) {
  const saved: any[] = [];
  for (const m of input.media || []) {
    const cleaned = String(m?.url ?? "").trim();
    if (!cleaned) continue;
    const isVideo = m?.kind === "video" || cleaned.startsWith("data:video");
    const url = cleaned.startsWith("data:")
      ? await persistDataUrlToStorage(cleaned, `koshas/${input.purpose}/${input.bookingId}`)
      : cleaned;
    const [row] = await db.insert(koshaMediaTable).values({
      bookingId: input.bookingId,
      eventId: input.eventId ?? null,
      staffId: input.staff?.id ?? null,
      url,
      kind: isVideo ? "video" : "image",
      stage: input.stage ?? null,
      purpose: input.purpose,
    }).returning();
    saved.push(row);
  }
  return saved;
}

async function loadKoshaBookingDetail(bookingId: number) {
  const booking = await db.query.koshaBookingsTable.findFirst({ where: eq(koshaBookingsTable.id, bookingId) });
  if (!booking) return null;
  const [events, media, delivery, payments] = await Promise.all([
    db.query.koshaBookingEventsTable.findMany({ where: eq(koshaBookingEventsTable.bookingId, bookingId), orderBy: [asc(koshaBookingEventsTable.createdAt)] }),
    db.query.koshaMediaTable.findMany({ where: eq(koshaMediaTable.bookingId, bookingId), orderBy: [desc(koshaMediaTable.createdAt)] }),
    db.query.koshaDeliveryReportsTable.findFirst({ where: eq(koshaDeliveryReportsTable.bookingId, bookingId), orderBy: [desc(koshaDeliveryReportsTable.createdAt)] }),
    db.query.koshaPaymentRequestsTable.findMany({ where: eq(koshaPaymentRequestsTable.bookingId, bookingId), orderBy: [desc(koshaPaymentRequestsTable.createdAt)] }),
  ]);
  return {
    booking: await formatKoshaBookingForCrew(booking),
    timeline: events.map((e: any) => ({ ...e, createdAt: e.createdAt?.toISOString?.() ?? String(e.createdAt) })),
    media: media.map((m: any) => ({ ...m, createdAt: m.createdAt?.toISOString?.() ?? String(m.createdAt) })),
    delivery: delivery ? { ...delivery, compensationAmount: Number(delivery.compensationAmount), createdAt: delivery.createdAt?.toISOString?.() ?? String(delivery.createdAt) } : null,
    paymentRequests: payments.map((p: any) => ({ ...p, amount: Number(p.amount), createdAt: p.createdAt?.toISOString?.() ?? String(p.createdAt), reviewedAt: p.reviewedAt?.toISOString?.() ?? null })),
  };
}

async function handleStaffPortal(req: NextRequest, parts: string[]): Promise<NextResponse | null> {
  if (parts[1] !== "koshas") return null;
  const method = req.method;
  const resource = parts[2];           // dashboard | bookings | notifications | reports | payment-requests
  const id = parts[3] ? int(parts[3]) : null;
  const action = parts[4];
  await ensureKoshaStaffTables();

  // Manager-only endpoints (approve/reject collections, list pending requests).
  if (resource === "payment-requests") {
    const auth = await requireAnyPermission(req, ["accounting", "bookings"]);
    if (isResponse(auth)) return auth;

    if (method === "GET" && !id) {
      const status = req.nextUrl.searchParams.get("status") || "pending";
      const rows = await db.query.koshaPaymentRequestsTable.findMany({
        where: status === "all" ? undefined : eq(koshaPaymentRequestsTable.status, status),
        orderBy: [desc(koshaPaymentRequestsTable.createdAt)],
        limit: 200,
      });
      const out = await Promise.all(rows.map(async (r: any) => {
        const b = await db.query.koshaBookingsTable.findFirst({ where: eq(koshaBookingsTable.id, r.bookingId) });
        return {
          ...r, amount: Number(r.amount),
          createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
          reviewedAt: r.reviewedAt?.toISOString?.() ?? null,
          booking: b ? { id: b.id, customerName: b.customerName, totalAmount: Number(b.totalAmount), paidAmount: Number(b.paidAmount), remainingAmount: Number(b.remainingAmount) } : null,
        };
      }));
      return json(out);
    }

    if (method === "POST" && id && (action === "approve" || action === "reject")) {
      const reqRow = await db.query.koshaPaymentRequestsTable.findFirst({ where: eq(koshaPaymentRequestsTable.id, id) });
      if (!reqRow) return error("الطلب غير موجود", 404);
      if (reqRow.status !== "pending") return error("تمت معالجة هذا الطلب مسبقًا", 409);
      const booking = await db.query.koshaBookingsTable.findFirst({ where: eq(koshaBookingsTable.id, reqRow.bookingId) });
      if (!booking) return error("الحجز غير موجود", 404);

      if (action === "reject") {
        await db.update(koshaPaymentRequestsTable).set({
          status: "rejected", reviewedByStaffId: auth.id, reviewedByName: auth.fullName || auth.username, reviewedAt: new Date(),
        }).where(eq(koshaPaymentRequestsTable.id, id));
        await addKoshaEvent({ bookingId: booking.id, staff: auth, type: "payment_rejected", note: reqRow.note, meta: { amount: Number(reqRow.amount) } });
        await addKoshaNotification({ staffId: reqRow.staffId, audience: "staff", type: "payment_rejected", title: "رُفض تحصيل المبلغ", body: `رفض المدير تحصيل ${Number(reqRow.amount).toLocaleString("en-US")} د.ع`, href: `/staff/koshas/booking/${booking.id}`, bookingId: booking.id });
        return json({ ok: true, status: "rejected" });
      }

      // approve → record payment, push to finance.
      const amount = Number(reqRow.amount);
      const newPaid = Number(booking.paidAmount) + amount;
      const newRemaining = Math.max(0, Number(booking.remainingAmount) - amount);
      const paymentStatus = newRemaining <= 0 ? "paid" : "partial";
      const [updated] = await db.update(koshaBookingsTable).set({
        paidAmount: String(newPaid), remainingAmount: String(newRemaining), paymentStatus, updatedAt: new Date(),
      }).where(eq(koshaBookingsTable.id, booking.id)).returning();
      await db.update(koshaPaymentRequestsTable).set({
        status: "approved", reviewedByStaffId: auth.id, reviewedByName: auth.fullName || auth.username, reviewedAt: new Date(),
      }).where(eq(koshaPaymentRequestsTable.id, id));
      try {
        await syncKoshaFinancialPayment(updated, financialActor(auth));
      } catch (err) {
        console.error("kosha payment finance sync failed", { bookingId: booking.id, error: err instanceof Error ? err.message : "unknown" });
      }
      await addKoshaEvent({ bookingId: booking.id, staff: auth, type: "payment_approved", note: reqRow.note, meta: { amount } });
      await addKoshaNotification({ staffId: reqRow.staffId, audience: "staff", type: "payment_approved", title: "اعتُمد تحصيل المبلغ", body: `وافق المدير على تحصيل ${amount.toLocaleString("en-US")} د.ع ودخل النظام`, href: `/staff/koshas/booking/${booking.id}`, bookingId: booking.id });
      return json({ ok: true, status: "approved", paidAmount: newPaid, remainingAmount: newRemaining });
    }
    return error("المسار غير موجود", 404);
  }

  // Everything below requires the kosha staff permission.
  const auth = await requirePermission(req, "koshas");
  if (isResponse(auth)) return auth;

  // ── Dashboard ──
  if (resource === "dashboard" && method === "GET") {
    const today = baghdadToday();
    const rows = await db.query.koshaBookingsTable.findMany({ orderBy: [desc(koshaBookingsTable.createdAt)], limit: 500 });
    const active = rows.filter((r: any) => String(r.status ?? "") !== "cancelled");
    const counts: Record<CrewBucket, number> = { today: 0, tomorrow: 0, upcoming: 0, late: 0, completed: 0 };
    const todayList: any[] = []; const tomorrowList: any[] = [];
    for (const r of active) {
      const b = crewBucket(r, today);
      counts[b] += 1;
      if (b === "today") todayList.push(r);
      if (b === "tomorrow") tomorrowList.push(r);
    }
    return json({
      today,
      counts,
      todayBookings: await Promise.all(todayList.map(formatKoshaBookingForCrew)),
      tomorrowBookings: await Promise.all(tomorrowList.map(formatKoshaBookingForCrew)),
    });
  }

  // ── Bookings list ──
  if (resource === "bookings" && !id && method === "GET") {
    const bucket = req.nextUrl.searchParams.get("bucket") as CrewBucket | "all" | null;
    const search = (req.nextUrl.searchParams.get("search") || "").trim();
    const today = baghdadToday();
    let rows = await db.query.koshaBookingsTable.findMany({ orderBy: [desc(koshaBookingsTable.createdAt)], limit: 500 });
    rows = rows.filter((r: any) => String(r.status ?? "") !== "cancelled");
    if (bucket && bucket !== "all") rows = rows.filter((r: any) => crewBucket(r, today) === bucket);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r: any) =>
        String(r.customerName ?? "").toLowerCase().includes(q) ||
        String(r.phone ?? "").includes(q) ||
        String(r.hallLocation ?? "").toLowerCase().includes(q) ||
        String(r.cityArea ?? "").toLowerCase().includes(q));
    }
    return json(await Promise.all(rows.map(formatKoshaBookingForCrew)));
  }

  // ── Booking detail ──
  if (resource === "bookings" && id && !action && method === "GET") {
    const detail = await loadKoshaBookingDetail(id);
    return detail ? json(detail) : error("الحجز غير موجود", 404);
  }

  // ── Change execution stage ──
  if (resource === "bookings" && id && action === "stage" && method === "POST") {
    const data = await body(req);
    const toStage = String(data?.toStage ?? "").trim();
    if (!(KOSHA_EXECUTION_STAGES as readonly string[]).includes(toStage)) return error("مرحلة غير صحيحة", 400);
    if (toStage === "delivered") return error("استخدم نموذج التسليم لإكمال هذه المرحلة", 400);
    const booking = await db.query.koshaBookingsTable.findFirst({ where: eq(koshaBookingsTable.id, id) });
    if (!booking) return error("الحجز غير موجود", 404);
    const fromStage = (booking as any).executionStage ?? "preparing";
    const media: Array<{ url?: string; kind?: string }> = Array.isArray(data?.media) ? data.media : [];

    if (toStage === "executed" && media.length === 0) {
      return error("يجب رفع صورة واحدة على الأقل أو فيديو قبل حفظ مرحلة (تم التنفيذ)", 400);
    }
    const event = await addKoshaEvent({ bookingId: id, staff: auth, type: "stage", fromStage, toStage, note: data?.note ?? null });
    if (media.length) await saveKoshaMedia({ bookingId: id, eventId: event.id, staff: auth, media, stage: toStage, purpose: "execution" });
    await db.update(koshaBookingsTable).set({ executionStage: toStage, updatedAt: new Date() }).where(eq(koshaBookingsTable.id, id));
    return json(await loadKoshaBookingDetail(id));
  }

  // ── Standalone media upload ──
  if (resource === "bookings" && id && action === "media" && method === "POST") {
    const data = await body(req);
    const media: Array<{ url?: string; kind?: string }> = Array.isArray(data?.media) ? data.media : [];
    if (media.length === 0) return error("لا توجد ملفات للرفع", 400);
    const booking = await db.query.koshaBookingsTable.findFirst({ where: eq(koshaBookingsTable.id, id) });
    if (!booking) return error("الحجز غير موجود", 404);
    const event = await addKoshaEvent({ bookingId: id, staff: auth, type: "media", note: data?.note ?? null });
    await saveKoshaMedia({ bookingId: id, eventId: event.id, staff: auth, media, stage: (booking as any).executionStage, purpose: String(data?.purpose ?? "execution") });
    return json(await loadKoshaBookingDetail(id));
  }

  // ── Delivery report (تم التسليم) ──
  if (resource === "bookings" && id && action === "delivery" && method === "POST") {
    const data = await body(req);
    const hasLoss = Boolean(data?.hasLoss);
    const hasBreakage = Boolean(data?.hasBreakage);
    const note = String(data?.note ?? "").trim();
    const media: Array<{ url?: string; kind?: string }> = Array.isArray(data?.media) ? data.media : [];
    const compensation = Math.max(0, Number(data?.compensationAmount ?? 0) || 0);
    if ((hasLoss || hasBreakage) && (!note || media.length === 0)) {
      return error("عند وجود فقدان أو كسر يجب كتابة ملاحظة ورفع صورة واحدة على الأقل", 400);
    }
    const booking = await db.query.koshaBookingsTable.findFirst({ where: eq(koshaBookingsTable.id, id) });
    if (!booking) return error("الحجز غير موجود", 404);

    const event = await addKoshaEvent({ bookingId: id, staff: auth, type: "delivery", fromStage: (booking as any).executionStage ?? null, toStage: "delivered", note: note || null, meta: { hasLoss, hasBreakage, compensation } });
    if (media.length) await saveKoshaMedia({ bookingId: id, eventId: event.id, staff: auth, media, stage: "delivered", purpose: (hasLoss || hasBreakage) ? "breakage" : "delivery" });
    let signatureUrl: string | null = null;
    const sig = String(data?.signature ?? "").trim();
    if (sig) {
      const [m] = await saveKoshaMedia({ bookingId: id, eventId: event.id, staff: auth, media: [{ url: sig, kind: "image" }], stage: "delivered", purpose: "signature" });
      signatureUrl = m?.url ?? null;
    }

    const existing = await db.query.koshaDeliveryReportsTable.findFirst({ where: eq(koshaDeliveryReportsTable.bookingId, id) });
    if (existing) {
      await db.update(koshaDeliveryReportsTable).set({ staffId: auth.id, staffName: auth.fullName || auth.username, hasLoss, hasBreakage, note: note || null, compensationAmount: String(compensation), signatureUrl: signatureUrl ?? existing.signatureUrl }).where(eq(koshaDeliveryReportsTable.id, existing.id));
    } else {
      await db.insert(koshaDeliveryReportsTable).values({ bookingId: id, staffId: auth.id, staffName: auth.fullName || auth.username, hasLoss, hasBreakage, note: note || null, compensationAmount: String(compensation), signatureUrl });
    }

    // Breakage/loss compensation is added to the customer's remaining balance.
    const patch: Record<string, unknown> = { executionStage: "delivered", updatedAt: new Date() };
    if (compensation > 0) {
      const newRemaining = Number(booking.remainingAmount) + compensation;
      const newTotal = Number(booking.totalAmount) + compensation;
      patch.remainingAmount = String(newRemaining);
      patch.totalAmount = String(newTotal);
      patch.paymentStatus = newRemaining <= 0 ? "paid" : (Number(booking.paidAmount) > 0 ? "partial" : "unpaid");
    }
    await db.update(koshaBookingsTable).set(patch).where(eq(koshaBookingsTable.id, id));
    return json(await loadKoshaBookingDetail(id));
  }

  // ── Collect remaining balance → creates a pending request for the manager ──
  if (resource === "bookings" && id && action === "collect" && method === "POST") {
    const data = await body(req);
    const amount = Number(data?.amount ?? 0);
    const note = String(data?.note ?? "").trim();
    const booking = await db.query.koshaBookingsTable.findFirst({ where: eq(koshaBookingsTable.id, id) });
    if (!booking) return error("الحجز غير موجود", 404);
    const remaining = Number(booking.remainingAmount);
    if (!(amount > 0)) return error("أدخل مبلغًا صحيحًا", 400);
    if (amount > remaining) return error("المبلغ أكبر من المتبقي على العميل", 400);
    const pending = await db.query.koshaPaymentRequestsTable.findFirst({ where: and(eq(koshaPaymentRequestsTable.bookingId, id), eq(koshaPaymentRequestsTable.status, "pending")) });
    if (pending) return error("يوجد طلب تحصيل بانتظار موافقة المدير لهذا الحجز", 409);

    const [reqRow] = await db.insert(koshaPaymentRequestsTable).values({
      bookingId: id, staffId: auth.id, staffName: auth.fullName || auth.username, amount: String(amount), note: note || null, status: "pending",
    }).returning();
    await addKoshaEvent({ bookingId: id, staff: auth, type: "payment_request", note: note || null, meta: { amount } });
    await addKoshaNotification({ audience: "manager", type: "payment_request", title: "طلب تحصيل ميداني", body: `${auth.fullName || auth.username} استلم ${amount.toLocaleString("en-US")} د.ع — ${booking.customerName}`, href: "/staff/koshas/approvals", bookingId: id });
    return json({ ok: true, request: { ...reqRow, amount: Number(reqRow.amount) } }, 201);
  }

  // ── Notifications ──
  if (resource === "notifications") {
    const isManager = hasPermission(auth, "accounting") || hasPermission(auth, "bookings");
    if (method === "GET" && !id) {
      const rows = await db.query.koshaStaffNotificationsTable.findMany({
        where: isManager
          ? sql`(${koshaStaffNotificationsTable.audience} = 'manager' or ${koshaStaffNotificationsTable.staffId} = ${auth.id})`
          : and(eq(koshaStaffNotificationsTable.audience, "staff"), eq(koshaStaffNotificationsTable.staffId, auth.id)),
        orderBy: [desc(koshaStaffNotificationsTable.createdAt)],
        limit: 50,
      });
      return json(rows.map((n: any) => ({ ...n, createdAt: n.createdAt?.toISOString?.() ?? String(n.createdAt) })));
    }
    if (method === "POST" && parts[3] === "read-all") {
      await db.update(koshaStaffNotificationsTable).set({ isRead: true }).where(
        isManager ? sql`(${koshaStaffNotificationsTable.audience} = 'manager' or ${koshaStaffNotificationsTable.staffId} = ${auth.id})`
                  : and(eq(koshaStaffNotificationsTable.audience, "staff"), eq(koshaStaffNotificationsTable.staffId, auth.id)));
      return json({ ok: true });
    }
    if (method === "POST" && id && action === "read") {
      await db.update(koshaStaffNotificationsTable).set({ isRead: true }).where(eq(koshaStaffNotificationsTable.id, id));
      return json({ ok: true });
    }
  }

  // ── Per-staff report ──
  if (resource === "reports" && action === undefined && parts[3] === "me" && method === "GET") {
    const mine = eq(koshaBookingEventsTable.staffId, auth.id);
    const [executed, delivered, deliveryReports, approved] = await Promise.all([
      db.$count(koshaBookingEventsTable, and(mine, eq(koshaBookingEventsTable.type, "stage"), eq(koshaBookingEventsTable.toStage, "executed"))),
      db.$count(koshaBookingEventsTable, and(mine, eq(koshaBookingEventsTable.type, "delivery"))),
      db.query.koshaDeliveryReportsTable.findMany({ where: eq(koshaDeliveryReportsTable.staffId, auth.id) }),
      db.query.koshaPaymentRequestsTable.findMany({ where: and(eq(koshaPaymentRequestsTable.staffId, auth.id), eq(koshaPaymentRequestsTable.status, "approved")) }),
    ]);
    const breakage = deliveryReports.filter((r: any) => r.hasBreakage).length;
    const loss = deliveryReports.filter((r: any) => r.hasLoss).length;
    const collected = approved.reduce((s: number, r: any) => s + Number(r.amount), 0);
    return json({ executed: Number(executed), delivered: Number(delivered), breakage, loss, collected, collectedCount: approved.length });
  }

  return error("المسار غير موجود", 404);
}

async function handleTelegram(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "telegram") return null;
  const auth = await requirePermission(req, "settings");
  if (isResponse(auth)) return auth;
  const method = req.method;
  const resource = parts[2] ?? "settings";

  if (method === "GET" && resource === "settings") {
    return json({ settings: await getTelegramSettings(), environment: telegramEnvironmentStatus() });
  }

  if ((method === "PUT" || method === "PATCH") && resource === "settings") {
    const parsed = telegramSettingsSchema.safeParse(await body(req));
    if (!parsed.success) return validationError("admin.telegram.settings", parsed);
    const saved = await saveTelegramSettings(parsed.data);
    void logAdminActivity(req, "telegram_settings_updated", "settings", undefined, { enabled: saved.enabled, events: saved.events });
    return json({ settings: saved, environment: telegramEnvironmentStatus() });
  }

  if (method === "POST" && resource === "test-message") {
    const result = await sendTelegramMessage("✅ <b>رسالة اختبار من نظام AJN</b>\n\nتم ربط إشعارات Telegram بنجاح.");
    void logAdminActivity(req, "telegram_test_message", "settings", undefined, { ok: result.ok });
    return result.ok ? json({ message: "تم إرسال رسالة الاختبار" }) : error(result.error, result.error.includes("Environment") ? 400 : 502);
  }

  if (method === "POST" && resource === "test-pdf") {
    const result = await sendTelegramTestPdf();
    void logAdminActivity(req, "telegram_test_pdf", "settings", undefined, { ok: result.ok });
    return result.ok ? json({ message: "تم إرسال ملف PDF الاختباري" }) : error(result.error, result.error.includes("Environment") ? 400 : 502);
  }

  return error("مسار Telegram غير مدعوم", 404);
}

async function handleMasterCash(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "master-cash") return null;
  const method = req.method;
  const resource = parts[2];
  const id = parts[3] ? int(parts[3]) : null;
  const action = parts[4];
  const currentUser = await getAdminUser(req);
  if (!currentUser) return error("غير مخول", 401);

  // Any authenticated employee can submit a financial request. Ledger access
  // remains restricted to accounting users and managers.
  if (method === "POST" && resource === "transactions" && !id) {
    const parsed = financialTransactionInputSchema.safeParse(await body(req));
    if (!parsed.success) return validationError("master-cash.transaction.create", parsed);
    try {
      const row = await createFinancialTransaction(parsed.data, financialActor(currentUser));
      void logAdminActivity(req, "financial_transaction_created", "financial_transaction", row.id, {
        transactionNo: row.transactionNo,
        status: row.approvalStatus,
        direction: row.direction,
        amount: row.amount,
      });
      return json(row, 201);
    } catch (err: any) {
      console.error("financial transaction create failed", { message: err?.message, userId: currentUser.id });
      return error(err?.message || "تعذر إنشاء الطلب المالي", 400);
    }
  }

  const auth = await requirePermission(req, "accounting");
  if (isResponse(auth)) return auth;
  const financeUser = financialActor(auth);

  try {
    await ensureMasterCashBoxTables();

    if (method === "GET" && resource === "dashboard") {
      return json(await getMasterCashDashboard());
    }

    if (method === "GET" && resource === "transactions" && !id) {
      const parsed = financialTransactionListSchema.safeParse(query(req));
      if (!parsed.success) return validationError("master-cash.transaction.list", parsed);
      return json(await listFinancialTransactions(parsed.data));
    }

    if (resource === "transactions" && id) {
      if (method === "GET" && !action) {
        const row = await getFinancialTransaction(id);
        return row ? json(row) : error("المعاملة غير موجودة", 404);
      }

      if ((method === "PATCH" || method === "PUT") && !action) {
        const parsed = financialTransactionPatchSchema.safeParse(await body(req));
        if (!parsed.success) return validationError("master-cash.transaction.update", parsed);
        const row = await updateFinancialTransaction(id, parsed.data, financeUser);
        void logAdminActivity(req, "financial_transaction_updated", "financial_transaction", id, { reason: parsed.data.reason });
        return json(row);
      }

      if (method === "POST" && action === "submit") {
        const row = await submitFinancialTransaction(id, financeUser);
        void logAdminActivity(req, "financial_transaction_submitted", "financial_transaction", id);
        return json(row);
      }

      if (method === "POST" && action === "approve") {
        if (!canApproveFinancialTransactions(financeUser)) return error("اعتماد المعاملات متاح للمدير فقط", 403);
        const payload = await body(req);
        const row = await approveAndExecuteFinancialTransaction(id, financeUser, nullableText(payload?.note));
        void logAdminActivity(req, "financial_transaction_executed", "financial_transaction", id, {
          transactionNo: row.transactionNo,
          balanceBefore: row.balanceBefore,
          balanceAfter: row.balanceAfter,
        });
        if (row.direction === "revenue") {
          void notifyTelegramPayment({
            event: "managerApproval",
            reference: row.transactionNo,
            customerName: row.customerName || row.description,
            amount: row.amount,
            paymentMethod: row.paymentMethod,
            createdByName: financeUser.name,
            status: row.approvalStatus,
            entityPath: "/admin/finance/master-cash",
          });
        }
        return json(row);
      }

      if (method === "POST" && action === "reject") {
        if (!canApproveFinancialTransactions(financeUser)) return error("رفض المعاملات متاح للمدير فقط", 403);
        const payload = await body(req);
        const row = await rejectFinancialTransaction(id, financeUser, String(payload?.reason ?? ""));
        void logAdminActivity(req, "financial_transaction_rejected", "financial_transaction", id, { reason: row.rejectionReason });
        return json(row);
      }
    }

    if (method === "POST" && resource === "recalculate") {
      if (!canApproveFinancialTransactions(financeUser)) return error("إعادة احتساب الصندوق متاحة للمدير فقط", 403);
      const row = await recalculateMasterCashBox(financeUser);
      void logAdminActivity(req, "master_cash_recalculated", "master_cash_box", row.id);
      return json(row);
    }
  } catch (err: any) {
    console.error("master cash operation failed", {
      method,
      resource,
      id,
      action,
      userId: currentUser.id,
      message: err?.message,
    });
    const safeMessage = String(err?.message ?? "");
    const status = /غير موجود/.test(safeMessage) ? 404 : /صلاحية|متاح للمدير/.test(safeMessage) ? 403 : /رصيد|حالة|تعديل|مرسلة|مطلوب/.test(safeMessage) ? 409 : 500;
    return error(safeMessage || "تعذر إكمال العملية المالية", status);
  }

  return null;
}

const PAYMENT_METHODS_VO = ["cash", "transfer", "pos"] as const;
function normMethod(v: unknown): "cash" | "transfer" | "pos" {
  if (v === "card") return "pos";
  return (PAYMENT_METHODS_VO as readonly string[]).includes(v as string) ? (v as any) : "cash";
}

const expenseMutationSchema = z.object({
  date: z.preprocess((value) => normalizeDateOnly(value) ?? value, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح")),
  name: z.string().optional().default(""),
  categoryId: z.preprocess(
    (value) => typeof value === "string" ? normalizePhoneDigits(value) : value,
    z.coerce.number({ error: "التصنيف مطلوب" }).int().positive("التصنيف مطلوب"),
  ),
  amount: z.preprocess(
    (value) => parseAmount(value) ?? value,
    z.number({ error: "المبلغ مطلوب" }).positive("المبلغ يجب أن يكون أكبر من صفر"),
  ),
  paymentMethod: z.enum(["cash", "transfer", "pos", "card"], { error: "طريقة الدفع مطلوبة" }).transform((value) => value === "card" ? "pos" : value),
  notes: z.string().nullish(),
  receiptImage: z.string().nullish(),
});

const expenseCategoryMutationSchema = z.object({
  name: z.string().optional(),
  nameAr: z.string().min(1, "اسم التصنيف مطلوب"),
  isActive: z.boolean().optional(),
});

function parseAmount(v: unknown): number | null {
  const normalized = typeof v === "string"
    ? v
        .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
        .replace(/[٬,،\s]/g, "")
        .replace(/[٫]/g, ".")
    : v;
  const n = typeof normalized === "string" ? Number.parseFloat(normalized) : Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeDateOnly(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  const local = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(normalized);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : local
      ? { year: Number(local[3]), month: Number(local[2]), day: Number(local[1]) }
      : null;
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function fmtVoucherNo(prefix: string, id: number, createdAt: Date): string {
  const y = createdAt.getFullYear().toString().slice(-2);
  const m = String(createdAt.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${y}${m}-${String(id).padStart(4, "0")}`;
}

async function handleAccounting(req: NextRequest, parts: string[], section: string | undefined) {
  const method = req.method;

  if (section === "expense-categories") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
    await ensureExpenseManagementTables();
    if (method === "GET") {
      await ensureExpenseCategoriesSeeded();
      const includeAll = req.nextUrl.searchParams.get("all") === "1";
      const rows = await db.query.expenseCategoriesTable.findMany({
        where: includeAll ? undefined : eq(expenseCategoriesTable.isActive, 1),
        orderBy: (c, { asc }) => [asc(c.id)],
      });
      return json(rows);
    }
    if (method === "POST") {
      const parsed = expenseCategoryMutationSchema.safeParse(await body(req));
      if (!parsed.success) return validationError("expense-categories.create", parsed);
      const { name, nameAr, isActive } = parsed.data;
      const finalNameAr = textFallback(nameAr, name, "تصنيف مصروف جديد");
      const finalName = textFallback(name, nameAr, slugFallback(nameAr, `expense-${Date.now().toString(36)}`));
      const [row] = await db.insert(expenseCategoriesTable).values({ name: finalName, nameAr: finalNameAr, isActive: isActive === false ? 0 : 1 }).returning();
      void logAdminActivity(req, "expense_category_created", "expense_category", row.id, { name: row.nameAr });
      return json(row, 201);
    }
    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const parsed = expenseCategoryMutationSchema.partial().safeParse(await body(req));
      if (!parsed.success) return validationError("expense-categories.update", parsed);
      const b = parsed.data;
      const update: any = { updatedAt: new Date() };
      if (b?.name !== undefined) update.name = b.name;
      if (b?.nameAr !== undefined) update.nameAr = b.nameAr;
      if (b?.isActive !== undefined) update.isActive = b.isActive ? 1 : 0;
      if (update.name !== undefined && !String(update.name ?? "").trim()) delete update.name;
      if (update.nameAr !== undefined && !String(update.nameAr ?? "").trim()) delete update.nameAr;
      const [row] = await db.update(expenseCategoriesTable).set(update).where(eq(expenseCategoriesTable.id, id)).returning();
      if (!row) return error("غير موجود", 404);
      void logAdminActivity(req, "expense_category_updated", "expense_category", row.id, { fields: Object.keys(update) });
      return json(row);
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const used = await db.select({ c: sql<number>`count(*)::int` }).from(expensesTable).where(eq(expensesTable.categoryId, id));
      if ((used[0]?.c ?? 0) > 0) {
        return error(`لا يمكن الحذف — يوجد ${used[0].c} مصروف مرتبط بهذا النوع. عطّله بدل الحذف.`, 409);
      }
      await db.delete(expenseCategoriesTable).where(eq(expenseCategoriesTable.id, id));
      void logAdminActivity(req, "expense_category_deleted", "expense_category", id);
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "receipt-vouchers") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
    try {
      await ensureAccountingVoucherTables();
    } catch (err: any) {
      console.error("accounting vouchers table ensure failed", { section, message: err?.message });
      return error("تعذر تجهيز جداول الحسابات. تأكد من صلاحيات قاعدة البيانات ثم حاول مرة أخرى.", 500);
    }
    if (method === "GET") {
      const from = req.nextUrl.searchParams.get("from") ?? undefined;
      const to = req.nextUrl.searchParams.get("to") ?? undefined;
      const conds = [] as any[];
      if (from) conds.push(gte(receiptVouchersTable.date, from));
      if (to) conds.push(lte(receiptVouchersTable.date, to));
      const rows = await db
        .select()
        .from(receiptVouchersTable)
        .where(conds.length ? (and(...conds) as any) : undefined)
        .orderBy(desc(receiptVouchersTable.date), desc(receiptVouchersTable.id));
      return json(rows);
    }
    if (method === "POST") {
      const b = await body(req);
      let customerId = b?.customerId ?? null;
      const amt = parseAmount(b?.amount);
      if (amt === null) return error("المبلغ غير صحيح", 400);
      const voucherDate = normalizeDateOnly(b?.date) ?? new Date().toISOString().slice(0, 10);
      if (!customerId && typeof b?.customerPhone === "string" && b.customerPhone.trim()) {
        const normalizedPhone = normalizeIraqiPhone(b.customerPhone);
        if (!normalizedPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
        const c = await findCustomerByPhone(normalizedPhone);
        if (c) customerId = c.id;
      }
      const a = actor(auth);
      try {
        const [row] = await db
          .insert(receiptVouchersTable)
          .values({
            voucherNo: `TMP-${randomUUID()}`,
            date: voucherDate,
            amount: String(amt),
            payerName: textFallback(b?.payerName, "زبون"),
            customerId: customerId ?? null,
            orderId: b?.orderId ?? null,
            bookingId: b?.bookingId ?? null,
            reference: nullableText(b?.reference),
            method: normMethod(b?.method),
            notes: nullableText(b?.notes),
            createdBy: a.id,
            createdByName: a.name,
          })
          .returning();
        const [updated] = await db
          .update(receiptVouchersTable)
          .set({ voucherNo: fmtVoucherNo("REC", row.id, row.createdAt) })
          .where(eq(receiptVouchersTable.id, row.id))
          .returning();
        const financialTransaction = await createSourceFinancialRequest({
          transactionDate: updated.date,
          direction: "revenue",
          amount: Number(updated.amount),
          department: String(b?.department ?? "general"),
          transactionType: "receipt_voucher",
          description: `سند قبض من ${updated.payerName}`,
          paymentMethod: normMethod(updated.method),
          sourceType: "receipt_voucher",
          sourceId: updated.id,
          sourceEvent: "payment",
          idempotencyKey: `receipt_voucher:${updated.id}:payment`,
          customerId: updated.customerId,
          customerName: updated.payerName,
          notes: updated.notes,
          attachments: [],
        }, financialActor(auth));
        const [savedVoucher] = await db.update(receiptVouchersTable).set({
          approvalStatus: financialTransaction.approvalStatus,
          financialTransactionId: financialTransaction.id,
        }).where(eq(receiptVouchersTable.id, updated.id)).returning();
        void logAdminActivity(req, "receipt_voucher_created", "receipt_voucher", updated.id, { voucherNo: updated.voucherNo });
        void notifyTelegramPayment({
          event: "paymentReceived",
          reference: updated.voucherNo,
          customerName: updated.payerName,
          amount: updated.amount,
          paymentMethod: updated.method,
          createdByName: updated.createdByName || auth.fullName || auth.username,
          status: financialTransaction.approvalStatus,
          entityPath: "/admin/accounting",
        });
        return json(savedVoucher, 201);
      } catch (err: any) {
        console.error("receipt voucher save failed", { message: err?.message });
        return error("تعذر حفظ سند القبض. تحقق من البيانات أو صلاحيات قاعدة البيانات.", 500);
      }
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      try {
        const voucher = await db.query.receiptVouchersTable.findFirst({ where: eq(receiptVouchersTable.id, id) });
        if (!voucher) return error("سند القبض غير موجود", 404);
        if (voucher.financialTransactionId) {
          await cancelFinancialTransactionRequest(voucher.financialTransactionId, financialActor(auth), "إلغاء سند القبض");
        }
        await db.delete(receiptVouchersTable).where(eq(receiptVouchersTable.id, id));
      } catch (err: any) {
        console.error("receipt voucher delete failed", { id, message: err?.message });
        return error(err?.message || "تعذر حذف سند القبض.", /منفذة/.test(String(err?.message)) ? 409 : 500);
      }
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "payment-vouchers") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
    try {
      await ensureAccountingVoucherTables();
    } catch (err: any) {
      console.error("accounting vouchers table ensure failed", { section, message: err?.message });
      return error("تعذر تجهيز جداول الحسابات. تأكد من صلاحيات قاعدة البيانات ثم حاول مرة أخرى.", 500);
    }
    if (method === "GET") {
      const from = req.nextUrl.searchParams.get("from") ?? undefined;
      const to = req.nextUrl.searchParams.get("to") ?? undefined;
      const conds = [] as any[];
      if (from) conds.push(gte(paymentVouchersTable.date, from));
      if (to) conds.push(lte(paymentVouchersTable.date, to));
      const rows = await db
        .select()
        .from(paymentVouchersTable)
        .where(conds.length ? (and(...conds) as any) : undefined)
        .orderBy(desc(paymentVouchersTable.date), desc(paymentVouchersTable.id));
      return json(rows);
    }
    if (method === "POST") {
      const b = await body(req);
      const amt = parseAmount(b?.amount);
      if (amt === null) return error("المبلغ غير صحيح", 400);
      const voucherDate = normalizeDateOnly(b?.date) ?? new Date().toISOString().slice(0, 10);
      const a = actor(auth);
      try {
        const [row] = await db
          .insert(paymentVouchersTable)
          .values({
            voucherNo: `TMP-${randomUUID()}`,
            date: voucherDate,
            amount: String(amt),
            payeeName: textFallback(b?.payeeName, "مستلم"),
            reference: nullableText(b?.reference),
            method: normMethod(b?.method),
            notes: nullableText(b?.notes),
            createdBy: a.id,
            createdByName: a.name,
          })
          .returning();
        const [updated] = await db
          .update(paymentVouchersTable)
          .set({ voucherNo: fmtVoucherNo("PAY", row.id, row.createdAt) })
          .where(eq(paymentVouchersTable.id, row.id))
          .returning();
        const financialTransaction = await createSourceFinancialRequest({
          transactionDate: updated.date,
          direction: "expense",
          amount: Number(updated.amount),
          department: String(b?.department ?? "general"),
          transactionType: "payment_voucher",
          description: `سند صرف إلى ${updated.payeeName}`,
          paymentMethod: normMethod(updated.method),
          sourceType: "payment_voucher",
          sourceId: updated.id,
          sourceEvent: "payment",
          idempotencyKey: `payment_voucher:${updated.id}:payment`,
          notes: updated.notes,
          attachments: [],
        }, financialActor(auth));
        const [savedVoucher] = await db.update(paymentVouchersTable).set({
          approvalStatus: financialTransaction.approvalStatus,
          financialTransactionId: financialTransaction.id,
        }).where(eq(paymentVouchersTable.id, updated.id)).returning();
        void logAdminActivity(req, "payment_voucher_created", "payment_voucher", updated.id, { voucherNo: updated.voucherNo });
        return json(savedVoucher, 201);
      } catch (err: any) {
        console.error("payment voucher save failed", { message: err?.message });
        return error("تعذر حفظ سند الصرف. تحقق من البيانات أو صلاحيات قاعدة البيانات.", 500);
      }
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      try {
        const voucher = await db.query.paymentVouchersTable.findFirst({ where: eq(paymentVouchersTable.id, id) });
        if (!voucher) return error("سند الصرف غير موجود", 404);
        if (voucher.financialTransactionId) {
          await cancelFinancialTransactionRequest(voucher.financialTransactionId, financialActor(auth), "إلغاء سند الصرف");
        }
        await db.delete(paymentVouchersTable).where(eq(paymentVouchersTable.id, id));
      } catch (err: any) {
        console.error("payment voucher delete failed", { id, message: err?.message });
        return error(err?.message || "تعذر حذف سند الصرف.", /منفذة/.test(String(err?.message)) ? 409 : 500);
      }
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "expenses") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
    await ensureExpenseManagementTables();
    if (method === "GET") {
      const from = req.nextUrl.searchParams.get("from") ?? undefined;
      const to = req.nextUrl.searchParams.get("to") ?? undefined;
      const categoryId = numberId(req.nextUrl.searchParams.get("categoryId"));
      const paymentMethod = (req.nextUrl.searchParams.get("paymentMethod") ?? "").trim();
      const search = (req.nextUrl.searchParams.get("search") ?? "").trim();
      const user = (req.nextUrl.searchParams.get("user") ?? "").trim();
      const searchLike = `%${search}%`;
      const userLike = `%${user}%`;
      const conds = [] as any[];
      conds.push(sql`${expensesTable.deletedAt} is null`);
      if (from) conds.push(gte(expensesTable.date, from));
      if (to) conds.push(lte(expensesTable.date, to));
      if (categoryId) conds.push(eq(expensesTable.categoryId, categoryId));
      if (paymentMethod) conds.push(eq(expensesTable.paymentMethod, normMethod(paymentMethod)));
      if (search) conds.push(or(ilike(expensesTable.name, searchLike), ilike(expensesTable.categoryName, searchLike), ilike(expensesTable.notes, searchLike)));
      if (user) conds.push(ilike(expensesTable.createdByName, userLike));
      const rows = await db
        .select()
        .from(expensesTable)
        .where(conds.length ? (and(...conds) as any) : undefined)
        .orderBy(desc(expensesTable.date), desc(expensesTable.id));
      return json(rows);
    }
    if (method === "POST") {
      const parsed = expenseMutationSchema.safeParse(await body(req));
      if (!parsed.success) return validationError("expenses.create", parsed);
      const b = parsed.data;
      let categoryName = "";
      if (b?.categoryId) {
        const cat = await db.query.expenseCategoriesTable.findFirst({ where: eq(expenseCategoriesTable.id, b.categoryId) });
        categoryName = cat?.nameAr ?? "";
      }
      const a = actor(auth);
      const receiptImage = b?.receiptImage ? await persistMediaValue(b.receiptImage, "expenses") : null;
      const [row] = await db
        .insert(expensesTable)
        .values({
          date: b?.date || new Date().toISOString().slice(0, 10),
          name: textFallback(b?.name, categoryName || "مصروف"),
          amount: String(b.amount),
          categoryId: b?.categoryId ?? null,
          categoryName,
          paymentMethod: normMethod(b?.paymentMethod),
          receiptImage,
          notes: b?.notes ?? null,
          createdBy: a.id,
          createdByName: a.name,
          approvalStatus: "pending",
        })
        .returning();
      let financialTransaction;
      try {
        financialTransaction = await createSourceFinancialRequest({
          transactionDate: row.date,
          direction: "expense",
          amount: Number(row.amount),
          department: "general",
          transactionType: "expense",
          description: row.name || row.categoryName || "مصروف",
          paymentMethod: normMethod(row.paymentMethod),
          sourceType: "expense",
          sourceId: row.id,
          sourceEvent: "payment",
          idempotencyKey: `expense:${row.id}:payment`,
          notes: row.notes,
          attachments: row.receiptImage ? [row.receiptImage] : [],
        }, financialActor(auth));
      } catch (err: any) {
        await db.update(expensesTable).set({ deletedAt: new Date() }).where(eq(expensesTable.id, row.id));
        console.error("expense financial request failed", { expenseId: row.id, message: err?.message });
        return error("تعذر إنشاء الطلب المالي للمصروف، لم يتم حفظ المصروف", 500);
      }
      const [savedRow] = await db.update(expensesTable).set({
        financialTransactionId: financialTransaction.id,
        approvalStatus: financialTransaction.approvalStatus,
      }).where(eq(expensesTable.id, row.id)).returning();
      void logAdminActivity(req, "expense_created", "expense", row.id);
      return json(savedRow, 201);
    }
    if ((method === "PATCH" || method === "PUT") && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const parsed = expenseMutationSchema.partial().safeParse(await body(req));
      if (!parsed.success) return validationError("expenses.update", parsed);
      const b = parsed.data;
      const existingExpense = await db.query.expensesTable.findFirst({
        where: and(eq(expensesTable.id, id), sql`${expensesTable.deletedAt} is null`),
      });
      if (!existingExpense) return error("المصروف غير موجود", 404);
      const update: any = { updatedAt: new Date() };
      if (b.date !== undefined) update.date = b.date;
      if (b.amount !== undefined) update.amount = String(b.amount);
      if (b.categoryId !== undefined) {
        const cat = await db.query.expenseCategoriesTable.findFirst({ where: eq(expenseCategoriesTable.id, b.categoryId) });
        if (!cat) return error("تصنيف المصروف غير موجود", 400);
        update.categoryId = b.categoryId;
        update.categoryName = cat.nameAr;
      }
      if (b.name !== undefined) update.name = textFallback(b.name, update.categoryName, "مصروف");
      if (b.paymentMethod !== undefined) update.paymentMethod = normMethod(b.paymentMethod);
      if (b.notes !== undefined) update.notes = nullableText(b.notes);
      if (b.receiptImage !== undefined) update.receiptImage = b.receiptImage ? await persistMediaValue(b.receiptImage, "expenses") : null;
      const a = actor(auth);
      update.updatedBy = a.id;
      update.updatedByName = a.name;
      if (existingExpense.financialTransactionId) {
        try {
          await syncSourceFinancialRequest(existingExpense.financialTransactionId, {
            transactionDate: update.date ?? existingExpense.date,
            direction: "expense",
            amount: Number(update.amount ?? existingExpense.amount),
            department: "general",
            transactionType: "expense",
            description: update.name ?? existingExpense.name ?? existingExpense.categoryName ?? "مصروف",
            paymentMethod: update.paymentMethod ?? existingExpense.paymentMethod,
            sourceType: "expense",
            sourceId: existingExpense.id,
            sourceEvent: "payment",
            idempotencyKey: `expense:${existingExpense.id}:payment`,
            notes: update.notes ?? existingExpense.notes,
            attachments: [update.receiptImage ?? existingExpense.receiptImage].filter(Boolean),
          }, financialActor(auth), "تعديل المصروف المرتبط");
          update.approvalStatus = "pending";
        } catch (err: any) {
          return error(err?.message || "تعذر تحديث المعاملة المالية المرتبطة", 409);
        }
      }
      const [row] = await db.update(expensesTable).set(update).where(and(eq(expensesTable.id, id), sql`${expensesTable.deletedAt} is null`) as any).returning();
      if (!row) return error("المصروف غير موجود", 404);
      void logAdminActivity(req, "expense_updated", "expense", row.id, { fields: Object.keys(update) });
      return json(row);
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const existingExpense = await db.query.expensesTable.findFirst({
        where: and(eq(expensesTable.id, id), sql`${expensesTable.deletedAt} is null`),
      });
      if (!existingExpense) return error("المصروف غير موجود", 404);
      const a = actor(auth);
      if (existingExpense.financialTransactionId) {
        try {
          await cancelFinancialTransactionRequest(existingExpense.financialTransactionId, financialActor(auth), "إلغاء المصروف من الإدارة");
        } catch (err: any) {
          return error(err?.message || "لا يمكن حذف المصروف بعد تنفيذه مالياً", 409);
        }
      }
      const [row] = await db
        .update(expensesTable)
        .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: a.id, updatedByName: a.name })
        .where(and(eq(expensesTable.id, id), sql`${expensesTable.deletedAt} is null`) as any)
        .returning();
      if (!row) return error("المصروف غير موجود", 404);
      void logAdminActivity(req, "expense_deleted", "expense", id, { name: row.name, amount: row.amount });
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "accounting") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
    try {
      await ensureAccountingVoucherTables();
    } catch (err: any) {
      console.error("accounting tables ensure failed", { section, message: err?.message });
      return error("تعذر تجهيز جداول الحسابات. تأكد من صلاحيات قاعدة البيانات ثم حاول مرة أخرى.", 500);
    }
    if (method === "GET" && parts[2] === "statement") {
      const customerId = req.nextUrl.searchParams.get("customerId") ? Number.parseInt(req.nextUrl.searchParams.get("customerId")!, 10) : null;
      const rawPhoneParam = req.nextUrl.searchParams.get("phone")?.trim();
      const phoneParam = rawPhoneParam ? normalizeIraqiPhone(rawPhoneParam) : null;
      if (rawPhoneParam && !phoneParam) return error("رقم الهاتف العراقي غير صحيح", 400);
      let customer = null as any;
      if (customerId) customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, customerId) });
      if (!customer && phoneParam) customer = await findCustomerByPhone(phoneParam);
      const phone = customer?.phone ?? phoneParam ?? null;
      if (!phone) return error("اختر زبون أو رقم هاتف", 400);
      const phoneVariants = iraqiPhoneVariants(phone);
      const [orders, bookings, receipts] = await Promise.all([
        db.select().from(ordersTable).where(inArray(ordersTable.customerPhone, phoneVariants)).orderBy(desc(ordersTable.createdAt)),
        db.select().from(serviceOrdersTable).where(inArray(serviceOrdersTable.phone, phoneVariants)).orderBy(desc(serviceOrdersTable.createdAt)),
        customer
          ? db.select().from(receiptVouchersTable).where(eq(receiptVouchersTable.customerId, customer.id)).orderBy(desc(receiptVouchersTable.date))
          : Promise.resolve([] as any[]),
      ]);
      type Entry = {
        date: string;
        kind: "order" | "booking" | "receipt";
        ref: string;
        description: string;
        debit: number;
        credit: number;
      };
      const entries: Entry[] = [];
      for (const o of orders) {
        entries.push({ date: o.createdAt.toISOString(), kind: "order", ref: o.trackingCode, description: "طلب من المتجر", debit: Number.parseFloat(o.total), credit: 0 });
      }
      for (const b of bookings) {
        entries.push({ date: b.createdAt.toISOString(), kind: "booking", ref: b.trackingCode ?? `#${b.id}`, description: "حجز خدمة", debit: 0, credit: 0 });
      }
      for (const r of receipts) {
        entries.push({ date: new Date(r.date).toISOString(), kind: "receipt", ref: r.voucherNo, description: `سند قبض (${r.method})`, debit: 0, credit: Number.parseFloat(r.amount) });
      }
      entries.sort((a, b) => a.date.localeCompare(b.date));
      let running = 0;
      const withBalance = entries.map((e) => {
        running += e.debit - e.credit;
        return { ...e, balance: running };
      });
      return json({
        customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : { id: null, name: phone, phone },
        entries: withBalance,
        totals: {
          totalCharges: entries.reduce((s, e) => s + e.debit, 0),
          totalPayments: entries.reduce((s, e) => s + e.credit, 0),
          balance: running,
        },
      });
    }

    if (method === "GET" && parts[2] === "pnl") {
      const from = req.nextUrl.searchParams.get("from") || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const to = req.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
      const fromDate = new Date(`${from}T00:00:00.000Z`);
      const toDate = new Date(`${to}T23:59:59.999Z`);
      const [sales, receipts, payments, expensesByCat] = await Promise.all([
        db
          .select({ s: sql<number>`coalesce(sum((total::numeric - delivery_fee::numeric)),0)::float` })
          .from(ordersTable)
          .where(and(gte(ordersTable.createdAt, fromDate), lte(ordersTable.createdAt, toDate), sql`status <> 'cancelled'`)),
        db
          .select({ s: sql<number>`coalesce(sum(amount::numeric),0)::float` })
          .from(receiptVouchersTable)
          .where(and(
            gte(receiptVouchersTable.date, from),
            lte(receiptVouchersTable.date, to),
            sql`coalesce(${receiptVouchersTable.approvalStatus}, 'executed') = 'executed'`,
          )),
        db
          .select({ s: sql<number>`coalesce(sum(amount::numeric),0)::float` })
          .from(paymentVouchersTable)
          .where(and(
            gte(paymentVouchersTable.date, from),
            lte(paymentVouchersTable.date, to),
            sql`coalesce(${paymentVouchersTable.approvalStatus}, 'executed') = 'executed'`,
          )),
        db
          .select({
            categoryId: expensesTable.categoryId,
            categoryName: sql<string>`max(${expensesTable.categoryName})`,
            total: sql<number>`coalesce(sum(amount::numeric),0)::float`,
          })
          .from(expensesTable)
          .where(and(
            gte(expensesTable.date, from),
            lte(expensesTable.date, to),
            sql`${expensesTable.deletedAt} is null`,
            sql`coalesce(${expensesTable.approvalStatus}, 'executed') = 'executed'`,
          ))
          .groupBy(expensesTable.categoryId)
          .orderBy(sql`coalesce(sum(amount::numeric),0) desc`),
      ]);
      const totalSales = sales[0].s;
      const totalReceipts = receipts[0].s;
      const totalPayments = payments[0].s;
      const totalExpenses = expensesByCat.reduce((s, r) => s + r.total, 0);
      return json({
        from,
        to,
        totalSales,
        totalReceipts,
        totalPayments,
        totalExpenses,
        netProfit: totalReceipts - totalPayments - totalExpenses,
        expensesByCategory: expensesByCat.map((r) => ({
          categoryId: r.categoryId,
          categoryName: r.categoryName || "غير مصنف",
          total: r.total,
        })),
      });
    }
  }

  return null;
}

const BACKUP_ENTITIES = {
  orders: ordersTable,
  order_items: orderItemsTable,
  order_status_history: orderStatusHistoryTable,
  service_orders: serviceOrdersTable,
  service_order_status_history: serviceOrderStatusHistoryTable,
  products: productsTable,
  categories: categoriesTable,
  customers: customersTable,
  services: servicesTable,
  delivery_zones: deliveryZonesTable,
  gallery_items: galleryItemsTable,
  expense_categories: expenseCategoriesTable,
  receipt_vouchers: receiptVouchersTable,
  payment_vouchers: paymentVouchersTable,
  expenses: expensesTable,
  daily_cash_reports: dailyCashReportsTable,
  daily_cash_reconciliations: dailyCashReconciliationsTable,
  master_cash_box: masterCashBoxTable,
  financial_accounts: financialAccountsTable,
  financial_transactions: financialTransactionsTable,
  financial_ledger_entries: financialLedgerEntriesTable,
  financial_audit_logs: financialAuditLogsTable,
  customer_reward_history: customerRewardHistoryTable,
} as const;
type BackupEntity = keyof typeof BACKUP_ENTITIES;

function toCsv(rows: any[]): string {
  if (!rows.length) return "";
  const colsSet = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) colsSet.add(k);
  const cols = Array.from(colsSet);
  const esc = (v: any) => {
    if (v == null) return "";
    let s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return `\ufeff${cols.join(",")}\n${rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n")}`;
}

async function handleBackup(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "backup") return null;
  const auth = await requirePermission(req, "backup");
  if (isResponse(auth)) return auth;
  const method = req.method;

  if (method === "GET" && parts[2] === "export" && !parts[3]) {
    const out: Record<string, any[]> = {};
    for (const [name, table] of Object.entries(BACKUP_ENTITIES) as [string, any][]) {
      try {
        out[name] = await db.select().from(table);
      } catch {
        out[name] = [];
      }
    }
    const payload = { meta: { app: "ajn-platform", version: 1, exportedAt: new Date().toISOString() }, data: out };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return text(JSON.stringify(payload, null, 2), 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ajn-backup-${stamp}.json"`,
    });
  }

  if (method === "GET" && parts[2] === "export" && parts[3]) {
    const entity = parts[3] as BackupEntity;
    const fmt = (req.nextUrl.searchParams.get("format") ?? "json").toLowerCase();
    const table = BACKUP_ENTITIES[entity];
    if (!table) return error("كيان غير معروف", 404);
    const rows = await db.select().from(table as any);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (fmt === "csv") {
      return text(toCsv(rows), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ajn-${entity}-${stamp}.csv"`,
      });
    }
    return text(JSON.stringify(rows, null, 2), 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ajn-${entity}-${stamp}.json"`,
    });
  }

  if (method === "POST" && parts[2] === "import") {
    const b = await body(req);
    if (b?.confirm !== "AJN-IMPORT-CONFIRMED") return error("التأكيد مطلوب لاستيراد البيانات", 400);
    const data: Record<string, any[]> = (b?.payload?.data ?? b?.data ?? {}) as any;
    if (!data || typeof data !== "object") return error("صيغة غير صحيحة", 400);
    const report: Record<string, { inserted: number; skipped: number; errors: number }> = {};
    const order: BackupEntity[] = [
      "customers",
      "categories",
      "services",
      "products",
      "delivery_zones",
      "gallery_items",
      "expense_categories",
      "orders",
      "order_items",
      "order_status_history",
      "service_orders",
      "service_order_status_history",
      "customer_reward_history",
      "receipt_vouchers",
      "payment_vouchers",
      "expenses",
      "daily_cash_reports",
      "daily_cash_reconciliations",
      "master_cash_box",
      "financial_accounts",
      "financial_transactions",
      "financial_ledger_entries",
      "financial_audit_logs",
    ];
    for (const name of order) {
      const rows = Array.isArray(data[name]) ? data[name] : [];
      if (rows.length === 0) continue;
      const table = BACKUP_ENTITIES[name] as any;
      const stats = { inserted: 0, skipped: 0, errors: 0 };
      for (const row of rows) {
        try {
          const inserted = await db
            .insert(table)
            .values(row)
            .onConflictDoNothing()
            .returning({ id: table.id })
            .catch(async () => {
              await db.insert(table).values(row).onConflictDoNothing();
              return [{ id: -1 }];
            });
          if (inserted.length > 0) stats.inserted++;
          else stats.skipped++;
        } catch {
          stats.errors++;
        }
      }
      report[name] = stats;
    }
    return json({ ok: true, report });
  }

  return null;
}

export async function handleApi(req: NextRequest, rawParts: string[] = []) {
  const parts = rawParts.map((p) => decodeURIComponent(p)).filter(Boolean);
  const root = parts[0];
  const isAdminAuth = root === "admin" && parts[1] === "auth";

  try {
    if (!root && req.method === "GET") return json({ status: "ok" });
    if (req.method === "GET" && root === "healthz") return json({ status: "ok" });

    // Run all schema ensures in parallel — they are singleton-promise guarded, so
    // after first resolution each subsequent await is a microtask (effectively free).
    await Promise.all([
      (root === "auth" || root === "orders" || (!isAdminAuth && root === "admin") || root === "dashboard" || root === "customer")
        ? ensureCustomerProfileColumns() : undefined,
      (root === "products" || root === "services" || root === "gallery" || (!isAdminAuth && root === "admin") || root === "auth" || root === "customer" || root === "settings")
        ? ensureImageMetadataColumns() : undefined,
      (root === "cart" || root === "orders" || root === "products" || (!isAdminAuth && root === "admin") || root === "customer" || root === "dashboard")
        ? ensureProductColorColumns() : undefined,
      (root === "customer" || root === "orders" || root === "service-orders" || (!isAdminAuth && root === "admin") || root === "auth")
        ? ensureCustomerRewards() : undefined,
      (root === "orders" || root === "service-orders" || (!isAdminAuth && root === "admin") || root === "dashboard")
        ? Promise.all([ensureTrackingColumns(), ensurePaymentWorkflowColumns(), ensureArchiveColumns(), ensurePerformanceIndexes()]) : undefined,
      (root === "admin") ? ensureStaffActivityColumn() : undefined,
      (root === "admin") ? ensureAdminProductsColumns() : undefined,
      (root === "products" || (!isAdminAuth && root === "admin")) ? ensureStoreCategoryColumns() : undefined,
      (root === "coupons" || (!isAdminAuth && root === "admin")) ? ensureCouponsTables() : undefined,
      (root === "messages" || root === "activity" || root === "qr" || root === "notifications" || (!isAdminAuth && root === "admin")) ? ensureAdminExtensionsTables() : undefined,
      (root === "koshas" || (!isAdminAuth && root === "admin")) ? ensureKoshaTables() : undefined,
      (root === "staff") ? ensureKoshaStaffTables() : undefined,
      (root === "orders" || root === "service-orders" || root === "koshas" || (!isAdminAuth && root === "admin"))
        ? ensureMasterCashBoxTables() : undefined,
    ].filter(Boolean));

    const route =
      root === "auth"
        ? await handleAuth(req, parts)
        : root === "media"
          ? await handleMedia(req, parts)
        : root === "settings"
          ? await handlePublicSettings(req, parts)
          : root === "customer"
            ? await handleCustomer(req, parts)
        : root === "messages"
          ? await handlePublicMessages(req, parts)
          : root === "activity"
            ? await handleCustomerActivity(req, parts)
            : root === "qr"
              ? await handleQr(req, parts)
              : root === "notifications"
                ? await handleNotifications(req, parts)
        : root === "products"
          ? await handleProducts(req, parts)
          : root === "koshas"
            ? await handleKoshas(req, parts)
          : root === "offers"
            ? await handleOffers(req, parts)
          : root === "coupons"
            ? await handleCoupons(req, parts)
          : root === "services"
            ? await handleServices(req, parts)
            : root === "crews"
              ? await handleCrews(req, parts)
              : root === "service-orders"
                ? await handleServiceOrders(req, parts)
                : root === "cart"
                  ? await handleCart(req, parts)
                  : root === "orders"
                    ? await handleOrders(req, parts)
                    : root === "gallery"
                      ? await handleGallery(req, parts)
                      : root === "reviews"
                        ? await handleReviews(req, parts)
                        : root === "delivery-zones"
                          ? await handleDelivery(req, parts)
                          : root === "dashboard"
                            ? await handleDashboard(req, parts)
                            : root === "staff"
                              ? await handleStaffPortal(req, parts)
                            : root === "admin"
                              ? await handleAdmin(req, parts)
                              : null;

    return route ?? error("المسار غير موجود", 404);
  } catch (err) {
    console.error("API route failed", {
      method: req.method,
      path: req.nextUrl.pathname,
      error: err instanceof Error ? err.message : "unknown",
    });
    return error("تعذر إكمال العملية. حاول مرة أخرى، وإذا استمرت المشكلة راجع سجل الخادم.", 500);
  }
}
