import {loadDailyOperations} from "./booking-daily-operations";
import {parseDailyOperationsFilters} from "@/lib/booking-daily-operations";
import type {BookingOperationRef,BookingOperationalReadiness} from "@/lib/booking-operational-readiness";

export type BookingReadiness = BookingOperationalReadiness & {generatedAt:string};

/** Caller authorizes every ref first. Uses the same original evidence as the
 * daily room; no persisted score, finance reads, schema initialization or writes. */
export async function loadBookingReadiness(executor:{execute:(sql:any)=>Promise<any>},refs:readonly BookingOperationRef[],now=new Date()) {
  if(refs.length>1000) throw new Error("Readiness reference limit exceeded");
  if(refs.some(ref=>!["kosha","service"].includes(ref.source) || !Number.isSafeInteger(ref.id) || ref.id<=0)) throw new Error("Invalid readiness reference");
  const unique=[...new Map(refs.map(ref=>[`${ref.source}:${ref.id}`,ref])).values()];
  const result=new Map<string,BookingReadiness>();
  if(!unique.length) return result;
  const data=await loadDailyOperations(executor,parseDailyOperationsFilters(new URLSearchParams()),[...new Set(unique.map(ref=>ref.source))],now,unique);
  const allowed=new Set(unique.map(ref=>`${ref.source}:${ref.id}`));
  for(const row of data.rows) if(allowed.has(row.key)) result.set(row.key,{...row.readiness,generatedAt:data.generatedAt});
  return result;
}
