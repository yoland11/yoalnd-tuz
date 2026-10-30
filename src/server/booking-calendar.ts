import { sql, type SQL } from "drizzle-orm";
import {
  BOOKING_DEPARTMENTS,
  addCalendarDays,
  baghdadDay,
  calendarDaySpan,
  eventCalendarDay,
  isCalendarDay,
  normalizeBookingDepartments,
  normalizeEventTime,
  type BookingCalendarEvent,
  type BookingDepartmentKey,
} from "@/lib/booking-calendar";
import { bookingDisplayNumber } from "@/lib/booking-number";
import { readBookingResourceWindow, resourceWindowCalendar } from "@/lib/booking-resource-window";
import { koshaBookingDepartments, serviceOrderDepartments } from "./booking-departments";

type Executor = { execute: (query: SQL) => Promise<any> };

/** Six weeks of a month view plus margin; a longer read is a mistake, not a view. */
const MAX_RANGE_DAYS = 62;
/** Per source. Hitting it is reported, never silently dropped. */
const ROW_CAP = 5000;

export class BookingCalendarRangeError extends Error {}

export function parseBookingCalendarRange(fromValue: string | null, toValue: string | null, today: string = baghdadDay()) {
  const from = fromValue || today;
  const to = toValue || from;
  if (!isCalendarDay(from) || !isCalendarDay(to)) throw new BookingCalendarRangeError("تاريخ التقويم غير صحيح");
  if (from > to) throw new BookingCalendarRangeError("بداية فترة التقويم بعد نهايتها");
  if (calendarDaySpan(from, to).length > MAX_RANGE_DAYS) throw new BookingCalendarRangeError(`فترة التقويم لا يمكن أن تتجاوز ${MAX_RANGE_DAYS} يوماً`);
  return { from, to };
}

const record = (value: unknown): Record<string, any> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {});
const rows = (result: any): any[] => {
  if (!Array.isArray(result?.rows)) throw new Error("Invalid booking calendar database response");
  return result.rows;
};
const text = (value: unknown) => String(value ?? "").trim();
const positive = (value: unknown) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** People assigned to a booking; unnamed ids are not listed as employees. */
function assignedStaff(details: Record<string, any>, extra: { id?: unknown; name?: unknown }[] = []) {
  const staff = new Map<number, string>();
  const add = (id: unknown, name: unknown) => {
    const staffId = positive(id);
    const staffName = text(name);
    if (staffId && staffName && !staff.has(staffId)) staff.set(staffId, staffName);
  };
  for (const row of Array.isArray(details.bookingStaffAssignments) ? details.bookingStaffAssignments : []) add(row?.id, row?.name);
  add(details.primaryEmployeeId, details.primaryEmployeeName);
  add(details.assistantEmployeeId, details.assistantEmployeeName);
  for (const row of extra) add(row.id, row.name);
  return [...staff.entries()].map(([id, name]) => ({ id, name }));
}

/** The explicit operating period is authoritative; otherwise the saved event time. */
function eventTiming(details: Record<string, any>, eventDate: string, eventTime: unknown) {
  const window = readBookingResourceWindow(record(details.bookingOperations), eventDate);
  if (window) {
    const calendar = resourceWindowCalendar(window);
    return { startTime: calendar.eventTime, endTime: calendar.endTime, timeNote: null };
  }
  const saved = text(eventTime);
  const startTime = normalizeEventTime(saved) ?? (eventDate.includes("T") ? normalizeEventTime(eventDate) : null);
  return { startTime, endTime: null, timeNote: startTime ? null : saved || null };
}

const ajnTransport = (mode: unknown) => text(mode) === "ajn";

/** Service lines per department: a repeated service is more units, still one booking. */
function serviceUnits(details: Record<string, any>) {
  const units: Record<string, number> = {};
  for (const item of Array.isArray(details.bookingCenterServices) ? details.bookingCenterServices : []) {
    const type = text(item?.type ?? item?.key);
    if (type) units[type] = (units[type] ?? 0) + 1;
  }
  return units;
}

function bookingEvent(event: Omit<BookingCalendarEvent, "key" | "countsAsBooking" | "staff" | "departmentUnits" | "workspaceHref" | "endTime" | "timeNote"> & Partial<Pick<BookingCalendarEvent, "key" | "countsAsBooking" | "staff" | "departmentUnits" | "workspaceHref" | "endTime" | "timeNote">>): BookingCalendarEvent {
  return { countsAsBooking: true, staff: [], departmentUnits: {}, workspaceHref: null, endTime: null, timeNote: null, key: `${event.kind}-${event.id}`, ...event };
}

const department = (key: BookingDepartmentKey) => [key] as string[];

export type BookingCalendarQuery = { from: string; to: string; serviceId?: number | null; crew?: string | null; status?: string | null };

/**
 * Every booking whose date falls in the visible range, from every source with a
 * real date. A photography event linked to a service order, or a store order
 * that became one, is that same booking and is never listed twice.
 */
export async function readBookingCalendar(executor: Executor, query: BookingCalendarQuery) {
  const { from, to } = query;
  const nextDay = addCalendarDays(to, 1);
  const storeFrom = new Date(`${from}T00:00:00+03:00`).toISOString();
  const storeTo = new Date(`${nextDay}T00:00:00+03:00`).toISOString();
  const [serviceOrders, koshaBookings, services, photographyEvents, graduationGroups, graduationOrders, cateringOrders, rentals, storeOrders] = await Promise.all([
    executor.execute(sql`
      SELECT o.id, o.service_id, o.tracking_code, o.customer_name, o.phone, o.event_date, o.event_location, o.status, o.custom_fields
      FROM service_orders o
      WHERE o.archived_at IS NULL AND o.event_date >= ${from} AND o.event_date < ${nextDay}
      ORDER BY o.event_date, o.id LIMIT ${ROW_CAP + 1}
    `),
    executor.execute(sql`
      SELECT k.id, k.tracking_code, k.customer_name, k.phone, k.event_date, k.event_time, k.province, k.area, k.hall_location,
        k.transportation_mode, k.status, k.booking_details, k.assigned_staff_id,
        (SELECT coalesce(nullif(st.full_name, ''), st.username) FROM staff st WHERE st.id = k.assigned_staff_id) AS assigned_staff_name
      FROM kosha_bookings k
      WHERE k.archived_at IS NULL AND k.event_date >= ${from} AND k.event_date < ${nextDay}
      ORDER BY k.event_date, k.id LIMIT ${ROW_CAP + 1}
    `),
    executor.execute(sql`SELECT id, name, name_ar, type FROM services`),
    executor.execute(sql`
      SELECT e.id, e.booking_code, e.event_name, e.groom_name, e.phone, e.event_date::text AS event_date, e.event_start_time, e.event_end_time,
        e.location, e.status, e.assigned_staff_id, e.assigned_staff_name
      FROM photography_events e
      WHERE e.booking_id IS NULL AND e.status <> 'archived' AND e.event_date >= ${from}::date AND e.event_date <= ${to}::date
      ORDER BY e.event_date, e.id LIMIT ${ROW_CAP + 1}
    `),
    executor.execute(sql`
      SELECT g.id, g.group_no, g.title, g.representative_name, g.representative_phone, g.university, g.college, g.event_date::text AS event_date, g.status,
        (SELECT count(*) FROM graduation_orders o WHERE o.group_id = g.id AND o.archived_at IS NULL AND o.status <> 'cancelled')::int AS students
      FROM graduation_groups g
      WHERE g.status <> 'archived' AND g.event_date >= ${from}::date AND g.event_date <= ${to}::date
      ORDER BY g.event_date, g.id LIMIT ${ROW_CAP + 1}
    `),
    executor.execute(sql`
      SELECT o.id, o.order_no, o.customer_name, o.phone, o.status, o.due_date::text AS due_date, o.group_id, g.group_no, g.title AS group_title, g.status AS group_status,
        g.representative_name, g.representative_phone
      FROM graduation_orders o LEFT JOIN graduation_groups g ON g.id = o.group_id
      WHERE o.archived_at IS NULL AND o.due_date >= ${from}::date AND o.due_date <= ${to}::date AND (o.group_id IS NULL OR g.event_date IS NULL)
      ORDER BY o.due_date, o.id LIMIT ${ROW_CAP + 1}
    `),
    executor.execute(sql`
      SELECT c.id, c.order_no, c.customer_name, c.customer_phone, c.customer_address, c.occasion, c.event_date::text AS event_date, c.status
      FROM catering_orders c
      WHERE c.status <> 'draft' AND c.event_date >= ${from}::date AND c.event_date <= ${to}::date
      ORDER BY c.event_date, c.id LIMIT ${ROW_CAP + 1}
    `),
    executor.execute(sql`
      SELECT r.id, r.order_no, r.customer_name, r.phone, r.start_date::text AS start_date, r.end_date::text AS end_date, r.status,
        (SELECT coalesce(nullif(p.name_ar, ''), p.name) FROM products p WHERE p.id = r.product_id) AS product_name
      FROM rental_orders r
      WHERE r.start_date >= ${from}::date AND r.start_date <= ${to}::date
        AND NOT EXISTS (SELECT 1 FROM orders store WHERE store.tracking_code = r.order_no)
      ORDER BY r.start_date, r.id LIMIT ${ROW_CAP + 1}
    `),
    executor.execute(sql`
      SELECT o.id, o.tracking_code, o.customer_name, o.customer_phone, o.governorate, o.area, o.address, o.status,
        to_char((o.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM-DD') AS day
      FROM orders o
      WHERE o.archived_at IS NULL AND o.created_at >= ${storeFrom}::timestamp AND o.created_at < ${storeTo}::timestamp
        AND NOT EXISTS (SELECT 1 FROM service_orders linked WHERE linked.archived_at IS NULL AND linked.custom_fields->>'storeOrderId' = o.id::text)
      ORDER BY o.created_at DESC LIMIT ${ROW_CAP + 1}
    `),
  ]);

  const sources = [serviceOrders, koshaBookings, photographyEvents, graduationGroups, graduationOrders, cateringOrders, rentals, storeOrders].map(rows);
  const truncated = sources.some((source) => source.length > ROW_CAP);
  const capped = (result: any) => rows(result).slice(0, ROW_CAP);
  const serviceMap = new Map(rows(services).map((service) => [Number(service.id), service]));
  const inRange = (day: string | null): day is string => Boolean(day && day >= from && day <= to);
  const events: BookingCalendarEvent[] = [];

  for (const row of capped(serviceOrders)) {
    const eventDate = text(row.event_date);
    const day = eventCalendarDay(eventDate);
    if (!inRange(day)) continue;
    const fields = record(row.custom_fields);
    const service = serviceMap.get(Number(row.service_id));
    const transport = ajnTransport(record(record(fields.bookingOperations).transportation).mode);
    const id = Number(row.id);
    const base = `/admin/bookings/service/${id}`;
    events.push(bookingEvent({
      id,
      kind: "service",
      title: text(service?.name_ar) || text(service?.name) || "حجز خدمة",
      customerName: text(row.customer_name),
      phone: text(row.phone),
      trackingCode: row.tracking_code ?? null,
      number: bookingDisplayNumber("service", id, row.tracking_code) || text(row.tracking_code) || `#${id}`,
      status: text(row.status),
      date: eventDate,
      day,
      ...eventTiming(fields, eventDate, fields.eventTime),
      location: text(fields.hallName) || text(row.event_location),
      departments: normalizeBookingDepartments([...serviceOrderDepartments(fields, service ? { type: service.type, nameAr: service.name_ar } : null), ...(transport ? ["transportation"] : [])]),
      departmentUnits: serviceUnits(fields),
      staff: assignedStaff(fields),
      detailHref: base,
      workspaceHref: `${base}?tab=tasks`,
      serviceId: Number(row.service_id),
      serviceType: service?.type ?? null,
      crewName: text(fields.crewName),
    }));
  }

  for (const row of capped(koshaBookings)) {
    const eventDate = text(row.event_date);
    const day = eventCalendarDay(eventDate);
    if (!inRange(day)) continue;
    const details = record(row.booking_details);
    const id = Number(row.id);
    const base = `/admin/bookings/kosha/${id}`;
    events.push(bookingEvent({
      id,
      kind: "kosha",
      title: "حجز كوشة",
      customerName: text(row.customer_name),
      phone: text(row.phone),
      trackingCode: row.tracking_code ?? `KB-${id}`,
      number: bookingDisplayNumber("kosha", id, row.tracking_code) || text(row.tracking_code) || `KB-${id}`,
      status: text(row.status),
      date: eventDate,
      day,
      ...eventTiming(details, eventDate, row.event_time),
      location: [row.province, row.area, row.hall_location].map(text).filter(Boolean).join(" / "),
      departments: normalizeBookingDepartments([...koshaBookingDepartments(details), ...(ajnTransport(row.transportation_mode) ? ["transportation"] : [])], "kosha"),
      departmentUnits: serviceUnits(details),
      staff: assignedStaff(details, [{ id: row.assigned_staff_id, name: row.assigned_staff_name }]),
      detailHref: base,
      workspaceHref: `${base}?tab=tasks`,
      primaryEmployeeName: details.primaryEmployeeName ?? null,
      assistantEmployeeName: details.assistantEmployeeName ?? null,
    }));
  }

  for (const row of capped(photographyEvents)) {
    const id = Number(row.id);
    const day = eventCalendarDay(row.event_date);
    if (!inRange(day)) continue;
    const startTime = normalizeEventTime(row.event_start_time);
    events.push(bookingEvent({
      id,
      kind: "photography",
      title: text(row.event_name) || "حجز تصوير",
      customerName: text(row.groom_name) || text(row.event_name),
      phone: text(row.phone),
      trackingCode: null,
      number: text(row.booking_code) || `PH-${id}`,
      status: text(row.status),
      date: day,
      day,
      startTime,
      endTime: startTime ? normalizeEventTime(row.event_end_time) : null,
      timeNote: startTime ? null : text(row.event_start_time) || null,
      location: text(row.location),
      departments: department("photography"),
      staff: assignedStaff({}, [{ id: row.assigned_staff_id, name: row.assigned_staff_name }]),
      detailHref: "/admin/photography-operations",
    }));
  }

  for (const row of capped(graduationGroups)) {
    const id = Number(row.id);
    const day = eventCalendarDay(row.event_date);
    if (!inRange(day)) continue;
    events.push(bookingEvent({
      id,
      kind: "graduation_group",
      title: Number(row.students) > 0 ? `تخرج جماعي · ${row.students} طالب` : "تخرج جماعي",
      customerName: text(row.title) || text(row.representative_name),
      phone: text(row.representative_phone),
      trackingCode: null,
      number: text(row.group_no) || `GRP-${id}`,
      status: text(row.status),
      date: day,
      day,
      startTime: null,
      location: [row.university, row.college].map(text).filter(Boolean).join(" / "),
      departments: department("graduation"),
      detailHref: "/admin/graduation/groups",
    }));
  }

  // Only a group with no event date reaches this list: its students' shared due
  // date stands in for the event, and the group still counts as one booking.
  const undatedGroups = new Map<string, { row: any; students: number; day: string }>();
  for (const row of capped(graduationOrders)) {
    const day = eventCalendarDay(row.due_date);
    if (!inRange(day)) continue;
    const groupId = positive(row.group_id);
    if (groupId) {
      if (text(row.status) === "cancelled") continue;
      const key = `${groupId}:${day}`;
      const entry = undatedGroups.get(key) ?? { row, students: 0, day };
      entry.students += 1;
      undatedGroups.set(key, entry);
      continue;
    }
    const id = Number(row.id);
    events.push(bookingEvent({
      id,
      kind: "graduation",
      title: "طلب تخرج",
      customerName: text(row.customer_name),
      phone: text(row.phone),
      trackingCode: null,
      number: text(row.order_no) || `GRD-${id}`,
      status: text(row.status),
      date: day,
      day,
      startTime: null,
      timeNote: "موعد التسليم",
      location: "",
      departments: department("graduation"),
      detailHref: `/admin/graduation/orders?order=${id}`,
    }));
  }
  for (const { row, students, day } of undatedGroups.values()) {
    const id = Number(row.group_id);
    events.push(bookingEvent({
      id,
      key: `graduation_group-${id}-${day}`,
      kind: "graduation_group",
      title: `تخرج جماعي · ${students} طالب`,
      customerName: text(row.group_title) || text(row.representative_name),
      phone: text(row.representative_phone),
      trackingCode: null,
      number: text(row.group_no) || `GRP-${id}`,
      status: text(row.group_status),
      date: day,
      day,
      startTime: null,
      timeNote: "موعد التسليم",
      location: "",
      departments: department("graduation"),
      detailHref: "/admin/graduation/groups",
    }));
  }

  for (const row of capped(cateringOrders)) {
    const id = Number(row.id);
    const day = eventCalendarDay(row.event_date);
    if (!inRange(day)) continue;
    events.push(bookingEvent({
      id,
      kind: "catering",
      title: text(row.occasion) || "حجز ضيافة",
      customerName: text(row.customer_name),
      phone: text(row.customer_phone),
      trackingCode: null,
      number: text(row.order_no) || `CT-${id}`,
      status: text(row.status),
      date: day,
      day,
      startTime: null,
      location: text(row.customer_address),
      departments: department("catering"),
      detailHref: "/admin/catering",
    }));
  }

  for (const row of capped(rentals)) {
    const id = Number(row.id);
    const day = eventCalendarDay(row.start_date);
    if (!inRange(day)) continue;
    events.push(bookingEvent({
      id,
      kind: "rental",
      title: text(row.product_name) || "حجز إيجار",
      customerName: text(row.customer_name),
      phone: text(row.phone),
      trackingCode: null,
      number: text(row.order_no) || `RNT-${id}`,
      status: text(row.status),
      date: day,
      day,
      startTime: null,
      timeNote: row.end_date ? `حتى ${text(row.end_date)}` : null,
      location: "",
      departments: department("rental"),
      detailHref: "/admin/bookings",
    }));
  }

  for (const row of capped(storeOrders)) {
    const id = Number(row.id);
    const day = text(row.day);
    if (!inRange(day)) continue;
    events.push(bookingEvent({
      id,
      kind: "order",
      countsAsBooking: false,
      title: "طلب متجر",
      customerName: text(row.customer_name),
      phone: text(row.customer_phone),
      trackingCode: row.tracking_code ?? null,
      number: text(row.tracking_code) || `#${id}`,
      status: text(row.status),
      date: day,
      day,
      startTime: null,
      timeNote: "تاريخ الطلب",
      location: [row.governorate, row.area, row.address].map(text).filter(Boolean).join(" / "),
      departments: [],
      detailHref: `/admin/orders?order=${id}`,
    }));
  }

  const crew = query.crew?.trim();
  return {
    range: { from, to },
    departments: BOOKING_DEPARTMENTS,
    truncated,
    events: events
      .filter((event) => !query.status || event.status === query.status)
      .filter((event) => !query.serviceId || event.kind !== "service" || event.serviceId === query.serviceId)
      .filter((event) => !crew || event.kind !== "service" || (event.crewName ?? "").includes(crew)),
  };
}
