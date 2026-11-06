import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { baghdadDate, baghdadMoment } from "../src/lib/attendance-rules";
import { createKiosk, createShifts, kioskDisplay, recordAttendance, saveEmployeeSettings, saveLocation } from "../src/server/attendance";
import {
  approveGeofenceException,
  closeGeofenceForCheckout,
  geofenceDashboard,
  geofenceMe,
  markGeofenceUnavailable,
  recordGeofenceSample,
  reviewGeofenceVisit,
  setGeofenceConsent,
  sweepGeofenceHistory,
} from "../src/server/attendance-geofence";

// @ts-expect-error shared fail-closed JavaScript test guard
import { assertSafeTestDatabase } from "./lib/test-database-guard.mjs";

let url: string;
try {
  url = assertSafeTestDatabase(process.env).url;
} catch (cause) {
  if (process.env.TEST_DATABASE_URL || process.argv.includes("--strict")) throw cause;
  console.log("SKIPPED attendance geofence PostgreSQL integration: isolated TEST database and write flags required (not PASS)");
  process.exit(0);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const schema = `attendance_geo_test_${randomBytes(12).toString("hex")}`;
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA "${schema}"`);
  // Exclude public and roll back all changes, including the schema itself.
  await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query(`
    create table staff (
      id serial primary key, username text not null unique, full_name text not null, is_active boolean not null default true
    );
    create table warehouses (id serial primary key, name text not null);
    create table admin_sessions (
      id serial primary key, user_id integer not null references staff(id), portal varchar(24),
      expires_at timestamp not null, revoked_at timestamp
    );
    create table attendance_records (
      id serial primary key, staff_id integer not null references staff(id), check_in_at timestamp not null,
      check_out_at timestamp, status varchar(20) not null, notes text,
      created_at timestamp not null default now(), updated_at timestamp not null default now()
    );
    create table settings (key text primary key, value jsonb);
    create table employee_salary_settings (staff_id integer primary key, shift_start time, shift_end time, weekly_days_off jsonb);
    create table hr_incentive_events (id serial primary key, source_type text, source_id integer);
    create table entity_timeline (
      id serial primary key, entity_type text not null, entity_id integer not null, type text not null,
      title text not null, actor_id integer, actor_name text not null, metadata jsonb not null
    );
    create table payroll_runs (id serial primary key);
    create table payroll_lines (id serial primary key, net_salary numeric not null);
    create table financial_transactions (id serial primary key, amount numeric not null);
    create table test_exit_notifications (visit_id integer primary key, staff_id integer not null);
    insert into payroll_runs default values;
    insert into payroll_lines (net_salary) values (123000);
    insert into financial_transactions (amount) values (321000);
  `);
  const migration = (name: string) => readFileSync(`lib/db/migrations/${name}`, "utf8");
  await client.query(migration("0133_attendance_system.sql"));
  const db = drizzle(client);
  const rows = async (query: SQL) => (await db.execute(query)).rows;
  const [staff] = await rows(sql`
    insert into staff (username, full_name) values ('geo_employee', 'أحمد مراد') returning id
  `);
  const staffId = Number(staff.id);
  const actor = { id: null, name: "مدير الحضور" };
  const date = baghdadDate(Date.now() - 3 * 86_400_000);
  const startedAt = baghdadMoment(date, "09:00").getTime();
  const at = (seconds: number) => startedAt + seconds * 1000;
  const center = { latitude: 34.888, longitude: 44.633 };
  const locationId = await saveLocation(db, null, { name: "المحل", ...center, requiredMethod: "qr" }, actor);
  assert.equal((await rows(sql`select radius_meters from attendance_locations where id = ${locationId}`))[0].radius_meters, 100);
  await saveEmployeeSettings(db, staffId, { enabled: true, primaryLocationId: locationId, scheduleType: "rotating", requiredMethod: "qr" }, actor);
  const { created: [shiftId] } = await createShifts(db, { staffId, locationId, date, start: "09:00", end: "17:00" }, actor);
  const kiosk = await createKiosk(db, { locationId }, actor);
  const [session] = await rows(sql`
    insert into admin_sessions (user_id, portal, expires_at)
    values (${staffId}, 'staff', (${new Date(at(60_000)).toISOString()}::timestamptz at time zone 'UTC')) returning id
  `);
  const authSessionId = String(session.id);
  const checkInCode = (await kioskDisplay(db, kiosk.deviceToken, at(0))).code;
  const checkIn = await recordAttendance(db, staffId, { action: "check_in", qrCode: checkInCode, shiftId }, at(0));
  assert.equal(checkIn.method, "qr");
  await assert.rejects(geofenceMe(db, staffId, authSessionId, at(1)), { code: "ATTENDANCE_GEOFENCE_NOT_READY" });
  await client.query(migration("0135_attendance_geofence.sql"));
  const [privacy] = await rows(sql`
    select count(*)::int as protected_tables from pg_class
    where relrowsecurity and oid in (
      to_regclass('attendance_geofence_sessions'), to_regclass('attendance_geofence_visits'),
      to_regclass('attendance_geofence_exceptions')
    )
  `);
  assert.equal(privacy.protected_tables, 3, "direct database API roles have no geofence row policy");

  const record = { staffId, recordId: checkIn.recordId, authSessionId };
  const payroll = () => rows(sql`
    select (select count(*)::int from payroll_runs) as runs,
      (select sum(net_salary) from payroll_lines) as salary,
      (select sum(amount) from financial_transactions) as money
  `);
  const initialPayroll = await payroll();
  const notifications = () => rows(sql`select visit_id, staff_id from test_exit_notifications order by visit_id`);
  const onExit: NonNullable<Parameters<typeof recordGeofenceSample>[2]> = async (tx, visit) => {
    assert.equal(visit.staffId, staffId);
    assert.equal(visit.staffName, "أحمد مراد");
    await tx.execute(sql`insert into test_exit_notifications (visit_id, staff_id) values (${visit.id}, ${visit.staffId})`);
  };
  const outside = (second: number, callback = onExit) => recordGeofenceSample(db, {
    ...record, observedAt: at(second), latitude: 34.89, longitude: 44.633, accuracy: 10,
  }, callback, at(second));

  assert.equal((await outside(1)).consented, false);
  assert.deepEqual(await notifications(), []);
  await assert.rejects(setGeofenceConsent(db, { ...record, authSessionId: null, consent: true }, at(1)), { code: "PERMISSION_DENIED" });
  assert.equal((await setGeofenceConsent(db, { ...record, consent: true }, at(1))).consented, true);
  assert.equal((await geofenceMe(db, staffId, null, at(1))).eligible, false, "web clients can only view or withdraw their consent");

  for (const second of [2, 60, 120, 180]) await outside(second);
  const exception = { staffId, kind: "delivery" as const, startsAt: at(240), endsAt: at(360), reason: "توصيل معتمد" };
  const approved = await approveGeofenceException(db, exception, actor);
  assert.deepEqual(await approveGeofenceException(db, exception, actor), approved, "an exception retry reuses the same record");
  assert.equal((await outside(240)).status, "exempt");
  assert.equal((await outside(300)).status, "exempt");
  for (const second of [360, 420, 480, 540, 600, 659]) await outside(second);
  assert.deepEqual(await notifications(), [], "an approved delivery breaks the five-minute evidence run");

  await client.query("SAVEPOINT retry_exit");
  await assert.rejects(outside(660, async (tx, visit) => {
    await onExit(tx, visit);
    throw new Error("simulate an interrupted commit");
  }), /interrupted commit/);
  await client.query("ROLLBACK TO SAVEPOINT retry_exit");
  await client.query("RELEASE SAVEPOINT retry_exit");
  assert.deepEqual(await notifications(), [], "rolling back the visit also rolls back its notification");
  assert.equal((await outside(660)).status, "outside");
  assert.equal((await outside(660)).status, "outside");
  assert.equal((await notifications()).length, 1, "replaying the confirming sample cannot re-alert");
  const open = await geofenceDashboard(db, { date, staffId }, at(660));
  assert.equal(open.statuses[0].status, "outside");
  assert.equal(open.visits[0].exitAt, at(360));
  assert.equal(open.visits[0].verification, "ongoing");
  assert.equal(open.visits[0].workplace, "المحل");
  assert.equal(open.exceptions[0].id, approved.id);

  assert.equal((await recordGeofenceSample(db, { ...record, ...center, accuracy: 10, observedAt: at(720) }, onExit, at(720))).status, "returned");
  const returned = (await geofenceDashboard(db, { date, staffId }, at(720))).visits[0];
  assert.equal(returned.returnAt, at(720));
  assert.equal(returned.outsideSeconds, 360);
  assert.equal(returned.verification, "verified");
  await reviewGeofenceVisit(db, returned.id, { approved: true, note: "تمت المراجعة" }, actor);
  assert.equal((await geofenceDashboard(db, { date, staffId }, at(720))).visits[0].reviewStatus, "approved");

  for (const second of [750, 810, 870, 930, 990, 1050]) await outside(second);
  assert.equal((await notifications()).length, 2);
  assert.equal((await markGeofenceUnavailable(db, record, at(1080))).status, "unavailable");
  const checkOutCode = (await kioskDisplay(db, kiosk.deviceToken, at(1140))).code;
  const checkout = await recordAttendance(db, staffId, { action: "check_out", qrCode: checkOutCode }, at(1140));
  await closeGeofenceForCheckout(db, staffId, checkout.recordId, checkout.atMs);
  const final = await geofenceDashboard(db, { date, staffId }, at(1140));
  assert.equal(final.statuses[0].status, "checked_out");
  assert.equal(final.visits[0].verification, "interrupted");
  assert.equal(final.visits[0].endedAt, at(1050), "unverified GPS downtime is not counted until checkout");
  assert.equal(final.visits[0].returnAt, null, "checkout cannot imply a verified return");
  assert.equal((await outside(1200)).status, "checked_out");
  assert.equal((await notifications()).length, 2);

  assert.deepEqual(await sweepGeofenceHistory(db, 1), { visitsRemoved: 2, sessionsRemoved: 1, exceptionsRemoved: 1 });
  assert.deepEqual((await geofenceDashboard(db, { date, staffId }, at(1140))).visits, []);
  assert.deepEqual(await payroll(), initialPayroll, "review and retention cannot touch payroll or cash");
  assert.deepEqual(await rows(sql`
    select (select count(*)::int from attendance_records) as records,
      (select count(*)::int from attendance_verifications) as punches
  `), [{ records: 1, punches: 2 }], "the original attendance record and its two punch verifications survive");
  console.log("PASS attendance geofence PostgreSQL migration, consent, exception, retry, visit, checkout, retention and payroll isolation");
} finally {
  try {
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}
