import { sql, type SQL } from "drizzle-orm";
import type { BookingOperationRef } from "@/lib/booking-operational-readiness";
import { readBookingResourceWindow } from "@/lib/booking-resource-window";
import { resourceOccupancyTimestamps } from "@/lib/booking-resource-conflicts";

export type ResourceExecutor={execute(query:any):Promise<any>};
export type TimedBookingRef=BookingOperationRef & {operations:Record<string,unknown>;eventDate?:string|null};
export class BookingResourceConflictError extends Error {
  constructor(message:string,public status=409){super(message);this.name="BookingResourceConflictError";}
}
export function resourceRows(result:any):any[]{
  if(!Array.isArray(result?.rows))throw Error("Invalid booking resource database response");
  if(result.rows.length>500)throw new BookingResourceConflictError("سجلات الموارد كثيرة؛ يلزم مراجعة الحجوزات النشطة قبل تأكيد التوفر");
  return result.rows;
}
export function resourceInterval(reference:TimedBookingRef){
  const window=readBookingResourceWindow(reference.operations,reference.eventDate);
  return window?resourceOccupancyTimestamps({start:window.preparationStart,end:window.returnEnd}):null;
}
export function firstBookingOverlap(reference:TimedBookingRef,candidates:any[]){
  const target=resourceInterval(reference);
  for(const candidate of candidates){
    if(!["kosha","service"].includes(candidate.source)||!Number.isSafeInteger(Number(candidate.id))||Number(candidate.id)<=0)throw Error("Invalid resource booking identity");
    if(candidate.source===reference.source&&Number(candidate.id)===reference.id)continue;
    if(candidate.still_out===true)return {...candidate,timingIncomplete:false};
    const occupied=resourceInterval({source:candidate.source,id:Number(candidate.id),eventDate:candidate.event_date,operations:candidate.details?.bookingOperations??{}});
    if(!target||!occupied)return {...candidate,timingIncomplete:true};
    if(target[0]<occupied[1]&&occupied[0]<target[1])return {...candidate,timingIncomplete:false};
  }
  return null;
}

/** Caller holds its original booking and physical products.id locks for writes.
 * Query by exact physical identity, not a day prefix or a truncated day list.
 * Active reservations span preparation→return; actual checkout ignores an expired
 * plan until returned. Quantity assets use their original quantity engine instead.
 */
export async function findBookingPhysicalConflict(reference:TimedBookingRef,productId:number,connection:ResourceExecutor){
  if(!Number.isSafeInteger(productId)||productId<=0)throw Error("Invalid physical resource identity");
  const result=await connection.execute(sql`
    WITH bookings AS (
      SELECT 'kosha'::text AS source,id,event_date::text AS event_date,status,booking_details AS details FROM kosha_bookings WHERE archived_at IS NULL
      UNION ALL SELECT 'service',id,event_date,status,custom_fields FROM service_orders WHERE archived_at IS NULL
    ), original_lines AS (
      SELECT b.source,b.id,b.event_date,b.details,
        bool_or(coalesce(a->>'stage','linked')='out') AS still_out
      FROM bookings b CROSS JOIN LATERAL jsonb_array_elements(
        (CASE WHEN jsonb_typeof(b.details->'bookingOperations'->'assets')='array' THEN b.details->'bookingOperations'->'assets' ELSE '[]'::jsonb END)
        || (CASE WHEN jsonb_typeof(b.details->'linkedAssets')='array' THEN b.details->'linkedAssets' ELSE '[]'::jsonb END)
      ) a WHERE a->>'productId'=${String(productId)} AND coalesce(a->>'stage','linked') NOT IN ('released','returned','inspection','completed')
        AND (lower(coalesce(b.status,'')) NOT IN ('cancelled','canceled','deleted','completed','delivered','closed') OR a->>'stage'='out')
        AND NOT(b.source=${reference.source} AND b.id=${reference.id})
      GROUP BY b.source,b.id,b.event_date,b.details
    ), fixed AS (
      SELECT CASE WHEN r.booking_type='kosha_booking' THEN 'kosha' ELSE 'service' END AS source,
        r.booking_id AS id,b.event_date,b.details,(r.status='checked_out') AS still_out
      FROM employee_custody_reservations r JOIN bookings b ON b.id=r.booking_id
        AND b.source=CASE WHEN r.booking_type='kosha_booking' THEN 'kosha' ELSE 'service' END
      WHERE r.product_id=${productId} AND r.booking_type IN ('kosha_booking','service_order') AND r.status IN ('reserved','checked_out')
        AND NOT(b.source=${reference.source} AND b.id=${reference.id})
        AND (r.status='checked_out' OR lower(coalesce(b.status,'')) NOT IN ('cancelled','canceled','deleted','completed','delivered','closed'))
    ), work_manifest AS (
      SELECT 'kosha'::text AS source,b.id,b.event_date::text AS event_date,b.booking_details AS details,true AS still_out
      FROM kosha_work_order_assets a JOIN kosha_work_orders wo ON wo.id=a.work_order_id JOIN kosha_bookings b ON b.id=wo.booking_id
      WHERE a.product_id=${productId} AND a.checked_out_at IS NOT NULL AND a.returned_at IS NULL
        AND NOT(${reference.source}='kosha' AND b.id=${reference.id})
    ) SELECT * FROM original_lines UNION SELECT * FROM fixed UNION SELECT * FROM work_manifest LIMIT 501
  `);
  return firstBookingOverlap(reference,resourceRows(result));
}

const activeBookings=sql`WITH bookings AS (
  SELECT 'kosha'::text AS source,id,event_date::text AS event_date,booking_details AS details,
    assigned_staff_id AS staff_id,transportation_driver_id AS driver_id,transportation_vehicle_id AS vehicle_id FROM kosha_bookings
    WHERE archived_at IS NULL AND lower(coalesce(status,'')) NOT IN ('cancelled','canceled','deleted','completed','delivered','closed')
  UNION ALL SELECT 'service',id,event_date,custom_fields,NULL::integer,NULL::integer,NULL::integer FROM service_orders
    WHERE archived_at IS NULL AND lower(coalesce(status,'')) NOT IN ('cancelled','canceled','deleted','completed','delivered','closed')
)`;
const jsonArray=(field:SQL)=>sql`CASE WHEN jsonb_typeof(${field})='array' THEN ${field} ELSE '[]'::jsonb END`;
const validIds=(ids:number[])=>{if(ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error("Invalid resource identity");return [...new Set(ids)].sort((a,b)=>a-b)};

/** Original execution identities only; preparation-task assignment is not an
 * execution-team reservation. Drivers participate in the same staff check.
 * The original writer must lock all affected staff rows before confirmation.
 */
export async function findBookingStaffConflict(reference:TimedBookingRef,ids:number[],connection:ResourceExecutor){
  const staffIds=validIds(ids);if(!staffIds.length)return null;
  const result=await connection.execute(sql`${activeBookings}
    SELECT DISTINCT b.source,b.id,b.event_date,b.details FROM bookings b
    CROSS JOIN unnest(${sql.param(staffIds)}::integer[]) s(staff_id)
    WHERE NOT(b.source=${reference.source} AND b.id=${reference.id}) AND (
      b.staff_id=s.staff_id OR b.details->>'assignedStaffId'=s.staff_id::text
      OR b.details->>'primaryEmployeeId'=s.staff_id::text OR b.details->>'assistantEmployeeId'=s.staff_id::text
      OR (coalesce(b.details->'bookingOperations'->'transportation'->>'mode',b.details->'transportation'->>'mode','ajn')<>'customer' AND (
        b.driver_id=s.staff_id OR b.details->>'transportationDriverId'=s.staff_id::text
        OR b.details->'bookingOperations'->'transportation'->>'driverId'=s.staff_id::text
        OR b.details->'transportation'->>'driverId'=s.staff_id::text))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${jsonArray(sql`b.details->'assignedStaffIds'`)}) a(id) WHERE a.id=s.staff_id::text)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(${jsonArray(sql`b.details->'bookingStaffAssignments'`)}) a WHERE a->>'id'=s.staff_id::text)
      OR (b.source='kosha' AND EXISTS(SELECT 1 FROM kosha_work_orders wo JOIN kosha_work_order_members m ON m.work_order_id=wo.id
        WHERE wo.booking_id=b.id AND wo.cancelled_at IS NULL AND lower(wo.status) NOT IN ('cancelled','completed')
        AND m.staff_id=s.staff_id AND m.removed_at IS NULL AND lower(m.status) NOT IN ('cancelled','removed','declined')))
      OR (b.source='service' AND (
        b.details->>'assignedPhotographerId'=s.staff_id::text OR b.details->>'photographerId'=s.staff_id::text
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(${jsonArray(sql`b.details->'photographyAssignments'`)} || ${jsonArray(sql`b.details->'photographers'`)} || ${jsonArray(sql`b.details->'assignedPhotographers'`)}) a
          WHERE a->>'employeeId'=s.staff_id::text OR a->>'staffId'=s.staff_id::text OR a->>'id'=s.staff_id::text)
        OR EXISTS(SELECT 1 FROM photography_shoot_crew c JOIN photography_shoots sh ON sh.id=c.shoot_id JOIN photography_events e ON e.id=sh.event_id
          WHERE coalesce(e.booking_id,sh.booking_id,c.booking_id)=b.id AND c.staff_id=s.staff_id AND sh.cancelled_at IS NULL
          AND lower(sh.stage) NOT IN ('cancelled','completed') AND lower(e.status) NOT IN ('cancelled','completed','deleted')
          AND lower(c.assignment_status) NOT IN ('rejected','revoked','removed','cancelled'))
      ))
    ) ORDER BY source,id LIMIT 501`);
  return firstBookingOverlap(reference,resourceRows(result));
}

/** Native, routed-service and original dispatch assignments share the SAME
 * physical fleet/crew identity; no new resource reservation record is created.
 */
async function dispatchResourceConflict(reference:TimedBookingRef,id:number,kind:"vehicle"|"crew",connection:ResourceExecutor){
  validIds([id]);
  const selected=kind==="vehicle"?sql`(
    coalesce(b.details->'bookingOperations'->'transportation'->>'mode',b.details->'transportation'->>'mode','ajn')<>'customer' AND (
      b.vehicle_id=${id} OR b.details->>'transportationVehicleId'=${String(id)} OR b.details->'bookingOperations'->'transportation'->>'vehicleId'=${String(id)} OR b.details->'transportation'->>'vehicleId'=${String(id)}))`:sql`false`;
  const column=kind==="vehicle"?sql`d.vehicle_id`:sql`d.crew_id`;
  const result=await connection.execute(sql`${activeBookings}
    SELECT b.source,b.id,b.event_date,b.details FROM bookings b WHERE NOT(b.source=${reference.source} AND b.id=${reference.id})
    AND (${selected} OR EXISTS(SELECT 1 FROM dispatch_assignments d WHERE d.entity_id=b.id
      AND d.entity_type=CASE WHEN b.source='kosha' THEN 'kosha_booking' ELSE 'service_order' END
      AND d.status IN ('assigned','en_route','active') AND ${column}=${id})) ORDER BY source,id LIMIT 501`);
  return firstBookingOverlap(reference,resourceRows(result));
}
export const findBookingVehicleConflict=(reference:TimedBookingRef,id:number,connection:ResourceExecutor)=>dispatchResourceConflict(reference,id,"vehicle",connection);
export const findBookingCrewConflict=(reference:TimedBookingRef,id:number,connection:ResourceExecutor)=>dispatchResourceConflict(reference,id,"crew",connection);

export async function findBookingKoshaConflict(reference:TimedBookingRef,id:number,connection:ResourceExecutor){
  validIds([id]);
  const result=await connection.execute(sql`SELECT * FROM (
    SELECT 'kosha'::text AS source,id,event_date::text AS event_date,booking_details AS details FROM kosha_bookings
      WHERE archived_at IS NULL AND kosha_id=${id} AND lower(coalesce(status,'')) NOT IN ('cancelled','canceled','deleted','completed','closed')
      AND (lower(status) IN ('confirmed','in_progress') OR booking_details->'bookingOperations'->>'bookingStage' IN ('preparing','ready','assets_out','event_active'))
    UNION ALL SELECT 'service',id,event_date,custom_fields FROM service_orders
      WHERE archived_at IS NULL AND custom_fields->>'koshaId'=${String(id)} AND lower(coalesce(status,'')) NOT IN ('cancelled','canceled','deleted','completed','delivered','closed')
      AND (lower(status) IN ('confirmed','active','processing','in_progress') OR custom_fields->'bookingOperations'->>'bookingStage' IN ('preparing','ready','assets_out','event_active'))
  ) b WHERE NOT(b.source=${reference.source} AND b.id=${reference.id}) ORDER BY source,id LIMIT 501`);
  return firstBookingOverlap(reference,resourceRows(result));
}
