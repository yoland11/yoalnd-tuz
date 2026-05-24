export type BookingResponseInputAction =
  (typeof BookingResponseInputAction)[keyof typeof BookingResponseInputAction];

export const BookingResponseInputAction = {
  confirm: "confirm",
  reschedule: "reschedule",
} as const;
