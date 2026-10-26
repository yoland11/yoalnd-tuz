import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {assertSafeTestDatabase} from "./lib/test-database-guard.mjs";

let target;
try{target=assertSafeTestDatabase(process.env);}catch{
 console.log("SKIPPED: partnership PostgreSQL migration/constraint tests — separate verified TEST database and write flags unavailable.");
 if(process.argv.includes("--strict"))process.exit(2);
 process.exit(0);
}
const {Client}=createRequire(resolve("lib/db/node_modules/pg/package.json"))("pg");
const client=new Client({connectionString:target.url,connectionTimeoutMillis:10000});
const ownedSchema=`ajn_vp_${randomUUID().replaceAll("-","")}`;
assert.match(ownedSchema,/^ajn_vp_[a-f0-9]{32}$/);
let inTransaction=false;
await client.connect();
try{
 assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name,target.database,"connected target must match the guarded TEST database");
 await client.query("BEGIN");inTransaction=true;
 await client.query(`CREATE SCHEMA "${ownedSchema}"`);
 await client.query(`SET LOCAL search_path TO "${ownedSchema}"`);
 // Minimal run-owned parents exercise the real feature FKs without inserting
 // into any pre-existing/public source table. All data is synthetic and local
 // to this exact transaction; no database or persistent fixture is created.
 const parents=["fleet_vehicles","staff","customers","suppliers","kosha_bookings","service_orders","delivery_orders","vehicle_expenses","employee_finance_entries","financial_transactions"];
 for(const name of parents){
  await client.query(`CREATE TABLE "${name}" (id integer PRIMARY KEY, label text NOT NULL)`);
  await client.query(`INSERT INTO "${name}" (id,label) VALUES (1,'synthetic-1'),(2,'synthetic-2'),(3,'synthetic-3'),(7,'synthetic-7'),(12,'synthetic-12')`);
 }
 const before=(await client.query('SELECT id,label FROM fleet_vehicles ORDER BY id')).rows;
 const migration=readFileSync("lib/db/migrations/0129_vehicle_partnership.sql","utf8").replaceAll('REFERENCES "public".',`REFERENCES "${ownedSchema}".`);
 await client.query(migration);
 assert.deepEqual((await client.query('SELECT id,label FROM fleet_vehicles ORDER BY id')).rows,before,"original parent fixtures survive unchanged");
 const expectFailure=async(statement,values,code)=>{
  await client.query("SAVEPOINT expected_failure");let observed;
  try{await client.query(statement,values);}catch(error){observed=error.code;}
  finally{await client.query("ROLLBACK TO SAVEPOINT expected_failure");await client.query("RELEASE SAVEPOINT expected_failure");}
  assert.equal(observed,code,`expected PostgreSQL rejection ${code}`);
 };
 await client.query("INSERT INTO vehicle_partnerships (id,vehicle_id,ownership_type,registration_owner,reason) VALUES (1,12,'partnership','Synthetic company','test')");
 await expectFailure("INSERT INTO vehicle_partnerships (id,vehicle_id,ownership_type,registration_owner,reason) VALUES (2,2,'partnership','Synthetic company','test')",[],"23505");
 await expectFailure("INSERT INTO vehicle_partnerships (id,vehicle_id,ownership_type,reason) VALUES (2,2,'partnership','test')",[],"23502");
 await client.query("INSERT INTO vehicle_partnership_agreements (id,partnership_id,revision,effective_from,idempotency_key,reason) VALUES (1,1,1,'2026-10-01','agreement-1','test'),(2,1,2,'2026-11-01','agreement-2','test')");
 const memberSql="INSERT INTO vehicle_partnership_members (id,agreement_id,party_kind,customer_id,supplier_id,staff_id,ownership_basis_points,profit_basis_points,expense_basis_points,capital_contribution,reason) VALUES ($1,$2,$3,$4,$5,$6,5000,$7,5000,'10000000.00','test')";
 await client.query(memberSql,[1,1,"customer",1,null,null,5000]);
 await client.query(memberSql,[2,1,"supplier",null,2,null,5000]);
 await client.query(memberSql,[3,2,"staff",null,null,3,5000]);
 await expectFailure(memberSql,[4,1,"customer",3,1,null,5000],"23514");
 await expectFailure(memberSql,[4,1,"customer",3,null,null,10001],"23514");
 await expectFailure(memberSql,[4,1,"customer",999,null,null,5000],"23503");
 await expectFailure("INSERT INTO vehicle_partnership_rights (partnership_id,agreement_id,member_id,category,direction,amount,event_key,reason) VALUES (1,1,3,'capital','credit',1,'wrong-member','test')",[],"23503");
 const fundingSql="INSERT INTO vehicle_partnership_cost_funding (id,partnership_id,vehicle_expense_id,employee_finance_entry_id,funding_kind,cost_class,source_digest,idempotency_key,reason) VALUES ($1,1,$2,$3,'other','operating',$4,$5,'test')";
 await client.query(fundingSql,[101,1,1,"a".repeat(64),"cost-funding-101"]);
 await expectFailure(fundingSql,[102,1,2,"b".repeat(64),"cost-funding-102"],"23505");
 await expectFailure(fundingSql,[103,2,1,"c".repeat(64),"cost-funding-103"],"23505");
 await client.query("UPDATE vehicle_partnership_cost_funding SET status='rejected' WHERE id=101");
 await client.query(fundingSql,[104,1,1,"d".repeat(64),"cost-funding-104"]);
 assert.equal((await client.query("SELECT count(*)::int AS count FROM vehicle_partnership_cost_funding WHERE vehicle_expense_id=1")).rows[0].count,2,"rejected source history survives the one active corrected source");
 await client.query("INSERT INTO vehicle_partnership_closings (id,partnership_id,period,idempotency_key,reason) VALUES (1,1,'2026-10-01','closing-1','test')");
 await expectFailure("INSERT INTO vehicle_partnership_closings (partnership_id,period,idempotency_key,reason) VALUES (1,'2026-10-01','closing-duplicate','test')",[],"23505");
 await expectFailure("INSERT INTO vehicle_partnership_closings (partnership_id,period,idempotency_key,reason) VALUES (1,'2026-10-02','closing-day','test')",[],"23514");
 await client.query("INSERT INTO vehicle_partnership_closing_lines (id,closing_id,revision,source_key,line_kind,agreement_id,member_id,amount,snapshot,reason) VALUES (1,1,1,'profit:member:1','profit_allocation',1,1,50,'{}','test')");
 await client.query("INSERT INTO vehicle_partnership_rights (id,partnership_id,agreement_id,member_id,closing_line_id,category,direction,amount,status,event_key,reason) VALUES (1,1,1,1,1,'profit','credit',50,'approved','profit:closing:1:member:1','test')");
 await client.query("INSERT INTO vehicle_partnership_settlement_allocations (right_id,financial_transaction_id,purpose,amount,idempotency_key,reason) VALUES (1,1,'distribution',25,'distribution-1','test')");
 await expectFailure("INSERT INTO vehicle_partnership_settlement_allocations (right_id,financial_transaction_id,purpose,amount,idempotency_key,reason) VALUES (1,1,'distribution',25,'distribution-duplicate','test')",[],"23505");
 assert.equal((await client.query("SELECT 0.10::numeric(16,2)+0.20::numeric(16,2) AS amount")).rows[0].amount,"0.30");
 await expectFailure("SELECT 100000000000000::numeric(16,2)",[],"22003");
 await client.query("ROLLBACK");inTransaction=false;
 assert.equal((await client.query("SELECT to_regnamespace($1) AS owned",[ownedSchema])).rows[0].owned,null,"ROLLBACK removes only this run's uncommitted schema/data");
 console.log("PASS isolated TEST PostgreSQL: real feature migration, original fixture preservation, unique/check/FK/numeric constraints, cross-agreement refusal and full transaction rollback (run-owned schema only).");
}finally{if(inTransaction)await client.query("ROLLBACK");await client.end();}
