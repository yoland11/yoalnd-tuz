import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const form = readFileSync("src/views/graduation.tsx", "utf8");
const admin = readFileSync("src/views/admin/graduation.tsx", "utf8");
const schema = readFileSync("src/lib/graduation.ts", "utf8");
const server = readFileSync("src/server/graduation.ts", "utf8");

assert.match(form, /decorationPositionImages\(form\.decoration\)/, "the form reads separate images for each location");
assert.match(form, /selectDecorationPosition\(current\.decoration, key\)/, "switching locations keeps their images independent");
assert.match(form, /setDecorationPositionImage\(current\.decoration, position,/, "uploads target one location");
assert.match(schema, /positionFiles:\s*z\.object\(/, "the order API validates the position images");
assert.match(server, /decorationPositionImages\(data\.decoration\)/, "the server persists every uploaded location");
assert.match(server, /positionFiles: storedPositionFiles/, "the order retains the persisted location mapping");
assert.match(server, /GRADUATION_DECORATION_POSITIONS\.flatMap\(\(position\) => \{\s*const image = storedPositionFiles\[position\]/, "each image becomes a design document");
assert.match(server, /\.\.\.submittedDecorationImages/, "group defaults retain student-uploaded location photos");
assert.match(admin, /decorationPositionImages\(order\.decoration/, "the order details expose the saved images by location");

console.log("PASS graduation decoration photos are isolated, validated and persisted by location");
