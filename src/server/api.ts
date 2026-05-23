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
  cartItemsTable,
  categoriesTable,
  crewsTable,
  customersTable,
  deliveryZonesTable,
  expenseCategoriesTable,
  expensesTable,
  galleryItemsTable,
  orderItemsTable,
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

export const COOKIE_NAME = "ajn_admin_session";
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

function sessionSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ADMIN_PASSWORD ||
    process.env.DATABASE_URL ||
    "ajn-dev-secret"
  );
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
  const token = bearer(req);
  return token ? verifyCustomerToken(token) : null;
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
    colors: p.colors ?? [],
    subcategory: p.subcategory ?? null,
    isFeatured: p.isFeatured,
    isActive: p.isActive ?? true,
    sortOrder: p.sortOrder ?? 0,
    rating: avgRating ?? null,
    reviewCount: reviewCount ?? 0,
    createdAt: p.createdAt.toISOString(),
  };
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
    createdAt: s.createdAt.toISOString(),
  };
}

function formatCrew(c: any) {
  return {
    id: c.id,
    name: c.name,
    isActive: c.isActive,
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
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
      )
    `).then(() => undefined);
  }
  await crewsTablePromise;
}

async function ensureOtpTable(): Promise<void> {
  if (!otpTablePromise) {
    otpTablePromise = db.execute(sql`
      create table if not exists "otp_codes" (
        "id" serial primary key,
        "phone" varchar(20) not null,
        "code" varchar(10) not null,
        "expires_at" timestamp not null,
        "used" boolean not null default false,
        "created_at" timestamp not null default now()
      )
    `).then(async () => {
      await db.execute(sql`create index if not exists "otp_codes_phone_idx" on "otp_codes" ("phone")`);
    }).then(() => undefined);
  }
  await otpTablePromise;
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
  const variants = iraqiPhoneVariants(phone);
  if (variants.length === 0) return null;
  return db.query.customersTable.findFirst({
    where: inArray(customersTable.phone, variants),
  });
}

async function ensureCustomerForPhone(phone: string) {
  const normalized = normalizeIraqiPhone(phone);
  if (!normalized) return null;
  const existing = await findCustomerByPhone(normalized);
  if (existing) {
    if (existing.phone !== normalized) {
      try {
        const [updated] = await db
          .update(customersTable)
          .set({ phone: normalized })
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
    .values({ phone: normalized, name: formatIraqiPhone(normalized) })
    .returning();
  return created;
}

async function buildCart(sessionId: string) {
  const items = await db.query.cartItemsTable.findMany({
    where: eq(cartItemsTable.sessionId, sessionId),
  });
  const enriched = await Promise.all(
    items.map(async (item) => {
      const product = await db.query.productsTable.findFirst({
        where: eq(productsTable.id, item.productId),
      });
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
              colors: product.colors ?? [],
              isFeatured: product.isFeatured,
              rating: null,
              reviewCount: 0,
              createdAt: product.createdAt.toISOString(),
            }
          : null,
        quantity: item.quantity,
        price: Number.parseFloat(item.price),
        selectedColor: item.selectedColor ?? null,
        customization: item.customization ?? null,
      };
    }),
  );
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
    customerId: order.customerId ?? null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    status: order.status,
    serviceType: order.serviceType ?? null,
    total: Number.parseFloat(order.total),
    deliveryFee: Number.parseFloat(order.deliveryFee),
    governorate: order.governorate ?? null,
    address: order.address ?? null,
    notes: order.notes ?? null,
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
      selectedColor: i.selectedColor ?? null,
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
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone ?? null,
    serviceType: order.serviceType ?? null,
    kind: "product",
    total: Number.parseFloat(order.total),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productNameAr: i.productNameAr,
      quantity: i.quantity,
      price: Number.parseFloat(i.price),
      selectedColor: i.selectedColor ?? null,
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
    status: so.status,
    customerName: so.customerName,
    customerPhone: so.phone ?? null,
    serviceType: service?.type ?? null,
    kind: "service",
    total: 0,
    items: [],
    statusHistory,
    createdAt: so.createdAt.toISOString(),
    estimatedDelivery: null,
    eventDate: so.eventDate ?? null,
    eventLocation: so.eventLocation ?? null,
    customFields: so.customFields ?? {},
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

async function insertServiceOrderWithUniqueTracking(values: Omit<typeof serviceOrdersTable.$inferInsert, "trackingCode">) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db
        .insert(serviceOrdersTable)
        .values({ ...values, trackingCode: generateTrackingCode("AJS") })
        .returning();
      return row;
    } catch (err: any) {
      if (err?.code !== "23505") throw err;
    }
  }
  throw new Error("فشل توليد رمز تتبع فريد");
}

async function handleAuth(req: NextRequest, parts: string[]) {
  const method = req.method;
  if (method === "POST" && parts[1] === "request-otp") {
    const parsed = RequestOtpBody.safeParse(await body(req));
    if (!parsed.success) return error("رقم الهاتف مطلوب", 400);
    const phone = normalizeIraqiPhone(parsed.data.phone);
    if (!phone) return error("رقم الهاتف العراقي غير صحيح", 400);
    const reqIp = ip(req);
    if (!checkRateLimit(otpRequestByPhone, phone, 3, 10 * 60 * 1000)) {
      return error("تجاوزت الحد المسموح، حاول لاحقاً", 429);
    }
    if (!checkRateLimit(otpRequestByIp, reqIp, 10, 60 * 60 * 1000)) {
      return error("تجاوزت الحد المسموح، حاول لاحقاً", 429);
    }
    await cleanupOtpCodes();
    const code = generateOtp();
    await db.delete(otpCodesTable).where(inArray(otpCodesTable.phone, iraqiPhoneVariants(phone)));
    await db.insert(otpCodesTable).values({
      phone,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const sent = await sendOtpViaUltraMsg(phone, code);
    if (!sent.ok) {
      await db.delete(otpCodesTable).where(and(eq(otpCodesTable.phone, phone), eq(otpCodesTable.code, code)));
      return error("تعذر إرسال رمز التحقق عبر واتساب، تأكد من الرقم وحاول لاحقاً", 502);
    }
    return json({
      message: "تم إرسال رمز التحقق",
      phone,
      devOtp: null,
    });
  }

  if (method === "POST" && parts[1] === "verify-otp") {
    const parsed = VerifyOtpBody.safeParse(await body(req));
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
    const phone = normalizeIraqiPhone(parsed.data.phone);
    const otp = normalizePhoneDigits(parsed.data.otp).slice(0, 10);
    if (!phone || !otp) return error("بيانات غير صحيحة", 400);
    if (!checkRateLimit(otpVerifyByPhone, phone, 5, 10 * 60 * 1000)) {
      return error("تجاوزت عدد المحاولات، حاول لاحقاً", 429);
    }
    await cleanupOtpCodes();
    const record = await db.query.otpCodesTable.findFirst({
      where: and(
        inArray(otpCodesTable.phone, iraqiPhoneVariants(phone)),
        eq(otpCodesTable.code, otp),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, new Date()),
      ),
    });
    if (!record) return error("رمز التحقق غير صحيح أو منتهي الصلاحية", 400);
    await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, record.id));
    const customer = await ensureCustomerForPhone(phone);
    if (!customer) return error("رقم الهاتف العراقي غير صحيح", 400);
    const token = signCustomerToken(customer.id);
    customerSessions.set(token, customer.id);
    return json({
      customer: {
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
        role: customer.role,
        createdAt: customer.createdAt.toISOString(),
      },
      token,
    });
  }

  if (method === "GET" && parts[1] === "me") {
    const customerId = getCurrentCustomerId(req);
    if (!customerId) return error("غير مخول", 401);
    const customer = await db.query.customersTable.findFirst({
      where: eq(customersTable.id, customerId),
    });
    if (!customer) return error("المستخدم غير موجود", 404);
    return json({
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      role: customer.role,
      createdAt: customer.createdAt.toISOString(),
    });
  }

  if (method === "POST" && parts[1] === "logout") {
    const token = bearer(req);
    if (token) customerSessions.delete(token);
    return json({ message: "تم تسجيل الخروج" });
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
    const products = await db.query.productsTable.findMany({
      where: and(
        category ? eq(productsTable.category, category) : undefined,
        search ? ilike(productsTable.nameAr, `%${search}%`) : undefined,
        inStock ? sql`${productsTable.stock} > 0` : undefined,
      ),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
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
    const [product] = await db
      .insert(productsTable)
      .values({
        name: data.name,
        nameAr: data.nameAr,
        description: data.description,
        descriptionAr: data.descriptionAr,
        price: data.price.toString(),
        originalPrice: data.originalPrice?.toString(),
        stock: data.stock,
        category: data.category,
        images: data.images ?? [],
        colors: data.colors ?? [],
        isFeatured: data.isFeatured ?? false,
        subcategory: data.subcategory ?? null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();
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
      "colors",
      "isFeatured",
      "descriptionAr",
      "subcategory",
      "isActive",
      "sortOrder",
      "stock",
    ]) {
      if (data[k] !== undefined) update[k] = data[k];
    }
    if (data.price !== undefined) update.price = data.price.toString();
    if (data.originalPrice !== undefined) update.originalPrice = data.originalPrice.toString();
    const [product] = await db.update(productsTable).set(update).where(eq(productsTable.id, id)).returning();
    if (!product) return error("المنتج غير موجود", 404);
    return json(formatProduct(product));
  }

  if (method === "DELETE" && parts[1]) {
    const auth = await requirePermission(req, "products");
    if (isResponse(auth)) return auth;
    const id = int(parts[1]);
    if (!id) return error("معرف غير صحيح", 400);
    await db.delete(productsTable).where(eq(productsTable.id, id));
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
    return json(rows.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive })));
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
    const order = await insertServiceOrderWithUniqueTracking({
      serviceId: data.serviceId,
      customerName: data.customerName,
      phone,
      eventDate: data.eventDate,
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
    const so = await db.query.serviceOrdersTable.findFirst({
      where: eq(serviceOrdersTable.trackingCode, parts[2]),
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
    const { productId, quantity, selectedColor, customization } = parsed.data;
    const product = await db.query.productsTable.findFirst({
      where: eq(productsTable.id, productId),
    });
    if (!product) return error("المنتج غير موجود", 404);
    const existing = await db.query.cartItemsTable.findFirst({
      where: and(eq(cartItemsTable.sessionId, sessionId), eq(cartItemsTable.productId, productId)),
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
        selectedColor,
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
        status: booking.status,
        total: 0,
        createdAt: booking.createdAt.toISOString(),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(rows);
  }

  if (method === "GET" && parts[1] === "track" && parts[2]) {
    const order = await db.query.ordersTable.findFirst({
      where: eq(ordersTable.trackingCode, parts[2]),
    });
    if (order) return json(await buildTracking(order));
    const so = await db.query.serviceOrdersTable.findFirst({
      where: eq(serviceOrdersTable.trackingCode, parts[2]),
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
      where: like(ordersTable.customerPhone, `%${last4}`),
      orderBy: [desc(ordersTable.createdAt)],
      limit: 20,
    });
    const serviceOrders = await db.query.serviceOrdersTable.findMany({
      where: like(serviceOrdersTable.phone, `%${last4}`),
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
    const orders = await db.query.ordersTable.findMany({
      where: status ? eq(ordersTable.status, status) : undefined,
      orderBy: [desc(ordersTable.createdAt)],
    });
    return json(await Promise.all(orders.map(formatOrder)));
  }

  if (method === "POST" && parts.length === 1) {
    const parsed = CreateOrderBody.safeParse(await body(req));
    if (!parsed.success) return error("بيانات غير صحيحة", 400);
    const sessionId = getSessionId(req);
    const customerId = getCurrentCustomerId(req);
    const data = parsed.data;
    const cartItems = await db.query.cartItemsTable.findMany({
      where: eq(cartItemsTable.sessionId, sessionId),
    });
    if (cartItems.length === 0) return error("السلة فارغة", 400);
    const customerPhone = normalizeIraqiPhone(data.customerPhone);
    if (!customerPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
    let deliveryFee = 0;
    if (data.deliveryZoneId) {
      const zone = await db.query.deliveryZonesTable.findFirst({
        where: eq(deliveryZonesTable.id, data.deliveryZoneId),
      });
      if (zone) deliveryFee = Number.parseFloat(zone.price);
    }
    const subtotal = cartItems.reduce((sum, i) => sum + Number.parseFloat(i.price) * i.quantity, 0);
    const total = subtotal + deliveryFee;
    const [order] = await db
      .insert(ordersTable)
      .values({
        trackingCode: generateTrackingCode(),
        customerId: customerId ?? undefined,
        customerName: data.customerName,
        customerPhone,
        status: "pending",
        total: total.toString(),
        deliveryFee: deliveryFee.toString(),
        paymentMethod: data.paymentMethod && ["cod", "transfer", "paid"].includes(data.paymentMethod) ? data.paymentMethod : "cod",
        governorate: data.governorate,
        area: data.area ?? null,
        address: data.address,
        notes: data.notes,
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
          selectedColor: item.selectedColor,
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
    return json(
      {
        id: item.id,
        mediaUrl: item.mediaUrl,
        mediaType: item.mediaType,
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
    const [review] = await db.insert(reviewsTable).values(parsed.data).returning();
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
    const [zone] = await db
      .insert(deliveryZonesTable)
      .values({
        governorate: data.governorate,
        governorateAr: data.governorateAr,
        areas: data.areas ?? [],
        price: data.price.toString(),
        estimatedDays: data.estimatedDays,
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

const DEFAULT_SETTINGS: Record<string, any> = {
  siteName: "مجموعة علي جان",
  logoUrl: "",
  phones: ["07701234567"],
  social: { instagram: "", facebook: "", whatsapp: "" },
  paymentQr: "",
  packagingFee: 2000,
  deliveryFee: 5000,
  deliveryTime: "1-3 أيام",
  address: "طوزخورماتو، العراق",
};

const PAYMENT_METHODS = ["cod", "transfer", "paid"] as const;
function normalizePayment(v: unknown): "cod" | "transfer" | "paid" | null {
  return (PAYMENT_METHODS as readonly string[]).includes(v as string) ? (v as any) : null;
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
      const user = await db.query.staffTable.findFirst({ where: eq(staffTable.username, username) });
      if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
        return error("بيانات الدخول غير صحيحة", 401);
      }
      const { token } = await createSession(user.id);
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable),
      db.select({ c: sql<number>`count(*)::int` }).from(productsTable),
      db.select({ c: sql<number>`count(*)::int` }).from(customersTable),
      db.select({ s: sql<number>`coalesce(sum(total::numeric),0)::float` }).from(ordersTable),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(sql`status in ('pending','confirmed','processing','shipped')`),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(eq(ordersTable.status, "cancelled")),
      db.select({ c: sql<number>`count(*)::int` }).from(ordersTable).where(eq(ordersTable.status, "delivered")),
      db.select({ s: sql<number>`coalesce(sum(total::numeric),0)::float` }).from(ordersTable).where(gte(ordersTable.createdAt, today)),
      db.select({ c: sql<number>`count(*)::int` }).from(serviceOrdersTable),
      db
        .select({
          day: sql<string>`to_char(created_at, 'YYYY-MM-DD')`,
          total: sql<number>`coalesce(sum(total::numeric),0)::float`,
          orders: sql<number>`count(*)::int`,
        })
        .from(ordersTable)
        .where(gte(ordersTable.createdAt, last30))
        .groupBy(sql`to_char(created_at, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(created_at, 'YYYY-MM-DD')`),
      db.select({ status: ordersTable.status, count: sql<number>`count(*)::int` }).from(ordersTable).groupBy(ordersTable.status),
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
        .groupBy(serviceOrdersTable.serviceId)
        .orderBy(sql`count(*) desc`),
    ]);
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
      revenueByDay,
      statusBreakdown,
      topProducts,
      topCustomers,
      bookingsByService,
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
      if (!name || !nameAr || !slug) return error("بيانات ناقصة", 400);
      try {
        const [row] = await db
          .insert(categoriesTable)
          .values({ name, nameAr, slug, parentId: parentId ?? null, sortOrder: sortOrder ?? 0, isActive: isActive ?? true })
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
      const rows = await db.query.settingsTable.findMany();
      const result: Record<string, any> = { ...DEFAULT_SETTINGS };
      for (const r of rows) result[r.key] = r.value;
      return json(result);
    }
    if (method === "PUT") {
      const entries = Object.entries(await body(req));
      await Promise.all(
        entries.map(async ([key, value]) => {
          await db
            .insert(settingsTable)
            .values({ key, value: value as any })
            .onConflictDoUpdate({ target: settingsTable.key, set: { value: value as any, updatedAt: new Date() } });
        }),
      );
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
      try {
        const [row] = await db
          .insert(staffTable)
          .values({
            username,
            passwordHash: hashPassword(password),
            fullName: fullName ?? "",
            role: role === "admin" ? "staff" : (role ?? "staff"),
            permissions: Array.isArray(permissions) ? permissions : [],
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
      for (const k of ["fullName", "permissions", "isActive"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      if (existing.role !== "admin" && b?.role !== undefined) update.role = b.role === "admin" ? "staff" : b.role;
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
      const name = typeof b?.name === "string" ? b.name.trim() : "";
      if (!name) return error("اسم الكادر مطلوب", 400);
      const [row] = await db
        .insert(crewsTable)
        .values({ name, isActive: b?.isActive ?? true })
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
        if (!name) return error("اسم الكادر مطلوب", 400);
        update.name = name;
      }
      if (b?.isActive !== undefined) update.isActive = Boolean(b.isActive);
      const [row] = await db.update(crewsTable).set(update).where(eq(crewsTable.id, id)).returning();
      return json(formatCrew(row));
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
  }

  if (section === "service-orders") {
    const auth = await requirePermission(req, "bookings");
    if (isResponse(auth)) return auth;

    if (method === "GET" && !parts[2]) {
      const rows = await db.query.serviceOrdersTable.findMany({
        orderBy: [desc(serviceOrdersTable.createdAt)],
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
      const order = await insertServiceOrderWithUniqueTracking({
        serviceId: data.serviceId,
        customerName: data.customerName,
        phone,
        eventDate: data.eventDate,
        eventLocation,
        notes: data.notes,
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
      return json(row);
    }

    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      const update: any = {};
      for (const k of ["status", "customerName", "phone", "eventDate", "eventLocation", "notes"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      const prev = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, id) });
      if (!prev) return error("غير موجود", 404);
      if (update.phone !== undefined) {
        const phone = normalizeIraqiPhone(String(update.phone));
        if (!phone) return error("رقم الهاتف العراقي غير صحيح", 400);
        update.phone = phone;
      }
      if (b?.customFields !== undefined) {
        const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, prev.serviceId) });
        update.customFields = withDerivedServiceDetails(service?.type, normalizeDetailsInput(b.customFields));
        if (b?.eventLocation === undefined) {
          update.eventLocation = primaryLocationFromDetails(service?.type, update.customFields) || prev.eventLocation;
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
      return json(row);
    }

    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(serviceOrderStatusHistoryTable).where(eq(serviceOrderStatusHistoryTable.serviceOrderId, id));
      await db.delete(serviceOrdersTable).where(eq(serviceOrdersTable.id, id));
      return json({ message: "تم الحذف" });
    }
  }

  if (section === "orders") {
    const auth = await requirePermission(req, "orders");
    if (isResponse(auth)) return auth;
    if (method === "POST" && !parts[2]) {
      const { customerName, customerPhone, governorate, area, address, notes, items, deliveryFee, mapsUrl, paymentMethod } = await body(req);
      if (!customerName || !customerPhone || !Array.isArray(items) || items.length === 0) return error("بيانات ناقصة", 400);
      if (paymentMethod !== undefined && normalizePayment(paymentMethod) === null) return error("طريقة دفع غير صالحة", 400);
      const normalizedPhone = normalizeIraqiPhone(customerPhone);
      if (!normalizedPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
      const total = items.reduce((s: number, it: any) => s + Number(it.price) * Number(it.quantity), 0) + Number(deliveryFee ?? 0);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const [order] = await db
            .insert(ordersTable)
            .values({
              trackingCode: generateTrackingCode(),
              customerName,
              customerPhone: normalizedPhone,
              governorate,
              address,
              notes,
              area: area ?? null,
              mapsUrl: mapsUrl ?? null,
              paymentMethod: paymentMethod ?? "cod",
              deliveryFee: String(deliveryFee ?? 0),
              total: String(total),
            })
            .returning();
          await Promise.all(
            items.map((it: any) =>
              db.insert(orderItemsTable).values({
                orderId: order.id,
                productId: it.productId ?? 0,
                productName: it.productName ?? "",
                productNameAr: it.productNameAr ?? it.productName ?? "",
                quantity: it.quantity,
                price: String(it.price),
                selectedColor: it.selectedColor ?? null,
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
          return json({ id: order.id, trackingCode: order.trackingCode }, 201);
        } catch (err: any) {
          if (err?.code !== "23505") throw err;
        }
      }
      return error("تعذر إنشاء الطلب", 500);
    }

    if (method === "PATCH" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      const b = await body(req);
      if (b?.paymentMethod !== undefined && normalizePayment(b.paymentMethod) === null) return error("طريقة دفع غير صالحة", 400);
      const update: any = { updatedAt: new Date() };
      for (const k of ["customerName", "customerPhone", "governorate", "area", "address", "notes", "mapsUrl", "paymentMethod"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
      if (update.customerPhone !== undefined) {
        const normalizedPhone = normalizeIraqiPhone(update.customerPhone);
        if (!normalizedPhone) return error("رقم الهاتف العراقي غير صحيح", 400);
        update.customerPhone = normalizedPhone;
      }
      if (b?.deliveryFee !== undefined) update.deliveryFee = String(b.deliveryFee);
      if (b?.attachments !== undefined) update.attachments = b.attachments;
      const [row] = await db.update(ordersTable).set(update).where(eq(ordersTable.id, id)).returning();
      if (!row) return error("غير موجود", 404);
      return json(row);
    }

    if (method === "DELETE" && parts[2]) {
      const id = int(parts[2]);
      if (!id) return error("معرف غير صحيح", 400);
      await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, id));
      await db.delete(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, id));
      await db.delete(ordersTable).where(eq(ordersTable.id, id));
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
      const { name, nameAr, description, descriptionAr, type, icon, image, isActive, sortOrder } = await body(req);
      if (!name || !nameAr || !type) return error("بيانات ناقصة", 400);
      const [row] = await db
        .insert(servicesTable)
        .values({
          name,
          nameAr,
          description: description ?? null,
          descriptionAr: descriptionAr ?? null,
          type,
          icon: icon ?? null,
          image: image ?? null,
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
      for (const k of ["name", "nameAr", "description", "descriptionAr", "type", "icon", "image", "isActive", "sortOrder"]) {
        if (b?.[k] !== undefined) update[k] = b[k];
      }
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
      const price = explicitTotal > 0 ? explicitTotal : basePrice + num(cf.wrappingFee);
      const deposit = num(cf.deposit ?? cf.downPayment);
      const balance = price > 0 ? Math.max(price - deposit, 0) : 0;
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
        selectedColor: i.selectedColor ?? null,
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
      return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error ?? "فشل إعادة الإرسال" }, 502);
    }
    if (method === "POST" && parts[2] === "test") {
      const { phone, message } = await body(req);
      if (typeof phone !== "string" || !phone.trim()) return error("الرقم مطلوب", 400);
      const bodyText = typeof message === "string" && message.trim() ? message : "رسالة اختبار من مجموعة علي جان ✅";
      const result = await whatsappSend(phone, bodyText, "test");
      return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error ?? "فشل الإرسال" }, 502);
    }
  }

  if (section === "uploads" && method === "POST") {
    const auth = await requirePermission(req, "gallery");
    if (isResponse(auth)) return auth;
    const { dataUrl, titleAr, category } = await body(req);
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return error("صيغة غير صحيحة", 400);
    if (dataUrl.length > 5_000_000) return error("الملف كبير جداً (الحد الأقصى ~3.5 ميغا)", 413);
    const [row] = await db
      .insert(galleryItemsTable)
      .values({
        mediaUrl: dataUrl,
        mediaType: dataUrl.startsWith("data:video/") ? "video" : "image",
        titleAr: titleAr ?? null,
        category: category ?? "uploads",
      })
      .returning();
    return json({ id: row.id, url: row.mediaUrl }, 201);
  }

  const accounting = await handleAccounting(req, parts, section);
  if (accounting) return accounting;

  const backup = await handleBackup(req, parts, section);
  if (backup) return backup;

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
      if (!name || !nameAr) return error("بيانات ناقصة", 400);
      const [row] = await db.insert(expenseCategoriesTable).values({ name, nameAr, isActive: isActive === false ? 0 : 1 }).returning();
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
      if (!b?.payerName || amt === null) return error("بيانات ناقصة", 400);
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
          payerName: b.payerName,
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
      if (!b?.payeeName || amt === null) return error("بيانات ناقصة", 400);
      const a = actor(auth);
      const [row] = await db
        .insert(paymentVouchersTable)
        .values({
          voucherNo: `TMP-${randomUUID()}`,
          date: b?.date || new Date().toISOString().slice(0, 10),
          amount: String(amt),
          payeeName: b.payeeName,
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

  try {
    if (!root && req.method === "GET") return json({ status: "ok" });
    if (req.method === "GET" && root === "healthz") return json({ status: "ok" });

    const route =
      root === "auth"
        ? await handleAuth(req, parts)
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
