import type { FollowupServiceKey } from "../lib/customer-followups";
import { normalizeBookingEventType } from "../lib/booking-event-types";

export function followupOccasion(
  value: unknown,
): "engagement" | "henna" | "wedding" | "graduation" | null {
  const key = normalizeBookingEventType(value);
  // Birthday/other occasions do not imply another sale or follow-up workflow.
  return key === "engagement" || key === "henna" || key === "wedding" || key === "graduation" ? key : null;
}
export function suggestedFollowupServices(input: {
  eventType: unknown;
  departments: string[];
  fields?: Record<string, unknown>;
  photographyLinked?: boolean;
  inquiry?: boolean;
}): FollowupServiceKey[] {
  const occasion = followupOccasion(input.eventType),
    present = new Set(input.departments),
    fields = input.fields ?? {};
  const result: FollowupServiceKey[] = [];
  if (occasion === "engagement") result.push("henna", "wedding");
  if (occasion === "henna") result.push("wedding");
  if (occasion === "wedding" || occasion === "graduation") {
    if (
      !present.has("photography") &&
      !input.photographyLinked &&
      !fields.graduationOrderId
    )
      result.push("photography");
    if (
      fields.photoSessionDelivery !== "album" &&
      !present.has("album") &&
      !present.has("albums")
    )
      result.push("album");
    if (!present.has("printing")) result.push("printing");
  }
  if (input.inquiry) result.push("booking_confirmation");
  return [...new Set(result)].filter((key) => !present.has(key));
}
