import { Router } from "express";
import { db } from "@workspace/db";
import { servicesTable, serviceOrdersTable, serviceOrderStatusHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateServiceOrderBody, RespondToBookingBody } from "@workspace/api-zod";
import { fireOrderEvent } from "../lib/whatsapp";
import { buildServiceTracking } from "./orders";
import { logger } from "../lib/logger";

const router = Router();

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

router.get("/services", async (req, res) => {
  const services = await db.query.servicesTable.findMany({
    where: eq(servicesTable.isActive, true),
    orderBy: (s, { asc }) => [asc(s.id)],
  });
  return res.json(services.map(formatService));
});

router.get("/services/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صحيح" });

  const service = await db.query.servicesTable.findFirst({
    where: eq(servicesTable.id, id),
  });
  if (!service) return res.status(404).json({ error: "الخدمة غير موجودة" });
  return res.json(formatService(service));
});

function generateServiceTrackingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "AJS";
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function insertWithUniqueTrackingCode(values: Omit<typeof serviceOrdersTable.$inferInsert, "trackingCode">) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db.insert(serviceOrdersTable)
        .values({ ...values, trackingCode: generateServiceTrackingCode() })
        .returning();
      return row;
    } catch (err: any) {
      if (err?.code !== "23505") throw err; // not a unique-violation
    }
  }
  throw new Error("فشل توليد رمز تتبع فريد");
}

router.post("/service-orders", async (req, res) => {
  const parsed = CreateServiceOrderBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

  const data = parsed.data;
  const order = await insertWithUniqueTrackingCode({
    serviceId: data.serviceId,
    customerName: data.customerName,
    phone: data.phone,
    eventDate: data.eventDate,
    eventLocation: data.eventLocation,
    notes: data.notes,
    customFields: data.customFields,
  });

  await db.insert(serviceOrderStatusHistoryTable).values({
    serviceOrderId: order.id,
    status: order.status,
    notes: "تم إنشاء الحجز",
  });

  const service = await db.query.servicesTable.findFirst({
    where: eq(servicesTable.id, data.serviceId),
  });

  void fireOrderEvent("booking_placed", {
    name: order.customerName,
    phone: order.phone,
    tracking: order.trackingCode ?? "",
    status: order.status,
    service: service?.nameAr ?? service?.name ?? "",
  });

  return res.status(201).json({
    id: order.id,
    serviceId: order.serviceId,
    serviceName: service?.nameAr ?? "",
    trackingCode: order.trackingCode ?? null,
    customerName: order.customerName,
    phone: order.phone,
    eventDate: order.eventDate ?? null,
    eventLocation: order.eventLocation ?? null,
    notes: order.notes ?? null,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
  });
});

// Lightweight rate-limit per IP for the public response endpoint (10/min)
const respondHits = new Map<string, number[]>();
function respondRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (respondHits.get(ip) ?? []).filter(t => now - t < 60_000);
  arr.push(now);
  respondHits.set(ip, arr);
  return arr.length > 10;
}

router.post("/service-orders/track/:trackingCode/respond", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "unknown").trim();
  if (respondRateLimited(ip)) {
    return res.status(429).json({ error: "محاولات كثيرة، حاول لاحقاً" });
  }

  const parsed = RespondToBookingBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
  const { action, requestedDate, note } = parsed.data;

  const trackingCode = req.params.trackingCode;
  const so = await db.query.serviceOrdersTable.findFirst({
    where: eq(serviceOrdersTable.trackingCode, trackingCode),
  });
  if (!so) return res.status(404).json({ error: "لم يتم العثور على الحجز" });

  if (action === "reschedule" && !requestedDate) {
    return res.status(400).json({ error: "يلزم تحديد موعد جديد" });
  }

  const confirmation = action === "confirm" ? "confirmed" : "reschedule_requested";
  const noteText = typeof note === "string" ? note.slice(0, 500) : null;
  const newRequestedDate = action === "reschedule" ? requestedDate!.slice(0, 100) : null;

  const updates: Partial<typeof serviceOrdersTable.$inferInsert> = {
    customerConfirmation: confirmation,
    requestedDate: newRequestedDate,
    confirmationNote: noteText,
    confirmationAt: new Date(),
  };
  // On a customer-initiated reschedule request, flip the booking into a
  // dedicated status so admins see it as an explicit todo. Stash the
  // previous status so we can revert it if the admin rejects the request.
  if (action === "reschedule" && so.status !== "reschedule_pending") {
    updates.status = "reschedule_pending";
    updates.preRescheduleStatus = so.status;
  }

  const [updated] = await db.update(serviceOrdersTable)
    .set(updates)
    .where(eq(serviceOrdersTable.id, so.id))
    .returning();

  const historyNote = action === "confirm"
    ? `الزبون أكد الموعد${noteText ? ` — ${noteText}` : ""}`
    : `الزبون طلب تغيير الموعد إلى ${newRequestedDate}${noteText ? ` — ${noteText}` : ""}`;

  await db.insert(serviceOrderStatusHistoryTable).values({
    serviceOrderId: so.id,
    status: updated.status,
    notes: historyNote,
  });

  logger.info({
    bookingId: so.id,
    trackingCode,
    action,
    requestedDate: newRequestedDate,
  }, "Customer responded to booking");

  return res.json(await buildServiceTracking(updated));
});

export default router;
