import {sql} from "drizzle-orm";
type Executor={execute(query:any):Promise<any>};
export class PreparationAssignmentError extends Error {constructor(message:string,public status=409){super(message)}}
export function preparationObject(value:unknown):Record<string,any>{if(value==null)return {};if(typeof value!=="object"||Array.isArray(value))throw new PreparationAssignmentError("بيانات سجل التجهيز غير صالحة؛ راجع الحجز قبل التعديل");return value as Record<string,any>}
function preparationTaskId(value:unknown){if(typeof value!=="number"&&(typeof value!=="string"||!/^\s*\d+\s*$/.test(value)))throw new PreparationAssignmentError("مرجع مهمة التجهيز غير صالح");const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw new PreparationAssignmentError("مرجع مهمة التجهيز غير صالح");return id}
/** Include historical/non-live keys: they still own their linked original task.
 * Normalize valid legacy numeric strings before checking identity collisions. */
export function assertUniquePreparationTasks(meta:Record<string,any>){
  const seen=new Set<number>();
  for(const line of Object.values(preparationObject(meta))){const prep=preparationObject(preparationObject(line).prep);if(prep.taskId==null)continue;const id=preparationTaskId(prep.taskId);if(seen.has(id))throw new PreparationAssignmentError("توجد مهمة تجهيز غير صالحة أو مرتبطة بأكثر من عنصر؛ راجع الربط قبل التعيين");seen.add(id);}
}
const rows=async(tx:Executor,q:any)=>{const result=await tx.execute(q);if(!Array.isArray(result?.rows))throw Error("Invalid preparation task query response");return result.rows as any[]};

/** Called with the original booking locked. Uses the existing tasks table and
 * caller transaction; never posts inventory, changes booking staff or costs. */
export async function assignPreparationTask(
  tx:Executor,ref:{entityType:string;id:number},current:Record<string,any>,
  patch:{key:string;itemName?:string;department?:string;assigneeId?:number|null;assigneeName?:string|null;priority?:string;deadline?:string|null},actor:{id:number},
){
  const prep={...preparationObject(current)};
  if(patch.assigneeId===undefined)return prep;
  if(!["kosha_booking","service_order"].includes(ref.entityType)||!Number.isSafeInteger(ref.id)||ref.id<=0)throw new PreparationAssignmentError("مرجع الحجز غير صالح",422);
  let employee:any=null;
  if(patch.assigneeId!==null){
    if(!Number.isSafeInteger(patch.assigneeId)||patch.assigneeId<=0)throw new PreparationAssignmentError("الموظف غير صالح",422);
    [employee]=await rows(tx,sql`SELECT id,full_name FROM staff WHERE id=${patch.assigneeId} AND is_active=true FOR SHARE`);
    if(!employee)throw new PreparationAssignmentError("الموظف غير موجود أو غير فعّال",422);
  }
  let task:any=null;
  if(prep.taskId!=null){
    const taskId=preparationTaskId(prep.taskId);
    [task]=await rows(tx,sql`SELECT id,related_type,related_id,task_type,status,archived_at FROM tasks WHERE id=${taskId} FOR UPDATE`);
    if(!task||task.related_type!==ref.entityType||Number(task.related_id)!==ref.id||task.task_type!=="preparation")throw new PreparationAssignmentError("المهمة لا تتبع عنصر تجهيز هذا الحجز؛ راجع المرجع");
    if(task.archived_at||["completed","approved","cancelled","closed"].includes(String(task.status)))throw new PreparationAssignmentError("المهمة منتهية أو مؤرشفة؛ لا يُعاد تعيينها تلقائياً");
  }
  if(!employee){
    if(task){const updated=await rows(tx,sql`UPDATE tasks SET archived_at=now(),updated_at=now() WHERE id=${task.id} RETURNING id`);if(updated.length!==1)throw new PreparationAssignmentError("تعذر إلغاء تعيين المهمة");}
    return {...prep,assigneeId:null,assigneeName:null,taskId:null};
  }
  const due=patch.deadline!==undefined?patch.deadline:prep.deadline??null;
  const priority=patch.priority??prep.priority??"normal";
  const title=`تجهيز: ${patch.itemName||patch.key}`;
  if(task){
    const updated=await rows(tx,sql`UPDATE tasks SET assigned_staff_ids=${JSON.stringify([employee.id])}::jsonb,title=${title},due_at=${due},priority=${priority},updated_at=now() WHERE id=${task.id} RETURNING id`);
    if(updated.length!==1)throw new PreparationAssignmentError("تعذر تحديث المهمة");
  }else{
    const [created]=await rows(tx,sql`INSERT INTO tasks(title,task_type,department,priority,status,assigned_staff_ids,related_type,related_id,due_at,created_by) VALUES(${title},'preparation',${patch.department??null},${priority},'new',${JSON.stringify([employee.id])}::jsonb,${ref.entityType},${ref.id},${due},${actor.id}) RETURNING id`);
    if(!created?.id)throw new PreparationAssignmentError("تعذر إنشاء مهمة التجهيز");
    prep.taskId=Number(created.id);
  }
  return {...prep,assigneeId:Number(employee.id),assigneeName:String(employee.full_name)};
}
