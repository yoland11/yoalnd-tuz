import {sql} from "drizzle-orm";
import {PreparationAssignmentError,preparationObject,assertUniquePreparationTasks} from "./booking-preparation-assignment";
import {savePreparationMeta} from "./booking-preparation-update";
type Executor={execute(query:any):Promise<any>};
type Database={transaction<T>(fn:(tx:Executor)=>Promise<T>):Promise<T>};
type Action="approve"|"reject"|"return"|"reopen";
const rows=async(tx:Executor,q:any)=>{const result=await tx.execute(q);if(!Array.isArray(result?.rows))throw Error("Invalid preparation review query response");return result.rows as any[]};
const version=(value:unknown)=>{const date=new Date(value as any);return value!=null&&Number.isFinite(date.getTime())?date.toISOString():null};

/** Keeps the ORIGINAL submission/review/approval states. Only preparation task
 * review is coupled to its source-bound booking, using booking→task lock order.
 * Original inbox rows and both original audit streams commit in the same tx. */
export async function reviewPreparationTask(database:Database,taskId:number,actor:{id:number;name:string;canApprove:boolean},action:Action,reason:string){
  if(!actor.canApprove||!Number.isSafeInteger(actor.id)||actor.id<=0)throw new PreparationAssignmentError("ليس لديك صلاحية اعتماد المهام",403);
  if(!Number.isSafeInteger(taskId)||taskId<=0||!["approve","reject","return","reopen"].includes(action)||typeof reason!=="string"||reason.length>1000||["reject","return"].includes(action)&&reason.trim().length<3)throw new PreparationAssignmentError("إجراء مراجعة المهمة غير صالح",422);
  return database.transaction(async tx=>{
    const [hint]=await rows(tx,sql`SELECT id,related_type,related_id,task_type FROM tasks WHERE id=${taskId}`);
    if(!hint||hint.task_type!=="preparation"||!["kosha_booking","service_order"].includes(hint.related_type)||!Number.isSafeInteger(Number(hint.related_id))||Number(hint.related_id)<=0)throw new PreparationAssignmentError("المهمة ليست مرتبطة بتجهيز حجز صالح",409);
    const ref={source:hint.related_type==="kosha_booking"?"kosha" as const:"service" as const,id:Number(hint.related_id)};
    const [booking]=await rows(tx,ref.source==="kosha"?sql`SELECT id,status,booking_details AS details FROM kosha_bookings WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`:sql`SELECT id,status,custom_fields AS details FROM service_orders WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`);
    if(!booking)throw new PreparationAssignmentError("الحجز غير موجود أو مؤرشف",404);
    const [task]=await rows(tx,sql`SELECT * FROM tasks WHERE id=${taskId} FOR UPDATE`);
    if(!task||task.archived_at||task.task_type!=="preparation"||task.related_type!==hint.related_type||Number(task.related_id)!==ref.id)throw new PreparationAssignmentError("مرجع المهمة تغيّر؛ حدّث القائمة");
    const meta={...preparationObject(preparationObject(preparationObject(booking.details).bookingOperations).productMeta)};
    assertUniquePreparationTasks(meta);
    const keys=Object.keys(meta).filter(key=>Number(preparationObject(preparationObject(meta[key]).prep).taskId)===taskId);
    if(keys.length!==1)throw new PreparationAssignmentError("ربط المهمة بعنصر التجهيز غير واضح؛ راجع الإدارة");
    const key=keys[0],prep=preparationObject(preparationObject(meta[key]).prep);
    if(!Array.isArray(task.assigned_staff_ids)||task.assigned_staff_ids.length>100||!task.assigned_staff_ids.includes(Number(prep.assigneeId)))throw new PreparationAssignmentError("الموظف المسؤول عن عنصر التجهيز لا يطابق المهمة؛ راجع التعيين");
    if(action==="approve"&&task.completed_by!=null&&Number(task.completed_by)!==Number(prep.assigneeId))throw new PreparationAssignmentError("منجز المهمة لا يطابق التعيين الحالي؛ أعدها للتصحيح قبل الاعتماد");
    const nextStatus=action==="approve"?"completed":"in_progress",review=preparationObject(prep.lastReview);
    if(task.status===nextStatus&&review.action===action&&Number(review.by)===actor.id&&review.reason===reason&&review.version===version(task.updated_at))return {task,replayed:true,notifications:[] as any[]};
    if(["cancelled","canceled","closed","archived"].includes(String(booking.status??"").toLowerCase()))throw new PreparationAssignmentError("الحجز ملغى أو مغلق؛ لا يمكن مراجعة تجهيزه");
    if(action==="reopen"?task.status!=="completed":task.status!=="review")throw new PreparationAssignmentError(action==="reopen"?"يمكن إعادة فتح مهمة مكتملة فقط":"المهمة ليست بانتظار الاعتماد");
    const reviewedAt=new Date().toISOString(),approved=action==="approve";
    const [updated]=await rows(tx,sql`UPDATE tasks SET status=${nextStatus},approved_by=${approved?actor.id:null},approved_at=${approved?reviewedAt:null},rejection_reason=${["reject","return"].includes(action)?reason:null},completed_at=${approved?reviewedAt:null},updated_at=${reviewedAt} WHERE id=${taskId} RETURNING *`);
    if(!updated)throw new PreparationAssignmentError("تعذر حفظ مراجعة المهمة");
    meta[key]={...preparationObject(meta[key]),prep:{...prep,status:approved?"completed":"preparing",completedAt:approved?reviewedAt:null,updatedAt:reviewedAt,lastReview:{action,by:actor.id,reason,version:version(updated.updated_at)}}};
    await savePreparationMeta(tx,ref,meta);
    const type=approved?"task_approved":action==="reopen"?"task_reopened":action==="reject"?"task_rejected":"task_returned";
    const title=approved?"تم اعتماد المهمة":action==="reopen"?"أُعيد فتح المهمة":action==="reject"?"تم رفض المهمة":"أُعيدت المهمة للتصحيح";
    const metadata=JSON.stringify({taskId,key,action,source:ref.source,bookingId:ref.id,from:task.status,to:nextStatus});
    await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata) VALUES(${task.related_type},${ref.id},'preparation_task_review',${title},${reason||null},${actor.id},${actor.name},${metadata}::jsonb)`);
    await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata) VALUES('task',${taskId},${type},${title},${reason||null},${actor.id},${actor.name},${metadata}::jsonb)`);
    const notifications:any[]=[];
    for(const staffId of [...new Set(task.assigned_staff_ids)] as number[]){
      if(!Number.isSafeInteger(staffId)||staffId<=0)throw new PreparationAssignmentError("قائمة موظفي المهمة غير صالحة");
      const [notice]=await rows(tx,sql`INSERT INTO notifications(staff_id,audience_type,type,title,body,entity_type,entity_id,href,metadata) VALUES(${staffId},'staff',${type},${title},${reason?`${task.title} — ${reason}`:task.title},'task',${taskId},'/staff?tab=tasks','{}'::jsonb) RETURNING id,staff_id AS "staffId",audience_type AS "audienceType",type,title,body,entity_type AS "entityType",entity_id AS "entityId",href,metadata`);
      if(!notice)throw Error("Preparation review notification was not inserted");notifications.push(notice);
    }
    return {task:updated,replayed:false,notifications};
  });
}
