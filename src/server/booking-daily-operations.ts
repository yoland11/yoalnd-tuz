import { sql } from "drizzle-orm";
import { buildDailyOperations, dailyAssignedStaffIds, dailyOperationsRange, type DailyBookingFact, type DailyFilters, type DailySource } from "@/lib/booking-daily-operations";

type Executor = { execute: (query: any) => Promise<any> };
const sourceType = (source: DailySource) => source === "kosha" ? "kosha_booking" : "service_order";
const idOrNull = (value: any) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function rowsOf(result: any): any[] {
  if (!Array.isArray(result?.rows)) throw new Error("Daily operations query returned an invalid result");
  return result.rows;
}

/** No global cache, schema setup, writes, inventory calculation or financial queries. */
export async function loadDailyOperations(executor: Executor, filters: DailyFilters, allowedSources: DailySource[], now = new Date()) {
  if (!allowedSources.length) throw new Error("لا توجد صلاحية لعرض الحجوزات");
  const range = dailyOperationsRange(filters.period, now);
  const selects = [];
  if (allowedSources.includes("kosha")) selects.push(sql`
    SELECT 'kosha'::text AS source, b.id, b.tracking_code AS number, b.customer_name,
      b.event_date, b.event_time, coalesce(nullif(b.hall_location,''), nullif(b.city_area,''), nullif(b.address_notes,''), nullif(b.province,'')) AS location,
      b.status, 'kosha'::text AS category, b.booking_details AS details, b.assigned_staff_id,
      coalesce(b.transportation_vehicle_id, d.vehicle_id) AS vehicle_id, v.name AS vehicle_name,
      b.transportation_mode, c.name AS crew_name
    FROM kosha_bookings b
    LEFT JOIN dispatch_assignments d ON d.entity_type = 'kosha_booking' AND d.entity_id = b.id AND d.status IN ('assigned','en_route','active')
    LEFT JOIN fleet_vehicles v ON v.id = coalesce(b.transportation_vehicle_id, d.vehicle_id)
    LEFT JOIN crews c ON c.id = d.crew_id
    WHERE b.archived_at IS NULL AND b.status NOT IN ('cancelled','canceled','deleted')
      AND left(b.event_date,10) >= ${range.from} AND left(b.event_date,10) < ${range.to}
  `);
  if (allowedSources.includes("service")) selects.push(sql`
    SELECT 'service'::text AS source, b.id, b.tracking_code AS number, b.customer_name,
      b.event_date, b.custom_fields->>'eventTime' AS event_time, b.event_location AS location,
      b.status, coalesce(nullif(s.type,''), 'service') AS category, b.custom_fields AS details,
      NULL::integer AS assigned_staff_id, d.vehicle_id, v.name AS vehicle_name,
      NULL::text AS transportation_mode, c.name AS crew_name
    FROM service_orders b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN dispatch_assignments d ON d.entity_type = 'service_order' AND d.entity_id = b.id AND d.status IN ('assigned','en_route','active')
    LEFT JOIN fleet_vehicles v ON v.id = d.vehicle_id
    LEFT JOIN crews c ON c.id = d.crew_id
    WHERE b.archived_at IS NULL AND b.status NOT IN ('cancelled','canceled','deleted')
      AND left(b.event_date,10) >= ${range.from} AND left(b.event_date,10) < ${range.to}
  `);
  const candidates = rowsOf(await executor.execute(sql`
    SELECT * FROM (${sql.join(selects, sql` UNION ALL `)}) bookings
    ORDER BY left(event_date,10), event_time NULLS LAST, source, id LIMIT ${501}
  `));
  const truncated = candidates.length > 500;
  const facts: DailyBookingFact[] = candidates.slice(0, 500).map((b) => ({
    source: b.source, id: Number(b.id), number: b.number || `${b.source === "kosha" ? "KOSHA" : "SRV"}-${b.id}`,
    customerName: b.customer_name, eventDate: b.event_date, eventTime: b.event_time || null,
    location: b.location, status: b.status, category: b.category, details: b.details ?? {},
    assignedStaffId: idOrNull(b.assigned_staff_id), vehicleId: idOrNull(b.vehicle_id), vehicleName: b.vehicle_name,
    transportationMode: b.transportation_mode, crewName: b.crew_name, openTasks: 0, overdueTasks: 0, products: [],
  }));
  if (!facts.length) return buildDailyOperations([], filters, truncated, now);
  const refs = facts.map((b) => sql`(${sourceType(b.source)},${b.id})`);
  const [reservations, tasks] = await Promise.all([
    executor.execute(sql`SELECT source_type, source_id, product_id, variant_id, quantity, status
      FROM stock_reservations WHERE (source_type, source_id) IN (${sql.join(refs, sql`,`)}) AND status <> 'released'`),
    executor.execute(sql`SELECT related_type AS source_type, related_id AS source_id,
      count(*)::integer AS open_tasks, count(*) FILTER (WHERE due_at < ${now})::integer AS overdue_tasks
      FROM tasks WHERE (related_type,related_id) IN (${sql.join(refs, sql`,`)})
      AND archived_at IS NULL AND status NOT IN ('completed','cancelled') GROUP BY related_type,related_id`),
  ]);
  const byRef = new Map(facts.map((b) => [`${sourceType(b.source)}:${b.id}`, b]));
  for (const r of rowsOf(reservations)) byRef.get(`${r.source_type}:${r.source_id}`)?.products.push({ productId: Number(r.product_id), variantId: idOrNull(r.variant_id), quantity: Number(r.quantity), status: r.status });
  for (const t of rowsOf(tasks)) {
    const fact = byRef.get(`${t.source_type}:${t.source_id}`);
    if (fact) { fact.openTasks = Number(t.open_tasks); fact.overdueTasks = Number(t.overdue_tasks); }
  }
  const staffIds = [...new Set(facts.flatMap(dailyAssignedStaffIds))];
  const staff = staffIds.length ? rowsOf(await executor.execute(sql`SELECT id, coalesce(nullif(full_name,''),username) AS full_name FROM staff WHERE id IN (${sql.join(staffIds.map((id) => sql`${id}`), sql`,`)})`)) : [];
  const names = new Map(staff.map((s) => [Number(s.id), String(s.full_name)]));
  for (const fact of facts) fact.staff = dailyAssignedStaffIds(fact).map((id) => ({ id, name: names.get(id) || "موظف معيّن" }));
  return buildDailyOperations(facts, filters, truncated, now);
}
