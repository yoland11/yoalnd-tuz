import {sql} from "drizzle-orm";
import {PreparationAssignmentError,assertUniquePreparationTasks} from "./booking-preparation-assignment";
import {savePreparationMeta} from "./booking-preparation-update";
type Ref={source:"kosha"|"service";id:number};
type Executor={execute(query:any):Promise<any>};
type Database=Executor&{transaction<T>(fn:(tx:Executor)=>Promise<T>):Promise<T>};
export type PreparationBatchPatch={priority?:string;deadline?:string|null;note?:string|null;assigneeId?:number|null};
export type BookingBulkRequest={requestId:string;refs:Ref[];patch:PreparationBatchPatch};
export class BookingBulkError extends Error{constructor(message:string,public status=409){super(message)}}
type Dependencies={
  preparation(tx:Executor,ref:Ref):Promise<{items:{key:string;name?:string;department?:string}[]}|null>;
  patch(tx:Executor,ref:Ref&{entityType:string;details:any;operations:any},meta:Record<string,any>,patch:PreparationBatchPatch&{key:string;itemName?:string;department?:string}):Promise<Record<string,any>>;
  log(context:{requestId:string;source:string;bookingId:number;actorId:number;errorType:string;errorCode:string|null}):void;
};
const rows=async(tx:Executor,query:any)=>{const result=await tx.execute(query);if(!Array.isArray(result?.rows))throw Error("Invalid booking batch query response");return result.rows as any[]};
function object(value:any,label:string):Record<string,any>{if(value==null)return {};if(typeof value!=="object"||Array.isArray(value))throw new BookingBulkError(`سجل ${label} غير صالح؛ لم تُعدّل البيانات`);return value}

/** Original preparation metadata/tasks only; no stages, stock, money or approvals. */
export async function runBookingBulkOperation(database:Database,actor:{id:number;name:string;canManage:boolean},request:BookingBulkRequest,deps:Dependencies){
  if(!actor.canManage||!Number.isSafeInteger(actor.id)||actor.id<=0)throw new BookingBulkError("ليس لديك صلاحية إدارة التجهيز الجماعي",403);
  if(typeof request.requestId!=="string"||request.requestId.length<8||request.requestId.length>100||!Array.isArray(request.refs)||!request.refs.length||request.refs.length>50)throw new BookingBulkError("اختر من 1 إلى 50 حجزاً مع رمز محاولة صحيح",422);
  if(request.refs.some(r=>!["kosha","service"].includes(r.source)||!Number.isSafeInteger(r.id)||r.id<=0)||new Set(request.refs.map(r=>`${r.source}:${r.id}`)).size!==request.refs.length)throw new BookingBulkError("قائمة الحجوزات غير صحيحة أو مكررة",422);
  const patch=request.patch;
  if(!patch||typeof patch!=="object"||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!["priority","deadline","note","assigneeId"].includes(k))
    ||patch.assigneeId!==undefined&&patch.assigneeId!==null&&(!Number.isSafeInteger(patch.assigneeId)||patch.assigneeId<=0)
    ||patch.priority!==undefined&&!["normal","important","urgent"].includes(patch.priority)
    ||patch.note!==undefined&&patch.note!==null&&(typeof patch.note!=="string"||patch.note.length>1000)
    ||patch.deadline!==undefined&&patch.deadline!==null&&(typeof patch.deadline!=="string"||!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(patch.deadline)||!Number.isFinite(new Date(patch.deadline).getTime())))throw new BookingBulkError("حقول التجهيز غير صالحة",422);
  const normalized={...(patch.priority!==undefined?{priority:patch.priority}:{}),...(patch.deadline!==undefined?{deadline:patch.deadline}:{}),...(patch.note!==undefined?{note:patch.note}: {}),...(patch.assigneeId!==undefined?{assigneeId:patch.assigneeId}:{})};
  const fingerprint=JSON.stringify(normalized);
  const results:Array<Ref&{status:"success"|"failed";replayed?:boolean;updated?:number;message?:string;httpStatus?:number;requestId:string}>=[];
  for(const ref of request.refs){
    const entityType=ref.source==="kosha"?"kosha_booking":"service_order";
    try{
      const result=await database.transaction(async tx=>{
        const [booking]=await rows(tx,ref.source==="kosha"?sql`SELECT id,status,booking_details AS details FROM kosha_bookings WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`:sql`SELECT id,status,custom_fields AS details FROM service_orders WHERE id=${ref.id} AND archived_at IS NULL FOR UPDATE`);
        if(!booking)throw new BookingBulkError("الحجز غير موجود أو مؤرشف",404);
        const [previous]=await rows(tx,sql`SELECT actor_id,metadata FROM entity_timeline WHERE entity_type=${entityType} AND entity_id=${ref.id} AND type='booking_preparation_batch' AND metadata->>'requestId'=${request.requestId} ORDER BY id LIMIT 1`);
        if(previous){if(Number(previous.actor_id)!==actor.id||previous.metadata?.fingerprint!==fingerprint)throw new BookingBulkError("رمز المحاولة مستخدم لموظف أو حقول مختلفة");return {replayed:true,updated:Number(previous.metadata.updated)}}
        if(["cancelled","canceled","completed","delivered","returned","closed","archived"].includes(String(booking.status).toLowerCase()))throw new BookingBulkError("الحجز ملغى أو مغلق؛ لا يمكن تعديل تجهيزه جماعياً");
        const details=object(booking.details,"الحجز"),operations=object(details.bookingOperations,"العمليات");
        const originalMeta=object(operations.productMeta,"التجهيز");
        const preparation=await deps.preparation(tx,ref);
        if(!preparation||!Array.isArray(preparation.items))throw new BookingBulkError("تعذر قراءة عناصر التجهيز الأصلية");
        const keys=[...new Set(preparation.items.map(i=>i.key))];
        if(!keys.length||keys.length>500||keys.some(k=>typeof k!=="string"||!k))throw new BookingBulkError("الحجز لا يحتوي عناصر تجهيز صالحة أو تجاوز حد 500 عنصر",422);
        let meta={...originalMeta};
        if(normalized.assigneeId!==undefined)assertUniquePreparationTasks(originalMeta);
        for(const key of keys){const item=preparation.items.find(i=>i.key===key)!;meta=await deps.patch(tx,{...ref,entityType,details,operations},meta,{key,itemName:item.name,department:item.department,...normalized});}
        await savePreparationMeta(tx,ref,meta);
        await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata) VALUES(${entityType},${ref.id},'booking_preparation_batch','تحديث جماعي لحقول التجهيز','تجهيز / تعيين مهام العناصر؛ دون تغيير المخزون أو مراحل الحجز',${actor.id},${actor.name},${JSON.stringify({requestId:request.requestId,fingerprint,updated:keys.length})}::jsonb)`);
        return {replayed:false,updated:keys.length};
      });
      results.push({...ref,status:"success",requestId:request.requestId,...result});
    }catch(cause){
      if(cause instanceof BookingBulkError||cause instanceof PreparationAssignmentError)results.push({...ref,status:"failed",httpStatus:cause.status,message:cause.message,requestId:request.requestId});
      else{
        const failure=cause&&typeof cause==="object"?cause as {name?:unknown;code?:unknown}:{};
        const errorType=typeof failure.name==="string"&&/^[A-Za-z][\w.]{0,79}$/.test(failure.name)?failure.name:"UnknownError";
        const errorCode=typeof failure.code==="string"&&/^(?:[0-9A-Z]{5}|E[A-Z_]{2,31})$/.test(failure.code)?failure.code:null;
        deps.log({requestId:request.requestId,source:ref.source,bookingId:ref.id,actorId:actor.id,errorType,errorCode});
        results.push({...ref,status:"failed",httpStatus:503,message:"تعذر حفظ الحجز؛ أعد نفس المحاولة دون تغيير الحقول",requestId:request.requestId});
      }
    }
  }
  return {requestId:request.requestId,results};
}
