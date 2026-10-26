import {PartnershipValidationError} from "./types";

/** Stable source proofs survive jsonb's object-key reordering. Money must be an
 * explicit decimal string; undefined/NaN/Date/BigInt are not hidden as null. */
export function canonicalPartnershipJson(value:unknown):string{
 const ancestors=new Set<object>();
 function normalize(current:unknown):unknown{
  if(current===null||typeof current==="string"||typeof current==="boolean")return current;
  if(typeof current==="number"){
   if(!Number.isSafeInteger(current))throw new PartnershipValidationError("بيانات بصمة المصدر تتطلب أرقاماً صحيحة أو مبالغ نصية دقيقة");
   return current;
  }
  if(typeof current!=="object")throw new PartnershipValidationError("بيانات بصمة المصدر لا تمثل JSON صريحاً");
  if(ancestors.has(current))throw new PartnershipValidationError("بيانات بصمة المصدر دائرية");
  ancestors.add(current);
  try{
   if(Array.isArray(current))return current.map(normalize);
   if(Object.prototype.toString.call(current)!=="[object Object]")throw new PartnershipValidationError("نوع بيانات بصمة المصدر غير صالح");
   return Object.fromEntries(Object.keys(current).sort().map(key=>[key,normalize((current as Record<string,unknown>)[key])]));
  }finally{ancestors.delete(current);}
 }
 return JSON.stringify(normalize(value));
}
