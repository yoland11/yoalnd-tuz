import { db, dispatchAssignmentsTable, crewsTable, fleetVehiclesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { readResourceBooking } from "./booking-resource-period";
import { BookingResourceConflictError, resourceTimingProblem, findBookingVehicleConflict, findBookingCrewConflict, resourceRows } from "./booking-resource-availability";

type DispatchInput = {
  entityType: string; entityId: number; branchId?: number | null;
  crewId?: number | null; vehicleId?: number | null; warehouseId?: number | null;
  score: number; notes?: string | null; suggestions: Record<string, unknown>;
};
const snapshot = (value: DispatchInput | typeof dispatchAssignmentsTable.$inferSelect) => ({
  entityType: value.entityType, entityId: value.entityId,
  branchId: value.branchId ?? null, crewId: value.crewId ?? null, vehicleId: value.vehicleId ?? null,
  warehouseId: value.warehouseId ?? null, score: Number(value.score), notes: value.notes ?? null, suggestions: value.suggestions ?? {},
});

/** The original dispatch row and original fleet/crew statuses, never another
 * reservation system. Caller authorization stays in the original enterprise API.
 * Source lock precedes sorted resource locks, matching operating-period edits.
 */
export async function saveBookingDispatch(database: Pick<typeof db, "transaction">, input: DispatchInput, actor: { id: number; name: string }) {
  return database.transaction(async tx => {
    const source = input.entityType === "kosha_booking" ? "kosha" : input.entityType === "service_order" ? "service" : null;
    const reference = source ? await readResourceBooking(tx, { source, id: input.entityId }, true) : null;
    if (reference && ["cancelled", "canceled", "deleted", "completed", "delivered", "closed"].includes(reference.status.toLowerCase())) throw new BookingResourceConflictError("لا يمكن إسناد نقل لحجز ملغي أو مكتمل", 409);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`dispatch:${input.entityType}:${input.entityId}`}))`);
    const previous = await tx.query.dispatchAssignmentsTable.findFirst({ where: and(eq(dispatchAssignmentsTable.entityType, input.entityType), eq(dispatchAssignmentsTable.entityId, input.entityId)) });
    if (previous?.status === "assigned" && isDeepStrictEqual(snapshot(previous), snapshot(input))) return { row: previous, replayed: true };
    const timingProblem = reference && (input.vehicleId || input.crewId) ? resourceTimingProblem(reference) : null;
    if (timingProblem) throw new BookingResourceConflictError(timingProblem, 409);
    const vehicleIds = [...new Set([previous?.vehicleId, input.vehicleId].filter((id): id is number => !!id))].sort((a, b) => a - b);
    const crewIds = [...new Set([previous?.crewId, input.crewId].filter((id): id is number => !!id))].sort((a, b) => a - b);
    for (const id of vehicleIds) {
      const [vehicle] = resourceRows(await tx.execute(sql`SELECT id,is_active,status FROM fleet_vehicles WHERE id=${id} FOR UPDATE`));
      if (id === input.vehicleId && (!vehicle || vehicle.is_active !== true || ["maintenance", "repair", "retired", "inactive"].includes(String(vehicle.status)))) throw new BookingResourceConflictError("المركبة المختارة غير متاحة أو تغيّرت حالتها", 409);
    }
    for (const id of crewIds) {
      const [crew] = resourceRows(await tx.execute(sql`SELECT id,is_active,status FROM crews WHERE id=${id} FOR UPDATE`));
      if (id === input.crewId && (!crew || crew.is_active !== true || ["inactive", "maintenance", "unavailable"].includes(String(crew.status)))) throw new BookingResourceConflictError("فريق التركيب غير متاح أو تغيّرت حالته", 409);
    }
    for (const [kind, id] of [["vehicle", input.vehicleId], ["crew", input.crewId]] as const) {
      if (!id) continue;
      // An active assignment outside Booking Center has no authoritative
      // operating window here. It is incomplete, never silently conflict-free.
      const other = resourceRows(await tx.execute(sql`SELECT entity_type,entity_id FROM dispatch_assignments WHERE ${kind === "vehicle" ? sql`vehicle_id` : sql`crew_id`}=${id}
        AND status IN ('assigned','en_route','active') AND NOT(entity_type=${input.entityType} AND entity_id=${input.entityId})
        ${reference ? sql`AND entity_type NOT IN ('kosha_booking','service_order')` : sql``} LIMIT 1`));
      if (other.length) throw new BookingResourceConflictError("المورد مشغول بإسناد آخر لم تُوثق فترة تشغيله؛ راجع الإسناد قبل الحفظ", 409);
      if (reference && await (kind === "vehicle" ? findBookingVehicleConflict(reference, id, tx) : findBookingCrewConflict(reference, id, tx))) throw new BookingResourceConflictError(kind === "vehicle" ? "المركبة مشغولة خلال فترة التجهيز والنقل والإرجاع أو مواعيدها غير مكتملة" : "فريق التركيب مشغول خلال فترة التشغيل أو مواعيده غير مكتملة", 409);
    }
    const values = { ...snapshot(input), score: String(input.score), assignedBy: actor.id, assignedByName: actor.name };
    const [row] = await tx.insert(dispatchAssignmentsTable).values(values).onConflictDoUpdate({ target: [dispatchAssignmentsTable.entityType, dispatchAssignmentsTable.entityId], set: { ...values, status: "assigned", updatedAt: new Date() } }).returning();
    if (!row) throw new Error("Dispatch assignment write returned no row");
    if (input.crewId) await tx.update(crewsTable).set({ status: "busy", updatedAt: new Date() }).where(eq(crewsTable.id, input.crewId));
    if (input.vehicleId) await tx.update(fleetVehiclesTable).set({ status: "outside", updatedAt: new Date() }).where(eq(fleetVehiclesTable.id, input.vehicleId));
    await tx.execute(sql`INSERT INTO entity_timeline(entity_type,entity_id,type,title,actor_id,actor_name,metadata) VALUES(${input.entityType},${input.entityId},'booking_dispatch_assigned','إسناد موارد النقل',${actor.id},${actor.name},${JSON.stringify({ assignmentId: row.id, vehicleId: input.vehicleId ?? null, crewId: input.crewId ?? null })}::jsonb)`);
    return { row, replayed: false };
  });
}
