import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

assert.ok(existsSync("lib/db/src/schema/customer-followups.ts"), "feature-owned followup schema must exist");
assert.ok(existsSync("lib/db/migrations/0134_customer_followups.sql"), "one isolated additive followup migration must exist");
const { customerFollowupsTable, customerFollowupEventsTable, customerFollowupContactPreferencesTable } = await import("../lib/db/src/schema/customer-followups");
const dialect = new PgDialect();
const followups = getTableConfig(customerFollowupsTable);
const events = getTableConfig(customerFollowupEventsTable);
const consent = getTableConfig(customerFollowupContactPreferencesTable);
assert.equal(followups.name, "customer_followups");
assert.equal(events.name, "customer_followup_events");
assert.equal(consent.name, "customer_followup_contact_preferences");
for (const column of ["customer_id", "assigned_staff_id", "followup_at", "create_token", "payload_hash", "version", "created_by"]) {
  assert.equal(followups.columns.find((item) => item.name === column)?.notNull, true, `${column} is required`);
}
for (const column of ["followup_at", "completed_at", "created_at", "updated_at"]) {
  assert.equal(followups.columns.find((item) => item.name === column)?.getSQLType(), "timestamp with time zone");
}
const openPair = followups.indexes.find((item) => item.config.name === "customer_followups_open_pair_uq");
assert.ok(openPair?.config.unique, "customer/service active-pair uniqueness is durable");
assert.match(dialect.sqlToQuery(openPair!.config.where!).sql, /completed_at.*IS NULL.*status.*IN.*interested.*waiting/i);
assert.ok(followups.indexes.find((item) => item.config.name === "customer_followups_create_token_uq")?.config.unique);
assert.ok(followups.indexes.find((item) => item.config.name === "customer_followups_suggestion_uq")?.config.unique);
assert.ok(events.indexes.find((item) => item.config.name === "customer_followup_events_request_uq")?.config.unique);
assert.ok(followups.foreignKeys.some((item) => item.reference().foreignTable === customerFollowupsTable), "completion successor points to the original row");
assert.ok(followups.foreignKeys.every((item) => item.onDelete === "restrict"), "history cannot disappear with parent records");
const checks = followups.checks.map((item) => dialect.sqlToQuery(item.value).sql).join("\n");
assert.match(checks, /converted.*booking_source.*booking_id/i);
assert.match(checks, /version.*> 0/i);
assert.match(checks, /source_booking_source.*source_booking_id/i);
assert.match(checks, /booking_confirmation/);
assert.equal(consent.columns.find((item) => item.name === "customer_id")?.primary, true);
assert.equal(consent.columns.find((item) => item.name === "contact_blocked")?.default, false);
const migration = readFileSync("lib/db/migrations/0134_customer_followups.sql", "utf8");
assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER)\b/im, "migration is strictly additive");
assert.equal((migration.match(/CREATE TABLE IF NOT EXISTS/gi) ?? []).length, 3);
for (const relation of ["customers", "staff", "customer_followups"]) assert.match(migration, new RegExp(`REFERENCES \\"${relation}\\"`));
for (const catalog of ["information_schema.columns", "pg_indexes", "pg_constraint"]) assert.ok(migration.includes(catalog), `${catalog} verifies created shape`);
assert.match(migration, /actual\.indisunique\s+AND actual\.indisvalid/, "migration verifies unique indexes are usable rather than accepting a same-name nonunique index");
assert.match(migration, /pg_get_indexdef\(actual\.indexrelid,\s*expected_column\.ordinality::integer,\s*true\)/, "migration verifies each indexed column in order");
assert.match(migration, /pg_get_expr\(actual\.indpred, actual\.indrelid\)/, "migration verifies partial-index predicates");
assert.match(migration, /actual\.conkey = ARRAY\[local_column\.attnum\]/, "each foreign key checks its local column");
assert.match(migration, /actual\.confkey = ARRAY\[foreign_column\.attnum\]/, "each foreign key checks its referenced column");
assert.match(migration, /actual\.confdeltype = 'r'/, "every expected foreign key rejects deletion");
assert.match(migration, /actual\.character_maximum_length = expected\.max_length/, "migration verifies varchar lengths used by durable request keys");
assert.match(migration, /pg_get_constraintdef\(actual\.oid\)/, "migration verifies CHECK definitions, not only names");
for (const tuple of [
  "('customer_followups', 'create_token', 100)",
  "('customer_followups', 'suggestion_key', 160)",
  "('customer_followups', 'payload_hash', 64)",
  "('customer_followup_events', 'request_token', 160)",
  "('customer_followup_events', 'payload_hash', 64)",
  "('customer_followups', 'parent_id', 'customer_followups', 'id')",
  "('customer_followup_events', 'followup_id', 'customer_followups', 'id')",
]) assert.ok(migration.includes(tuple), `migration checks exact expected shape ${tuple}`);
assert.match(migration, /RAISE EXCEPTION/);
assert.match(readFileSync("lib/db/src/schema/index.ts", "utf8"), /export \* from ["']\.\/customer-followups["']/);
console.log("PASS customer followup schema: restrictive identity, durable request/suggestion/open-pair uniqueness, consent and additive migration verification");
