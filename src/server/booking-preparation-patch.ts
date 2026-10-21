import {assignPreparationTask,preparationObject} from "./booking-preparation-assignment";
export type PreparationPatch={key:string;itemName?:string;department?:string;status?:string;assigneeId?:number|null;assigneeName?:string|null;priority?:string;deadline?:string|null;note?:string|null;purchaseRequested?:boolean};
/** Original per-line JSON metadata. Assignment uses the SAME caller transaction. */
export async function applyPreparationMetadataPatch(tx:{execute(query:any):Promise<any>},ref:{entityType:string;id:number},productMeta:Record<string,any>,patch:PreparationPatch,actor:{id:number}){
  const existing=preparationObject(preparationObject(productMeta)[patch.key]);let prep={...preparationObject(existing.prep)};
  for(const key of ["status","priority","deadline","note"] as const)if(patch[key]!==undefined)prep[key]=patch[key];
  if(patch.purchaseRequested!==undefined){prep.purchaseRequested=patch.purchaseRequested;prep.purchaseRequestedAt=patch.purchaseRequested?new Date().toISOString():null;}
  prep=await assignPreparationTask(tx,ref,prep,patch,actor);
  prep.updatedAt=new Date().toISOString();
  return {...productMeta,[patch.key]:{...existing,prep}};
}
