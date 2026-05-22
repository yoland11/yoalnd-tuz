import { Router } from "express";
import { db } from "@workspace/db";
import { ordersTable, productsTable, customersTable } from "@workspace/db";
import { sql, eq, gte, desc } from "drizzle-orm";
import { requirePermission } from "../lib/admin-auth";

const router = Router();

router.get("/dashboard/stats", requirePermission("dashboard"), async (_req, res) => {
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

  return res.json({
    totalOrders: totalOrdersResult[0]?.count ?? 0,
    totalRevenue: totalRevenueResult[0]?.sum ?? 0,
    totalProducts: totalProductsResult[0]?.count ?? 0,
    totalCustomers: totalCustomersResult[0]?.count ?? 0,
    pendingOrders: pendingOrdersResult[0]?.count ?? 0,
    todayOrders: todayOrdersResult[0]?.count ?? 0,
    todayRevenue: todayRevenueResult[0]?.sum ?? 0,
  });
});

router.get("/dashboard/recent-orders", requirePermission("dashboard"), async (_req, res) => {
  const orders = await db.query.ordersTable.findMany({
    orderBy: [desc(ordersTable.createdAt)],
    limit: 10,
  });

  return res.json(orders.map((o) => ({
    id: o.id,
    trackingCode: o.trackingCode,
    customerId: o.customerId ?? null,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    status: o.status,
    total: parseFloat(o.total),
    deliveryFee: parseFloat(o.deliveryFee),
    governorate: o.governorate ?? null,
    address: o.address ?? null,
    notes: o.notes ?? null,
    items: [],
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  })));
});

router.get("/dashboard/order-status-breakdown", requirePermission("dashboard"), async (_req, res) => {
  const result = await db
    .select({ status: ordersTable.status, count: sql<number>`count(*)::int` })
    .from(ordersTable)
    .groupBy(ordersTable.status);

  return res.json(result.map((r) => ({ status: r.status, count: r.count })));
});

export default router;
