import {sql, type SQL} from "drizzle-orm";
import type {BookingOperationRef} from "@/lib/booking-operational-readiness";
import type {BookingConflictReport, ConflictReportRow} from "@/lib/booking-conflict-report";
import {readBookingResourceWindow, bookingResourceOccupancy} from "@/lib/booking-resource-window";
import {quantityPeriodAvailability, type PeriodCommitment} from "@/lib/quantity-asset-period";
import {lineOutstanding,lineReservedNotOut,normalizeQuantityLine} from "@/lib/quantity-assets";
import {resourceOccupancyTimestamps} from "@/lib/booking-resource-conflicts";
import {baghdadDay} from "@/lib/kosha-manager";
import {readResourceBooking} from "./booking-resource-period";
import {hasSafeConflictQuantityCounters,readConflictQuantityHistory} from "./booking-conflict-history";
import {BookingResourceConflictError, resourceRows, findBookingPhysicalConflict, findBookingStaffConflict, findBookingVehicleConflict, findBookingCrewConflict, findBookingKoshaConflict, type ResourceExecutor} from "./booking-resource-availability";

const terminal=new Set(["released","returned","inspection","completed"]);
const blocked=new Set(["maintenance","damaged","lost","retired","locked","sold","disposed"]);
// Match original dispatch eligibility without rejecting outside/busy resources
// merely because they are already assigned to this same booking.
const dispatchBlocked={vehicle:new Set(["maintenance","repair","retired","inactive"]),crew:new Set(["inactive","maintenance","unavailable"])};
const idsWhere=(column:SQL,ids:number[])=>ids.length?sql`${column} IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)})`:sql`false`;
const positive=(value:unknown)=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const count=(value:unknown)=>value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value))&&Number(value)>=0;

/** Snapshot only. Reuses reservation guards and the original quantity evaluator;
 * never initializes schema, locks records or confirms an allocation. */
export async function loadBookingConflictReport(tx:ResourceExecutor,ref:BookingOperationRef):Promise<BookingConflictReport>{
  const live=await readResourceBooking(tx,ref);
  const window=readBookingResourceWindow(live.operations,live.eventDate);
  const interval=bookingResourceOccupancy(live.operations,live.eventDate)??null;
  const entity=ref.source==="kosha"?"kosha_booking":"service_order";
  const [fixed,manifest]=await Promise.all([
    tx.execute(sql`SELECT product_id FROM employee_custody_reservations WHERE booking_type=${entity} AND booking_id=${ref.id} AND status IN ('reserved','checked_out') LIMIT 101`),
    ref.source==="kosha"?tx.execute(sql`SELECT a.product_id FROM kosha_work_order_assets a JOIN kosha_work_orders w ON w.id=a.work_order_id WHERE w.booking_id=${ref.id} AND a.checked_out_at IS NOT NULL AND a.returned_at IS NULL LIMIT 101`):Promise.resolve({rows:[]}),
  ]);
  const assets=new Map(live.assets.filter(a=>!terminal.has(String(a.stage??"linked"))||Number(a.checkedOutQty??0)>Number(a.returnedGoodQty??0)+Number(a.returnedDamagedQty??0)+Number(a.missingQty??0)).map(a=>[a.productId,a]));
  for(const result of [fixed,manifest]){
    const rows=resourceRows(result);
    if(rows.length>100)throw new BookingResourceConflictError("موارد الحجز كثيرة؛ افتح سجل المعدات لمراجعتها",422);
    for(const row of rows){
      if(!positive(row.product_id))throw Error("Invalid custody resource identity");
      const productId=Number(row.product_id);
      if(!assets.has(productId))assets.set(productId,{productId,quantity:1});
    }
  }
  if(assets.size+live.staffIds.length+Number(!!live.vehicleId)+Number(!!live.crewId)+Number(!!live.koshaId)>100)throw new BookingResourceConflictError("موارد الحجز كثيرة؛ يلزم فحصها على مجموعات",422);
  const productIds=[...assets.keys()];
  const [productResult,nameResult]=await Promise.all([
    productIds.length?tx.execute(sql`SELECT p.id,p.name_ar,p.name,p.is_asset,p.stock,q.tracking_mode,q.unit_of_measure,q.quantity_checked_out,q.quantity_damaged,q.quantity_maintenance,q.quantity_missing,ap.status AS asset_status,ap.deleted_at AS asset_deleted_at
      FROM products p LEFT JOIN asset_quantity_profiles q ON q.product_id=p.id LEFT JOIN asset_profiles ap ON ap.product_id=p.id WHERE ${idsWhere(sql`p.id`,productIds)} LIMIT 101`):Promise.resolve({rows:[]}),
    tx.execute(sql`SELECT 'staff' AS kind,id,coalesce(nullif(full_name,''),username) AS name,is_active AS active,NULL::text AS status FROM staff WHERE ${idsWhere(sql`id`,live.staffIds)}
      UNION ALL SELECT 'vehicle',id,name,is_active,status FROM fleet_vehicles WHERE ${idsWhere(sql`id`,live.vehicleId?[live.vehicleId]:[])}
      UNION ALL SELECT 'crew',id,name,is_active,status FROM crews WHERE ${idsWhere(sql`id`,live.crewId?[live.crewId]:[])}
      UNION ALL SELECT 'kosha',id,name,is_active,availability_status FROM koshas WHERE ${idsWhere(sql`id`,live.koshaId?[live.koshaId]:[])} LIMIT 101`),
  ]);
  const products=new Map<number,any>();
  for(const product of resourceRows(productResult)){
    if(!positive(product.id)||!assets.has(Number(product.id))||products.has(Number(product.id)))throw Error("Invalid resource product database response");
    products.set(Number(product.id),product);
  }
  const expectedNames=new Set([...live.staffIds.map(id=>`staff:${id}`),...(live.vehicleId?[`vehicle:${live.vehicleId}`]:[]),...(live.crewId?[`crew:${live.crewId}`]:[]),...(live.koshaId?[`kosha:${live.koshaId}`]:[])]);
  const names=new Map<string,any>();
  for(const row of resourceRows(nameResult)){
    const key=`${row.kind}:${row.id}`;
    if(!expectedNames.has(key)||names.has(key)||typeof row.active!=="boolean")throw Error("Invalid resource name database response");
    names.set(key,row);
  }
  const quantityIds=[...products.values()].filter(p=>p.tracking_mode==="quantity").map(p=>Number(p.id));
  const commitments=new Map<number,PeriodCommitment[]>(),holds=new Map<number,number>();
  if(quantityIds.length){
    // Same original commitment sources and evaluator as quantityAvailability;
    // One bounded history read; settled rows do not consume the separate
    // original 500-row live/uncertain evidence allowance.
    const [commitmentResult,holdResult]=await Promise.all([
      tx.execute(sql`SELECT 'kosha_booking' AS source,b.id AS booking_id,b.event_date::text AS day,b.status,a.value AS line,b.booking_details->'bookingOperations'->'resourceWindow' AS resource_window
        FROM kosha_bookings b CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.booking_details->'bookingOperations'->'assets')='array' THEN b.booking_details->'bookingOperations'->'assets' ELSE '[]'::jsonb END) a(value)
        WHERE b.archived_at IS NULL AND a.value->>'productId' IN (${sql.join(quantityIds.map(id=>sql`${String(id)}`),sql`, `)})
        UNION ALL SELECT 'service_order',b.id,b.event_date::text,b.status,a.value,b.custom_fields->'bookingOperations'->'resourceWindow'
        FROM service_orders b CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.custom_fields->'bookingOperations'->'assets')='array' THEN b.custom_fields->'bookingOperations'->'assets' ELSE '[]'::jsonb END) a(value)
        WHERE b.archived_at IS NULL AND a.value->>'productId' IN (${sql.join(quantityIds.map(id=>sql`${String(id)}`),sql`, `)}) LIMIT 5001`),
      tx.execute(sql`SELECT product_id,sum(quantity) AS quantity FROM stock_reservations WHERE ${idsWhere(sql`product_id`,quantityIds)} AND status='reserved' AND NOT(source_type=${entity} AND source_id=${ref.id}) GROUP BY product_id LIMIT 101`),
    ]);
    for(const row of readConflictQuantityHistory(commitmentResult,quantityIds)){
      const productId=Number(row.line?.productId);
      if(!quantityIds.includes(productId)||!positive(row.booking_id)||!["kosha_booking","service_order"].includes(row.source))throw Error("Invalid quantity commitment database response");
      const period=readBookingResourceWindow({resourceWindow:row.resource_window},row.day);
      const rows=commitments.get(productId)??[];
      rows.push({source:row.source,bookingId:Number(row.booking_id),day:row.day??null,status:String(row.status??""),line:row.line,interval:period?{start:period.preparationStart,end:period.returnEnd}:null});
      commitments.set(productId,rows);
    }
    for(const row of resourceRows(holdResult)){
      if(!quantityIds.includes(Number(row.product_id))||!count(row.quantity)||holds.has(Number(row.product_id)))throw Error("Invalid quantity hold database response");
      holds.set(Number(row.product_id),Number(row.quantity));
    }
  }
  const jobs:Array<()=>Promise<ConflictReportRow>>=[];
  const status=(candidate:any):Pick<ConflictReportRow,"state"|"reason"|"booking">=>{
    if(candidate)return {state:candidate.timingIncomplete?"incomplete":"conflict",reason:candidate.still_out?"معدات مصروفة لحجز آخر ولم يُسجّل إرجاعها":candidate.timingIncomplete?"مواعيد الحجز الآخر غير مكتملة؛ لا يمكن تأكيد التوفر":"تداخل خلال فترة التجهيز والتنفيذ والإرجاع",booking:{source:candidate.source,id:Number(candidate.id)}};
    return window?{state:"no_conflict",reason:"لم يظهر تعارض مع حجز آخر ضمن الفحوص المتاحة"}:{state:"incomplete",reason:"حدد فترة تشغيل الموارد أولاً"};
  };
  for(const [productId,line] of assets)jobs.push(async()=>{
    const product=products.get(productId),quantity=product?.tracking_mode==="quantity"||line.trackingMode==="quantity",kind=quantity?"quantity":"asset";
    const base={key:`${kind}:${productId}`,kind,name:String(product?.name_ar||product?.name||"معدة غير متاحة")} as const;
    if(!product||product.is_asset!==true||product.asset_deleted_at||blocked.has(String(product.asset_status??"")))return {...base,state:"incomplete",reason:"راجع حالة المعدة وسجل المستودع؛ لا يمكن اعتماد توفرها"};
    if(quantity&&product.tracking_mode!=="quantity")return {...base,state:"incomplete",reason:"ملف كميات المعدة غير متاح؛ راجع المستودع قبل اعتماد التوفر"};
    if(quantity){
      const required=Number(line.requiredQty??line.quantity??1);
      if(!Number.isFinite(required)||required<=0)return {...base,state:"incomplete",reason:"الكمية المطلوبة غير صالحة؛ راجع بند المعدة"};
      const buckets={inWarehouse:Number(product.stock),checkedOut:Number(product.quantity_checked_out),damaged:Number(product.quantity_damaged),maintenance:Number(product.quantity_maintenance),missing:Number(product.quantity_missing)};
      const rows=commitments.get(productId)??[];
      const quantities={required,available:null,reserved:null,missing:null,unit:String(product.unit_of_measure||"قطعة")};
      // The existing quantity-asset engine is integer-based. Never silently
      // floor fractional historical inputs; normal decimal stock is untouched.
      const numeric=[required,...Object.values(buckets),holds.get(productId)??0,...rows.flatMap(row=>["quantity","requiredQty","reservedQty","checkedOutQty","returnedGoodQty","returnedDamagedQty","missingQty"].filter(key=>row.line[key]!=null).map(key=>Number(row.line[key])))];
      if(!numeric.every(n=>Number.isSafeInteger(n)&&n>=0)||!rows.every(row=>hasSafeConflictQuantityCounters(row.line))||required<=0)return {...base,state:"incomplete",reason:"راجع وحدة المعدة والكميات المسجلة؛ لا تُقرّب الكسور تلقائياً",quantities};
      const target=resourceOccupancyTimestamps(interval);
      const related=rows.find(row=>{
        const source=row.source==="kosha_booking"?"kosha":"service";
        if(source===ref.source&&row.bookingId===ref.id)return false;
        const line=normalizeQuantityLine(row.line);
        if(lineOutstanding(line)>0)return true;
        if(!lineReservedNotOut(line,row.status))return false;
        const occupied=resourceOccupancyTimestamps(row.interval);
        return !target||!occupied||target[0]<occupied[1]&&occupied[0]<target[1];
      });
      const booking:BookingOperationRef|undefined=related?{source:related.source==="kosha_booking"?"kosha":"service",id:related.bookingId}:undefined;
      const result=quantityPeriodAvailability({booking:ref,buckets,rows,interval,otherHolds:holds.get(productId)??0,today:baghdadDay()});
      if(!result.complete||!result.availability)return {...base,state:"incomplete",reason:"مواعيد أو كميات الإرجاع غير متطابقة؛ يلزم مراجعة سجل المعدات",quantities,booking};
      const available=result.availability.available,missing=Math.max(0,required-available);
      return {...base,state:missing>0?"conflict":"no_conflict",reason:missing>0?`تعارض بالمعدات — ناقص ${missing}`:"الكميات تكفي ضمن الإشغال المسجل",quantities:{...quantities,available,reserved:result.availability.committed,missing},...(missing>0?{booking}:{})};
    }
    return {...base,...status(await findBookingPhysicalConflict(live,productId,tx))};
  });
  const resources:[ConflictReportRow["kind"],number,(...args:any[])=>Promise<any>][]=[...live.staffIds.map(id=>["staff",id,(b:any,i:number,t:any)=>findBookingStaffConflict(b,[i],t)] as ["staff",number,any]),...(live.vehicleId?[["vehicle",live.vehicleId,findBookingVehicleConflict] as ["vehicle",number,any]]:[]),...(live.crewId?[["crew",live.crewId,findBookingCrewConflict] as ["crew",number,any]]:[]),...(live.koshaId?[["kosha",live.koshaId,findBookingKoshaConflict] as ["kosha",number,any]]:[])];
  for(const [kind,id,find] of resources)jobs.push(async()=>{
    const resource=names.get(`${kind}:${id}`);
    const base={key:`${kind}:${id}`,kind,name:String(resource?.name||"مورد غير متاح")};
    const resourceStatus=String(resource?.status??"");
    if(!resource||resource.active!==true||blocked.has(resourceStatus)||((kind==="vehicle"||kind==="crew")&&dispatchBlocked[kind].has(resourceStatus)))return {...base,state:"incomplete",reason:"المورد غير نشط أو حالته تحتاج مراجعة"};
    return {...base,...status(await find(live,id,tx))};
  });
  const rows:ConflictReportRow[]=[];
  for(let start=0;start<jobs.length;start+=4)rows.push(...await Promise.all(jobs.slice(start,start+4).map(job=>job())));
  return {...ref,checkedAt:new Date().toISOString(),timingComplete:!!window,coverage:"partial",rows};
}
