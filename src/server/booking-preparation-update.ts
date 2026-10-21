import {sql} from "drizzle-orm";
import {applyPreparationMetadataPatch,type PreparationPatch} from "./booking-preparation-patch";
import {PreparationAssignmentError,assertUniquePreparationTasks} from "./booking-preparation-assignment";
import {normalizeQuantityLine} from "../lib/quantity-assets";
type Ref={source:"kosha"|"service";id:number};
type Executor={execute(query:any):Promise<any>};
type Database={transaction<T>(fn:(tx:Executor)=>Promise<T>):Promise<T>};
export type PreparationGroupCommand={department:string;command:"start"|"confirm";requestId:string};
type PreparationUpdateItem={key:string;name?:string;department?:string;kind?:string;productId?:number|null;required?:number;shortfall?:number;status?:string;preparationState?:string|null;stockIssued?:boolean;manual?:boolean;infoOnly?:boolean};
const rows=async(tx:Executor,q:any)=>{const result=await tx.execute(q);if(!Array.isArray(result?.rows))throw Error("Invalid preparation update query response");return result.rows as any[]};
function object(value:any){if(value==null)return {};if(typeof value!=="object"||Array.isArray(value))throw new PreparationAssignmentError("بيانات التجهيز غير صالحة؛ راجع الحجز");return value as Record<string,any>}
export async function savePreparationMeta(tx:Executor,ref:Ref,meta:Record<string,any>){
  const data=JSON.stringify(meta);
  const updated=await rows(tx,ref.source==="kosha"?sql`
    UPDATE kosha_bookings SET booking_details=jsonb_set(coalesce(nullif(booking_details,'null'::jsonb),'{}'::jsonb),'{bookingOperations}',coalesce(nullif(booking_details->'bookingOperations','null'::jsonb),'{}'::jsonb)||jsonb_build_object('productMeta',${data}::jsonb)),updated_at=now() WHERE id=${ref.id} AND archived_at IS NULL RETURNING id`:sql`
    UPDATE service_orders SET custom_fields=jsonb_set(coalesce(nullif(custom_fields,'null'::jsonb),'{}'::jsonb),'{bookingOperations}',coalesce(nullif(custom_fields->'bookingOperations','null'::jsonb),'{}'::jsonb)||jsonb_build_object('productMeta',${data}::jsonb)) WHERE id=${ref.id} AND archived_at IS NULL RETURNING id`);
  if(updated.length!==1)throw new PreparationAssignmentError("تعذر حفظ تجهيز الحجز");
}

/** Shared by the original single/bulk-item routes. Serializes against the new
 * cross-booking batch writer and commits original tasks + metadata + audit once. */
export async function updatePreparationItems(database:Database,ref:Ref,actor:{id:number;name:string},keys:readonly string[],patch:Omit<PreparationPatch,"key">,preparation:(tx:Executor,ref:Ref)=>Promise<{items:PreparationUpdateItem[]}|null>,group?:PreparationGroupCommand){
  if(!["kosha","service"].includes(ref.source)||!Number.isSafeInteger(ref.id)||ref.id<=0||!keys.length||keys.length>500||new Set(keys).size!==keys.length)throw new PreparationAssignmentError("قائمة عناصر التجهيز غير صالحة",422);
  if(group&&(typeof group.department!=="string"||!group.department||group.department.length>40||!["start","confirm"].includes(group.command)||typeof group.requestId!=="string"||group.requestId.length<8||group.requestId.length>100||Object.keys(patch).some(k=>k!=="status")||patch.status!==(group.command==="start"?"preparing":"ready")))throw new PreparationAssignmentError("أمر مجموعة التجهيز غير صالح",422);
  return database.transaction(async tx=>{
    const [booking]=await rows(tx,ref.source==="kosha"?sql`SELECT id,status,booking_details AS details FROM kosha_bookings WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`:sql`SELECT id,status,custom_fields AS details FROM service_orders WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`);
    if(!booking)throw new PreparationAssignmentError("الحجز غير موجود أو مؤرشف",404);
    const entityType=ref.source==="kosha"?"kosha_booking":"service_order";
    const fingerprint=group?JSON.stringify({department:group.department,command:group.command,keys:[...keys].sort()}):null;
    if(group){const [previous]=await rows(tx,sql`SELECT actor_id,metadata FROM entity_timeline WHERE entity_type=${entityType} AND entity_id=${ref.id} AND type='preparation_group_updated' AND metadata->>'requestId'=${group.requestId} ORDER BY id LIMIT 1`);if(previous){if(Number(previous.actor_id)!==actor.id||previous.metadata?.fingerprint!==fingerprint)throw new PreparationAssignmentError("رمز المحاولة مستخدم لمجموعة أو موظف مختلف");return {ok:true,updated:Number(previous.metadata.updated),replayed:true};}}
    if(["cancelled","canceled","closed","archived"].includes(String(booking.status??"").toLowerCase()))throw new PreparationAssignmentError("الحجز ملغى أو مغلق؛ لا يمكن تعديل التجهيز");
    if(group&&["completed","delivered","returned"].includes(String(booking.status??"").toLowerCase()))throw new PreparationAssignmentError("الحجز مكتمل؛ لا يُعاد تأكيد تجهيزه تاريخياً");
    const details=object(booking.details),ops=object(details.bookingOperations);let meta={...object(ops.productMeta)};
    const summary=await preparation(tx,ref);
    if(!summary||!Array.isArray(summary.items))throw new PreparationAssignmentError("تعذر قراءة عناصر التجهيز");
    const indexed=new Map(summary.items.map(i=>[i.key,i]));
    if(keys.some(key=>!indexed.has(key)))throw new PreparationAssignmentError("عنصر التجهيز لم يعد مرتبطاً بالحجز؛ حدّث القائمة",422);
    if(patch.assigneeId!==undefined||group)assertUniquePreparationTasks(meta);
    const completedTasks=new Set<number>();
    if(group){
      if(keys.some(key=>indexed.get(key)!.department!==group.department||indexed.get(key)!.infoOnly))throw new PreparationAssignmentError("العناصر لا تتبع مجموعة التجهيز المحددة");
      // Consumption bypasses only a fresh-stock demand, never unresolved problems.
      if(keys.some(key=>["damaged","lost"].includes(object(object(meta[key]).prep).status)))throw new PreparationAssignmentError("عالج التلف أو الفقد من مساره الأصلي قبل تحديث المجموعة");
      if(group.command==="start"&&keys.some(key=>["damaged","lost"].includes(indexed.get(key)!.status??"")))throw new PreparationAssignmentError("عالج التلف أو الفقد من مساره الأصلي قبل بدء المجموعة");
      if(group.command==="start"&&keys.some(key=>meta[key]?.prep?.status==="completed"||indexed.get(key)!.status==="completed"||indexed.get(key)!.preparationState==="completed"||indexed.get(key)!.stockIssued))throw new PreparationAssignmentError("لا يُعاد بدء عنصر مكتمل أو معتمد؛ راجع مساره الأصلي أولاً");
      if(group.command==="confirm"){
        for(const key of keys){const item=indexed.get(key)!;
          if(!item.stockIssued&&(!Number.isFinite(item.shortfall)||Number(item.shortfall)>0)||["damaged","lost","shortage","needs_purchase","reserved_elsewhere","unavailable"].includes(item.status??""))throw new PreparationAssignmentError(`لا يمكن تأكيد المجموعة؛ راجع النقص أو حالة ${item.name||key}`);
          if(item.kind==="asset"&&!item.manual){
            if(ops.assets!=null&&!Array.isArray(ops.assets))throw new PreparationAssignmentError("قائمة معدات المجموعة غير صالحة");
            const asset=(ops.assets??[]).find((a:any)=>Number(a?.productId)===item.productId),physical=normalizeQuantityLine(asset);
            if(!asset||physical.requiredQty<=0||physical.preparedQty<physical.requiredQty||!["picked","out","returned","inspection","completed"].includes(physical.stage)||asset.problem&&asset.problem!=="none"||physical.returnedDamagedQty>0||physical.missingQty>0)throw new PreparationAssignmentError(`أكمل تجهيز الأصل من مساره الأصلي أولاً: ${item.name||key}`);
          }
        }
        const taskIds=[...new Set(keys.map(key=>meta[key]?.prep?.taskId).filter(id=>id!=null).map(Number))].sort((a,b)=>a-b);
        if(taskIds.length){const taskRows=await rows(tx,sql`SELECT id,related_type,related_id,task_type,status,assigned_staff_ids,archived_at FROM tasks WHERE id IN (${sql.join(taskIds.map(id=>sql`${id}`),sql`,`)}) ORDER BY id FOR UPDATE`);const byId=new Map(taskRows.map(t=>[Number(t.id),t]));
          for(const key of keys){const prep=object(meta[key]?.prep);if(prep.taskId==null)continue;const task=byId.get(Number(prep.taskId));if(!task||task.archived_at||task.related_type!==entityType||Number(task.related_id)!==ref.id||task.task_type!=="preparation"||task.status!=="completed"||!Array.isArray(task.assigned_staff_ids)||!task.assigned_staff_ids.includes(Number(prep.assigneeId)))throw new PreparationAssignmentError(`انتظر اعتماد مهمة التجهيز أو راجع تعيينها: ${indexed.get(key)!.name||key}`);completedTasks.add(Number(task.id));}
        }
      }
    }
    for(const key of keys){const item=indexed.get(key)!;const status=group?.command==="confirm"&&completedTasks.has(Number(meta[key]?.prep?.taskId))?"completed":patch.status;meta=await applyPreparationMetadataPatch(tx,{entityType,id:ref.id},meta,{...patch,status,key,itemName:item.name,department:item.department},actor);}
    await savePreparationMeta(tx,ref,meta);
    await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata) VALUES(${entityType},${ref.id},${group?"preparation_group_updated":"preparation_bulk_updated"},'تحديث تجهيز الحجز',${`${keys.length} عنصر`},${actor.id},${actor.name},${JSON.stringify({keys,status:patch.status??null,assigneeId:patch.assigneeId??null,...(group?{requestId:group.requestId,fingerprint,department:group.department,command:group.command,updated:keys.length}:{})})}::jsonb)`);
    return {ok:true,updated:keys.length};
  });
}

/** The staff portal's original completion action, same booking→task lock order
 * as assignment. A concurrent reassignment is rechecked after acquiring locks. */
export async function completePreparationTask(database:Database,taskId:number,actor:{id:number;name:string;manager:boolean}){
  if(!Number.isSafeInteger(taskId)||taskId<=0)throw new PreparationAssignmentError("المهمة غير صالحة",422);
  return database.transaction(async tx=>{
    const [hint]=await rows(tx,sql`SELECT id,related_type,related_id,task_type,status,archived_at,assigned_staff_ids FROM tasks WHERE id=${taskId}`);
    if(!hint||hint.task_type!=="preparation"||!["kosha_booking","service_order"].includes(hint.related_type))throw new PreparationAssignmentError("المهمة غير موجودة",404);
    const mine=(task:any)=>Array.isArray(task.assigned_staff_ids)&&task.assigned_staff_ids.includes(actor.id);
    if(!actor.manager&&!mine(hint))throw new PreparationAssignmentError("هذه المهمة غير مسندة إليك",403);
    const ref:Ref={source:hint.related_type==="kosha_booking"?"kosha":"service",id:Number(hint.related_id)};
    const [booking]=await rows(tx,ref.source==="kosha"?sql`SELECT id,status,booking_details AS details FROM kosha_bookings WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`:sql`SELECT id,status,custom_fields AS details FROM service_orders WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`);
    if(!booking)throw new PreparationAssignmentError("الحجز غير موجود أو مؤرشف",404);
    const [task]=await rows(tx,sql`SELECT id,related_type,related_id,task_type,status,archived_at,assigned_staff_ids FROM tasks WHERE id=${taskId} FOR UPDATE`);
    if(!task||task.related_type!==hint.related_type||Number(task.related_id)!==ref.id||task.task_type!=="preparation"||task.archived_at)throw new PreparationAssignmentError("مرجع المهمة تغيّر أو أُرشف؛ حدّث القائمة");
    if(!actor.manager&&!mine(task))throw new PreparationAssignmentError("هذه المهمة لم تعد مسندة إليك",403);
    const meta={...object(object(object(booking.details).bookingOperations).productMeta)};
    assertUniquePreparationTasks(meta);
    const keys=Object.keys(meta).filter(key=>Number(object(object(meta[key]).prep).taskId)===taskId);
    if(keys.length!==1)throw new PreparationAssignmentError("ربط المهمة بعنصر التجهيز غير واضح؛ راجع الإدارة");
    const key=keys[0],prep=object(object(meta[key]).prep);
    if(!actor.manager&&Number(prep.assigneeId)!==actor.id)throw new PreparationAssignmentError("عنصر التجهيز لم يعد مسنداً إليك",403);
    if(task.status==="completed"&&prep.status==="completed")return {ok:true,replayed:true};
    if(["cancelled","canceled","closed","archived"].includes(String(booking.status??"").toLowerCase())||["approved","cancelled","closed"].includes(String(task.status)))throw new PreparationAssignmentError("المهمة أو الحجز مغلق؛ لا يمكن تأكيد التجهيز");
    meta[key]={...object(meta[key]),prep:{...prep,status:"completed",completedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}};
    const updated=await rows(tx,sql`UPDATE tasks SET status='completed',completed_by=${actor.id},completed_at=now(),updated_at=now() WHERE id=${taskId} RETURNING id`);
    if(updated.length!==1)throw new PreparationAssignmentError("تعذر تأكيد المهمة");
    await savePreparationMeta(tx,ref,meta);
    await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata) VALUES(${task.related_type},${ref.id},'preparation_item_done','تم تجهيز عنصر (الكادر)','تأكيد الموظف؛ دون صرف مخزون',${actor.id},${actor.name},${JSON.stringify({taskId,staffId:actor.id,key})}::jsonb)`);
    return {ok:true,replayed:false};
  });
}
