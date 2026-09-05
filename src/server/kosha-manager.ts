import { db, koshaBookingsTable, serviceOrdersTable, servicesTable, koshasTable, fleetVehiclesTable, staffTable, adminActivityLogsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { bookingPhotosFromFields, bookingPhotoPreview } from "@/lib/booking-photos";
import { bookingIdentity, bookingNumber, executionLabels, filterManagerHeaders, managerStats, type ManagerHeader } from "@/lib/kosha-manager";
import type { KoshaManagerActivity, KoshaManagerBooking, KoshaManagerDetail, KoshaManagerList, KoshaManagerSource, KoshaManagerTimeline } from "@/lib/kosha-manager-contract";

type Row = Record<string, any>;
type Actor = {id:number;role:string;fullName?:string|null;username:string;permissions:string[]};
export type KoshaLookups = {koshas:Map<number,any>;vehicles:Map<number,any>;staff:Map<number,any>};
type Adapters = { native:(row:any, lookups?:KoshaLookups)=>Promise<any>; service:(row:any, service?:any, lookups?:KoshaLookups)=>Promise<any>; routed:(row:any,service?:any)=>boolean };
const array=(v:any):Row[]=>Array.isArray(v)?v:[];
const iso=(v:any):string|null=>v?.toISOString?.()||(v?String(v):null);
const rows=async(q:any):Promise<Row[]> => (await db.execute(q)).rows as Row[];
const sourceType=(s:KoshaManagerSource)=>s==="service"?"service_order":"kosha_booking";
export const mayViewKoshaExecution=(a:Actor)=>["admin","manager"].includes(a.role)||a.permissions.includes("booking_operations_view")||a.permissions.includes("koshas");
export const mayResolveKoshaProblem=(a:Actor)=>["admin","manager"].includes(a.role);
const blankActivity=():KoshaManagerActivity=>({photos:0,notes:0,problems:0,openProblems:0,latestAt:null,latestBy:null,latestLabel:null});
const jsonToCamel=(r:Row)=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k.replace(/_([a-z])/g,(_,l)=>l.toUpperCase()),v]));
const legacyPaymentStatus=(r:Row)=>{const paid=Number(r.paid_amount||0),remaining=Number(r.remaining_amount||0);return r.payment_status||(paid>0&&remaining>0?"partial":paid>0&&remaining<=0?"paid":"unpaid");};
const redactExecutionBooking=(booking:KoshaManagerBooking):KoshaManagerBooking=>({...booking,bookingDetails:{},venueImages:[],assignedEmployees:[],executionStage:"",primaryEmployeeId:null,primaryEmployeeName:null,assistantEmployeeId:null,assistantEmployeeName:null,transportationDriverId:null,transportationDriverName:null} as KoshaManagerBooking);

// Read only compact header fields for exact legacy classification; pagination happens
// before loading booking details/catalog/crew. No media JSON or galleries travel here.
async function headers(adapters:Adapters) {
  const [native,service,catalog] = await Promise.all([
    rows(sql`select id, customer_name, phone, event_date, status, payment_status, paid_amount, execution_stage, kosha_id, remaining_amount, created_at,
      concat_ws(' ',customer_name,phone,bride_name,groom_name,tracking_code,package_name,province,area,city_area,internal_notes) as search_text
      from kosha_bookings where archived_at is null`),
    rows(sql`select o.id,o.customer_name,o.phone,o.event_date,o.status,o.payment_status,o.deposit_amount as paid_amount,o.remaining_amount,o.created_at,
      o.custom_fields->>'koshaId' as kosha_id,o.custom_fields->>'executionStage' as execution_stage,
      concat_ws(' ',o.customer_name,o.phone,o.tracking_code,o.custom_fields->>'brideName',o.custom_fields->>'groomName',o.event_location) as search_text,
      jsonb_build_object('assignedPortal',o.custom_fields->'assignedPortal','departments',o.custom_fields->'departments',
        'department',o.custom_fields->'department','bookingType',o.custom_fields->'bookingType','serviceType',o.custom_fields->'serviceType',
        'packageName',o.custom_fields->'packageName','category',o.custom_fields->'category','categoryName',o.custom_fields->'categoryName',
        'bookingCenterServices',o.custom_fields->'bookingCenterServices','items',coalesce((select jsonb_agg(jsonb_build_object('name',i->>'name','nameAr',i->>'nameAr','productName',i->>'productName')) from jsonb_array_elements(case when jsonb_typeof(o.custom_fields->'items')='array' then o.custom_fields->'items' else '[]'::jsonb end) i),'[]'::jsonb)) as routing,
      jsonb_build_object('type',s.type,'name',s.name,'nameAr',s.name_ar) as service
      from service_orders o join services s on s.id=o.service_id where o.archived_at is null`),
    db.select({id:koshasTable.id,name:koshasTable.name}).from(koshasTable),
  ]);
  const names=new Map(catalog.map(r=>[r.id,r.name]));
  const header=(r:Row,source:KoshaManagerSource):ManagerHeader=>({id:Number(r.id),source,customerName:r.customer_name,phone:r.phone,eventDate:String(r.event_date||"").slice(0,10),status:r.status,paymentStatus:legacyPaymentStatus(r),executionStage:r.execution_stage||"",koshaId:Number(r.kosha_id)||null,koshaName:names.get(Number(r.kosha_id))||"",remainingAmount:Number(r.remaining_amount||0),createdAt:iso(r.created_at)||"",searchText:`${r.search_text||""} ${names.get(Number(r.kosha_id))||""}`});
  return {all:[...native.map(r=>header(r,"kosha")),...service.filter(r=>adapters.routed({customFields:r.routing},r.service)).map(r=>header(r,"service"))],catalog};
}

async function loadBookings(ids: Array<{id:number;source:KoshaManagerSource}>,adapters:Adapters) {
  const nativeIds=ids.filter(r=>r.source==="kosha").map(r=>r.id),serviceIds=ids.filter(r=>r.source==="service").map(r=>r.id);
  const [native,service]=await Promise.all([
    nativeIds.length?db.query.koshaBookingsTable.findMany({where:inArray(koshaBookingsTable.id,nativeIds)}):[],
    serviceIds.length?db.query.serviceOrdersTable.findMany({where:inArray(serviceOrdersTable.id,serviceIds)}):[],
  ]);
  const all=[...native,...service];
  const ks=[...new Set(all.map((r:any)=>Number(r.koshaId||(r.customFields as any)?.koshaId)).filter(Boolean))];
  const vs=[...new Set(all.map((r:any)=>Number(r.transportationVehicleId)).filter(Boolean))];
  const ss=[...new Set(all.map((r:any)=>Number(r.transportationDriverId)).filter(Boolean))];
  const [catalog,vehicles,staff,services]=await Promise.all([
    ks.length?db.query.koshasTable.findMany({where:inArray(koshasTable.id,ks)}):[],
    vs.length?db.query.fleetVehiclesTable.findMany({where:inArray(fleetVehiclesTable.id,vs)}):[],
    ss.length?db.query.staffTable.findMany({where:inArray(staffTable.id,ss)}):[],
    service.length?db.query.servicesTable.findMany({where:inArray(servicesTable.id,[...new Set(service.map(r=>r.serviceId))])}):[],
  ]);
  const lookups:KoshaLookups={koshas:new Map(catalog.map(r=>[r.id,r])),vehicles:new Map(vehicles.map(r=>[r.id,r])),staff:new Map(staff.map(r=>[r.id,r]))};
  const serviceMap=new Map(services.map(r=>[r.id,r]));
  const formatted=await Promise.all([...native.map(r=>adapters.native(r,lookups)),...service.map(r=>adapters.service(r,serviceMap.get(r.serviceId),lookups))]);
  const originals=new Map<string, Row>([...native.map(r=>[`kosha:${r.id}`,r] as const),...service.map(r=>[`service:${r.id}`,r] as const)]);
  return formatted.map((r:any)=>{
    const original:any=originals.get(bookingIdentity(r));
    return {...r,source:r.source||"kosha",number:bookingNumber(r),koshaImage:lookups.koshas.get(Number(r.koshaId))?.mainImage||null,updatedAt:iso(original.updatedAt)||iso(original.createdAt)||"",archivedAt:iso(original.archivedAt),executionStage:original.executionStage||(original.customFields as any)?.executionStage||r.executionStage,activity:blankActivity(),assignedEmployees:array(r.assignedEmployees) as any} as KoshaManagerBooking;
  });
}

// Batch counts only. Media and timeline entries stay on the lazy detail endpoint.
async function activityFor(bookings:KoshaManagerBooking[],actor:Actor) {
  if (!bookings.length||!mayViewKoshaExecution(actor)) return bookings;
  const identities=JSON.stringify(bookings.map(b=>({id:b.id,source:b.source})));
  const result=await rows(sql`with wanted as (select * from jsonb_to_recordset(${identities}::jsonb) as x(id int,source text)),
    media as (
      select w.id,w.source,m.url,m.kind,m.purpose,m.created_at::text from wanted w join kosha_media m on w.source='kosha' and m.booking_id=w.id
      union all select w.id,w.source,m->>'url',coalesce(m->>'kind','image'),coalesce(m->>'purpose','execution'),nullif(m->>'createdAt','')
      from wanted w join service_orders s on w.source='service' and s.id=w.id cross join lateral jsonb_array_elements(case when jsonb_typeof(s.custom_fields->'koshaPortalMedia')='array' then s.custom_fields->'koshaPortalMedia' else '[]'::jsonb end) m
      union all select w.id,w.source,d.photo_url,'image','breakage',d.created_at::text from wanted w join kosha_damage_reports d on d.booking_id=w.id and d.booking_source=w.source where d.status<>'none' and d.photo_url is not null
      union all select w.id,w.source,c.photo_url,'image','execution',c.updated_at::text from wanted w join kosha_work_orders o on w.source='kosha' and o.booking_id=w.id join kosha_work_order_checklist c on c.work_order_id=o.id where c.photo_url is not null),
    events as (
      select w.id,w.source,e.type,e.staff_name,e.created_at::text from wanted w join kosha_booking_events e on w.source='kosha' and e.booking_id=w.id
      union all select w.id,w.source,e->>'type',e->>'staffName',nullif(e->>'createdAt','') from wanted w join service_orders s on w.source='service' and s.id=w.id cross join lateral jsonb_array_elements(case when jsonb_typeof(s.custom_fields->'koshaPortalTimeline')='array' then s.custom_fields->'koshaPortalTimeline' else '[]'::jsonb end) e
      union all select w.id,w.source,e.type,e.staff_name,e.created_at::text from wanted w join kosha_work_orders o on w.source='kosha' and o.booking_id=w.id join kosha_work_order_events e on e.work_order_id=o.id),
    photo_counts as(select id,source,count(distinct url) filter(where kind='image' and purpose<>'signature')::int photos,max(created_at) latest from media group by id,source),
    note_counts as(select id,source,count(*) filter(where type='note')::int notes,max(created_at) latest from events group by id,source),
    damage_counts as(select w.id,w.source,count(d.id) filter(where d.status<>'none')::int problems,count(d.id) filter(where d.status not in ('none','resolved','closed','rejected'))::int open_problems,max(d.created_at)::text latest from wanted w left join kosha_damage_reports d on d.booking_id=w.id and d.booking_source=w.source group by w.id,w.source)
    select w.*,coalesce(p.photos,0) photos,coalesce(n.notes,0) notes,coalesce(d.problems,0) problems,coalesce(d.open_problems,0) open_problems,greatest(p.latest,n.latest,d.latest) latest
    from wanted w left join photo_counts p using(id,source) left join note_counts n using(id,source) left join damage_counts d using(id,source)`);
  const map=new Map(result.map(r=>[`${r.source}:${r.id}`,r]));
  return bookings.map(b=>{const r=map.get(bookingIdentity(b));return {...b,activity:{photos:Number(r?.photos||0),notes:Number(r?.notes||0),problems:Number(r?.problems||0),openProblems:Number(r?.open_problems||0),latestAt:iso(r?.latest),latestBy:null,latestLabel:r?.latest?"تحديث تنفيذ الكادر":null},updatedAt:iso(r?.latest)&&String(iso(r?.latest))>b.updatedAt?String(iso(r?.latest)):b.updatedAt};});
}

export async function koshaManagerList(params:URLSearchParams,actor:Actor,adapters:Adapters):Promise<KoshaManagerList> {
  const {all,catalog}=await headers(adapters);
  const filtered=filterManagerHeaders(all,params);
  const pageSize=([10,25,50].includes(Number(params.get("pageSize")))?Number(params.get("pageSize")):10) as 10|25|50;
  const page=Math.max(1,Math.min(Math.ceil(filtered.length/pageSize)||1,Number.parseInt(params.get("page")||"1",10)||1));
  const wanted=filtered.slice((page-1)*pageSize,page*pageSize);
  const bookings=await activityFor(await loadBookings(wanted,adapters),actor);
  const indexed=new Map(bookings.map(b=>[bookingIdentity(b),b]));
  // Heavy historical JSON is only available in the detail response.
  const canViewExecution=mayViewKoshaExecution(actor);
  const items=wanted.map(b=>indexed.get(bookingIdentity(b))!).filter(Boolean).map(b=>canViewExecution?{...b,bookingDetails:{},venueImages:[]}:redactExecutionBooking(b));
  return {items,total:filtered.length,page,pageSize,stats:managerStats(all),koshas:catalog};
}

export async function koshaManagerDetail(id:number,source:KoshaManagerSource,actor:Actor,adapters:Adapters):Promise<KoshaManagerDetail|null> {
  const bookings=await loadBookings([{id,source}],adapters);
  if (!bookings.length) return null;
  let booking=bookings[0];
  if(booking.archivedAt)return null;
  if(source==="service") {const original=await db.query.serviceOrdersTable.findFirst({where:eq(serviceOrdersTable.id,id)});const service=original?await db.query.servicesTable.findFirst({where:eq(servicesTable.id,original.serviceId)}):null;if(!original||!adapters.routed(original,service))return null;}
  const execution=mayViewKoshaExecution(actor);
  const safeBooking=execution?booking:redactExecutionBooking(booking);
  const result:KoshaManagerDetail={booking:safeBooking,media:[],timeline:[],damages:[],referencePhotos:execution?[...bookingPhotosFromFields(booking.bookingDetails).map(bookingPhotoPreview),...(booking.venueImages||[])]:[],assignedStaff:execution?booking.assignedEmployees.map(name=>({id:null,name,role:"الفريق"})):[],delivery:null,workOrder:null,permissions:{execution,resolveProblems:execution&&mayResolveKoshaProblem(actor)}};
  if(!execution)return result;
  const fields=booking.bookingDetails as Row;
  const [media,events,damage,workorders,audit]=await Promise.all([
    source==="kosha"?rows(sql`select m.*,s.full_name as staff_name from kosha_media m left join staff s on s.id=m.staff_id where booking_id=${id} order by m.created_at desc`):array(fields.koshaPortalMedia),
    source==="kosha"?rows(sql`select * from kosha_booking_events where booking_id=${id} order by created_at desc`):array(fields.koshaPortalTimeline),
    rows(sql`select * from kosha_damage_reports where booking_id=${id} and booking_source=${source} and status<>'none' order by created_at desc`),
    source==="kosha"?rows(sql`select w.*,s.full_name as leader_name from kosha_work_orders w left join staff s on s.id=w.leader_id where w.booking_id=${id}`):[],
    rows(sql`select id,metadata,created_at,user_name from admin_activity_logs where entity_type=${sourceType(source)} and entity_id=${id} and action='kosha_problem_resolved' order by created_at desc`),
  ]);
  result.media=media.map((m:any)=>{const r=source==="kosha"?jsonToCamel(m):m;return {id:`media:${r.id}`,url:r.url,kind:r.kind==="video"?"video":"image",purpose:r.purpose||"execution",stage:r.stage||null,staffName:r.staffName||null,createdAt:iso(r.createdAt)};});
  const timeline=(raw:any,prefix:string):KoshaManagerTimeline=>{const e=jsonToCamel(raw);return {id:`${prefix}:${e.id}`,type:e.type||"activity",title:e.title||executionLabels[e.toStage]||({note:"ملاحظة الكادر",media:"إضافة صور التنفيذ",delivery:"تقرير التسليم",stage:"تحديث مرحلة التنفيذ"} as Record<string,string>)[e.type]||e.type||"تحديث التنفيذ",note:e.note||e.details||null,staffName:e.staffName||null,createdAt:iso(e.createdAt),fromStage:e.fromStage||null,toStage:e.toStage||null};};
  result.timeline=events.map(e=>timeline(e,"event"));
  result.damages=damage.map(d=>{const resolved=audit.find(a=>Number(a.metadata?.problemId)===Number(d.id));return {id:Number(d.id),kind:"damage",description:d.description,status:d.status,priority:d.priority,photoUrl:d.photo_url,staffName:d.reported_by_name,createdAt:iso(d.created_at),resolvedAt:iso(resolved?.created_at),canResolve:mayResolveKoshaProblem(actor)&&d.status==="open"};});
  result.timeline.push(...audit.map(a=>({id:`audit:${a.id}`,type:"problem_resolved",title:"تمت معالجة المشكلة",note:a.metadata?.note||null,staffName:a.user_name,createdAt:iso(a.created_at),fromStage:null,toStage:null})));
  const delivery=source==="kosha"?(await rows(sql`select * from kosha_delivery_reports where booking_id=${id} order by created_at desc limit 1`))[0]:fields.koshaPortalDelivery;
  if(delivery){const d=jsonToCamel(delivery);result.delivery={hasLoss:Boolean(d.hasLoss),hasBreakage:Boolean(d.hasBreakage),note:d.note||null,staffName:d.staffName||null,createdAt:iso(d.createdAt),signatureUrl:d.signatureUrl||null};}
  if(workorders[0]) {
    const w=workorders[0]; result.workOrder={id:w.id,number:w.work_order_no,status:w.status,leaderName:w.leader_name,requiredArrivalAt:iso(w.required_arrival_at),completedAt:iso(w.completed_at)};
    const [we,members,checklist]=await Promise.all([rows(sql`select * from kosha_work_order_events where work_order_id=${w.id} order by created_at desc`),rows(sql`select m.staff_id,m.role,s.full_name,s.username from kosha_work_order_members m join staff s on s.id=m.staff_id where m.work_order_id=${w.id} and m.removed_at is null`),rows(sql`select c.*,s.full_name as staff_name from kosha_work_order_checklist c left join staff s on s.id=c.completed_by where c.work_order_id=${w.id} and c.photo_url is not null`)]);
    result.media.push(...checklist.map(c=>({id:`checklist:${c.id}`,url:c.photo_url,kind:"image" as const,purpose:"execution",stage:null,staffName:c.staff_name,createdAt:iso(c.updated_at)})));
    result.timeline.push(...we.map(e=>timeline(e,"workorder")));
    result.assignedStaff.push(...members.map(m=>({id:m.staff_id,name:m.full_name||m.username,role:m.role==="LEADER"?"مسؤول الفريق":"الفريق"})));
  }
  result.timeline.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  [booking]=await activityFor([booking],actor);result.booking=booking;
  return result;
}

export async function resolveKoshaManagerProblem(id:number,source:KoshaManagerSource,problemId:number,note:string,actor:Actor) {
  return db.transaction(async tx=>{
    const found=(await tx.execute(sql`select * from kosha_damage_reports where id=${problemId} and booking_id=${id} and booking_source=${source} for update`)).rows[0] as Row|undefined;
    if(!found)return {status:404,message:"المشكلة غير موجودة في هذا الحجز"};
    if(found.status==="resolved")return {status:200,message:"تمت معالجة المشكلة سابقاً"};
    if(found.status!=="open")return {status:409,message:found.status==="pending_approval"?"يجب اعتماد تقرير الضرر أولاً من مسار الموافقات":"لا يمكن معالجة التقرير بهذه الحالة"};
    await tx.execute(sql`update kosha_damage_reports set status='resolved' where id=${problemId} and booking_id=${id} and booking_source=${source}`);
    await tx.insert(adminActivityLogsTable).values({staffId:actor.id,userName:actor.fullName||actor.username,action:"kosha_problem_resolved",entityType:sourceType(source),entityId:id,metadata:{problemId,bookingSource:source,oldStatus:found.status,newStatus:"resolved",note}});
    return {status:200,message:"تمت معالجة المشكلة وحفظها في السجل"};
  });
}
