import {sql} from "drizzle-orm";
import {dailyAssignedStaffIds} from "../lib/booking-daily-operations";
import {BookingBulkError} from "./booking-bulk-operations";
type Ref={source:"kosha"|"service";id:number};
type Executor={execute(query:any):Promise<any>};
type Database={transaction<T>(fn:(tx:Executor)=>Promise<T>):Promise<T>};
export type BookingReminderRequest={requestId:string;action:"send_reminder";refs:Ref[];message:string};
type Diagnostic={requestId:string;source:string;bookingId:number;actorId:number;errorType:string;errorCode:string|null};
const rows=async(tx:Executor,q:any)=>{const result=await tx.execute(q);if(!Array.isArray(result?.rows))throw Error("Invalid operational reminder query response");return result.rows as any[]};

/** Original notification inbox only. Booking lock + original timeline receipt
 * make retries durable, including response loss. No new scheduler/push service,
 * no payment, inventory, booking stage or task mutation. */
export async function sendBookingReminders(database:Database,actor:{id:number;name:string;canManage:boolean},request:BookingReminderRequest,log:(context:Diagnostic)=>void){
  if(!actor.canManage||!Number.isSafeInteger(actor.id)||actor.id<=0)throw new BookingBulkError("ليس لديك صلاحية إرسال تذكيرات الحجوزات",403);
  if(request.action!=="send_reminder"||typeof request.requestId!=="string"||request.requestId.length<8||request.requestId.length>100||typeof request.message!=="string"||!request.message.trim()||request.message.length>500||!Array.isArray(request.refs)||!request.refs.length||request.refs.length>50||request.refs.some(r=>!["kosha","service"].includes(r.source)||!Number.isSafeInteger(r.id)||r.id<=0)||new Set(request.refs.map(r=>`${r.source}:${r.id}`)).size!==request.refs.length)throw new BookingBulkError("قائمة الحجوزات أو التذكير غير صالحة",422);
  const message=request.message.trim(),fingerprint=JSON.stringify({action:"send_reminder",message});
  const results:Array<Ref&{status:"success"|"failed";replayed?:boolean;updated?:number;message?:string;httpStatus?:number;requestId:string}>=[];
  for(const ref of request.refs){const entityType=ref.source==="kosha"?"kosha_booking":"service_order";
    try{
      const result=await database.transaction(async tx=>{
        const [booking]=await rows(tx,ref.source==="kosha"?sql`SELECT id,status,booking_details AS details,assigned_staff_id FROM kosha_bookings WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`:sql`SELECT id,status,custom_fields AS details,NULL::integer AS assigned_staff_id FROM service_orders WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`);
        if(!booking)throw new BookingBulkError("الحجز غير موجود أو مؤرشف",404);
        const [previous]=await rows(tx,sql`SELECT actor_id,metadata FROM entity_timeline WHERE entity_type=${entityType} AND entity_id=${ref.id} AND type='booking_operation_reminder' AND metadata->>'requestId'=${request.requestId} ORDER BY id LIMIT 1`);
        if(previous){if(Number(previous.actor_id)!==actor.id||previous.metadata?.fingerprint!==fingerprint)throw new BookingBulkError("رمز المحاولة مستخدم لتذكير أو موظف مختلف");return {replayed:true,updated:Number(previous.metadata.updated)}}
        if(["cancelled","canceled","completed","delivered","returned","closed","archived"].includes(String(booking.status??"").toLowerCase()))throw new BookingBulkError("الحجز ملغى أو مغلق؛ لا يُرسل تذكير تشغيل له");
        const details=booking.details??{};if(typeof details!=="object"||Array.isArray(details))throw new BookingBulkError("بيانات فريق الحجز غير صالحة");
        const tasks=await rows(tx,sql`SELECT assigned_staff_ids FROM tasks WHERE related_type=${entityType} AND related_id=${ref.id} AND archived_at IS NULL AND status NOT IN ('completed','approved','cancelled','closed') ORDER BY id LIMIT 501`);
        if(tasks.length>500||tasks.some(t=>!Array.isArray(t.assigned_staff_ids)))throw new BookingBulkError("تعذر التحقق من قائمة المهام؛ راجع بيانات الحجز");
        const crew=await rows(tx,ref.source==="kosha"?sql`SELECT m.staff_id FROM kosha_work_order_members m JOIN kosha_work_orders w ON w.id=m.work_order_id WHERE w.booking_id=${ref.id} AND w.cancelled_at IS NULL AND lower(w.status)<>'cancelled' AND m.removed_at IS NULL AND lower(m.status) NOT IN ('removed','cancelled','declined') ORDER BY m.staff_id LIMIT 101`:sql`SELECT c.staff_id FROM photography_shoot_crew c JOIN photography_shoots s ON s.id=c.shoot_id WHERE s.booking_id=${ref.id} AND lower(s.stage)<>'cancelled' AND c.assignment_status NOT IN ('removed','cancelled','rejected') ORDER BY c.staff_id LIMIT 101`);
        const ids=dailyAssignedStaffIds({details,assignedStaffId:booking.assigned_staff_id,executionStaffIds:[...tasks.flatMap(t=>t.assigned_staff_ids),...crew.map(c=>c.staff_id)]});
        if(crew.length>100||ids.length>100)throw new BookingBulkError("تجاوز عدد المستلمين حد 100 موظف؛ راجع فريق الحجز");
        if(!ids.length)throw new BookingBulkError("لا يوجد فريق أو مهام معيّنة لهذا الحجز",422);
        const recipients=await rows(tx,sql`SELECT id FROM staff WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND is_active=true ORDER BY id FOR SHARE`);
        if(!recipients.length)throw new BookingBulkError("لا يوجد موظفون فعّالون ضمن فريق الحجز",422);
        // The unified portal is available to all assigned departments; a
        // preparation-only employee need not have Kosha execution-portal access.
        const href="/staff?tab=tasks";
        for(const recipient of recipients){const inserted=await rows(tx,sql`INSERT INTO notifications(audience_type,staff_id,type,title,body,entity_type,entity_id,href,metadata) VALUES('staff',${recipient.id},'booking_operation_reminder','تذكير تشغيلي للحجز',${message},${entityType},${ref.id},${href},${JSON.stringify({requestId:request.requestId,source:ref.source,bookingId:ref.id,actorId:actor.id,delivery:"in_app"})}::jsonb) RETURNING id`);if(inserted.length!==1)throw Error("Operational reminder was not inserted");}
        await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata) VALUES(${entityType},${ref.id},'booking_operation_reminder','إرسال تذكير تشغيلي',${message},${actor.id},${actor.name},${JSON.stringify({requestId:request.requestId,fingerprint,updated:recipients.length,recipientIds:recipients.map(r=>Number(r.id)),delivery:"in_app"})}::jsonb)`);
        return {replayed:false,updated:recipients.length};
      });results.push({...ref,status:"success",requestId:request.requestId,...result});
    }catch(cause){
      if(cause instanceof BookingBulkError)results.push({...ref,status:"failed",httpStatus:cause.status,message:cause.message,requestId:request.requestId});
      else{const failure=cause&&typeof cause==="object"?cause as {name?:unknown;code?:unknown}:{};const errorType=typeof failure.name==="string"&&/^[A-Za-z][\w.]{0,79}$/.test(failure.name)?failure.name:"UnknownError";const errorCode=typeof failure.code==="string"&&/^(?:[0-9A-Z]{5}|E[A-Z_]{2,31})$/.test(failure.code)?failure.code:null;log({requestId:request.requestId,source:ref.source,bookingId:ref.id,actorId:actor.id,errorType,errorCode});results.push({...ref,status:"failed",httpStatus:503,message:"لم يتأكد إرسال التذكير؛ أعد نفس المحاولة دون تكرار",requestId:request.requestId});}
    }
  }
  return {requestId:request.requestId,results};
}
