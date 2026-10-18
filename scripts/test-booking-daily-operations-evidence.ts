import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { loadDailyOperations } from "../src/server/booking-daily-operations";
import { parseDailyOperationsFilters } from "../src/lib/booking-daily-operations";
const filters = parseDailyOperationsFilters(new URLSearchParams("search=أحمد&category=kosha&employee=8&vehicle=2&location=بغداد&status=installing"));
const queries:ReturnType<PgDialect["sqlToQuery"]>[]=[];
const executor={async execute(sql:any) {
  const q=new PgDialect().sqlToQuery(sql);queries.push(q);
  if(queries.length===1) return {rows:[{source:"kosha",id:12,number:"K-12",customer_name:"أحمد",event_date:"2026-10-18",event_time:"16:00",location:"بغداد",status:"confirmed",category:"kosha",details:{},assigned_staff_id:8,vehicle_id:2,vehicle_record_id:2,vehicle_name:"سيارة ٢",vehicle_active:true,vehicle_status:"maintenance",transportation_mode:"ajn",execution_stage:"INSTALLING",required_arrival_at:"2026-10-18T10:00:00Z",arrived_at:null}, {source:"service",id:12,number:"S-12",customer_name:"طالب",event_date:"2026-10-18",event_time:"18:00",location:"بغداد",status:"new",category:"photography",details:{assignedStaffIds:[9]},assigned_staff_id:null,vehicle_id:null}]};
  if(q.sql.includes("FROM staff")) return {rows:[{id:8,full_name:"حسين"},{id:9,full_name:"علي"}]};
  if(q.sql.includes("kosha_work_order_members")) return {rows:[{source_type:"kosha_booking",source_id:12,staff_id:8,accepted:true},{source_type:"service_order",source_id:12,staff_id:9,accepted:false}]};
  return {rows:[]};
}};
// The fake DB returns its authorized cohort regardless of SQL so the real SQL is
// inspected separately. It never replaces projection/acceptance business logic.
const result=await loadDailyOperations(executor,{...filters,category:"all",status:"all",search:"",location:"",employee:null,vehicle:null},["kosha","service"],new Date("2026-10-18T12:00:00Z"));
const native=result.rows.find(b=>b.source==="kosha")!;
const service=result.rows.find(b=>b.source==="service")!;
assert.equal(native.readiness.checks.find(c=>c.id==="staff-confirmation")?.state,"pass","native acceptance must reach the room");
assert.equal(service.readiness.checks.find(c=>c.id==="staff-confirmation")?.state,"fail","same numeric ID must not copy native acceptance into service");
assert.equal(native.readiness.checks.find(c=>c.id==="vehicle-condition")?.state,"fail");
assert.ok(native.issues.some(i=>i.kind==="late-arrival"));
const evidence=queries.find(q=>q.sql.includes("kosha_work_order_members"));
assert.ok(evidence?.sql.includes("removed_at") && evidence.sql.includes("declined_at") && evidence.sql.includes("rejected_at"));

queries.length=0;
await loadDailyOperations(executor,filters,["kosha"],new Date("2026-10-18T12:00:00Z"));
const base=queries[0];
for(const value of ["أحمد","kosha",8,2,"بغداد","installing"]) assert.ok(base.params.includes(value),`server query must apply ${value} before its cohort limit`);
assert.match(base.sql,/WHERE[\s\S]+ORDER BY[\s\S]+LIMIT/i);
assert.ok(base.sql.includes("kosha_work_order_members"),"filtering by work-order member must work before the cap");
assert.ok(!base.sql.includes("أحمد"),"search remains a query parameter, not SQL text");
console.log("PASS room evidence mappings, source identity, original acceptance and pre-limit SQL filters");
