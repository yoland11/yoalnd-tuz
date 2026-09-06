import type {
  KoshaManagerBooking,
  KoshaManagerInstruction,
  KoshaManagerInstructionList,
  KoshaManagerInstructionReads,
} from "@/lib/kosha-manager-contract";
import { bookingIdentity, sourceQuery } from "@/lib/kosha-manager";
import { adminFetch } from "@/views/admin/_lib";

type BookingRef = Pick<KoshaManagerBooking, "id" | "source">;

function instructionBasePath(booking: BookingRef): string {
  return `/admin/kosha-bookings/${booking.id}/manager-view`;
}

export function managerInstructionsQuery(booking: BookingRef) {
  return {
    queryKey: ["admin", "kosha-manager", "instructions", bookingIdentity(booking)],
    queryFn: () =>
      adminFetch<KoshaManagerInstructionList>(
        `${instructionBasePath(booking)}/instructions?${sourceQuery(booking)}`,
      ),
  };
}

export function managerInstructionReadsQuery(booking: BookingRef) {
  return {
    queryKey: ["admin", "kosha-manager", "instruction-reads", bookingIdentity(booking)],
    queryFn: () =>
      adminFetch<KoshaManagerInstructionReads>(
        `${instructionBasePath(booking)}/instruction-reads?${sourceQuery(booking)}`,
      ),
  };
}

export function createManagerInstruction(
  booking: BookingRef,
  payload: { kind: "note"; caption: string } | { kind: "image"; mediaUrl: string; caption?: string | null },
) {
  return adminFetch<{ instruction: KoshaManagerInstruction }>(
    `${instructionBasePath(booking)}/instructions?${sourceQuery(booking)}`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function updateManagerInstructionCaption(
  booking: BookingRef,
  instructionId: number,
  caption: string,
) {
  return adminFetch<{ instruction: KoshaManagerInstruction }>(
    `${instructionBasePath(booking)}/instructions/${instructionId}?${sourceQuery(booking)}`,
    { method: "PATCH", body: JSON.stringify({ caption }) },
  );
}

export function archiveManagerInstruction(booking: BookingRef, instructionId: number) {
  return adminFetch<{ instruction: KoshaManagerInstruction }>(
    `${instructionBasePath(booking)}/instructions/${instructionId}/archive?${sourceQuery(booking)}`,
    { method: "POST" },
  );
}

export function markManagerExecutionViewed(booking: BookingRef, viewedThrough: string) {
  return adminFetch<{ viewedAt: string }>(
    `${instructionBasePath(booking)}/execution-viewed?${sourceQuery(booking)}`,
    { method: "POST", body: JSON.stringify({ viewedThrough }) },
  );
}
