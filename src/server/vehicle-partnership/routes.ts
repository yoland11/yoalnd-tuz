import {PartnershipValidationError} from "../../lib/vehicle-partnership/types";
import {z} from "zod/v4";
import {PartnershipRepositoryError} from "./repository";
import {readVehicleActivity} from "./activity";
import {readPartnershipWorkspace} from "./workspace";
import {submitPartnershipActivity,type PartnershipFinancialRequestWriter} from "./accounting";
import {submitPartnershipDriverAccrual} from "./driver";
import {requestPartnershipDriverPayment} from "./driver-payments";
import {requestPartnerDistribution} from "./distributions";
import {requestPartnerAdvancePayment} from "./advance-payments";
import {submitPartnershipCost} from "./costing";
import {closingPolicySchema,previewClosing} from "./closing";
import {saveClosingDraft,transitionClosing} from "./closing-lifecycle";
import {authorizePartnership,readVehiclePartnership,saveVehicleAgreement,approveVehicleAgreement,rejectVehicleAgreement,searchPartnershipParties,type PartnershipActor,type PartnershipDatabase} from "./agreements";

export type PartnershipRequest={method:string;parts:readonly string[];query:URLSearchParams;readBody:()=>Promise<unknown>};
function pathId(value:string|undefined):number{
 if(!value||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw new PartnershipValidationError("معرّف المركبة أو الاتفاق غير صالح");
 return Number(value);
}
async function readObject(request:PartnershipRequest):Promise<Record<string,unknown>>{
 let value:unknown;try{value=await request.readBody();}catch(cause){if(cause instanceof SyntaxError)throw new PartnershipValidationError("صيغة الطلب غير صالحة");throw cause;}
 if(!value||typeof value!=="object"||Array.isArray(value))throw new PartnershipValidationError("بيانات الطلب غير صالحة");return value as Record<string,unknown>;
}
/** Only the narrow extension of the EXISTING enterprise vehicles endpoint.
 * Original vehicle CRUD, booking, expense and approval routes are untouched. */
export async function handleVehiclePartnershipRequest(db:PartnershipDatabase,actor:PartnershipActor,request:PartnershipRequest,writer?:PartnershipFinancialRequestWriter|null){
 const {parts,method}=request;
 if(parts[0]!=="vehicles"||parts[2]!=="partnership")return null;
 authorizePartnership(actor);const vehicleId=pathId(parts[1]);
 if(parts.length===3){
  if(method!=="GET")throw new PartnershipRepositoryError("هذا المسار للعرض فقط",405,"METHOD_NOT_ALLOWED");
  return {data:await readVehiclePartnership(db,actor,vehicleId),status:200};
 }
 if(parts[3]==="parties"&&parts.length===4){
  if(method!=="GET")throw new PartnershipRepositoryError("هذا المسار للبحث فقط",405,"METHOD_NOT_ALLOWED");
  return {data:await searchPartnershipParties(db,actor,vehicleId,{kind:request.query.get("kind"),query:request.query.get("q")??""}),status:200};
 }
 if(parts[3]==="activity"&&parts.length===4){
  if(method==="POST"){
   if(!writer)throw new PartnershipRepositoryError("مسار الطلب المالي غير متاح",503,"SETUP_REQUIRED");
   return {data:await submitPartnershipActivity(db,actor,vehicleId,await readObject(request),writer),status:201};
  }
  if(method!=="GET")throw new PartnershipRepositoryError("نشاط المركبة للعرض فقط",405,"METHOD_NOT_ALLOWED");
  return {data:await readVehicleActivity(db,actor,{vehicleId,from:request.query.get("from"),to:request.query.get("to")}),status:200};
 }
 if(parts[3]==="workspace"&&parts.length===4){
  if(method!=="GET")throw new PartnershipRepositoryError("مساحة الشراكة للعرض فقط",405,"METHOD_NOT_ALLOWED");
  return {data:await readPartnershipWorkspace(db,actor,vehicleId,{from:request.query.get("from"),to:request.query.get("to")}),status:200};
 }
 if(parts.length===4&&["driver-accrual","driver-payments","distributions","advance-payments","costs"].includes(parts[3])){
  if(method!=="POST")throw new PartnershipRepositoryError("طريقة الطلب غير متاحة",405,"METHOD_NOT_ALLOWED");
  if(!writer)throw new PartnershipRepositoryError("مسار الطلب المالي غير متاح",503,"SETUP_REQUIRED");
  const body=await readObject(request);
  if(parts[3]==="costs")return {data:await submitPartnershipCost(db,actor,vehicleId,body,writer),status:201};
  const data=parts[3]==="driver-accrual"?await submitPartnershipDriverAccrual(db,actor,vehicleId,body,writer):parts[3]==="driver-payments"?await requestPartnershipDriverPayment(db,actor,vehicleId,body,writer):parts[3]==="advance-payments"?await requestPartnerAdvancePayment(db,actor,vehicleId,body,writer):await requestPartnerDistribution(db,actor,vehicleId,body,writer);
  return {data,status:201};
 }
 if(parts[3]==="closings"&&parts.length===5&&["preview","draft","transition"].includes(parts[4])){
  if(method!=="POST")throw new PartnershipRepositoryError("طريقة الإغلاق غير متاحة",405,"METHOD_NOT_ALLOWED");
  const body=await readObject(request);
  if(parts[4]==="preview"){
   const parsed=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),policy:closingPolicySchema.optional()}).strict().safeParse(body);
   if(!parsed.success)throw new PartnershipValidationError(parsed.error.issues.map(i=>i.message).join("؛ "));
   return {data:await db.transaction(tx=>previewClosing(tx,actor,vehicleId,parsed.data.month,parsed.data.policy)),status:200};
  }
  if(parts[4]==="draft")return {data:await saveClosingDraft(db,actor,vehicleId,body),status:201};
  if(!writer)throw new PartnershipRepositoryError("مسار الطلب المالي غير متاح",503,"SETUP_REQUIRED");
  return {data:await transitionClosing(db,actor,vehicleId,body,writer),status:201};
 }
 if(parts[3]==="agreements"&&parts.length===4){
  if(method!=="POST")throw new PartnershipRepositoryError("طريقة الطلب غير متاحة",405,"METHOD_NOT_ALLOWED");
  return {data:await saveVehicleAgreement(db,actor,vehicleId,await readObject(request)),status:201};
 }
 if(parts[3]==="agreements"&&(parts[5]==="approve"||parts[5]==="reject")&&parts.length===6){
  authorizePartnership(actor,true);
  if(method!=="POST")throw new PartnershipRepositoryError("طريقة الطلب غير متاحة",405,"METHOD_NOT_ALLOWED");
  const agreementId=pathId(parts[4]),value=await readObject(request);
  if("agreementId" in value)throw new PartnershipValidationError("معرّف الاتفاق يُؤخذ من المسار فقط");
  const run=parts[5]==="approve"?approveVehicleAgreement:rejectVehicleAgreement;
  return {data:await run(db,actor,vehicleId,{...value,agreementId}),status:200};
 }
 throw new PartnershipRepositoryError("مسار شراكة المركبة غير موجود",404,"NOT_FOUND");
}
