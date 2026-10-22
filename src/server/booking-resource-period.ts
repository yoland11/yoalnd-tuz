import { sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { parseBookingResourceWindow,readBookingResourceWindow } from "@/lib/booking-resource-window";
import { dailyAssignedStaffIds } from "@/lib/booking-daily-operations";
import { BookingResourceConflictError,findBookingPhysicalConflict,findBookingStaffConflict,findBookingVehicleConflict,findBookingCrewConflict,findBookingKoshaConflict,resourceRows,type ResourceExecutor,type TimedBookingRef } from "./booking-resource-availability";

type Ref={source:"kosha"|"service";id:number};
type Database=ResourceExecutor&{transaction<T>(run:(tx:ResourceExecutor)=>Promise<T>):Promise<T>};
export type ResourceBooking=TimedBookingRef&{details:Record<string,any>;status:string;assignedStaffId:number|null;staffIds:number[];vehicleId:number|null;driverId:number|null;crewId:number|null;koshaId:number|null;assets:any[];eventTime:string|null};
const id=(v:any)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const object=(v:any):Record<string,any>=>{if(v==null)return {};if(typeof v!=="object"||Array.isArray(v))throw new BookingResourceConflictError("بيانات موارد الحجز غير صالحة؛ راجع المسؤول",422);return v};
const list=(v:any):any[]=>{if(v==null)return [];if(!Array.isArray(v))throw new BookingResourceConflictError("قائمة موارد الحجز غير صالحة؛ لم تُستبدل بقائمة فارغة",422);return v};
const entity=(ref:Ref)=>ref.source==="kosha"?"kosha_booking":"service_order";

/** Same original source+ID, actual execution membership and dispatch. No schema
 * initialization, customer/finance query, global cache or secondary booking. */
export async function readResourceBooking(tx:ResourceExecutor,ref:Ref,lock=false):Promise<ResourceBooking>{
  if(!["kosha","service"].includes(ref.source)||!Number.isSafeInteger(ref.id)||ref.id<=0)throw new BookingResourceConflictError("هوية الحجز غير صحيحة",422);
  const [b]=resourceRows(await tx.execute(ref.source==="kosha"?sql`
    SELECT id,status,event_date,event_time,kosha_id,assigned_staff_id,transportation_mode,transportation_driver_id,transportation_vehicle_id,booking_details AS details
    FROM kosha_bookings WHERE id=${ref.id} AND archived_at IS NULL ${lock?sql`FOR UPDATE`:sql``}`:sql`
    SELECT id,status,event_date,NULL::text AS event_time,NULL::integer AS kosha_id,NULL::integer AS assigned_staff_id,NULL::text AS transportation_mode,
      NULL::integer AS transportation_driver_id,NULL::integer AS transportation_vehicle_id,custom_fields AS details
    FROM service_orders WHERE id=${ref.id} AND archived_at IS NULL ${lock?sql`FOR UPDATE`:sql``}`));
  if(!b)throw new BookingResourceConflictError("الحجز غير موجود أو مؤرشف",404);
  const details=object(b.details),operations=object(details.bookingOperations);
  const dispatch=resourceRows(await tx.execute(sql`SELECT vehicle_id,crew_id FROM dispatch_assignments WHERE entity_type=${entity(ref)} AND entity_id=${ref.id} AND status IN ('assigned','en_route','active') LIMIT 2`));
  if(dispatch.length>1)throw new BookingResourceConflictError("إسناد النقل غير متطابق؛ راجع الحجز",409);
  const members=resourceRows(await tx.execute(ref.source==="kosha"?sql`
    SELECT m.staff_id FROM kosha_work_order_members m JOIN kosha_work_orders w ON w.id=m.work_order_id
    WHERE w.booking_id=${ref.id} AND w.cancelled_at IS NULL AND lower(w.status) NOT IN ('cancelled','completed')
      AND m.removed_at IS NULL AND lower(m.status) NOT IN ('removed','cancelled','declined') LIMIT 101`:sql`
    SELECT c.staff_id FROM photography_shoot_crew c JOIN photography_shoots sh ON sh.id=c.shoot_id JOIN photography_events e ON e.id=sh.event_id
    WHERE coalesce(e.booking_id,sh.booking_id,c.booking_id)=${ref.id} AND sh.cancelled_at IS NULL AND lower(sh.stage) NOT IN ('cancelled','completed')
      AND lower(c.assignment_status) NOT IN ('removed','cancelled','rejected','revoked') LIMIT 101`));
  const transport=object(operations.transportation??details.transportation),mode=transport.mode??b.transportation_mode;
  const driverId=mode==="customer"?null:id(transport.driverId??details.transportationDriverId??b.transportation_driver_id);
  const vehicleId=id(dispatch[0]?.vehicle_id)??(mode==="customer"?null:id(transport.vehicleId??details.transportationVehicleId??b.transportation_vehicle_id));
  // Read original saved assignments even before a photography crew sync. Match
  // the aliases recognized by the conflict reader without changing their writer.
  const photographerIds=ref.source==="service"?[
    id(details.assignedPhotographerId),id(details.photographerId),
    ...[details.photographyAssignments,details.photographers,details.assignedPhotographers]
      .flatMap(value=>Array.isArray(value)?value:[])
      .flatMap(entry=>[id(entry?.employeeId),id(entry?.staffId),id(entry?.id)]),
  ]:[];
  const executionIds=[...members.map(m=>id(m.staff_id)),id(details.assignedStaffId),...photographerIds].filter((v):v is number=>v!==null);
  const staffIds=[...new Set([...dailyAssignedStaffIds({details,assignedStaffId:id(b.assigned_staff_id),executionStaffIds:executionIds}),...(driverId?[driverId]:[])])].sort((a,b)=>a-b);
  const assets=new Map<number,any>();
  for(const line of [...list(details.linkedAssets),...list(operations.assets)]){const productId=id(line?.productId);if(!productId)throw new BookingResourceConflictError("مرجع إحدى المعدات غير صالح",422);assets.set(productId,{...assets.get(productId),...line,productId})}
  if(staffIds.length>100||members.length>100||assets.size>100)throw new BookingResourceConflictError("موارد الحجز كثيرة؛ يلزم مراجعتها قبل الحفظ",422);
  return {...ref,eventDate:b.event_date??null,eventTime:b.event_time??details.eventTime??null,details,operations,status:String(b.status??""),assignedStaffId:id(b.assigned_staff_id),staffIds,vehicleId,driverId,crewId:id(dispatch[0]?.crew_id),koshaId:id(b.kosha_id??details.koshaId),assets:[...assets.values()]};
}

/** Replaces one operational leaf only, atomically with the original timeline.
 * No stock/financial movement or automatic rewriting of fixed custody periods. */
export async function saveBookingResourceWindow(database:Database,ref:Ref,value:unknown,expected:unknown,actor:{id:number;name:string}){
  const window=parseBookingResourceWindow(value);
  return database.transaction(async tx=>{
    const live=await readResourceBooking(tx,ref,true);
    if(["cancelled","canceled","deleted","completed","delivered","closed"].includes(live.status.toLowerCase()))throw new BookingResourceConflictError("لا يمكن تعديل فترة حجز ملغي أو مكتمل",409);
    parseBookingResourceWindow(window,live.eventDate);
    const before=live.operations.resourceWindow??null;
    if(isDeepStrictEqual(before,window))return {ok:true,duplicate:true,resourceWindow:window};
    if(!isDeepStrictEqual(before,expected??null))throw new BookingResourceConflictError("تغيّرت فترة الموارد؛ حدّث الصفحة قبل حفظ مواعيد جديدة",409);
    if(live.assets.some(a=>a.stage==="out"||Number(a.checkedOutQty??0)>0))throw new BookingResourceConflictError("لا يمكن تعديل فترة موارد صُرفت؛ أكمل الإرجاع وراجع سجل الحجز أولاً",409);
    const fixed=resourceRows(await tx.execute(sql`SELECT id FROM employee_custody_reservations WHERE booking_type=${entity(ref)} AND booking_id=${ref.id} AND status IN ('reserved','checked_out') LIMIT 1`));
    if(fixed.length)throw new BookingResourceConflictError("حرّر حجز عهدة الموظفين قبل تعديل الفترة، ثم أعد حجزها بالمواعيد الجديدة",409);
    if(ref.source==="kosha"&&resourceRows(await tx.execute(sql`SELECT a.id FROM kosha_work_order_assets a JOIN kosha_work_orders w ON w.id=a.work_order_id WHERE w.booking_id=${ref.id} AND a.checked_out_at IS NOT NULL AND a.returned_at IS NULL LIMIT 1`)).length)throw new BookingResourceConflictError("توجد معدات مصروفة من أمر التنفيذ؛ أكمل إرجاعها قبل تغيير الفترة",409);
    const next={...live,operations:{...live.operations,resourceWindow:window}};
    if(live.koshaId){await tx.execute(sql`SELECT id FROM koshas WHERE id=${live.koshaId} FOR UPDATE`);if(await findBookingKoshaConflict(next,live.koshaId,tx))throw new BookingResourceConflictError("الكوشة مشغولة خلال فترة التشغيل الجديدة",409)}
    if(live.staffIds.length){await tx.execute(sql`SELECT id FROM staff WHERE id IN (${sql.join(live.staffIds.map(id=>sql`${id}`),sql`, `)}) ORDER BY id FOR UPDATE`);if(await findBookingStaffConflict(next,live.staffIds,tx))throw new BookingResourceConflictError("أحد أفراد الفريق أو السائق مشغول أو مواعيده غير مكتملة خلال الفترة الجديدة",409)}
    if(live.vehicleId){await tx.execute(sql`SELECT id FROM fleet_vehicles WHERE id=${live.vehicleId} FOR UPDATE`);if(await findBookingVehicleConflict(next,live.vehicleId,tx))throw new BookingResourceConflictError("المركبة مشغولة أو مواعيدها غير مكتملة خلال الفترة الجديدة",409)}
    if(live.crewId){await tx.execute(sql`SELECT id FROM crews WHERE id=${live.crewId} FOR UPDATE`);if(await findBookingCrewConflict(next,live.crewId,tx))throw new BookingResourceConflictError("فريق التركيب مشغول خلال الفترة الجديدة",409)}
    if(live.assets.length){
      const ids=live.assets.map(a=>a.productId).sort((a,b)=>a-b);
      await tx.execute(sql`SELECT id FROM products WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) ORDER BY id FOR UPDATE`);
      if(live.assets.some(a=>a.trackingMode==="quantity"&&!["linked","released","returned","completed"].includes(String(a.stage??"linked"))))throw new BookingResourceConflictError("حرّر حجز كميات المعدات قبل تغيير الفترة، ثم راجع توفرها واحجزها من جديد",409);
      for(const asset of live.assets.filter(a=>a.trackingMode!=="quantity"&&!["released","returned","inspection","completed"].includes(String(a.stage??"linked"))))if(await findBookingPhysicalConflict(next,asset.productId,tx))throw new BookingResourceConflictError("إحدى المعدات مشغولة أو فترة حجزها الآخر غير مكتملة",409);
    }
    const encoded=JSON.stringify(window);
    await tx.execute(ref.source==="kosha"?sql`UPDATE kosha_bookings SET booking_details=jsonb_set(coalesce(nullif(booking_details,'null'::jsonb),'{}'::jsonb),'{bookingOperations}',coalesce(nullif(booking_details->'bookingOperations','null'::jsonb),'{}'::jsonb)||jsonb_build_object('resourceWindow',${encoded}::jsonb),true),updated_at=now() WHERE id=${ref.id}`:sql`UPDATE service_orders SET custom_fields=jsonb_set(coalesce(nullif(custom_fields,'null'::jsonb),'{}'::jsonb),'{bookingOperations}',coalesce(nullif(custom_fields->'bookingOperations','null'::jsonb),'{}'::jsonb)||jsonb_build_object('resourceWindow',${encoded}::jsonb),true) WHERE id=${ref.id}`);
    await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,actor_id,actor_name,metadata) VALUES(${entity(ref)},${ref.id},'booking_resource_window_updated','تحديث فترة تشغيل الموارد',${actor.id},${actor.name},${JSON.stringify({previous:before,next:window})}::jsonb)`);
    return {ok:true,duplicate:false,resourceWindow:window};
  });
}
export const resourceWindowView=(b:ResourceBooking)=>({resourceWindow:readBookingResourceWindow(b.operations,b.eventDate),expectedWindow:b.operations.resourceWindow??null,eventDate:b.eventDate,eventTime:b.eventTime});

/** Shared by the original direct team/work-order adapters, not a new assignment
 * store. Keep the booking lock first and selected staff locks in numeric order. */
export async function lockBookingExecutionTeam(tx:ResourceExecutor,ref:Ref,staffIds:number[],eligible?:(row:Record<string,any>)=>boolean){
  if(staffIds.length>100||staffIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw new BookingResourceConflictError("معرف موظف الفريق غير صحيح",422);
  const ids=[...new Set(staffIds)].sort((a,b)=>a-b);
  const live=await readResourceBooking(tx,ref,true);
  if(["cancelled","canceled","deleted","completed","delivered","closed"].includes(live.status.toLowerCase()))throw new BookingResourceConflictError("لا يمكن إسناد فريق لحجز ملغي أو مكتمل",409);
  if(!ids.length)return live;
  const rows=resourceRows(await tx.execute(sql`SELECT id,is_active,role,department,permissions FROM staff WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) ORDER BY id FOR UPDATE`));
  for(const id of ids){const staff=rows.find(row=>Number(row.id)===id);if(!staff||staff.is_active!==true||(eligible&&!eligible(staff)))throw new BookingResourceConflictError("تغيّرت أهلية الموظف؛ اختر فريقاً نشطاً ومسموحاً له بالتنفيذ",422)}
  if(!readBookingResourceWindow(live.operations,live.eventDate))throw new BookingResourceConflictError("حدد فترة تشغيل الموارد قبل إسناد فريق التنفيذ",409);
  if(await findBookingStaffConflict(live,ids,tx))throw new BookingResourceConflictError("أحد الموظفين مشغول خلال فترة التجهيز والتنفيذ والإرجاع أو مواعيده غير مكتملة",409);
  return live;
}
