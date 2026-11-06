import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Adding services to a saved booking reuses the creation form and only appends.
const center = readFileSync("src/views/admin/booking-center.tsx", "utf8");
const workspace = readFileSync("src/views/admin/booking-operations-workspace.tsx", "utf8");

const addStart = center.indexOf("if (adding && addTo) {");
assert.ok(addStart > 0, "the form has an add branch");
const addBranch = center.slice(addStart, center.indexOf('return adminFetch("/admin/service-orders", {\n        method: "POST",', addStart));
assert.match(addBranch, /adminFetch\(`\/admin\/service-orders\/\$\{addTo\.id\}`, \{\s+method: "PATCH"/, "an addition updates the same booking");
assert.doesNotMatch(addBranch, /depositAmount|paymentStatus/, "an addition never touches what was paid");
assert.match(addBranch, /totalAmount: existingTotal \+ grandTotal/, "the total grows by the addition only");
assert.match(addBranch, /\.\.\.fields,/, "the booking's other details are kept");
assert.match(addBranch, /departments: \[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(fields\.departments\) \? fields\.departments : existingServices\), \.\.\.selected\]\)\]/, "departments keep the old ones");
assert.match(addBranch, /bookingCenterServices: \[\.\.\.savedEntries, \.\.\.serviceEntries\]/, "service entries keep the old ones");
assert.match(addBranch, /\.\.\.serviceDetails,/, "added services carry the same details as at creation");

// The create path builds its fields from the same pieces, so both stay identical.
const post = center.slice(center.indexOf('return adminFetch("/admin/service-orders", {\n        method: "POST",'));
assert.match(post.slice(0, 4000), /bookingCenterServices: serviceEntries,\s+\.\.\.serviceDetails,/, "creating and adding share one definition");
assert.match(center, /const already = existingServices\.includes\(meta\.key\);[\s\S]{0,300}disabled=\{already\}/, "a service already on the booking cannot be added twice");
assert.match(center, /if \(existingServices\.includes\(type\)\) return;/);
assert.match(center, /onAddServices=\{source === "service" \? \(\) => setAddingServices\(true\) : undefined\}/, "the workspace opens the add window for service bookings");

// The workspace shows departments by name and keeps every panel reachable.
assert.doesNotMatch(workspace, /booking\.services\.map\(\(service\) => service\.type\)/, "no raw department keys in the header or the receipt");
assert.match(workspace, /<BookingServicesSection booking=\{booking\} onAdd=\{onAddServices\}>/);
assert.match(workspace, /<TabsContent value="transport">[\s\S]{0,1200}<TransportationCard[\s\S]{0,1500}<BookingTransportPlanEditor /, "transport keeps both panels in its tab");
assert.match(workspace, /<TabsContent value="group-photos">[\s\S]{0,200}<GroupAttendeesCard /, "group attendees keep their panel");
assert.match(workspace, /const PRIMARY_TABS = new Set\(\[/);
assert.match(workspace, /TAB_LABELS\.filter\(\(\[value\]\) => !PRIMARY_TABS\.has\(value\)\)/, "every other tab stays under «المزيد»");

console.log("PASS add services to a saved booking: same form, same fields, appended only, paid untouched; workspace panels all reachable");
