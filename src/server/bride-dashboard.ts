import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  customerActivityLogsTable,
  db,
  entityDocumentsTable,
  entityTimelineTable,
  koshaBookingsTable,
  koshasTable,
  messageRepliesTable,
  messageThreadsTable,
  notificationsTable,
  salesInvoicesTable,
  staffTable,
  tasksTable,
} from "@workspace/db";

type Customer = { id: number; name?: string | null; fullName?: string | null; phone?: string | null };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const fail = (error: string, status = 400) => json({ error }, status);
const amount = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const input = z.object({ type: z.enum(["note", "design_change", "service_request", "support"]), body: z.string().trim().min(3).max(2000), department: z.enum(["management", "photography", "flowers", "decoration", "accounting", "support"]).default("support"), bookingId: z.coerce.number().int().positive() });
const chatInput = z.object({ body: z.string().trim().min(1).max(2000) });
const workspaceItem = z.object({
  bookingId: z.coerce.number().int().positive(),
  kind: z.enum(["checklist", "expense", "guest", "calendar", "document", "wishlist", "gift"]),
  title: z.string().trim().min(1).max(220),
  status: z.string().trim().max(40).optional().default("pending"),
  data: z.record(z.string(), z.unknown()).optional().default({}),
});

let ready: Promise<void> | null = null;
async function ensureBrideTables() {
  if (!ready) ready = db.execute(sql`
    CREATE TABLE IF NOT EXISTS bride_dashboard_requests (
      id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE RESTRICT,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE RESTRICT, request_type varchar(40) NOT NULL,
      department varchar(40) NOT NULL DEFAULT 'support', body text NOT NULL, status varchar(20) NOT NULL DEFAULT 'new',
      task_id integer REFERENCES tasks(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS bride_dashboard_requests_customer_idx ON bride_dashboard_requests(customer_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS wedding_workspace_members (
      id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE CASCADE,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      role varchar(24) NOT NULL DEFAULT 'family', permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(), UNIQUE(booking_id, customer_id)
    );
    CREATE TABLE IF NOT EXISTS wedding_workspace_items (
      id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES kosha_bookings(id) ON DELETE CASCADE,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      kind varchar(32) NOT NULL, title text NOT NULL, status varchar(40) NOT NULL DEFAULT 'pending',
      data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS wedding_workspace_items_booking_idx ON wedding_workspace_items(booking_id, kind, updated_at DESC);
    CREATE INDEX IF NOT EXISTS wedding_workspace_members_customer_idx ON wedding_workspace_members(customer_id, booking_id);
  `).then(() => undefined);
  return ready;
}
async function bookingFor(customer: Customer, bookingId?: number) {
  const membershipRows = await db.execute(sql`SELECT booking_id FROM wedding_workspace_members WHERE customer_id=${customer.id}`);
  const memberBookingIds = ((membershipRows as any).rows ?? membershipRows ?? []).map((row: any) => Number(row.booking_id)).filter(Number.isFinite);
  const where = and(
    bookingId ? eq(koshaBookingsTable.id, bookingId) : undefined,
    or(
      eq(koshaBookingsTable.customerId, customer.id),
      customer.phone ? eq(koshaBookingsTable.phone, customer.phone) : undefined,
      customer.phone ? eq(koshaBookingsTable.bridePhone, customer.phone) : undefined,
      customer.phone ? eq(koshaBookingsTable.groomPhone, customer.phone) : undefined,
      memberBookingIds.length ? inArray(koshaBookingsTable.id, memberBookingIds) : undefined,
    ),
    inArray(koshaBookingsTable.status, ["confirmed", "active", "approved", "in_progress", "completed"]),
  );
  return db.query.koshaBookingsTable.findFirst({ where, orderBy: [desc(koshaBookingsTable.eventDate), desc(koshaBookingsTable.createdAt)] });
}

export async function handleBrideDashboard(req: NextRequest, parts: string[], customer: Customer) {
  await ensureBrideTables();
  const resource = parts[2] || "home";
  const bookingId = Number(req.nextUrl.searchParams.get("bookingId") || 0) || undefined;
  const booking = await bookingFor(customer, bookingId);
  if (!booking) return fail("لا تتوفر بوابة العروس قبل تأكيد الحجز", 404);

  if (resource === "home" && req.method === "GET") {
    const [kosha, staff, invoices, requests, workspaceItems, membership, documents] = await Promise.all([
      booking.koshaId ? db.query.koshasTable.findFirst({ where: eq(koshasTable.id, booking.koshaId) }) : Promise.resolve(null),
      booking.assignedStaffId ? db.query.staffTable.findFirst({ where: eq(staffTable.id, booking.assignedStaffId) }) : Promise.resolve(null),
      db.query.salesInvoicesTable.findMany({ where: or(eq(salesInvoicesTable.customerId, customer.id), customer.phone ? eq(salesInvoicesTable.customerPhone, customer.phone) : undefined), orderBy: [desc(salesInvoicesTable.createdAt)], limit: 30 }),
      db.execute(sql`SELECT * FROM bride_dashboard_requests WHERE booking_id=${booking.id} AND customer_id=${customer.id} ORDER BY created_at DESC LIMIT 50`),
      db.execute(sql`SELECT id, kind, title, status, data, created_at, updated_at FROM wedding_workspace_items WHERE booking_id=${booking.id} AND customer_id=${customer.id} ORDER BY updated_at DESC LIMIT 500`),
      db.execute(sql`SELECT role, permissions FROM wedding_workspace_members WHERE booking_id=${booking.id} AND customer_id=${customer.id} LIMIT 1`),
      db.query.entityDocumentsTable.findMany({ where: and(eq(entityDocumentsTable.entityType, "kosha_booking"), eq(entityDocumentsTable.entityId, booking.id), isNull(entityDocumentsTable.archivedAt)), orderBy: [desc(entityDocumentsTable.createdAt)] }),
    ]);
    const details = (booking.bookingDetails ?? {}) as Record<string, any>;
    const addons = Array.isArray(booking.selectedAddons) ? booking.selectedAddons : [];
    const serviceCards = [
      { key: "kosha", title: "الكوشة والديكور", status: booking.executionStage ?? "preparing", team: staff?.fullName ?? staff?.username ?? "بانتظار التعيين", deliveryDate: booking.eventDate, preview: kosha?.mainImage ?? null },
      ...addons.map((name: string) => ({ key: `addon-${name}`, title: name, status: "confirmed", team: "فريق AJN", deliveryDate: booking.eventDate, preview: null })),
      ...(Array.isArray(details.services) ? details.services.map((x: any, i: number) => ({ key: `service-${i}`, title: String(x.name ?? x.title ?? "خدمة"), status: x.status ?? "confirmed", team: x.team ?? "فريق AJN", deliveryDate: x.deliveryDate ?? booking.eventDate, preview: x.preview ?? null })) : []),
    ];
    const timeline = [
      { key: "confirmed", title: "تم تأكيد الحجز", done: true, time: booking.createdAt, employee: "AJN" },
      { key: "deposit", title: "تم استلام العربون", done: amount(booking.paidAmount) > 0, time: null, employee: "الحسابات" },
      { key: "design", title: "مرحلة التصميم", done: ["design", "preparing", "in_progress", "ready", "completed"].includes(String(booking.executionStage)), time: null, employee: staff?.fullName ?? "فريق التصميم" },
      { key: "preparing", title: "قيد التجهيز", done: ["preparing", "in_progress", "ready", "completed"].includes(String(booking.executionStage)), time: null, employee: staff?.fullName ?? "فريق AJN" },
      { key: "ready", title: "جاهز", done: ["ready", "completed"].includes(String(booking.executionStage)), time: null, employee: staff?.fullName ?? "فريق AJN" },
      { key: "event", title: "يوم المناسبة", done: false, time: booking.eventDate, employee: "AJN" },
    ];
    return json({
      customer: { id: customer.id, name: customer.fullName || customer.name || "العروس", role: ((membership as any).rows ?? membership ?? [])[0]?.role ?? "owner" },
      booking: { id: booking.id, number: booking.trackingCode || `AJN-KOSHA-${booking.id}`, brideName: booking.brideName || booking.customerName, groomName: booking.groomName || "", date: booking.eventDate, time: booking.eventTime, hall: booking.hallLocation || booking.area || "", packageName: booking.packageName || kosha?.name || "", status: booking.executionStage || booking.status, total: amount(booking.totalAmount), paid: amount(booking.paidAmount), remaining: amount(booking.remainingAmount), paymentStatus: booking.paymentStatus, dueDate: booking.dueDate },
      services: serviceCards, timeline, invoices: invoices.map((x) => ({ id: x.id, no: x.invoiceNo, total: amount(x.total), paid: amount(x.paidAmount), remaining: amount(x.remainingAmount), status: x.paymentStatus, date: x.date })),
      schedule: details.eventSchedule ?? {}, designs: Array.isArray(details.designs) ? details.designs : [], invitations: details.digitalInvitation ?? null, gallery: details.gallery ?? null, documents: documents.map((document) => ({ id: document.id, title: document.title, type: document.documentType, url: document.fileUrl, createdAt: document.createdAt })), requests: (requests as any).rows ?? requests ?? [], workspaceItems: (workspaceItems as any).rows ?? workspaceItems ?? [],
      contacts: [{ key: "management", title: "الإدارة" }, { key: "photography", title: "التصوير" }, { key: "flowers", title: "الزهور" }, { key: "decoration", title: "الديكور" }, { key: "accounting", title: "الحسابات" }, { key: "support", title: "الدعم" }],
    });
  }
  if (resource === "requests" && req.method === "POST") {
    const parsed = input.safeParse(await req.json().catch(() => ({}))); if (!parsed.success) return fail("تحقق من بيانات الطلب");
    if (parsed.data.bookingId !== booking.id) return fail("لا يمكنك إرسال طلب لحجز آخر", 403);
    const title = parsed.data.type === "design_change" ? "طلب تعديل تصميم من بوابة العروس" : parsed.data.type === "service_request" ? "طلب خدمة من بوابة العروس" : "ملاحظة من بوابة العروس";
    const result = await db.transaction(async (tx) => {
      const [task] = await tx.insert(tasksTable).values({ title, description: parsed.data.body, status: "new", priority: parsed.data.type === "design_change" ? "high" : "medium", department: parsed.data.department, taskType: "bride_dashboard", relatedType: "kosha_booking", relatedId: booking.id, createdBy: null, notes: `العميلة: ${customer.fullName || customer.name || ""}` }).returning();
      const row = (await tx.execute(sql`INSERT INTO bride_dashboard_requests (booking_id, customer_id, request_type, department, body, task_id) VALUES (${booking.id}, ${customer.id}, ${parsed.data.type}, ${parsed.data.department}, ${parsed.data.body}, ${task.id}) RETURNING *`)).rows[0];
      await tx.insert(entityTimelineTable).values({ entityType: "kosha_booking", entityId: booking.id, type: "customer_request", title, actorName: customer.fullName || customer.name || "العميلة", metadata: { taskId: task.id, requestId: (row as any).id, department: parsed.data.department } as any });
      await tx.insert(notificationsTable).values({ audienceType: "admin", type: "bride_dashboard_request", title, body: parsed.data.body, entityType: "kosha_booking", entityId: booking.id, href: `/admin/kosha-bookings/${booking.id}`, metadata: { taskId: task.id, customerId: customer.id } });
      await tx.insert(customerActivityLogsTable).values({ customerId: customer.id, phone: customer.phone ?? null, action: "bride_dashboard_request", entityType: "kosha_booking", entityId: booking.id, entityLabel: title, metadata: { taskId: task.id, requestType: parsed.data.type, department: parsed.data.department }, ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: req.headers.get("user-agent") ?? null });
      return { row, taskId: task.id };
    });
    return json({ request: result.row, taskId: result.taskId }, 201);
  }
  if (resource === "chat" && req.method === "GET") {
    const thread = await db.query.messageThreadsTable.findFirst({ where: and(eq(messageThreadsTable.customerId, customer.id), eq(messageThreadsTable.relatedType, "kosha_booking"), eq(messageThreadsTable.relatedId, booking.id)), orderBy: [desc(messageThreadsTable.lastMessageAt)] });
    if (!thread) return json({ thread: null, messages: [] });
    const messages = await db.query.messageRepliesTable.findMany({ where: eq(messageRepliesTable.threadId, thread.id), orderBy: [messageRepliesTable.createdAt] });
    return json({ thread: { id: thread.id, subject: thread.subject, status: thread.status }, messages });
  }
  if (resource === "chat" && req.method === "POST") {
    const parsed = chatInput.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("الرسالة غير صالحة");
    const result = await db.transaction(async (tx) => {
      let thread = await tx.query.messageThreadsTable.findFirst({ where: and(eq(messageThreadsTable.customerId, customer.id), eq(messageThreadsTable.relatedType, "kosha_booking"), eq(messageThreadsTable.relatedId, booking.id)), orderBy: [desc(messageThreadsTable.lastMessageAt)] });
      if (!thread) {
        [thread] = await tx.insert(messageThreadsTable).values({ customerId: customer.id, phone: customer.phone ?? booking.phone, customerName: customer.fullName || customer.name || booking.customerName, subject: "محادثة بوابة العروس", status: "new", relatedType: "kosha_booking", relatedId: booking.id }).returning();
      }
      const [message] = await tx.insert(messageRepliesTable).values({ threadId: thread.id, senderType: "customer", body: parsed.data.body }).returning();
      await tx.update(messageThreadsTable).set({ status: "new", lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(messageThreadsTable.id, thread.id));
      await tx.insert(customerActivityLogsTable).values({ customerId: customer.id, phone: customer.phone ?? null, action: "bride_dashboard_message", entityType: "message_thread", entityId: thread.id, entityLabel: "محادثة بوابة العروس", metadata: { bookingId: booking.id }, ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: req.headers.get("user-agent") ?? null });
      await tx.insert(notificationsTable).values({ audienceType: "admin", type: "bride_dashboard_message", title: "رسالة جديدة من بوابة العروس", body: parsed.data.body, entityType: "message_thread", entityId: thread.id, href: "/admin/messages", metadata: { bookingId: booking.id, customerId: customer.id } });
      return { threadId: thread.id, message };
    });
    return json(result, 201);
  }
  if (resource === "workspace" && parts[3] === "items" && req.method === "POST") {
    const parsed = workspaceItem.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("تحقق من بيانات العنصر");
    if (parsed.data.bookingId !== booking.id) return fail("لا يمكنك إضافة بيانات إلى حجز آخر", 403);
    const rows = await db.execute(sql`
      INSERT INTO wedding_workspace_items (booking_id, customer_id, kind, title, status, data)
      VALUES (${booking.id}, ${customer.id}, ${parsed.data.kind}, ${parsed.data.title}, ${parsed.data.status}, ${JSON.stringify(parsed.data.data)}::jsonb)
      RETURNING id, kind, title, status, data, created_at, updated_at
    `);
    return json({ item: ((rows as any).rows ?? rows)[0] }, 201);
  }
  if (resource === "workspace" && parts[3] === "items" && parts[4] && req.method === "PATCH") {
    const itemId = Number(parts[4]);
    if (!Number.isFinite(itemId)) return fail("معرف غير صحيح");
    const parsed = workspaceItem.omit({ bookingId: true, kind: true }).partial().safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("تحقق من بيانات العنصر");
    const rows = await db.execute(sql`
      UPDATE wedding_workspace_items
      SET title = coalesce(${parsed.data.title ?? null}, title), status = coalesce(${parsed.data.status ?? null}, status),
          data = coalesce(${parsed.data.data === undefined ? null : JSON.stringify(parsed.data.data)}::jsonb, data), updated_at = now()
      WHERE id=${itemId} AND booking_id=${booking.id} AND customer_id=${customer.id}
      RETURNING id, kind, title, status, data, created_at, updated_at
    `);
    const item = ((rows as any).rows ?? rows)[0];
    if (!item) return fail("العنصر غير موجود", 404);
    return json({ item });
  }
  return fail("المسار غير موجود", 404);
}
