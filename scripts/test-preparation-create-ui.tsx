import assert from "node:assert/strict";
import { preparationSaveTarget, validatePreparationDraft } from "../src/views/admin/preparation-create";

const line = { source: "custom" as const, name: "قماش خاص", department: "kosha", quantity: 1 };
assert.equal(validatePreparationDraft({ mode: "none", customerId: null, items: [line] }), "اختر العميل");
assert.equal(validatePreparationDraft({ mode: "none", customerId: 2, items: [] }), "أضف عنصر تجهيز واحداً على الأقل");
assert.equal(validatePreparationDraft({ mode: "existing", bookingSource: "kosha", bookingId: 8, customerId: null, items: [line] }), null);
assert.equal(preparationSaveTarget({ mode: "existing", bookingSource: "service", bookingId: 5 }), "/admin/preparation/bookings/service/5/items");
assert.equal(preparationSaveTarget({ mode: "new" }), "/admin/preparation/requests");
console.log("Preparation create routing and draft guards: passed");
