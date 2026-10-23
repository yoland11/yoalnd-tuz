import { resourceOccupancyTimestamps, type ResourceOccupancy } from "./booking-resource-conflicts";

/** The full resource period includes preparation/loading/transport/installation
 * before the event and dismantling/transport/inspection after it. No default hours.
 */
export type BookingResourceWindow = {
  preparationStart: string;
  eventStart: string;
  eventEnd: string;
  returnEnd: string;
};

export class BookingResourceWindowError extends Error {}

/** Calendar projection only; the four explicit timestamps remain authoritative. */
export function resourceWindowCalendar(window:BookingResourceWindow){
  parseBookingResourceWindow(window);
  const local=(value:string)=>{
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
    const part=(type:string)=>parts.find(item=>item.type===type)!.value;
    return {date:`${part("year")}-${part("month")}-${part("day")}`,time:`${part("hour")}:${part("minute")}`};
  };
  const start=local(window.eventStart),end=local(window.eventEnd);
  return {eventDate:start.date,eventTime:start.time,endTime:end.time};
}

export function parseBookingResourceWindow(input: unknown, eventDate?: string | null): BookingResourceWindow {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BookingResourceWindowError("فترة تشغيل الموارد غير مكتملة");
  const value = input as Record<string, unknown>;
  const keys = ["preparationStart", "eventStart", "eventEnd", "returnEnd"] as const;
  const output = {} as BookingResourceWindow;
  for (const key of keys) {
    if (typeof value[key] !== "string") throw new BookingResourceWindowError("موعد بداية التجهيز والمناسبة ونهايتها والإرجاع مطلوب");
    output[key] = value[key];
  }
  const full = resourceOccupancyTimestamps({ start: output.preparationStart, end: output.returnEnd });
  const event = resourceOccupancyTimestamps({ start: output.eventStart, end: output.eventEnd });
  if (!full || !event || full[0] > event[0] || event[1] > full[1]) throw new BookingResourceWindowError("فترة الموارد يجب أن تشمل التجهيز والمناسبة حتى اكتمال الإرجاع؛ تحقق من ترتيب المواعيد");
  if (eventDate !== undefined) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(output.eventStart));
    const part = (type: string) => parts.find(value => value.type === type)!.value;
    if (`${part("year")}-${part("month")}-${part("day")}` !== eventDate?.slice(0, 10))
      throw new BookingResourceWindowError("موعد بداية المناسبة في فترة الموارد يجب أن يطابق تاريخ الحجز بتوقيت بغداد");
  }
  return output;
}

/** Invalid/missing legacy timing is explicitly unknown, not a failed DB read. */
export function readBookingResourceWindow(operations: Record<string, unknown>, eventDate?: string | null): BookingResourceWindow | null {
  const input = operations.resourceWindow;
  if (input == null) return null;
  try { return parseBookingResourceWindow(input, eventDate); }
  catch (cause) {
    // Only the pure validation errors above are classified as incomplete data.
    if (cause instanceof BookingResourceWindowError) return null;
    throw cause;
  }
}

/** Undefined retains legacy date-only callers; explicit but invalid saved timing
 * is null and must fail the interval guard, never silently fall back to a day. */
export function bookingResourceOccupancy(operations:Record<string,unknown>,eventDate?:string|null):ResourceOccupancy|null|undefined{
  if(operations.resourceWindow==null)return undefined;
  const window=readBookingResourceWindow(operations,eventDate);
  return window?{start:window.preparationStart,end:window.returnEnd}:null;
}
