import assert from "node:assert/strict";
import {
  MESSAGE_TEMPLATES,
  renderEventMessage,
  uniqueRecipients,
  nextDeliveryStatus,
  eventStage,
} from "../src/lib/event-messaging";
const recipient = {
  key: "group:4",
  kind: "group" as const,
  id: 4,
  name: "ممثل الدفعة",
  phone: "07701234567",
  category: "graduation",
  details: {
    group: "دفعة الهندسة",
    university: "جامعة بغداد",
    department: "حاسوب",
    students: "40",
    remaining: "15000",
    date: "2026-12-01",
  },
  blocked: false,
  consent: false,
};
assert.equal(MESSAGE_TEMPLATES.length, 8);
assert.match(renderEventMessage("payment", recipient), /15000/);
assert.match(
  renderEventMessage("graduation_details", recipient),
  /دفعة الهندسة/,
);
assert.doesNotMatch(
  renderEventMessage("graduation_details", {
    ...recipient,
    details: { ...recipient.details, secret: "student secret" },
  }),
  /student secret/,
);
assert.equal(
  uniqueRecipients([
    recipient,
    {
      ...recipient,
      key: "customer:3",
      kind: "customer",
      id: 3,
      phone: "+9647701234567",
    },
  ]).length,
  1,
);
assert.equal(nextDeliveryStatus("read", "sent"), "read");
assert.equal(nextDeliveryStatus("delivered", "failed"), "delivered");
assert.equal(eventStage("converted", "new"), "booked");
assert.equal(eventStage("uninterested", "contacted"), "declined");
assert.equal(eventStage("waiting", null), "waiting");
console.log(
  "PASS event message privacy, normalized duplicates, lifecycle and delivery progression",
);
