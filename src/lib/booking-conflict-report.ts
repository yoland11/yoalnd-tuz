import type { BookingOperationRef } from "./booking-operational-readiness";
export type ConflictBookingRef=Omit<BookingOperationRef,"source">&{source:BookingOperationRef["source"]|"photography"};

export type ConflictReportRow = {
  key: string;
  kind: "asset" | "quantity" | "staff" | "vehicle" | "crew" | "kosha";
  name: string;
  state: "conflict" | "incomplete" | "no_conflict";
  reason: string;
  booking?: ConflictBookingRef;
  quantities?: { required: number; available: number | null; reserved: number | null; missing: number | null; unit: string };
};
export type BookingConflictReport = BookingOperationRef & {
  checkedAt: string;
  timingComplete: boolean;
  rows: ConflictReportRow[];
  coverage: "partial";
};
export const conflictBookingHref = (ref: ConflictBookingRef) => ref.source==="photography"?`/staff/photography/events/${ref.id}/register`:`/admin/bookings/${ref.source}/${ref.id}?tab=assets`;
