export type StaffPreparationTask={
  id:number;title:string;taskType?:string;status:string;relatedType:string|null;relatedId:number|null;
  department?:string|null;customerName?:string|null;assignedStaffIds?:number[];archivedAt?:string|null;
};

/** View-only projection of the original authorized dashboard response. This is
 * not an equipment availability calculation or a new permission boundary. */
export function staffPreparationGroups<T extends StaffPreparationTask>(tasks:readonly T[],actorId:number){
  const groups=new Map<string,{key:string;source:'kosha'|'service';department:string;customerName:string|null;tasks:T[]}>();
  const seen=new Set<number>();
  for(const task of tasks){
    if(task.taskType!=='preparation'||!task.assignedStaffIds?.includes(actorId)||task.archivedAt||['cancelled','canceled','closed','archived','deleted'].includes(task.status)||!Number.isSafeInteger(task.id)||task.id<=0||!Number.isSafeInteger(task.relatedId)||Number(task.relatedId)<=0||!['kosha_booking','service_order'].includes(task.relatedType??'')||seen.has(task.id))continue;
    seen.add(task.id);
    const source=task.relatedType==='kosha_booking'?'kosha':'service',department=task.department?.trim()||'other';
    const key=JSON.stringify([source,task.relatedId,department]);
    if(!groups.has(key))groups.set(key,{key,source,department,customerName:task.customerName?.trim()||null,tasks:[]});
    groups.get(key)!.tasks.push(task);
  }
  return [...groups.values()].map(group=>{
    const approved=group.tasks.filter(task=>task.status==='completed').length;
    const review=group.tasks.filter(task=>task.status==='review').length;
    return {...group,approved,review,active:group.tasks.length-approved-review,percentage:Math.round(approved/group.tasks.length*100)};
  });
}
