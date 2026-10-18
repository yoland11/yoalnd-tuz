import { sql } from "drizzle-orm";
import { buildDailyOperations, dailyAssignedStaffIds, dailyOperationsRange, type DailyBookingFact, type DailyFilters, type DailySource } from "@/lib/booking-daily-operations";

type Executor = { execute: (query: any) => Promise<any> };
const sourceType = (source: DailySource) => source === "kosha" ? "kosha_booking" : "service_order";
const idOrNull = (value: any) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function rowsOf(result: any): any[] {
  if (!Array.isArray(result?.rows)) throw new Error("Daily operations query returned an invalid result");
  return result.rows;
}

function baghdadTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  // required_arrival_at is a timestamp WITHOUT time zone written directly from
  // datetime-local. AJN operational wall clocks are Baghdad (UTC+03:00), not
  // the Vercel server's UTC timezone. Explicit instants retain their own offset.
  const raw = value instanceof Date ? value : String(value).trim();
  const date = raw instanceof Date ? raw : new Date(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw) ? `${raw.replace(" ","T")}+03:00` : raw);
  if (!Number.isFinite(date.getTime())) throw new Error("Daily operations received an invalid execution timestamp");
  return date.toISOString();
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
      b.transportation_mode, c.name AS crew_name, v.id AS vehicle_record_id, v.is_active AS vehicle_active, v.status AS vehicle_status,
      w.status AS execution_stage, w.required_arrival_at, w.arrived_at
    FROM kosha_bookings b
    LEFT JOIN dispatch_assignments d ON d.entity_type = 'kosha_booking' AND d.entity_id = b.id AND d.status IN ('assigned','en_route','active')
    LEFT JOIN fleet_vehicles v ON v.id = coalesce(b.transportation_vehicle_id, d.vehicle_id)
    LEFT JOIN crews c ON c.id = d.crew_id
    LEFT JOIN kosha_work_orders w ON w.booking_id=b.id AND w.cancelled_at IS NULL AND lower(w.status) <> 'cancelled'
    WHERE b.archived_at IS NULL AND lower(coalesce(b.status,'')) NOT IN ('cancelled','canceled','deleted')
      AND left(b.event_date,10) >= ${range.from} AND left(b.event_date,10) < ${range.to}
  `);
  if (allowedSources.includes("service")) selects.push(sql`
    SELECT 'service'::text AS source, b.id, b.tracking_code AS number, b.customer_name,
      b.event_date, coalesce(nullif(b.custom_fields->>'eventTime',''), ps.event_time) AS event_time, b.event_location AS location,
      b.status, coalesce(nullif(s.type,''), 'service') AS category, b.custom_fields AS details,
      NULL::integer AS assigned_staff_id, d.vehicle_id, v.name AS vehicle_name,
      NULL::text AS transportation_mode, c.name AS crew_name, v.id AS vehicle_record_id, v.is_active AS vehicle_active, v.status AS vehicle_status,
      ps.stage AS execution_stage, NULL::timestamp AS required_arrival_at, NULL::timestamp AS arrived_at
    FROM service_orders b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN dispatch_assignments d ON d.entity_type = 'service_order' AND d.entity_id = b.id AND d.status IN ('assigned','en_route','active')
    LEFT JOIN fleet_vehicles v ON v.id = d.vehicle_id
    LEFT JOIN crews c ON c.id = d.crew_id
    LEFT JOIN photography_shoots ps ON ps.booking_id=b.id AND lower(ps.stage) <> 'cancelled'
    WHERE b.archived_at IS NULL AND lower(coalesce(b.status,'')) NOT IN ('cancelled','canceled','deleted')
      AND left(b.event_date,10) >= ${range.from} AND left(b.event_date,10) < ${range.to}
  `);
  const conditions = [];
  if(filters.search) conditions.push(sql`position(lower(${filters.search}) in lower(coalesce(nullif(number,''), CASE WHEN source='kosha' THEN 'KOSHA-' ELSE 'SRV-' END || id::text) || ' ' || coalesce(customer_name,''))) > 0`);
  if(filters.category !== "all") conditions.push(sql`category=${filters.category}`);
  if(filters.status !== "all") conditions.push(sql`lower(coalesce(nullif(execution_stage,''),nullif(details->'bookingOperations'->>'bookingStage',''),status,''))=${filters.status}`);
  if(filters.location) conditions.push(sql`position(lower(${filters.location}) in lower(coalesce(location,''))) > 0`);
  if(filters.vehicle) conditions.push(sql`vehicle_id=${filters.vehicle}`);
  if(filters.employee) {
    const employee=filters.employee;
    conditions.push(sql`(assigned_staff_id=${employee}
      OR details->>'primaryEmployeeId'=${String(employee)} OR details->>'assistantEmployeeId'=${String(employee)}
      OR details->'assignedStaffIds' @> jsonb_build_array(${employee}::integer)
      OR details->'assignedStaffIds' @> jsonb_build_array(${String(employee)}::text)
      OR details->'bookingStaffAssignments' @> jsonb_build_array(jsonb_build_object('id',${employee}::integer))
      OR details->'bookingStaffAssignments' @> jsonb_build_array(jsonb_build_object('id',${String(employee)}::text))
      OR source='kosha' AND EXISTS (SELECT 1 FROM kosha_work_orders wo JOIN kosha_work_order_members m ON m.work_order_id=wo.id
        WHERE wo.booking_id=bookings.id AND wo.cancelled_at IS NULL AND lower(wo.status)<>'cancelled' AND m.staff_id=${employee} AND m.removed_at IS NULL)
      OR source='service' AND EXISTS (SELECT 1 FROM photography_shoots ps JOIN photography_shoot_crew pc ON pc.shoot_id=ps.id
        WHERE ps.booking_id=bookings.id AND lower(ps.stage)<>'cancelled' AND pc.staff_id=${employee} AND pc.assignment_status NOT IN ('removed','cancelled'))
    )`);
  }
  const candidates = rowsOf(await executor.execute(sql`
    SELECT * FROM (${sql.join(selects, sql` UNION ALL `)}) bookings
    ${conditions.length ? sql`WHERE ${sql.join(conditions,sql` AND `)}` : sql``}
    ORDER BY left(event_date,10), event_time NULLS LAST, source, id LIMIT ${501}
  `));
  const truncated = candidates.length > 500;
  const facts: DailyBookingFact[] = candidates.slice(0, 500).map((b) => ({
    source: b.source, id: Number(b.id), number: b.number || `${b.source === "kosha" ? "KOSHA" : "SRV"}-${b.id}`,
    customerName: b.customer_name, eventDate: b.event_date, eventTime: b.event_time || null,
    location: b.location, status: b.status, category: b.category, details: b.details ?? {},
    assignedStaffId: idOrNull(b.assigned_staff_id), vehicleId: idOrNull(b.vehicle_id), vehicleName: b.vehicle_name,
    transportationMode: b.transportation_mode, crewName: b.crew_name, openTasks: 0, overdueTasks: 0, products: [],
    vehicleState: b.vehicle_id == null ? undefined : b.vehicle_record_id == null ? null : {active:b.vehicle_active===true,status:String(b.vehicle_status ?? "")},
    execution:b.execution_stage ? {stage:String(b.execution_stage),requiredArrivalAt:baghdadTimestamp(b.required_arrival_at),arrivedAt:baghdadTimestamp(b.arrived_at)} : undefined,
  }));
  if (!facts.length) return buildDailyOperations([], filters, truncated, now);
  const refs = facts.map((b) => sql`(${sourceType(b.source)},${b.id})`);
  const membershipQueries=[];
  const nativeIds=facts.filter(b=>b.source==="kosha").map(b=>sql`${b.id}`);
  const serviceIds=facts.filter(b=>b.source==="service").map(b=>sql`${b.id}`);
  if(nativeIds.length) membershipQueries.push(sql`SELECT 'kosha_booking'::text AS source_type, wo.booking_id AS source_id, m.staff_id,
    (m.accepted_at IS NOT NULL AND m.declined_at IS NULL AND lower(m.status) NOT IN ('declined','cancelled','removed')) AS accepted
    FROM kosha_work_orders wo JOIN kosha_work_order_members m ON m.work_order_id=wo.id
    WHERE wo.booking_id IN (${sql.join(nativeIds,sql`,`)}) AND wo.cancelled_at IS NULL AND lower(wo.status)<>'cancelled' AND m.removed_at IS NULL`);
  if(serviceIds.length) membershipQueries.push(sql`SELECT 'service_order'::text AS source_type, ps.booking_id AS source_id, pc.staff_id,
    (pc.accepted_at IS NOT NULL AND pc.rejected_at IS NULL AND pc.assignment_status NOT IN ('rejected','removed','cancelled')) AS accepted
    FROM photography_shoots ps JOIN photography_shoot_crew pc ON pc.shoot_id=ps.id
    WHERE ps.booking_id IN (${sql.join(serviceIds,sql`,`)}) AND lower(ps.stage)<>'cancelled' AND pc.assignment_status NOT IN ('removed','cancelled')`);
  const [reservations, tasks, members, workOrderAssets] = await Promise.all([
    executor.execute(sql`SELECT source_type, source_id, product_id, variant_id, quantity, status
      FROM stock_reservations WHERE (source_type, source_id) IN (${sql.join(refs, sql`,`)}) AND status <> 'released'`),
    executor.execute(sql`SELECT related_type AS source_type, related_id AS source_id,
      count(*)::integer AS open_tasks, count(*) FILTER (WHERE due_at < ${now})::integer AS overdue_tasks
      FROM tasks WHERE (related_type,related_id) IN (${sql.join(refs, sql`,`)})
      AND archived_at IS NULL AND status NOT IN ('completed','cancelled') GROUP BY related_type,related_id`),
    executor.execute(sql.join(membershipQueries,sql` UNION ALL `)),
    nativeIds.length ? executor.execute(sql`SELECT wo.booking_id AS source_id, a.product_id,
      (a.checked_out_at IS NOT NULL) AS checked_out, (a.returned_at IS NOT NULL) AS returned, a.return_condition
      FROM kosha_work_order_assets a JOIN kosha_work_orders wo ON wo.id=a.work_order_id
      WHERE wo.booking_id IN (${sql.join(nativeIds,sql`,`)})`) : Promise.resolve({rows:[]}),
  ]);
  const byRef = new Map(facts.map((b) => [`${sourceType(b.source)}:${b.id}`, b]));
  for (const r of rowsOf(reservations)) byRef.get(`${r.source_type}:${r.source_id}`)?.products.push({ productId: Number(r.product_id), variantId: idOrNull(r.variant_id), quantity: Number(r.quantity), status: r.status });
  for (const t of rowsOf(tasks)) {
    const fact = byRef.get(`${t.source_type}:${t.source_id}`);
    if (fact) { fact.openTasks = Number(t.open_tasks); fact.overdueTasks = Number(t.overdue_tasks); }
  }
  for (const member of rowsOf(members)) {
    const fact=byRef.get(`${member.source_type}:${member.source_id}`);
    const staffId=idOrNull(member.staff_id);
    if(!fact || !staffId) continue;
    fact.executionStaffIds ??= [];
    fact.staffConfirmation ??= {trackedIds:[],acceptedIds:[]};
    fact.executionStaffIds.push(staffId);
    fact.staffConfirmation.trackedIds.push(staffId);
    if(member.accepted===true) fact.staffConfirmation.acceptedIds.push(staffId);
  }
  for (const asset of rowsOf(workOrderAssets)) {
    const fact=byRef.get(`kosha_booking:${asset.source_id}`);
    const productId=idOrNull(asset.product_id);
    if (!fact || !productId) continue;
    fact.workOrderAssets ??= [];
    fact.workOrderAssets.push({productId,checkedOut:asset.checked_out===true,returned:asset.returned===true,condition:asset.return_condition == null ? null : String(asset.return_condition)});
  }
  const staffIds = [...new Set(facts.flatMap(dailyAssignedStaffIds))];
  const staff = staffIds.length ? rowsOf(await executor.execute(sql`SELECT id, coalesce(nullif(full_name,''),username) AS full_name FROM staff WHERE id IN (${sql.join(staffIds.map((id) => sql`${id}`), sql`,`)})`)) : [];
  const names = new Map(staff.map((s) => [Number(s.id), String(s.full_name)]));
  for (const fact of facts) fact.staff = dailyAssignedStaffIds(fact).map((id) => ({ id, name: names.get(id) || "موظف معيّن" }));
  return buildDailyOperations(facts, filters, truncated, now);
}
