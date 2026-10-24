import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { dailyAssignedStaffIds } from "../lib/booking-daily-operations";
import { normalizeQuantityLine } from "../lib/quantity-assets";
import { createLoading, executeLoadingRequest, LoadingError, loadingReturnSummary, readLoading, type LoadingActor, type LoadingFacts, type LoadingLineFact, type LoadingRequest } from "../lib/booking-loading";

type Ref={source:"kosha"|"service";id:number};
type Executor={execute(query:any):Promise<any>};
type Database=Executor&{transaction<T>(run:(tx:Executor)=>Promise<T>):Promise<T>};
const rows=async(tx:Executor,query:any):Promise<any[]>=>{const result=await tx.execute(query);if(!Array.isArray(result?.rows))throw new Error("Invalid booking loading query response");return result.rows};
const positive=(v:unknown)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const object=(v:any):Record<string,any>=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const list=(v:any):any[]=>Array.isArray(v)?v:[];
const entity=(ref:Ref)=>ref.source==="kosha"?"kosha_booking":"service_order";
function assertRef(ref:Ref){if(!["kosha","service"].includes(ref?.source)||!positive(ref.id))throw new LoadingError("هوية الحجز غير صحيحة",422)}

/** No schema initializers, financial reads, global connection or inventory writes. */
async function factsFor(tx:Executor,ref:Ref,actor:LoadingActor,lock=false) {
  assertRef(ref);
  const [booking]=await rows(tx,ref.source==="kosha"?sql`
    SELECT b.id,b.status,b.booking_details AS details,b.assigned_staff_id,coalesce(b.transportation_vehicle_id,d.vehicle_id) AS vehicle_id
    FROM kosha_bookings b LEFT JOIN dispatch_assignments d ON d.entity_type='kosha_booking' AND d.entity_id=b.id AND d.status IN ('assigned','en_route','active')
    WHERE b.id=${ref.id} AND b.archived_at IS NULL ${lock?sql`FOR UPDATE OF b`:sql``}`:sql`
    SELECT b.id,b.status,b.custom_fields AS details,NULL::integer AS assigned_staff_id,
      coalesce(CASE WHEN b.custom_fields->'bookingOperations'->'transportation'->>'mode'='ajn' THEN nullif(b.custom_fields->'bookingOperations'->'transportation'->>'vehicleId','')::integer END,d.vehicle_id) AS vehicle_id
    FROM service_orders b LEFT JOIN dispatch_assignments d ON d.entity_type='service_order' AND d.entity_id=b.id AND d.status IN ('assigned','en_route','active')
    WHERE b.id=${ref.id} AND b.archived_at IS NULL ${lock?sql`FOR UPDATE OF b`:sql``}`);
  if(!booking)throw new LoadingError("الحجز غير موجود أو مؤرشف",404);
  if(booking.details!=null&&(typeof booking.details!=="object"||Array.isArray(booking.details)))throw new LoadingError("بيانات الحجز التشغيلية غير صالحة؛ راجع المسؤول");
  const details=object(booking.details);
  if(details.bookingOperations!=null&&(typeof details.bookingOperations!=="object"||Array.isArray(details.bookingOperations)))throw new LoadingError("سجل عمليات الحجز غير صالح؛ راجع المسؤول");
  const operations=object(details.bookingOperations);
  if([details.linkedAssets,operations.assets].some(value=>value!=null&&!Array.isArray(value)))throw new LoadingError("قائمة معدات الحجز غير صالحة؛ لا يمكن استبدالها بقائمة فارغة");
  const members=await rows(tx,ref.source==="kosha"?sql`
    SELECT m.staff_id FROM kosha_work_order_members m JOIN kosha_work_orders w ON w.id=m.work_order_id
    WHERE w.booking_id=${ref.id} AND w.cancelled_at IS NULL AND lower(w.status)<>'cancelled' AND m.removed_at IS NULL AND lower(m.status) NOT IN ('removed','cancelled','declined')`:sql`
    SELECT c.staff_id FROM photography_shoot_crew c JOIN photography_shoots s ON s.id=c.shoot_id
    WHERE s.booking_id=${ref.id} AND lower(s.stage)<>'cancelled' AND c.assignment_status NOT IN ('removed','cancelled','rejected')`);
  const ids=dailyAssignedStaffIds({details,assignedStaffId:positive(booking.assigned_staff_id),executionStaffIds:members.map(m=>positive(m.staff_id)).filter((i):i is number=>i!==null)});
  if(!actor.manager&&!ids.includes(actor.id)&&!(!lock&&actor.viewAll))throw new LoadingError("العملية متاحة لفريق الحجز المعيّن فقط",403);
  const staff=ids.length?await rows(tx,sql`SELECT id,coalesce(nullif(full_name,''),username) AS name FROM staff WHERE id IN (${sql.join(ids.map(i=>sql`${i}`),sql`,`)}) AND is_active=true`):[];
  if(!actor.manager&&!staff.some(s=>Number(s.id)===actor.id)&&!(!lock&&actor.viewAll))throw new LoadingError("الموظف غير فعال ضمن فريق الحجز",403);
  const saved=readLoading(operations.loading,ref);
  const assetMap=new Map<number,any>();
  for(const asset of [...list(details.linkedAssets),...list(operations.assets)]){
    const productId=positive(asset?.productId);
    if(!productId)throw new LoadingError("مرجع معدة الحجز غير صالح");
    assetMap.set(productId,{...assetMap.get(productId),...asset,productId});
  }
  const [reservations,workOrderAssets,vehicleRows]=await Promise.all([
    rows(tx,sql`SELECT r.id,r.product_id,r.variant_id,r.quantity,r.status,to_jsonb(v)->>'barcode' AS variant_barcode
      FROM stock_reservations r LEFT JOIN product_variants v ON v.id=r.variant_id
      WHERE r.source_type=${entity(ref)} AND r.source_id=${ref.id} AND r.status<>'released' ORDER BY r.id LIMIT 501`),
    ref.source==="kosha"?rows(tx,sql`SELECT a.id,a.work_order_id,a.product_id,a.asset_code,a.checked_out_at,a.returned_at,a.return_condition
      FROM kosha_work_order_assets a JOIN kosha_work_orders w ON w.id=a.work_order_id
      WHERE w.booking_id=${ref.id} AND a.checked_out_at IS NOT NULL ORDER BY a.id LIMIT 501 ${lock?sql`FOR UPDATE OF a`:sql``}`):Promise.resolve([]),
    booking.vehicle_id?rows(tx,sql`SELECT id,name,is_active,status FROM fleet_vehicles WHERE id=${Number(booking.vehicle_id)}`):Promise.resolve([]),
  ]);
  const productIds=[...new Set([...assetMap.keys(),...reservations.map(r=>Number(r.product_id)),...workOrderAssets.map(a=>Number(a.product_id))])].sort((a,b)=>a-b);
  if(productIds.length>500||reservations.length+assetMap.size+workOrderAssets.length>500)throw new LoadingError("قائمة التحميل تتجاوز 500 عنصراً؛ راجع المسؤول",422);
  // The same product barrier used by existing checkout/return/status writers.
  if(lock&&productIds.length)await rows(tx,sql`SELECT id FROM products WHERE id IN (${sql.join(productIds.map(i=>sql`${i}`),sql`,`)}) ORDER BY id FOR UPDATE`);
  const [schema]=await rows(tx,sql`SELECT to_regclass('public.asset_quantity_profiles') IS NOT NULL AS ready`);
  const products=productIds.length?await rows(tx,sql`SELECT p.id,coalesce(p.name_ar,p.name) AS name,p.barcode,p.images,p.is_active,a.qr_token,
    ${schema?.ready?sql`q.tracking_mode,q.unit_of_measure AS unit`:sql`NULL::text AS tracking_mode,NULL::text AS unit`}
    FROM products p LEFT JOIN asset_passports a ON a.product_id=p.id
    ${schema?.ready?sql`LEFT JOIN asset_quantity_profiles q ON q.product_id=p.id`:sql``}
    WHERE p.id IN (${sql.join(productIds.map(i=>sql`${i}`),sql`,`)})`):[];
  const productMap=new Map(products.map(p=>[Number(p.id),p]));
  const custodyIds=[...new Set([...assetMap.values()].map(a=>positive(a.custodyId)).filter((i):i is number=>i!==null))];
  const [custodies,movements]=await Promise.all([
    custodyIds.length?rows(tx,sql`SELECT id,product_id,staff_id,quantity,status,notes,returned_at FROM equipment_custody WHERE id IN (${sql.join(custodyIds.map(i=>sql`${i}`),sql`,`)})`):Promise.resolve([]),
    assetMap.size?rows(tx,sql`SELECT id,product_id,quantity_change,reason,metadata FROM stock_movements
      WHERE related_type=${entity(ref)} AND related_id=${ref.id} AND reason IN ('quantity_asset_checkout','quantity_asset_return') ORDER BY id LIMIT 10001`):Promise.resolve([]),
  ]);
  if(movements.length>10000)throw new LoadingError("سجل الحركات كبير؛ يلزم فحصه كاملاً قبل مطابقة التحميل دون اقتطاع البيانات");
  const custodyById=new Map(custodies.map(c=>[Number(c.id),c]));
  const blockers:string[]=[],lines:LoadingLineFact[]=[];
  const productFor=(id:number)=>{const p=productMap.get(id);if(!p)throw new LoadingError("منتج أو أصل مرتبط بالحجز لم يعد متاحاً للمراجعة");return p};
  const codesFor=(p:any)=>[p.barcode,p.qr_token,`AJN-A${String(p.id).padStart(6,"0")}`].filter((c):c is string=>typeof c==="string"&&Boolean(c.trim()));
  for(const [productId,asset] of assetMap){
    const p=productFor(productId),quantityMode=p.tracking_mode==="quantity";
    if(asset.trackingMode==="quantity"&&!quantityMode)blockers.push(`تعريف تتبع الكمية غير متاح: ${p.name}`);
    const q=normalizeQuantityLine(quantityMode?{...asset,trackingMode:"quantity"}:asset);
    if(asset.stage==="released"&&!saved?.lines.some(l=>l.key===`asset:${productId}`))continue;
    let issued=q.checkedOutQty,origin=`unissued:${productId}`,returnedGood=q.returnedGoodQty,damaged=q.returnedDamagedQty,missing=q.missingQty;
    if(quantityMode){
      const original=movements.filter(m=>Number(m.product_id)===productId&&m.reason==="quantity_asset_checkout");
      const issuedQty=original.reduce((sum,m)=>sum+Number(m.metadata?.quantity??-Number(m.quantity_change)),0);
      if(issuedQty!==issued||!original.length)blockers.push(`حركات الصرف الأصلية لا تطابق كمية المعدة: ${p.name}`);
      origin=original.length?`movements:${original.map(m=>m.id).join(",")}`:origin;
      const returns=movements.filter(m=>Number(m.product_id)===productId&&m.reason==="quantity_asset_return");
      const totals=returns.reduce((sum,m)=>({good:sum.good+Number(m.metadata?.good??0),damaged:sum.damaged+Number(m.metadata?.damaged??0),missing:sum.missing+Number(m.metadata?.missing??0)}),{good:0,damaged:0,missing:0});
      if(totals.good!==returnedGood||totals.damaged!==damaged||totals.missing!==missing)throw new LoadingError(`حركات الإرجاع الأصلية لا تطابق سجل المعدة: ${p.name}`);
    }else{
      const c=custodyById.get(Number(asset.custodyId));
      const fixed=asset.source==="fixed_custody";
      const belongs=c&&Number(c.product_id)===productId&&Number(c.quantity)===q.requiredQty&&(
        (!String(c.notes??"").trim()&&Number(asset.custodyId)===Number(c.id))||
        (fixed?String(c.notes??"").startsWith(`حجز ${entity(ref)} #${ref.id} · مجموعة عهدة `)&&(!asset.custodyEmployeeId||Number(asset.custodyEmployeeId)===Number(c.staff_id)):c.notes===`${entity(ref)} #${ref.id}`));
      if(!belongs){issued=0;blockers.push(`أكمل أو راجع صرف العهدة الأصلية: ${p.name}`)}
      else{
        origin=`custody:${c.id}`;issued=Number(c.quantity);
        if(c.status==="returned"){
          if(!["returned","inspection","completed"].includes(String(asset.stage)))throw new LoadingError(`بيانات إرجاع العهدة لا تطابق سجل المعدة: ${p.name}`);
        }else if(c.status!=="issued"||asset.stage!=="out")throw new LoadingError(`حالة العهدة لا تطابق قائمة المعدات: ${p.name}`);
      }
    }
    lines.push({key:`asset:${productId}`,kind:"asset",productId,variantId:null,tracking:quantityMode?"quantity":"individual",required:q.requiredQty,issued,prepared:q.preparedQty,origin,name:String(p.name),unit:p.unit||"قطعة",codes:codesFor(p),returnedGood,damaged,missing,maintenance:0});
  }
  for(const a of workOrderAssets){
    const productId=Number(a.product_id),p=productFor(productId);
    if(p.tracking_mode==="quantity")blockers.push(`صرف أمر التنفيذ القديم لا يثبت حركة أصل متعدد الكمية؛ راجع المسار الأصلي: ${p.name}`);
    if(assetMap.has(productId)){if(!a.returned_at)blockers.push(`يوجد صرف آخر لنفس المعدة من أمر التنفيذ؛ راجع المرجعين: ${p.name}`);continue}
    const condition=String(a.return_condition??"good");
    if(a.returned_at&&!["good","damaged","missing","maintenance"].includes(condition))throw new LoadingError("حالة إرجاع معدات أمر التنفيذ غير معروفة");
    lines.push({key:`work-order:${a.id}`,kind:"asset",productId,variantId:null,tracking:"individual",required:1,issued:1,prepared:1,
      origin:`work-order:${a.work_order_id}:${a.id}`,name:String(p.name),unit:"قطعة",codes:[...codesFor(p),a.asset_code].filter(Boolean),
      returnedGood:a.returned_at&&condition==="good"?1:0,damaged:a.returned_at&&condition==="damaged"?1:0,missing:a.returned_at&&condition==="missing"?1:0,maintenance:a.returned_at&&condition==="maintenance"?1:0});
  }
  for(const r of reservations){
    const p=productFor(Number(r.product_id)),variantId=r.variant_id==null?null:Number(r.variant_id),required=Number(r.quantity);
    const prepared=operations.productMeta?.[`${p.id}:${variantId??0}`]?.prep?.status;
    const codes=variantId?[r.variant_barcode].filter(Boolean):[p.barcode].filter(Boolean);
    if(!codes.length)blockers.push(`حدد باركوداً أصلياً للمنتج أو المتغير: ${p.name}`);
    lines.push({key:`stock:${p.id}:${variantId??0}`,kind:"consumable",productId:Number(p.id),variantId,tracking:"quantity",required,issued:r.status==="consumed"?required:0,
      prepared:r.status==="consumed"||["ready","completed"].includes(prepared)?required:0,origin:`reservation:${r.id}`,name:String(p.name),unit:"وحدة",codes,
      returnedGood:0,damaged:0,missing:0,maintenance:0});
  }
  const v=vehicleRows[0];
  const facts:LoadingFacts={source:ref.source,id:ref.id,status:String(booking.status??""),vehicle:v?{id:Number(v.id),name:String(v.name),active:v.is_active===true&&!["maintenance","inactive","retired","sold"].includes(String(v.status).toLowerCase())}:null,
    staff:staff.map(s=>({id:Number(s.id),name:String(s.name)})),lines,blockers};
  return {facts,saved,operations};
}
function viewOf(context:Awaited<ReturnType<typeof factsFor>>,actor:LoadingActor){
  const {facts,saved:record}=context;
  const reasons=[...facts.blockers];
  // Loading roles come from the booking's own team; say so instead of an empty picker.
  const teamMissing=!record&&facts.staff.length<2;
  if(teamMissing)reasons.push("عيّن فريق الحجز من «فريق الحجز» أعلى الصفحة: يلزم موظفان على الأقل للتسليم والاستلام");
  if(!record){
    try{createLoading(facts,{id:"preview",responsibleId:facts.staff[0]?.id??0,senderId:facts.staff[0]?.id??0,receiverId:facts.staff[1]?.id??0},actor,new Date().toISOString())}
    catch(cause){if(cause instanceof LoadingError){if(!reasons.includes(cause.message)&&!(teamMissing&&cause.message.startsWith("حدد مسؤول التحميل")))reasons.push(cause.message)}else throw cause}
  }
  return {facts:{...facts,lines:facts.lines.map(({codes,...line})=>line)},record,blockers:reasons,actorId:actor.id,canManage:actor.manager===true,canAct:actor.manager===true||facts.staff.some(s=>s.id===actor.id),
    returns:record?.status==="confirmed"?loadingReturnSummary(record,facts):null};
}
export async function getLoadingView(executor:Executor,ref:Ref,actor:LoadingActor){return viewOf(await factsFor(executor,ref,actor),actor)}
export async function runLoadingRequest(database:Database,ref:Ref,actor:LoadingActor,command:LoadingRequest,deps={now:()=>new Date().toISOString(),nextId:()=>randomUUID()}){
  return database.transaction(async tx=>{
    const context=await factsFor(tx,ref,actor,true);
    const result=executeLoadingRequest(context.saved,context.facts,actor,command,deps.now(),deps.nextId());
    if(!result.duplicate){
      const value=JSON.stringify(result.record);
      const changed=await rows(tx,ref.source==="kosha"?sql`UPDATE kosha_bookings SET booking_details=jsonb_set(coalesce(booking_details,'{}'::jsonb),'{bookingOperations}',coalesce(booking_details->'bookingOperations','{}'::jsonb)||jsonb_build_object('loading',${value}::jsonb)),updated_at=now() WHERE id=${ref.id} AND archived_at IS NULL RETURNING id`
        :sql`UPDATE service_orders SET custom_fields=jsonb_set(coalesce(custom_fields,'{}'::jsonb),'{bookingOperations}',coalesce(custom_fields->'bookingOperations','{}'::jsonb)||jsonb_build_object('loading',${value}::jsonb)) WHERE id=${ref.id} AND archived_at IS NULL RETURNING id`);
      if(changed.length!==1)throw new LoadingError("تعذر حفظ قائمة التحميل الأصلية؛ أعد المحاولة");
      await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,body,actor_id,actor_name,metadata)
        VALUES(${entity(ref)},${ref.id},'booking_loading',${`تحميل وعهدة المعدات · ${command.type}`},${"تحديث أدلة قائمة الصرف الأصلية؛ دون حركة مخزون إضافية"},${actor.id},${actor.name},${JSON.stringify({manifestId:result.record.id,requestId:command.requestId,action:command.type})}::jsonb)`);
    }
    return {...viewOf({...context,saved:result.record},actor),duplicate:result.duplicate};
  });
}
