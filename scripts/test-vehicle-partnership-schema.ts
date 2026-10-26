import assert from "node:assert/strict";
import {getTableName} from "drizzle-orm";
import {getTableConfig,PgDialect} from "drizzle-orm/pg-core";
import * as schema from "../lib/db/src/schema/vehicle-partnership";
const dialect=new PgDialect();
const names=["vehiclePartnershipsTable","vehiclePartnershipAgreementsTable","vehiclePartnershipMembersTable","vehiclePartnershipActivityTable","vehiclePartnershipCostFundingTable","vehiclePartnershipClosingsTable","vehiclePartnershipClosingLinesTable","vehiclePartnershipRightsTable","vehiclePartnershipSettlementAllocationsTable"] as const;
const configs=Object.fromEntries(names.map(name=>[name,getTableConfig(schema[name])]));
const indexed=(name:typeof names[number],columns:string[])=>configs[name].indexes.some(index=>index.config.unique&&columns.every(column=>index.config.columns.some((value:any)=>value.name===column)));
assert.ok(indexed("vehiclePartnershipsTable",["vehicle_id"]));
assert.ok(indexed("vehiclePartnershipsTable",["singleton_slot"]),"a second configured vehicle is rejected at the DB boundary");
assert.ok(configs.vehiclePartnershipsTable.foreignKeys.some(fk=>getTableName(fk.reference().foreignTable)==="fleet_vehicles"&&fk.onDelete==="restrict"));
const checks=(name:typeof names[number])=>configs[name].checks.map(check=>dialect.sqlToQuery(check.value).sql).join("\n");
assert.match(checks("vehiclePartnershipMembersTable"),/num_nonnulls[\s\S]*=\s*1/);
for(const column of ["ownership_basis_points","profit_basis_points","expense_basis_points"])assert.ok(checks("vehiclePartnershipMembersTable").includes(column));
assert.ok(indexed("vehiclePartnershipAgreementsTable",["partnership_id","revision"]));
assert.ok(indexed("vehiclePartnershipClosingsTable",["partnership_id","period"]));
assert.ok(indexed("vehiclePartnershipClosingLinesTable",["closing_id","revision","source_key"]));
assert.ok(indexed("vehiclePartnershipSettlementAllocationsTable",["financial_transaction_id","right_id","purpose"]));
assert.ok(indexed("vehiclePartnershipCostFundingTable",["vehicle_expense_id"]),"funding annotates one original cost, never another expense");
for(const name of ["vp_cost_expense_unique","vp_cost_employee_unique"]){
 const index=configs.vehiclePartnershipCostFundingTable.indexes.find(index=>index.config.name===name)!;
 assert.ok(index.config.where,"one ACTIVE source is unique; rejected/reversed source history must not permanently prevent a corrected request");
 assert.match(dialect.sqlToQuery(index.config.where!).sql,/status.*pending.*approved/);
}
assert.ok(configs.vehiclePartnershipRightsTable.foreignKeys.some(fk=>{
 const ref=fk.reference();return ref.columns.map(column=>column.name).join(",")==="member_id,agreement_id";
}),"a right cannot use a member from another dated agreement");
assert.match(checks("vehiclePartnershipRightsTable"),/closing_line_id[\s\S]*IS NOT NULL/);
// Composite FK targets must be inline UNIQUE constraints. An index emitted after
// ALTER ... ADD FOREIGN KEY by the migration exporter is too late for PostgreSQL.
for(const name of ["vehiclePartnershipAgreementsTable","vehiclePartnershipMembersTable","vehiclePartnershipCostFundingTable","vehiclePartnershipClosingLinesTable"] as const)assert.ok(configs[name].uniqueConstraints.some(constraint=>constraint.columns[0]?.name==="id"&&constraint.columns.length>1),`${name} composite FK target must exist when its table is created`);
assert.match(checks("vehiclePartnershipActivityTable"),/num_nonnulls/);
assert.ok(configs.vehiclePartnershipRightsTable.columns.some(column=>column.name==="source_snapshot"&&column.notNull),"capital entry date/source evidence belongs in immutable right metadata, not a fabricated creation timestamp");
assert.ok(configs.vehiclePartnershipCostFundingTable.columns.some(column=>column.name==="source_snapshot"&&column.notNull),"historical costs need original immutable evidence, not the mutable employee entitlement amount");
assert.ok(configs.vehiclePartnershipActivityTable.foreignKeys.some(fk=>getTableName(fk.reference().foreignTable)==="service_orders"));
assert.ok(configs.vehiclePartnershipSettlementAllocationsTable.foreignKeys.some(fk=>getTableName(fk.reference().foreignTable)==="financial_transactions"));
for(const name of names){
 const config=configs[name];
 for(const fk of config.foreignKeys)assert.equal(fk.onDelete,"restrict","partnership history must never cascade away");
 for(const column of config.columns.filter(column=>/amount|contribution/.test(column.name)))assert.equal(column.getSQLType(),"numeric(16, 2)",`${name}.${column.name}`);
 assert.ok(config.columns.some(column=>column.name==="created_at"&&column.notNull));
}
console.log("PASS partnership Drizzle schema contracts: singleton vehicle, original FKs, typed parties, independent percentage bounds, source/closing/payment uniqueness and exact numeric types");
console.log("LIMITATION: schema metadata contracts only; actual PostgreSQL constraints and migration execution require separately verified TEST DB, not claimed here.");
