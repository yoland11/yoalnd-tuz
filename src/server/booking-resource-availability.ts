import { sql, type SQL } from "drizzle-orm";
import type { BookingOperationRef } from "@/lib/booking-operational-readiness";
import { readBookingResourceWindow } from "@/lib/booking-resource-window";
import { resourceOccupancyTimestamps } from "@/lib/booking-resource-conflicts";

export type ResourceExecutor={execute(query:any):Promise<any>};
export type TimedBookingRef=BookingOperationRef & {operations:Record<string,unknown>;eventDate?:string|null};
/** Scheduling identity only. Never pass photography to booking finance, stock,
 * custody or the central booking reader. Linked events keep service identity. */
export type StaffTimedRef=Omit<TimedBookingRef,"source">&{source:TimedBookingRef["source"]|"photography"};
export class BookingResourceConflictError extends Error {
  constructor(message:string,public status=409){super(message);this.name="BookingResourceConflictError";}
}
export function resourceRows(result:any):any[]{
  if(!Array.isArray(result?.rows))throw Error("Invalid booking resource database response");
  if(result.rows.length>500)throw new BookingResourceConflictError("سجلات الموارد كثيرة؛ يلزم مراجعة الحجوزات النشطة قبل تأكيد التوفر");
  return result.rows;
}
/** One original event identity, including every legacy crew link rather than
 * only the row belonging to the employee currently being checked. */
export const photographyEventLinkIds=(eventId:SQL)=>sql`ARRAY(SELECT DISTINCT links.booking_id FROM (
  SELECT original_event.booking_id FROM photography_events original_event WHERE original_event.id=${eventId}
  UNION SELECT original_shoot.booking_id FROM photography_shoots original_shoot WHERE original_shoot.event_id=${eventId}
  UNION SELECT all_crew.booking_id FROM photography_shoot_crew all_crew JOIN photography_shoots all_shoots ON all_shoots.id=all_crew.shoot_id WHERE all_shoots.event_id=${eventId}
) links WHERE links.booking_id IS NOT NULL ORDER BY links.booking_id)`;
export function resolvePhotographyBookingId(values:unknown):number|null{
  if(!Array.isArray(values)||values.length>100)throw new BookingResourceConflictError("ربط مناسبة التصوير غير متطابق؛ راجع المسؤول",409);
  const ids=[...new Set(values.filter(v=>v!==null))];
  if(ids.some(v=>!Number.isSafeInteger(v)||Number(v)<=0)||ids.length>1)throw new BookingResourceConflictError("ربط مناسبة التصوير بالحجز غير متطابق؛ راجع المسؤول",409);
  return ids[0] as number??null;
}
export function projectPhotographyOccupancy(row:any):any|null{
  if(row.source!=="photography")return row;
  const identity=row.photo_identity;
  if(!identity||typeof identity!=="object")throw new BookingResourceConflictError("تعذر التحقق من ربط مناسبة التصوير",409);
  const bookingId=resolvePhotographyBookingId(identity.bookingIds);
  const {photo_identity:_,...candidate}=row;
  if(!bookingId)return candidate;
  const central=identity.central;
  if(!central||Number(central.id)!==bookingId)throw new BookingResourceConflictError("الحجز المرتبط بمناسبة التصوير غير موجود",409);
  if(central.archivedAt||["cancelled","canceled","deleted","completed","delivered","closed"].includes(String(central.status).toLowerCase()))return null;
  return {...candidate,source:"service",id:bookingId,event_date:central.eventDate,details:central.details};
}
export function resourceInterval(reference:Pick<TimedBookingRef,"operations"|"eventDate">){
  const window=readBookingResourceWindow(reference.operations,reference.eventDate);
  return window?resourceOccupancyTimestamps({start:window.preparationStart,end:window.returnEnd}):null;
}
export function firstBookingOverlap(reference:StaffTimedRef,candidates:any[],allowPhotography=false){
  const target=resourceInterval(reference);
  for(const candidate of candidates){
    if(!["kosha","service",...(allowPhotography?["photography"]:[])].includes(candidate.source)||!Number.isSafeInteger(Number(candidate.id))||Number(candidate.id)<=0)throw Error("Invalid resource booking identity");
    if(candidate.source===reference.source&&Number(candidate.id)===reference.id)continue;
    if(candidate.still_out===true)return {...candidate,timingIncomplete:false};
    const occupied=resourceInterval({eventDate:candidate.event_date,operations:candidate.details?.bookingOperations??{}});
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
/** Internal manager policy partition, not authorization. A reason alone never
 * waives the rest of a booking's crew/drivers. Callers must authenticate first. */
export function staffConflictGroups(ids:number[],reason?:string|null,selected:number[]=[]){
  const all=validIds(ids),overridden=reason?.trim()?all.filter(id=>selected.includes(id)):[];
  return {checked:all.filter(id=>!overridden.includes(id)),overridden};
}

/** Original execution identities only; preparation-task assignment is not an
 * execution-team reservation. Drivers participate in the same staff check.
 * The original writer must lock all affected staff rows before confirmation.
 */
export async function findBookingStaffConflict(reference:StaffTimedRef,ids:number[],connection:ResourceExecutor){
  const staffIds=validIds(ids);if(!staffIds.length)return null;
  const result=await connection.execute(sql`${activeBookings}, staff_bookings AS (
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
      ))
    )
    ) SELECT *,NULL::jsonb AS photo_identity FROM staff_bookings
    UNION ALL SELECT DISTINCT 'photography'::text AS source,e.id,e.event_date::text AS event_date,
      jsonb_build_object('bookingOperations',jsonb_build_object('resourceWindow',to_jsonb(e)->'resource_window')) AS details,
      jsonb_build_object('bookingIds',resolved.booking_ids,'central',CASE WHEN central.id IS NULL THEN NULL ELSE jsonb_build_object('id',central.id,'status',central.status,'archivedAt',central.archived_at,'eventDate',central.event_date,'details',jsonb_build_object('bookingOperations',central.custom_fields->'bookingOperations')) END) AS photo_identity
    FROM photography_events e LEFT JOIN photography_shoots sh ON sh.event_id=e.id
      LEFT JOIN photography_shoot_crew c ON c.shoot_id=sh.id
      LEFT JOIN LATERAL (SELECT ${photographyEventLinkIds(sql`e.id`)} AS booking_ids) resolved ON true
      LEFT JOIN service_orders central ON central.id=(resolved.booking_ids)[1]
    WHERE lower(e.status) NOT IN ('cancelled','completed','deleted','archived')
      AND (sh.id IS NULL OR sh.cancelled_at IS NULL AND lower(sh.stage) NOT IN ('cancelled','completed'))
      AND (e.assigned_staff_id IN (${sql.join(staffIds.map(id=>sql`${id}`),sql`, `)}) OR
        c.staff_id IN (${sql.join(staffIds.map(id=>sql`${id}`),sql`, `)}) AND lower(c.assignment_status) NOT IN ('rejected','revoked','removed','cancelled'))
    ORDER BY source,id LIMIT 501`);
  return firstBookingOverlap(reference,resourceRows(result).map(projectPhotographyOccupancy).filter(row=>row!==null),true);
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
export const KOSHA_RESOURCE_STATUSES=["confirmed","active","processing","in_progress"] as const;

export async function findBookingKoshaConflict(reference:TimedBookingRef,id:number,connection:ResourceExecutor){
  validIds([id]);
  const result=await connection.execute(sql`SELECT * FROM (
    SELECT 'kosha'::text AS source,id,event_date::text AS event_date,booking_details AS details FROM kosha_bookings
      WHERE archived_at IS NULL AND kosha_id=${id} AND lower(coalesce(status,'')) NOT IN ('cancelled','canceled','deleted','completed','closed')
      AND (lower(status) IN (${sql.join(KOSHA_RESOURCE_STATUSES.map(status=>sql`${status}`),sql`, `)}) OR booking_details->'bookingOperations'->>'bookingStage' IN ('preparing','ready','assets_out','event_active'))
    UNION ALL SELECT 'service',id,event_date,custom_fields FROM service_orders
      WHERE archived_at IS NULL AND custom_fields->>'koshaId'=${String(id)} AND lower(coalesce(status,'')) NOT IN ('cancelled','canceled','deleted','completed','delivered','closed')
      AND (lower(status) IN (${sql.join(KOSHA_RESOURCE_STATUSES.map(status=>sql`${status}`),sql`, `)}) OR custom_fields->'bookingOperations'->>'bookingStage' IN ('preparing','ready','assets_out','event_active'))
  ) b WHERE NOT(b.source=${reference.source} AND b.id=${reference.id}) ORDER BY source,id LIMIT 501`);
  return firstBookingOverlap(reference,resourceRows(result));
}
