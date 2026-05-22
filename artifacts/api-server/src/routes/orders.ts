import { Router, Request } from "express";
import { db } from "@workspace/db";
import {
  ordersTable, orderItemsTable, orderStatusHistoryTable,
  cartItemsTable, productsTable, deliveryZonesTable,
  serviceOrdersTable, servicesTable, serviceOrderStatusHistoryTable,
} from "@workspace/db";
import { eq, and, desc, like, sql } from "drizzle-orm";
import { CreateOrderBody, UpdateOrderStatusBody, ListOrdersQueryParams } from "@workspace/api-zod";
import { sessions } from "./auth";
import { getAdminUser, hasPermission } from "../lib/admin-auth";
import { fireOrderEvent, eventForStatus } from "../lib/whatsapp";

const router = Router();

function generateTrackingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "AJN";
  for (let i = 0; i < 7; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getSessionId(req: Request): string {
  return (req.headers["x-session-id"] as string) || "anonymous";
}

function getCurrentCustomerId(req: Request): number | null {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token && sessions.has(token)) return sessions.get(token)!;
  return null;
}

async function reqAdmin(req: Request) {
  return await getAdminUser(req);
}
async function canManageOrders(req: Request): Promise<boolean> {
  const u = await getAdminUser(req);
  return hasPermission(u, "orders");
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
    total: parseFloat(order.total),
    deliveryFee: parseFloat(order.deliveryFee),
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
      price: parseFloat(i.price),
      selectedColor: i.selectedColor ?? null,
      customization: i.customization ?? null,
      image: i.image ?? null,
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

router.get("/orders/my", async (req, res) => {
  const customerId = getCurrentCustomerId(req);
  if (!customerId) return res.status(401).json({ error: "غير مخول" });

  const orders = await db.query.ordersTable.findMany({
    where: eq(ordersTable.customerId, customerId),
    orderBy: [desc(ordersTable.createdAt)],
  });
  const formatted = await Promise.all(orders.map(formatOrder));
  return res.json(formatted);
});

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
    total: parseFloat(order.total),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productNameAr: i.productNameAr,
      quantity: i.quantity,
      price: parseFloat(i.price),
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
  const statusHistory = history.length > 0
    ? history.map(h => ({
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
    customerConfirmation: so.customerConfirmation ?? null,
    requestedDate: so.requestedDate ?? null,
    confirmationNote: so.confirmationNote ?? null,
    confirmationAt: so.confirmationAt ? so.confirmationAt.toISOString() : null,
  };
}

export { buildServiceTracking };

router.get("/orders/track/:trackingCode", async (req, res) => {
  const { trackingCode } = req.params;
  const order = await db.query.ordersTable.findFirst({
    where: eq(ordersTable.trackingCode, trackingCode),
  });
  if (order) return res.json(await buildTracking(order));

  const so = await db.query.serviceOrdersTable.findFirst({
    where: eq(serviceOrdersTable.trackingCode, trackingCode),
  });
  if (so) return res.json(await buildServiceTracking(so));

  return res.status(404).json({ error: "لم يتم العثور على الطلب" });
});

function maskName(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return parts.map(p => p.length <= 2 ? p : p.slice(0, 2) + "…").join(" ");
}

function stripPii<T extends { customerName: string; customerPhone: string | null }>(t: T) {
  return { ...t, customerName: maskName(t.customerName), customerPhone: null };
}

// Lightweight in-memory throttle: 10 requests / minute / IP
const phoneLookupHits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (phoneLookupHits.get(ip) ?? []).filter(t => now - t < 60_000);
  arr.push(now);
  phoneLookupHits.set(ip, arr);
  return arr.length > 10;
}

router.get("/orders/track-by-phone/:last4", async (req, res) => {
  const last4 = req.params.last4.replace(/\D/g, "");
  if (!/^\d{4}$/.test(last4)) {
    return res.status(400).json({ error: "يلزم آخر 4 أرقام بالضبط" });
  }

  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "unknown").trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "محاولات كثيرة، حاول لاحقاً" });
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
    ...await Promise.all(productOrders.map(buildTracking)),
    ...await Promise.all(serviceOrders.map(buildServiceTracking)),
  ]
    .map(stripPii)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return res.json(results);
});

router.get("/orders", async (req, res) => {
  if (!(await canManageOrders(req))) return res.status(401).json({ error: "غير مخول" });
  const params = ListOrdersQueryParams.safeParse(req.query);
  const { status } = params.success ? params.data : {};

  const orders = await db.query.ordersTable.findMany({
    where: status ? eq(ordersTable.status, status) : undefined,
    orderBy: [desc(ordersTable.createdAt)],
  });
  const formatted = await Promise.all(orders.map(formatOrder));
  return res.json(formatted);
});

router.post("/orders", async (req, res) => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const sessionId = getSessionId(req);
  const customerId = getCurrentCustomerId(req);
  const data = parsed.data;

  // Get cart items
  const cartItems = await db.query.cartItemsTable.findMany({
    where: eq(cartItemsTable.sessionId, sessionId),
  });
  if (cartItems.length === 0) return res.status(400).json({ error: "السلة فارغة" });

  // Get delivery fee
  let deliveryFee = 0;
  if (data.deliveryZoneId) {
    const zone = await db.query.deliveryZonesTable.findFirst({
      where: eq(deliveryZonesTable.id, data.deliveryZoneId),
    });
    if (zone) deliveryFee = parseFloat(zone.price);
  }

  const subtotal = cartItems.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);
  const total = subtotal + deliveryFee;

  const trackingCode = generateTrackingCode();

  const [order] = await db.insert(ordersTable).values({
    trackingCode,
    customerId: customerId ?? undefined,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    status: "pending",
    total: total.toString(),
    deliveryFee: deliveryFee.toString(),
    paymentMethod: data.paymentMethod && ["cod","transfer","paid"].includes(data.paymentMethod) ? data.paymentMethod : "cod",
    governorate: data.governorate,
    area: data.area ?? null,
    address: data.address,
    notes: data.notes,
    mapsUrl: data.mapsUrl ?? null,
  }).returning();

  // Insert order items
  await Promise.all(cartItems.map(async (item) => {
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

    // Decrement stock
    if (product) {
      await db.update(productsTable)
        .set({ stock: Math.max(0, product.stock - item.quantity) })
        .where(eq(productsTable.id, product.id));
    }
  }));

  // Add status history
  await db.insert(orderStatusHistoryTable).values({
    orderId: order.id,
    status: "pending",
    notes: "تم إنشاء الطلب",
  });

  // Clear cart
  await db.delete(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));

  const formatted = await formatOrder(order);

  void fireOrderEvent("placed", {
    name: order.customerName,
    phone: order.customerPhone,
    tracking: order.trackingCode,
    total: formatted.total,
    status: order.status,
  });

  return res.status(201).json(formatted);
});

router.get("/orders/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صحيح" });

  const order = await db.query.ordersTable.findFirst({
    where: eq(ordersTable.id, id),
  });
  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

  // Admin/staff with orders permission can read any order; otherwise must be the owner customer.
  const adminUser = await reqAdmin(req);
  if (!hasPermission(adminUser, "orders")) {
    const customerId = getCurrentCustomerId(req);
    if (!customerId || order.customerId !== customerId) {
      return res.status(403).json({ error: "غير مخول" });
    }
  }

  return res.json(await formatOrder(order));
});

router.patch("/orders/:id", async (req, res) => {
  if (!(await canManageOrders(req))) return res.status(401).json({ error: "غير مخول" });
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صحيح" });

  const parsed = UpdateOrderStatusBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const { status, notes } = parsed.data;
  const [order] = await db.update(ordersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(ordersTable.id, id))
    .returning();

  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

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
      total: parseFloat(order.total),
      status,
    });
  }

  return res.json(await formatOrder(order));
});

export default router;
