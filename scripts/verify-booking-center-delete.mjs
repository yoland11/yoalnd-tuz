import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/views/admin/booking-center.tsx", "utf8");

assert.match(source, /bookingDeleteMutation/, "the dashboard must own a delete/cancel mutation");
assert.match(source, /booking\.source === "kosha"\s*\? `\/admin\/kosha-bookings\/\$\{booking\.id\}`\s*:\s*`\/admin\/service-orders\/\$\{booking\.id\}`/, "the mutation must use the existing source-specific booking endpoints");
assert.match(source, /method:\s*"DELETE"/, "the mutation must invoke the existing cancellation-and-archive API");
assert.match(source, /onClick=\{\(\) => onDelete\(booking\)\}/, "the booking card must invoke the supplied delete action");
assert.match(source, /مسح الحجز[\s\S]{0,300}إلغاؤه وأرشفته/, "the confirmation must explain deletion is cancellation and archiving");

console.log("Booking center deletion checks passed.");
