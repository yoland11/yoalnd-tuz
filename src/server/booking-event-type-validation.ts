import { bookingEventTypeStorage, normalizeBookingEventType } from "../lib/booking-event-types";

export type BookingEventTypeWriteOptions = {
  mode: "create" | "edit";
  required?: boolean;
  provided?: boolean;
  previous?: unknown;
};

type EventTypeAdmission = { ok: true; value: unknown } | { ok: false; message: string };
const blank = (value: unknown) => value == null || (typeof value === "string" && !value.trim());

/** New center submissions choose an occasion; old records keep their identity. */
export function bookingEventTypeWrite(value: unknown, options: BookingEventTypeWriteOptions): EventTypeAdmission {
  if (options.mode === "edit") {
    if (options.provided === false || value === options.previous || (blank(value) && blank(options.previous))) {
      return { ok: true, value: options.previous };
    }
  }
  const stored = bookingEventTypeStorage(value);
  if (stored) return { ok: true, value: stored };
  if (options.mode === "create" && !options.required) return { ok: true, value };
  return { ok: false, message: blank(value) ? "اختر نوع المناسبة" : "نوع المناسبة غير صالح" };
}

/** Compare the locked original and saved occasion, including historical aliases. */
export function bookingEventTypeNeedsFollowups(previous: unknown, next: unknown): boolean {
  const occasion = normalizeBookingEventType(next);
  return (occasion === "engagement" || occasion === "henna") && occasion !== normalizeBookingEventType(previous);
}
