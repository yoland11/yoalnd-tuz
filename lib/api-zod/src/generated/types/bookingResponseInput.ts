import type { BookingResponseInputAction } from "./bookingResponseInputAction";

export interface BookingResponseInput {
  action: BookingResponseInputAction;
  requestedDate?: string;
  note?: string;
}
