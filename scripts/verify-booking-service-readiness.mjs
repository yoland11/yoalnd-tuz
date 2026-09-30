import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/views/admin/booking-center.tsx", "utf8");

assert.match(source, /if \(servicesLoading\)/, "saving must stop while the services request is loading");
assert.match(source, /if \(servicesError\)/, "saving must surface a failed services request");
assert.match(source, /onRetryServices/, "the booking form must expose a way to retry a failed service request");
assert.match(source, /servicesQuery\.data\s*\?\?\s*\[\]/, "the form may use an empty array only alongside explicit query state");
assert.match(source, /disabled=\{[^}]*servicesLoading/, "the save action must be disabled while services are loading");

console.log("Booking service readiness checks passed.");
