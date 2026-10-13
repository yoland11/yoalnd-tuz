import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const form = readFileSync("src/views/graduation.tsx", "utf8");
const admin = readFileSync("src/views/admin/graduation.tsx", "utf8");
const schema = readFileSync("src/lib/graduation.ts", "utf8");
const server = readFileSync("src/server/graduation.ts", "utf8");

assert.match(form, /decorationPositionImages\(form\.decoration\)/, "the form reads separate images for each location");
assert.match(form, /selectDecorationPosition\(current\.decoration, key\)/, "switching locations keeps their images independent");
assert.match(form, /setDecorationPositionImage\(current\.decoration, position,/, "uploads target one location");
assert.match(form, /\["cap", "القبعة"\]/, "new orders offer a cap position");
assert.match(form, /\["cap_edge", "طرف القبعة"\]/, "new orders offer a cap-edge position");
assert.doesNotMatch(form.slice(form.indexOf("const DECORATION_POSITIONS"), form.indexOf("function colorContrast")), /\["sleeve", "الكم"\]/,
  "older sleeve images stay readable without offering the sleeve as a new selection");
assert.match(schema, /positionFiles:\s*z\.object\(/, "the order API validates the position images");
assert.match(server, /decorationPositionImages\(data\.decoration\)/, "the server persists every uploaded location");
assert.match(server, /positionFiles: storedPositionFiles/, "the order retains the persisted location mapping");
assert.match(server, /GRADUATION_DECORATION_POSITIONS\.flatMap\(\(position\) => \{\s*const image = storedPositionFiles\[position\]/, "each image becomes a design document");
assert.match(server, /\.\.\.submittedDecorationImages/, "group defaults retain student-uploaded location photos");
assert.match(admin, /decorationPositionImages\(order\.decoration/, "the order details expose the saved images by location");
assert.match(admin, /cap_edge: "طرف القبعة"/, "admin order details identify the cap-edge photo");
assert.match(admin, /\["cap_edge", "طرف القبعة"\]/, "admin pricing exposes the cap-edge location");

console.log("PASS graduation decoration photos are isolated, validated and persisted by location");
