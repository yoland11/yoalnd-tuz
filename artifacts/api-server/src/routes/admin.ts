import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  categoriesTable, settingsTable, staffTable,
  customersTable, ordersTable, serviceOrdersTable,
  serviceOrderStatusHistoryTable,
  galleryItemsTable, productsTable, servicesTable,
  orderItemsTable, orderStatusHistoryTable,
  expenseCategoriesTable, receiptVouchersTable,
  paymentVouchersTable, expensesTable,
  deliveryZonesTable,
} from "@workspace/db";
import { eq, sql, desc, gte, lte, and } from "drizzle-orm";
import {
  requireAdminAuth, requirePermission,
  hashPassword, verifyPassword, createSession, destroySession,
  COOKIE_NAME, SESSION_TTL_MS, ALL_PERMISSIONS,
  type AdminUser,
} from "../lib/admin-auth";
import {
  getSettings as getWaSettings,
  updateSettings as updateWaSettings,
  whatsappSend, fireOrderEvent, eventForBookingStatus,
  WA_EVENTS, WA_BOOKING_EVENTS, DEFAULT_TEMPLATES, DEFAULT_ENABLED,
  PROVIDER_SPECS, getProviderStatus,
} from "../lib/whatsapp";
import { whatsappLogTable } from "@workspace/db";

const router = Router();

const isProd = process.env.NODE_ENV === "production";
function setSessionCookie(res: any, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}
function clearSessionCookie(res: any) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}
function publicUser(u: AdminUser) {
  return {
    id: u.id, username: u.username, fullName: u.fullName,
    role: u.role, permissions: u.permissions, isActive: u.isActive,
  };
}

// ───── AUTH (PUBLIC) ─────
router.post("/admin/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    res.status(400).json({ error: "بيانات ناقصة" }); return;
  }
  const user = await db.query.staffTable.findFirst({ where: eq(staffTable.username, username) });
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "بيانات الدخول غير صحيحة" }); return;
  }
  const { token } = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({
    user: publicUser({
      id: user.id, username: user.username, fullName: user.fullName,
      role: user.role, permissions: user.permissions ?? [], isActive: user.isActive,
    }),
  });
});

router.post("/admin/auth/logout", async (req, res) => {
  const token = (req as any).cookies?.[COOKIE_NAME];
  if (token) await destroySession(token);
  clearSessionCookie(res);
  res.json({ message: "تم الخروج" });
});

router.get("/admin/auth/me", requireAdminAuth, async (req, res) => {
  const user = (req as any).adminUser as AdminUser;
  res.json({ user: publicUser(user), allPermissions: ALL_PERMISSIONS });
});

// ───── DASHBOARD ─────
router.get("/admin/dashboard", requirePermission("dashboard"), async (_req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last30 = new Date(); last30.setDate(last30.getDate() - 30);

  const [
    totalOrders, totalProducts, totalCustomers, totalRevenue,
    activeOrders, cancelledOrders, deliveredOrders, todayRevenue,
    serviceOrdersCount, revenueByDay, statusBreakdown,
    topProducts, topCustomers, bookingsByService,
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
    db.select({
      day: sql<string>`to_char(created_at, 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(total::numeric),0)::float`,
      orders: sql<number>`count(*)::int`,
    }).from(ordersTable).where(gte(ordersTable.createdAt, last30)).groupBy(sql`to_char(created_at, 'YYYY-MM-DD')`).orderBy(sql`to_char(created_at, 'YYYY-MM-DD')`),
    db.select({ status: ordersTable.status, count: sql<number>`count(*)::int` }).from(ordersTable).groupBy(ordersTable.status),
    db.select({
      productId: orderItemsTable.productId,
      productName: sql<string>`max(${orderItemsTable.productNameAr})`,
      qty: sql<number>`coalesce(sum(${orderItemsTable.quantity}),0)::int`,
      revenue: sql<number>`coalesce(sum(${orderItemsTable.quantity}::numeric * ${orderItemsTable.price}::numeric),0)::float`,
    }).from(orderItemsTable).groupBy(orderItemsTable.productId).orderBy(sql`coalesce(sum(${orderItemsTable.quantity}),0) desc`).limit(5),
    db.select({
      phone: ordersTable.customerPhone,
      name: sql<string>`max(${ordersTable.customerName})`,
      orderCount: sql<number>`count(*)::int`,
      totalSpent: sql<number>`coalesce(sum(total::numeric),0)::float`,
    }).from(ordersTable).groupBy(ordersTable.customerPhone).orderBy(sql`coalesce(sum(total::numeric),0) desc`).limit(5),
    db.select({
      serviceId: serviceOrdersTable.serviceId,
      serviceName: sql<string>`max(${servicesTable.nameAr})`,
      count: sql<number>`count(*)::int`,
    }).from(serviceOrdersTable)
      .leftJoin(servicesTable, eq(servicesTable.id, serviceOrdersTable.serviceId))
      .groupBy(serviceOrdersTable.serviceId)
      .orderBy(sql`count(*) desc`),
  ]);

  res.json({
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
});

// ───── CATEGORIES (under "products" permission) ─────
router.get("/admin/categories", requirePermission("products"), async (_req, res) => {
  const rows = await db.query.categoriesTable.findMany({
    orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.id)],
  });
  res.json(rows);
});
router.post("/admin/categories", requirePermission("products"), async (req, res) => {
  const { name, nameAr, slug, parentId, sortOrder, isActive } = req.body ?? {};
  if (!name || !nameAr || !slug) { res.status(400).json({ error: "بيانات ناقصة" }); return; }
  try {
    const [row] = await db.insert(categoriesTable).values({
      name, nameAr, slug,
      parentId: parentId ?? null,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "السلاج مكرر" }); return; }
    throw err;
  }
});
router.patch("/admin/categories/:id", requirePermission("products"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const update: any = {};
  for (const k of ["name", "nameAr", "slug", "parentId", "sortOrder", "isActive"]) {
    if (req.body?.[k] !== undefined) update[k] = req.body[k];
  }
  const [row] = await db.update(categoriesTable).set(update).where(eq(categoriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "غير موجود" }); return; }
  res.json(row);
});
router.delete("/admin/categories/:id", requirePermission("products"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
  res.json({ message: "تم الحذف" });
});

// ───── SETTINGS ─────
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
router.get("/admin/settings", requirePermission("settings"), async (_req, res) => {
  const rows = await db.query.settingsTable.findMany();
  const result: Record<string, any> = { ...DEFAULT_SETTINGS };
  for (const r of rows) result[r.key] = r.value;
  res.json(result);
});
router.put("/admin/settings", requirePermission("settings"), async (req, res) => {
  const entries = Object.entries(req.body ?? {});
  await Promise.all(entries.map(async ([key, value]) => {
    await db.insert(settingsTable)
      .values({ key, value: value as any })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: value as any, updatedAt: new Date() } });
  }));
  res.json({ message: "تم الحفظ" });
});

// ───── STAFF ─────
function formatStaff(s: any) {
  return { id: s.id, username: s.username, fullName: s.fullName, role: s.role, permissions: s.permissions ?? [], isActive: s.isActive, createdAt: s.createdAt.toISOString() };
}
router.get("/admin/staff", requirePermission("staff"), async (_req, res) => {
  const rows = await db.query.staffTable.findMany({ orderBy: (s, { asc }) => [asc(s.id)] });
  res.json(rows.map(formatStaff));
});
router.post("/admin/staff", requirePermission("staff"), async (req, res) => {
  const { username, password, fullName, role, permissions, isActive } = req.body ?? {};
  if (!username || !password) { res.status(400).json({ error: "بيانات ناقصة" }); return; }
  try {
    const [row] = await db.insert(staffTable).values({
      username,
      passwordHash: hashPassword(password),
      fullName: fullName ?? "",
      role: role === "admin" ? "staff" : (role ?? "staff"), // prevent creating another root admin via API
      permissions: Array.isArray(permissions) ? permissions : [],
      isActive: isActive ?? true,
    }).returning();
    res.status(201).json(formatStaff(row));
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "اسم المستخدم مأخوذ" }); return; }
    throw err;
  }
});
router.patch("/admin/staff/:id", requirePermission("staff"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const existing = await db.query.staffTable.findFirst({ where: eq(staffTable.id, id) });
  if (!existing) { res.status(404).json({ error: "غير موجود" }); return; }
  const update: any = {};
  for (const k of ["fullName", "permissions", "isActive"]) {
    if (req.body?.[k] !== undefined) update[k] = req.body[k];
  }
  // Protect root admin from being demoted/disabled/renamed
  const isRootAdmin = existing.username === "admin" && existing.role === "admin";
  if (!isRootAdmin && req.body?.role !== undefined) {
    update.role = req.body.role === "admin" ? "staff" : req.body.role;
  }
  if (isRootAdmin) {
    delete update.isActive;
    delete update.permissions; // root has all perms implicitly
  }
  if (req.body?.password) update.passwordHash = hashPassword(req.body.password);
  const [row] = await db.update(staffTable).set(update).where(eq(staffTable.id, id)).returning();
  res.json(formatStaff(row));
});
router.delete("/admin/staff/:id", requirePermission("staff"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const existing = await db.query.staffTable.findFirst({ where: eq(staffTable.id, id) });
  if (!existing) { res.status(404).json({ error: "غير موجود" }); return; }
  if (existing.username === "admin" && existing.role === "admin") {
    res.status(403).json({ error: "لا يمكن حذف المدير الرئيسي" }); return;
  }
  await db.delete(staffTable).where(eq(staffTable.id, id));
  res.json({ message: "تم الحذف" });
});

// ───── CUSTOMERS ─────
router.get("/admin/customers", requirePermission("customers"), async (req, res) => {
  const search = (req.query.search as string | undefined)?.trim();
  const customers = await db.query.customersTable.findMany({
    orderBy: (c, { desc }) => [desc(c.id)],
  });
  const orderCounts = await db
    .select({ phone: ordersTable.customerPhone, count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(total::numeric),0)::float` })
    .from(ordersTable)
    .groupBy(ordersTable.customerPhone);
  const phoneMap = new Map(orderCounts.map(o => [o.phone, { count: o.count, total: o.total }]));
  let result = customers.map(c => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    role: c.role,
    createdAt: c.createdAt.toISOString(),
    orderCount: phoneMap.get(c.phone)?.count ?? 0,
    totalSpent: phoneMap.get(c.phone)?.total ?? 0,
  }));
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(c => c.name.toLowerCase().includes(s) || c.phone.includes(s));
  }
  res.json(result);
});
router.get("/admin/customers/:id", requirePermission("customers"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, id) });
  if (!customer) { res.status(404).json({ error: "غير موجود" }); return; }
  const orders = await db.query.ordersTable.findMany({
    where: eq(ordersTable.customerPhone, customer.phone),
    orderBy: [desc(ordersTable.createdAt)],
  });
  const serviceOrders = await db.query.serviceOrdersTable.findMany({
    where: eq(serviceOrdersTable.phone, customer.phone),
    orderBy: [desc(serviceOrdersTable.createdAt)],
  });
  res.json({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    role: customer.role,
    createdAt: customer.createdAt.toISOString(),
    orders: orders.map(o => ({
      id: o.id, trackingCode: o.trackingCode, status: o.status,
      total: parseFloat(o.total), createdAt: o.createdAt.toISOString(),
    })),
    serviceOrders: serviceOrders.map(s => ({
      id: s.id, trackingCode: s.trackingCode, status: s.status,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

// ───── SERVICE ORDERS (bookings) ─────
router.get("/admin/service-orders", requirePermission("bookings"), async (_req, res) => {
  const rows = await db.query.serviceOrdersTable.findMany({
    orderBy: [desc(serviceOrdersTable.createdAt)],
  });
  const services = await db.query.servicesTable.findMany();
  const sMap = new Map(services.map(s => [s.id, s]));
  // Surface pending reschedule requests at the top of the list so operators
  // see them immediately, while keeping createdAt-desc order otherwise.
  const sorted = [...rows].sort((a, b) => {
    const ar = a.status === "reschedule_pending" ? 0 : 1;
    const br = b.status === "reschedule_pending" ? 0 : 1;
    if (ar !== br) return ar - br;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  res.json(sorted.map(r => ({
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
    status: r.status,
    customerConfirmation: r.customerConfirmation ?? null,
    requestedDate: r.requestedDate ?? null,
    confirmationNote: r.confirmationNote ?? null,
    confirmationAt: r.confirmationAt ? r.confirmationAt.toISOString() : null,
    preRescheduleStatus: r.preRescheduleStatus ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});
router.patch("/admin/service-orders/:id", requirePermission("bookings"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const update: any = {};
  for (const k of ["status", "customerName", "phone", "eventDate", "eventLocation", "notes"]) {
    if (req.body?.[k] !== undefined) update[k] = req.body[k];
  }
  const prev = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, id) });
  const [row] = await db.update(serviceOrdersTable).set(update).where(eq(serviceOrdersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "غير موجود" }); return; }

  if (typeof update.status === "string" && update.status && update.status !== prev?.status) {
    await db.insert(serviceOrderStatusHistoryTable).values({
      serviceOrderId: row.id,
      status: update.status,
      notes: typeof req.body?.statusNote === "string" ? req.body.statusNote : null,
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

  res.json(row);
});
// Accept or reject a customer-initiated reschedule request.
// - accept: copies requestedDate onto eventDate, marks the booking confirmed,
//   and fires the booking_confirmed WhatsApp event.
// - reject: reverts the booking to its previous status and clears the request.
router.post("/admin/service-orders/:id/reschedule-action", requirePermission("bookings"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "معرف غير صحيح" }); return; }
  const action = req.body?.action;
  if (action !== "accept" && action !== "reject") {
    res.status(400).json({ error: "إجراء غير صالح" }); return;
  }
  const noteText = typeof req.body?.note === "string" ? (req.body.note as string).slice(0, 500) : null;

  const so = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, id) });
  if (!so) { res.status(404).json({ error: "غير موجود" }); return; }
  if (so.status !== "reschedule_pending") {
    res.status(409).json({ error: "لا يوجد طلب تغيير موعد قيد المراجعة" }); return;
  }

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

  const [row] = await db.update(serviceOrdersTable).set({
    status: newStatus,
    eventDate: newEventDate,
    customerConfirmation: action === "accept" ? "confirmed" : null,
    requestedDate: null,
    confirmationNote: noteText,
    confirmationAt: new Date(),
    preRescheduleStatus: null,
  }).where(eq(serviceOrdersTable.id, id)).returning();

  await db.insert(serviceOrderStatusHistoryTable).values({
    serviceOrderId: id,
    status: newStatus,
    notes: historyNote,
  });

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

  res.json(row);
});

router.delete("/admin/service-orders/:id", requirePermission("bookings"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  await db.delete(serviceOrderStatusHistoryTable).where(eq(serviceOrderStatusHistoryTable.serviceOrderId, id));
  await db.delete(serviceOrdersTable).where(eq(serviceOrdersTable.id, id));
  res.json({ message: "تم الحذف" });
});

router.get("/admin/service-orders/:id/history", requirePermission("bookings"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "معرف غير صحيح" }); return; }
  const rows = await db.query.serviceOrderStatusHistoryTable.findMany({
    where: eq(serviceOrderStatusHistoryTable.serviceOrderId, id),
    orderBy: [desc(serviceOrderStatusHistoryTable.createdAt)],
  });
  res.json(rows.map(r => ({
    status: r.status,
    notes: r.notes ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});

// ───── ORDERS (admin extras) ─────
function genTracking(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "AJN";
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
const PAYMENT_METHODS = ["cod", "transfer", "paid"] as const;
function normalizePayment(v: unknown): "cod" | "transfer" | "paid" | null {
  return (PAYMENT_METHODS as readonly string[]).includes(v as string) ? (v as any) : null;
}

router.post("/admin/orders", requirePermission("orders"), async (req, res) => {
  const { customerName, customerPhone, governorate, area, address, notes, items, deliveryFee, mapsUrl, paymentMethod } = req.body ?? {};
  if (!customerName || !customerPhone || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "بيانات ناقصة" }); return;
  }
  if (paymentMethod !== undefined && normalizePayment(paymentMethod) === null) {
    res.status(400).json({ error: "طريقة دفع غير صالحة" }); return;
  }
  const total = items.reduce((s: number, it: any) => s + Number(it.price) * Number(it.quantity), 0) + Number(deliveryFee ?? 0);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [order] = await db.insert(ordersTable).values({
        trackingCode: genTracking(),
        customerName, customerPhone, governorate, address, notes,
        area: area ?? null,
        mapsUrl: mapsUrl ?? null,
        paymentMethod: paymentMethod ?? "cod",
        deliveryFee: String(deliveryFee ?? 0),
        total: String(total),
      }).returning();
      await Promise.all(items.map((it: any) => db.insert(orderItemsTable).values({
        orderId: order.id,
        productId: it.productId ?? 0,
        productName: it.productName ?? "",
        productNameAr: it.productNameAr ?? it.productName ?? "",
        quantity: it.quantity,
        price: String(it.price),
        selectedColor: it.selectedColor ?? null,
      })));
      await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: "pending", notes: "إضافة من الإدارة" });
      void fireOrderEvent("placed", {
        name: order.customerName,
        phone: order.customerPhone,
        tracking: order.trackingCode,
        total: Number(order.total),
        status: "pending",
      });
      res.status(201).json({ id: order.id, trackingCode: order.trackingCode }); return;
    } catch (err: any) {
      if (err?.code !== "23505") throw err;
    }
  }
  res.status(500).json({ error: "تعذر إنشاء الطلب" });
});
router.patch("/admin/orders/:id", requirePermission("orders"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (req.body?.paymentMethod !== undefined && normalizePayment(req.body.paymentMethod) === null) {
    res.status(400).json({ error: "طريقة دفع غير صالحة" }); return;
  }
  const update: any = { updatedAt: new Date() };
  for (const k of ["customerName", "customerPhone", "governorate", "area", "address", "notes", "mapsUrl", "paymentMethod"]) {
    if (req.body?.[k] !== undefined) update[k] = req.body[k];
  }
  if (req.body?.deliveryFee !== undefined) update.deliveryFee = String(req.body.deliveryFee);
  if (req.body?.attachments !== undefined) update.attachments = req.body.attachments;
  const [row] = await db.update(ordersTable).set(update).where(eq(ordersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "غير موجود" }); return; }
  res.json(row);
});
router.delete("/admin/orders/:id", requirePermission("orders"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  await db.delete(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, id));
  await db.delete(ordersTable).where(eq(ordersTable.id, id));
  res.json({ message: "تم الحذف" });
});

// ───── SERVICES (admin CRUD) ─────
router.get("/admin/services", requirePermission("services"), async (_req, res) => {
  const rows = await db.query.servicesTable.findMany({ orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.id)] });
  res.json(rows);
});
router.post("/admin/services", requirePermission("services"), async (req, res) => {
  const { name, nameAr, description, descriptionAr, type, icon, image, isActive, sortOrder } = req.body ?? {};
  if (!name || !nameAr || !type) { res.status(400).json({ error: "بيانات ناقصة" }); return; }
  const [row] = await db.insert(servicesTable).values({
    name, nameAr, description: description ?? null, descriptionAr: descriptionAr ?? null,
    type, icon: icon ?? null, image: image ?? null,
    isActive: isActive ?? true, sortOrder: sortOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});
router.patch("/admin/services/:id", requirePermission("services"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const update: any = {};
  for (const k of ["name", "nameAr", "description", "descriptionAr", "type", "icon", "image", "isActive", "sortOrder"]) {
    if (req.body?.[k] !== undefined) update[k] = req.body[k];
  }
  const [row] = await db.update(servicesTable).set(update).where(eq(servicesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "غير موجود" }); return; }
  res.json(row);
});
router.delete("/admin/services/:id", requirePermission("services"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  await db.delete(servicesTable).where(eq(servicesTable.id, id));
  res.json({ message: "تم الحذف" });
});

// ───── INVOICES (read-only order/booking view for invoice printing) ─────
router.get("/admin/invoices/:id", requirePermission("invoices"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "معرف غير صحيح" }); return; }
  const type = (req.query.type as string | undefined) === "booking" ? "booking" : "order";

  if (type === "booking") {
    const booking = await db.query.serviceOrdersTable.findFirst({ where: eq(serviceOrdersTable.id, id) });
    if (!booking) { res.status(404).json({ error: "الحجز غير موجود" }); return; }
    const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, booking.serviceId) });
    const cf = (booking.customFields ?? {}) as Record<string, any>;
    const num = (v: any) => {
      const n = typeof v === "string" ? parseFloat(v) : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const price = num(cf.price ?? cf.agreedPrice ?? cf.total);
    const deposit = num(cf.deposit ?? cf.downPayment);
    const balance = price > 0 ? Math.max(price - deposit, 0) : 0;
    res.json({
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
      price, deposit, balance,
      customFields: cf,
      createdAt: booking.createdAt.toISOString(),
    });
    return;
  }

  const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, id) });
  if (!order) { res.status(404).json({ error: "الطلب غير موجود" }); return; }
  const items = await db.query.orderItemsTable.findMany({ where: eq(orderItemsTable.orderId, order.id) });
  res.json({
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
    deliveryFee: parseFloat(order.deliveryFee),
    total: parseFloat(order.total),
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    items: items.map(i => ({
      id: i.id,
      productName: i.productName,
      productNameAr: i.productNameAr,
      quantity: i.quantity,
      price: parseFloat(i.price),
      selectedColor: i.selectedColor ?? null,
    })),
  });
});

// ───── WHATSAPP AUTOMATION ─────
router.get("/admin/whatsapp/settings", requirePermission("whatsapp"), async (_req, res) => {
  const s = await getWaSettings();
  // NOTE: provider credentials are intentionally never returned. They live
  // only in Replit secrets / env vars. We expose the *names* of required
  // secrets and a boolean indicating whether each is set.
  res.json({
    provider: s.provider,
    enabledEvents: { ...DEFAULT_ENABLED, ...s.enabledEvents },
    templates: { ...DEFAULT_TEMPLATES, ...s.templates },
    automationEnabled: s.automationEnabled,
    events: WA_EVENTS,
    bookingEvents: WA_BOOKING_EVENTS,
    providers: PROVIDER_SPECS.map(p => ({ id: p.id, label: p.label })),
    providerStatus: getProviderStatus(),
  });
});

router.put("/admin/whatsapp/settings", requirePermission("whatsapp"), async (req, res) => {
  const b = req.body ?? {};
  const patch: any = {};
  if (typeof b.provider === "string") patch.provider = b.provider;
  if (b.enabledEvents && typeof b.enabledEvents === "object") {
    const safe: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(b.enabledEvents)) safe[k] = !!v;
    patch.enabledEvents = safe;
  }
  if (b.templates && typeof b.templates === "object") {
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.templates)) {
      if (typeof v === "string") safe[k] = v;
    }
    patch.templates = safe;
  }
  if (typeof b.automationEnabled === "boolean") patch.automationEnabled = b.automationEnabled;
  const updated = await updateWaSettings(patch);
  res.json({ ok: true, automationEnabled: updated.automationEnabled });
});

router.get("/admin/whatsapp/log", requirePermission("whatsapp"), async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const rows = await db.query.whatsappLogTable.findMany({
    orderBy: [desc(whatsappLogTable.sentAt)],
    limit,
  });
  res.json(rows.map(r => ({
    id: r.id, phone: r.phone, event: r.event,
    status: r.status, error: r.error, provider: r.provider,
    message: r.message, sentAt: r.sentAt.toISOString(),
  })));
});

router.delete("/admin/whatsapp/log", requirePermission("whatsapp"), async (_req, res) => {
  await db.delete(whatsappLogTable);
  res.json({ ok: true });
});

router.post("/admin/whatsapp/log/:id/resend", requirePermission("whatsapp"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "معرّف غير صالح" }); return; }
  const entry = await db.query.whatsappLogTable.findFirst({ where: eq(whatsappLogTable.id, id) });
  if (!entry) { res.status(404).json({ error: "السجل غير موجود" }); return; }
  if (!entry.phone || !entry.message) { res.status(400).json({ error: "السجل ناقص" }); return; }
  const result = await whatsappSend(entry.phone, entry.message, entry.event as any);
  if (result.ok) res.json({ ok: true });
  else res.status(502).json({ ok: false, error: result.error ?? "فشل إعادة الإرسال" });
});

router.post("/admin/whatsapp/test", requirePermission("whatsapp"), async (req, res) => {
  const { phone, message } = req.body ?? {};
  if (typeof phone !== "string" || !phone.trim()) {
    res.status(400).json({ error: "الرقم مطلوب" }); return;
  }
  const body = typeof message === "string" && message.trim()
    ? message
    : "رسالة اختبار من مجموعة علي جان ✅";
  const result = await whatsappSend(phone, body, "test");
  if (result.ok) res.json({ ok: true });
  else res.status(502).json({ ok: false, error: result.error ?? "فشل الإرسال" });
});

// ───── UPLOADS ─────
router.post("/admin/uploads", requirePermission("gallery"), async (req, res) => {
  const { dataUrl, titleAr, category } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    res.status(400).json({ error: "صيغة غير صحيحة" }); return;
  }
  if (dataUrl.length > 5_000_000) {
    res.status(413).json({ error: "الملف كبير جداً (الحد الأقصى ~3.5 ميغا)" }); return;
  }
  const [row] = await db.insert(galleryItemsTable).values({
    mediaUrl: dataUrl,
    mediaType: dataUrl.startsWith("data:video/") ? "video" : "image",
    titleAr: titleAr ?? null,
    category: category ?? "uploads",
  }).returning();
  res.status(201).json({ id: row.id, url: row.mediaUrl });
});

// ───── ACCOUNTING ─────
const DEFAULT_EXPENSE_CATEGORIES: { name: string; nameAr: string }[] = [
  { name: "rent", nameAr: "إيجار" },
  { name: "salaries", nameAr: "رواتب" },
  { name: "supplies", nameAr: "مستلزمات" },
  { name: "marketing", nameAr: "تسويق" },
  { name: "other", nameAr: "أخرى" },
];
async function ensureExpenseCategoriesSeeded() {
  const existing = await db.query.expenseCategoriesTable.findFirst();
  if (existing) return;
  await db.insert(expenseCategoriesTable).values(DEFAULT_EXPENSE_CATEGORIES);
}
function actor(req: any): { id: number | null; name: string } {
  const u = req.adminUser as AdminUser | undefined;
  return { id: u?.id ?? null, name: u?.fullName || u?.username || "" };
}
const PAYMENT_METHODS_VO = ["cash", "transfer", "pos"] as const;
function normMethod(v: unknown): "cash" | "transfer" | "pos" {
  return (PAYMENT_METHODS_VO as readonly string[]).includes(v as string) ? (v as any) : "cash";
}
function parseAmount(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function fmtVoucherNo(prefix: string, id: number, createdAt: Date): string {
  const y = createdAt.getFullYear().toString().slice(-2);
  const m = String(createdAt.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${y}${m}-${String(id).padStart(4, "0")}`;
}

// Expense categories
router.get("/admin/expense-categories", requirePermission("accounting"), async (_req, res) => {
  await ensureExpenseCategoriesSeeded();
  const rows = await db.query.expenseCategoriesTable.findMany({ orderBy: (c, { asc }) => [asc(c.id)] });
  res.json(rows);
});
router.post("/admin/expense-categories", requirePermission("accounting"), async (req, res) => {
  const { name, nameAr, isActive } = req.body ?? {};
  if (!name || !nameAr) { res.status(400).json({ error: "بيانات ناقصة" }); return; }
  const [row] = await db.insert(expenseCategoriesTable).values({ name, nameAr, isActive: isActive === false ? 0 : 1 }).returning();
  res.status(201).json(row);
});
router.patch("/admin/expense-categories/:id", requirePermission("accounting"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const update: any = {};
  if (req.body?.name !== undefined) update.name = req.body.name;
  if (req.body?.nameAr !== undefined) update.nameAr = req.body.nameAr;
  if (req.body?.isActive !== undefined) update.isActive = req.body.isActive ? 1 : 0;
  const [row] = await db.update(expenseCategoriesTable).set(update).where(eq(expenseCategoriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "غير موجود" }); return; }
  res.json(row);
});
router.delete("/admin/expense-categories/:id", requirePermission("accounting"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const used = await db.select({ c: sql<number>`count(*)::int` }).from(expensesTable).where(eq(expensesTable.categoryId, id));
  if (used[0]?.c > 0) {
    res.status(409).json({ error: `لا يمكن الحذف — يوجد ${used[0].c} مصروف مرتبط بهذا النوع. عطّله بدل الحذف.` });
    return;
  }
  await db.delete(expenseCategoriesTable).where(eq(expenseCategoriesTable.id, id));
  res.json({ message: "تم الحذف" });
});

// Receipt vouchers (سند قبض)
router.get("/admin/receipt-vouchers", requirePermission("accounting"), async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const conds = [] as any[];
  if (from) conds.push(gte(receiptVouchersTable.date, from));
  if (to) conds.push(lte(receiptVouchersTable.date, to));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(receiptVouchersTable).where(where as any).orderBy(desc(receiptVouchersTable.date), desc(receiptVouchersTable.id));
  res.json(rows);
});
router.post("/admin/receipt-vouchers", requirePermission("accounting"), async (req, res) => {
  const { date: dateStr, amount, payerName, customerPhone, orderId, bookingId, reference, method, notes } = req.body ?? {};
  let customerId = req.body?.customerId ?? null;
  const amt = parseAmount(amount);
  if (!payerName || amt === null) { res.status(400).json({ error: "بيانات ناقصة" }); return; }
  // Resolve customer by phone if not provided explicitly — keeps ledger linkage reliable.
  if (!customerId && typeof customerPhone === "string" && customerPhone.trim()) {
    const c = await db.query.customersTable.findFirst({ where: eq(customersTable.phone, customerPhone.trim()) });
    if (c) customerId = c.id;
  }
  const a = actor(req);
  const [row] = await db.insert(receiptVouchersTable).values({
    voucherNo: `TMP-${randomUUID()}`,
    date: dateStr || new Date().toISOString().slice(0, 10),
    amount: String(amt),
    payerName,
    customerId: customerId ?? null,
    orderId: orderId ?? null,
    bookingId: bookingId ?? null,
    reference: reference ?? null,
    method: normMethod(method),
    notes: notes ?? null,
    createdBy: a.id,
    createdByName: a.name,
  }).returning();
  const [updated] = await db.update(receiptVouchersTable)
    .set({ voucherNo: fmtVoucherNo("REC", row.id, row.createdAt) })
    .where(eq(receiptVouchersTable.id, row.id)).returning();
  res.status(201).json(updated);
});
router.delete("/admin/receipt-vouchers/:id", requirePermission("accounting"), async (req, res) => {
  await db.delete(receiptVouchersTable).where(eq(receiptVouchersTable.id, parseInt(req.params.id as string)));
  res.json({ message: "تم الحذف" });
});

// Payment vouchers (سند صرف)
router.get("/admin/payment-vouchers", requirePermission("accounting"), async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const conds = [] as any[];
  if (from) conds.push(gte(paymentVouchersTable.date, from));
  if (to) conds.push(lte(paymentVouchersTable.date, to));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(paymentVouchersTable).where(where as any).orderBy(desc(paymentVouchersTable.date), desc(paymentVouchersTable.id));
  res.json(rows);
});
router.post("/admin/payment-vouchers", requirePermission("accounting"), async (req, res) => {
  const { date: dateStr, amount, payeeName, reference, method, notes } = req.body ?? {};
  const amt = parseAmount(amount);
  if (!payeeName || amt === null) { res.status(400).json({ error: "بيانات ناقصة" }); return; }
  const a = actor(req);
  const [row] = await db.insert(paymentVouchersTable).values({
    voucherNo: `TMP-${randomUUID()}`,
    date: dateStr || new Date().toISOString().slice(0, 10),
    amount: String(amt),
    payeeName,
    reference: reference ?? null,
    method: normMethod(method),
    notes: notes ?? null,
    createdBy: a.id,
    createdByName: a.name,
  }).returning();
  const [updated] = await db.update(paymentVouchersTable)
    .set({ voucherNo: fmtVoucherNo("PAY", row.id, row.createdAt) })
    .where(eq(paymentVouchersTable.id, row.id)).returning();
  res.status(201).json(updated);
});
router.delete("/admin/payment-vouchers/:id", requirePermission("accounting"), async (req, res) => {
  await db.delete(paymentVouchersTable).where(eq(paymentVouchersTable.id, parseInt(req.params.id as string)));
  res.json({ message: "تم الحذف" });
});

// Expenses
router.get("/admin/expenses", requirePermission("accounting"), async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const conds = [] as any[];
  if (from) conds.push(gte(expensesTable.date, from));
  if (to) conds.push(lte(expensesTable.date, to));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(expensesTable).where(where as any).orderBy(desc(expensesTable.date), desc(expensesTable.id));
  res.json(rows);
});
router.post("/admin/expenses", requirePermission("accounting"), async (req, res) => {
  const { date: dateStr, amount, categoryId, notes } = req.body ?? {};
  const amt = parseAmount(amount);
  if (amt === null) { res.status(400).json({ error: "المبلغ غير صحيح" }); return; }
  let categoryName = "";
  if (categoryId) {
    const cat = await db.query.expenseCategoriesTable.findFirst({ where: eq(expenseCategoriesTable.id, categoryId) });
    categoryName = cat?.nameAr ?? "";
  }
  const a = actor(req);
  const [row] = await db.insert(expensesTable).values({
    date: dateStr || new Date().toISOString().slice(0, 10),
    amount: String(amt),
    categoryId: categoryId ?? null,
    categoryName,
    notes: notes ?? null,
    createdBy: a.id,
    createdByName: a.name,
  }).returning();
  res.status(201).json(row);
});
router.delete("/admin/expenses/:id", requirePermission("accounting"), async (req, res) => {
  await db.delete(expensesTable).where(eq(expensesTable.id, parseInt(req.params.id as string)));
  res.json({ message: "تم الحذف" });
});

// Customer statement (كشف حساب)
router.get("/admin/accounting/statement", requirePermission("accounting"), async (req, res) => {
  const customerId = req.query.customerId ? parseInt(req.query.customerId as string) : null;
  const phoneParam = (req.query.phone as string | undefined)?.trim();
  let customer = null as any;
  if (customerId) customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, customerId) });
  if (!customer && phoneParam) customer = await db.query.customersTable.findFirst({ where: eq(customersTable.phone, phoneParam) });
  const phone = customer?.phone ?? phoneParam ?? null;
  if (!phone) { res.status(400).json({ error: "اختر زبون أو رقم هاتف" }); return; }

  const [orders, bookings, receipts] = await Promise.all([
    db.select().from(ordersTable).where(eq(ordersTable.customerPhone, phone)).orderBy(desc(ordersTable.createdAt)),
    db.select().from(serviceOrdersTable).where(eq(serviceOrdersTable.phone, phone)).orderBy(desc(serviceOrdersTable.createdAt)),
    // Match receipts strictly by customerId to avoid name-collision false matches.
    customer
      ? db.select().from(receiptVouchersTable)
          .where(eq(receiptVouchersTable.customerId, customer.id))
          .orderBy(desc(receiptVouchersTable.date))
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
    entries.push({
      date: o.createdAt.toISOString(),
      kind: "order",
      ref: o.trackingCode,
      description: `طلب من المتجر`,
      debit: parseFloat(o.total),
      credit: 0,
    });
  }
  for (const b of bookings) {
    entries.push({
      date: b.createdAt.toISOString(),
      kind: "booking",
      ref: b.trackingCode ?? `#${b.id}`,
      description: `حجز خدمة`,
      debit: 0,
      credit: 0,
    });
  }
  for (const r of receipts) {
    entries.push({
      date: new Date(r.date).toISOString(),
      kind: "receipt",
      ref: r.voucherNo,
      description: `سند قبض (${r.method})`,
      debit: 0,
      credit: parseFloat(r.amount),
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const withBalance = entries.map(e => {
    running += e.debit - e.credit;
    return { ...e, balance: running };
  });

  res.json({
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : { id: null, name: phone, phone },
    entries: withBalance,
    totals: {
      totalCharges: entries.reduce((s, e) => s + e.debit, 0),
      totalPayments: entries.reduce((s, e) => s + e.credit, 0),
      balance: running,
    },
  });
});

// P&L summary
router.get("/admin/accounting/pnl", requirePermission("accounting"), async (req, res) => {
  const from = (req.query.from as string | undefined) || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const to = (req.query.to as string | undefined) || new Date().toISOString().slice(0, 10);
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);

  const [sales, receipts, payments, expensesByCat] = await Promise.all([
    db.select({ s: sql<number>`coalesce(sum(total::numeric),0)::float` })
      .from(ordersTable)
      .where(and(gte(ordersTable.createdAt, fromDate), lte(ordersTable.createdAt, toDate), sql`status <> 'cancelled'`)),
    db.select({ s: sql<number>`coalesce(sum(amount::numeric),0)::float` })
      .from(receiptVouchersTable)
      .where(and(gte(receiptVouchersTable.date, from), lte(receiptVouchersTable.date, to))),
    db.select({ s: sql<number>`coalesce(sum(amount::numeric),0)::float` })
      .from(paymentVouchersTable)
      .where(and(gte(paymentVouchersTable.date, from), lte(paymentVouchersTable.date, to))),
    db.select({
      categoryId: expensesTable.categoryId,
      categoryName: sql<string>`max(${expensesTable.categoryName})`,
      total: sql<number>`coalesce(sum(amount::numeric),0)::float`,
    }).from(expensesTable)
      .where(and(gte(expensesTable.date, from), lte(expensesTable.date, to)))
      .groupBy(expensesTable.categoryId)
      .orderBy(sql`coalesce(sum(amount::numeric),0) desc`),
  ]);

  const totalSales = sales[0].s;
  const totalReceipts = receipts[0].s;
  const totalPayments = payments[0].s;
  const totalExpenses = expensesByCat.reduce((s, r) => s + r.total, 0);
  res.json({
    from, to,
    totalSales,
    totalReceipts,
    totalPayments,
    totalExpenses,
    netProfit: totalReceipts - totalPayments - totalExpenses,
    expensesByCategory: expensesByCat.map(r => ({
      categoryId: r.categoryId,
      categoryName: r.categoryName || "غير مصنف",
      total: r.total,
    })),
  });
});

// ───── BACKUP / EXPORT-IMPORT ─────
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
  const cols: string[] = Array.from(colsSet);
  const esc = (v: any) => {
    if (v == null) return "";
    let s = typeof v === "string" ? v : (v instanceof Date ? v.toISOString() : JSON.stringify(v));
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(",");
  const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\n");
  return `\ufeff${head}\n${body}`;
}

router.get("/admin/backup/export", requirePermission("backup"), async (_req, res) => {
  const out: Record<string, any[]> = {};
  for (const [name, table] of Object.entries(BACKUP_ENTITIES) as [string, any][]) {
    try { out[name] = await db.select().from(table); } catch { out[name] = []; }
  }
  const payload = {
    meta: { app: "ajn-platform", version: 1, exportedAt: new Date().toISOString() },
    data: out,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="ajn-backup-${stamp}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

router.get("/admin/backup/export/:entity", requirePermission("backup"), async (req, res) => {
  const entity = String(req.params.entity) as BackupEntity;
  const fmt = String(req.query.format ?? "json").toLowerCase();
  const table = BACKUP_ENTITIES[entity];
  if (!table) { res.status(404).json({ error: "كيان غير معروف" }); return; }
  const rows = await db.select().from(table as any);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  if (fmt === "csv") {
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="ajn-${entity}-${stamp}.csv"`);
    res.send(toCsv(rows));
  } else {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="ajn-${entity}-${stamp}.json"`);
    res.send(JSON.stringify(rows, null, 2));
  }
});

router.post("/admin/backup/import", requirePermission("backup"), async (req, res) => {
  const body = req.body ?? {};
  const confirmed = body.confirm === "AJN-IMPORT-CONFIRMED";
  if (!confirmed) { res.status(400).json({ error: "التأكيد مطلوب لاستيراد البيانات" }); return; }
  const data: Record<string, any[]> = (body.payload?.data ?? body.data ?? {}) as any;
  if (!data || typeof data !== "object") { res.status(400).json({ error: "صيغة غير صحيحة" }); return; }
  const report: Record<string, { inserted: number; skipped: number; errors: number }> = {};
  // Import in dependency order: parents before children.
  const order: BackupEntity[] = [
    "customers","categories","services","products","delivery_zones",
    "gallery_items","expense_categories",
    "orders","order_items","order_status_history",
    "service_orders","service_order_status_history",
    "receipt_vouchers","payment_vouchers","expenses",
  ];
  for (const name of order) {
    const rows = Array.isArray(data[name]) ? data[name] : [];
    if (rows.length === 0) continue;
    const table = BACKUP_ENTITIES[name] as any;
    const stats = { inserted: 0, skipped: 0, errors: 0 };
    for (const row of rows) {
      try {
        // onConflictDoNothing on primary key to avoid duplicates.
        const inserted = await db.insert(table).values(row).onConflictDoNothing().returning({ id: (table as any).id }).catch(async () => {
          // some tables may not have an id pk reachable that way; fallback to plain insert
          await db.insert(table).values(row).onConflictDoNothing();
          return [{ id: -1 }];
        });
        if (inserted.length > 0) stats.inserted++; else stats.skipped++;
      } catch (err: any) {
        req.log?.warn({ err: err?.message, table: name }, "backup import row failed");
        stats.errors++;
      }
    }
    report[name] = stats;
  }
  res.json({ ok: true, report });
});

export default router;
