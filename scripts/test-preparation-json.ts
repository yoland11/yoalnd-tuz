import assert from "node:assert/strict";
import {PgDialect} from "drizzle-orm/pg-core";
import {savePreparationMeta} from "../src/server/booking-preparation-update";
const dialect=new PgDialect();
for(const source of ["kosha","service"] as const){
 const column=source==="kosha"?"booking_details":"custom_fields";
 await savePreparationMeta({execute:async(q:any)=>{const statement=dialect.sqlToQuery(q);assert.ok(statement.sql.includes(`nullif(${column},'null'::jsonb)`),"JSON null root must become an object before jsonb_set");assert.ok(statement.sql.includes(`nullif(${column}->'bookingOperations','null'::jsonb)`),"legacy JSON null operations must not concatenate into an array");assert.deepEqual(JSON.parse(statement.params[0] as string),{"asset:44":{prep:{taskId:71}}});return {rows:[{id:12}]}}},{source,id:12},{"asset:44":{prep:{taskId:71}}});
}
console.log("PASS original preparation emitted SQL normalizes legacy JSON null for both booking sources; real PostgreSQL execution remains separately guarded");
