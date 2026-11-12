import assert from "node:assert/strict";
import {
  verifyMetaSignature,
  buildMetaTemplate,
  approvedTemplateSnapshot,
  sendMetaTemplate,
  liveMetaTemplates,
} from "../src/server/event-messaging-provider";
import { createHmac } from "node:crypto";
const raw = '{"entry":[]}';
assert.equal(
  verifyMetaSignature(
    raw,
    "sha256=" + createHmac("sha256", "secret").update(raw).digest("hex"),
    "secret",
  ),
  true,
);
assert.equal(verifyMetaSignature(raw, "sha256=00", "secret"), false);
assert.equal(verifyMetaSignature(raw, undefined, undefined), false);
const approved = approvedTemplateSnapshot(
  {
    name: "ajn_event",
    language: "ar",
    status: "APPROVED",
    components: [{ type: "BODY", text: "مرحباً {{1}}، رقم {{2}}" }],
  },
  ["name", "reference"],
);
const payload = buildMetaTemplate("9647701234567", approved, {
  name: "أحمد",
  reference: "AJN-12",
});
assert.equal(payload.type, "template");
assert.deepEqual(payload.template.components[0].parameters, [
  { type: "text", text: "أحمد" },
  { type: "text", text: "AJN-12" },
]);
assert.throws(() =>
  approvedTemplateSnapshot(
    { name: "bad", language: "ar", status: "PAUSED", components: [] },
    [],
  ),
);
assert.throws(() =>
  approvedTemplateSnapshot(
    {
      name: "bad",
      language: "ar",
      status: "APPROVED",
      components: [{ type: "HEADER", format: "IMAGE" }],
    },
    [],
  ),
);
console.log(
  "PASS signed webhook and live approved provider template validation",
);
const saved = { ...process.env };
try {
  process.env.META_WA_GRAPH_VERSION = "v25.0";
  process.env.META_WA_TOKEN = "synthetic-token";
  process.env.META_WA_PHONE_ID = "synthetic-phone";
  process.env.META_WA_BUSINESS_ID = "synthetic-business";
  let seen: any;
  const accepted = await sendMetaTemplate(
    "9647700000001",
    approved,
    { name: "أحمد", reference: "AJN-12" },
    (async (url, options) => {
      seen = { url, body: JSON.parse(String(options?.body)) };
      return Response.json({ messages: [{ id: "wamid.synthetic" }] });
    }) as typeof fetch,
  );
  assert.deepEqual(accepted, { status: "accepted", id: "wamid.synthetic" });
  assert.equal(seen.body.type, "template");
  assert.equal(seen.body.to, "9647700000001");
  assert.equal(
    (
      await sendMetaTemplate("9647700000001", approved, {}, (async () => {
        throw Error("synthetic timeout");
      }) as typeof fetch)
    ).status,
    "unknown",
  );
  await assert.rejects(
    () =>
      liveMetaTemplates((async () =>
        Response.json(
          { error: "private provider body" },
          { status: 503 },
        )) as typeof fetch),
    (e: any) =>
      e.code === "META_TEMPLATES_UNAVAILABLE" &&
      !e.message.includes("private provider body"),
  );
  delete process.env.META_WA_TOKEN;
  await assert.rejects(
    () => liveMetaTemplates(),
    (e: any) => e.code === "META_NOT_CONFIGURED" && e.status === 503,
  );
} finally {
  for (const key of [
    "META_WA_GRAPH_VERSION",
    "META_WA_TOKEN",
    "META_WA_PHONE_ID",
    "META_WA_BUSINESS_ID",
  ]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}
console.log(
  "PASS official template payload, ambiguous timeout, safe provider errors and missing configuration",
);
