import { sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { parseBookingResourceWindow,readBookingResourceWindow,resourceWindowCalendar } from "@/lib/booking-resource-window";
import { dailyAssignedStaffIds } from "@/lib/booking-daily-operations";
import { BookingResourceConflictError,resourceTimingProblem,findBookingPhysicalConflict,findBookingStaffConflict,findBookingVehicleConflict,findBookingCrewConflict,findBookingKoshaConflict,resourceRows,staffConflictGroups,photographyEventLinkIds,resolvePhotographyBookingId,KOSHA_RESOURCE_STATUSES,type ResourceExecutor,type TimedBookingRef } from "./booking-resource-availability";

type Ref={source:"kosha"|"service";id:number};
type Database=ResourceExecutor&{transaction<T>(run:(tx:ResourceExecutor)=>Promise<T>):Promise<T>};
export type ResourceBooking=TimedBookingRef&{details:Record<string,any>;status:string;archivedAt?:unknown;assignedStaffId:number|null;staffIds:number[];vehicleId:number|null;driverId:number|null;crewId:number|null;koshaId:number|null;assets:any[];eventTime:string|null;eventEndTime?:string|null};
export type ResourceWindowSaveOptions={eventDate?:unknown;expectedEventDate?:unknown;afterSave?:(tx:ResourceExecutor,next:ResourceBooking)=>Promise<void>};
const id=(v:any)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const object=(v:any):Record<string,any>=>{if(v==null)return {};if(typeof v!=="object"||Array.isArray(v))throw new BookingResourceConflictError("بيانات موارد الحجز غير صالحة؛ راجع المسؤول",422);return v};
const list=(v:any):any[]=>{if(v==null)return [];if(!Array.isArray(v))throw new BookingResourceConflictError("قائمة موارد الحجز غير صالحة؛ لم تُستبدل بقائمة فارغة",422);return v};
const entity=(ref:Ref)=>ref.source==="kosha"?"kosha_booking":"service_order";

/** Same original source+ID, actual execution membership and dispatch. No schema
 * initialization, customer/finance query, global cache or secondary booking. */
export async function readResourceBooking(tx:ResourceExecutor,ref:Ref,lock=false,includeArchived=false):Promise<ResourceBooking>{
  if(!["kosha","service"].includes(ref.source)||!Number.isSafeInteger(ref.id)||ref.id<=0)throw new BookingResourceConflictError("هوية الحجز غير صحيحة",422);
  const [b]=resourceRows(await tx.execute(ref.source==="kosha"?sql`
    SELECT id,status,event_date,event_time,kosha_id,assigned_staff_id,transportation_mode,transportation_driver_id,transportation_vehicle_id,booking_details AS details,archived_at
    FROM kosha_bookings WHERE id=${ref.id} ${includeArchived?sql``:sql`AND archived_at IS NULL`} ${lock?sql`FOR UPDATE`:sql``}`:sql`
    SELECT id,status,event_date,NULL::text AS event_time,NULL::integer AS kosha_id,NULL::integer AS assigned_staff_id,NULL::text AS transportation_mode,
      NULL::integer AS transportation_driver_id,NULL::integer AS transportation_vehicle_id,custom_fields AS details,archived_at
    FROM service_orders WHERE id=${ref.id} ${includeArchived?sql``:sql`AND archived_at IS NULL`} ${lock?sql`FOR UPDATE`:sql``}`));
  if(!b)throw new BookingResourceConflictError("الحجز غير موجود أو مؤرشف",404);
  const details=object(b.details),operations=object(details.bookingOperations);
  const dispatch=resourceRows(await tx.execute(sql`SELECT vehicle_id,crew_id FROM dispatch_assignments WHERE entity_type=${entity(ref)} AND entity_id=${ref.id} AND status IN ('assigned','en_route','active') LIMIT 2`));
  if(dispatch.length>1)throw new BookingResourceConflictError("إسناد النقل غير متطابق؛ راجع الحجز",409);
  const members=resourceRows(await tx.execute(ref.source==="kosha"?sql`
    SELECT m.staff_id FROM kosha_work_order_members m JOIN kosha_work_orders w ON w.id=m.work_order_id
    WHERE w.booking_id=${ref.id} AND w.cancelled_at IS NULL AND lower(w.status) NOT IN ('cancelled','completed')
      AND m.removed_at IS NULL AND lower(m.status) NOT IN ('removed','cancelled','declined') LIMIT 101`:sql`
    SELECT c.staff_id,${photographyEventLinkIds(sql`e.id`)} AS photo_booking_ids FROM photography_shoot_crew c JOIN photography_shoots sh ON sh.id=c.shoot_id JOIN photography_events e ON e.id=sh.event_id
    WHERE ${ref.id} IN (SELECT unnest(${photographyEventLinkIds(sql`e.id`)})) AND sh.cancelled_at IS NULL AND lower(sh.stage) NOT IN ('cancelled','completed')
      AND lower(e.status) NOT IN ('cancelled','completed','deleted','archived')
      AND lower(c.assignment_status) NOT IN ('removed','cancelled','rejected','revoked')
    UNION SELECT e.assigned_staff_id,${photographyEventLinkIds(sql`e.id`)} AS photo_booking_ids FROM photography_events e LEFT JOIN photography_shoots sh ON sh.event_id=e.id
      WHERE ${ref.id} IN (SELECT unnest(${photographyEventLinkIds(sql`e.id`)})) AND e.assigned_staff_id IS NOT NULL
      AND lower(e.status) NOT IN ('cancelled','completed','deleted','archived')
      AND (sh.id IS NULL OR sh.cancelled_at IS NULL AND lower(sh.stage) NOT IN ('cancelled','completed')) LIMIT 101`));
  if(ref.source==="service")for(const member of members)if(member.photo_booking_ids!==undefined)resolvePhotographyBookingId(member.photo_booking_ids);
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
  return {...ref,eventDate:b.event_date??null,eventTime:b.event_time??details.eventTime??details.eventStartTime??details.startTime??null,eventEndTime:details.eventEndTime??details.endTime??null,archivedAt:b.archived_at??null,details,operations,status:String(b.status??""),assignedStaffId:id(b.assigned_staff_id),staffIds,vehicleId,driverId,crewId:id(dispatch[0]?.crew_id),koshaId:id(b.kosha_id??details.koshaId),assets:[...assets.values()]};
}

/** Replaces one operational leaf only, atomically with the original timeline.
 * No stock/financial movement or automatic rewriting of fixed custody periods. */
export async function saveBookingResourceWindow(database:Database,ref:Ref,value:unknown,expected:unknown,actor:{id:number;name:string},options:ResourceWindowSaveOptions={}){
  const window=parseBookingResourceWindow(value);
  const calendarRequested=options.eventDate!==undefined;
  if(calendarRequested&&(typeof options.eventDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(options.eventDate)||!(options.expectedEventDate===null||typeof options.expectedEventDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(options.expectedEventDate))))throw new BookingResourceConflictError("تاريخ الحجز الحالي والجديد مطلوبان لتعديل الموعد بأمان",422);
  return database.transaction(async tx=>{
    const live=await readResourceBooking(tx,ref,true);
    if(["cancelled","canceled","deleted","completed","delivered","closed"].includes(live.status.toLowerCase()))throw new BookingResourceConflictError("لا يمكن تعديل فترة حجز ملغي أو مكتمل",409);
    const eventDate=calendarRequested?options.eventDate as string:live.eventDate;
    parseBookingResourceWindow(window,eventDate);
    const calendar=resourceWindowCalendar(window),eventTime=calendarRequested?calendar.eventTime:live.eventTime;
    if(!calendarRequested&&((live.eventTime&&live.eventTime.slice(0,5)!==calendar.eventTime)||(live.eventEndTime&&live.eventEndTime.slice(0,5)!==calendar.endTime)))throw new BookingResourceConflictError("الموعد المسجل لا يطابق الفترة؛ فعّل تعديل موعد الحجز مع فترة الموارد لحفظهما معاً",409);
    const before=live.operations.resourceWindow??null;
    const aliasesMatch=Object.entries({eventTime:calendar.eventTime,eventStartTime:calendar.eventTime,startTime:calendar.eventTime,eventEndTime:calendar.endTime,endTime:calendar.endTime}).every(([key,time])=>!live.details[key]||String(live.details[key]).slice(0,5)===time);
    if(isDeepStrictEqual(before,window)&&eventDate===live.eventDate&&eventTime===live.eventTime&&(!calendarRequested||aliasesMatch&&(!live.eventEndTime||live.eventEndTime.slice(0,5)===calendar.endTime)))return {ok:true,duplicate:true,resourceWindow:window,eventDate,eventTime};
    if(calendarRequested&&options.expectedEventDate!==(live.eventDate??null))throw new BookingResourceConflictError("تغيّر تاريخ الحجز؛ حدّث الصفحة قبل تعديل الموعد والفترة معاً",409);
    if(!isDeepStrictEqual(before,expected??null))throw new BookingResourceConflictError("تغيّرت فترة الموارد؛ حدّث الصفحة قبل حفظ مواعيد جديدة",409);
    if(live.assets.some(a=>a.stage==="out"||Number(a.checkedOutQty??0)>0))throw new BookingResourceConflictError("لا يمكن تعديل فترة موارد صُرفت؛ أكمل الإرجاع وراجع سجل الحجز أولاً",409);
    const fixed=resourceRows(await tx.execute(sql`SELECT id FROM employee_custody_reservations WHERE booking_type=${entity(ref)} AND booking_id=${ref.id} AND status IN ('reserved','checked_out') LIMIT 1`));
    if(fixed.length)throw new BookingResourceConflictError("حرّر حجز عهدة الموظفين قبل تعديل الفترة، ثم أعد حجزها بالمواعيد الجديدة",409);
    if(ref.source==="kosha"&&resourceRows(await tx.execute(sql`SELECT a.id FROM kosha_work_order_assets a JOIN kosha_work_orders w ON w.id=a.work_order_id WHERE w.booking_id=${ref.id} AND a.checked_out_at IS NOT NULL AND a.returned_at IS NULL LIMIT 1`)).length)throw new BookingResourceConflictError("توجد معدات مصروفة من أمر التنفيذ؛ أكمل إرجاعها قبل تغيير الفترة",409);
    const next={...live,eventDate,eventTime,eventEndTime:calendarRequested?calendar.endTime:live.eventEndTime,operations:{...live.operations,resourceWindow:window}};
    if(live.koshaId){await tx.execute(sql`SELECT id FROM koshas WHERE id=${live.koshaId} FOR UPDATE`);if(await findBookingKoshaConflict(next,live.koshaId,tx))throw new BookingResourceConflictError("الكوشة مشغولة خلال فترة التشغيل الجديدة",409)}
    if(live.staffIds.length){const staff=resourceRows(await tx.execute(sql`SELECT id,is_active FROM staff WHERE id IN (${sql.join(live.staffIds.map(id=>sql`${id}`),sql`, `)}) ORDER BY id FOR UPDATE`));if(live.staffIds.some(id=>!staff.some(row=>Number(row.id)===id&&row.is_active===true)))throw new BookingResourceConflictError("تغيّرت أهلية أحد الموظفين؛ اختر فريقاً نشطاً",422);if(await findBookingStaffConflict(next,live.staffIds,tx))throw new BookingResourceConflictError("أحد أفراد الفريق أو السائق مشغول أو مواعيده غير مكتملة خلال الفترة الجديدة",409)}
    await lockBookingDispatchResources(tx,next);
    if(live.assets.length){
      const ids=live.assets.map(a=>a.productId).sort((a,b)=>a-b);
      await tx.execute(sql`SELECT id FROM products WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) ORDER BY id FOR UPDATE`);
      if(live.assets.some(a=>a.trackingMode==="quantity"&&!["linked","released","returned","completed"].includes(String(a.stage??"linked"))))throw new BookingResourceConflictError("حرّر حجز كميات المعدات قبل تغيير الفترة، ثم راجع توفرها واحجزها من جديد",409);
      for(const asset of live.assets.filter(a=>a.trackingMode!=="quantity"&&!["released","returned","inspection","completed"].includes(String(a.stage??"linked"))))if(await findBookingPhysicalConflict(next,asset.productId,tx))throw new BookingResourceConflictError("إحدى المعدات مشغولة أو فترة حجزها الآخر غير مكتملة",409);
    }
    const encoded=JSON.stringify(window);
    const dateSql=calendarRequested?sql`,event_date=${eventDate}`:sql``;
    const nativeTimeSql=calendarRequested?sql`,event_time=${eventTime}`:sql``;
    const nativeTimes=Object.fromEntries(Object.entries({eventTime,eventStartTime:eventTime,startTime:eventTime,eventEndTime:calendar.endTime,endTime:calendar.endTime}).filter(([key])=>Object.hasOwn(live.details,key)));
    const nativeTimesSql=calendarRequested&&Object.keys(nativeTimes).length?sql`||${JSON.stringify(nativeTimes)}::jsonb`:sql``;
    const serviceTimesSql=calendarRequested?sql`||${JSON.stringify({eventTime,eventStartTime:eventTime,eventEndTime:calendar.endTime,...(Object.hasOwn(live.details,"startTime")?{startTime:eventTime}:{}),...(Object.hasOwn(live.details,"endTime")?{endTime:calendar.endTime}:{})})}::jsonb`:sql``;
    await tx.execute(ref.source==="kosha"?sql`UPDATE kosha_bookings SET booking_details=jsonb_set(coalesce(nullif(booking_details,'null'::jsonb),'{}'::jsonb),'{bookingOperations}',coalesce(nullif(booking_details->'bookingOperations','null'::jsonb),'{}'::jsonb)||jsonb_build_object('resourceWindow',${encoded}::jsonb),true)${nativeTimesSql},updated_at=now()${dateSql}${nativeTimeSql} WHERE id=${ref.id}`:sql`UPDATE service_orders SET custom_fields=jsonb_set(coalesce(nullif(custom_fields,'null'::jsonb),'{}'::jsonb),'{bookingOperations}',coalesce(nullif(custom_fields->'bookingOperations','null'::jsonb),'{}'::jsonb)||jsonb_build_object('resourceWindow',${encoded}::jsonb),true)${serviceTimesSql}${dateSql} WHERE id=${ref.id}`);
    await options.afterSave?.(tx,next);
    await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,actor_id,actor_name,metadata) VALUES(${entity(ref)},${ref.id},${calendarRequested?"booking_schedule_window_updated":"booking_resource_window_updated"},${calendarRequested?"تحديث موعد الحجز وفترة الموارد":"تحديث فترة تشغيل الموارد"},${actor.id},${actor.name},${JSON.stringify({previous:before,next:window,...(calendarRequested?{previousDate:live.eventDate,eventDate,previousTime:live.eventTime,eventTime}:{})})}::jsonb)`);
    return {ok:true,duplicate:false,resourceWindow:window,eventDate,eventTime};
  });
}
export const resourceWindowView=(b:ResourceBooking)=>({resourceWindow:readBookingResourceWindow(b.operations,b.eventDate),expectedWindow:b.operations.resourceWindow??null,eventDate:b.eventDate,eventTime:b.eventTime});

const terminal=(value:string)=>["cancelled","canceled","deleted","completed","delivered","closed"].includes(value.toLowerCase());
const allocatesKosha=(value:ResourceBooking)=>!!value.koshaId&&(KOSHA_RESOURCE_STATUSES.some(status=>status===value.status.toLowerCase())||["preparing","ready","assets_out","event_active"].includes(String(value.operations.bookingStage??"")));
const resourceSnapshot=(value:ResourceBooking)=>({eventDate:value.eventDate,eventTime:value.eventTime,eventEndTime:value.eventEndTime??null,archivedAt:value.archivedAt??null,window:value.operations.resourceWindow??null,staffIds:value.staffIds,vehicleId:value.vehicleId,crewId:value.crewId,koshaId:allocatesKosha(value)?value.koshaId:null,assets:value.assets.map(asset=>Object.fromEntries(["productId","trackingMode","quantity","requiredQty","reservedQty","checkedOutQty","returnedGoodQty","returnedDamagedQty","missingQty","stage"].filter(key=>Object.hasOwn(asset,key)).map(key=>[key,asset[key]]))).sort((a,b)=>a.productId-b.productId)});
function sameOrReleased(before:ResourceBooking,next:ResourceBooking){
  const old=resourceSnapshot(before),candidate=resourceSnapshot(next);
  // Removing identities is not a new reservation. Keep every other occupancy
  // fact equal; this does not bypass date, activation, quantity or stage guards.
  return candidate.staffIds.every(id=>old.staffIds.includes(id))&&(!candidate.vehicleId||candidate.vehicleId===old.vehicleId)&&(!candidate.crewId||candidate.crewId===old.crewId)&&(!candidate.koshaId||candidate.koshaId===old.koshaId)&&isDeepStrictEqual({...old,staffIds:candidate.staffIds,vehicleId:candidate.vehicleId,crewId:candidate.crewId,koshaId:candidate.koshaId},candidate);
}

/** Guard the ORIGINAL mutation inside its caller's transaction. Read the saved
 * candidate rather than a stale form/JSON patch; a failed availability read or
 * conflict rolls the original write back. No additional reservation/movement.
 * includeArchived is internal only, to validate restoring a historical record.
 */
export async function guardBookingResourceWrite<T>(tx:ResourceExecutor,ref:Ref,write:(before:ResourceBooking)=>Promise<T>,options:{staffOverrideReason?:string|null;staffOverrideIds?:number[]}={}):Promise<T>{
  const before=await readResourceBooking(tx,ref,true,true);
  const result=await write(before);
  const next=await readResourceBooking(tx,ref,false,true);
  await assertBookingResourceCandidate(tx,next,before,options.staffOverrideReason,options.staffOverrideIds);
  return result;
}

/** Initial user booking allocations use the same guard, after the original
 * insert and before its transaction commits. Commercial import writers retain
 * their own existing inventory/checkout contracts. */
export async function validateBookingResourceCreation(tx:ResourceExecutor,ref:Ref){
  const next=await readResourceBooking(tx,ref,true,true);
  await assertBookingResourceCandidate(tx,next,null);
}
async function assertBookingResourceCandidate(tx:ResourceExecutor,next:ResourceBooking,before:ResourceBooking|null,staffOverrideReason?:string|null,staffOverrideIds:number[]=[]){
  const ref={source:next.source,id:next.id};
  if(next.archivedAt||terminal(next.status)||(before&&!terminal(before.status)&&sameOrReleased(before,next))){
    // JSON-only service vehicle identities have no FK barrier. Serialize even
    // historical/fee-only edits with the monthly snapshot, without rechecking
    // old scheduling or requiring a historical vehicle to still be active.
    if(next.source==="service")await lockBookingVehicleIdentities(tx,next);
    return;
  }
  const hasResources=allocatesKosha(next)||next.staffIds.length||next.vehicleId||next.crewId||next.assets.some(asset=>!["released","returned","inspection","completed"].includes(String(asset.stage??"linked")));
  if(!hasResources&&!next.operations.resourceWindow)return;
  // The period is optional; without one the booking holds its whole event day.
  const timingProblem=resourceTimingProblem(next);
  if(timingProblem)throw new BookingResourceConflictError(timingProblem,409);
  const window=readBookingResourceWindow(next.operations,next.eventDate);
  if(window&&next.eventTime&&resourceWindowCalendar(window).eventTime!==next.eventTime.slice(0,5))throw new BookingResourceConflictError("موعد الحجز لا يطابق فترة الموارد؛ عدّل الموعد والفترة معاً من محرر الفترة",409);
  if(window&&next.eventEndTime&&resourceWindowCalendar(window).endTime!==next.eventEndTime.slice(0,5))throw new BookingResourceConflictError("موعد نهاية الحجز لا يطابق فترة الموارد؛ عدّل الموعد والفترة معاً",409);
  const scheduleChanged=before&&(before.eventDate!==next.eventDate||before.eventTime!==next.eventTime||!isDeepStrictEqual(before.operations.resourceWindow,next.operations.resourceWindow));
  if(scheduleChanged){
    if(next.assets.some(a=>a.stage==="out"||Number(a.checkedOutQty??0)>0))throw new BookingResourceConflictError("أكمل إرجاع المعدات قبل تعديل الموعد",409);
    if(resourceRows(await tx.execute(sql`SELECT id FROM employee_custody_reservations WHERE booking_type=${entity(ref)} AND booking_id=${ref.id} AND status IN ('reserved','checked_out') LIMIT 1`)).length)throw new BookingResourceConflictError("حرّر حجز العهدة قبل تغيير الموعد ثم أعد حجزها بالفترة الجديدة",409);
    if(ref.source==="kosha"&&resourceRows(await tx.execute(sql`SELECT a.id FROM kosha_work_order_assets a JOIN kosha_work_orders w ON w.id=a.work_order_id WHERE w.booking_id=${ref.id} AND a.checked_out_at IS NOT NULL AND a.returned_at IS NULL LIMIT 1`)).length)throw new BookingResourceConflictError("أكمل إرجاع معدات أمر التنفيذ قبل تغيير الموعد",409);
    if(next.assets.some(a=>a.trackingMode==="quantity"&&!["linked","released","returned","completed"].includes(String(a.stage??"linked"))))throw new BookingResourceConflictError("حرّر حجز كميات المعدات قبل تغيير الموعد ثم أعد حجزها",409);
  }
  if(allocatesKosha(next)){
    await tx.execute(sql`SELECT id FROM koshas WHERE id=${next.koshaId} FOR UPDATE`);
    if(await findBookingKoshaConflict(next,next.koshaId!,tx))throw new BookingResourceConflictError("الكوشة مشغولة خلال فترة التشغيل أو مواعيدها غير مكتملة",409);
  }
  if(next.staffIds.length){
    const staff=resourceRows(await tx.execute(sql`SELECT id,is_active FROM staff WHERE id IN (${sql.join(next.staffIds.map(id=>sql`${id}`),sql`, `)}) ORDER BY id FOR UPDATE`));
    if(next.staffIds.some(id=>!staff.some(row=>Number(row.id)===id&&row.is_active===true)))throw new BookingResourceConflictError("تغيّرت أهلية أحد الموظفين؛ اختر فريقاً نشطاً",422);
    // Trusted internal photo-manager policy only, never forwarded directly from
    // a generic booking payload. Other resources and failed reads still block.
    const groups=staffConflictGroups(next.staffIds,staffOverrideReason,staffOverrideIds);
    if(await findBookingStaffConflict(next,groups.checked,tx))throw new BookingResourceConflictError("أحد أفراد الفريق أو السائق مشغول أو مواعيده غير مكتملة خلال فترة التشغيل",409);
    if(groups.overridden.length)await findBookingStaffConflict(next,groups.overridden,tx); // A failed read is never an override.
  }
  await lockBookingDispatchResources(tx,next);
  const physical=next.assets.filter(a=>a.trackingMode!=="quantity"&&!["released","returned","inspection","completed"].includes(String(a.stage??"linked"))).sort((a,b)=>a.productId-b.productId);
  if(physical.length)await tx.execute(sql`SELECT id FROM products WHERE id IN (${sql.join(physical.map(asset=>sql`${asset.productId}`),sql`, `)}) ORDER BY id FOR UPDATE`);
  for(const asset of physical)if(await findBookingPhysicalConflict(next,asset.productId,tx))throw new BookingResourceConflictError("إحدى المعدات مشغولة أو مواعيدها غير مكتملة",409);
}
/** Keep every persisted transport identity behind one sorted fleet barrier.
 * A dispatch resource may differ from the financial transport JSON vehicle;
 * neither identity is silently overwritten or inferred from the other. */
async function lockBookingVehicleIdentities(tx:ResourceExecutor,next:ResourceBooking){
  const transport=object(next.operations.transportation);
  const jsonVehicle=next.source==="service"&&transport.mode==="ajn"?id(transport.vehicleId):null;
  const ids=[...new Set([next.vehicleId,jsonVehicle].filter((value):value is number=>value!==null))].sort((a,b)=>a-b);
  const result=new Map<number,Record<string,any>>();
  for(const vehicleId of ids){
    const rows=resourceRows(await tx.execute(sql`SELECT id,is_active,status FROM fleet_vehicles WHERE id=${vehicleId} FOR UPDATE /* vp_terminal_vehicle_barrier */`));
    if(rows.length!==1||Number(rows[0].id)!==vehicleId)throw new BookingResourceConflictError("مرجع مركبة النقل غير موجود؛ راجع إسناد الحجز",409);
    result.set(vehicleId,rows[0]);
  }
  return result;
}
async function lockBookingDispatchResources(tx:ResourceExecutor,next:ResourceBooking){
  const vehicles=await lockBookingVehicleIdentities(tx,next);
  for(const [kind,resourceId] of [["vehicle",next.vehicleId],["crew",next.crewId]] as const){
    if(!resourceId)continue;
    const resource=kind==="vehicle"?vehicles.get(resourceId):resourceRows(await tx.execute(sql`SELECT id,is_active,status FROM crews WHERE id=${resourceId} FOR UPDATE`))[0];
    if(!resource||resource.is_active!==true||["maintenance","repair","retired","inactive",...(kind==="crew"?["unavailable"]:[])].includes(String(resource.status)))throw new BookingResourceConflictError("المركبة أو فريق التركيب غير متاح أو تغيّرت حالته",409);
    const outside=resourceRows(await tx.execute(sql`SELECT entity_type,entity_id FROM dispatch_assignments WHERE ${kind==="vehicle"?sql`vehicle_id`:sql`crew_id`}=${resourceId} AND status IN ('assigned','en_route','active') AND entity_type NOT IN ('kosha_booking','service_order') LIMIT 1`));
    if(outside.length||await(kind==="vehicle"?findBookingVehicleConflict(next,resourceId,tx):findBookingCrewConflict(next,resourceId,tx)))throw new BookingResourceConflictError("المركبة أو فريق التركيب مشغول أو مواعيده غير مكتملة",409);
  }
}

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
  const timingProblem=resourceTimingProblem(live);
  if(timingProblem)throw new BookingResourceConflictError(timingProblem,409);
  if(await findBookingStaffConflict(live,ids,tx))throw new BookingResourceConflictError("أحد الموظفين مشغول خلال فترة التجهيز والتنفيذ والإرجاع أو مواعيده غير مكتملة",409);
  return live;
}
