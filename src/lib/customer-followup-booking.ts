import type { FollowupBooking, FollowupRow } from "./customer-followups";

/** Interests propose existing departments only; an occasion alone selects no paid service. */
export function followupBookingPreset(followup: FollowupRow) {
  const departments: Array<"photography" | "kosha" | "sound" | "graduation"> = [];
  if (["photography", "kosha", "sound", "graduation"].includes(followup.serviceKey)) departments.push(followup.serviceKey as typeof departments[number]);
  const eventType = ({ wedding: "زفاف", engagement: "خطوبة", henna: "حنة", graduation: "تخرج" } as Record<string, string>)[followup.serviceKey];
  return { customer: { ...followup.customer }, departments, ...(eventType ? { eventType } : {}) };
}

export function followupBookingMetadata(followup: FollowupRow, customerId: number) {
  if (followup.customer.id !== customerId) throw new Error("يجب أن يبقى العميل مرتبطاً بالمتابعة الأصلية");
  const { eventType } = followupBookingPreset(followup);
  return { customerFollowupId: followup.id, ...(eventType ? { eventType } : {}) };
}

/** Recover the original booking, never navigate to an arbitrary URL from an error payload. */
export function recoveredFollowupBooking(data: unknown): FollowupBooking | null {
  if (!data || typeof data !== "object") return null;
  const booking = (data as { existingBooking?: unknown }).existingBooking;
  if (!booking || typeof booking !== "object") return null;
  const { source, id, number } = booking as Partial<FollowupBooking>;
  if ((source !== "service" && source !== "kosha") || !Number.isSafeInteger(id) || Number(id) <= 0) return null;
  return { source, id: Number(id), number: typeof number === "string" ? number : `#${id}`, href: `/admin/bookings/${source}/${id}` };
}
