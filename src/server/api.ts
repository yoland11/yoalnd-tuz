import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import bcrypt from "bcryptjs";
import { and, desc, eq, gt, gte, ilike, inArray, like, lt, lte, or, sql } from "drizzle-orm";
import {
  adminSessionsTable,
  adminActivityLogsTable,
  cartItemsTable,
  categoriesTable,
  crewsTable,
  customerAddressesTable,
  customerPreferencesTable,
  customerRewardHistoryTable,
  customersTable,
  deliveryZonesTable,
  expenseCategoriesTable,
  expensesTable,
  galleryItemsTable,
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
  whatsappLogTable,
  suppliersTable,
  salesInvoicesTable,
  salesInvoiceItemsTable,
  purchaseInvoicesTable,
  purchaseInvoiceItemsTable,
  printTemplatesTable,
  db,
} from "@workspace/db";
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
let imageMetadataColumnsPromise: Promise<void> | null = null;
let productColorColumnsPromise: Promise<void> | null = null;
let customerRewardsPromise: Promise<void> | null = null;
let performanceIndexesPromise: Promise<void> | null = null;

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

function slugFallback(value: unknown, fallback = "item"): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
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

function formatProduct(p: any, avgRating?: number, reviewCount?: number) {
  return {
    id: p.id,
    name: p.name,
    nameAr: p.nameAr,
    description: p.description ?? null,
    descriptionAr: p.descriptionAr ?? null,
    price: Number.parseFloat(p.price),
    originalPrice: p.originalPrice ? Number.parseFloat(p.originalPrice) : null,
    stock: p.stock,
    category: p.category ?? null,
    images: p.images ?? [],
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
      merged.set(key, { ...item, productName: name, productNameAr: nameAr, quantity });
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
    description: s.description ?? null,
    descriptionAr: s.descriptionAr ?? null,
    type: s.type,
    icon: s.icon ?? null,
    image: s.image ?? null,
    imageMetadata: s.imageMetadata ?? {},
    isActive: s.isActive,
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

async function ensureStaffActivityColumn(): Promise<void> {
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
        "action" varchar(80) not null,
        "entity_type" varchar(80),
        "entity_id" integer,
        "metadata" jsonb not null default '{}'::jsonb,
        "created_at" timestamp not null default now()
      )
    `)
      .then(() => db.execute(sql`create index if not exists "admin_activity_staff_created_idx" on "admin_activity_logs" ("staff_id", "created_at")`))
      .then(() => db.execute(sql`create index if not exists "admin_activity_action_created_idx" on "admin_activity_logs" ("action", "created_at")`))
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
      .then(() => db.execute(sql`create index if not exists "customer_reward_history_customer_created_idx" on "customer_reward_history" ("customer_id", "created_at")`))
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
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      metadata,
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

function rewardPointsForAmount(value: unknown): number {
  const total = Math.max(0, money(value));
  if (total <= 0) return 0;
  return Math.max(1, Math.floor(total / 10000));
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
  const points = rewardPointsForAmount(order.total);
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
  const points = rewardPointsForAmount(order.totalAmount);
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
  const productMap = new Map(products.map((product) => [product.id, product]));
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
            stock: product.stock,
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
    phoneLast4: order.phoneLast4 ?? phoneLast4(order.customerPhone),
    customerId: order.customerId ?? null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    status: order.status,
    serviceType: order.serviceType ?? null,
    total: Number.parseFloat(order.total),
    deliveryFee: Number.parseFloat(order.deliveryFee),
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
      image: i.image ?? null,
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
  return {
    trackingCode: order.trackingCode,
    id: order.id,
    phoneLast4: order.phoneLast4 ?? phoneLast4(order.customerPhone),
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone ?? null,
    serviceType: order.serviceType ?? null,
    kind: "product",
    total: Number.parseFloat(order.total),
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
      image: i.image ?? null,
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
  return {
    trackingCode: so.trackingCode ?? `SRV-${so.id}`,
    id: so.id,
    phoneLast4: so.phoneLast4 ?? phoneLast4(so.phone),
    status: so.status,
    customerName: so.customerName,
    customerPhone: so.phone ?? null,
    serviceType: service?.type ?? null,
    serviceName: service?.nameAr ?? service?.name ?? null,
    serviceImage: service?.image ?? null,
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
    if (!parsed.success) return error("رقم الهاتف مطلوب", 400);
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
    const phone = normalizeIraqiPhone(parsed.data.phone);
    const otp = normalizePhoneDigits(parsed.data.otp).slice(0, 6);
    if (!phone || otp.length !== 6) return error("بيانات غير صحيحة", 400);
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
    const avatarUrl = cleanPublicUrl(data?.avatarUrl ?? "");
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

  if (method === "GET" && parts[1] === "featured") {
    const products = await db.query.productsTable.findMany({
      where: eq(productsTable.isFeatured, true),
      limit: 8,
    });
    return json(products.map((p) => formatProduct(p)));
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
    const { category, search, inStock } = params.success ? params.data : {};
    const limit = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "80", 10) || 80, 1), 120);
    const offset = Math.max(Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const products = await db.query.productsTable.findMany({
      where: and(
        category ? eq(productsTable.category, category) : undefined,
        search ? ilike(productsTable.nameAr, `%${search}%`) : undefined,
        inStock ? sql`${productsTable.stock} > 0` : undefined,
      ),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
      limit,
      offset,
    });
    return json(products.map((p) => formatProduct(p)));
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
    return json(formatProduct(product, avgRating, reviews.length));
  }

  if (method === "POST" && parts.length === 1) {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    const parsed = CreateProductBody.safeParse(await body(req));
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
    const data = parsed.data as any;
    const productNameAr = textFallback(data.nameAr, data.name, "منتج جديد");
    const productName = textFallback(data.name, data.nameAr, `product-${Date.now().toString(36)}`);
    const [product] = await db
      .insert(productsTable)
      .values({
        name: productName,
        nameAr: productNameAr,
        description: data.description,
        descriptionAr: data.descriptionAr,
        price: String(money(data.price)),
        originalPrice: data.originalPrice?.toString(),
        stock: Number.isFinite(Number(data.stock)) ? Number(data.stock) : 0,
        category: data.category,
        images: data.images ?? [],
        imageMetadata: Array.isArray(data.imageMetadata) ? data.imageMetadata : [],
        colors: normalizeColors(data.colors ?? []),
        isFeatured: data.isFeatured ?? false,
        subcategory: data.subcategory ?? null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();
    void logAdminActivity(req, "product_created", "product", product.id, { name: product.nameAr });
    return json(formatProduct(product), 201);
  }

  if (method === "PATCH" && parts[1]) {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    const parsed = UpdateProductBody.safeParse(await body(req));
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
    const data = parsed.data as any;
    const update: any = { updatedAt: new Date() };
    for (const k of [
      "name",
      "nameAr",
      "description",
      "category",
      "images",
      "imageMetadata",
      "colors",
      "isFeatured",
      "descriptionAr",
      "subcategory",
      "isActive",
      "sortOrder",
      "stock",
    ]) {
      if (data[k] !== undefined) {
        if ((k === "name" || k === "nameAr") && !String(data[k] ?? "").trim()) continue;
        update[k] = k === "colors" ? normalizeColors(data[k]) : data[k];
      }
    }
    if (data.price !== undefined) update.price = data.price.toString();
    if (data.originalPrice !== undefined) update.originalPrice = data.originalPrice.toString();
    const [product] = await db.update(productsTable).set(update).where(eq(productsTable.id, id)).returning();
    if (!product) return error("المنتج غير موجود", 404);
    void logAdminActivity(req, "product_updated", "product", product.id, { fields: Object.keys(update) });
    return json(formatProduct(product));
  }

  if (method === "DELETE" && parts[1]) {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    await db.delete(productsTable).where(eq(productsTable.id, id));
    void logAdminActivity(req, "product_deleted", "product", id);
    return json({ message: "تم حذف المنتج" });
  }

  return null;
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
    const order = await insertServiceOrderWithTracking({
      serviceId: data.serviceId,
      customerName: safeCustomerName,
      phone,
      eventDate: data.eventDate ?? "",
      eventLocation,
      notes: data.notes,
      customFields,
    });
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
        serviceImage: serviceMap.get(booking.serviceId)?.image ?? null,
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
    const total = subtotal + deliveryFee;
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
          image: product?.images?.[0] ?? null,
        });
        if (product) {
          await db
            .update(productsTable)
            .set({ stock: Math.max(0, product.stock - item.quantity) })
            .where(eq(productsTable.id, product.id));
        }
      }),
    );
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
    const { status, notes } = parsed.data;
    const [order] = await db
      .update(ordersTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(ordersTable.id, id))
      .returning();
    if (!order) return error("الطلب غير موجود", 404);
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
        mediaUrl: i.mediaUrl,
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
    const [item] = await db.insert(galleryItemsTable).values(parsed.data).returning();
    void logAdminActivity(req, "gallery_created", "gallery", item.id, { mediaType: item.mediaType });
    return json(
      {
        id: item.id,
        mediaUrl: item.mediaUrl,
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
      db.select({ sum: sql<number>`coalesce(sum(total::numeric), 0)::float` }).from(ordersTable),
      db.select({ count: sql<number>`count(*)::int` }).from(productsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(customersTable),
      db.select({ count: sql<number>`count(*)::int` }).from(ordersTable).where(eq(ordersTable.status, "pending")),
      db.select({ count: sql<number>`count(*)::int` }).from(ordersTable).where(gte(ordersTable.createdAt, today)),
      db.select({ sum: sql<number>`coalesce(sum(total::numeric), 0)::float` }).from(ordersTable).where(gte(ordersTable.createdAt, today)),
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
  manager: ["dashboard", "orders", "bookings", "services", "products", "gallery", "delivery", "customers", "staff", "settings", "invoices", "whatsapp", "accounting"],
  booking_staff: ["dashboard", "orders", "bookings", "customers", "invoices", "whatsapp"],
  photographer: ["dashboard", "orders", "bookings", "gallery", "services", "whatsapp"],
  accountant: ["dashboard", "orders", "bookings", "customers", "invoices", "accounting"],
  staff: ["dashboard"],
};

function normalizeStaffRole(role: unknown): string {
  const value = String(role ?? "staff");
  return ["manager", "booking_staff", "photographer", "accountant", "staff"].includes(value) ? value : "staff";
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
    return json({
      points,
      level,
      levelLabel: rewardLabel(level),
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
      const product = await db.query.productsTable.findFirst({ where: eq(productsTable.id, item.productId) });
      if (!product || product.isActive === false || product.stock <= 0) continue;
      await db.insert(cartItemsTable).values({
        sessionId,
        productId: product.id,
        quantity: Math.min(item.quantity, Math.max(1, product.stock)),
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

async function handleAdmin(req: NextRequest, parts: string[]) {
  const method = req.method;
  const section = parts[1];

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
      if (token) await destroySession(token);
      return clearSessionCookie(json({ message: "تم الخروج" }));
    }

    if (method === "GET" && parts[2] === "me") {
      const user = await getAdminUser(req);
      if (!user) return error("غير مخول", 401);
      return json({ user: publicUser(user), allPermissions: ALL_PERMISSIONS });
    }
  }

  if (section === "dashboard" && method === "GET") {
    const auth = await requirePermission(req, "dashboard");
    if (isResponse(auth)) return auth;
    await ensurePaymentWorkflowColumns();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lateCutoff = new Date();
    lateCutoff.setDate(lateCutoff.getDate() - 3);
    const last30 = new Date();
    last30.setDate(last30.getDate() - 30);
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
      whatsappFailures,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(sql`${ordersTable.archivedAt} is null`),
      db.select({ c: sql<number>`count(*)::int` }).from(productsTable),
      db.select({ c: sql<number>`count(*)::int` }).from(customersTable),
      db.select({ s: sql<number>`coalesce(sum(total::numeric),0)::float` }).from(ordersTable).where(sql`${ordersTable.archivedAt} is null`),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(sql`status in ('pending','confirmed','processing','shipped')`, sql`${ordersTable.archivedAt} is null`)),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(eq(ordersTable.status, "cancelled"), sql`${ordersTable.archivedAt} is null`)),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(and(eq(ordersTable.status, "delivered"), sql`${ordersTable.archivedAt} is null`)),
      db.select({ s: sql<number>`coalesce(sum(total::numeric),0)::float` }).from(ordersTable).where(and(gte(ordersTable.createdAt, today), sql`${ordersTable.archivedAt} is null`)),
      db.select({ c: sql<number>`count(*)::int` }).from(serviceOrdersTable).where(sql`${serviceOrdersTable.archivedAt} is null`),
      db
        .select({
          day: sql<string>`to_char(created_at, 'YYYY-MM-DD')`,
          total: sql<number>`coalesce(sum(total::numeric),0)::float`,
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
      db.select({ s: sql<number>`coalesce(sum(total::numeric),0)::float` }).from(ordersTable).where(and(gte(ordersTable.createdAt, monthStart), sql`status <> 'cancelled'`, sql`${ordersTable.archivedAt} is null`)),
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
      db.select({ c: sql<number>`count(*)::int` }).from(whatsappLogTable).where(sql`${whatsappLogTable.status} not in ('sent','success','ok')`),
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
    const lateBookings = upcomingBookingsRaw.filter((booking) => {
      const timestamp = booking.eventDate ? Date.parse(`${booking.eventDate}T00:00:00`) : NaN;
      return Number.isFinite(timestamp) && timestamp < today.getTime() && booking.status !== "cancelled";
    }).length;
    const alerts = [
      { key: "new-orders", label: "طلبات بانتظار المراجعة", count: statusBreakdown.find((s) => s.status === "pending")?.count ?? 0 },
      { key: "bookings-today", label: "حجوزات اليوم", count: todayBookings },
      { key: "late-orders", label: "طلبات متأخرة", count: lateProductOrders.length + lateBookings },
      { key: "payment-followup", label: "مدفوع جزئياً أو غير مدفوع", count: (partialOrders[0]?.c ?? 0) + (unpaidOrders[0]?.c ?? 0) },
      { key: "whatsapp-failed", label: "رسائل واتساب تحتاج مراجعة", count: whatsappFailures[0]?.c ?? 0 },
    ].filter((item) => item.count > 0);
    return json({
      totalOrders: totalOrders[0].c,
      activeOrders: activeOrders[0].c,
      cancelledOrders: cancelledOrders[0].c,
      deliveredOrders: deliveredOrders[0].c,
      serviceOrders: serviceOrdersCount[0].c,
      totalProducts: totalProducts[0].c,
      totalCustomers: totalCustomers[0].c,
      totalRevenue: totalRevenue[0].s,
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
      },
      alerts,
    });
  }

  if (section === "categories") {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    if (method === "GET") {
      const rows = await db.query.categoriesTable.findMany({
        orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.id)],
      });
      return json(rows);
    }
    if (method === "POST") {
      const { name, nameAr, slug, parentId, sortOrder, isActive } = await body(req);
      const categoryNameAr = textFallback(nameAr, name, "تصنيف جديد");
      const categoryName = textFallback(name, nameAr, `category-${Date.now().toString(36)}`);
      const categorySlug = textFallback(slug, `${slugFallback(categoryNameAr || categoryName, "category")}-${Date.now().toString(36)}`);
      try {
        const [row] = await db
          .insert(categoriesTable)
          .values({ name: categoryName, nameAr: categoryNameAr, slug: categorySlug, parentId: parentId ?? null, sortOrder: sortOrder ?? 0, isActive: isActive ?? true })
          .returning();
        return json(row, 201);
      } catch (err: any) {
        if (err?.code === "23505") return error("السلاج مكرر", 409);
        throw err;
      }
    }
    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = {};
      for (const k of ["name", "nameAr", "slug", "parentId", "sortOrder", "isActive"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      if (update.name !== undefined && !String(update.name ?? "").trim()) delete update.name;
      if (update.nameAr !== undefined && !String(update.nameAr ?? "").trim()) delete update.nameAr;
      if (update.slug !== undefined && !String(update.slug ?? "").trim()) {
        update.slug = `${slugFallback(b?.nameAr ?? b?.name, "category")}-${Date.now().toString(36)}`;
      }
      const [row] = await db.update(categoriesTable).set(update).where(eq(categoriesTable.id, id)).returning();
      if (!row) return error("غير موجود", 404);
      return json(row);
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "settings") {
    const auth = await requirePermission(req, "settings");
    if (isResponse(auth)) return auth;
    if (method === "GET") {
      return json(await loadSiteSettings());
    }
    if (method === "POST" && parts[2] === "logo") {
      const data = await body(req);
      const logoUrl = cleanPublicUrl(data?.logoUrl ?? data?.url ?? "");
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
      return json({ logoUrl, logo_url: logoUrl, logoMetadata });
    }
    if (method === "PUT" || method === "PATCH") {
      const entries = Object.entries(await body(req));
      await Promise.all(
        entries.map(async ([key, value]) => {
          const storedValue = key === "logoUrl" || key === "mapUrl" ? cleanPublicUrl(value) : value;
          await db
            .insert(settingsTable)
            .values({ key, value: storedValue as any })
            .onConflictDoUpdate({ target: settingsTable.key, set: { value: storedValue as any, updatedAt: new Date() } });
        }),
      );
      revalidateTag(PUBLIC_SETTINGS_TAG, { expire: 0 });
      return json({ message: "تم الحفظ" });
    }
  }

  if (section === "staff") {
    const auth = await requirePermission(req, "staff");
    if (isResponse(auth)) return auth;
    if (method === "GET") {
      const rows = await db.query.staffTable.findMany({ orderBy: (s, { asc }) => [asc(s.id)] });
      return json(rows.map(formatStaff));
    }
    if (method === "POST") {
      const { username, password, fullName, role, permissions, isActive } = await body(req);
      if (!username || !password) return error("بيانات ناقصة", 400);
      const normalizedRole = normalizeStaffRole(role);
      try {
        const [row] = await db
          .insert(staffTable)
          .values({
            username,
            passwordHash: hashPassword(password),
            fullName: fullName ?? "",
            role: normalizedRole,
            permissions: permissionsForRole(normalizedRole, permissions),
            isActive: isActive ?? true,
          })
          .returning();
        return json(formatStaff(row), 201);
      } catch (err: any) {
        if (err?.code === "23505") return error("اسم المستخدم مأخوذ", 409);
        throw err;
      }
    }
    if ((method === "PATCH" || method === "DELETE") && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const existing = await db.query.staffTable.findFirst({ where: eq(staffTable.id, id) });
      if (!existing) return error("غير موجود", 404);
      if (method === "DELETE") {
        if (existing.role === "admin") return error("لا يمكن حذف المدير الرئيسي", 403);
        await db.delete(staffTable).where(eq(staffTable.id, id));
        return json({ message: "تم الحذف" });
      }
      const b = await body(req);
      const update: any = {};
      for (const k of ["fullName", "isActive"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      if (existing.role !== "admin") {
        const nextRole = b?.role !== undefined ? normalizeStaffRole(b.role) : existing.role;
        if (b?.role !== undefined) update.role = nextRole;
        if (b?.permissions !== undefined || b?.role !== undefined) {
          update.permissions = permissionsForRole(nextRole, b?.permissions);
        }
      }
      if (existing.role === "admin") {
        delete update.isActive;
        delete update.permissions;
      }
      if (b?.password) update.passwordHash = hashPassword(b.password);
      const [row] = await db.update(staffTable).set(update).where(eq(staffTable.id, id)).returning();
      return json(formatStaff(row));
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
      const [orders, serviceOrders] = await Promise.all([
        db.query.ordersTable.findMany({
          where: inArray(ordersTable.customerPhone, phoneVariants),
          orderBy: [desc(ordersTable.createdAt)],
        }),
        db.query.serviceOrdersTable.findMany({
          where: inArray(serviceOrdersTable.phone, phoneVariants),
          orderBy: [desc(serviceOrdersTable.createdAt)],
        }),
      ]);
      return json({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        role: customer.role,
        rewardPoints: Number(customer.rewardPoints ?? 0),
        rewardLevel: customer.rewardLevel ?? rewardLevelForPoints(Number(customer.rewardPoints ?? 0)),
        rewardLevelLabel: rewardLabel(customer.rewardLevel),
        createdAt: customer.createdAt.toISOString(),
        orders: orders.map((o) => ({
          id: o.id,
          trackingCode: o.trackingCode,
          status: o.status,
          total: Number.parseFloat(o.total),
          createdAt: o.createdAt.toISOString(),
        })),
        serviceOrders: serviceOrders.map((s) => ({
          id: s.id,
          trackingCode: s.trackingCode,
          status: s.status,
          createdAt: s.createdAt.toISOString(),
        })),
      });
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
      if (!parsed.success) return error("بيانات غير صحيحة", 400);
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
        customFields,
      });
      await db.insert(serviceOrderStatusHistoryTable).values({
        serviceOrderId: order.id,
        status: order.status,
        notes: "إضافة من الإدارة",
      });
      void fireOrderEvent("booking_placed", {
        name: order.customerName,
        phone: order.phone,
        tracking: order.trackingCode ?? "",
        status: order.status,
        service: service.nameAr ?? service.name ?? "",
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
      for (const k of ["status", "customerName", "phone", "eventDate", "eventLocation", "notes", "internalNotes"]) {
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
      }
      await awardServiceOrderPoints(row);
      void logAdminActivity(req, b?.archived ? "booking_archived" : "booking_updated", "service_order", row.id, { fields: Object.keys(update), tracking: row.trackingCode });
      return json(row);
    }

    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(serviceOrderStatusHistoryTable).where(eq(serviceOrderStatusHistoryTable.serviceOrderId, id));
      await db.delete(serviceOrdersTable).where(eq(serviceOrdersTable.id, id));
      void logAdminActivity(req, "booking_deleted", "service_order", id);
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "orders") {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;
    if (method === "POST" && !parts[2]) {
      const { customerName, customerPhone, governorate, area, address, notes, internalNotes, items, deliveryFee, mapsUrl, paymentMethod, depositAmount, paymentStatus } = await body(req);
      const orderItems = mergeOrderItems(items);
      if (!customerPhone || orderItems.length === 0) return error("رقم الهاتف والمنتجات مطلوبة", 400);
      if (paymentMethod !== undefined && normalizePayment(paymentMethod) === null) return error("طريقة دفع غير صالحة", 400);
      const normalizedPhone = normalizeIraqiPhone(customerPhone);
      if (!normalizedPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
      const safeCustomerName = textFallback(customerName, formatIraqiPhone(normalizedPhone), "زبون");
      const total = orderItems.reduce((s: number, it: any) => s + Number(it.price) * Number(it.quantity), 0) + Number(deliveryFee ?? 0);
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
              deliveryFee: String(deliveryFee ?? 0),
              total: String(total),
            })
            .returning();
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
          await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: "pending", notes: "إضافة من الإدارة" });
          void fireOrderEvent("placed", {
            name: order.customerName,
            phone: order.customerPhone,
            tracking: order.trackingCode,
            total: Number(order.total),
            status: "pending",
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
      for (const k of ["customerName", "customerPhone", "governorate", "area", "address", "notes", "mapsUrl", "paymentMethod", "internalNotes"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
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
      if (b?.depositAmount !== undefined || b?.paymentStatus !== undefined || b?.deliveryFee !== undefined || b?.archived !== undefined) {
        current = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, id) }) ?? null;
        if (!current) return error("غير موجود", 404);
      }
      if (b?.depositAmount !== undefined || b?.paymentStatus !== undefined || b?.deliveryFee !== undefined) {
        const existingOrder = current!;
        const total = money(existingOrder.total);
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
      await awardProductOrderPoints(row);
      void logAdminActivity(req, b?.archived ? "order_archived" : "order_updated", "order", row.id, { fields: Object.keys(update), tracking: row.trackingCode });
      return json(row);
    }

    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
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
      return json(rows);
    }
    if (method === "POST" && !parts[2]) {
      const { name, nameAr, description, descriptionAr, type, icon, image, imageMetadata, isActive, sortOrder } = await body(req);
      const serviceNameAr = textFallback(nameAr, name, "خدمة جديدة");
      const serviceName = textFallback(name, nameAr, `service-${Date.now().toString(36)}`);
      const serviceType = textFallback(type, "other");
      const [row] = await db
        .insert(servicesTable)
        .values({
          name: serviceName,
          nameAr: serviceNameAr,
          description: description ?? null,
          descriptionAr: descriptionAr ?? null,
          type: serviceType,
          icon: icon ?? null,
          image: image ?? null,
          imageMetadata: imageMetadata && typeof imageMetadata === "object" ? imageMetadata : {},
          isActive: isActive ?? true,
          sortOrder: sortOrder ?? 0,
        })
        .returning();
      return json(row, 201);
    }
    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = {};
      for (const k of ["name", "nameAr", "description", "descriptionAr", "type", "icon", "image", "imageMetadata", "isActive", "sortOrder"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      if (update.name !== undefined && !String(update.name ?? "").trim()) delete update.name;
      if (update.nameAr !== undefined && !String(update.nameAr ?? "").trim()) delete update.nameAr;
      if (update.type !== undefined && !String(update.type ?? "").trim()) update.type = "other";
      const [row] = await db.update(servicesTable).set(update).where(eq(servicesTable.id, id)).returning();
      if (!row) return error("غير موجود", 404);
      return json(row);
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(servicesTable).where(eq(servicesTable.id, id));
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
        createdAt: booking.createdAt.toISOString(),
      });
    }
    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, id) });
    if (!order) return error("الطلب غير موجود", 404);
    const items = await db.query.orderItemsTable.findMany({ where: eq(orderItemsTable.orderId, order.id) });
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
    const [row] = await db
      .insert(galleryItemsTable)
      .values({
        mediaUrl: dataUrl,
        mediaType: dataUrl.startsWith("data:video/") ? "video" : "image",
        imageMetadata: imageMetadata && typeof imageMetadata === "object" ? imageMetadata : {},
        titleAr: titleAr ?? null,
        category: category ?? "uploads",
      })
      .returning();
    return json({ id: row.id, url: row.mediaUrl }, 201);
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

async function handleSalesInvoices(req: NextRequest, parts: string[], section: string | undefined) {
  if (section !== "sales-invoices") return null;
  const auth = await requirePermission(req, "accounting");
  if (isResponse(auth)) return auth;
  await ensureSalesInvoicesTables();
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
    return json({ ...inv, items });
  }

  if (method === "POST") {
    const b = await body(req);
    const a = actor(auth);
    const dateVal = b.date ?? new Date().toISOString().slice(0, 10);
    const subtotal = parseFloat(b.subtotal ?? "0") || 0;
    const discountAmount = parseFloat(b.discountAmount ?? "0") || 0;
    const taxAmount = parseFloat(b.taxAmount ?? "0") || 0;
    const total = parseFloat(b.total ?? String(subtotal - discountAmount + taxAmount)) || 0;
    const paidAmount = parseFloat(b.paidAmount ?? String(total)) || 0;
    const remainingAmount = total - paidAmount;
    const paymentStatus = paidAmount >= total ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

    const [inv] = await db.insert(salesInvoicesTable).values({
      invoiceNo: `SI-TEMP`,
      date: dateVal,
      customerName: b.customerName ?? "",
      customerPhone: b.customerPhone ?? null,
      customerId: b.customerId ?? null,
      subtotal: String(subtotal),
      discountAmount: String(discountAmount),
      taxAmount: String(taxAmount),
      total: String(total),
      paidAmount: String(paidAmount),
      remainingAmount: String(remainingAmount),
      paymentMethod: b.paymentMethod ?? "cash",
      paymentStatus,
      status: "active",
      isInternal: b.isInternal ? 1 : 0,
      notes: b.notes ?? null,
      createdBy: a.id,
      createdByName: a.name,
    } as any).returning();

    const invoiceNo = fmtInvoiceNo("SI", inv.id, new Date(inv.createdAt));
    await db.update(salesInvoicesTable).set({ invoiceNo }).where(eq(salesInvoicesTable.id, inv.id));

    const items: any[] = b.items ?? [];
    if (items.length > 0) {
      await db.insert(salesInvoiceItemsTable).values(
        items.map((item: any) => ({
          invoiceId: inv.id,
          productId: item.productId ?? null,
          productName: item.productName ?? "",
          barcode: item.barcode ?? null,
          quantity: String(item.quantity ?? 1),
          unitPrice: String(item.unitPrice ?? 0),
          discount: String(item.discount ?? 0),
          discountPct: String(item.discountPct ?? 0),
          total: String(item.total ?? 0),
          costPrice: String(item.costPrice ?? 0),
        }))
      );
      // Update product stock
      for (const item of items) {
        if (item.productId && parseFloat(item.quantity ?? "1") > 0) {
          await db.execute(sql`
            UPDATE products SET stock = GREATEST(0, stock - ${parseFloat(item.quantity ?? "1")})
            WHERE id = ${item.productId}
          `);
        }
      }
    }

    const final = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, inv.id) });
    const finalItems = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, inv.id));
    return json({ ...final, items: finalItems }, 201);
  }

  if (method === "PUT" && id) {
    const b = await body(req);
    const existing = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, id) });
    if (!existing) return error("الفاتورة غير موجودة", 404);
    const subtotal = parseFloat(b.subtotal ?? String(existing.subtotal)) || 0;
    const discountAmount = parseFloat(b.discountAmount ?? String(existing.discountAmount)) || 0;
    const taxAmount = parseFloat(b.taxAmount ?? String(existing.taxAmount)) || 0;
    const total = parseFloat(b.total ?? String(subtotal - discountAmount + taxAmount)) || 0;
    const paidAmount = parseFloat(b.paidAmount ?? String(existing.paidAmount)) || 0;
    const remainingAmount = total - paidAmount;
    const paymentStatus = paidAmount >= total ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

    await db.update(salesInvoicesTable).set({
      customerName: b.customerName ?? existing.customerName,
      customerPhone: b.customerPhone ?? existing.customerPhone,
      subtotal: String(subtotal), discountAmount: String(discountAmount),
      taxAmount: String(taxAmount), total: String(total),
      paidAmount: String(paidAmount), remainingAmount: String(remainingAmount),
      paymentMethod: b.paymentMethod ?? existing.paymentMethod,
      paymentStatus, notes: b.notes ?? existing.notes,
      isInternal: b.isInternal !== undefined ? (b.isInternal ? 1 : 0) : existing.isInternal,
      updatedAt: new Date(),
    } as any).where(eq(salesInvoicesTable.id, id));

    if (b.items !== undefined) {
      await db.delete(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
      if (b.items.length > 0) {
        await db.insert(salesInvoiceItemsTable).values(
          b.items.map((item: any) => ({
            invoiceId: id, productId: item.productId ?? null, productName: item.productName ?? "",
            barcode: item.barcode ?? null, quantity: String(item.quantity ?? 1),
            unitPrice: String(item.unitPrice ?? 0), discount: String(item.discount ?? 0),
            discountPct: String(item.discountPct ?? 0), total: String(item.total ?? 0),
            costPrice: String(item.costPrice ?? 0),
          }))
        );
      }
    }
    const final = await db.query.salesInvoicesTable.findFirst({ where: eq(salesInvoicesTable.id, id) });
    const finalItems = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
    return json({ ...final, items: finalItems });
  }

  if (method === "DELETE" && id) {
    await db.update(salesInvoicesTable).set({ status: "deleted" } as any).where(eq(salesInvoicesTable.id, id));
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
    const dateVal = b.date ?? new Date().toISOString().slice(0, 10);
    const subtotal = parseFloat(b.subtotal ?? "0") || 0;
    const discountAmount = parseFloat(b.discountAmount ?? "0") || 0;
    const taxAmount = parseFloat(b.taxAmount ?? "0") || 0;
    const shippingCost = parseFloat(b.shippingCost ?? "0") || 0;
    const total = parseFloat(b.total ?? String(subtotal - discountAmount + taxAmount + shippingCost)) || 0;
    const paidAmount = parseFloat(b.paidAmount ?? String(total)) || 0;
    const remainingAmount = total - paidAmount;
    const paymentStatus = paidAmount >= total ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

    const [inv] = await db.insert(purchaseInvoicesTable).values({
      invoiceNo: `PI-TEMP`,
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

    const items: any[] = b.items ?? [];
    if (items.length > 0) {
      await db.insert(purchaseInvoiceItemsTable).values(
        items.map((item: any) => ({
          invoiceId: inv.id,
          productId: item.productId ?? null, productName: item.productName ?? "",
          barcode: item.barcode ?? null, quantity: String(item.quantity ?? 1),
          costPrice: String(item.costPrice ?? 0), salePrice: String(item.salePrice ?? 0),
          discount: String(item.discount ?? 0), total: String(item.total ?? 0),
        }))
      );
      // Update product stock on purchase
      for (const item of items) {
        if (item.productId && parseFloat(item.quantity ?? "1") > 0) {
          const updateVals: any = { stock: sql`stock + ${parseFloat(item.quantity)}` };
          if (item.salePrice && parseFloat(item.salePrice) > 0) {
            updateVals.price = String(parseFloat(item.salePrice));
          }
          await db.update(productsTable).set(updateVals).where(eq(productsTable.id, item.productId));
        }
      }
    }

    const final = await db.query.purchaseInvoicesTable.findFirst({ where: eq(purchaseInvoicesTable.id, inv.id) });
    const finalItems = await db.select().from(purchaseInvoiceItemsTable).where(eq(purchaseInvoiceItemsTable.invoiceId, inv.id));
    return json({ ...final, items: finalItems }, 201);
  }

  if (method === "DELETE" && id) {
    await db.update(purchaseInvoicesTable).set({ status: "deleted" } as any).where(eq(purchaseInvoicesTable.id, id));
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
    if (!b.name?.trim()) return error("اسم المورد مطلوب", 400);
    const [row] = await db.insert(suppliersTable).values({
      name: b.name.trim(), phone: b.phone ?? null,
      email: b.email ?? null, address: b.address ?? null, notes: b.notes ?? null,
    } as any).returning();
    return json(row, 201);
  }

  if (method === "PUT" && id) {
    const b = await body(req);
    const update: any = {};
    if (b.name !== undefined) update.name = b.name.trim();
    if (b.phone !== undefined) update.phone = b.phone;
    if (b.email !== undefined) update.email = b.email;
    if (b.address !== undefined) update.address = b.address;
    if (b.notes !== undefined) update.notes = b.notes;
    update.updatedAt = new Date();
    const [row] = await db.update(suppliersTable).set(update).where(eq(suppliersTable.id, id!)).returning();
    if (!row) return error("غير موجود", 404);
    return json(row);
  }

  if (method === "DELETE" && id) {
    await db.update(suppliersTable).set({ isActive: 0, updatedAt: new Date() } as any).where(eq(suppliersTable.id, id!));
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

  if (method !== "GET") return null;

  const from = req.nextUrl.searchParams.get("from") ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = req.nextUrl.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

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

    const expenseConds: any[] = [gte(expensesTable.date, from), lte(expensesTable.date, to)];
    const [expenseRow] = await db.select({
      total: sql<string>`COALESCE(SUM(amount)::text, '0')`,
    }).from(expensesTable).where(and(...expenseConds) as any);

    const orderConds: any[] = [gte(ordersTable.createdAt, new Date(from)), lte(ordersTable.createdAt, new Date(to + "T23:59:59"))];
    const [orderRow] = await db.select({
      total: sql<string>`COALESCE(SUM(total)::text, '0')`,
      count: sql<number>`count(*)::int`,
    }).from(ordersTable).where(and(...orderConds) as any);

    const salesTotal = parseFloat(salesRow?.total ?? "0");
    const purchaseTotal = parseFloat(purchaseRow?.total ?? "0");
    const expenseTotal = parseFloat(expenseRow?.total ?? "0");
    const ordersTotal = parseFloat(orderRow?.total ?? "0");
    const grossProfit = salesTotal + ordersTotal - purchaseTotal;
    const netProfit = grossProfit - expenseTotal;

    return json({
      from, to,
      sales: { total: salesTotal, paid: parseFloat(salesRow?.paid ?? "0"), remaining: parseFloat(salesRow?.remaining ?? "0"), count: salesRow?.count ?? 0, discount: parseFloat(salesRow?.discount ?? "0") },
      purchases: { total: purchaseTotal, count: purchaseRow?.count ?? 0 },
      orders: { total: ordersTotal, count: orderRow?.count ?? 0 },
      expenses: { total: expenseTotal },
      grossProfit, netProfit,
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
    const [row] = await db.insert(printTemplatesTable).values({
      name: b.name.trim(),
      type: b.type ?? "sales",
      paperSize: b.paperSize ?? "a4",
      isDefault: b.isDefault ? 1 : 0,
      config: typeof b.config === "string" ? b.config : JSON.stringify(b.config ?? {}),
      createdBy: a.id,
    } as any).returning();
    if (b.isDefault) {
      await db.execute(sql`UPDATE print_templates SET is_default = 0 WHERE type = ${b.type ?? "sales"} AND id != ${row.id}`);
    }
    return json(row, 201);
  }

  if (method === "PUT" && id) {
    const b = await body(req);
    const update: any = { updatedAt: new Date() };
    if (b.name !== undefined) update.name = b.name.trim();
    if (b.type !== undefined) update.type = b.type;
    if (b.paperSize !== undefined) update.paperSize = b.paperSize;
    if (b.isDefault !== undefined) update.isDefault = b.isDefault ? 1 : 0;
    if (b.config !== undefined) update.config = typeof b.config === "string" ? b.config : JSON.stringify(b.config);
    const [row] = await db.update(printTemplatesTable).set(update).where(eq(printTemplatesTable.id, id!)).returning();
    if (!row) return error("غير موجود", 404);
    if (b.isDefault) {
      await db.execute(sql`UPDATE print_templates SET is_default = 0 WHERE type = ${row.type} AND id != ${id}`);
    }
    return json(row);
  }

  if (method === "DELETE" && id) {
    await db.delete(printTemplatesTable).where(eq(printTemplatesTable.id, id!));
    return json({ message: "تم الحذف" });
  }

  return null;
}

const DEFAULT_EXPENSE_CATEGORIES: { name: string; nameAr: string }[] = [
  { name: "rent", nameAr: "إيجار" },
  { name: "salaries", nameAr: "رواتب" },
  { name: "supplies", nameAr: "مستلزمات" },
  { name: "marketing", nameAr: "تسويق" },
  { name: "other", nameAr: "أخرى" },
];

async function ensureExpenseCategoriesSeeded() {
  const existing = await db.query.expenseCategoriesTable.findFirst();
  if (!existing) await db.insert(expenseCategoriesTable).values(DEFAULT_EXPENSE_CATEGORIES);
}

function actor(user: AdminUser): { id: number | null; name: string } {
  return { id: user.id ?? null, name: user.fullName || user.username || "" };
}

const PAYMENT_METHODS_VO = ["cash", "transfer", "pos"] as const;
function normMethod(v: unknown): "cash" | "transfer" | "pos" {
  return (PAYMENT_METHODS_VO as readonly string[]).includes(v as string) ? (v as any) : "cash";
}

function parseAmount(v: unknown): number | null {
  const n = typeof v === "string" ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
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
    if (method === "GET") {
      await ensureExpenseCategoriesSeeded();
      const rows = await db.query.expenseCategoriesTable.findMany({ orderBy: (c, { asc }) => [asc(c.id)] });
      return json(rows);
    }
    if (method === "POST") {
      const { name, nameAr, isActive } = await body(req);
      const finalNameAr = textFallback(nameAr, name, "تصنيف مصروف جديد");
      const finalName = textFallback(name, nameAr, `expense-${Date.now().toString(36)}`);
      const [row] = await db.insert(expenseCategoriesTable).values({ name: finalName, nameAr: finalNameAr, isActive: isActive === false ? 0 : 1 }).returning();
      return json(row, 201);
    }
    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = {};
      if (b?.name !== undefined) update.name = b.name;
      if (b?.nameAr !== undefined) update.nameAr = b.nameAr;
      if (b?.isActive !== undefined) update.isActive = b.isActive ? 1 : 0;
      if (update.name !== undefined && !String(update.name ?? "").trim()) delete update.name;
      if (update.nameAr !== undefined && !String(update.nameAr ?? "").trim()) delete update.nameAr;
      const [row] = await db.update(expenseCategoriesTable).set(update).where(eq(expenseCategoriesTable.id, id)).returning();
      if (!row) return error("غير موجود", 404);
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
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "receipt-vouchers") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
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
      if (!customerId && typeof b?.customerPhone === "string" && b.customerPhone.trim()) {
        const normalizedPhone = normalizeIraqiPhone(b.customerPhone);
        if (!normalizedPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
        const c = await findCustomerByPhone(normalizedPhone);
        if (c) customerId = c.id;
      }
      const a = actor(auth);
      const [row] = await db
        .insert(receiptVouchersTable)
        .values({
          voucherNo: `TMP-${randomUUID()}`,
          date: b?.date || new Date().toISOString().slice(0, 10),
          amount: String(amt),
          payerName: textFallback(b?.payerName, "زبون"),
          customerId: customerId ?? null,
          orderId: b?.orderId ?? null,
          bookingId: b?.bookingId ?? null,
          reference: b?.reference ?? null,
          method: normMethod(b?.method),
          notes: b?.notes ?? null,
          createdBy: a.id,
          createdByName: a.name,
        })
        .returning();
      const [updated] = await db
        .update(receiptVouchersTable)
        .set({ voucherNo: fmtVoucherNo("REC", row.id, row.createdAt) })
        .where(eq(receiptVouchersTable.id, row.id))
        .returning();
      return json(updated, 201);
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(receiptVouchersTable).where(eq(receiptVouchersTable.id, id));
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "payment-vouchers") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
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
      const a = actor(auth);
      const [row] = await db
        .insert(paymentVouchersTable)
        .values({
          voucherNo: `TMP-${randomUUID()}`,
          date: b?.date || new Date().toISOString().slice(0, 10),
          amount: String(amt),
          payeeName: textFallback(b?.payeeName, "مستلم"),
          reference: b?.reference ?? null,
          method: normMethod(b?.method),
          notes: b?.notes ?? null,
          createdBy: a.id,
          createdByName: a.name,
        })
        .returning();
      const [updated] = await db
        .update(paymentVouchersTable)
        .set({ voucherNo: fmtVoucherNo("PAY", row.id, row.createdAt) })
        .where(eq(paymentVouchersTable.id, row.id))
        .returning();
      return json(updated, 201);
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(paymentVouchersTable).where(eq(paymentVouchersTable.id, id));
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "expenses") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
    if (method === "GET") {
      const from = req.nextUrl.searchParams.get("from") ?? undefined;
      const to = req.nextUrl.searchParams.get("to") ?? undefined;
      const conds = [] as any[];
      if (from) conds.push(gte(expensesTable.date, from));
      if (to) conds.push(lte(expensesTable.date, to));
      const rows = await db
        .select()
        .from(expensesTable)
        .where(conds.length ? (and(...conds) as any) : undefined)
        .orderBy(desc(expensesTable.date), desc(expensesTable.id));
      return json(rows);
    }
    if (method === "POST") {
      const b = await body(req);
      const amt = parseAmount(b?.amount);
      if (amt === null) return error("المبلغ غير صحيح", 400);
      let categoryName = "";
      if (b?.categoryId) {
        const cat = await db.query.expenseCategoriesTable.findFirst({ where: eq(expenseCategoriesTable.id, b.categoryId) });
        categoryName = cat?.nameAr ?? "";
      }
      const a = actor(auth);
      const [row] = await db
        .insert(expensesTable)
        .values({
          date: b?.date || new Date().toISOString().slice(0, 10),
          amount: String(amt),
          categoryId: b?.categoryId ?? null,
          categoryName,
          notes: b?.notes ?? null,
          createdBy: a.id,
          createdByName: a.name,
        })
        .returning();
      return json(row, 201);
    }
    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(expensesTable).where(eq(expensesTable.id, id));
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "accounting") {
    const auth = await requirePermission(req, "accounting");
    if (isResponse(auth)) return auth;
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
          .select({ s: sql<number>`coalesce(sum(total::numeric),0)::float` })
          .from(ordersTable)
          .where(and(gte(ordersTable.createdAt, fromDate), lte(ordersTable.createdAt, toDate), sql`status <> 'cancelled'`)),
        db
          .select({ s: sql<number>`coalesce(sum(amount::numeric),0)::float` })
          .from(receiptVouchersTable)
          .where(and(gte(receiptVouchersTable.date, from), lte(receiptVouchersTable.date, to))),
        db
          .select({ s: sql<number>`coalesce(sum(amount::numeric),0)::float` })
          .from(paymentVouchersTable)
          .where(and(gte(paymentVouchersTable.date, from), lte(paymentVouchersTable.date, to))),
        db
          .select({
            categoryId: expensesTable.categoryId,
            categoryName: sql<string>`max(${expensesTable.categoryName})`,
            total: sql<number>`coalesce(sum(amount::numeric),0)::float`,
          })
          .from(expensesTable)
          .where(and(gte(expensesTable.date, from), lte(expensesTable.date, to)))
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
    if (root === "auth" || root === "orders" || (!isAdminAuth && root === "admin") || root === "dashboard" || root === "customer") {
      await ensureCustomerProfileColumns();
    }
    if (root === "products" || root === "services" || root === "gallery" || (!isAdminAuth && root === "admin") || root === "auth" || root === "customer" || root === "settings") {
      await ensureImageMetadataColumns();
    }
    if (root === "cart" || root === "orders" || root === "products" || (!isAdminAuth && root === "admin") || root === "customer" || root === "dashboard") {
      await ensureProductColorColumns();
    }
    if (root === "customer" || root === "orders" || root === "service-orders" || (!isAdminAuth && root === "admin") || root === "auth") {
      await ensureCustomerRewards();
    }
    if (root === "orders" || root === "service-orders" || (!isAdminAuth && root === "admin") || root === "dashboard") {
      await ensureTrackingColumns();
      await ensurePaymentWorkflowColumns();
      await ensureArchiveColumns();
      await ensurePerformanceIndexes();
    }
    if (root === "admin") {
      await ensureStaffActivityColumn();
    }

    const route =
      root === "auth"
        ? await handleAuth(req, parts)
        : root === "settings"
          ? await handlePublicSettings(req, parts)
          : root === "customer"
            ? await handleCustomer(req, parts)
        : root === "products"
          ? await handleProducts(req, parts)
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
                            : root === "admin"
                              ? await handleAdmin(req, parts)
                              : null;

    return route ?? error("المسار غير موجود", 404);
  } catch (err) {
    console.error("API route failed:", err);
    return error("خطأ داخلي في الخادم", 500);
  }
}
