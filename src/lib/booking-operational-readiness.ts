export type BookingOperationRef = {source:"kosha"|"service";id:number};
export type ReadinessCheck = {
  id:string; category:string; label:string; mandatory:boolean; applicable:boolean;
  state:"pass"|"fail"|"unknown"; reason:string; href:string;
};
export type BookingOperationalReadiness = {
  status:"not_ready"|"needs_followup"|"ready";
  percentage:number|null;
  checks:ReadinessCheck[]; blockers:ReadinessCheck[];
  categories:Record<string,{total:number;passed:number;percentage:number}>;
};
export type BookingReadinessSummary=Pick<BookingOperationalReadiness,"status"|"percentage"> & {generatedAt?:string};

/** Evidence only. Payment, contract value and workflow labels are not inputs. */
export function evaluateBookingReadiness(input:readonly ReadinessCheck[]):BookingOperationalReadiness {
  const ids=new Set<string>();
  const categories:BookingOperationalReadiness["categories"]=Object.create(null);
  const checks=input.map(c=>{
    if(!c.id?.trim() || !c.category?.trim() || !c.label?.trim() || typeof c.reason!=="string" || typeof c.href!=="string"
      || typeof c.mandatory!=="boolean" || typeof c.applicable!=="boolean" || !["pass","fail","unknown"].includes(c.state)) throw new Error("Invalid readiness check");
    if(ids.has(c.id)) throw new Error("Duplicate readiness check");
    ids.add(c.id);
    // Only operational DTO fields cross into the public read model.
    return {id:c.id,category:c.category,label:c.label,mandatory:c.mandatory,applicable:c.applicable,state:c.state,reason:c.reason,href:c.href};
  });
  for(const c of checks) {
    if(!c.applicable) continue;
    const group=categories[c.category] ??= {total:0,passed:0,percentage:0};
    group.total++;if(c.state==="pass") group.passed++;
    group.percentage=Math.round(group.passed/group.total*100);
  }
  const applicable=checks.filter(c=>c.applicable);
  const mandatory=applicable.filter(c=>c.mandatory);
  const blockers=mandatory.filter(c=>c.state!=="pass");
  return {status:!mandatory.length || blockers.length ? "not_ready" : applicable.some(c=>c.state!=="pass") ? "needs_followup" : "ready",
    percentage:applicable.length ? Math.round(applicable.filter(c=>c.state==="pass").length/applicable.length*100) : null,
    checks,blockers,categories:{...categories}};
}
