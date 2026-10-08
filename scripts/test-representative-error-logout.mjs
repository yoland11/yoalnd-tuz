import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/views/representative/index.tsx", "utf8");
const errorScreen = source.split("function PortalAccessError(")[1]?.split("function Shell(")[0];
assert.ok(errorScreen, "representative access error screen exists");
assert.match(errorScreen, /logoutAdmin\(\)/, "blocked representatives can sign out");
assert.match(errorScreen, /removeQueries\(\{ queryKey: \["representative"\] \}\)/,
  "sign-out clears cached group data before another account signs in");
assert.match(errorScreen, /navigate\("\/representative\/login"\)/,
  "sign-out returns to the dedicated representative login");

console.log("Representative access-error logout checks passed");
