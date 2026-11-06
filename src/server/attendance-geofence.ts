import { sql, type SQL } from "drizzle-orm";
import {
  classifyGeofenceSample,
  evaluateGeofenceSample,
  geofenceEvidenceStatus,
  geofenceWindow,
  GEOFENCE_SAMPLE_GAP_MS,
  type GeofenceEvidence,
  type GeofenceOpenVisit,
  type GeofenceState,
} from "../lib/attendance-geofence";
import { addDays, baghdadDate, baghdadMoment, toMs, type GpsEvidence, type GpsLocation, type ScheduleInput } from "../lib/attendance-rules";
import { AttendanceError, rowsOf, scheduleContexts, type AttendanceActor, type Executor } from "./attendance";

const dateTime = (ms: number) => new Date(ms).toISOString();
const instant = (ms: number) => sql`${dateTime(ms)}::timestamptz`;
const utcTime = (ms: number) => sql`(${instant(ms)} at time zone 'utc')`;
const inactive: GeofenceState = { recordId: null, eligible: false, consented: false, status: "inactive", workplace: null, startsAt: null, endsAt: null };
const lockStaff = (tx: Executor, staffId: number) => tx.execute(sql`select pg_advisory_xact_lock(${staffId})`);

async function schemaReady(tx: Executor) {
  const [row] = rowsOf(await tx.execute(sql`
    select to_regclass('attendance_geofence_sessions') is not null
      and to_regclass('attendance_geofence_visits') is not null
      and to_regclass('attendance_geofence_exceptions') is not null as ready
  `));
  return row?.ready === true;
}

async function requireSchema(tx: Executor) {
  if (!await schemaReady(tx)) throw new AttendanceError("متابعة نطاق العمل غير متاحة حالياً", 503, "ATTENDANCE_GEOFENCE_NOT_READY");
}

function sessionKey(value?: string | null) {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= 2147483647 ? id : null;
}

function authSessionRequired() {
  return new AttendanceError("تحتاج متابعة نطاق العمل إلى جلسة نشطة في تطبيق الموظف", 403, "PERMISSION_DENIED");
}

/** Use the same authoritative open record as punch admission, including overnight records. */
async function readScopes(tx: Executor, now: number, condition: SQL) {
  return rowsOf(await tx.execute(sql`
    select distinct on (r.staff_id) r.id, r.staff_id, r.check_in_at, r.check_out_at, r.method, r.shift_id,
      coalesce(nullif(st.full_name, ''), st.username) as staff_name,
      l.name as workplace, l.is_active as workplace_active, l.latitude, l.longitude, l.radius_meters, l.max_accuracy_meters,
      s.kind as shift_kind, s.start_at as shift_start, s.end_at as shift_end, s.status as shift_status,
      g.auth_session_id, g.consented_at, g.revoked_at, g.ends_at as consent_ends_at, g.status as evidence_status,
      g.last_observed_at, g.last_received_at, g.last_trusted_at, g.outside_since, g.outside_since_received_at,
      a.id is not null and st.is_active as session_live, coalesce(settings.enabled, false) and st.is_active as employee_enabled,
      greatest(l.updated_at, settings.updated_at, s.updated_at) as configuration_updated_at,
      v.id as visit_id, v.outside_ms as visit_outside_ms, v.verification as visit_verification,
      exists (
        select 1 from attendance_geofence_exceptions x where x.staff_id = r.staff_id
          and x.starts_at <= ${instant(now)} and x.ends_at > ${instant(now)}
          and (x.revoked_at is null or x.revoked_at > ${instant(now)})
        union all
        select 1 from attendance_shifts e where e.staff_id = r.staff_id
          and e.kind = 'event' and e.status = 'scheduled' and e.start_at <= ${instant(now)} and e.end_at > ${instant(now)}
      ) as exempt_now,
      exists (
        select 1 from attendance_geofence_exceptions x where x.staff_id = r.staff_id
          and x.starts_at <= ${instant(now)}
          and least(x.ends_at, coalesce(x.revoked_at, x.ends_at)) > greatest(g.last_received_at, x.starts_at)
          and g.last_received_at is not null
        union all
        select 1 from attendance_shifts e where e.staff_id = r.staff_id
          and e.kind = 'event' and e.status = 'scheduled' and e.start_at <= ${instant(now)} and e.end_at > g.last_received_at
      ) as exemption_since_sample
    from attendance_records r
    join staff st on st.id = r.staff_id
    left join attendance_employee_settings settings on settings.staff_id = r.staff_id
    left join attendance_locations l on l.id = r.location_id
    left join attendance_shifts s on s.id = r.shift_id and s.staff_id = r.staff_id
    left join attendance_geofence_sessions g on g.record_id = r.id
    left join admin_sessions a on a.id = g.auth_session_id and a.user_id = r.staff_id and a.portal = 'staff'
      and a.expires_at > ${utcTime(now)} and (a.revoked_at is null or a.revoked_at > ${utcTime(now)})
    left join attendance_geofence_visits v on v.record_id = r.id and v.ended_at is null
    where r.check_in_at <= ${utcTime(now)} and r.status in ('present', 'late', 'out') and (${condition})
    order by r.staff_id, (r.check_out_at is null or r.check_out_at > ${utcTime(now)}) desc, r.check_in_at desc, r.id desc
  `));
}

function isQrPunch(row: any) {
  return row.method === "qr" || row.method === "qr_gps";
}

function isOpenAt(row: any, now: number) {
  const checkout = toMs(row.check_out_at);
  return checkout == null || checkout > now;
}

function configuredLocation(row: any): GpsLocation | null {
  if (row.workplace_active !== true || row.latitude == null || row.longitude == null) return null;
  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: Number(row.radius_meters),
    maxAccuracyMeters: Number(row.max_accuracy_meters),
  };
}

function evidenceFromRow(row: any): GeofenceEvidence {
  return {
    status: row.evidence_status ?? "unavailable",
    observedAt: toMs(row.last_observed_at),
    receivedAt: toMs(row.last_received_at),
    lastTrustedAt: toMs(row.last_trusted_at),
    outsideSince: toMs(row.outside_since),
    outsideSinceReceivedAt: toMs(row.outside_since_received_at),
  };
}

function evidenceInterrupted(row: any, now: number) {
  const last = toMs(row.last_received_at);
  const updated = toMs(row.configuration_updated_at);
  return row.exemption_since_sample === true || (last != null && updated != null && updated > last && updated <= now);
}

function scopeState(row: any, schedule: ScheduleInput | undefined, now: number, authSessionId: number | null): GeofenceState {
  if (!row) return inactive;
  const record = { ...inactive, recordId: Number(row.id), workplace: row.workplace ?? null };
  if (!isOpenAt(row, now)) return { ...record, status: isQrPunch(row) ? "checked_out" : "inactive" };
  const consentEndsAt = toMs(row.consent_ends_at);
  const consentedAt = toMs(row.consented_at);
  const revokedAt = toMs(row.revoked_at);
  const activeConsent = row.session_live === true && consentedAt != null && consentedAt <= now
    && consentEndsAt != null && consentEndsAt > now && (revokedAt == null || revokedAt > now);
  const consented = activeConsent && (authSessionId == null || Number(row.auth_session_id) === authSessionId);
  const checkInAt = toMs(row.check_in_at);
  const shiftStart = toMs(row.shift_start), shiftEnd = toMs(row.shift_end);
  const shift = shiftStart == null || shiftEnd == null ? null : { startMs: shiftStart, endMs: shiftEnd, status: row.shift_status };
  const effectiveSchedule = schedule ?? { enabled: row.employee_enabled, scheduleType: "flexible", shiftStart: null, shiftEnd: null, weeklyDaysOff: [], graceMinutes: 0 };
  const window = checkInAt != null && isQrPunch(row) && (row.shift_id == null || shift != null)
    ? geofenceWindow({ checkInAt, schedule: effectiveSchedule, shift })
    : null;
  const endsAt = window && activeConsent ? Math.min(window.endsAt, consentEndsAt) : window?.endsAt ?? null;
  const startsAt = window?.startsAt ?? null;
  if (row.exempt_now === true) return { ...record, startsAt, endsAt, status: "exempt", consented };
  if (row.shift_kind === "event" || startsAt == null || endsAt == null || now < startsAt || now >= endsAt) {
    return { ...record, startsAt, endsAt, consented };
  }
  if (!configuredLocation(row)) return { ...record, startsAt, endsAt, consented, status: "unavailable" };
  const evidence = evidenceFromRow(row);
  const status = activeConsent && !evidenceInterrupted(row, now) && (evidence.receivedAt ?? Infinity) <= now
    ? geofenceEvidenceStatus(evidence, now) : "unavailable";
  return { ...record, startsAt, endsAt, consented, status, eligible: authSessionId != null };
}

async function readStaffScope(tx: Executor, staffId: number, authSessionId: number | null, now: number) {
  const dayStart = baghdadMoment(baghdadDate(now), "00:00").getTime();
  const [row] = await readScopes(tx, now, sql`r.staff_id = ${staffId} and (r.check_out_at is null or r.check_out_at >= ${utcTime(dayStart)})`);
  const contexts = row && row.shift_id == null && isQrPunch(row) && isOpenAt(row, now) && row.employee_enabled === true
    ? await scheduleContexts(tx, [staffId]) : null;
  return { row, state: scopeState(row, contexts?.get(staffId)?.schedule, now, authSessionId) };
}

export async function geofenceMe(tx: Executor, staffId: number, authSessionId?: string | null, nowMs = Date.now()) {
  await requireSchema(tx);
  return (await readStaffScope(tx, staffId, sessionKey(authSessionId), nowMs)).state;
}

async function interruptVisit(tx: Executor, recordId: number, at: number) {
  await tx.execute(sql`
    update attendance_geofence_visits v
    set ended_at = greatest(v.exit_at, least(${instant(at)}, g.ends_at, g.last_trusted_at)), verification = 'interrupted'
    from attendance_geofence_sessions g
    where v.record_id = ${recordId} and v.ended_at is null and g.record_id = v.record_id
  `);
}

async function resetConsent(tx: Executor, recordId: number, at: number) {
  await tx.execute(sql`
    update attendance_geofence_sessions
    set revoked_at = coalesce(revoked_at, ${instant(at)}), status = 'unavailable', outside_since = null, outside_since_received_at = null
    where record_id = ${recordId} and revoked_at is null
  `);
}

type StaffRecord = { staffId: number; authSessionId: string | null; recordId: number };

async function requireActiveNativeSession(tx: Executor, staffId: number, authId: number, now: number) {
  const [nativeSession] = rowsOf(await tx.execute(sql`
    select id from admin_sessions
    where id = ${authId} and user_id = ${staffId} and portal = 'staff' and revoked_at is null and expires_at > ${utcTime(now)}
    for share
  `));
  if (!nativeSession) throw authSessionRequired();
}

export async function setGeofenceConsent(tx: Executor, input: StaffRecord & { consent: boolean }, nowMs?: number): Promise<GeofenceState> {
  await requireSchema(tx);
  const authId = sessionKey(input.authSessionId);
  if (input.consent && authId == null) throw authSessionRequired();
  await lockStaff(tx, input.staffId);
  const now = nowMs ?? Date.now();
  const { row, state } = await readStaffScope(tx, input.staffId, authId, now);
  if (state.recordId !== input.recordId) throw new AttendanceError("تغير تسجيل الحضور؛ حدّث الصفحة", 409, "CONFLICT");
  if (!input.consent) {
    await resetConsent(tx, input.recordId, now);
    await interruptVisit(tx, input.recordId, Math.min(now, state.endsAt ?? now));
    return { ...state, consented: false, status: ["inside", "outside", "returned"].includes(state.status) ? "unavailable" : state.status };
  }
  if (!state.eligible || state.endsAt == null) throw new AttendanceError("لا توجد جلسة حضور مؤهلة لمتابعة نطاق العمل الآن", 409, "CONFLICT");
  if (authId == null) throw authSessionRequired();
  await requireActiveNativeSession(tx, input.staffId, authId, now);
  if (state.consented) return state;
  await interruptVisit(tx, input.recordId, Math.min(now, toMs(row.consent_ends_at) ?? now));
  await tx.execute(sql`
    insert into attendance_geofence_sessions (record_id, auth_session_id, consented_at, ends_at)
    values (${input.recordId}, ${authId}, ${instant(now)}, ${instant(state.endsAt)})
    on conflict (record_id) do update
    set auth_session_id = excluded.auth_session_id, consented_at = excluded.consented_at, ends_at = excluded.ends_at,
      revoked_at = null, status = 'unavailable', last_observed_at = null, last_received_at = null, last_trusted_at = null,
      outside_since = null, outside_since_received_at = null
  `);
  return { ...state, consented: true, status: "unavailable" };
}

type GeofenceSample = StaffRecord & GpsEvidence & { observedAt: number };
type ExitNotice = { id: number; staffId: number; staffName: string; exitAt: number };
type OnExit = (tx: Executor, visit: ExitNotice) => Promise<void>;

async function applyGeofenceSample(tx: Executor, input: StaffRecord, sample: GeofenceSample | null, onExit?: OnExit, nowMs?: number) {
  await requireSchema(tx);
  const authId = sessionKey(input.authSessionId);
  if (authId == null) throw authSessionRequired();
  await lockStaff(tx, input.staffId);
  const now = nowMs ?? Date.now();
  await requireActiveNativeSession(tx, input.staffId, authId, now);
  const { row, state } = await readStaffScope(tx, input.staffId, authId, now);
  if (state.recordId !== input.recordId || !state.consented || !state.eligible) return state;
  const location = configuredLocation(row);
  const evidence = evidenceFromRow(row);
  const visit: GeofenceOpenVisit | null = row.visit_id == null ? null : {
    outsideMs: Number(row.visit_outside_ms), verification: row.visit_verification,
  };
  const observedAt = sample?.observedAt ?? NaN;
  const firstAllowed = Math.max(state.startsAt ?? now, toMs(row.consented_at) ?? now);
  const usable = sample != null && location != null && observedAt >= firstAllowed && observedAt < (state.endsAt ?? now);
  const decision = evaluateGeofenceSample({
    evidence, visit, observedAt, now,
    position: usable ? classifyGeofenceSample(sample, location) : "unavailable",
    interrupted: evidenceInterrupted(row, now),
  });
  if (decision.evidence === evidence) return state;

  const next = decision.evidence;
  await tx.execute(sql`
    update attendance_geofence_sessions
    set status = ${next.status}, last_observed_at = ${next.observedAt == null ? null : instant(next.observedAt)},
      last_received_at = ${instant(now)}, last_trusted_at = ${next.lastTrustedAt == null ? null : instant(next.lastTrustedAt)},
      outside_since = ${next.outsideSince == null ? null : instant(next.outsideSince)},
      outside_since_received_at = ${next.outsideSinceReceivedAt == null ? null : instant(next.outsideSinceReceivedAt)}
    where record_id = ${input.recordId}
  `);
  const change = decision.visit;
  if (change?.kind === "open") {
    const [inserted] = rowsOf(await tx.execute(sql`
      insert into attendance_geofence_visits (record_id, staff_id, workplace, exit_at, outside_ms)
      values (${input.recordId}, ${input.staffId}, ${state.workplace}, ${instant(change.exitAt)}, ${change.outsideMs})
      on conflict (record_id) where ended_at is null do nothing returning id
    `));
    if (inserted && onExit) await onExit(tx, { id: Number(inserted.id), staffId: input.staffId, staffName: row.staff_name, exitAt: change.exitAt });
  } else if (change) {
    const returnedAt = change.kind === "return" ? instant(change.returnAt) : null;
    await tx.execute(sql`
      update attendance_geofence_visits set outside_ms = ${change.outsideMs}, verification = ${change.verification},
        return_at = ${returnedAt}, ended_at = ${returnedAt}
      where id = ${row.visit_id} and ended_at is null
    `);
  }
  return { ...state, status: geofenceEvidenceStatus(next, now) };
}

export function recordGeofenceSample(tx: Executor, input: GeofenceSample, onExit?: OnExit, nowMs?: number) {
  return applyGeofenceSample(tx, input, input, onExit, nowMs);
}

export function markGeofenceUnavailable(tx: Executor, input: StaffRecord, nowMs?: number) {
  return applyGeofenceSample(tx, input, null, undefined, nowMs);
}

/** Called inside checkout's per-staff transaction. The original punch also works before the feature migration. */
export async function closeGeofenceForCheckout(tx: Executor, staffId: number, recordId: number, atMs: number) {
  if (!await schemaReady(tx)) return;
  const [record] = rowsOf(await tx.execute(sql`
    select g.record_id from attendance_geofence_sessions g join attendance_records r on r.id = g.record_id
    where r.id = ${recordId} and r.staff_id = ${staffId}
  `));
  if (!record) return;
  await resetConsent(tx, recordId, atMs);
  await interruptVisit(tx, recordId, atMs);
}

// An interrupted visit ends at the last trusted observation or the earlier hard stop.
// PostgreSQL's LEAST ignores absent bounds, and GREATEST keeps an old fix before exit from reversing time.
const visitJoins = sql`
  join staff st on st.id = v.staff_id
  join attendance_records r on r.id = v.record_id and r.staff_id = v.staff_id
  left join attendance_geofence_sessions g on g.record_id = r.id
  left join attendance_employee_settings settings on settings.staff_id = r.staff_id
  left join attendance_locations l on l.id = r.location_id
  left join attendance_shifts s on s.id = r.shift_id and s.staff_id = r.staff_id
  left join admin_sessions a on a.id = g.auth_session_id and a.user_id = r.staff_id
`;
const knownVisitEnd = sql`
  greatest(v.exit_at, least(g.last_trusted_at, g.ends_at, g.revoked_at,
    r.check_out_at at time zone 'utc', a.expires_at at time zone 'utc',
    a.revoked_at at time zone 'utc', s.end_at))
`;
const trackingEnded = (now: number) => sql`
  (g.record_id is null or a.id is null or g.ends_at <= ${instant(now)}
   or g.revoked_at <= ${instant(now)} or r.check_out_at <= ${utcTime(now)}
   or a.expires_at <= ${utcTime(now)} or a.revoked_at <= ${utcTime(now)}
   or st.is_active is not true or settings.enabled is not true or l.is_active is not true
   or l.latitude is null or l.longitude is null or r.method is distinct from 'qr' and r.method is distinct from 'qr_gps'
   or s.status = 'cancelled' or s.end_at <= ${instant(now)})
`;

export async function geofenceDashboard(tx: Executor, options: { date: string; staffId?: number | null }, nowMs = Date.now()) {
  await requireSchema(tx);
  const start = baghdadMoment(options.date, "00:00").getTime();
  if (!Number.isFinite(start) || baghdadDate(start) !== options.date) throw new AttendanceError("تاريخ الحضور غير صحيح", 422, "VALIDATION_ERROR");
  const end = baghdadMoment(addDays(options.date, 1), "00:00").getTime();
  const asOf = Math.min(nowMs, end - 1);
  const staffFilter = (column: SQL) => options.staffId == null ? sql`` : sql`and ${column} = ${options.staffId}`;
  const [attendanceRows, visits, exceptions] = await Promise.all([
    readScopes(tx, asOf, sql`(r.check_out_at is null or r.check_out_at >= ${utcTime(start)}) ${staffFilter(sql`r.staff_id`)}`),
    tx.execute(sql`
      select * from (
        select v.id, v.staff_id, coalesce(nullif(st.full_name, ''), st.username) as staff_name, v.workplace,
          v.exit_at, v.return_at, v.outside_ms, v.review_status, v.verification,
          case when v.ended_at is not null then v.ended_at
            when ${trackingEnded(nowMs)} then ${knownVisitEnd} end as ended_at,
          v.ended_at is null as pending_boundary, g.last_trusted_at
        from attendance_geofence_visits v ${visitJoins}
        where v.exit_at < ${instant(end)} ${staffFilter(sql`v.staff_id`)}
      ) history
      where history.ended_at is null or history.ended_at >= ${instant(start)}
      order by history.exit_at desc, history.id desc
    `),
    tx.execute(sql`
      select x.*, coalesce(nullif(st.full_name, ''), st.username) as staff_name
      from attendance_geofence_exceptions x join staff st on st.id = x.staff_id
      where x.starts_at < ${instant(end)} and x.ends_at > ${instant(start)} ${staffFilter(sql`x.staff_id`)}
      order by x.starts_at desc, x.id desc
    `),
  ]);
  const candidateRows = attendanceRows.filter((row) => isQrPunch(row) || row.exempt_now === true);
  const fixedStaffIds = candidateRows
    .filter((row) => row.shift_id == null && row.employee_enabled === true && isOpenAt(row, asOf))
    .map((row) => Number(row.staff_id));
  const contexts = await scheduleContexts(tx, fixedStaffIds);
  return {
    statuses: candidateRows.map((row) => {
      const staffId = Number(row.staff_id);
      const { recordId, status, workplace } = scopeState(row, contexts.get(staffId)?.schedule, asOf, null);
      return { staffId, recordId, status, workplace };
    }),
    visits: rowsOf(visits).map((row) => {
      const endedAt = toMs(row.ended_at);
      const interrupted = row.verification === "interrupted" || (row.pending_boundary &&
        (endedAt != null || nowMs - (toMs(row.last_trusted_at) ?? -Infinity) > GEOFENCE_SAMPLE_GAP_MS));
      return {
        id: Number(row.id), staffId: Number(row.staff_id), staffName: row.staff_name, workplace: row.workplace,
        exitAt: toMs(row.exit_at), returnAt: toMs(row.return_at), endedAt, outsideSeconds: Math.floor(Number(row.outside_ms) / 1000),
        verification: interrupted ? "interrupted" as const : endedAt == null ? "ongoing" as const : "verified" as const,
        reviewStatus: row.review_status,
      };
    }),
    exceptions: rowsOf(exceptions).map((row) => ({
      id: Number(row.id), staffId: Number(row.staff_id), staffName: row.staff_name, kind: row.kind,
      startsAt: toMs(row.starts_at), endsAt: toMs(row.ends_at), reason: row.reason, revokedAt: toMs(row.revoked_at),
    })),
  };
}

type GeofenceException = { staffId: number; kind: "temporary_exit" | "delivery" | "external_event"; startsAt: number; endsAt: number; reason: string };
const validEpoch = (ms: number) => Number.isSafeInteger(ms) && ms > 0 && ms <= 8_640_000_000_000_000;

export async function approveGeofenceException(tx: Executor, input: GeofenceException, actor: AttendanceActor) {
  await requireSchema(tx);
  const { staffId, kind, startsAt, endsAt } = input;
  const reason = input.reason.trim();
  if (!reason || reason.length > 500 || !["temporary_exit", "delivery", "external_event"].includes(kind) ||
      !validEpoch(startsAt) || !validEpoch(endsAt) || endsAt <= startsAt || endsAt - startsAt > 7 * 86_400_000) {
    throw new AttendanceError("أدخل سبب الاستثناء وفترة صحيحة لا تتجاوز سبعة أيام", 422, "VALIDATION_ERROR");
  }
  await lockStaff(tx, staffId);
  const [staff] = rowsOf(await tx.execute(sql`select id from staff where id = ${staffId} and is_active = true`));
  if (!staff) throw new AttendanceError("الموظف غير موجود", 404, "NOT_FOUND");
  const [existing] = rowsOf(await tx.execute(sql`
    select id from attendance_geofence_exceptions where staff_id = ${staffId} and kind = ${kind} and reason = ${reason}
      and starts_at = ${instant(startsAt)} and ends_at = ${instant(endsAt)} and revoked_at is null limit 1
  `));
  if (existing) return { id: Number(existing.id) };
  const [created] = rowsOf(await tx.execute(sql`
    insert into attendance_geofence_exceptions (staff_id, kind, starts_at, ends_at, reason, approved_by, approved_by_name)
    values (${staffId}, ${kind}, ${instant(startsAt)}, ${instant(endsAt)}, ${reason}, ${actor.id}, ${actor.name}) returning id
  `));
  return { id: Number(created.id) };
}

export async function revokeGeofenceException(tx: Executor, id: number, actor: AttendanceActor) {
  await requireSchema(tx);
  const [exception] = rowsOf(await tx.execute(sql`select staff_id from attendance_geofence_exceptions where id = ${id}`));
  if (!exception) throw new AttendanceError("الاستثناء غير موجود", 404, "NOT_FOUND");
  await lockStaff(tx, Number(exception.staff_id));
  await tx.execute(sql`
    update attendance_geofence_exceptions set revoked_at = now(), revoked_by = ${actor.id}, revoked_by_name = ${actor.name}
    where id = ${id} and revoked_at is null
  `);
  return { id };
}

async function endUnresolvedVisits(tx: Executor, now: number, filter = sql``) {
  await tx.execute(sql`
    with terminated as (
      select v.id, ${knownVisitEnd} as ended_at from attendance_geofence_visits v ${visitJoins}
      where v.ended_at is null and ${trackingEnded(now)} ${filter}
    )
    update attendance_geofence_visits v set ended_at = terminated.ended_at, verification = 'interrupted'
    from terminated where v.id = terminated.id and v.ended_at is null
  `);
}

export async function reviewGeofenceVisit(tx: Executor, id: number, input: { approved: boolean; note?: string | null }, actor: AttendanceActor) {
  await requireSchema(tx);
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) throw new AttendanceError("ملاحظة المراجعة أطول من الحد المسموح", 422, "VALIDATION_ERROR");
  await endUnresolvedVisits(tx, Date.now(), sql`and v.id = ${id}`);
  const status = input.approved ? "approved" : "rejected";
  const [updated] = rowsOf(await tx.execute(sql`
    update attendance_geofence_visits set review_status = ${status}, reviewed_at = now(),
      reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, review_note = ${note}
    where id = ${id} and ended_at is not null and review_status = 'pending' returning id
  `));
  if (updated) return { id };
  const [visit] = rowsOf(await tx.execute(sql`select ended_at, review_status, review_note from attendance_geofence_visits where id = ${id}`));
  if (!visit) throw new AttendanceError("واقعة الخروج غير موجودة", 404, "NOT_FOUND");
  if (visit.review_status === status && visit.review_note === note) return { id };
  throw new AttendanceError(visit.ended_at == null ? "انتظر انتهاء واقعة الخروج قبل مراجعتها" : "تمت مراجعة واقعة الخروج بالفعل", 409, "CONFLICT");
}

export async function sweepGeofenceHistory(tx: Executor, retentionDays: number) {
  if (!await schemaReady(tx)) return { visitsRemoved: 0, sessionsRemoved: 0, exceptionsRemoved: 0 };
  const now = Date.now();
  if (!Number.isFinite(retentionDays) || retentionDays < 1) throw new AttendanceError("مدة الاحتفاظ ببيانات الحضور غير صحيحة", 422, "VALIDATION_ERROR");
  const cutoff = instant(now - Math.min(3650, Math.round(retentionDays)) * 86_400_000);
  await endUnresolvedVisits(tx, now);
  const visits = await tx.execute(sql`delete from attendance_geofence_visits where ended_at < ${cutoff}`);
  const sessions = await tx.execute(sql`delete from attendance_geofence_sessions where ends_at < ${cutoff}`);
  const exceptions = await tx.execute(sql`delete from attendance_geofence_exceptions where ends_at < ${cutoff}`);
  return { visitsRemoved: Number(visits.rowCount), sessionsRemoved: Number(sessions.rowCount), exceptionsRemoved: Number(exceptions.rowCount) };
}
