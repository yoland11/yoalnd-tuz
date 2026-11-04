import type { FollowupServiceKey } from "../lib/customer-followups";

export function followupOccasion(
  value: unknown,
): "engagement" | "henna" | "wedding" | "graduation" | null {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا");
  if (["engagement", "خطوبة", "خطوبه"].includes(key)) return "engagement";
  if (["henna", "حنة", "حنه"].includes(key)) return "henna";
  if (["wedding", "زفاف", "عرس", "زواج"].includes(key)) return "wedding";
  if (["graduation", "تخرج", "حفل تخرج"].includes(key)) return "graduation";
  return null;
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
