import {sql,type SQLWrapper} from "drizzle-orm";
function object(value:any):Record<string,any>{if(value==null)return {};if(typeof value!=="object"||Array.isArray(value))throw Error("بيانات عمليات الحجز غير صالحة؛ لم يتم استبدالها");return value}
function preparationDelta(patch:Record<string,any>,baseline?:Record<string,any>){
  const changes:Record<string,any>={};if(!baseline)return changes;
  const before=object(baseline.productMeta),after=object(object(patch.bookingOperations).productMeta);
  for(const [key,line] of Object.entries(after)){
    if(!line?.prep)continue;
    const old=object(before[key]?.prep),next=object(line.prep),delta:Record<string,any>={};
    for(const [field,value] of Object.entries(next))if(JSON.stringify(old[field])!==JSON.stringify(value))delta[field]=value;
    if(Object.keys(delta).length)changes[key]=delta;
  }
  return changes;
}
/** Contract used by the atomic SQL projection below (also suitable for previews). */
export function mergeBookingOperationalEvidence(current:any,patch:any,baselineOperations?:Record<string,any>){
  const live=object(current),incoming=object(patch),result={...live,...incoming};
  if(!Object.hasOwn(live,"bookingOperations")&&!Object.hasOwn(incoming,"bookingOperations"))return result;
  const before=object(live.bookingOperations),proposed=object(incoming.bookingOperations),ops={...before,...proposed};
  delete ops.loading;if(Object.hasOwn(before,"loading"))ops.loading=before.loading;
  delete ops.resourceWindow;if(Object.hasOwn(before,"resourceWindow"))ops.resourceWindow=before.resourceWindow;
  delete ops.transportPlan;if(Object.hasOwn(before,"transportPlan"))ops.transportPlan=before.transportPlan;
  if(before.transportPlan!=null){delete ops.transportation;if(Object.hasOwn(before,"transportation"))ops.transportation=before.transportation}
  const existingMeta=object(before.productMeta),meta={...object(proposed.productMeta??before.productMeta)},delta=preparationDelta(incoming,baselineOperations);
  for(const [key,line] of Object.entries(existingMeta))if(line?.prep!=null)meta[key]={...object(meta[key]),prep:{...object(line.prep),...delta[key]}};
  if(Object.hasOwn(before,"productMeta")||Object.hasOwn(proposed,"productMeta"))ops.productMeta=meta;
  return {...result,bookingOperations:ops};
}

/**
 * Evaluated against the row at UPDATE time, after PostgreSQL's row lock wait.
 * Full/old form snapshots cannot overwrite live loading receipts or unrelated
 * preparation leaves. Only the canonical preparation writer supplies a baseline
 * to express intentional prep edits; other writers preserve live prep evidence.
 * No schema, status, financial, inventory or portal-audit formula changes.
 */
export function bookingEvidenceWriteSql(column:SQLWrapper,patch:Record<string,any>,baselineOperations?:Record<string,any>){
  object(patch);const delta=preparationDelta(patch,baselineOperations);
  const incoming={...patch};if(incoming.bookingOperations!=null){incoming.bookingOperations={...object(incoming.bookingOperations)};delete incoming.bookingOperations.loading;delete incoming.bookingOperations.resourceWindow;delete incoming.bookingOperations.transportPlan}
  return sql`(
    SELECT w.live || w.patch || CASE WHEN w.live ? 'bookingOperations' OR w.patch ? 'bookingOperations' THEN
      jsonb_build_object('bookingOperations', o.live_ops ||
        CASE WHEN o.live_ops->'transportPlan' IS NOT NULL AND o.live_ops->'transportPlan'<>'null'::jsonb THEN o.proposed_ops-'transportation' ELSE o.proposed_ops END ||
        CASE WHEN o.live_ops ? 'loading' THEN jsonb_build_object('loading',o.live_ops->'loading') ELSE '{}'::jsonb END ||
        CASE WHEN o.live_ops ? 'resourceWindow' THEN jsonb_build_object('resourceWindow',o.live_ops->'resourceWindow') ELSE '{}'::jsonb END ||
        CASE WHEN o.live_ops ? 'transportPlan' THEN jsonb_build_object('transportPlan',o.live_ops->'transportPlan') ELSE '{}'::jsonb END ||
        CASE WHEN o.live_ops ? 'productMeta' OR o.proposed_ops ? 'productMeta' THEN
          jsonb_build_object('productMeta',m.proposed_meta || coalesce((
            SELECT jsonb_object_agg(e.key,coalesce(nullif(m.proposed_meta->e.key,'null'::jsonb),'{}'::jsonb) ||
              jsonb_build_object('prep',e.value->'prep' || coalesce(w.delta->e.key,'{}'::jsonb)))
            FROM jsonb_each(m.live_meta) e WHERE e.value->'prep' IS NOT NULL AND e.value->'prep'<>'null'::jsonb
          ),'{}'::jsonb)) ELSE '{}'::jsonb END)
      ELSE '{}'::jsonb END
    FROM (SELECT coalesce(${column},'{}'::jsonb) AS live,${JSON.stringify(incoming)}::jsonb AS patch,${JSON.stringify(delta)}::jsonb AS delta) w
    CROSS JOIN LATERAL (SELECT
      coalesce((SELECT jsonb_object_agg(x.key,x.value) FROM jsonb_each(coalesce(nullif(w.live->'bookingOperations','null'::jsonb),'{}'::jsonb)) x),'{}'::jsonb) AS live_ops,
      coalesce(nullif(w.patch->'bookingOperations','null'::jsonb),'{}'::jsonb) AS proposed_ops) o
    CROSS JOIN LATERAL (SELECT coalesce(nullif(o.live_ops->'productMeta','null'::jsonb),'{}'::jsonb) AS live_meta,
      coalesce(nullif(o.proposed_ops->'productMeta','null'::jsonb),nullif(o.live_ops->'productMeta','null'::jsonb),'{}'::jsonb) AS proposed_meta) m
  )`;
}
