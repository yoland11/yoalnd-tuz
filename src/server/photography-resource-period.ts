import {sql} from "drizzle-orm";
import {isDeepStrictEqual} from "node:util";
import {parseBookingResourceWindow,readBookingResourceWindow,resourceWindowCalendar} from "@/lib/booking-resource-window";
import {BookingResourceConflictError,findBookingStaffConflict,resourceRows,staffConflictGroups,type ResourceExecutor,type StaffTimedRef} from "./booking-resource-availability";
import {guardBookingResourceWrite,readResourceBooking,saveBookingResourceWindow,type ResourceWindowSaveOptions} from "./booking-resource-period";

type Database=ResourceExecutor&{transaction<T>(run:(tx:ResourceExecutor)=>Promise<T>):Promise<T>};
const positive=(value:unknown)=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const terminal=(value:unknown)=>["cancelled","canceled","completed","deleted","archived","closed"].includes(String(value??"").toLowerCase());
const shootClosed=(event:Record<string,any>)=>!!event.shoot_cancelled_at||["cancelled","completed"].includes(String(event.shoot_stage??"").toLowerCase());
export type PhotographyResource=Awaited<ReturnType<typeof readPhotographyResource>>;

/** Lock linked central source BEFORE the event, matching central→photo sync.
 * The preliminary link is rechecked after the event lock. No private tokens,
 * customer details, financial records or second scheduling store are needed. */
export async function readPhotographyResource(tx:ResourceExecutor,eventId:number,lock=false){
  if(!positive(eventId))throw new BookingResourceConflictError("هوية مناسبة التصوير غير صحيحة",422);
  const readLink=async()=>{
    const rows=resourceRows(await tx.execute(sql`SELECT e.booking_id,sh.booking_id AS shoot_booking_id,c.booking_id AS crew_booking_id FROM photography_events e LEFT JOIN photography_shoots sh ON sh.event_id=e.id LEFT JOIN photography_shoot_crew c ON c.shoot_id=sh.id WHERE e.id=${eventId} LIMIT 101`));
    if(!rows.length)throw new BookingResourceConflictError("مناسبة التصوير غير موجودة",404);
    if(rows.length>100)throw new BookingResourceConflictError("راجع حجم فريق التصوير قبل تأكيد الربط",422);
    const ids=[...new Set(rows.flatMap(row=>[positive(row.booking_id),positive(row.shoot_booking_id),positive(row.crew_booking_id)]).filter((value):value is number=>value!==null))];
    if(ids.length>1)throw new BookingResourceConflictError("ربط مناسبة التصوير بالحجز غير متطابق؛ راجع المسؤول",409);
    return ids[0]??null;
  };
  const bookingId=await readLink();
  const central=bookingId?await readResourceBooking(tx,{source:"service",id:bookingId},lock,true):null;
  if(lock&&central?.koshaId)await tx.execute(sql`SELECT id FROM koshas WHERE id=${central.koshaId} FOR UPDATE`);
  const events=resourceRows(await tx.execute(sql`SELECT e.id,e.booking_id,e.event_date,e.event_start_time,e.event_end_time,e.assigned_staff_id,e.status,to_jsonb(e)->'resource_window' AS resource_window,sh.stage AS shoot_stage,sh.cancelled_at AS shoot_cancelled_at FROM photography_events e LEFT JOIN photography_shoots sh ON sh.event_id=e.id WHERE e.id=${eventId} LIMIT 2 ${lock?sql`FOR UPDATE OF e`:sql``}`));
  if(events.length!==1||await readLink()!==bookingId)throw new BookingResourceConflictError("تغيّر ربط مناسبة التصوير؛ أعد فتحها قبل الحفظ",409);
  const event=events[0];
  const crew=resourceRows(await tx.execute(sql`SELECT c.staff_id FROM photography_shoot_crew c JOIN photography_shoots sh ON sh.id=c.shoot_id WHERE sh.event_id=${eventId} AND sh.cancelled_at IS NULL AND lower(sh.stage) NOT IN ('cancelled','completed') AND lower(c.assignment_status) NOT IN ('rejected','revoked','removed','cancelled') LIMIT 101`));
  if(crew.length>100)throw new BookingResourceConflictError("فريق التصوير كبير؛ راجع الإسناد قبل تأكيد الموعد",422);
  const staffIds=[...new Set([positive(event.assigned_staff_id),...crew.map(row=>positive(row.staff_id)),...(central?.staffIds??[])].filter((value):value is number=>value!==null))].sort((a,b)=>a-b);
  if(staffIds.length>100)throw new BookingResourceConflictError("راجع عدد أفراد فريق التصوير",422);
  const reference:StaffTimedRef=central??{source:"photography",id:eventId,eventDate:event.event_date,operations:{resourceWindow:event.resource_window??null}};
  return {event,reference,staffIds,central,resourceWindow:readBookingResourceWindow(reference.operations,reference.eventDate)};
}

/** Same staff row mutex used by Booking Center and dispatch drivers. */
export async function assertPhotographyResourceAllocation(tx:ResourceExecutor,next:PhotographyResource,overrideReason?:string|null,overrideStaffIds:number[]=[]){
  if(terminal(next.event.status)||shootClosed(next.event))throw new BookingResourceConflictError("لا يمكن إسناد تصوير لمناسبة ملغاة أو مكتملة أو مؤرشفة",409);
  if(!next.staffIds.length)return null;
  if(next.staffIds.length>100)throw new BookingResourceConflictError("راجع عدد أفراد فريق التصوير قبل الإسناد",422);
  if(next.central&&(next.central.archivedAt||terminal(next.central.status)))throw new BookingResourceConflictError("لا يمكن إسناد تصوير لحجز مركزي ملغي أو مكتمل أو مؤرشف",409);
  if(!next.resourceWindow)throw new BookingResourceConflictError("حدد فترة تشغيل التصوير من التجهيز حتى اكتمال الإرجاع قبل الإسناد أو تغيير الموعد",409);
  const calendar=resourceWindowCalendar(next.resourceWindow);
  if(next.event.event_date!==calendar.eventDate||next.event.event_start_time&&String(next.event.event_start_time).slice(0,5)!==calendar.eventTime||next.event.event_end_time&&String(next.event.event_end_time).slice(0,5)!==calendar.endTime)throw new BookingResourceConflictError("موعد التصوير لا يطابق فترة التشغيل؛ عدّل الموعد والفترة معاً",409);
  const staff=resourceRows(await tx.execute(sql`SELECT id,is_active FROM staff WHERE id IN (${sql.join(next.staffIds.map(id=>sql`${id}`),sql`, `)}) ORDER BY id FOR UPDATE`));
  if(next.staffIds.some(id=>!staff.some(row=>Number(row.id)===id&&row.is_active===true)))throw new BookingResourceConflictError("تغيّرت أهلية أحد المصورين؛ اختر فريقاً نشطاً",422);
  const groups=staffConflictGroups(next.staffIds,overrideReason,overrideStaffIds);
  const conflict=await findBookingStaffConflict(next.reference,groups.checked,tx);
  if(conflict)throw new BookingResourceConflictError("أحد المصورين مشغول بحجز متعارض خلال فترة التجهيز والتنفيذ والإرجاع أو مواعيده غير مكتملة؛ يتطلب التجاوز سبباً من المدير",409);
  return groups.overridden.length?findBookingStaffConflict(next.reference,groups.overridden,tx):null;
}

const snapshot=(value:PhotographyResource)=>({source:value.reference.source,id:value.reference.id,status:value.event.status,shootClosed:shootClosed(value.event),date:value.event.event_date,start:value.event.event_start_time??null,end:value.event.event_end_time??null,window:value.reference.operations.resourceWindow??null,staffIds:value.staffIds});
export async function guardPhotographyResourceWrite<T>(tx:ResourceExecutor,eventId:number,write:(before:PhotographyResource)=>Promise<T>,options:{overrideReason?:string|null;overrideStaffIds?:number[]}={}){
  const before=await readPhotographyResource(tx,eventId,true);
  const run=async()=>{
    const result=await write(before),next=await readPhotographyResource(tx,eventId);
    if(before.reference.source!==next.reference.source||before.reference.id!==next.reference.id)throw new BookingResourceConflictError("لا يمكن تغيير ربط مناسبة التصوير أثناء الإسناد",409);
    if(terminal(next.event.status)||shootClosed(next.event))return result;
    const old=snapshot(before),candidate=snapshot(next);
    const unchangedOrReleased=candidate.staffIds.every(id=>old.staffIds.includes(id))&&isDeepStrictEqual({...old,staffIds:candidate.staffIds},candidate);
    if(!unchangedOrReleased)await assertPhotographyResourceAllocation(tx,next,options.overrideReason,options.overrideStaffIds);
    return result;
  };
  return before.central?guardBookingResourceWrite(tx,{source:"service",id:before.central.id},run,{staffOverrideReason:options.overrideReason,staffOverrideIds:options.overrideStaffIds}):run();
}

/** Only standalone events store this optional field. Linked events always use
 * the original central period and the caller's existing sync callback. */
export async function savePhotographyResourceWindow(database:Database,eventId:number,value:unknown,expected:unknown,actor:{id:number;name:string},options:ResourceWindowSaveOptions={}){
  const window=parseBookingResourceWindow(value);
  return database.transaction(async tx=>{
    const live=await readPhotographyResource(tx,eventId,true);
    if(terminal(live.event.status)&&!(live.event.status==="archived"&&!live.central))throw new BookingResourceConflictError("لا يمكن تعديل فترة مناسبة ملغاة أو مكتملة",409);
    if(shootClosed(live.event))throw new BookingResourceConflictError("انتهت مهمة التصوير؛ لا يمكن تغيير فترة مهمة مكتملة أو ملغاة",409);
    if(live.central){
      // Do not nest/commit another transaction: use the already locked executor.
      return saveBookingResourceWindow({execute:q=>tx.execute(q),transaction:run=>run(tx)},{source:"service",id:live.central.id},window,expected,actor,options);
    }
    const changingDate=options.eventDate!==undefined;
    const date=changingDate?options.eventDate:live.event.event_date;
    if(typeof date!=="string"||changingDate&&!(options.expectedEventDate===null||typeof options.expectedEventDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(options.expectedEventDate)))throw new BookingResourceConflictError("تاريخ المناسبة الحالي والجديد مطلوبان لتعديل الموعد",422);
    parseBookingResourceWindow(window,date);
    const calendar=resourceWindowCalendar(window),before=live.event.resource_window??null;
    if(!changingDate&&((live.event.event_start_time&&String(live.event.event_start_time).slice(0,5)!==calendar.eventTime)||(live.event.event_end_time&&String(live.event.event_end_time).slice(0,5)!==calendar.endTime)))throw new BookingResourceConflictError("الموعد المسجل لا يطابق الفترة؛ فعّل تعديل موعد الحجز مع فترة الموارد لحفظهما معاً",409);
    if(isDeepStrictEqual(before,window)&&date===live.event.event_date&&calendar.eventTime===live.event.event_start_time&&calendar.endTime===live.event.event_end_time)return {ok:true,duplicate:true,resourceWindow:window,eventDate:date,eventTime:calendar.eventTime};
    if(changingDate&&options.expectedEventDate!==live.event.event_date)throw new BookingResourceConflictError("تغيّر موعد مناسبة التصوير؛ حدّث الصفحة قبل الحفظ",409);
    if(!isDeepStrictEqual(before,expected??null))throw new BookingResourceConflictError("تغيّرت فترة التصوير؛ حدّث الصفحة قبل الحفظ",409);
    const next={...live,event:{...live.event,event_date:date,event_start_time:calendar.eventTime,event_end_time:calendar.endTime},reference:{...live.reference,eventDate:date,operations:{resourceWindow:window}},resourceWindow:window};
    if(!terminal(live.event.status))await assertPhotographyResourceAllocation(tx,next);
    await tx.execute(sql`UPDATE photography_events SET resource_window=${JSON.stringify(window)}::jsonb,event_date=${date},event_start_time=${calendar.eventTime},event_end_time=${calendar.endTime},updated_at=now() WHERE id=${eventId}`);
    await tx.execute(sql`UPDATE photography_shoots SET event_time=${calendar.eventTime},updated_at=now() WHERE event_id=${eventId}`);
    const [policy]=resourceRows(await tx.execute(sql`SELECT require_reaccept_on_schedule_change AS require_reaccept FROM photography_workflow_settings WHERE code='default' LIMIT 1`));
    if(policy?.require_reaccept!==false)await tx.execute(sql`UPDATE photography_shoot_crew c SET assignment_status='assigned',accepted_at=NULL,conflict_reason='schedule_changed_reaccept_required' FROM photography_shoots sh WHERE sh.id=c.shoot_id AND sh.event_id=${eventId} AND sh.cancelled_at IS NULL AND lower(sh.stage) NOT IN ('cancelled','completed') AND c.assignment_status='accepted'`);
    await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,actor_id,actor_name,metadata) VALUES('photography_event',${eventId},'photography_resource_window_updated','تحديث موعد التصوير وفترة الموارد',${actor.id},${actor.name},${JSON.stringify({previous:before,next:window,previousDate:live.event.event_date,eventDate:date,reacceptRequired:policy?.require_reaccept!==false})}::jsonb)`);
    return {ok:true,duplicate:false,resourceWindow:window,eventDate:date,eventTime:calendar.eventTime};
  });
}
