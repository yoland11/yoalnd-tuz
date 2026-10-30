import { detectBookingDepartments } from "./sound-detection";

/**
 * Which departments a booking serves. The Booking Center and the booking
 * calendar read this one definition, so they can never disagree. A mixed
 * booking keeps every department it serves and is never split.
 */
export function centralBookingDepartments(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  if (/kosha|كوش/.test(normalized)) return ["kosha"];
  if (/sound|audio|speaker|صوت/.test(normalized)) return ["sound"];
  if (/photo|camera|تصوير/.test(normalized)) return ["photography"];
  if (/flower|ورد/.test(normalized)) return ["flowers"];
  if (/gift|هدية|توزيع/.test(normalized)) return ["gifts"];
  if (/graduation|تخرج/.test(normalized)) return ["graduation"];
  if (/rental|إيجار/.test(normalized)) return ["rental"];
  return ["decorations"];
}

/**
 * Priority: the department list stamped at sync time (identifiers, survives
 * renames), then the per-service breakdown, then legacy text classification.
 */
export function serviceOrderDepartments(
  fields: Record<string, any>,
  service?: { type?: string | null; nameAr?: string | null } | null,
): string[] {
  const selected = Array.isArray(fields.bookingCenterServices)
    ? fields.bookingCenterServices.map((item: any) => String(item?.type ?? ""))
    : [];
  const stamped = (Array.isArray(fields.departments) ? fields.departments : [])
    .map((value: unknown) => String(value ?? "").trim())
    .filter(Boolean);
  const merged = [...new Set([...stamped, ...selected])];
  return merged.length ? merged : centralBookingDepartments(service?.type ?? service?.nameAr);
}

export function koshaBookingDepartments(details: Record<string, any>): string[] {
  const detected = detectBookingDepartments({
    signals: {
      taxonomy: [
        "kosha",
        ...(Array.isArray(details.departments) ? details.departments : []),
        details.department,
        details.bookingType,
        details.serviceType,
        ...(Array.isArray(details.bookingCenterServices)
          ? details.bookingCenterServices.map((item: any) => item?.type ?? item?.key)
          : []),
      ],
      itemNames: Array.isArray(details.soundItems)
        ? details.soundItems.map((item: any) => item?.name ?? item?.productName)
        : [],
    },
  });
  return detected.length ? detected : ["kosha"];
}
