import assert from "node:assert/strict";
import { existsSync } from "node:fs";
assert.ok(
  existsSync("src/lib/customer-followups.ts"),
  "shared followup domain must exist",
);
const d = await import("../src/lib/customer-followups");
assert.equal(d.FOLLOWUP_SERVICES.length, 11);
assert.equal(
  d.followupDateBucket(
    "2026-11-02T21:30:00Z",
    new Date("2026-11-03T07:00:00Z"),
  ),
  "today",
  "Iraq day starts at 21 UTC",
);
assert.equal(
  d.followupDateBucket(
    "2026-11-02T20:59:00Z",
    new Date("2026-11-03T07:00:00Z"),
  ),
  "overdue",
);
assert.equal(
  d.followupDateTimeToIso("2026-11-03T10:30"),
  "2026-11-03T07:30:00.000Z",
);
assert.equal(
  d.toFollowupDateTimeInput("2026-11-03T07:30:00Z"),
  "2026-11-03T10:30",
);
assert.equal(
  d.followupWhatsAppHref("٠٧٧٠١٢٣٤٥٦٧"),
  "https://wa.me/9647701234567",
);
assert.equal(d.followupWhatsAppHref("bad"), null);
const rules = await import("../src/server/customer-followups-rules");
assert.equal(
  rules.followupOccasion("kosha"),
  null,
  "department is never an invented wedding",
);
assert.equal(rules.followupOccasion("زفاف"), "wedding");
assert.deepEqual(
  rules.suggestedFollowupServices({
    eventType: "خطوبة",
    departments: ["kosha"],
  }),
  ["henna", "wedding"],
);
assert.deepEqual(
  rules.suggestedFollowupServices({
    eventType: "wedding",
    departments: ["photography"],
    fields: { photoSessionDelivery: "album" },
  }),
  ["printing"],
);
assert.deepEqual(
  rules.suggestedFollowupServices({
    eventType: "graduation",
    departments: ["graduation"],
    photographyLinked: true,
  }),
  ["album", "printing"],
);
assert.deepEqual(
  rules.suggestedFollowupServices({ eventType: null, departments: ["kosha"] }),
  [],
);
console.log(
  "PASS customer followup domain: Iraq dates, manual contacts and explicit occasion suggestions",
);
